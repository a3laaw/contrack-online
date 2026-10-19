import { NextRequest } from "next/server";
import { authGuard, ok, parseDay, featureGuard } from "@/lib/api-utils";
import { REPORT_FEATURE } from "@/lib/report-features";
import { reportCustomersBalances } from "@/lib/report-server";

/** تقرير العملاء والأرصدة — GET /api/reports/customers-balances?option=all|with_balance|no_balance|due_only|by_stages&from&to */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "report_customers_balances");
  if ("response" in guard) return guard.response;

  // المرحلة 3/ب: بوابة الميزة rep_customers — تعطيلها يوقف التقرير خادميًا (كالمكتبي)
  const fGuard = await featureGuard(REPORT_FEATURE["customers-balances"]!);
  if (fGuard) return fGuard;

  const sp = req.nextUrl.searchParams;
  const table = await reportCustomersBalances({
    option: (sp.get("option") || "all").trim(),
    from: parseDay(sp.get("from")),
    to: parseDay(sp.get("to")),
  });
  return ok(table);
}
