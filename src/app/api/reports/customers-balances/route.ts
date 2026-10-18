import { NextRequest } from "next/server";
import { authGuard, ok, parseDay } from "@/lib/api-utils";
import { reportCustomersBalances } from "@/lib/report-server";

/** تقرير العملاء والأرصدة — GET /api/reports/customers-balances?option=all|with_balance|no_balance|due_only|by_stages&from&to */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "report_customers_balances");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const table = await reportCustomersBalances({
    option: (sp.get("option") || "all").trim(),
    from: parseDay(sp.get("from")),
    to: parseDay(sp.get("to")),
  });
  return ok(table);
}
