// PATCH/DELETE /api/warehouses/warehouses/[id] — تعديل مستودع / حذف (ذو حركة لا يُحذف — تعطيل فقط)
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";

type P = { params: Promise<{ id: string }> };

/** PATCH: تعديل اسم/موقع/ملاحظة/تفعيل */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_warehouses");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "warehouses", "المخازن");
  if (mg) return mg;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) return jsonError("معرّف غير صالح");
  const warehouse = await db.warehouse.findFirst({ where: { id }, select: { id: true, name: true } });
  if (!warehouse) return jsonError("المستودع غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: { name?: string; location?: string; notes?: string; active?: boolean } = {};
  if (body.name != null) {
    const name = String(body.name).trim();
    if (!name) return jsonError("اسم المستودع مطلوب");
    const dup = await db.warehouse.findFirst({ where: { name, id: { not: id } }, select: { id: true } });
    if (dup) return jsonError("يوجد مستودع بهذا الاسم بالفعل");
    data.name = name;
  }
  if (body.location != null) data.location = String(body.location).trim();
  if (body.notes != null) data.notes = String(body.notes).trim();
  if (typeof body.active === "boolean") data.active = body.active;

  const updated = await db.warehouse.update({ where: { id }, data });
  await audit(db, {
    username: guard.user.username,
    action: "تعديل",
    entityType: "warehouse",
    entityId: id,
    entityName: updated.name,
  });
  return ok({ warehouse: updated });
}

/** DELETE: حذف مستودع — ممنوع إن له أذون (رسالة عربية، التعطيل هو البديل) */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_warehouses");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "warehouses", "المخازن");
  if (mg) return mg;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) return jsonError("معرّف غير صالح");
  const warehouse = await db.warehouse.findFirst({
    where: { id },
    select: { id: true, name: true, _count: { select: { sourceDocs: true, targetDocs: true } } },
  });
  if (!warehouse) return jsonError("المستودع غير موجود", 404);
  if (warehouse._count.sourceDocs > 0 || warehouse._count.targetDocs > 0) {
    return jsonError(`المستودع «${warehouse.name}» له أذون مسجلة — لا يُحذف؛ عطّله بدلًا من الحذف`);
  }

  await db.warehouse.delete({ where: { id } });
  await audit(db, {
    username: guard.user.username,
    action: "حذف",
    entityType: "warehouse",
    entityId: id,
    entityName: warehouse.name,
  });
  return ok({ ok: true });
}
