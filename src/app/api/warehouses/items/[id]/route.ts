// PATCH/DELETE /api/warehouses/items/[id] — تعديل صنف / حذف (ذو حركة لا يُحذف — تعطيل فقط)
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { r3 } from "@/lib/warehouses-constants";

type P = { params: Promise<{ id: string }> };

/** PATCH: تعديل اسم/وحدة/فئة/حد أدنى/ملاحظة/تفعيل */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_warehouses");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "warehouses", "المخازن");
  if (mg) return mg;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) return jsonError("معرّف غير صالح");
  const item = await db.stockItem.findFirst({ where: { id }, select: { id: true, name: true } });
  if (!item) return jsonError("الصنف غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: { name?: string; unit?: string; category?: string; notes?: string; active?: boolean; minQty?: number } = {};
  if (body.name != null) {
    const name = String(body.name).trim();
    if (!name) return jsonError("اسم الصنف مطلوب");
    const dup = await db.stockItem.findFirst({ where: { name, id: { not: id } }, select: { id: true } });
    if (dup) return jsonError("يوجد صنف بهذا الاسم بالفعل");
    data.name = name;
  }
  if (body.unit != null) data.unit = String(body.unit).trim();
  if (body.category != null) data.category = String(body.category).trim();
  if (body.notes != null) data.notes = String(body.notes).trim();
  if (typeof body.active === "boolean") data.active = body.active;
  if (body.minQty != null) {
    const minQty = Number(body.minQty);
    if (!Number.isFinite(minQty) || minQty < 0) return jsonError("الحد الأدنى لا يقبل السالب");
    data.minQty = r3(minQty);
  }

  const updated = await db.stockItem.update({ where: { id }, data });
  await audit(db, {
    username: guard.user.username,
    action: "تعديل",
    entityType: "stock_item",
    entityId: id,
    entityName: updated.name,
  });
  return ok({ item: updated });
}

/** DELETE: حذف صنف — ممنوع إن له حركة (رسالة عربية، التعطيل هو البديل) */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_warehouses");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "warehouses", "المخازن");
  if (mg) return mg;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) return jsonError("معرّف غير صالح");
  const item = await db.stockItem.findFirst({
    where: { id },
    select: { id: true, name: true, _count: { select: { docLines: true } } },
  });
  if (!item) return jsonError("الصنف غير موجود", 404);
  if (item._count.docLines > 0) {
    return jsonError(`الصنف «${item.name}» له حركة مخزنية مسجلة — لا يُحذف؛ عطّله بدلًا من الحذف`);
  }

  await db.stockItem.delete({ where: { id } });
  await audit(db, {
    username: guard.user.username,
    action: "حذف",
    entityType: "stock_item",
    entityId: id,
    entityName: item.name,
  });
  return ok({ ok: true });
}
