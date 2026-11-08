import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { employeeAdvanceRemaining } from "@/lib/voucher-server";
import { recountAnnualBalance } from "@/lib/hr-constants";

/**
 * GET: تقرير ملف الموظف الشامل (id) — بيانات الملف + الرصيد السنوي + حضور الشهور
 * + الإجازات + الأذونات + سجلات المساير + السلف + نهاية الخدمة إن وجدت.
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id)) return jsonError("معرف الموظف غير صالح");

  const e = await db.employee.findUnique({
    where: { id },
    include: { paymentMethod: { select: { name: true } } },
  });
  if (!e) return jsonError("الموظف غير موجود", 404);

  const year = new Date().getUTCFullYear();
  const [attendanceRows, leaves, permissions, payrollRecords, terminations, assignments, auditTrail] = await Promise.all([
    db.employeeAttendance.findMany({
      where: { employeeId: id },
      orderBy: { workDate: "asc" },
      select: { workDate: true, status: true, checkIn: true, checkOut: true, lateMinutes: true, earlyLeaveMinutes: true, source: true },
    }),
    db.employeeLeave.findMany({ where: { employeeId: id }, orderBy: { id: "desc" }, take: 100 }),
    db.employeePermission.findMany({ where: { employeeId: id }, orderBy: { id: "desc" }, take: 100 }),
    db.payrollRecord.findMany({
      where: { employeeId: id },
      orderBy: { id: "desc" },
      take: 36,
      include: { batch: { select: { month: true, status: true, batchNo: true } } },
    }),
    db.employeeTermination.findMany({ where: { employeeId: id }, orderBy: { id: "desc" } }),
    // HR-3 — التكليفات (سارية أولًا)
    db.employeeAssignment.findMany({
      where: { employeeId: id },
      orderBy: [{ status: "desc" }, { id: "desc" }],
      include: { contract: { select: { contractNumber: true, contractName: true, description: true } } },
    }),
    // HR-3 — سجل تغييرات الملف: آخر 100 سطر (تُعرض تصاعديًا)
    db.employeeAuditLog.findMany({ where: { employeeId: id }, orderBy: { editedAt: "desc" }, take: 100 }),
  ]);

  // تجميع الحضور بالشهور (آخر 12 شهرًا)
  const byMonth = new Map<string, { present: number; absent: number; justified: number; leave: number; holiday: number; lateMinutes: number; early: number }>();
  for (const a of attendanceRows) {
    const month = a.workDate.slice(0, 7);
    const agg = byMonth.get(month) ?? { present: 0, absent: 0, justified: 0, leave: 0, holiday: 0, lateMinutes: 0, early: 0 };
    if (a.status === "present") agg.present++;
    else if (a.status === "absent") agg.absent++;
    else if (a.status === "justified_absent") agg.justified++;
    else if (a.status === "leave") agg.leave++;
    else if (a.status === "holiday") agg.holiday++;
    agg.lateMinutes += Math.max(0, a.lateMinutes);
    agg.early += Math.max(0, a.earlyLeaveMinutes);
    byMonth.set(month, agg);
  }

  // الرصيد السنوي الحالي (recount — لا تخزين)
  const consumed = await db.employeeLeave.aggregate({
    where: { employeeId: id, leaveType: "سنوية", status: { in: ["معتمدة", "بدأت", "منتهية"] }, startDate: { gte: `${year}-01-01`, lte: `${year}-12-31` } },
    _sum: { days: true },
  });
  const annualBalance = recountAnnualBalance({ hireDate: e.hireDate, year, consumedApprovedDays: Number(consumed._sum.days ?? 0) });

  const advanceRemaining = await employeeAdvanceRemaining(db, id);

  return ok({
    employee: {
      id: e.id,
      name: e.name,
      jobNumber: e.jobNumber,
      employeeType: e.employeeType,
      department: e.department,
      jobTitle: e.jobTitle,
      civilId: e.civilId,
      nationality: e.nationality,
      hireDate: e.hireDate,
      phone: e.phone,
      active: e.active,
      salary: Number(e.salary),
      paymentBasis: e.paymentBasis,
      dailyRate: Number(e.dailyRate),
      monthlyCostRate: Number(e.monthlyCostRate),
      paymentMethod: e.paymentMethod?.name ?? "",
    },
    annualBalance,
    advanceRemaining,
    attendanceByMonth: Array.from(byMonth.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 12)
      .map(([month, v]) => ({ month, ...v })),
    leaves: leaves.map((l) => ({
      id: l.id, leaveType: l.leaveType, startDate: l.startDate, endDate: l.endDate,
      days: Number(l.days), status: l.status, decisionNote: l.decisionNote,
    })),
    permissions: permissions.map((p) => ({
      id: p.id, permDate: p.permDate, kind: p.kind, minutes: p.minutes, reason: p.reason, status: p.status,
    })),
    payroll: payrollRecords.map((r) => ({
      month: r.batch.month, batchNo: r.batch.batchNo, batchStatus: r.batch.status,
      baseAmount: Number(r.baseAmount), absenceDeduction: Number(r.absenceDeduction),
      sickDeduction: Number(r.sickDeduction), lateDeduction: Number(r.lateDeduction),
      advanceDeduction: Number(r.advanceDeduction), netAmount: Number(r.netAmount),
    })),
    terminations: terminations.map((t) => ({
      id: t.id, endDate: t.endDate, scenario: t.scenario, serviceYears: Number(t.serviceYears),
      eosAmount: Number(t.eosAmount), leaveEncashment: Number(t.leaveEncashment), total: Number(t.total),
      status: t.status, entryId: t.entryId,
    })),
    // HR-3 — التكليفات وسجل تغييرات الملف
    assignments: assignments.map((a) => ({
      id: a.id,
      contractNumber: a.contract.contractNumber,
      contractName: a.contract.description || a.contract.contractName || a.contract.contractNumber,
      role: a.role,
      allocationPct: Number(a.allocationPct),
      startDate: a.startDate,
      endDate: a.endDate,
      status: a.status,
    })),
    auditTrail: auditTrail.reverse().map((l) => ({
      id: l.id,
      field: l.field,
      fieldLabel: l.fieldLabel,
      oldValue: l.oldValue,
      newValue: l.newValue,
      editedBy: l.editedBy,
      editedAt: l.editedAt.toISOString().slice(0, 16).replace("T", " "),
    })),
  });
}
