import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { reportSupervisionDelays } from "@/lib/report-server";

/** تقرير تأخير الإشراف — GET /api/reports/supervision-delays?option=unpaid|all */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "report_supervision_delays");
  if ("response" in guard) return guard.response;

  const option = (req.nextUrl.searchParams.get("option") || "unpaid").trim();
  const table = await reportSupervisionDelays({ option });
  return ok(table);
}
