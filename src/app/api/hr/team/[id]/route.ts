import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay } from "@/lib/api-utils";
import { EMPLOYEE_TYPES, PAYMENT_BASES } from "@/lib/hr-constants";
import { diffEmployeeFields } from "@/lib/hr-labor-core";

type P = { params: Promise<{ id: string }> };

const EMPLOYEE_TYPE_VALUES = EMPLOYEE_TYPES.map((t) => t.value) as readonly string[];
const PAYMENT_BASIS_VALUES = PAYMENT_BASES.map((t) => t.value) as readonly string[];

/**
 * PATCH: تعديل بيانات موظف — الحقول المرسلة فقط + تدقيق الملف حقلًا-بحقل (HR-3 د8/د9):
 * النواة diffEmployeeFields تقارن القيم الخام المحلولة (بما فيها وسيلة الدفع بأسمائها)
 * وتكتب أسطر EmployeeAuditLog في نفس المعاملة — التدقيق العام يبقى كطبقة ثانية بلا ازدواج.
 */
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
  const after: Record<string, unknown> = {}; // القيم الخام المحلولة — أساس فرق التدقيق

  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) return jsonError("اسم الموظف مطلوب");
    data.name = name;
    after.name = name;
  }
  if (body.phone !== undefined) {
    data.phone = String(body.phone || "").trim();
    after.phone = data.phone;
  }
  if (body.notes !== undefined) {
    data.notes = String(body.notes || "").trim();
    after.notes = data.notes;
  }
  if (body.active !== undefined) {
    data.active = Boolean(body.active);
    after.active = data.active;
  }
  if (body.department !== undefined) {
    data.department = String(body.department || "").trim();
    after.department = data.department;
  }
  if (body.jobTitle !== undefined) {
    data.jobTitle = String(body.jobTitle || "").trim();
    after.jobTitle = data.jobTitle;
  }
  if (body.nationality !== undefined) {
    data.nationality = String(body.nationality || "").trim();
    after.nationality = data.nationality;
  }
  if (body.civilId !== undefined) {
    const civilId = String(body.civilId || "").trim();
    if (civilId && !/^\d{10}$/.test(civilId)) return jsonError("الرقم المدني يجب أن يكون 10 أرقام");
    data.civilId = civilId;
    after.civilId = civilId;
  }
  if (body.employeeType !== undefined) {
    const v = String(body.employeeType);
    if (!EMPLOYEE_TYPE_VALUES.includes(v)) return jsonError("نوع الموظف غير معروف");
    data.employeeType = v;
    after.employeeType = v;
  }
  if (body.paymentBasis !== undefined) {
    const v = String(body.paymentBasis);
    if (!PAYMENT_BASIS_VALUES.includes(v)) return jsonError("أساس الأجر غير معروف");
    data.paymentBasis = v;
    after.paymentBasis = v;
  }
  if (body.salary !== undefined) {
    const n = Number(body.salary);
    if (!Number.isFinite(n) || n < 0) return jsonError("الراتب الشهري يجب أن يكون رقمًا غير سالب");
    data.salary = n;
    after.salary = n;
  }
  if (body.dailyRate !== undefined) {
    const n = Number(body.dailyRate);
    if (!Number.isFinite(n) || n < 0) return jsonError("الأجر اليومي يجب أن يكون رقمًا غير سالب");
    data.dailyRate = n;
    after.dailyRate = n;
  }
  // HR-3 — التكلفة الشهرية على الشركة (د2) — صفر = افتراضي الراتب الأساسي لحظة التخصيص
  if (body.monthlyCostRate !== undefined) {
    const n = Number(body.monthlyCostRate);
    if (!Number.isFinite(n) || n < 0) return jsonError("التكلفة الشهرية يجب أن تكون رقمًا غير سالب");
    data.monthlyCostRate = n;
    after.monthlyCostRate = n;
  }
  if (body.hireDate !== undefined) {
    const hireDate = body.hireDate ? parseDay(body.hireDate) : "";
    if (body.hireDate && !hireDate) return jsonError("تاريخ التعيين غير صالح");
    data.hireDate = hireDate;
    after.hireDate = hireDate;
  }
  if (body.paymentMethodId !== undefined) {
    if (body.paymentMethodId === null || body.paymentMethodId === "" || body.paymentMethodId === 0) {
      data.paymentMethod = { disconnect: true };
      after.paymentMethodId = null;
    } else {
      const pmId = Number(body.paymentMethodId);
      const pm = await db.paymentMethod.findUnique({ where: { id: pmId } });
      if (!pm) return jsonError("وسيلة الدفع غير موجودة", 404);
      data.paymentMethod = { connect: { id: pmId } };
      after.paymentMethodId = pmId;
    }
  }

  // أسماء وسائل الدفع المحلولة (القديمة والجديدة) لتنسيق قيم التدقيق — قبل المعاملة
  const pmNames: Record<number, string> = {};
  if (after.paymentMethodId !== undefined) {
    const ids = Array.from(
      new Set([employee.paymentMethodId, after.paymentMethodId].filter((x): x is number => Number.isFinite(Number(x)) && Number(x) > 0).map(Number))
    );
    if (ids.length > 0) {
      const pms = await db.paymentMethod.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      for (const pm of pms) pmNames[pm.id] = pm.name;
    }
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.employee.update({ where: { id }, data });
      // HR-3 — أسطر تدقيق الحقول (القائمة المغلقة فقط — د8)
      const diffs = diffEmployeeFields(employee as unknown as Record<string, unknown>, after, { paymentMethodNames: pmNames });
      return { updated, diffs };
    });

    if (result.diffs.length > 0) {
      await db.employeeAuditLog.createMany({
        data: result.diffs.map((d) => ({
          employeeId: id,
          field: d.field,
          fieldLabel: d.label,
          oldValue: d.oldValue,
          newValue: d.newValue,
          editedBy: guard.user.username,
        })),
      });
    }

    await audit(db, {
      username: guard.user.username,
      action: "تعديل",
      entityType: "employee",
      entityId: id,
      entityName: String(data.name || employee.name),
      oldStatus: employee.active ? "نشط" : "موقوف",
      newStatus: data.active === undefined ? (employee.active ? "نشط" : "موقوف") : data.active ? "نشط" : "موقوف",
      reason: result.diffs.length ? result.diffs.map((d) => `${d.label}: ${d.oldValue} → ${d.newValue}`).join(" · ") : "",
    });
    return ok({ updated: true, fieldChanges: result.diffs.length });
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
