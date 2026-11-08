// POST /api/warehouses/docs/[id]/cancel — إلغاء إذن مخزني (المدير فقط)
// د6 — الإلغاء = قيد عكسي مرتبط (reversal) + تجميد مستند بلا حذف فيزيائي؛ الأرصدة الاشتقاقية تعود تلقائيًا (G9).
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { TX_OPTS, reverseJournalEntry } from "@/lib/journal-server";

type P = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "warehouses", "المخازن");
  if (mg) return mg;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) return jsonError("معرّف غير صالح");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = String(body.reason ?? "").trim();
  if (!reason) return jsonError("ذكر سبب الإلغاء مطلوب");

  const doc = await db.stockDoc.findFirst({
    where: { id },
    select: { id: true, docNumber: true, kind: true, status: true, journalEntryId: true, contractId: true },
  });
  if (!doc) return jsonError("الإذن غير موجود", 404);
  if (doc.status === "cancelled") return jsonError("الإذن ملغى مسبقًا", 409);

  const result = await db.$transaction(async (tx) => {
    let reversalEntryNo: number | null = null;
    if (doc.journalEntryId) {
      const reversed = await reverseJournalEntry(tx, doc.journalEntryId, `إلغاء الإذن ${doc.docNumber} — ${reason}`, guard.user.username);
      reversalEntryNo = reversed.entryNo;
    }
    await tx.stockDoc.update({
      where: { id: doc.id },
      data: { status: "cancelled", cancelReason: reason, cancelledAt: new Date() },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "إلغاء",
      entityType: "stock_doc",
      entityId: doc.id,
      entityName: doc.docNumber,
      oldStatus: "posted",
      newStatus: "cancelled",
      reason,
    });
    return { reversalEntryNo };
  }, TX_OPTS);

  return ok({ ok: true, reversalEntryNo: result.reversalEntryNo });
}
