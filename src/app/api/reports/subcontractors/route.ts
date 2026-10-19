import { NextRequest } from "next/server";
import { authGuard, ok, featureGuard } from "@/lib/api-utils";
import { REPORT_FEATURE } from "@/lib/report-features";
import { reportSubcontractors } from "@/lib/report-server";

/** تقرير مقاولي الباطن الشامل — GET /api/reports/subcontractors */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "report_subcontractors");
  if ("response" in guard) return guard.response;

  // المرحلة 3/ب: بوابة الميزة rep_subcontractors — تعطيلها يوقف التقرير خادميًا (كالمكتبي)
  const fGuard = await featureGuard(REPORT_FEATURE["subcontractors"]!);
  if (fGuard) return fGuard;

  const table = await reportSubcontractors();
  return ok(table);
}
