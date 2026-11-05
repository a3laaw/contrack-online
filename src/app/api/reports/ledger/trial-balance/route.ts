import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { buildTrialBalance } from "@/lib/accounting-reports-server";

/**
 * ميزان المراجعة حتى تاريخ — Task 108.
 * GET /api/reports/ledger/trial-balance?asOf=YYYY-MM-DD
 * التجميع بالـSQL حصرًا (groupBy على journal_line) — لا إعادة حساب في JS،
 * مع ملخّص بالنوع (أصول/التزامات/…) وبمركز التكلفة، وإظهار التوازن العام.
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_ledger");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const asOf = (sp.get("asOf") || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return jsonError("تاريخ الميزان (حتى) مطلوب بصيغة YYYY-MM-DD.", 400);
  }

  const result = await buildTrialBalance({ asOf });
  return ok(result);
}
