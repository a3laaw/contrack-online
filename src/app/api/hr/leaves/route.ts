import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay } from "@/lib/api-utils";
import {
  HR_LEAVE_STATUSES,
  HR_LEAVE_TYPES,
  leaveDaysBetween,
  monthKeyOf,
  recountAnnualBalance,
  sickTierFor,
} from "@/lib/hr-constants";

const CONSUMED_STATUSES = ["معتمدة", "بدأت", "منتهية"];

/** ∑ أيام نوع إجازة مستهلكة لسنة معينة (معتمدة/بدأت/منتهية) لموظف */
async function consumedDays(employeeId: number, leaveType: string, year: number, beforeId?: number): Promise<number> {
  const rows = await db.employeeLeave.findMany({
    where: {
      employeeId,
      leaveType,
      status: { in: CONSUMED_STATUSES },
      startDate: { gte: `${year}-01-01`, lte: `${year}-12-31` },
    },
    select: { id: true, days: true },
  });
  return rows.filter((r) => r.id !== beforeId).reduce((s, r) => s + Number(r.days), 0);
}

/** GET: الإجازات — فلاتر employeeId/status/type + أرصدة سنوية محسوبة لكل موظف */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const employeeId = Number(req.nextUrl.searchParams.get("employeeId")) || 0;
  const status = req.nextUrl.searchParams.get("status") || "";
  const leaveType = req.nextUrl.searchParams.get("type") || "";

  const where: Record<string, unknown> = {};
  if (employeeId) where.employeeId = employeeId;
  if (status) {
    if (!(HR_LEAVE_STATUSES as readonly string[]).includes(status)) return jsonError("حالة إجازة غير معروفة");
    where.status = status;
  }
  if (leaveType) {
    if (!(HR_LEAVE_TYPES as readonly string[]).includes(leaveType)) return jsonError("نوع إجازة غير معروف");
    where.leaveType = leaveType;
  }

  const rows = await db.employeeLeave.findMany({
    where,
    orderBy: [{ startDate: "desc" }, { id: "desc" }],
    take: 2000,
    include: { employee: { select: { name: true, jobTitle: true, hireDate: true } } },
  });

  // الأرصدة السنوية لكل موظف ظهر في القائمة (سنة بداية آخر إجازة سنوية له)
  const balances = new Map<number, { allowance: number; consumed: number; balance: number; probation: boolean }>();
  const byEmployee = new Map<number, { hireDate: string; year: number }>();
  for (const r of rows) {
    if (r.leaveType !== "سنوية") continue;
    const year = Number(r.startDate.slice(0, 4));
    if (!byEmployee.has(r.employeeId) || byEmployee.get(r.employeeId)!.year < year) {
      byEmployee.set(r.employeeId, { hireDate: r.employee.hireDate, year });
    }
  }
  for (const [empId, info] of byEmployee) {
    const consumed = await consumedDays(empId, "سنوية", info.year);
    const b = recountAnnualBalance({ hireDate: info.hireDate, year: info.year, consumedApprovedDays: consumed });
    balances.set(empId, { allowance: b.allowance, consumed: b.consumed, balance: b.balance, probation: b.probation });
  }

  return ok({
    leaves: rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: r.employee.name,
      jobTitle: r.employee.jobTitle,
      leaveType: r.leaveType,
      startDate: r.startDate,
      endDate: r.endDate,
      days: Number(r.days),
      status: r.status,
      sickTier: r.sickTier,
      decisionBy: r.decisionBy,
      decisionAt: r.decisionAt,
      decisionNote: r.decisionNote,
      month: monthKeyOf(r.startDate),
    })),
    balances: Object.fromEntries(balances),
  });
}

/** POST: طلب إجازة — الأيام تُحسب آليًا شاملة الطرفين، وشرائح المرضية تُحتسب من المستهلك */
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

  const leaveType = String(body.leaveType || "");
  if (!(HR_LEAVE_TYPES as readonly string[]).includes(leaveType)) return jsonError("نوع الإجازة غير معروف");

  const startDate = parseDay(body.startDate);
  const endDate = parseDay(body.endDate);
  if (!startDate || !endDate) return jsonError("تاريخا الإجازة مطلوبان بصيغة YYYY-MM-DD");
  const days = leaveDaysBetween(startDate, endDate);
  if (days <= 0) return jsonError("تاريخ النهاية يجب أن يكون بعد البداية أو مساويًا له");

  // شرائح المرضية — من ∑ المرضية المستهلكة بالسنة قبل هذا الطلب
  let sickTier: number | null = null;
  if (leaveType === "مرضية") {
    const year = Number(startDate.slice(0, 4));
    const used = await consumedDays(employeeId, "مرضية", year);
    sickTier = sickTierFor(used).tier;
  }

  const created = await db.employeeLeave.create({
    data: { employeeId, leaveType, startDate, endDate, days, status: "معلقة", sickTier },
  });
  await audit(db, {
    username: guard.user.username,
    action: "طلب إجازة",
    entityType: "employee_leave",
    entityId: created.id,
    entityName: `${employee.name} — ${leaveType} ${days} يوم`,
  });
  return ok({ leave: created }, 201);
}
