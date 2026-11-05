import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { cancelJournalEntry, reverseJournalEntry, TX_OPTS } from "@/lib/journal-server";

/**
 * تفاصيل القيد + الإجراءات (إلغاء / قيد عكسي) — Task 104.
 * GET: القيد بأسطره وأسماء حساباته.
 * POST: { action: "cancel" | "reverse", reason } — الإلغاء يستبعد من الأرصدة،
 * والعكس ينشر قيدًا معاكسًا مرتبطًا (تصحيح شفاف).
 */

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await authGuard(req, "screen_journal_entries");
  if ("response" in guard) return guard.response;

  const { id } = await ctx.params;
  const entryId = Number(id) || 0;
  const entry = await db.journalEntry.findFirst({
    where: { id: entryId },
    include: {
      lines: {
        orderBy: { sort: "asc" },
        include: { account: { select: { code: true, name: true } } },
      },
    },
  });
  if (!entry) return jsonError("القيد غير موجود.", 404);

  return ok({
    entry: {
      id: entry.id,
      entryNo: entry.entryNo,
      entryDate: entry.entryDate,
      description: entry.description,
      status: entry.status,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      reversalOfId: entry.reversalOfId,
      cancelReason: entry.cancelReason,
      postedBy: entry.postedBy,
      createdBy: entry.createdBy,
      createdAt: entry.createdAt,
      amount: Number(entry.lines.reduce((s, l) => s + Number(l.debit), 0)),
      lines: entry.lines.map((l) => ({
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
    },
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await authGuard(req, "screen_journal_entries");
  if ("response" in guard) return guard.response;

  const { id } = await ctx.params;
  const entryId = Number(id) || 0;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("صيغة الطلب غير صحيحة.", 400);
  }
  const action = String(body.action || "");
  const reason = String(body.reason || "").trim();
  if (!["cancel", "reverse"].includes(action)) return jsonError("إجراء غير معروف.", 400);
  if (!reason) return jsonError("سبب الإجراء مطلوب ويُسجل في التدقيق.", 400);

  try {
    const result = await db.$transaction(async (tx) => {
      if (action === "cancel") {
        await cancelJournalEntry(tx, entryId, reason);
        await audit(tx, {
          username: guard.user.username,
          action: "إلغاء",
          entityType: "journal_entry",
          entityId: entryId,
          reason,
        });
        return { cancelled: true, entryNo: 0 };
      }
      const reversed = await reverseJournalEntry(tx, entryId, reason, guard.user.username);
      await audit(tx, {
        username: guard.user.username,
        action: "قيد عكسي",
        entityType: "journal_entry",
        entityId: reversed.id,
        entityName: `قيد عكسي #${reversed.entryNo} للقيد ${entryId}`,
        reason,
      });
      return { cancelled: false, entryNo: reversed.entryNo, id: reversed.id };
    }, TX_OPTS);

    return ok(
      result.cancelled
        ? { message: "أُلغي القيد واستُبعد من الأرصدة." }
        : { message: `نُشر القيد العكسي #${result.entryNo}.`, entry: result }
    );
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "تعذر تنفيذ الإجراء.", 400);
  }
}
