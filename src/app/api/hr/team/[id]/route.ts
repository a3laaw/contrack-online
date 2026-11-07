import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay, todayStr } from "@/lib/api-utils";
import { EMPLOYEE_TYPES, PAYMENT_BASES } from "@/lib/hr-constants";

type P = { params: Promise<{ id: string }> };

const EMPLOYEE_TYPE_VALUES = EMPLOYEE_TYPES.map((t) => t.value) as readonly string[];
const PAYMENT_BASIS_VALUES = PAYMENT_BASES.map((t) => t.value) as readonly string[];

/** PATCH: تعديل بيانات موظف — الحقول المرسلة فقط */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const employee = await db.employee.findUnique({ where: { id } });
  if (!employee) return jsonError("الموظف غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Prisma.EmployeeUpdateInput = {};

  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) return jsonError("اسم الموظف مطلوب");
    data.name = name;
  }
  if (body.phone !== undefined) data.phone = String(body.phone || "").trim();
  if (body.notes !== undefined) data.notes = String(body.notes || "").trim();
  if (body.active !== undefined) data.active = Boolean(body.active);
  if (body.department !== undefined) data.department = String(body.department || "").trim();
  if (body.jobTitle !== undefined) data.jobTitle = String(body.jobTitle || "").trim();
  if (body.nationality !== undefined) data.nationality = String(body.nationality || "").trim();
  if (body.civilId !== undefined) {
    const civilId = String(body.civilId || "").trim();
    if (civilId && !/^\d{10}$/.test(civilId)) return jsonError("الرقم المدني يجب أن يكون 10 أرقام");
    data.civilId = civilId;
  }
  if (body.employeeType !== undefined) {
    const v = String(body.employeeType);
    if (!EMPLOYEE_TYPE_VALUES.includes(v)) return jsonError("نوع الموظف غير معروف");
    data.employeeType = v;
  }
  if (body.paymentBasis !== undefined) {
    const v = String(body.paymentBasis);
    if (!PAYMENT_BASIS_VALUES.includes(v)) return jsonError("أساس الأجر غير معروف");
    data.paymentBasis = v;
  }
  if (body.salary !== undefined) {
    const n = Number(body.salary);
    if (!Number.isFinite(n) || n < 0) return jsonError("الراتب الشهري يجب أن يكون رقمًا غير سالب");
    data.salary = n;
  }
  if (body.dailyRate !== undefined) {
    const n = Number(body.dailyRate);
    if (!Number.isFinite(n) || n < 0) return jsonError("الأجر اليومي يجب أن يكون رقمًا غير سالب");
    data.dailyRate = n;
  }
  if (body.hireDate !== undefined) {
    const hireDate = body.hireDate ? parseDay(body.hireDate) : "";
    if (body.hireDate && !hireDate) return jsonError("تاريخ التعيين غير صالح");
    data.hireDate = hireDate;
  }
  if (body.paymentMethodId !== undefined) {
    if (body.paymentMethodId === null || body.paymentMethodId === "" || body.paymentMethodId === 0) {
      data.paymentMethod = { disconnect: true };
    } else {
      const pmId = Number(body.paymentMethodId);
      const pm = await db.paymentMethod.findUnique({ where: { id: pmId } });
      if (!pm) return jsonError("وسيلة الدفع غير موجودة", 404);
      data.paymentMethod = { connect: { id: pmId } };
    }
  }

  try {
    await db.employee.update({ where: { id }, data });
    await audit(db, {
      username: guard.user.username,
      action: "تعديل",
      entityType: "employee",
      entityId: id,
      entityName: String(data.name || employee.name),
      oldStatus: employee.active ? "نشط" : "موقوف",
      newStatus: data.active === undefined ? (employee.active ? "نشط" : "موقوف") : data.active ? "نشط" : "موقوف",
    });
    return ok({ updated: true });
  } catch (e) {
    console.error(e);
    return jsonError("تعذر تعديل الموظف", 500);
  }
}

/** DELETE: حذف موظف — ممنوع له تاريخ مسير أو سندات سلف (تُعطَّل بدلًا من الحذف) */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const employee = await db.employee.findUnique({
    where: { id },
    include: { _count: { select: { payrollRecords: true, vouchers: true, attendances: true, leaves: true } } },
  });
  if (!employee) return jsonError("الموظف غير موجود", 404);

  if (employee._count.payrollRecords > 0 || employee._count.vouchers > 0) {
    return jsonError("للموظف تاريخ مالي (مسير أو سلف) — عطّله بدلًا من الحذف حفاظًا على اللقطات المجمّدة");
  }

  const reason = (req.nextUrl.searchParams.get("reason") || "").trim() || "حذف موظف";

  await db.$transaction(async (tx) => {
    await tx.employee.delete({ where: { id } });
    await tx.purgeAudit.create({
      data: {
        purgedBy: guard.user.username,
        entity: "employee",
        entityId: id,
        label: employee.name,
        reason,
        snapshot: JSON.stringify({ employee, attendances: employee._count.attendances, leaves: employee._count.leaves, deletedAt: new Date().toISOString() }),
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف",
      entityType: "employee",
      entityId: id,
      entityName: employee.name,
      reason,
    });
  });

  return ok({ deleted: true });
}
