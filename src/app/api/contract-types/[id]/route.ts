import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";
import { numOr } from "@/lib/contrack-server";
import { r3 } from "@/lib/contrack-core";
import { PRICING_MODES, normalizeTypeCategory, validateTypeInput } from "@/lib/contract-types-admin";

type P = { params: Promise<{ id: string }> };

/** تعديل نوع عقد — تغيير الاسم ينعكس على العقود وقالب مراحل التنفيذ (ربط اسمي) */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const type = await db.contractType.findUnique({ where: { id } });
  if (!type) return jsonError("نوع العقد غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  let newName = type.name;

  if (body.name !== undefined) {
    newName = String(body.name).trim();
    if (!newName) return jsonError("اسم نوع العقد مطلوب.");
  }
  const effAmount = body.defaultAmount !== undefined ? r3(numOr(body.defaultAmount, 0)) : Number(type.defaultAmount);
  const effUnitPrice = body.unitPrice !== undefined ? r3(numOr(body.unitPrice, 0)) : Number(type.unitPrice);
  const effMode = body.pricingMode !== undefined ? String(body.pricingMode) : type.pricingMode;
  const effSup = body.isSupervision !== undefined ? Boolean(body.isSupervision) : type.isSupervision;

  // حرس المكتبي على القيم الناتجة كاملة (update_type) — الاسم ← المبلغ ← سعر الوحدة ← الشامل/الإشرافي
  const guardError = validateTypeInput({
    name: newName,
    defaultAmount: effAmount,
    unitPrice: effUnitPrice,
    pricingMode: effMode,
    isSupervision: effSup,
  });
  if (guardError) return jsonError(guardError);
  if (!PRICING_MODES.some((m) => m.value === effMode)) return jsonError("نمط التسعير غير صحيح");

  if (body.name !== undefined && newName !== type.name) {
    const exists = await db.contractType.findFirst({ where: { name: newName } });
    if (exists) return jsonError(`النوع «${newName}» موجود بالفعل.`);
    data.name = newName;
  }
  if (body.defaultAmount !== undefined) data.defaultAmount = effAmount;
  if (body.notes !== undefined) data.notes = String(body.notes || "");
  if (body.active !== undefined) data.active = Boolean(body.active);
  if (body.manualTrack !== undefined) data.manualTrack = Boolean(body.manualTrack);
  if (body.unitLabel !== undefined) data.unitLabel = String(body.unitLabel || "").trim();
  if (body.unitPrice !== undefined) data.unitPrice = effUnitPrice;
  if (body.pricingMode !== undefined) data.pricingMode = effMode;
  if (body.isSupervision !== undefined) data.isSupervision = effSup;
  // Task 95 — التصنيف من القائمة المشتقة (تطبيع وحصر طول)
  if (body.category !== undefined) data.category = normalizeTypeCategory(body.category);

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.contractType.update({ where: { id }, data });
    if (newName !== type.name) {
      await tx.contract.updateMany({ where: { contractType: type.name }, data: { contractType: newName } });
      await tx.workflowStage.updateMany({ where: { contractType: type.name }, data: { contractType: newName } });
    }
    await audit(tx, {
      username: guard.user.username,
      action: "تعديل",
      entityType: "contractType",
      entityId: id,
      entityName: row.name,
    });
    return row;
  });
  return ok({ type: { ...updated, defaultAmount: Number(updated.defaultAmount), unitPrice: Number(updated.unitPrice) } });
}

/** حذف نوع — ممنوع إن استُخدم في عقود لغير المطور (رسالة المكتبي الحرفية) */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const type = await db.contractType.findUnique({ where: { id } });
  if (!type) return jsonError("نوع العقد غير موجود", 404);

  const used = await db.contract.count({ where: { contractType: type.name } });
  if (used > 0 && guard.user.role !== "developer") {
    return jsonError(`لا يمكن حذف «${type.name}» لأنه مستخدم في ${used} عقد. يمكنك تعطيله بدل حذفه.`);
  }

  await db.$transaction(async (tx) => {
    await tx.typeBundleComponent.deleteMany({ where: { componentTypeId: id } });
    await tx.contractType.delete({ where: { id } }); // قوالب الدفعات cascade
    await audit(tx, {
      username: guard.user.username,
      action: "حذف",
      entityType: "contractType",
      entityId: id,
      entityName: type.name,
      reason: used > 0 ? `كان مستخدمًا في ${used} عقد (مطور)` : "",
    });
  });
  return ok({ message: "تم حذف نوع العقد" });
}
