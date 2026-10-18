import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";

type P = { params: Promise<{ id: string }> };

/** تعديل موظف زيارات (اسم/هاتف/ترتيب/تفعيل) — التعطيل هو البديل الآمن للحذف إن له زيارات */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_visits");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const staff = await db.visitStaff.findUnique({ where: { id } });
  if (!staff) return jsonError("الموظف غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: { name?: string; phone?: string; sort?: number; active?: boolean } = {};

  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) return jsonError("اسم الموظف مطلوب");
    data.name = name;
  }
  if (body.phone !== undefined) data.phone = String(body.phone || "");
  if (body.sort !== undefined) {
    const n = Number(body.sort);
    if (!Number.isFinite(n)) return jsonError("الترتيب يجب أن يكون رقمًا");
    data.sort = Math.floor(n);
  }
  if (body.active !== undefined) data.active = Boolean(body.active);

  await db.$transaction(async (tx) => {
    await tx.visitStaff.update({ where: { id }, data });
    await audit(tx, {
      username: guard.user.username,
      action: data.active === false ? "تعطيل" : "تعديل",
      entityType: "visit_staff",
      entityId: id,
      entityName: data.name || staff.name,
    });
  });

  return ok({ updated: true });
}

/** حذف موظف — المسموح فقط إن لم تُسجَّل له أي زيارات (كالمصدر: المستخدم يُعطَّل لا يُحذف) */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_visits");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const staff = await db.visitStaff.findUnique({ where: { id }, include: { visits: { select: { id: true } } } });
  if (!staff) return jsonError("الموظف غير موجود", 404);

  if (staff.visits.length > 0) {
    return jsonError("لا يمكن حذف موظف له زيارات مسجلة — يمكن تعطيله بدلًا من ذلك");
  }

  await db.$transaction(async (tx) => {
    await tx.visitStaff.delete({ where: { id } });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف",
      entityType: "visit_staff",
      entityId: id,
      entityName: staff.name,
    });
  });

  return ok({ deleted: true });
}
