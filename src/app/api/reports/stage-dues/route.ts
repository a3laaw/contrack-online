import { NextRequest } from "next/server";
import { authGuard, ok, featureGuard } from "@/lib/api-utils";
import { REPORT_FEATURE } from "@/lib/report-features";
import { reportStageDues } from "@/lib/report-server";

/** مستحقات العملاء بالمراحل — GET /api/reports/stage-dues?option=overdue|due|upcoming|all */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "report_stage_dues");
  if ("response" in guard) return guard.response;

  // المرحلة 3/ب: بوابة الميزة rep_dues_board — تعطيلها يوقف التقرير خادميًا (كالمكتبي)
  const fGuard = await featureGuard(REPORT_FEATURE["stage-dues"]!);
  if (fGuard) return fGuard;

  const option = (req.nextUrl.searchParams.get("option") || "all").trim();
  const table = await reportStageDues({ option });
  return ok(table);
}
