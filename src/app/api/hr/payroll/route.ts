import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { employeeAdvanceRemaining } from "@/lib/voucher-server";
import {
  computePayrollRecord,
  monthEndDate,
  monthLabelAr,
  overlapDaysInMonth,
  PayrollCalcEmployee,
  PayrollCalcExcluded,
  PayrollCalcResult,
  sumPayrollRecords,
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
      attendances: { where: { workDate: { gte: `${month}-01`, lte: `${month}-31` } }, select: { status: true } },
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

  const calcInputs: PayrollCalcEmployee[] = [];
  for (const e of employees) {
    const presentDays = e.attendances.filter((a) => a.status === "present").length;
    const unjustifiedAbsenceDays = e.attendances.filter((a) => a.status === "absent").length;
    const unpaidLeaveDays = unpaidLeaves
      .filter((l) => l.employeeId === e.id)
      .reduce((s, l) => s + overlapDaysInMonth(l.startDate, l.endDate, first, last), 0);
    const advanceRemaining = await employeeAdvanceRemaining(db, e.id);
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
            baseAmount: r.baseAmount,
            absenceDeduction: r.absenceDeduction,
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
