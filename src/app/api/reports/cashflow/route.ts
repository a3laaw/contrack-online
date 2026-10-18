import { NextRequest } from "next/server";
import { authGuard, ok, parseDay } from "@/lib/api-utils";
import { reportCashflow } from "@/lib/report-server";

/** التقرير المالي — GET /api/reports/cashflow?from&to&mode=detail|summary|daily|monthly (يُقبل yearly) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "report_cashflow");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const table = await reportCashflow({
    from: parseDay(sp.get("from")),
    to: parseDay(sp.get("to")),
    mode: (sp.get("mode") || "summary").trim(),
  });
  return ok(table);
}
