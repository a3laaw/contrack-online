import { NextRequest } from "next/server";
import { authGuard, ok, todayStr } from "@/lib/api-utils";
import { unmatchedBank } from "@/lib/gateway-server";

/** GET ?from=&to=&gateway= — سطور بنك بلا مقابل في أي يوم تحصيل (تحويلات/إيداعات أخرى) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_clearing");
  if ("response" in guard) return guard.response;
  const sp = req.nextUrl.searchParams;
  const today = todayStr();
  const to = (sp.get("to") || "").trim() || today;
  const from = (sp.get("from") || "").trim() || `${today.slice(0, 4)}-${today.slice(5, 7)}-01`;
  const lines = await unmatchedBank(from, to, (sp.get("gateway") || "").trim());
  return ok({ lines, totals: { count: lines.length, amount: lines.reduce((s, l) => s + Number(l.amount), 0) }, from, to });
}

export const dynamic = "force-dynamic";
