import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay } from "@/lib/api-utils";
import { employeeAdvanceRemaining } from "@/lib/voucher-server";
import { EMPLOYEE_TYPES, JOB_NUMBER_START, PAYMENT_BASES } from "@/lib/hr-constants";

const EMPLOYEE_TYPE_VALUES = EMPLOYEE_TYPES.map((t) => t.value) as readonly string[];
const PAYMENT_BASIS_VALUES = PAYMENT_BASES.map((t) => t.value) as readonly string[];

/** GET: الموظفون كاملًا + عدادات الأنشطة + رصيد السلف المفتوح */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const employees = await db.employee.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: {
      paymentMethod: { select: { name: true } },
      _count: { select: { attendances: true, leaves: true, payrollRecords: true, vouchers: true } },
    },
  });

  // رصيد السلف لكل موظف — استعلام مجمع واحد ثم حساب فردي (نفس دالة الخزينة)
  const balances = new Map<number, number>();
  for (const e of employees) {
    balances.set(e.id, await employeeAdvanceRemaining(db, e.id));
  }

  return ok({
    employees: employees.map((e) => ({
      id: e.id,
      name: e.name,
      phone: e.phone,
      notes: e.notes,
      active: e.active,
      jobNumber: e.jobNumber,
      employeeType: e.employeeType,
      employeeTypeLabel: e.employeeType === "external" ? "خارجي" : "داخلي",
      department: e.department,
      jobTitle: e.jobTitle,
      civilId: e.civilId,
      nationality: e.nationality,
      hireDate: e.hireDate,
      salary: Number(e.salary),
      paymentBasis: e.paymentBasis,
      paymentBasisLabel: e.paymentBasis === "daily" ? "يومي" : "شهري",
      dailyRate: Number(e.dailyRate),
      paymentMethodId: e.paymentMethodId,
      paymentMethodName: e.paymentMethod?.name ?? "",
      advanceBalance: balances.get(e.id) ?? 0,
      attendancesCount: e._count.attendances,
      leavesCount: e._count.leaves,
      payrollRecordsCount: e._count.payrollRecords,
    })),
  });
}

/** POST: إضافة موظف — الاسم إلزامي، الرقم المدني 10 أرقام عند الإدخال، رقم وظيفي آلي من 1001 */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name || "").trim();
  if (!name) return jsonError("اسم الموظف مطلوب");

  const civilId = String(body.civilId || "").trim();
  if (civilId && !/^\d{10}$/.test(civilId)) return jsonError("الرقم المدني يجب أن يكون 10 أرقام");

  const employeeType = String(body.employeeType || "internal");
  if (!EMPLOYEE_TYPE_VALUES.includes(employeeType)) return jsonError("نوع الموظف غير معروف");

  const paymentBasis = String(body.paymentBasis || "monthly");
  if (!PAYMENT_BASIS_VALUES.includes(paymentBasis)) return jsonError("أساس الأجر غير معروف");

  const salary = body.salary === undefined || body.salary === "" ? 0 : Number(body.salary);
  if (!Number.isFinite(salary) || salary < 0) return jsonError("الراتب الشهري يجب أن يكون رقمًا غير سالب");
  const dailyRate = body.dailyRate === undefined || body.dailyRate === "" ? 0 : Number(body.dailyRate);
  if (!Number.isFinite(dailyRate) || dailyRate < 0) return jsonError("الأجر اليومي يجب أن يكون رقمًا غير سالب");

  const hireDate = body.hireDate ? parseDay(body.hireDate) : "";
  if (body.hireDate && !hireDate) return jsonError("تاريخ التعيين غير صالح");

  const paymentMethodId = body.paymentMethodId ? Number(body.paymentMethodId) : null;
  if (paymentMethodId != null) {
    const pm = await db.paymentMethod.findUnique({ where: { id: paymentMethodId } });
    if (!pm) return jsonError("وسيلة الدفع غير موجودة", 404);
  }

  // الرقم الوظيفي — أكبر رقم حالي + 1 (نطاق الشركة عبر الحجب)
  const latest = await db.employee.findFirst({
    where: { jobNumber: { gte: String(JOB_NUMBER_START) } },
    orderBy: { jobNumber: "desc" },
    select: { jobNumber: true },
  });
  const nextJobNumber = latest?.jobNumber ? String(Math.max(JOB_NUMBER_START, Number(latest.jobNumber) + 1)) : String(JOB_NUMBER_START);

  try {
    const created = await db.employee.create({
      data: {
        name,
        phone: String(body.phone || "").trim(),
        notes: String(body.notes || "").trim(),
        active: body.active === undefined ? true : Boolean(body.active),
        jobNumber: nextJobNumber,
        employeeType,
        department: String(body.department || "").trim(),
        jobTitle: String(body.jobTitle || "").trim(),
        civilId,
        nationality: String(body.nationality || "").trim(),
        hireDate,
        salary,
        paymentBasis,
        dailyRate,
        paymentMethodId,
      },
    });
    await audit(db, {
      username: guard.user.username,
      action: "إضافة",
      entityType: "employee",
      entityId: created.id,
      entityName: name,
    });
    return ok({ employee: created }, 201);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return jsonError("اسم الموظف مستخدم مسبقًا");
    }
    console.error(e);
    return jsonError("تعذر إضافة الموظف", 500);
  }
}
