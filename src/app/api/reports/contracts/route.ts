import { NextRequest } from "next/server";
import { authGuard, ok, parseDay } from "@/lib/api-utils";
import { reportContracts } from "@/lib/report-server";

/** تقارير العقود — GET /api/reports/contracts?option=all|profitability|by_type|expiring&from&to */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "report_contracts");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const table = await reportContracts({
    option: (sp.get("option") || "all").trim(),
    from: parseDay(sp.get("from")),
    to: parseDay(sp.get("to")),
  });
  return ok(table);
}
