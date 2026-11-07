import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { quickPostBankLine } from "@/lib/bank-recon-server";

/**
 * Task 113 — النشر السريع لبند كشف غير مسجل
 * POST /api/reports/bank-reconciliation/quick-post { bankLineId, counterpartAccountId, description? }
 * يتبع قاعدة وضع الاعتماد (Task 112): تفعيل entryApprovalMode يجبر غير المدير على مسودة.
 */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_bank_recon");
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as {
    bankLineId?: number;
    counterpartAccountId?: number;
    description?: string;
  };
  const bankLineId = Number(body.bankLineId || 0);
  const counterpartAccountId = Number(body.counterpartAccountId || 0);
  if (!bankLineId || !counterpartAccountId) {
    return jsonError("بند الكشف والحساب المقابل مطلوبان.", 400);
  }

  try {
    const res = await quickPostBankLine(
      { bankLineId, counterpartAccountId, description: body.description },
      guard.user.username,
      guard.user.role
    );
    return ok(res);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "فشل نشر التسوية.", 400);
  }
}
