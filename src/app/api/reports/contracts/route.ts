import { NextRequest } from "next/server";
import { authGuard, ok, parseDay, featureGuard } from "@/lib/api-utils";
import { REPORT_FEATURE } from "@/lib/report-features";
import { reportContracts } from "@/lib/report-server";

/** تقارير العقود — GET /api/reports/contracts?option=all|profitability|by_type|expiring&from&to */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "report_contracts");
  if ("response" in guard) return guard.response;

  // المرحلة 3/ب: بوابة الميزة rep_contracts — تعطيلها يوقف التقرير خادميًا (كالمكتبي)
  const fGuard = await featureGuard(REPORT_FEATURE["contracts"]!);
  if (fGuard) return fGuard;

  const sp = req.nextUrl.searchParams;
  const table = await reportContracts({
    option: (sp.get("option") || "all").trim(),
    from: parseDay(sp.get("from")),
    to: parseDay(sp.get("to")),
  });
  return ok(table);
}
