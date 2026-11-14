import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";
import { mapRefItem, parseStageIds, resolveRefParent, refItemInclude, withChildrenCount } from "@/lib/ref-lists-shared";

type P = { params: Promise<{ id: string }> };

/**
 * إضافة بند لقائمة مرجعية — الاسم مطلوب وفريد ضمن القائمة،
 * والقيمة عشرية اختيارية (الأوزان 0.30 وغيرها)، وروابط المراحل تُنشأ
 * بcreateMany منفصلة ليحقن الغلاف companyId لكل صف (لا nested create).
 * + الهيكل التنظيمي: parentId اختياري — قسم←إدارة / وظيفة←قسم (org-structure-design D1).
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const listId = Number((await params).id);
  if (!Number.isInteger(listId)) return jsonError("معرّف غير صحيح");
  const list = await db.refList.findFirst({ where: { id: listId } });
  if (!list) return jsonError("القائمة غير موجودة", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name || "").trim();
  if (!name) return jsonError("اسم البند مطلوب");
  if (name.length > 120) return jsonError("اسم البند طويل جدًا (120 حرفًا كحد أقصى)");
  const code = String(body.code || "").trim().slice(0, 40);
  const notes = String(body.notes || "").trim().slice(0, 300);

  let value: number | null = null;
  if (body.value !== undefined && body.value !== null && String(body.value).trim() !== "") {
    const v = Number(body.value);
    if (!Number.isFinite(v)) return jsonError("القيمة يجب أن تكون رقمًا");
    value = v;
  }

  const dup = await db.refItem.findFirst({ where: { listId, name } });
  if (dup) return jsonError("البند موجود مسبقًا في هذه القائمة");

  // الهيكل التنظيمي — أب اختياري بنوع قائمة صحيح (قسم←إدارة / وظيفة←قسم)
  let parentId: number | null = null;
  if (body.parentId !== undefined && body.parentId !== null) {
    const rp = await resolveRefParent(body.parentId, list.key, null);
    if (typeof rp === "string") return jsonError(rp);
    parentId = rp.parentId;
  }

  // الترتيب: آخر القائمة — والحركة أعلى/أسفل تعيد الترقيم موحدًا
  const last = await db.refItem.findFirst({ where: { listId }, orderBy: { sortOrder: "desc" } });
  const sortOrder = (last?.sortOrder ?? 0) + 1;

  const created = await db.refItem.create({
    data: { listId, name, code, value: value ?? null, notes, sortOrder, parentId },
  });

  const stageIds = parseStageIds(body.stageIds);
  if (stageIds.length > 0) {
    const stages = await db.workflowStage.findMany({ where: { id: { in: stageIds } }, select: { id: true } });
    if (stages.length !== stageIds.length) return jsonError("إحدى المراحل المختارة غير موجودة");
    await db.refItemStage.createMany({
      data: stageIds.map((stageId) => ({ itemId: created.id, stageId })),
    });
  }

  await audit(db, {
    username: guard.user.username,
    action: "إنشاء",
    entityType: "refItem",
    entityId: created.id,
    entityName: `${list.name} — ${name}`,
  });

  const full = await db.refItem.findFirst({ where: { id: created.id }, include: refItemInclude });
  return ok({ item: full ? mapRefItem(withChildrenCount(full)) : null }, 201);
}
