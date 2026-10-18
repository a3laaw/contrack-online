import { NextRequest } from "next/server";
import { authGuard, ok, parseDay } from "@/lib/api-utils";
import { reportExpenses } from "@/lib/report-server";

/** تفصيل المصروفات بشجرة الحسابات — GET /api/reports/expenses?from&to */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "report_expenses");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const table = await reportExpenses({
    from: parseDay(sp.get("from")),
    to: parseDay(sp.get("to")),
  });
  return ok(table);
}
