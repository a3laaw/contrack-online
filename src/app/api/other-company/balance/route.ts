import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { otherBalance } from "@/lib/gateway-server";

/** GET: رصيد الشركة الأخرى = افتتاحي + Σ مستحق صافي − Σ تسديدات (+ أرصدة جانبية) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_other_company");
  if ("response" in guard) return guard.response;
  const balance = await otherBalance();
  return ok(balance);
}

export const dynamic = "force-dynamic";
