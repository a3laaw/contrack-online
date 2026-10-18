import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, isSuperRole } from "@/lib/auth";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";

type P = { params: Promise<{ id: string }> };

/** تعديل مستخدم: {password?, fullName?, jobTitle?, role?, active?} */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const target = await db.user.findUnique({ where: { id } });
  if (!target) return jsonError("المستخدم غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as {
    password?: string;
    fullName?: string;
    jobTitle?: string;
    role?: string;
    active?: boolean;
  };

  const data: {
    passwordHash?: string;
    salt?: string;
    fullName?: string;
    jobTitle?: string;
    role?: string;
    active?: boolean;
  } = {};

  if (body.password !== undefined && body.password !== "") {
    if (String(body.password).length < 6) {
      return jsonError("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
    }
    const h = hashPassword(String(body.password));
    data.passwordHash = h.hash;
    data.salt = h.salt;
  }
  if (body.fullName !== undefined) data.fullName = String(body.fullName);
  if (body.jobTitle !== undefined) data.jobTitle = String(body.jobTitle);
  if (body.role !== undefined) {
    if (body.role !== "admin" && body.role !== "secretary") {
      return jsonError("الدور غير صحيح (admin أو secretary)");
    }
    // منع إزالة صلاحية آخر مدير
    if (isSuperRole(target.role) && !isSuperRole(body.role)) {
      const supers = await db.user.count({ where: { role: { in: ["admin", "developer"] }, active: true, id: { not: target.id } } });
      if (supers === 0) return jsonError("لا يمكن إزالة صلاحية آخر مدير في النظام");
    }
    data.role = body.role;
  }
  if (body.active !== undefined) {
    if (!body.active && target.id === guard.user.id) return jsonError("لا يمكنك إيقاف حسابك الحالي");
    // منع إيقاف آخر مدير
    if (!body.active && isSuperRole(target.role) && target.active) {
      const supers = await db.user.count({ where: { role: { in: ["admin", "developer"] }, active: true, id: { not: target.id } } });
      if (supers === 0) return jsonError("لا يمكن إيقاف آخر مدير في النظام");
    }
    data.active = Boolean(body.active);
  }

  const user = await db.user.update({
    where: { id },
    data,
    select: { id: true, username: true, role: true, fullName: true, jobTitle: true, active: true },
  });
  await audit(db, {
    username: guard.user.username,
    action: "تعديل",
    entityType: "user",
    entityId: id,
    entityName: target.username,
  });
  return ok({ user });
}

/** حذف مستخدم — منع حذف نفسك وآخر مدير */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const target = await db.user.findUnique({ where: { id } });
  if (!target) return jsonError("المستخدم غير موجود", 404);
  if (target.id === guard.user.id) return jsonError("لا يمكنك حذف حسابك الحالي");
  if (isSuperRole(target.role)) {
    const supers = await db.user.count({ where: { role: { in: ["admin", "developer"] }, active: true, id: { not: target.id } } });
    if (supers === 0) return jsonError("لا يمكن حذف آخر مدير في النظام");
  }

  await db.user.delete({ where: { id } });
  await audit(db, {
    username: guard.user.username,
    action: "حذف",
    entityType: "user",
    entityId: id,
    entityName: target.username,
  });
  return ok({ message: "تم حذف المستخدم" });
}
