import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  hashPassword,
  verifyPassword,
  issueToken,
  sessionCookieOptionsFor,
  SESSION_COOKIE,
} from "@/lib/auth";
import {
  MAX_ATTEMPTS,
  attemptKey,
  clearAttempts,
  clientIp,
  lockState,
  registerFailedAttempt,
} from "@/lib/login-rate-limit";
import { audit, jsonError, ok } from "@/lib/api-utils";
import { ensureSeedData } from "@/lib/seed-defaults";
import { permsForUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) return jsonError("أدخل اسم المستخدم وكلمة المرور");

  // المرحلة 2/أ — حدّ المحاولات من جهة الخادم (المستخدم + عنوان IP) بقفل مؤقت
  const ip = clientIp(req);
  const key = attemptKey(username, ip);
  const lock = lockState(key);
  if (lock.locked) {
    const mins = Math.max(1, Math.ceil(lock.retryAfterSec / 60));
    await audit(db, {
      username,
      action: "دخول مرفوض — قفل مؤقت",
      entityType: "auth",
      entityName: `${username} · ${ip}`,
    });
    return jsonError(
      `تم تجاوز عدد المحاولات المسموح بها (${MAX_ATTEMPTS}). الحساب مقفول مؤقتًا — حاول بعد ${mins} دقيقة.`,
      429
    );
  }

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
    // رسالة الفشل حرفية من المكتبي ui/login.py مع عدد المحاولات المتبقية
    const res = registerFailedAttempt(key);
    await audit(db, {
      username,
      action: "دخول فاشل",
      entityType: "auth",
      entityName: `${username} · ${ip}`,
    });
    if (res.lockedNow) {
      return jsonError(
        `تم تجاوز عدد المحاولات المسموح بها (${MAX_ATTEMPTS}). الحساب مقفول مؤقتًا — حاول بعد 15 دقيقة.`,
        429
      );
    }
    return jsonError(
      `اسم المستخدم أو كلمة المرور غير صحيحة. (متبقي ${res.remaining} محاولة)`,
      401
    );
  }

  clearAttempts(key);

  const token = issueToken(user.id);
  // بند 5 (مواءمة PAGE_PERMS): الصلاحيات تعاد مع الدخول فتُصيَّر الشل مفلترة من أول لحظة
  const perms = await permsForUser(user.id, user.role);
  const res = ok({
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      fullName: user.fullName || user.username,
      jobTitle: user.jobTitle || "",
    },
    token,
    perms,
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
