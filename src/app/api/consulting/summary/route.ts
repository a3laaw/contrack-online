import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, moduleGuard, ok, todayStr } from "@/lib/api-utils";
import { LICENSE_WARN_DAYS, licenseDaysLeft } from "@/lib/consulting-constants";
import { r3 } from "@/lib/contrack-core";

/**
 * GET: مؤشرات الاستشارات الرأسية — تُغذي بطاقات المؤشرات وتنبيه التراخيص:
 * الفريق (نشط/الكل) · ساعات الشهر الحالي · إسنادات سارية · إجازات معلقة · في إجازة الآن ·
 * التراخيص القريبة الانتهاء (خلال LICENSE_WARN_DAYS أو منتهية حديثًا)
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;

  const today = todayStr();
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-`;

  const [engineers, monthHours, activeAssignments, pendingLeaves, onVacationNow] = await Promise.all([
    db.engineer.findMany({
      where: { licenseExpiry: { not: "" } },
      select: { id: true, name: true, licenseNo: true, licenseExpiry: true },
    }),
    db.engineerTimesheet.aggregate({ where: { workDate: { startsWith: monthPrefix } }, _sum: { hours: true } }),
    db.engineerAssignment.count({ where: { status: "سارية" } }),
    db.engineerLeave.count({ where: { status: "معلقة" } }),
    db.engineerLeave.count({
      where: { status: "معتمدة", startDate: { lte: today }, endDate: { gte: today } },
    }),
  ]);

  const [teamTotal, teamActive] = await Promise.all([
    db.engineer.count(),
    db.engineer.count({ where: { status: "نشط" } }),
  ]);

  // التراخيص القريبة من الانتهاء أو المنتهية — الأقرب انتهاءً أولًا
  const expiring = engineers
    .map((e) => {
      const daysLeft = licenseDaysLeft(e.licenseExpiry);
      return {
        id: e.id,
        name: e.name,
        licenseNo: e.licenseNo,
        licenseExpiry: e.licenseExpiry,
        daysLeft,
        expired: daysLeft < 0,
      };
    })
    .filter((e) => e.daysLeft <= LICENSE_WARN_DAYS)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  return ok({
    kpis: {
      teamTotal,
      teamActive,
      monthHours: r3(Number(monthHours._sum.hours || 0)),
      activeAssignments,
      pendingLeaves,
      onVacationNow,
    },
    expiring,
  });
}
