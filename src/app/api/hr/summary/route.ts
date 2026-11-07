import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, moduleGuard, ok } from "@/lib/api-utils";
import { monthLabelAr } from "@/lib/hr-constants";

/** GET: ملخص HR — KPIs الشل (الموظفون النشطون / في إجازة الآن / إجازات معلقة / حالة مسير الشهر الحالي) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  const [activeEmployees, onLeaveNow, pendingLeaves, monthBatches] = await Promise.all([
    db.employee.count({ where: { active: true } }),
    db.employeeLeave.count({
      where: { status: { in: ["معتمدة", "بدأت"] }, startDate: { lte: today }, endDate: { gte: today } },
    }),
    db.employeeLeave.count({ where: { status: "معلقة" } }),
    db.payrollBatch.findMany({ where: { month, status: { not: "cancelled" } }, orderBy: { id: "desc" }, take: 1 }),
  ]);

  const batch = monthBatches[0]
    ? {
        id: monthBatches[0].id,
        month: monthBatches[0].month,
        status: monthBatches[0].status,
        netTotal: Number(monthBatches[0].netTotal),
        batchNo: monthBatches[0].batchNo,
        monthLabel: monthLabelAr(monthBatches[0].month),
      }
    : null;

  return ok({ activeEmployees, onLeaveNow, pendingLeaves, monthBatch: batch, today, month });
}
