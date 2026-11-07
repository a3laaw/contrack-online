import "server-only";

/**
 * Task 113 — التسوية البنكية: طبقة الخادم
 * كل الاستعلامات عبر غلاف db المقيّد بالشركة — لا $queryRaw هنا إطلاقًا.
 */

import { db } from "@/lib/db";
import { audit } from "@/lib/api-utils";
import { getSettingsRow } from "@/lib/contrack-server";
import { isSuperRole } from "@/lib/permissions-catalog";
import {
  buildQuickPostLines,
  reconcileBank,
  validateReconClose,
  type GlSideLine,
  type ReconResult,
} from "@/lib/bank-recon-core";
import { postJournalEntry, nextEntryNo, TX_OPTS } from "@/lib/journal-server";
import { r3 } from "@/lib/accounting-journal";
import type { ReportTable } from "@/lib/report-server";

// ==================== الخريطة: مفتاح كشف البنك → حساب الدليل ====================

export interface BankKeyRow {
  bankKey: string;
  linesCount: number;
  lastDate: string;
  accountId: number | null;
  accountCode: string;
  accountName: string;
}

export async function listBankKeys(): Promise<BankKeyRow[]> {
  const lines = await db.bankLine.findMany({
    select: { bankAccount: true, cdate: true },
    orderBy: { cdate: "desc" },
  });
  const maps = await db.bankMap.findMany({
    include: { account: { select: { code: true, name: true } } },
  });
  const mapByKey = new Map(maps.map((m) => [m.bankKey, m]));
  const agg = new Map<string, { count: number; last: string }>();
  for (const l of lines) {
    const cur = agg.get(l.bankAccount) || { count: 0, last: "" };
    cur.count += 1;
    if (l.cdate > cur.last) cur.last = l.cdate;
    agg.set(l.bankAccount, cur);
  }
  return [...agg.entries()]
    .map(([bankKey, v]) => {
      const m = mapByKey.get(bankKey);
      return {
        bankKey,
        linesCount: v.count,
        lastDate: v.last,
        accountId: m?.accountId ?? null,
        accountCode: m?.account.code ?? "",
        accountName: m?.account.name ?? "",
      };
    })
    .sort((a, b) => (a.accountId == null ? -1 : 1) - (b.accountId == null ? -1 : 1) || b.linesCount - a.linesCount);
}

export async function setBankMap(bankKey: string, accountId: number, actor: string): Promise<void> {
  const key = (bankKey || "").trim();
  if (!key) throw new Error("مفتاح كشف البنك مطلوب.");
  const acc = await db.account.findUnique({ where: { id: accountId } });
  if (!acc) throw new Error("الحساب غير موجود.");
  if (!acc.isLeaf || !acc.allowPosting || !acc.isActive) {
    throw new Error("اختر حساب ورقة نشطًا مسموح النشر عليه.");
  }
  const found = await db.bankMap.findFirst({ where: { bankKey: key } });
  if (found) {
    await db.bankMap.update({ where: { id: found.id }, data: { accountId } });
  } else {
    await db.bankMap.create({ data: { bankKey: key, accountId } });
  }
  await audit(db, {
    username: actor,
    action: found ? "تعديل ربط كشف بنك" : "ربط كشف بنك بحساب",
    entityType: "bank_map",
    entityId: found?.id,
    entityName: `${key} → ${acc.code} ${acc.name}`,
  });
}

// ==================== الحساب الحي للتسوية ====================

export interface ReconComputeInput {
  bankAccountId: number;
  asOf: string;
  statementBalance: number;
  tolerance?: number;
  windowDays?: number;
}

export interface ReconComputeOutput extends ReconResult {
  account: { id: number; code: string; name: string };
  mappedKeys: string[];
  statementLinesCount: number;
  closedRecord: {
    id: number;
    asOf: string;
    statementBalance: number;
    bookBalance: number;
    closedBy: string;
    closedAt: string;
    unexplained: number;
  } | null;
}

export async function computeBankRecon(input: ReconComputeInput): Promise<ReconComputeOutput> {
  const asOf = (input.asOf || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("تاريخ التسوية مطلوب بصيغة YYYY-MM-DD.");

  const account = await db.account.findUnique({ where: { id: input.bankAccountId } });
  if (!account) throw new Error("حساب البنك غير موجود.");

  const maps = await db.bankMap.findMany({ where: { accountId: account.id } });
  const mappedKeys = maps.map((m) => m.bankKey);

  // بنود الكشف حتى التاريخ للمفاتيح المرتبطة
  const bankRows = mappedKeys.length
    ? await db.bankLine.findMany({
        where: { bankAccount: { in: mappedKeys }, cdate: { lte: asOf } },
        select: { id: true, cdate: true, amount: true, descr: true },
      })
    : [];

  // حركات الدفتر المنشورة على الحساب حتى التاريخ (مع بيانات القيد)
  const glRows = await db.journalLine.findMany({
    where: { accountId: account.id, entry: { status: "posted", entryDate: { lte: asOf } } },
    select: {
      id: true, debit: true, credit: true, description: true,
      entry: { select: { id: true, entryNo: true, entryDate: true, description: true } },
    },
    orderBy: [{ entry: { entryDate: "asc" } }, { id: "asc" }],
  });

  const bankLines = bankRows.map((l) => ({ id: l.id, cdate: l.cdate, amount: r3(Number(l.amount)), descr: l.descr }));
  const glLines: GlSideLine[] = glRows.map((l) => ({
    id: l.id,
    entryId: l.entry.id,
    entryNo: l.entry.entryNo,
    entryDate: l.entry.entryDate,
    description: l.description || l.entry.description,
    amount: r3(Number(l.debit) - Number(l.credit)),
  }));

  const bookBalance = r3(Number(account.openingBalance) + glLines.reduce((s, l) => s + l.amount, 0));

  const result = reconcileBank(bankLines, glLines, {
    statementBalance: input.statementBalance,
    bookBalance,
    tolerance: input.tolerance,
    windowDays: input.windowDays,
  });

  const closed = await db.bankRecon.findFirst({ where: { accountId: account.id, asOf } });

  return {
    ...result,
    account: { id: account.id, code: account.code, name: account.name },
    mappedKeys,
    statementLinesCount: bankRows.length,
    closedRecord: closed
      ? {
          id: closed.id,
          asOf: closed.asOf,
          statementBalance: Number(closed.statementBalance),
          bookBalance: Number(closed.bookBalance),
          closedBy: closed.closedBy,
          closedAt: closed.closedAt.toISOString(),
          unexplained: Number(closed.unexplained),
        }
      : null,
  };
}

// ==================== النشر السريع لبند كشف غير مسجل ====================

export async function quickPostBankLine(
  params: { bankLineId: number; counterpartAccountId: number; description?: string },
  actor: string,
  role: string
): Promise<{ entryNo: number; draft: boolean; message: string }> {
  const line = await db.bankLine.findUnique({ where: { id: params.bankLineId } });
  if (!line) throw new Error("بند الكشف غير موجود.");

  const counterpart = await db.account.findUnique({ where: { id: params.counterpartAccountId } });
  if (!counterpart) throw new Error("الحساب المقابل غير موجود.");
  if (!counterpart.isLeaf || !counterpart.allowPosting || !counterpart.isActive) {
    throw new Error("الحساب المقابل يجب أن يكون ورقة نشطًا مسموح النشر عليه.");
  }

  // حساب البنك: من خريطة المفتاح — بند بلا ربط لا يُنشر
  const map = await db.bankMap.findFirst({ where: { bankKey: line.bankAccount } });
  if (!map) throw new Error(`مفتاح الكشف «${line.bankAccount}» غير مربوط بحساب بنك — اربطه أولًا.`);

  const bankAmount = r3(Number(line.amount));
  if (bankAmount === 0) throw new Error("بند الكشف صفر — لا يُنشر.");

  const lines = buildQuickPostLines(bankAmount, map.accountId, params.counterpartAccountId, params.description || line.descr);

  // حماية التكرار: إن كان البند يطابق آليًا سطرًا دفتريًا الآن فلا ننشر مرة ثانية
  const recon = await computeBankRecon({
    bankAccountId: map.accountId,
    asOf: line.cdate,
    statementBalance: 0,
    tolerance: 0,
    windowDays: 3,
  });
  if (recon.pairs.some((p) => p.bank.id === line.id)) {
    throw new Error("هذا البند مطابق مسبقًا لحركة في الدفتر — لا يُنشر مرتين.");
  }

  const input = {
    entryDate: line.cdate,
    description: `تسوية بنكية — ${line.bankAccount}: ${(params.description || line.descr || "بند كشف غير مسجل").trim()}`.slice(0, 180),
    sourceType: "bank_recon",
    sourceId: line.id,
    lines,
  };

  // وضع الاعتماد (Task 112): غير المدير يُجبر على مسودة — نفس قاعدة شاشة القيود
  let approvalMode = false;
  try {
    approvalMode = Boolean((await getSettingsRow()).entryApprovalMode);
  } catch {
    approvalMode = false;
  }
  const asDraft = approvalMode && !isSuperRole(role);

  if (asDraft) {
    const draft = await db.$transaction(async (tx) => {
      const entryNo = await nextEntryNo(tx);
      const row = await tx.journalEntry.create({
        data: {
          entryNo,
          entryDate: input.entryDate,
          description: input.description,
          status: "draft",
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          createdBy: actor,
        },
      });
      await tx.journalLine.createMany({
        data: input.lines.map((l, i) => ({
          entryId: row.id,
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
          description: l.description || "",
          sort: i,
        })),
      });
      await audit(tx, {
        username: actor,
        action: "مسودة تسوية بنكية",
        entityType: "journal_entry",
        entityId: row.id,
        entityName: `مسودة تسوية بنكية #${entryNo}`,
        newStatus: "draft",
        reason: input.description,
      });
      return { entryNo, row };
    }, TX_OPTS);
    return {
      entryNo: draft.entryNo,
      draft: true,
      message: `حُفظت المسودة #${draft.entryNo} — بانتظار اعتماد المحاسب الرئيسي (بلا أثر مالي)`,
    };
  }

  const posted = await db.$transaction(async (tx) => {
    const res = await postJournalEntry(tx, input, actor);
    await audit(tx, {
      username: actor,
      action: "نشر تسوية بنكية",
      entityType: "journal_entry",
      entityId: res.id,
      entityName: `قيد تسوية بنكية #${res.entryNo}`,
      newStatus: "posted",
      reason: input.description,
    });
    return res;
  }, TX_OPTS);

  return {
    entryNo: posted.entryNo,
    draft: false,
    message: `نُشر القيد #${posted.entryNo} — ${bankAmount > 0 ? "مدين" : "دائن"} البنك ${r3(Math.abs(bankAmount))}`,
  };
}

// ==================== الإقفال الموثق ====================

export async function closeBankRecon(
  params: { bankAccountId: number; asOf: string; statementBalance: number; tolerance?: number; windowDays?: number },
  actor: string
): Promise<{ id: number; message: string }> {
  const out = await computeBankRecon({
    bankAccountId: params.bankAccountId,
    asOf: params.asOf,
    statementBalance: params.statementBalance,
    tolerance: params.tolerance,
    windowDays: params.windowDays,
  });
  const check = validateReconClose(out.totals);
  if (!check.ok) throw new Error(check.error || "لا يمكن الإقفال — فروق غير مفسَّرة.");

  const snapshot = {
    pairsCount: out.totals.matchedCount,
    bankOnly: out.bankOnly.map((l) => ({ id: l.id, cdate: l.cdate, amount: l.amount, descr: l.descr })),
    glOnly: out.glOnly.map((l) => ({ id: l.id, entryNo: l.entryNo, entryDate: l.entryDate, amount: l.amount, description: l.description })),
    mappedKeys: out.mappedKeys,
    tolerance: params.tolerance ?? 0,
    windowDays: params.windowDays ?? 15,
  };

  const existing = await db.bankRecon.findFirst({ where: { accountId: out.account.id, asOf: params.asOf } });

  const data = {
    accountId: out.account.id,
    asOf: params.asOf,
    statementBalance: r3(out.totals.statementBalance),
    bookBalance: r3(out.totals.bookBalance),
    bankOnlyCount: out.totals.bankOnlyCount,
    bankOnlyTotal: r3(out.totals.bankOnlySum),
    glOnlyCount: out.totals.glOnlyCount,
    glOnlyTotal: r3(out.totals.glOnlySum),
    unexplained: 0,
    snapshot: snapshot as unknown as object,
    closedBy: actor,
  };

  const saved = existing
    ? await db.bankRecon.update({ where: { id: existing.id }, data })
    : await db.bankRecon.create({ data });

  await audit(db, {
    username: actor,
    action: existing ? "تحديث إقفال تسوية بنكية" : "إقفال تسوية بنكية",
    entityType: "bank_recon",
    entityId: saved.id,
    entityName: `تسوية ${out.account.code} حتى ${params.asOf}`,
    newStatus: "closed",
    reason: `كشف ${r3(out.totals.statementBalance)} / دفتر ${r3(out.totals.bookBalance)}`,
  });

  return { id: saved.id, message: `أُقفلت تسوية ${out.account.name} حتى ${params.asOf} — سجل #${saved.id}` };
}

export async function listClosedBankRecons(accountId?: number) {
  const rows = await db.bankRecon.findMany({
    where: accountId ? { accountId } : undefined,
    orderBy: [{ asOf: "desc" }, { id: "desc" }],
    take: 50,
    include: { account: { select: { code: true, name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    accountCode: r.account.code,
    accountName: r.account.name,
    accountId: r.accountId,
    asOf: r.asOf,
    statementBalance: Number(r.statementBalance),
    bookBalance: Number(r.bookBalance),
    bankOnlyCount: r.bankOnlyCount,
    bankOnlyTotal: Number(r.bankOnlyTotal),
    glOnlyCount: r.glOnlyCount,
    glOnlyTotal: Number(r.glOnlyTotal),
    closedBy: r.closedBy,
    closedAt: r.closedAt.toISOString(),
  }));
}

// ==================== تقرير الفوارق — ReportTable للتصدير (CSV/Excel) ====================

export interface BankReconReportParams {
  bankAccountId: number;
  asOf: string;
  statementBalance: number;
  tolerance?: number;
  windowDays?: number;
}

/** تقرير الفوارق بين كشف البنك والدفتر — الجدول الموحد لسجل التصدير */
export async function reportBankReconciliation(p: BankReconReportParams): Promise<ReportTable> {
  const out = await computeBankRecon(p);
  const t = out.totals;
  const fmt = (n: number) => r3(n);
  const rows: (string | number)[][] = [];
  const accentRows: number[] = [];

  rows.push(["بند كشف غير مسجل", "", "", "", ""]);
  accentRows.push(rows.length - 1);
  for (const l of out.bankOnly) {
    rows.push(["كشف بنك", l.cdate, l.descr || "—", `${l.amount > 0 ? "إيداع" : "سحب"}`, fmt(l.amount)]);
  }
  if (!out.bankOnly.length) rows.push(["—", "لا بنود", "", "", ""]);

  rows.push(["بند دفتر عالق", "", "", "", ""]);
  accentRows.push(rows.length - 1);
  for (const l of out.glOnly) {
    rows.push(["دفتر", l.entryDate, `قيد #${l.entryNo} — ${l.description}`, l.amount > 0 ? "مدين" : "دائن", fmt(l.amount)]);
  }
  if (!out.glOnly.length) rows.push(["—", "لا بنود", "", "", ""]);

  rows.push(["أزواج مطابقة", "", "", "", ""]);
  accentRows.push(rows.length - 1);
  for (const p2 of out.pairs.slice(0, 200)) {
    rows.push(["مطابق", p2.bank.cdate, `${p2.bank.descr || "—"} ↔ قيد #${p2.gl.entryNo}`, p2.dayGap === 0 ? "بنفس اليوم" : `فرق ${p2.dayGap} يوم`, fmt(p2.bank.amount)]);
  }
  if (!out.pairs.length) rows.push(["—", "لا أزواج", "", "", ""]);

  return {
    title: `تسوية بنكية — ${out.account.code} ${out.account.name} حتى ${p.asOf}`,
    heads: ["الفئة", "التاريخ", "البيان", "الاتجاه", "المبلغ"],
    widths: [16, 12, 44, 12, 16],
    rows,
    numberCols: [4],
    accentRows,
    totals: {
      "رصيد الكشف": fmt(t.statementBalance),
      "رصيد الدفتر": fmt(t.bookBalance),
      "الفرق (كشف−دفتر)": fmt(t.gap),
      "بنود كشف غير مسجلة": fmt(t.bankOnlySum),
      "بنود دفتر عالقة": fmt(t.glOnlySum),
      "مُفسَّر": fmt(t.explained),
      "غير مفسَّر": fmt(t.unexplained),
    },
    note:
      `مطابقة: ${t.matchedCount} زوجًا من ${t.bankLinesCount} بند كشف و${t.glLinesCount} حركة دفتر. ` +
      `المعادلة: رصيد الكشف − رصيد الدفتر = بنود الكشف غير المسجلة − بنود الدفتر العالقة.` +
      (t.unexplained !== 0 ? ` ⚠ فرق غير مفسَّر = ${t.unexplained} — راجع أرصدة ما قبل التسوية.` : " ✓ لا فرق غير مفسَّر."),
  };
}
