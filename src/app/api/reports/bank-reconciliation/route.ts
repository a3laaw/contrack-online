import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { computeBankRecon } from "@/lib/bank-recon-server";

/**
 * Task 113 — التسوية البنكية — GET /api/reports/bank-reconciliation
 * ?bankAccountId=&asOf=YYYY-MM-DD&statementBalance=&tolerance=&window=
 * الحساب الحي: مطابقة بنود الكشف مع حركات الدفتر + المعادلة والفوارق — بلا حالة محفوظة.
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_bank_recon");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const bankAccountId = Number(sp.get("bankAccountId") || 0);
  const asOf = (sp.get("asOf") || "").trim();
  const statementBalance = Number(sp.get("statementBalance") || 0);
  const tolerance = Number(sp.get("tolerance") || 0);
  const windowDays = Number(sp.get("window") || 15);
  if (!bankAccountId) return jsonError("اختر حساب البنك أولًا.", 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return jsonError("تاريخ التسوية مطلوب بصيغة YYYY-MM-DD.", 400);
  if (!Number.isFinite(statementBalance)) return jsonError("رصيد الكشف يجب أن يكون رقمًا (سحب بالإشارة السالبة).", 400);

  try {
    const result = await computeBankRecon({
      bankAccountId,
      asOf,
      statementBalance,
      tolerance: Number.isFinite(tolerance) ? tolerance : 0,
      windowDays: Number.isFinite(windowDays) ? windowDays : 15,
    });
    return ok(result);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "فشل حساب التسوية.", 400);
  }
}
