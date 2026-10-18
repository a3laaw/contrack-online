import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { GATEWAY_STATUS_LABELS, CLEARING_STATUS_LABELS, gatewaySummary, listProfiles } from "@/lib/gateway-server";

/** GET ?from=&to= — ملخص البوابة: معلقة T+1 / محصلة اليوم / متأخرة (lateDays فات التسديد) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_gateway");
  if ("response" in guard) return guard.response;
  const sp = req.nextUrl.searchParams;
  const summary = await gatewaySummary((sp.get("from") || "").trim(), (sp.get("to") || "").trim());
  const profiles = await listProfiles(false);
  return ok({ summary, profiles, statusLabels: GATEWAY_STATUS_LABELS, clearingLabels: CLEARING_STATUS_LABELS });
}

export const dynamic = "force-dynamic";
