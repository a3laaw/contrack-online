import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, jsonError, ok } from "@/lib/api-utils";
import { closeFiscalYearTx, reopenFiscalYearTx, TX_OPTS } from "@/lib/fiscal-close-server";

/**
 * الإقفال السنوي الموثق — Task 109 (للمدير فقط).
 * POST { action: "close", year, notes? }  ⇒ معاملة ذرية واحدة:
 *   قيد الإغلاق عبر المحرك الموحد ⇒ قفل فترات السنة ⇒ افتتاح السنة التالية ⇒ سجل موثق + تدقيق.
 * POST { action: "reopen", year, reason } ⇒ إعادة فتح آخر سنة مقفلة:
 *   إلغاء قيد الإغلاق بسبب موثق + فتح الفترات + تعليم السجل «معاد للفتح».
 */
export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  let body: { action?: unknown; year?: unknown; notes?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError("طلب غير صالح.", 400);
  }

  const year = Number(body.year) || 0;
  if (!year) return jsonError("سنة الإقفال مطلوبة.", 400);

  try {
    if (body.action === "close") {
      const result = await db.$transaction(
        (tx) => closeFiscalYearTx(tx, year, guard.user.username, String(body.notes || "")),
        TX_OPTS
      );
      return ok({ closed: true, ...result });
    }
    if (body.action === "reopen") {
      const result = await db.$transaction(
        (tx) => reopenFiscalYearTx(tx, year, guard.user.username, String(body.reason || "")),
        TX_OPTS
      );
      return ok({ reopened: true, ...result });
    }
    return jsonError("إجراء غير معروف — close أو reopen.", 400);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "تعذر تنفيذ الإجراء.", 400);
  }
}
