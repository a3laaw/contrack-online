import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";

type P = { params: Promise<{ id: string }> };

/**
 * تعديل قائمة مرجعية (الاسم/الوصف/التفعيل) — القوائم المدمجة تعدل بنودها
 * ويُحفظ اسمها ووصفها كما هي، أما مفتاحها الثابت فلا يُعرض ولا يُعدل أبدًا.
 */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const id = Number((await params).id);
  if (!Number.isInteger(id)) return jsonError("معرّف غير صحيح");
  const list = await db.refList.findFirst({ where: { id } });
  if (!list) return jsonError("القائمة غير موجودة", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: { name?: string; description?: string; active?: boolean } = {};
  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) return jsonError("اسم القائمة مطلوب");
    if (name.length > 60) return jsonError("اسم القائمة طويل جدًا (60 حرفًا كحد أقصى)");
    const dup = await db.refList.findFirst({ where: { name, id: { not: id } } });
    if (dup) return jsonError("توجد قائمة بهذا الاسم مسبقًا");
    data.name = name;
  }
  if (body.description !== undefined) data.description = String(body.description || "").trim().slice(0, 200);
  if (body.active !== undefined) data.active = Boolean(body.active);
  if (Object.keys(data).length === 0) return jsonError("لا تغييرات");

  await db.refList.update({ where: { id }, data });
  await audit(db, {
    username: guard.user.username,
    action: "تعديل",
    entityType: "refList",
    entityId: id,
    entityName: data.name ?? list.name,
  });
  return ok({ message: "تم تعديل القائمة" });
}

/** حذف قائمة — المدمجة (system) لا تُحذف أبدًا؛ المخصصة تُحذف ببنودها وروابطها (Cascade) */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const id = Number((await params).id);
  if (!Number.isInteger(id)) return jsonError("معرّف غير صحيح");
  const list = await db.refList.findFirst({ where: { id } });
  if (!list) return jsonError("القائمة غير موجودة", 404);
  if (list.system) return jsonError("القوائم المدمجة لا تُحذف — عدّل بنودها أو أنشئ قائمة مخصصة");

  await db.refList.delete({ where: { id } });
  await audit(db, {
    username: guard.user.username,
    action: "حذف",
    entityType: "refList",
    entityId: id,
    entityName: list.name,
  });
  return ok({ message: "تم حذف القائمة ببنودها" });
}
