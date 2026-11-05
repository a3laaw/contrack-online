import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { buildGeneralLedger } from "@/lib/accounting-reports-server";

/**
 * دفتر الأستاذ لأي حساب — Task 108.
 * GET /api/reports/ledger/general?accountId=&from=&to=&customerId=&contractId=&subContractId=&costCenter=
 * الحركات من القيود posted حصرًا + رصيد جارٍ + فلاتر الأبعاد التحليلية.
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_ledger");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const accountId = Number(sp.get("accountId") || 0);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return jsonError("اختيار الحساب مطلوب لعرض دفتر الأستاذ.", 400);
  }

  const strParam = (k: string): string => (sp.get(k) || "").trim();
  const from = strParam("from");
  const to = strParam("to");
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) {
    return jsonError("صيغة التاريخ غير صحيحة.", 400);
  }
  const customerId = Number(sp.get("customerId") || 0) || undefined;
  const contractId = Number(sp.get("contractId") || 0) || undefined;
  const subContractId = Number(sp.get("subContractId") || 0) || undefined;
  const costCenter = strParam("costCenter") || undefined;

  const exists = await db.account.findFirst({ where: { id: accountId }, select: { id: true } });
  if (!exists) return jsonError("الحساب غير موجود في دليل الشركة.", 404);

  const result = await buildGeneralLedger({ accountId, from, to, customerId, contractId, subContractId, costCenter });
  if (!result) return jsonError("الحساب غير موجود في دليل الشركة.", 404);
  return ok(result);
}
