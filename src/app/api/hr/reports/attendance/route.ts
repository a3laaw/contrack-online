import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { attendanceLabel, monthEndDate, monthLabelAr } from "@/lib/hr-constants";

/** GET: مصفوفة الحضور الشهرية (month) — موظفون × أيام + إجماليات كل موظف */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const month = req.nextUrl.searchParams.get("month") || "";
  if (!/^\d{4}-\d{2}$/.test(month)) return jsonError("صيغة الشهر غير صالحة (YYYY-MM)");
  const first = `${month}-01`;
  const last = monthEndDate(month);

  const employees = await db.employee.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, jobNumber: true, jobTitle: true },
  });
  const records = await db.employeeAttendance.findMany({
    where: { workDate: { gte: first, lte: last }, employeeId: { in: employees.map((e) => e.id) } },
    orderBy: { workDate: "asc" },
    select: { employeeId: true, workDate: true, status: true, lateMinutes: true },
  });

  const daysInMonth = Number(last.slice(8));
  const days = Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const byKey = new Map(records.map((r) => [`${r.employeeId}|${r.workDate}`, r]));

  const rows = employees.map((e) => {
    const cells = days.map((d) => {
      const r = byKey.get(`${e.id}|${d}`);
      return r
        ? { status: r.status, statusLabel: attendanceLabel(r.status), lateMinutes: Math.max(0, r.lateMinutes) }
        : null;
    });
    const totals = {
      present: cells.filter((c) => c?.status === "present").length,
      absent: cells.filter((c) => c?.status === "absent").length,
      justified: cells.filter((c) => c?.status === "justified_absent").length,
      leave: cells.filter((c) => c?.status === "leave").length,
      holiday: cells.filter((c) => c?.status === "holiday").length,
      lateMinutes: cells.reduce((s, c) => s + (c?.lateMinutes ?? 0), 0),
    };
    return { employeeId: e.id, name: e.name, jobNumber: e.jobNumber, jobTitle: e.jobTitle, cells, totals };
  });

  return ok({ month, monthLabel: monthLabelAr(month), days, rows });
}
