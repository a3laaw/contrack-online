import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";
import { mapRefItem, parseStageIds, resolveRefParent, refItemInclude, withChildrenCount } from "@/lib/ref-lists-shared";

type P = { params: Promise<{ id: string }> };

/**
 * تعديل بند مرجعي (الاسم/الرمز/القيمة/الملاحظات/التفعيل) — وروابط المراحل
 * تُستبدل ككتلة (deleteMany ثم createMany داخل معاملة) إن وردت في الطلب.
 * + الهيكل التنظيمي (org-structure-design D1): parentId عند وروده —
 *   null = فك الارتباط، رقم = ربط بعد تحقق نوع الأب (قسم←إدارة / وظيفة←قسم).
 */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const id = Number((await params).id);
  if (!Number.isInteger(id)) return jsonError("معرّف غير صحيح");
  const item = await db.refItem.findFirst({ where: { id }, include: { list: { select: { key: true } } } });
  if (!item) return jsonError("البند غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: { name?: string; code?: string; value?: number | null; notes?: string; active?: boolean; parentId?: number | null } = {};
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

  // الهيكل التنظيمي — undefined = لا تغيير، null = فك الارتباط، رقم = ربط (بتحقق نوع الأب)
  if (body.parentId !== undefined) {
    const rp = await resolveRefParent(body.parentId, item.list.key, id);
    if (typeof rp === "string") return jsonError(rp);
    data.parentId = rp.parentId;
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
  return ok({ item: full ? mapRefItem(withChildrenCount(full)) : null });
}

/** حذف بند — بحارس الهيكل التنظيمي (D2): بند عليه أبناء مرتبطون لا يُحذف حتى يُفك ارتباطهم،
 *  وRestrict على FK حارس أخير. خارج ذلك حذف قاطع بروابطه (Cascade) كما هو. */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const id = Number((await params).id);
  if (!Number.isInteger(id)) return jsonError("معرّف غير صحيح");
  const item = await db.refItem.findFirst({ where: { id } });
  if (!item) return jsonError("البند غير موجود", 404);

  const childrenCount = await db.refItem.count({ where: { parentId: id } });
  if (childrenCount > 0) {
    return jsonError(
      `لا يمكن الحذف — البند عليه ${childrenCount} بند مرتبط (أقسام/وظائف). فُكّ ارتباطها أولًا`
    );
  }

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
