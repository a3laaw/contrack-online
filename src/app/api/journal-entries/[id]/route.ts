import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { cancelJournalEntry, postDraftEntry, reverseJournalEntry, TX_OPTS } from "@/lib/journal-server";

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
  if (!["cancel", "reverse", "post", "delete"].includes(action)) return jsonError("إجراء غير معروف.", 400);
  if (["cancel", "reverse"].includes(action) && !reason) {
    return jsonError("سبب الإجراء مطلوب ويُسجل في التدقيق.", 400);
  }

  // Task 112 — اعتماد مسودة: للمدير حصرًا (المحاسب الرئيسي) — إعادة التحقق كاملًا ثم النشر
  if (action === "post") {
    const admin = await adminGuard(req);
    if ("response" in admin) return admin.response;
    try {
      const result = await db.$transaction(async (tx) => {
        await postDraftEntry(tx, entryId, admin.user.username);
        const row = await tx.journalEntry.findFirst({ where: { id: entryId }, select: { entryNo: true, postedAt: true, createdBy: true } });
        await audit(tx, {
          username: admin.user.username,
          action: "اعتماد مسودة ونشرها",
          entityType: "journal_entry",
          entityId: entryId,
          entityName: `مسودة #${row?.entryNo} ← posted`,
          oldStatus: "draft",
          newStatus: "posted",
        });
        return row;
      }, TX_OPTS);
      return ok({ message: `اعتمدت المسودة ونُشرت #${result?.entryNo} — دخلت الأرصدة.` });
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "تعذر اعتماد المسودة.", 400);
    }
  }

  // Task 112 — حذف مسودة: بلا أثر مالي إطلاقًا (لم تُنشر قط)
  if (action === "delete") {
    try {
      const row = await db.journalEntry.findFirst({ where: { id: entryId }, select: { status: true, entryNo: true } });
      if (!row) return jsonError("القيد غير موجود.", 404);
      if (row.status !== "draft") return jsonError("الحذف للمسودات حصرًا — المنشور يُلغى بقيد عكسي موثق.", 400);
      await db.$transaction(async (tx) => {
        await tx.journalEntry.delete({ where: { id: entryId } });
        await audit(tx, {
          username: guard.user.username,
          action: "حذف مسودة قيد",
          entityType: "journal_entry",
          entityId: entryId,
          entityName: `مسودة #${row.entryNo}`,
          oldStatus: "draft",
          newStatus: "deleted",
        });
      }, TX_OPTS);
      return ok({ message: `حُذفت المسودة #${row.entryNo}.` });
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "تعذر حذف المسودة.", 400);
    }
  }

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
