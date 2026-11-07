import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { monthLabelAr, PAYROLL_BATCH_LABELS } from "@/lib/hr-constants";

type P = { params: Promise<{ id: string }> };

/** GET: تفاصيل مسير — الرأس بسجلاته المجمّدة */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const b = await db.payrollBatch.findUnique({
    where: { id },
    include: { records: { orderBy: { snapName: "asc" } } },
  });
  if (!b) return jsonError("المسير غير موجود", 404);

  return ok({
    batch: {
      id: b.id,
      batchNo: b.batchNo,
      month: b.month,
      monthLabel: monthLabelAr(b.month),
      status: b.status,
      statusLabel: PAYROLL_BATCH_LABELS[b.status] ?? b.status,
      grossTotal: Number(b.grossTotal),
      deductionTotal: Number(b.deductionTotal),
      advanceTotal: Number(b.advanceTotal),
      netTotal: Number(b.netTotal),
      journalEntryId: b.journalEntryId,
      paymentVoucherId: b.paymentVoucherId,
      generatedBy: b.generatedBy,
      approvedBy: b.approvedBy,
      paidAt: b.paidAt,
      cancelledAt: b.cancelledAt,
      cancelReason: b.cancelReason,
      records: b.records.map((r) => ({
        id: r.id,
        employeeId: r.employeeId,
        snapName: r.snapName,
        snapJobTitle: r.snapJobTitle,
        snapPaymentBasis: r.snapPaymentBasis,
        snapBasisLabel: r.snapPaymentBasis === "daily" ? "يومي" : "شهري",
        presentDays: Number(r.presentDays),
        absenceDays: Number(r.absenceDays),
        baseAmount: Number(r.baseAmount),
        absenceDeduction: Number(r.absenceDeduction),
        advanceDeduction: Number(r.advanceDeduction),
        netAmount: Number(r.netAmount),
        deductionVoucherId: r.deductionVoucherId,
      })),
    },
  });
}

/** DELETE: حذف مسودة مسير فقط (الاعتماد يوثق ولا يُحذف) */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const b = await db.payrollBatch.findUnique({ where: { id } });
  if (!b) return jsonError("المسير غير موجود", 404);
  if (b.status !== "draft") return jsonError("يُحذف مسير مسودة فقط — الاعتماد يوثق بالقيد والإلغاء بعكسي موثق");

  const reason = (req.nextUrl.searchParams.get("reason") || "").trim() || "حذف مسيرة مسودة";
  await db.$transaction(async (tx) => {
    await tx.payrollBatch.delete({ where: { id } });
    await tx.purgeAudit.create({
      data: {
        purgedBy: guard.user.username,
        entity: "payroll_batch",
        entityId: id,
        label: `مسير ${monthLabelAr(b.month)} — PR-${b.batchNo}`,
        reason,
        snapshot: JSON.stringify({ batch: b, deletedAt: new Date().toISOString() }),
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف مسير",
      entityType: "payroll_batch",
      entityId: id,
      entityName: `مسير ${monthLabelAr(b.month)} — PR-${b.batchNo}`,
      reason,
    });
  });
  return ok({ deleted: true });
}
