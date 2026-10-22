// ============================================================
// Task 85 — SaaS: إدارة الشركات (المدير/المطور فقط)
// GET: قائمة الشركات (الفائق: الكل مع عدد المستخدمين — غيره: شركته فقط)
// POST: إنشاء شركة جديدة {name, shortName?, notes?}
// ============================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  if (guard.user.role === "admin" || guard.user.role === "developer") {
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
  return ok({ companies: [], currentCompanyId: guard.user.companyId, canSwitch: false });
}

export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  if (guard.user.role !== "admin" && guard.user.role !== "developer") {
    return jsonError("إنشاء الشركات للمدير/المطور فقط", 403);
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    shortName?: string;
    notes?: string;
  };
  const name = String(body.name || "").trim();
  if (!name) return jsonError("اسم الشركة مطلوب");

  const exists = await db.company.findFirst({ where: { name } });
  if (exists) return jsonError("يوجد شركة بهذا الاسم مسبقًا");

  const company = await db.company.create({
    data: {
      name,
      shortName: String(body.shortName || "").trim(),
      notes: String(body.notes || "").trim(),
    },
  });
  await audit(db, {
    username: guard.user.username,
    action: "إنشاء",
    entityType: "company",
    entityId: company.id,
    entityName: name,
  });
  return ok({ company }, 201);
}
