// ============================================================
// Task 85 — SaaS: إدارة الشركات — (Task 97) للمطور فقط حصريًا:
// عزل الشركات قرار معتمد — مدير الشركة يبقى داخل شركته ولا يرى غيرها.
// GET: قائمة الشركات (مطور: الكل مع عدد المستخدمين — غيره: شركته فقط بلا تبديل)
// POST: إنشاء شركة جديدة {name, shortName?, notes?}
//       + (Task 98) مدير أول اختياري {adminUsername?, adminPassword?, adminFullName?}
// ============================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";
import { hashPassword } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  if (guard.user.role === "developer") {
    const companies = await db.company.findMany({
      orderBy: { id: "asc" },
      include: { users: { select: { id: true } } },
    });
    return ok({
      companies: companies.map((c) => ({
        id: c.id,
        name: c.name,
        shortName: c.shortName,
        isActive: c.isActive,
        notes: c.notes,
        createdAt: c.createdAt,
        usersCount: c.users.length,
      })),
      currentCompanyId: guard.user.companyId,
      canSwitch: true,
    });
  }
  // غير المطور (مدير): شركته فقط — بلا تبديل (Task 97: عزل الشركات للمطور)
  const own = await db.company.findUnique({
    where: { id: guard.user.companyId },
    include: { users: { select: { id: true } } },
  });
  return ok({
    companies: own
      ? [{
          id: own.id,
          name: own.name,
          shortName: own.shortName,
          isActive: own.isActive,
          notes: own.notes,
          createdAt: own.createdAt,
          usersCount: own.users.length,
        }]
      : [],
    currentCompanyId: guard.user.companyId,
    canSwitch: false,
  });
}

export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  if (guard.user.role !== "developer") {
    return jsonError("إنشاء الشركات للمطور فقط (Task 97)", 403);
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    shortName?: string;
    notes?: string;
    adminUsername?: string;
    adminPassword?: string;
    adminFullName?: string;
  };
  const name = String(body.name || "").trim();
  if (!name) return jsonError("اسم الشركة مطلوب");

  // (Task 98) مدير أول اختياري — يُسلَّم صاحبه جاهزًا: مستخدم admin للشركة الجديدة فورًا
  const adminUsername = String(body.adminUsername || "").trim();
  const adminPassword = String(body.adminPassword || "");
  const wantsAdmin = adminUsername.length > 0 || adminPassword.length > 0;
  if (wantsAdmin) {
    if (!adminUsername || adminUsername.includes(" ") || adminUsername.length < 3) {
      return jsonError("اسم مستخدم المدير: 3 أحرف على الأقل وبلا فراغات");
    }
    if (adminPassword.length < 6) return jsonError("كلمة مرور المدير يجب أن تكون 6 أحرف على الأقل");
  }

  const exists = await db.company.findFirst({ where: { name } });
  if (exists) return jsonError("يوجد شركة بهذا الاسم مسبقًا");
  if (wantsAdmin) {
    // اسم المستخدم فريد على مستوى النظام كله (عبر كل الشركات)
    const userExists = await db.user.findUnique({ where: { username: adminUsername }, select: { id: true } });
    if (userExists) return jsonError("اسم مستخدم المدير موجود مسبقًا في النظام");
  }

  const h = wantsAdmin ? hashPassword(adminPassword) : null;
  const company = await db.company.create({
    data: {
      name,
      shortName: String(body.shortName || "").trim(),
      notes: String(body.notes || "").trim(),
    },
  });
  if (wantsAdmin && h) {
    // مدير الشركة الأول — admin بصلاحيات دور المدير الافتراضية كاملة داخل شركته
    await db.user.create({
      data: {
        companyId: company.id,
        username: adminUsername,
        passwordHash: h.hash,
        salt: h.salt,
        role: "admin",
        fullName: String(body.adminFullName || "").trim() || "مدير",
        jobTitle: "مدير",
      },
    });
  }
  await audit(db, {
    username: guard.user.username,
    action: "إنشاء",
    entityType: "company",
    entityId: company.id,
    entityName: name,
  });
  return ok({ company }, 201);
}
