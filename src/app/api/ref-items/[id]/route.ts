import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";
import { mapRefItem, parseStageIds, refItemInclude } from "@/lib/ref-lists-shared";

type P = { params: Promise<{ id: string }> };

/**
 * تعديل بند مرجعي (الاسم/الرمز/القيمة/الملاحظات/التفعيل) — وروابط المراحل
 * تُستبدل ككتلة (deleteMany ثم createMany داخل معاملة) إن وردت في الطلب.
 */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const id = Number((await params).id);
  if (!Number.isInteger(id)) return jsonError("معرّف غير صحيح");
  const item = await db.refItem.findFirst({ where: { id } });
  if (!item) return jsonError("البند غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: { name?: string; code?: string; value?: number | null; notes?: string; active?: boolean } = {};
  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) return jsonError("اسم البند مطلوب");
    if (name.length > 120) return jsonError("اسم البند طويل جدًا (120 حرفًا كحد أقصى)");
    const dup = await db.refItem.findFirst({ where: { listId: item.listId, name, id: { not: id } } });
    if (dup) return jsonError("البند موجود مسبقًا في هذه القائمة");
    data.name = name;
  }
  if (body.code !== undefined) data.code = String(body.code || "").trim().slice(0, 40);
  if (body.notes !== undefined) data.notes = String(body.notes || "").trim().slice(0, 300);
  if (body.active !== undefined) data.active = Boolean(body.active);
  if (body.value !== undefined) {
    if (body.value === null || String(body.value).trim() === "") data.value = null;
    else {
      const v = Number(body.value);
      if (!Number.isFinite(v)) return jsonError("القيمة يجب أن تكون رقمًا");
      data.value = v;
    }
  }

  const stageIds = body.stageIds !== undefined ? parseStageIds(body.stageIds) : null;
  if (stageIds && stageIds.length > 0) {
    const stages = await db.workflowStage.findMany({ where: { id: { in: stageIds } }, select: { id: true } });
    if (stages.length !== stageIds.length) return jsonError("إحدى المراحل المختارة غير موجودة");
  }

  await db.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) await tx.refItem.update({ where: { id }, data });
    if (stageIds) {
      // استبدال كتلة الروابط — الحذف محصور بالبند نفسه ثم حقن companyId لكل صف جديد
      await tx.refItemStage.deleteMany({ where: { itemId: id } });
      if (stageIds.length > 0) {
        await tx.refItemStage.createMany({ data: stageIds.map((stageId) => ({ itemId: id, stageId })) });
      }
    }
  });

  await audit(db, {
    username: guard.user.username,
    action: "تعديل",
    entityType: "refItem",
    entityId: id,
    entityName: data.name ?? item.name,
  });

  const full = await db.refItem.findFirst({ where: { id }, include: refItemInclude });
  return ok({ item: full ? mapRefItem(full) : null });
}

/** حذف بند — بلا سجلات تعتمد عليه بعد (مرآة حذف بنود القوائم) فحذف قاطع بروابطه (Cascade) */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const id = Number((await params).id);
  if (!Number.isInteger(id)) return jsonError("معرّف غير صحيح");
  const item = await db.refItem.findFirst({ where: { id } });
  if (!item) return jsonError("البند غير موجود", 404);

  await db.refItem.delete({ where: { id } });
  await audit(db, {
    username: guard.user.username,
    action: "حذف",
    entityType: "refItem",
    entityId: id,
    entityName: item.name,
  });
  return ok({ message: "تم حذف البند" });
}
