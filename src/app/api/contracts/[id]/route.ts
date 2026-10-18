import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok, parseDay, todayStr } from "@/lib/api-utils";
import { ACTIVE_CLAIM_STATUSES, loadContractCore } from "@/lib/contrack-server";

type P = { params: Promise<{ id: string }> };

const CONTRACT_STATUSES = ["مسودة", "تحت المراجعة", "معتمد", "نشط", "متوقف", "منتهي", "مغلق", "ملغى"];

/** تفاصيل العقد: العقد + العميل + المراحل + الخطة + القيمة/القبض + حالة الإشراف إن إشرافي */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const core = await loadContractCore(id);
  if (!core) return jsonError("العقد غير موجود", 404);
  const c = core.contract;

  return ok({
    contract: {
      id: c.id,
      contractNumber: c.contractNumber,
      contractName: c.contractName,
      contractType: c.contractType,
      customerId: c.customerId,
      customer: core.contract.customer,
      contractDate: c.contractDate,
      signDate: c.signDate,
      startDate: c.startDate,
      endDate: c.endDate,
      status: c.status,
      statusReason: c.statusReason,
      cancelledAt: c.cancelledAt,
      manualPath: c.manualPath,
      description: c.description,
      notes: c.notes,
      amount: Number(c.amount),
      currency: c.currency,
      qty: Number(c.qty),
      unitPrice: Number(c.unitPrice),
      supStartDate: c.supStartDate,
      supMonths: c.supMonths,
      supMonthly: Number(c.supMonthly),
      supDiscount: Number(c.supDiscount),
      supWaivedMonths: Number(c.supWaivedMonths),
      supWaiveReason: c.supWaiveReason,
    },
    stages: core.stages,
    plan: core.planRaw.map((p) => ({
      id: p.id,
      title: p.title,
      dueDate: p.dueDate,
      amount: Number(p.amount),
      sortOrder: p.sortOrder,
      stageId: p.stageId,
      triggeredAt: p.triggeredAt,
      notes: p.notes,
    })),
    current: core.current,
    collected: core.collected,
    remaining: Math.round((core.current - core.collected) * 1000) / 1000,
    isSupervision: Boolean(core.sup),
    sup: core.sup,
  });
}

/**
 * تعديل العقد:
 * - amount ممنوع تعديله إن وُجدت سندات قبض سارية أو خطة أو فواتير.
 * - status عبر changeContractStatus داخليًا (status + statusReason + cancelledAt عند ملغى).
 */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const core = await loadContractCore(id);
  if (!core) return jsonError("العقد غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};

  if (body.amount !== undefined) {
    const planCount = await db.paymentPlanItem.count({ where: { contractId: id } });
    const invoicesCount = await db.invoice.count({ where: { contractId: id } });
    if (core.receipts.length > 0 || planCount > 0 || invoicesCount > 0) {
      return jsonError("لا يمكن تعديل قيمة العقد بعد وجود حركة مالية");
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || !(amount > 0)) {
      return jsonError("قيمة العقد يجب أن تكون أكبر من صفر");
    }
    data.amount = amount;
  }

  let statusChanged = false;
  let oldStatus = core.contract.status;
  if (body.status !== undefined && String(body.status) !== core.contract.status) {
    const status = String(body.status);
    if (!CONTRACT_STATUSES.includes(status)) return jsonError("حالة غير صحيحة");
    data.status = status;
    if (status === "ملغى") {
      data.cancelledAt = todayStr();
      data.statusReason = String(body.statusReason || body.cancelReason || "");
    } else {
      data.cancelledAt = "";
      if (body.statusReason !== undefined) data.statusReason = String(body.statusReason);
    }
    statusChanged = true;
  } else if (body.statusReason !== undefined) {
    data.statusReason = String(body.statusReason);
  }

  if (body.contractName !== undefined) data.contractName = String(body.contractName);
  if (body.description !== undefined) data.description = String(body.description);
  if (body.notes !== undefined) data.notes = String(body.notes);
  for (const f of ["contractDate", "startDate", "endDate", "signDate"] as const) {
    if (body[f] !== undefined) {
      const d = parseDay(body[f]);
      if (!d) return jsonError(`تاريخ غير صالح: ${f}`);
      data[f] = d;
    }
  }

  const updated = await db.$transaction(async (tx) => {
    const contract = await tx.contract.update({ where: { id }, data });
    if (statusChanged) {
      const newStatus = String(data.status);
      await tx.contractEvent.create({
        data: {
          contractId: id,
          eventType: "تغيير حالة العقد",
          description: `الحالة: ${oldStatus} ← ${newStatus}${data.statusReason ? ` — السبب: ${String(data.statusReason)}` : ""}`,
          username: guard.user.username,
        },
      });
      await audit(tx, {
        username: guard.user.username,
        action: "تغيير حالة",
        entityType: "contract",
        entityId: id,
        entityName: contract.contractNumber,
        oldStatus,
        newStatus,
        reason: String(data.statusReason || ""),
      });
    } else if (Object.keys(data).length > 0) {
      await tx.contractEvent.create({
        data: {
          contractId: id,
          eventType: "تعديل العقد",
          description: `تعديل بيانات العقد (${Object.keys(data).join("، ")})`,
          username: guard.user.username,
        },
      });
      await audit(tx, {
        username: guard.user.username,
        action: "تعديل",
        entityType: "contract",
        entityId: id,
        entityName: contract.contractNumber,
      });
    }
    return contract;
  });

  return ok({
    contract: { id: updated.id, status: updated.status, cancelledAt: updated.cancelledAt },
  });
}

/**
 * حذف العقد — الرفض بالترتيب الحرفي من spec-core G
 * (فواتير ← سندات سارية ← مطالبات سارية ← عقود باطن ← دفعات ← مراحل) ثم حذف فعلي.
 */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_cancel_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({ where: { id } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const invoices = await db.invoice.count({ where: { contractId: id } });
  if (invoices > 0) return jsonError("لا يمكن حذف العقد لوجود فواتير مرتبطة به");

  const vouchers = await db.voucher.count({ where: { contractId: id, cancelled: false } });
  if (vouchers > 0) return jsonError("لا يمكن حذف العقد لوجود سندات سارية مرتبطة به");

  const claims = await db.claim.count({
    where: { contractId: id, status: { in: ACTIVE_CLAIM_STATUSES } },
  });
  if (claims > 0) return jsonError("لا يمكن حذف العقد لوجود مطالبات سارية عليه");

  const subs = await db.subContract.count({ where: { contractId: id } });
  if (subs > 0) return jsonError("لا يمكن حذف العقد لوجود عقود باطن مرتبطة به");

  const planCount = await db.paymentPlanItem.count({ where: { contractId: id } });
  if (planCount > 0) return jsonError("لا يمكن حذف العقد لوجود دفعات في خطة السداد");

  const stagesCount = await db.contractStage.count({ where: { contractId: id } });
  if (stagesCount > 0) return jsonError("لا يمكن حذف العقد لوجود مراحل تنفيذ");

  await db.$transaction(async (tx) => {
    await tx.contractStage.deleteMany({ where: { contractId: id } });
    await tx.paymentPlanItem.deleteMany({ where: { contractId: id } });
    await tx.contract.delete({ where: { id } });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف",
      entityType: "contract",
      entityId: id,
      entityName: contract.contractNumber,
    });
  });
  return ok({ message: "تم حذف العقد" });
}
