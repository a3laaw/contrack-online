import { NextRequest } from "next/server";
import { authGuard, ok, featureGuard } from "@/lib/api-utils";
import { REPORT_FEATURE } from "@/lib/report-features";
import { reportSupervisionDelays } from "@/lib/report-server";

/** تقرير تأخير الإشراف — GET /api/reports/supervision-delays?option=unpaid|all */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "report_supervision_delays");
  if ("response" in guard) return guard.response;

  // المرحلة 3/ب: بوابة الميزة rep_supervision_delay — تعطيلها يوقف التقرير خادميًا (كالمكتبي)
  const fGuard = await featureGuard(REPORT_FEATURE["supervision-delays"]!);
  if (fGuard) return fGuard;

  const option = (req.nextUrl.searchParams.get("option") || "unpaid").trim();
  const table = await reportSupervisionDelays({ option });
  return ok(table);
}
