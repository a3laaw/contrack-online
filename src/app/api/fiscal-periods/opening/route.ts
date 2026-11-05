import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { buildOpeningTrialBalance } from "@/lib/fiscal-close-server";

/**
 * ميزان افتتاحية السنة الجديدة — Task 109.
 * GET ?year=2026 ⇒ أرصدة الحسابات بنهاية 2025 (بعد إغلاق نتيجتها إن أُقفلت) —
 * الأستاذ المستمر يحمل الأرصدة آليًا؛ هذه الوثيقة للمراجعة والتوثيق في سجل الإقفال.
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_fiscal_close");
  if ("response" in guard) return guard.response;

  const year = Number(req.nextUrl.searchParams.get("year")) || 0;
  if (!year) return jsonError("حدد السنة المطلوب افتتاحيتها.", 400);

  const data = await buildOpeningTrialBalance(year);
  return ok(data);
}
