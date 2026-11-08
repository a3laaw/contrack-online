import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay, todayStr } from "@/lib/api-utils";
import { EOS_SCENARIOS, computeEos, eosScenarioByValue } from "@/lib/hr-eos-core";
import { leaveBalanceAtEnd } from "@/lib/hr-server";
import { monthLabelAr } from "@/lib/hr-constants";

/** GET: قائمة توثيقات نهاية الخدمة (الأحدث أولًا — 200) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const rows = await db.employeeTermination.findMany({
    orderBy: { id: "desc" },
    take: 200,
    include: { employee: { select: { name: true, jobNumber: true, jobTitle: true } } },
  });

  return ok({
    terminations: rows.map((t) => ({
      id: t.id,
      employeeId: t.employeeId,
      employeeName: t.employee.name,
      jobNumber: t.employee.jobNumber,
      jobTitle: t.employee.jobTitle,
      endDate: t.endDate,
      scenario: t.scenario,
      serviceYears: Number(t.serviceYears),
      wageAtEnd: Number(t.wageAtEnd),
      eosAmount: Number(t.eosAmount),
      leaveEncashment: Number(t.leaveEncashment),
      total: Number(t.total),
      status: t.status,
      entryId: t.entryId,
      decidedBy: t.decidedBy,
      decidedAt: t.decidedAt,
      notes: t.notes,
      cancelReason: t.cancelReason,
    })),
  });
}

/**
 * POST: توثيق نهاية خدمة بحالة «محسوبة» — الحسبة نقية بالقانون 6/2010 (د4):
 * رصيد الإجازات يُعاد حسابه لحظة النهاية (G9) — والموظف يبقى نشطًا حتى الاستقرار.
 */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const employeeId = Number(body.employeeId);
  if (!Number.isFinite(employeeId)) return jsonError("اختر الموظف أولًا");
  const employee = await db.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return jsonError("الموظف غير موجود", 404);
  if (!employee.hireDate) return jsonError("الموظف بلا تاريخ تعيين — أكمل الملف أولًا");

  const endDate = parseDay(body.endDate);
  if (!endDate) return jsonError("تاريخ نهاية الخدمة غير صالح");
  if (endDate > todayStr()) return jsonError("تاريخ النهاية لا يكون مستقبليًا");
  if (employee.hireDate > endDate) return jsonError("تاريخ النهاية قبل تاريخ التعيين");

  const scenario = String(body.scenario || "");
  const def = eosScenarioByValue(scenario);
  if (!def) return jsonError(`السيناريو غير معروف — المسموح: ${EOS_SCENARIOS.map((s) => s.value).join(" · ")}`);

  const open = await db.employeeTermination.findFirst({
    where: { employeeId, status: "محسوبة" },
    select: { id: true },
  });
  if (open) return jsonError("يوجد توثيق نهاية خدمة محسوب لهذا الموظف — ألغه أو استقره أولًا");

  // رصيد السنوي المتبقي: المعتمد/الجاري المستهلك حتى تاريخ النهاية
  const approvedDays = await db.employeeLeave.aggregate({
    where: { employeeId, leaveType: "سنوية", status: { in: ["معتمدة", "بدأت", "منتهية"] }, startDate: { lte: endDate } },
    _sum: { days: true },
  });
  const balance = leaveBalanceAtEnd(employee, endDate, Number(approvedDays._sum.days ?? 0));

  const agreementAmount = body.agreementAmount != null && scenario === "اتفاق الطرفين" ? Number(body.agreementAmount) : null;
  if (agreementAmount != null && (!Number.isFinite(agreementAmount) || agreementAmount < 0)) {
    return jsonError("مبلغ الاتفاق يجب أن يكون رقمًا غير سالب");
  }

  const calc = computeEos({
    wage: Number(employee.salary),
    hireDate: employee.hireDate,
    endDate,
    scenario,
    leaveBalanceDays: balance.balance,
    agreementAmount,
  });

  const notes = String(body.notes || "").trim();
  const created = await db.employeeTermination.create({
    data: {
      employeeId,
      endDate,
      scenario,
      serviceYears: calc.years,
      wageAtEnd: Number(employee.salary),
      eosAmount: calc.gratuity,
      leaveEncashment: calc.leaveEncashment,
      total: calc.total,
      status: "محسوبة",
      decidedBy: guard.user.username,
      decidedAt: new Date().toISOString(),
      notes,
    },
  });
  await audit(db, {
    username: guard.user.username,
    action: "توثيق نهاية خدمة",
    entityType: "employee_termination",
    entityId: created.id,
    entityName: `${employee.name} — ${scenario} · ${calc.years} سنة · الإجمالي ${calc.total} د.ك`,
  });
  return ok(
    {
      termination: created,
      calc: {
        years: calc.years,
        fullGratuity: calc.fullGratuity,
        capped: calc.capped,
        fractionApplied: calc.fractionApplied,
        gratuity: calc.gratuity,
        leaveEncashment: calc.leaveEncashment,
        total: calc.total,
        leaveBalance: balance.balance,
      },
      monthLabel: monthLabelAr(endDate.slice(0, 7)),
    },
    201
  );
}
