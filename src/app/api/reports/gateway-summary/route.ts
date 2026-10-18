import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { reportGatewaySummary } from "@/lib/report-server";

/** ملخص البوابة T+1 — GET /api/reports/gateway-summary (يُملأ ببيانات حقيقية في مرحلة البوابة) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "report_gateway_summary");
  if ("response" in guard) return guard.response;

  const table = await reportGatewaySummary();
  return ok(table);
}
