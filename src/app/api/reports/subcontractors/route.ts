import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { reportSubcontractors } from "@/lib/report-server";

/** تقرير مقاولي الباطن الشامل — GET /api/reports/subcontractors */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "report_subcontractors");
  if ("response" in guard) return guard.response;

  const table = await reportSubcontractors();
  return ok(table);
}
