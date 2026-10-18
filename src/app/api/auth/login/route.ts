import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  hashPassword,
  verifyPassword,
  issueToken,
  sessionCookieOptionsFor,
  SESSION_COOKIE,
} from "@/lib/auth";
import { audit, jsonError, ok } from "@/lib/api-utils";
import { ensureSeedData } from "@/lib/seed-defaults";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) return jsonError("أدخل اسم المستخدم وكلمة المرور");

  // بذرة أول تشغيل: إن كان جدول users فارغًا أنشئ admin/admin و secretary/123456
  const usersCount = await db.user.count();
  if (usersCount === 0) {
    const admin = hashPassword("admin");
    const secretary = hashPassword("123456");
    await db.user.createMany({
      data: [
        {
          username: "admin",
          passwordHash: admin.hash,
          salt: admin.salt,
          role: "admin",
          fullName: "مدير النظام",
          jobTitle: "مدير",
        },
        {
          username: "secretary",
          passwordHash: secretary.hash,
          salt: secretary.salt,
          role: "secretary",
          fullName: "سكرتير",
          jobTitle: "سكرتير",
        },
      ],
    });
  }

  // بذر البيانات المرجعية الافتراضية (أساليب دفع/حسابات/مراحل/أنواع) — عديم التكرار
  try {
    await ensureSeedData();
  } catch (e) {
    console.error("seed error", e);
  }

  const user = await db.user.findUnique({ where: { username } });
  if (!user || !user.active || !verifyPassword(password, user.salt, user.passwordHash)) {
    return jsonError("اسم المستخدم أو كلمة المرور غير صحيحة", 401);
  }

  const token = issueToken(user.id);
  const res = ok({
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      fullName: user.fullName || user.username,
      jobTitle: user.jobTitle || "",
    },
    token,
  });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptionsFor(req));
  await audit(db, {
    username: user.username,
    action: "دخول",
    entityType: "auth",
    entityId: user.id,
    entityName: user.username,
  });
  return res;
}
