import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";

/** تغيير كلمة مروري: {oldPassword, newPassword} — الجديدة ≥ 6 أحرف */
export async function PATCH(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as {
    oldPassword?: string;
    newPassword?: string;
  };
  const oldPassword = String(body.oldPassword || "");
  const newPassword = String(body.newPassword || "");

  const row = await db.user.findUnique({ where: { id: guard.user.id } });
  if (!row) return jsonError("المستخدم غير موجود", 404);
  if (!oldPassword || !verifyPassword(oldPassword, row.salt, row.passwordHash)) {
    return jsonError("كلمة المرور الحالية غير صحيحة");
  }
  if (newPassword.length < 6) {
    return jsonError("كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل");
  }
  const h = hashPassword(newPassword);
  await db.user.update({
    where: { id: row.id },
    data: { passwordHash: h.hash, salt: h.salt },
  });
  await audit(db, {
    username: guard.user.username,
    action: "تغيير كلمة المرور",
    entityType: "user",
    entityId: row.id,
    entityName: row.username,
  });
  return ok({ message: "تم تغيير كلمة المرور بنجاح" });
}
