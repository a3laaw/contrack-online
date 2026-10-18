import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, forbidden, jsonError, ok, parseDay } from "@/lib/api-utils";
import { isSuperRole } from "@/lib/auth";
import { COMMENT_KINDS, COMMENT_PRIORITIES, COMMENT_STATUSES } from "@/lib/comments-server";
import { nowStamp } from "@/lib/visits-server";

type P = { params: Promise<{ id: string }> };

/**
 * تعديل تعليق حسب action:
 * - meta  {status?, kind?, priority?, tags?, followupDate?} — لأي مستخدم (كالمصدر update_meta).
 * - body  {body} — للمدير فقط بلا مهلة، مع تسجيل editedAt/editor (وإلا 403).
 * - pin/unpin — للمدير فقط.
 */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const comment = await db.comment.findUnique({ where: { id } });
  if (!comment || comment.isDeleted) return jsonError("التعليق غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "").trim();

  // ===== تعديل بيانات المركز — لأي مستخدم =====
  if (action === "meta") {
    const data: { status?: string; kind?: string; priority?: string; tags?: string; followupDate?: string } = {};
    if (body.status !== undefined) {
      const status = String(body.status);
      if (!COMMENT_STATUSES.includes(status as (typeof COMMENT_STATUSES)[number])) return jsonError("حالة التعليق غير معروفة");
      data.status = status;
    }
    if (body.kind !== undefined) {
      const kind = String(body.kind);
      if (!COMMENT_KINDS.includes(kind as (typeof COMMENT_KINDS)[number])) return jsonError("نوع التعليق غير معروف");
      data.kind = kind;
    }
    if (body.priority !== undefined) {
      const priority = String(body.priority);
      if (!COMMENT_PRIORITIES.includes(priority as (typeof COMMENT_PRIORITIES)[number])) return jsonError("أولوية التعليق غير معروفة");
      data.priority = priority;
    }
    if (body.tags !== undefined) data.tags = String(body.tags || "").trim();
    if (body.followupDate !== undefined) {
      const v = body.followupDate === null || body.followupDate === "" ? "" : parseDay(body.followupDate);
      if (body.followupDate && !v) return jsonError("تاريخ المتابعة غير صالح — الصيغة YYYY-MM-DD");
      data.followupDate = v;
    }

    await db.$transaction(async (tx) => {
      await tx.comment.update({ where: { id }, data });
      await audit(tx, {
        username: guard.user.username,
        action: "تعديل بيانات تعليق",
        entityType: "comment",
        entityId: id,
        oldStatus: comment.status,
        newStatus: data.status || comment.status,
      });
    });
    return ok({ updated: true });
  }

  // ===== تعديل نص التعليق — للمدير فقط بلا مهلة (EDIT_WINDOW_MIN بقى أثرًا تاريخيًا) =====
  if (action === "body") {
    if (!isSuperRole(guard.user.role)) return forbidden("تعديل نص التعليق للمدير فقط");
    const text = String(body.body || "").trim();
    if (!text) return jsonError("نص التعليق مطلوب");
    if (text.length > 2000) return jsonError("نص التعليق يتجاوز 2000 حرف");

    const stamp = nowStamp();
    await db.$transaction(async (tx) => {
      await tx.comment.update({
        where: { id },
        data: { body: text, editedAt: stamp, editor: guard.user.username },
      });
      await audit(tx, {
        username: guard.user.username,
        action: "تعديل نص تعليق",
        entityType: "comment",
        entityId: id,
      });
    });
    return ok({ updated: true, editedAt: stamp, editor: guard.user.username });
  }

  // ===== التثبيت — للمدير فقط =====
  if (action === "pin" || action === "unpin") {
    if (!isSuperRole(guard.user.role)) return forbidden("التثبيت للمدير فقط");
    const pinned = action === "pin";
    await db.$transaction(async (tx) => {
      await tx.comment.update({ where: { id }, data: { pinned } });
      await audit(tx, {
        username: guard.user.username,
        action: pinned ? "تثبيت تعليق" : "إلغاء تثبيت تعليق",
        entityType: "comment",
        entityId: id,
      });
    });
    return ok({ updated: true, pinned });
  }

  return jsonError("إجراء غير معروف — الإجراءات المتاحة: meta|body|pin|unpin");
}

/**
 * حذف ناعم — لصاحب التعليق (createdBy = اسم الدخول الحالي) أو المدير فقط.
 * isDeleted + deletedAt + deleteReason + status='ملغى' (كالمصدر soft_delete).
 */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const comment = await db.comment.findUnique({
    where: { id },
    include: { customer: { select: { name: true } } },
  });
  if (!comment || comment.isDeleted) return jsonError("التعليق غير موجود", 404);

  const isOwner = comment.createdBy === guard.user.username;
  if (!isOwner && !isSuperRole(guard.user.role)) {
    return forbidden("حذف التعليق متاح لصاحبه أو المدير فقط");
  }

  const reason = (req.nextUrl.searchParams.get("reason") || "").trim() || "حذف بدون سبب";

  await db.$transaction(async (tx) => {
    await tx.comment.update({
      where: { id },
      data: { isDeleted: true, deletedAt: nowStamp(), deleteReason: reason, status: "ملغى" },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف تعليق",
      entityType: "comment",
      entityId: id,
      entityName: comment.customer?.name || "",
      reason,
    });
  });

  return ok({ deleted: true });
}
