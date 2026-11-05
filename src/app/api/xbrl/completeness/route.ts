import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { buildFinancialStatements } from "@/lib/financial-statements-server";
import { checkCoverage } from "@/lib/xbrl-core";

export const runtime = "nodejs";

/**
 * تقرير اكتمال خريطة XBRL — Task 111 — GET /api/xbrl/completeness?asOf=YYYY-MM-DD&from=
 * كل سطر قائمة بقيمة ≠ 0 يجب أن يحمل عنصر xbrlElement — يعيد قائمة «العناصر غير المغطاة».
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_zakat_xbrl");
  if ("response" in guard) return guard.response;
  const sp = req.nextUrl.searchParams;
  const asOf = (sp.get("asOf") || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return jsonError("تاريخ القوائم (حتى) مطلوب بصيغة YYYY-MM-DD.", 400);
  const from = (sp.get("from") || "").trim();
  const fs = await buildFinancialStatements({ asOf, from: from || undefined });
  const coverage = checkCoverage({
    income: fs.income,
    balanceSheet: fs.balanceSheet,
    equity: fs.equity,
    cashflow: fs.cashflow,
  });
  return ok({ asOf, from: fs.from, ...coverage });
}
