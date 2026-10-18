import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { otherLedger } from "@/lib/gateway-server";

/** GET ?from&to — دفتر حساب الشركة الأخرى: افتتاحي + مستحق/مسدد برصيد تراكمي */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_other_company");
  if ("response" in guard) return guard.response;
  const sp = req.nextUrl.searchParams;
  const ledger = await otherLedger((sp.get("from") || "").trim(), (sp.get("to") || "").trim());
  return ok(ledger);
}

export const dynamic = "force-dynamic";
