import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { reportExecution } from "@/lib/report-server";

/** مراحل التنفيذ — GET /api/reports/execution?option=stages|occupancy&contractType&stage */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "report_execution");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const table = await reportExecution({
    option: (sp.get("option") || "stages").trim(),
    contractType: (sp.get("contractType") || "").trim(),
    stage: (sp.get("stage") || "").trim(),
  });
  return ok(table);
}
