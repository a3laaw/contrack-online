import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, adminGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { cancelJournalEntry } from "@/lib/journal-server";
import { cancelVoucherTx } from "@/lib/voucher-server";
import { monthLabelAr } from "@/lib/hr-constants";

type P = { params: Promise<{ id: string }> };

/**
 * POST: إلغاء مسير معتمد (قبل الدفع) — موثق بلا حذف فيزيائي (نمط الزكاة):
 * إلغاء قيد الاعتماد + إلغاء سندات SD (بعكس قيودها آليًا) ⇒ batch=cancelled.
 * المسير المدفوع لا يُلغى هنا — الاسترداد عبر الخزينة (حدود HR-1 موثقة).
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = String(body.reason || "").trim();
  if (!reason) return jsonError("سبب الإلغاء إلزامي");

  const batch = await db.payrollBatch.findUnique({
    where: { id },
    include: { records: { where: { deductionVoucherId: { not: null } }, select: { id: true, deductionVoucherId: true } } },
  });
  if (!batch) return jsonError("المسير غير موجود", 404);
  if (batch.status === "draft") return jsonError("المسير مسودة — احذفه بدلًا من إلغائه");
  if (batch.status === "cancelled") return jsonError("المسير ملغى من قبل");
  if (batch.status === "paid") return jsonError("المسير مدفوع — الاسترداد عبر سند عكسي من الخزينة (حدود HR-1)");
  if (!batch.journalEntryId) return jsonError("قيد الاعتماد مفقود — لا يمكن الإلغاء الموثق");
  const journalEntryId: number = batch.journalEntryId;
  const provisionEntryId: number | null = batch.provisionEntryId; // HR-2 — قيد المخصصات المصاحب

  const batchLabel = `مسير رواتب ${monthLabelAr(batch.month)} — PR-${batch.batchNo}`;
  const actor = guard.user.username;

  try {
    await db.$transaction(async (tx) => {
      // 1) إلغاء سندات SD (تعكس قيودها آليًا عبر cancelVoucherTx)
      for (const rec of batch.records) {
        if (rec.deductionVoucherId != null) {
          await cancelVoucherTx(tx, rec.deductionVoucherId, `إلغاء ${batchLabel}: ${reason}`, actor);
        }
      }
      // 2) إلغاء قيد الاعتماد (توثيق الحالة — بلا حذف فيزيائي)
      await cancelJournalEntry(tx, journalEntryId, `إلغاء ${batchLabel}: ${reason}`);
      // 2-ب) HR-2 — عكس قيد المخصصات المصاحب إن وجد (نمط الزكاة — بلا حذف فيزيائي)
      if (provisionEntryId != null) {
        await cancelJournalEntry(tx, provisionEntryId, `إلغاء ${batchLabel} — قيد المخصصات المصاحب: ${reason}`);
      }
      // 3) حالة الدفعة
      await tx.payrollBatch.update({
        where: { id: batch.id },
        data: { status: "cancelled", cancelledAt: new Date(), cancelReason: reason },
      });
      await audit(tx, {
        username: actor,
        action: "إلغاء مسير",
        entityType: "payroll_batch",
        entityId: batch.id,
        entityName: batchLabel,
        oldStatus: "approved",
        newStatus: "cancelled",
        reason,
      });
    });
    return ok({ cancelled: true });
  } catch (e) {
    console.error(e);
    return jsonError("تعذر إلغاء المسير", 500);
  }
}
