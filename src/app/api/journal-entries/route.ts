import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { ensureChartOfAccounts } from "@/lib/accounting-server";
import {
  buildAccountResolver,
  postJournalEntry,
  TX_OPTS,
} from "@/lib/journal-server";
import { validateJournalEntry, type JournalEntryInput } from "@/lib/accounting-journal";

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
