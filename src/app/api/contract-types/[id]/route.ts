import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";
import { numOr } from "@/lib/contrack-server";

type P = { params: Promise<{ id: string }> };

const PRICING_MODES = ["lump", "unit", "items", "bundle"];

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
    if (!newName) return jsonError("اسم نوع العقد مطلوب");
    if (newName !== type.name) {
      const exists = await db.contractType.findUnique({ where: { name: newName } });
      if (exists) return jsonError("اسم نوع العقد موجود مسبقًا");
      data.name = newName;
    }
  }
  if (body.defaultAmount !== undefined) data.defaultAmount = numOr(body.defaultAmount, 0);
  if (body.notes !== undefined) data.notes = String(body.notes || "");
  if (body.active !== undefined) data.active = Boolean(body.active);
  if (body.manualTrack !== undefined) data.manualTrack = Boolean(body.manualTrack);
  if (body.unitLabel !== undefined) data.unitLabel = String(body.unitLabel || "");
  if (body.unitPrice !== undefined) data.unitPrice = numOr(body.unitPrice, 0);
  if (body.pricingMode !== undefined) {
    const mode = String(body.pricingMode);
    if (!PRICING_MODES.includes(mode)) return jsonError("نمط التسعير غير صحيح");
    const isSup = body.isSupervision !== undefined ? Boolean(body.isSupervision) : type.isSupervision;
    if (mode === "bundle" && isSup) return jsonError("النوع الشامل لا يكون إشرافيًا");
    data.pricingMode = mode;
  }
  if (body.isSupervision !== undefined) {
    const mode = (data.pricingMode as string) || type.pricingMode;
    if (mode === "bundle" && Boolean(body.isSupervision)) return jsonError("النوع الشامل لا يكون إشرافيًا");
    data.isSupervision = Boolean(body.isSupervision);
  }

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

/** حذف نوع — ممنوع إن استُخدم في عقود لغير المطور */
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
    return jsonError("لا يمكن حذف نوع عقود مستخدم في عقود — متاح للمطور فقط");
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
