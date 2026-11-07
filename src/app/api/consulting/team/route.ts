import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay } from "@/lib/api-utils";
import { ENGINEER_STATUSES } from "@/lib/consulting-constants";

/** GET: الفريق الهندسي كاملًا مع عدادات الأنشطة (الإسنادات/الساعات/الإجازات) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;

  const engineers = await db.engineer.findMany({
    orderBy: [{ name: "asc" }],
    include: { _count: { select: { assignments: true, timesheets: true, leaves: true } } },
  });

  return ok({
    engineers: engineers.map((e) => ({
      id: e.id,
      name: e.name,
      jobTitle: e.jobTitle,
      specialty: e.specialty,
      civilId: e.civilId,
      nationality: e.nationality,
      phone: e.phone,
      email: e.email,
      licenseNo: e.licenseNo,
      licenseExpiry: e.licenseExpiry,
      hireDate: e.hireDate,
      baseSalary: Number(e.baseSalary),
      status: e.status,
      notes: e.notes,
      assignmentsCount: e._count.assignments,
      timesheetsCount: e._count.timesheets,
      leavesCount: e._count.leaves,
    })),
  });
}

/** POST: إضافة مهندس — الاسم إلزامي، والرقم المدني 10 أرقام عند الإدخال */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name || "").trim();
  if (!name) return jsonError("اسم المهندس مطلوب");

  const civilId = String(body.civilId || "").trim();
  if (civilId && !/^\d{10}$/.test(civilId)) return jsonError("الرقم المدني يجب أن يكون 10 أرقام");

  const licenseExpiry = body.licenseExpiry ? parseDay(body.licenseExpiry) : "";
  if (body.licenseExpiry && !licenseExpiry) return jsonError("تاريخ انتهاء الترخيص غير صالح");
  const hireDate = body.hireDate ? parseDay(body.hireDate) : "";
  if (body.hireDate && !hireDate) return jsonError("تاريخ التعيين غير صالح");

  const status = String(body.status || "نشط");
  if (!(ENGINEER_STATUSES as readonly string[]).includes(status)) return jsonError("حالة المهندس غير معروفة");

  const baseSalaryRaw = Number(body.baseSalary);
  const baseSalary = Number.isFinite(baseSalaryRaw) && baseSalaryRaw > 0 ? baseSalaryRaw : 0;

  try {
    const created = await db.engineer.create({
      data: {
        name,
        jobTitle: String(body.jobTitle || "").trim(),
        specialty: String(body.specialty || "").trim(),
        civilId,
        nationality: String(body.nationality || "").trim(),
        phone: String(body.phone || "").trim(),
        email: String(body.email || "").trim(),
        licenseNo: String(body.licenseNo || "").trim(),
        licenseExpiry,
        hireDate,
        baseSalary,
        status,
        notes: String(body.notes || "").trim(),
      },
    });
    await audit(db, {
      username: guard.user.username,
      action: "إضافة",
      entityType: "engineer",
      entityId: created.id,
      entityName: name,
    });
    return ok({ engineer: created }, 201);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return jsonError("تعذر الحفظ — قيمة مكررة");
    }
    console.error(e);
    return jsonError("تعذر إضافة المهندس", 500);
  }
}
