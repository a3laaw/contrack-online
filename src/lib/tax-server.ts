import "server-only";
import { db, currentCompanyId } from "@/lib/db";
import { r3 } from "@/lib/accounting-journal";
import { audit } from "@/lib/api-utils";
import {
  computeTax,
  provisionEntryDescription,
  TAX_ACCOUNT_PINS,
  validateAdjustments,
  validateForApproval,
  type TaxAdjustment,
  type TaxDeclarationDTO,
  type TaxKind,
} from "@/lib/tax-core";
import { postJournalEntry, cancelJournalEntry, TX_OPTS } from "@/lib/journal-server";
import type { Tx } from "@/lib/journal-server";
import type { Prisma } from "@prisma/client";

/**
 * tax-server.ts — خادم الزكاة والضريبة — Task 111.
 *  • صافي ربح السنة من الأستاذ حصرًا: حركة 4xxx/5xxx داخل السنة بالقيود posted —
 *    قيود الإغلاق السنوي (sourceType=closing) مستثناة حتى تبقى النتيجة صحيحة بعد الإقفال.
 *  • الاعتماد ذري داخل معاملة واحدة: حراس (مسودة حصرًا، لا معتمد مكرر للسنة، أجنبية للضريبة)
 *    ⇒ قيد المخصص عبر المحرك الموحد ⇒ تعليم الإقرار معتمدًا ⇒ تدقيق.
 *  • الإلغاء: قيد عكسي موثق عبر cancelJournalEntry (بلا حذف فيزيائي) ⇒ الإقرار ملغى.
 *  • $queryRaw محجوب صراحةً بـ company_id (درس Task 110 — الغلاف لا يمر على raw).
 */

const YEAR_SOURCE_TYPES_EXCLUDED = ["closing"] as const;

/** صافي ربح سنة من الأستاذ (4xxx/5xxx حركة posted داخل السنة بلا قيود الإغلاق) */
export async function computeYearNetProfit(year: number): Promise<{ netProfit: number; revenue: number; expense: number }> {
  const companyId = await currentCompanyId();
  if (companyId == null) throw new Error("سياق الشركة مفقود.");
  const agg = await db.$queryRaw<{ revenue: number; expense: number }[]>`
    SELECT
      COALESCE(SUM(CASE WHEN a.type = 'revenue' THEN jl.credit - jl.debit ELSE 0 END), 0)::float AS revenue,
      COALESCE(SUM(CASE WHEN a.type = 'expense' THEN jl.debit - jl.credit ELSE 0 END), 0)::float AS expense
    FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id AND a.company_id = ${companyId}
    JOIN journal_entries je ON je.id = jl.entry_id AND je.status = 'posted' AND je.company_id = ${companyId}
    WHERE jl.company_id = ${companyId}
      AND je.entry_date >= ${`${year}-01-01`} AND je.entry_date <= ${`${year}-12-31`}
      AND je.source_type NOT IN ('closing')
      AND a.type IN ('revenue', 'expense')`;
  const revenue = r3(Number(agg[0]?.revenue ?? 0));
  const expense = r3(Number(agg[0]?.expense ?? 0));
  return { netProfit: r3(revenue - expense), revenue, expense };
}

/** حسم حساب القيد: بالكود أولًا ثم خريطة XBRL — وخطأ صريح عند الغياب */
async function resolveTaxAccount(tx: Tx, kind: TaxKind, side: "debit" | "credit") {
  const pin = TAX_ACCOUNT_PINS[kind];
  const code = side === "debit" ? pin.debitCode : pin.creditCode;
  const xbrl = side === "debit" ? pin.debitXbrl : pin.creditXbrl;
  const byCode = await tx.account.findFirst({ where: { code }, select: { id: true, code: true, name: true } });
  if (byCode) return byCode;
  const byXbrl = await tx.account.findFirst({ where: { xbrlElement: xbrl, isLeaf: true }, select: { id: true, code: true, name: true } });
  if (byXbrl) return byXbrl;
  throw new Error(`حساب ${side === "debit" ? "المصروف" : "الاستحقاق"} للمخصص غير موجود في الدليل (الكود ${code} أو ${xbrl}).`);
}

function declarationToDTO(d: {
  id: number; year: number; kind: string; status: string;
  netProfit: Prisma.Decimal; adjustments: Prisma.JsonValue | null;
  base: Prisma.Decimal; rate: Prisma.Decimal; amount: Prisma.Decimal;
  entryId: number | null; notes: string; approvedBy: string;
  approvedAt: Date | null; cancelledAt: Date | null; cancelReason: string; createdAt: Date;
}, entryNo: number | null): TaxDeclarationDTO {
  return {
    id: d.id,
    year: d.year,
    kind: d.kind as TaxKind,
    status: d.status,
    netProfit: Number(d.netProfit),
    adjustments: Array.isArray(d.adjustments) ? (d.adjustments as unknown as TaxAdjustment[]) : [],
    base: Number(d.base),
    rate: Number(d.rate),
    amount: Number(d.amount),
    entryId: d.entryId,
    entryNo,
    notes: d.notes,
    approvedBy: d.approvedBy,
    approvedAt: d.approvedAt?.toISOString() ?? null,
    cancelledAt: d.cancelledAt?.toISOString() ?? null,
    cancelReason: d.cancelReason,
    createdAt: d.createdAt.toISOString(),
  };
}

/** قائمة إقرارات سنة/كل السنوات + أرقام الجاهزية الحالية من الأستاذ */
export async function listTaxDeclarations(year?: number): Promise<{ declarations: TaxDeclarationDTO[]; currentNetProfit: number; currentRevenue: number; currentExpense: number; foreignOwned: boolean }> {
  const companyId = await currentCompanyId();
  if (companyId == null) throw new Error("سياق الشركة مفقود.");
  const company = await db.company.findUnique({ where: { id: companyId }, select: { foreignOwned: true } });
  const rows = await db.taxDeclaration.findMany({
    where: year ? { year } : {},
    orderBy: [{ year: "desc" }, { id: "desc" }],
  });
  const entryIds = rows.map((r) => r.entryId).filter((i): i is number => i != null);
  const entries = entryIds.length
    ? await db.journalEntry.findMany({ where: { id: { in: entryIds } }, select: { id: true, entryNo: true } })
    : [];
  const entryNoById = new Map(entries.map((e) => [e.id, e.entryNo]));
  const targetYear = year ?? new Date().getFullYear();
  const pnl = await computeYearNetProfit(targetYear);
  return {
    declarations: rows.map((r) => declarationToDTO(r, r.entryId ? entryNoById.get(r.entryId) ?? null : null)),
    currentNetProfit: pnl.netProfit,
    currentRevenue: pnl.revenue,
    currentExpense: pnl.expense,
    foreignOwned: company?.foreignOwned ?? false,
  };
}

/** إنشاء مسودة إقرار (تُلقط أرقام الأستاذ لحظة الإنشاء وتُوثق) */
export async function createTaxDeclaration(input: { year: number; kind: TaxKind; adjustments: unknown; notes?: string }, actor: string): Promise<TaxDeclarationDTO> {
  const actorName = actor || "النظام";
  const companyId = await currentCompanyId();
  if (companyId == null) throw new Error("سياق الشركة مفقود.");
  const adj = validateAdjustments(input.adjustments);
  if (!adj.ok) throw new Error(adj.error || "تعديلات غير صالحة.");
  const company = await db.company.findUnique({ where: { id: companyId }, select: { foreignOwned: true } });
  const active = await db.taxDeclaration.findFirst({
    where: { year: input.year, kind: input.kind, status: { in: ["draft", "approved"] } },
    select: { id: true, status: true },
  });
  if (active) throw new Error(active.status === "draft" ? "توجد مسودة لهذه السنة — عدّلها بدل التكرار." : "سنة معتمدة موجودة — الإلغاء أولًا.");
  if (input.kind === "foreign_tax" && !company?.foreignOwned) {
    throw new Error("ضريبة دخل الأجانب للشركات الأجنبية الملكية حصرًا (علم foreignOwned على الشركة).");
  }
  const pnl = await computeYearNetProfit(input.year);
  const comp = computeTax(input.kind, pnl.netProfit, adj.clean);
  const row = await db.$transaction(async (tx) => {
    const created = await tx.taxDeclaration.create({
      data: {
        year: input.year,
        kind: input.kind,
        status: "draft",
        netProfit: comp.netProfit,
        adjustments: JSON.parse(JSON.stringify(adj.clean)),
        base: comp.base,
        rate: comp.rate,
        amount: comp.amount,
        notes: (input.notes || "").trim(),
      },
    });
    await audit(tx, {
      username: actorName,
      action: "إنشاء مسودة إقرار",
      entityType: "tax_declaration",
      entityId: created.id,
      entityName: `${input.kind === "zakat" ? "زكاة" : "ضريبة أجانب"} ${input.year} — ${comp.amount}`,
    });
    return created;
  }, TX_OPTS);
  return declarationToDTO(row, null);
}

/** الاعتماد الذري: حراس ⇒ قيد المخصص عبر المحرك الموحد ⇒ تعليم + تدقيق — معاملة واحدة */
export async function approveTaxDeclaration(id: number, actor: string): Promise<TaxDeclarationDTO> {
  const companyId = await currentCompanyId();
  if (companyId == null) throw new Error("سياق الشركة مفقود.");
  return db.$transaction(async (tx) => {
    const d = await tx.taxDeclaration.findFirst({ where: { id } });
    if (!d) throw new Error("الإقرار غير موجود.");
    const company = await tx.company.findUnique({ where: { id: companyId }, select: { foreignOwned: true } });
    const approvedSame = await tx.taxDeclaration.findFirst({
      where: { year: d.year, kind: d.kind, status: "approved", id: { not: d.id } },
      select: { id: true },
    });
    const kind = d.kind as TaxKind;
    const check = validateForApproval({
      status: d.status,
      kind,
      year: d.year,
      netProfit: Number(d.netProfit),
      base: Number(d.base),
      amount: Number(d.amount),
      foreignOwned: company?.foreignOwned,
      hasApprovedSameYear: !!approvedSame,
    });
    if (!check.ok) throw new Error(check.error || "الاعتماد مرفوض.");

    const debitAcc = await resolveTaxAccount(tx, kind, "debit");
    const creditAcc = await resolveTaxAccount(tx, kind, "credit");
    const amount = r3(Number(d.amount));

    // ديسمبر يقبل قيد المخصص إن قُفلت يدويًا (نفس منطق الإقفال السنوي — داخل المعاملة فقط)
    const decKey = `${d.year}-12`;
    const dec = await tx.fiscalPeriod.findFirst({ where: { periodDate: decKey }, select: { id: true, status: true } });
    if (dec && dec.status === "closed") {
      await tx.fiscalPeriod.update({ where: { id: dec.id }, data: { status: "open" } });
    }
    const posted = await postJournalEntry(
      tx,
      {
        entryDate: `${d.year}-12-31`,
        description: provisionEntryDescription(kind, d.year),
        sourceType: "tax_provision",
        sourceId: d.id,
        lines: [
          { accountId: debitAcc.id, debit: amount, credit: 0, description: TAX_ACCOUNT_PINS[kind].label },
          { accountId: creditAcc.id, debit: 0, credit: amount, description: TAX_ACCOUNT_PINS[kind].label },
        ],
      },
      actor
    );

    const updated = await tx.taxDeclaration.update({
      where: { id: d.id },
      data: { status: "approved", entryId: posted.id, approvedBy: actor, approvedAt: new Date() },
    });

    await audit(tx, {
      username: actor,
      action: "اعتماد إقرار ونشر مخصص",
      entityType: "tax_declaration",
      entityId: d.id,
      entityName: `${kind === "zakat" ? "زكاة" : "ضريبة أجانب"} ${d.year} — ${amount}`,
      oldStatus: "draft",
      newStatus: `approved / قيد #${posted.entryNo}`,
    });

    // إعادة قفل ديسمبر إن أُعيد فتحه مؤقتًا للقيد
    if (dec && dec.status === "closed") {
      await tx.fiscalPeriod.update({ where: { id: dec.id }, data: { status: "closed" } });
    }
    void companyId;
    return declarationToDTO(updated, posted.entryNo);
  }, TX_OPTS);
}

/** إلغاء إقرار معتمد: قيد عكسي موثق عبر المحرك + تعليم الإقرار ملغى — بلا حذف فيزيائي */
export async function cancelTaxDeclaration(id: number, reason: string, actor: string): Promise<TaxDeclarationDTO> {
  if (!reason.trim()) throw new Error("سبب الإلغاء إلزامي.");
  const companyId = await currentCompanyId();
  if (companyId == null) throw new Error("سياق الشركة مفقود.");
  return db.$transaction(async (tx) => {
    const d = await tx.taxDeclaration.findFirst({ where: { id } });
    if (!d) throw new Error("الإقرار غير موجود.");
    if (d.status !== "approved") throw new Error("الإلغاء للإقرارات المعتمدة حصرًا — المسودة تُحذف ببساطة.");
    if (!d.entryId) throw new Error("الإقرار بلا قيد مخصص — حالة غير سليمة.");

    await cancelJournalEntry(tx, d.entryId, `إلغاء إقرار ${d.kind === "zakat" ? "الزكاة" : "ضريبة الأجانب"} لسنة ${d.year}: ${reason.trim()}`);
    const updated = await tx.taxDeclaration.update({
      where: { id: d.id },
      data: { status: "cancelled", cancelledAt: new Date(), cancelReason: reason.trim() },
    });
    await audit(tx, {
      username: actor,
      action: "إلغاء إقرار (قيد عكسي)",
      entityType: "tax_declaration",
      entityId: d.id,
      entityName: `${d.kind === "zakat" ? "زكاة" : "ضريبة أجانب"} ${d.year}`,
      oldStatus: "approved",
      newStatus: "cancelled",
    });
    void companyId;
    return declarationToDTO(updated, null);
  }, TX_OPTS);
}

/** حذف مسودة (بلا أثر مالي) */
export async function deleteTaxDraft(id: number): Promise<void> {
  const d = await db.taxDeclaration.findFirst({ where: { id } });
  if (!d) throw new Error("الإقرار غير موجود.");
  if (d.status !== "draft") throw new Error("المسودات حصرًا تُحذف — المعتمد يُلغى بقيد عكسي.");
  await db.taxDeclaration.delete({ where: { id } });
}
