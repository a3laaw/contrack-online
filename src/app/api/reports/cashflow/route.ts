import { NextRequest } from "next/server";
import { authGuard, ok, parseDay, featureGuard } from "@/lib/api-utils";
import { REPORT_FEATURE } from "@/lib/report-features";
import { reportCashflow } from "@/lib/report-server";

/** التقرير المالي — GET /api/reports/cashflow?from&to&mode=detail|summary|receipts_only|payments_only|recoveries_only|transfers_only|daily|monthly (يُقبل yearly) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "report_cashflow");
  if ("response" in guard) return guard.response;

  // المرحلة 3/ب: بوابة الميزة rep_cashflow — تعطيلها يوقف التقرير خادميًا (كالمكتبي)
  const fGuard = await featureGuard(REPORT_FEATURE["cashflow"]!);
  if (fGuard) return fGuard;

  const sp = req.nextUrl.searchParams;
  const table = await reportCashflow({
    from: parseDay(sp.get("from")),
    to: parseDay(sp.get("to")),
    mode: (sp.get("mode") || "summary").trim(),
  });
  return ok(table);
}
