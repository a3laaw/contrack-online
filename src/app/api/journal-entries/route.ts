import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { isSuperRole } from "@/lib/permissions-catalog";
import { ensureChartOfAccounts } from "@/lib/accounting-server";
import {
  buildAccountResolver,
  nextEntryNo,
  postJournalEntry,
  TX_OPTS,
} from "@/lib/journal-server";
import { validateJournalEntry, type JournalEntryInput } from "@/lib/accounting-journal";
import { getSettingsRow } from "@/lib/contrack-server";

/**
 * القيود اليومية — نواة القيد المزدوج (Task 104).
 * GET: قائمة القيود مع أسطرها وأسماء الحسابات (فلاتر: الحالة/التاريخ/الحساب/البحث).
 * POST: قيد يدوي متعدد الأطراف — يُنشر عبر المحرك الموحد بعد توازن إلزامي وفترة مفتوحة.
 */

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_journal_entries");
  if ("response" in guard) return guard.response;

  await ensureChartOfAccounts();

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") || "";
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const accountId = Number(sp.get("accountId") || 0);
  const q = (sp.get("q") || "").trim();
  const page = Math.max(1, Number(sp.get("page") || 1));

  const where: Record<string, unknown> = {};
  if (["posted", "draft", "cancelled"].includes(status)) where.status = status;
  if (from || to) {
    where.entryDate = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }
  if (q) {
    where.OR = [{ description: { contains: q } }, { entryNo: Number(q) || -1 }];
  }

  // فلتر الحساب: قيود أسطرها تحمل الحساب
  if (accountId > 0) {
    const ids = (
      await db.journalLine.findMany({ where: { accountId }, select: { entryId: true } })
    ).map((l) => l.entryId);
    where.id = { in: ids.length ? ids : [0] };
  }

  const total = await db.journalEntry.count({ where });
  const entries = await db.journalEntry.findMany({
    where,
    orderBy: [{ entryDate: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: {
      lines: {
        orderBy: { sort: "asc" },
        include: { account: { select: { code: true, name: true } } },
      },
    },
  });

  return ok({
    entries: entries.map((e) => ({
      id: e.id,
      entryNo: e.entryNo,
      entryDate: e.entryDate,
      description: e.description,
      status: e.status,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      reversalOfId: e.reversalOfId,
      cancelReason: e.cancelReason,
      postedBy: e.postedBy,
      createdBy: e.createdBy,
      createdAt: e.createdAt,
      amount: Number(e.lines.reduce((s, l) => s + Number(l.debit), 0)),
      lines: e.lines.map((l) => ({
        id: l.id,
        accountCode: l.account.code,
        accountName: l.account.name,
        debit: Number(l.debit),
        credit: Number(l.credit),
        description: l.description,
        customerId: l.customerId,
        contractId: l.contractId,
        subContractId: l.subContractId,
        projectId: l.projectId,
        costCenter: l.costCenter,
      })),
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  });
}

export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_journal_entries");
  if ("response" in guard) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("صيغة الطلب غير صحيحة.", 400);
  }

  const input: JournalEntryInput = {
    entryDate: String(body.entryDate || ""),
    description: String(body.description || ""),
    sourceType: "manual",
    lines: Array.isArray(body.lines) ? (body.lines as JournalEntryInput["lines"]) : [],
  };
  // Task 112 — وضع الاعتماد: asDraft يخلق مسودة (لا أثر مالي حتى اعتماد المحاسب الرئيسي)،
  // وتفعيل entryApprovalMode يجبر غير المدير على المسودة تلقائيًا حتى لو طلب النشر المباشر
  async function entryApprovalModeActive(): Promise<boolean> {
    try {
      const s = await getSettingsRow();
      return Boolean(s.entryApprovalMode);
    } catch {
      return false;
    }
  }
  const wantsDraft = body.asDraft === true || ((await entryApprovalModeActive()) && !isSuperRole(guard.user.role));

  // تحقق مسبق سريع قبل فتح المعاملة (رسائل فورية للواجهة)
  const accounts = await db.account.findMany({
    select: { id: true, allowPosting: true, isActive: true },
  });
  const pre = validateJournalEntry(
    input,
    new Map(accounts.map((a) => [a.id, { allowPosting: a.allowPosting, isActive: a.isActive }]))
  );
  if (!pre.ok) return jsonError(pre.error || "قيد غير صالح.", 400);

  try {
    if (wantsDraft) {
      // مسودة: رقم القيد يُحجز منذ الإنشاء (unique companyId+entryNo) وبلا أثر مالي —
      // بلا فحص فترة (النشر يتحقق لاحقًا) وبلا بذر احتياطي للمرفقين
      const draft = await db.$transaction(async (tx) => {
        const entryNo = await nextEntryNo(tx);
        const row = await tx.journalEntry.create({
          data: {
            entryNo,
            entryDate: input.entryDate,
            description: input.description.trim(),
            status: "draft",
            sourceType: "manual",
            postedAt: null,
            createdBy: guard.user.username,
          },
        });
        await tx.journalLine.createMany({
          data: input.lines.map((l, i) => ({
            entryId: row.id,
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            description: (l.description || "").trim(),
            customerId: l.customerId ?? null,
            contractId: l.contractId ?? null,
            subContractId: l.subContractId ?? null,
            boqItemId: l.boqItemId ?? null,
            projectId: l.projectId ?? null,
            employeeId: l.employeeId ?? null,
            costCenter: (l.costCenter || "").trim(),
            sort: i,
          })),
        });
        await audit(tx, {
          username: guard.user.username,
          action: "حفظ مسودة قيد",
          entityType: "journal_entry",
          entityId: row.id,
          entityName: `مسودة قيد #${entryNo}`,
          newStatus: "draft",
          reason: input.description.slice(0, 180),
        });
        return { id: row.id, entryNo, totalDebit: input.lines.reduce((s, l) => s + Number(l.debit || 0), 0), totalCredit: input.lines.reduce((s, l) => s + Number(l.credit || 0), 0) };
      }, TX_OPTS);
      return ok({
        entry: draft,
        draft: true,
        message: `حُفظت المسودة #${draft.entryNo} — بانتظار اعتماد المحاسب الرئيسي (بلا أثر مالي)`,
      });
    }
    const result = await db.$transaction(async (tx) => {
      await buildAccountResolver(tx);
      const posted = await postJournalEntry(tx, input, guard.user.username);
      await audit(tx, {
        username: guard.user.username,
        action: "إنشاء",
        entityType: "journal_entry",
        entityId: posted.id,
        entityName: `قيد #${posted.entryNo}`,
        newStatus: "posted",
        reason: input.description.slice(0, 180),
      });
      return posted;
    }, TX_OPTS);

    return ok({
      entry: result,
      message: `نُشر القيد #${result.entryNo} — مدين/دائن ${result.totalDebit.toFixed(3)}`,
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "تعذر نشر القيد.", 400);
  }
}
