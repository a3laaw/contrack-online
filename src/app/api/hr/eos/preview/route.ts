import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, moduleGuard, ok, parseDay, todayStr } from "@/lib/api-utils";
import { computeEos, eosScenarioByValue } from "@/lib/hr-eos-core";
import { leaveBalanceAtEnd } from "@/lib/hr-server";

/**
 * POST: معاينة حسبة نهاية الخدمة بلا توثيق — نفس النواة المعتمدة في التوثيق.
 * body: { employeeId, endDate, scenario, agreementAmount? }
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
  if (!eosScenarioByValue(scenario)) return jsonError("السيناريو غير معروف");

  const approvedDays = await db.employeeLeave.aggregate({
    where: { employeeId, leaveType: "سنوية", status: { in: ["معتمدة", "بدأت", "منتهية"] }, startDate: { lte: endDate } },
    _sum: { days: true },
  });
  const balance = leaveBalanceAtEnd(employee, endDate, Number(approvedDays._sum.days ?? 0));

  const agreementAmount = body.agreementAmount != null && scenario === "اتفاق الطرفين" ? Number(body.agreementAmount) : null;
  const calc = computeEos({
    wage: Number(employee.salary),
    hireDate: employee.hireDate,
    endDate,
    scenario,
    leaveBalanceDays: balance.balance,
    agreementAmount,
  });

  return ok({
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
    employee: { id: employee.id, name: employee.name, salary: Number(employee.salary), hireDate: employee.hireDate },
  });
}
