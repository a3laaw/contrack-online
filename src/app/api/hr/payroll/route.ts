import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { employeeAdvanceRemaining } from "@/lib/voucher-server";
import {
  computePayrollRecord,
  lateDeductionFor,
  monthEndDate,
  monthLabelAr,
  netChargeableMinutes,
  overlapDaysInMonth,
  PayrollCalcEmployee,
  PayrollCalcExcluded,
  PayrollCalcResult,
  r3,
  sickDeductionFor,
  sumPayrollRecords,
  workHoursOfSchedule,
} from "@/lib/hr-constants";

/** GET: قائمة المساير (الأحدث أولًا — 36 دفعة) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const batches = await db.payrollBatch.findMany({
    orderBy: [{ month: "desc" }, { id: "desc" }],
    take: 36,
    include: { _count: { select: { records: true } } },
  });

  return ok({
    batches: batches.map((b) => ({
      id: b.id,
      batchNo: b.batchNo,
      month: b.month,
      monthLabel: monthLabelAr(b.month),
      status: b.status,
      grossTotal: Number(b.grossTotal),
      deductionTotal: Number(b.deductionTotal),
      advanceTotal: Number(b.advanceTotal),
      netTotal: Number(b.netTotal),
      recordsCount: b._count.records,
      journalEntryId: b.journalEntryId,
      paymentVoucherId: b.paymentVoucherId,
      generatedBy: b.generatedBy,
      approvedBy: b.approvedBy,
      cancelReason: b.cancelReason,
    })),
  });
}

/** POST: توليد مسير شهر — لقطة مجمّدة (شهر واحد بحالة نشطة) */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const month = String(body.month || "").trim();
  if (!/^(\d{4})-(0[1-9]|1[0-2])$/.test(month)) return jsonError("اختر شهرًا صالحًا بصيغة YYYY-MM");

  const active = await db.payrollBatch.findFirst({ where: { month, status: { not: "cancelled" } } });
  if (active) {
    return jsonError(`يوجد مسير نشط لشهر ${monthLabelAr(month)} — ألغه قبل إعادة التوليد`);
  }

  const employees = await db.employee.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    include: {
      attendances: {
        where: { workDate: { gte: `${month}-01`, lte: `${month}-31` } },
        select: { workDate: true, status: true, lateMinutes: true, earlyLeaveMinutes: true },
      },
    },
  });
  if (employees.length === 0) return jsonError("لا يوجد موظفون نشطون — أضف الفريق أولًا");

  const first = `${month}-01`;
  const last = monthEndDate(month);
  const plans = (body.plans ?? null) as Record<string, number> | null;

  // إجازات «بدون راتب» المعتمدة المتقاطعة مع الشهر — استعلام واحد ثم تقاطع فردي
  const unpaidLeaves = await db.employeeLeave.findMany({
    where: { leaveType: "بدون راتب", status: { in: ["معتمدة", "بدأت", "منتهية"] }, startDate: { lte: last }, endDate: { gte: first } },
    select: { employeeId: true, startDate: true, endDate: true },
  });

  // HR-2 — الإجازات المرضية المتقاطعة (بشرائحها) + الأذونات المعتمدة للإعفاء الدقائقي
  const sickLeaves = await db.employeeLeave.findMany({
    where: { leaveType: "مرضية", status: { in: ["معتمدة", "بدأت", "منتهية"] }, startDate: { lte: last }, endDate: { gte: first } },
    select: { employeeId: true, startDate: true, endDate: true, sickTier: true },
  });
  const approvedPermissions = await db.employeePermission.findMany({
    where: { status: "معتمدة", permDate: { gte: first, lte: last } },
    select: { employeeId: true, permDate: true, kind: true, minutes: true },
  });

  // HR-2 — جدول الدوام (حقول Setting الثلاثة) — بلا جدول صالح = بلا دقائق (أمان د3-4)
  const setting = await db.setting.findUnique({ where: { companyId: guard.user.companyId }, select: { hrWorkStart: true, hrWorkEnd: true, hrGraceMinutes: true } });
  const schedule = setting
    ? { start: setting.hrWorkStart, end: setting.hrWorkEnd, graceMinutes: setting.hrGraceMinutes }
    : null;
  const workHours = workHoursOfSchedule(schedule);

  const calcInputs: PayrollCalcEmployee[] = [];
  const snapshotsById = new Map<number, { sickDays: number; lateMinutes: number }>();
  for (const e of employees) {
    const presentDays = e.attendances.filter((a) => a.status === "present").length;
    const unjustifiedAbsenceDays = e.attendances.filter((a) => a.status === "absent").length;
    const unpaidLeaveDays = unpaidLeaves
      .filter((l) => l.employeeId === e.id)
      .reduce((s, l) => s + overlapDaysInMonth(l.startDate, l.endDate, first, last), 0);
    const advanceRemaining = await employeeAdvanceRemaining(db, e.id);

    // HR-2 — المرضية الفعلية: تجميع أيام الشهر بشرائحها ثم الخصم بالنواة (شهري فقط)
    const sickByTier = new Map<number | null, number>();
    let snapSickDays = 0;
    if (e.paymentBasis !== "daily") {
      for (const l of sickLeaves) {
        if (l.employeeId !== e.id) continue;
        const d = overlapDaysInMonth(l.startDate, l.endDate, first, last);
        if (d <= 0) continue;
        snapSickDays += d;
        sickByTier.set(l.sickTier, (sickByTier.get(l.sickTier) ?? 0) + d);
      }
    }
    const sickDeduction = sickDeductionFor(
      Number(e.salary),
      Array.from(sickByTier.entries()).map(([tier, days]) => ({ tier, days }))
    );

    // HR-2 — الدقائق المجردة: لكل يوم ∑ (تأخير + انصراف) − إعفاء الأذونات المعتمدة (حدّ مدة الإذن وبحدّ الفعلي)
    let grossLateMinutes = 0;
    for (const a of e.attendances) grossLateMinutes += Math.max(0, a.lateMinutes) + Math.max(0, a.earlyLeaveMinutes);
    let netLateMinutes = 0;
    if (grossLateMinutes > 0 && schedule) {
      const byDay = new Map<string, { late: number; early: number; exemptLate: number; exemptEarly: number }>();
      for (const a of e.attendances) {
        byDay.set(a.workDate, {
          late: Math.max(0, a.lateMinutes),
          early: Math.max(0, a.earlyLeaveMinutes),
          exemptLate: 0,
          exemptEarly: 0,
        });
      }
      for (const p of approvedPermissions) {
        if (p.employeeId !== e.id) continue;
        const day = byDay.get(p.permDate);
        if (!day) continue;
        if (p.kind === "late") day.exemptLate += Math.max(0, p.minutes);
        else day.exemptEarly += Math.max(0, p.minutes);
      }
      for (const d of byDay.values()) {
        netLateMinutes += netChargeableMinutes(d.late, Math.min(d.exemptLate, d.late));
        netLateMinutes += netChargeableMinutes(d.early, Math.min(d.exemptEarly, d.early));
      }
    }
    const lateDeduction = e.paymentBasis !== "daily" && schedule ? lateDeductionFor(Number(e.salary), workHours, netLateMinutes) : 0;

    snapshotsById.set(e.id, { sickDays: r3(snapSickDays), lateMinutes: netLateMinutes });
    calcInputs.push({
      employeeId: e.id,
      name: e.name,
      jobTitle: e.jobTitle,
      employeeType: e.employeeType === "external" ? "external" : "internal",
      paymentBasis: e.paymentBasis === "daily" ? "daily" : "monthly",
      salary: Number(e.salary),
      dailyRate: Number(e.dailyRate),
      presentDays,
      unjustifiedAbsenceDays,
      unpaidLeaveDays,
      advanceRemaining,
      advancePlan: plans && plans[String(e.id)] != null ? Number(plans[String(e.id)]) : null,
      sickDeduction,
      lateDeduction,
    });
  }

  const results = calcInputs.map((c) => computePayrollRecord(c));
  const included = results.filter((r): r is PayrollCalcResult => !r.excluded);
  const excluded = results.filter((r): r is PayrollCalcExcluded => r.excluded);
  if (included.length === 0) {
    return jsonError("لا يوجد موظفون برواتب معرّفة لتوليد المسير");
  }

  const totals = sumPayrollRecords(included);
  const byId = new Map(calcInputs.map((c) => [c.employeeId, c]));
  const latest = await db.payrollBatch.findFirst({ orderBy: { batchNo: "desc" }, select: { batchNo: true } });
  const batchNo = (latest?.batchNo ?? 0) + 1;

  try {
    const created = await db.$transaction(async (tx) => {
      const batch = await tx.payrollBatch.create({
        data: {
          batchNo,
          month,
          status: "draft",
          grossTotal: totals.grossTotal,
          deductionTotal: totals.deductionTotal,
          advanceTotal: totals.advanceTotal,
          netTotal: totals.netTotal,
          generatedBy: guard.user.username,
          generatedAt: new Date(),
        },
      });
      await tx.payrollRecord.createMany({
        data: included.map((r) => {
          const c = byId.get(r.employeeId)!;
          return {
            batchId: batch.id,
            employeeId: r.employeeId,
            snapName: c.name,
            snapJobTitle: c.jobTitle,
            snapPaymentBasis: c.paymentBasis,
            presentDays: c.presentDays,
            absenceDays: r3sum(c.unjustifiedAbsenceDays, c.unpaidLeaveDays),
            snapSickDays: snapshotsById.get(r.employeeId)?.sickDays ?? 0,
            snapLateMinutes: snapshotsById.get(r.employeeId)?.lateMinutes ?? 0,
            baseAmount: r.baseAmount,
            absenceDeduction: r.absenceDeduction,
            sickDeduction: r.sickDeduction,
            lateDeduction: r.lateDeduction,
            advanceDeduction: r.advanceDeduction,
            netAmount: r.netAmount,
          };
        }),
      });
      await audit(tx, {
        username: guard.user.username,
        action: "توليد مسير",
        entityType: "payroll_batch",
        entityId: batch.id,
        entityName: `مسير ${monthLabelAr(month)} — PR-${batchNo} (${included.length} موظفًا)`,
      });
      return batch;
    });

    return ok(
      {
        batch: { id: created.id, batchNo, month, monthLabel: monthLabelAr(month) },
        excluded: excluded.map((x) => ({
          employeeId: x.employeeId,
          name: byId.get(x.employeeId)?.name ?? "",
          reason: x.reason,
        })),
      },
      201
    );
  } catch (e) {
    console.error(e);
    return jsonError("تعذر توليد المسير", 500);
  }
}

function r3sum(a: number, b: number): number {
  return Math.round((a + b) * 100) / 100;
}
