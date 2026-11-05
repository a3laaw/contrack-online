import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { buildFinancialStatements } from "@/lib/financial-statements-server";

export const runtime = "nodejs";

/**
 * القوائم المالية الكويتية الموحدة (القرار الوزاري 44/2016) — Task 110.
 * GET /api/reports/financial-statements?asOf=YYYY-MM-DD&from=YYYY-MM-DD
 *  • asOf — تاريخ المركز المالي وإقفال كل القوائم (إلزامي)
 *  • from — بداية فترة الدخل/الحركة (اختياري — الافتراضي أول سنة asOf)
 * تُبنى حصرًا من الأستاذ (قيود posted + افتتاحي الحسابات) مع فحوص توازن موثقة:
 *   ميزان المراجعة متوازن · المركز متوازن · التدفقات تطابق النقد · الملكية متسقة.
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_financial_statements");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const asOf = (sp.get("asOf") || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return jsonError("تاريخ القوائم (حتى) مطلوب بصيغة YYYY-MM-DD.", 400);
  }
  const from = (sp.get("from") || "").trim();

  const result = await buildFinancialStatements({ asOf, from: from || undefined });
  return ok(result);
}
