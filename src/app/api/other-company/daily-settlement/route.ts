import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { otherDailySettlement } from "@/lib/gateway-server";

/** GET ?from&to — التسوية اليومية للشركة الأخرى: لكل يوم مستحق اليوم/المسدد له/الفرق التراكمي */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_other_company");
  if ("response" in guard) return guard.response;
  const sp = req.nextUrl.searchParams;
  const result = await otherDailySettlement((sp.get("from") || "").trim(), (sp.get("to") || "").trim());
  // الفرق التراكمي لكل يوم: مستحق تراكمي − مسدد تراكمي
  let cumDue = 0;
  let cumPaid = 0;
  const days = (result.days as Record<string, unknown>[]).map((d) => {
    cumDue = Math.round((cumDue + Number(d.net || 0)) * 1000) / 1000;
    cumPaid = Math.round((cumPaid + Number(d.paid || 0)) * 1000) / 1000;
    return { ...d, cumulative_due: cumDue, cumulative_paid: cumPaid, cumulative_diff: Math.round((cumDue - cumPaid) * 1000) / 1000 };
  });
  return ok({ days, totals: result.totals, transfers: result.transfers, transfersTotal: result.transfersTotal });
}

export const dynamic = "force-dynamic";
