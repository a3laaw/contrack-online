import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { listGatewayOps } from "@/lib/gateway-server";

/** GET ?gateway=&filter=mine|other|unmarked|distributed|pending|all&q=&from=&to=
 *  قائمة عمليات البوابة بأعمدتها (الإجمالي/العمولة/الصافي/المسدد/المتبقي) وروابط التوزيع */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_gateway");
  if ("response" in guard) return guard.response;
  const sp = req.nextUrl.searchParams;
  const rows = await listGatewayOps({
    gateway: (sp.get("gateway") || "").trim(),
    filter: (sp.get("filter") || "all").trim(),
    q: (sp.get("q") || "").trim(),
    from: (sp.get("from") || "").trim(),
    to: (sp.get("to") || "").trim(),
  });
  const totals = {
    count: rows.length,
    amount: rows.reduce((s, r) => s + Number(r.amount || 0), 0),
    net: rows.reduce((s, r) => s + Number(r.net || 0), 0),
  };
  return ok({ ops: rows, totals });
}

export const dynamic = "force-dynamic";
