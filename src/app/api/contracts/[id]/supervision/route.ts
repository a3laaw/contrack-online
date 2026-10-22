import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok, parseDay, todayStr } from "@/lib/api-utils";
import { EPS, isSupervision, r3, supervisionStatus } from "@/lib/contrack-core";
import { loadContractCore, numOr } from "@/lib/contrack-server";

type P = { params: Promise<{ id: string }> };

/** حالة الإشراف الكاملة (supervisionStatus) مع actualEnd من مرحلة «إنهاء إشراف» */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const core = await loadContractCore(contractId);
  if (!core) return jsonError("العقد غير موجود", 404);
  const c = core.contract;

  return ok({
    isSupervision: Boolean(core.sup),
    supStartDate: c.supStartDate,
    supMonths: c.supMonths,
    supMonthly: Number(c.supMonthly),
    supDiscount: Number(c.supDiscount),
    supWaivedMonths: Number(c.supWaivedMonths),
    supWaiveReason: c.supWaiveReason,
    actualEnd: core.actualEnd,
    sup: core.sup,
  });
}

/**
 * ضبط الإشراف: {supStartDate, supMonths, supMonthly, supDiscount}
 * إن كان العقد إشرافيًا من نوعه: amount = max(0, months×monthly − discount) — touch_amount (مسموح هنا فقط)
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const supStartDate = parseDay(body.supStartDate);
  if (!supStartDate) return jsonError("تاريخ بداية الإشراف مطلوب بصيغة YYYY-MM-DD");
  const supMonths = Math.trunc(Number(body.supMonths) || 0);
  if (!(supMonths > 0)) return jsonError("عدد أشهر الإشراف يجب أن يكون أكبر من صفر");
  const supMonthly = numOr(body.supMonthly, 0);
  if (!(supMonthly > 0)) return jsonError("القيمة الشهرية للإشراف يجب أن تكون أكبر من صفر");
  const supDiscount = numOr(body.supDiscount, 0);
  const gross = r3(supMonths * supMonthly);
  if (supDiscount > gross + EPS) return jsonError("الخصم يتجاوز قيمة الإشراف");

  // العقد إشرافي من نوعه؟
  const type = await db.contractType.findFirst({ where: { name: contract.contractType } });
  const touchAmount = Boolean(type?.isSupervision);

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.contract.update({
      where: { id: contractId },
      data: {
        supStartDate,
        supMonths,
        supMonthly,
        supDiscount,
        ...(touchAmount ? { amount: Math.max(0, gross - supDiscount) } : {}),
      },
    });
    await tx.contractEvent.create({
      data: {
        contractId,
        eventType: "ضبط الإشراف الهندسي",
        description: `إشراف: ${supMonths} شهر × ${supMonthly}${supDiscount ? ` − خصم ${supDiscount}` : ""}${touchAmount ? " (تم تحديث قيمة العقد)" : ""}`,
        username: guard.user.username,
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "ضبط إشراف",
      entityType: "contract",
      entityId: contractId,
      entityName: contract.contractNumber,
    });
    return row;
  });
  return ok({
    message: "تم ضبط الإشراف الهندسي",
    amount: Number(updated.amount),
    touchAmount,
  });
}

/** تنازل عن أشهر تمديد: {months, reason} — بشرط months ≤ unpaidExtMonths */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const core = await loadContractCore(contractId);
  if (!core) return jsonError("العقد غير موجود", 404);
  const supContract = {
    id: contractId,
    supStartDate: core.contract.supStartDate,
    supMonths: core.contract.supMonths,
    supMonthly: Number(core.contract.supMonthly),
    supDiscount: Number(core.contract.supDiscount),
    supWaivedMonths: Number(core.contract.supWaivedMonths),
  };
  if (!isSupervision(supContract)) return jsonError("العقد ليس إشرافيًا");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const months = Number(body.months);
  if (!Number.isFinite(months) || !(months > 0)) return jsonError("عدد أشهر التنازل غير صالح");
  const reason = String(body.reason || "").trim();
  const unpaid = core.sup ? core.sup.unpaidExtMonths : 0;
  if (months > r3(unpaid + EPS)) {
    return jsonError(`لا يمكن التنازل عن أكثر من التمديد غير المدفوع: ${unpaid}`);
  }

  const c = core.contract;
  const newWaived = r3(Number(c.supWaivedMonths) + months);
  const line = `تنازل ${months} شهر بتاريخ ${todayStr()}${reason ? `: ${reason}` : ""}`;
  const supWaiveReason = c.supWaiveReason ? `${c.supWaiveReason}\n${line}` : line;

  await db.$transaction(async (tx) => {
    await tx.contract.update({
      where: { id: contractId },
      data: { supWaivedMonths: newWaived, supWaiveReason },
    });
    await tx.contractEvent.create({
      data: {
        contractId,
        eventType: "تنازل عن تمديد إشراف",
        description: line,
        username: guard.user.username,
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "تنازل تمديد",
      entityType: "contract",
      entityId: contractId,
      entityName: c.contractNumber,
      reason: line,
    });
  });
  return ok({
    message: `تم التنازل عن ${months} شهر من التمديد`,
    supWaivedMonths: newWaived,
    supWaiveReason,
  });
}

/** إزالة ضبط الإشراف بالكامل (تصفير حقول الإشراف — بلا سندات قبض سارية) */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const core = await loadContractCore(contractId);
  if (!core) return jsonError("العقد غير موجود", 404);
  const supContractDel = {
    id: contractId,
    supStartDate: core.contract.supStartDate,
    supMonths: core.contract.supMonths,
    supMonthly: Number(core.contract.supMonthly),
    supDiscount: Number(core.contract.supDiscount),
    supWaivedMonths: Number(core.contract.supWaivedMonths),
  };
  if (!isSupervision(supContractDel)) return jsonError("العقد ليس إشرافيًا");
  if (core.receipts.length > 0) {
    return jsonError("لا يمكن إزالة الإشراف بعد وجود سندات قبض على العقد");
  }

  await db.$transaction(async (tx) => {
    await tx.contract.update({
      where: { id: contractId },
      data: {
        supStartDate: "",
        supMonths: 0,
        supMonthly: 0,
        supDiscount: 0,
        supWaivedMonths: 0,
        supWaiveReason: "",
      },
    });
    await tx.contractEvent.create({
      data: {
        contractId,
        eventType: "إزالة الإشراف الهندسي",
        description: "تمت إزالة ضبط الإشراف من العقد",
        username: guard.user.username,
      },
    });
  });
  return ok({ message: "تمت إزالة الإشراف" });
}
