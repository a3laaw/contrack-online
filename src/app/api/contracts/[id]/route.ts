import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok, parseDay, todayStr } from "@/lib/api-utils";
import { ACTIVE_CLAIM_STATUSES, intOr, loadContractCore } from "@/lib/contrack-server";
import { r3 } from "@/lib/contrack-core";
import { closeAmountSuffix } from "@/lib/contract-types-admin";
import { canTransition, transitionError } from "@/lib/lifecycle-transitions";
import { createEntityBackup } from "@/lib/backup-server";

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
 * - status عبر changeContractStatus داخليًا (status + statusReason + cancelCloseAmount عند ملغى + cancelledAt).
 * - contractType يُشتق منه اسم العقد (اسم العقد يتبع النوع — contract_hub.py:636).
 * - العملة وحقول الإشراف (supStartDate/supMonths/supMonthly/supDiscount) برسائل المكتبي الحرفية.
 */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const core = await loadContractCore(id);
  if (!core) return jsonError("العقد غير موجود", 404);

  // عقد الإشراف: التواريخ تُدار من تعهد الإشراف — يُستثنى من حرس ترتيب التواريخ
  const isSupContract = Boolean(core.sup) || (core.contract.supMonths ?? 0) > 0;

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
    if (!CONTRACT_STATUSES.includes(status)) return jsonError("حالة العقد غير صحيحة.");
    // G7 — حرس الانتقالات الموحدة (المكتبي TRANSITIONS): المسموح فقط، والملغى يُسترجع إلى نشط
    if (!canTransition("contract", oldStatus, status)) {
      return jsonError(transitionError("contract", oldStatus, status));
    }
    data.status = status;
    if (status === "ملغى") {
      data.cancelledAt = todayStr();
      data.statusReason = String(body.statusReason || body.cancelReason || "");
      // مبلغ إغلاق الإلغاء (contract_hub.py:735) — Decimal(18,3) لا يقبل السالب
      if (body.cancelCloseAmount !== undefined) {
        const cca = Number(body.cancelCloseAmount);
        if (!Number.isFinite(cca) || cca < 0) return jsonError("مبلغ الإغلاق لا يمكن أن يكون سالبًا.");
        data.cancelCloseAmount = r3(cca);
      }
    } else {
      data.cancelledAt = "";
      if (body.statusReason !== undefined) data.statusReason = String(body.statusReason);
    }
    statusChanged = true;
  } else if (body.statusReason !== undefined) {
    data.statusReason = String(body.statusReason);
  }

  if (body.contractName !== undefined) data.contractName = String(body.contractName);
  // اسم العقد يتبع النوع المختار دائمًا — «غير محدد» يُبقي الاسم الحالي
  if (body.contractType !== undefined) {
    const ct = String(body.contractType).trim() || "غير محدد";
    data.contractType = ct;
    if (ct !== "غير محدد") {
      const t = await db.contractType.findFirst({ where: { name: ct }, select: { name: true } });
      if (t) data.contractName = t.name;
    }
  }
  if (body.description !== undefined) data.description = String(body.description);
  if (body.notes !== undefined) data.notes = String(body.notes);
  // العملة — نص قصير، الفراغ يعود لـ«د.ك» (contract_hub.py:674)
  if (body.currency !== undefined) data.currency = String(body.currency).trim() || "د.ك";

  // حقول الإشراف (contract_hub.py:649–669) — المدة 0–120 (الصفر = لا تعهد)
  let effSupMonths = core.contract.supMonths ?? 0;
  let effSupMonthly = Number(core.contract.supMonthly ?? 0);
  if (body.supStartDate !== undefined) data.supStartDate = parseDay(body.supStartDate);
  if (body.supMonths !== undefined) {
    const m = Math.min(120, Math.max(0, intOr(body.supMonths, 0)));
    data.supMonths = m;
    effSupMonths = m;
  }
  if (body.supMonthly !== undefined) {
    const v = Number(body.supMonthly);
    if (!Number.isFinite(v) || v < 0) return jsonError("المبلغ لا يمكن أن يكون سالبًا.");
    data.supMonthly = r3(v);
    effSupMonthly = r3(v);
  }
  if (body.supDiscount !== undefined) {
    const v = Number(body.supDiscount);
    if (!Number.isFinite(v) || v < 0) return jsonError("المبلغ لا يمكن أن يكون سالبًا.");
    data.supDiscount = r3(v);
  }
  if (effSupMonths > 0 && effSupMonthly <= 0) {
    return jsonError("قيمة الشهر يجب أن تكون أكبر من صفر.");
  }

  for (const f of ["contractDate", "startDate", "endDate", "signDate"] as const) {
    if (body[f] !== undefined) {
      const d = parseDay(body[f]);
      if (!d) return jsonError(`تاريخ غير صالح: ${f}`);
      data[f] = d;
    }
  }
  // حرس ترتيب التواريخ (lifecycle_service.py:199) — على القيم الفعلية بعد التعديل
  // ويُستثنى لعقود الإشراف (تواريخها تُدار من تعهد الإشراف — contract_hub.py:740)
  if (!isSupContract) {
    const effStart = (data.startDate as string | undefined) ?? core.contract.startDate ?? "";
    const effEnd = (data.endDate as string | undefined) ?? core.contract.endDate ?? "";
    if (effStart && effEnd && effEnd <= effStart) {
      return jsonError("تاريخ نهاية العقد يجب أن يكون بعد تاريخ البداية.");
    }
  }

  const updated = await db.$transaction(async (tx) => {
    // G7 — نسخة احتياطية كاملة قبل الإلغاء (المكتبي _create_backup) — الأرشفة لا تحذف
    if (statusChanged && String(data.status) === "ملغى") {
      await createEntityBackup(tx, "contract", id, guard.user.username);
    }
    const contract = await tx.contract.update({ where: { id }, data });
    if (statusChanged) {
      const newStatus = String(data.status);
      await tx.contractEvent.create({
        data: {
          contractId: id,
          eventType: "تغيير حالة العقد",
          description: `الحالة: ${oldStatus} ← ${newStatus}${data.statusReason ? ` — السبب: ${String(data.statusReason)}` : ""}${closeAmountSuffix(Number(data.cancelCloseAmount ?? 0))}`,
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
