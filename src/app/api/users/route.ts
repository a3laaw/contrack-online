import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";

/** قائمة المستخدمين — للمدير */
export async function GET(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const users = await db.user.findMany({
    where: { companyId: guard.user.companyId },
    select: {
      id: true,
      username: true,
      companyId: true,
      role: true,
      fullName: true,
      jobTitle: true,
      active: true,
      createdAt: true,
    },
    orderBy: { id: "asc" },
  });
  return ok({ users });
}

/** إنشاء مستخدم: {username, password, role: admin|secretary, fullName, jobTitle} */
export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
    role?: string;
    fullName?: string;
    jobTitle?: string;
  };
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const role = String(body.role || "secretary");

  if (!username) return jsonError("اسم المستخدم مطلوب");
  if (password.length < 6) return jsonError("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
  if (role !== "admin" && role !== "secretary") return jsonError("الدور غير صحيح (admin أو secretary)");

  const exists = await db.user.findUnique({ where: { username } });
  if (exists) return jsonError("اسم المستخدم موجود مسبقًا");

  const h = hashPassword(password);
  const user = await db.user.create({
    data: {
      username,
      passwordHash: h.hash,
      salt: h.salt,
      role,
      fullName: String(body.fullName || ""),
      jobTitle: String(body.jobTitle || ""),
      companyId: guard.user.companyId, // SaaS: المستخدم الجديد داخل شركة السياق
    },
    select: { id: true, username: true, role: true, fullName: true, jobTitle: true, active: true },
  });
  await audit(db, {
    username: guard.user.username,
    action: "إنشاء",
    entityType: "user",
    entityId: user.id,
    entityName: username,
  });
  return ok({ user }, 201);
}
