// GET /api/warehouses/balances — الأرصدة الاشتقاقية (صنف×مستودع) حتى تاريخ اختياري — G9: محسوبة لا مخزنة
import { NextRequest } from "next/server";
import { authGuard, moduleGuard, ok, parseDay } from "@/lib/api-utils";
import { loadBalances } from "@/lib/warehouses-server";

export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_warehouses");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "warehouses", "المخازن");
  if (mg) return mg;

  const asOf = parseDay(req.nextUrl.searchParams.get("asOf") ?? "") || undefined;
  const { balances, totals } = await loadBalances(asOf);
  return ok({ balances, totals });
}
