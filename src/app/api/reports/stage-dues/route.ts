import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { reportStageDues } from "@/lib/report-server";

/** مستحقات العملاء بالمراحل — GET /api/reports/stage-dues?option=overdue|due|upcoming|all */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "report_stage_dues");
  if ("response" in guard) return guard.response;

  const option = (req.nextUrl.searchParams.get("option") || "all").trim();
  const table = await reportStageDues({ option });
  return ok(table);
}
