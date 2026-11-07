import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { listBankKeys, setBankMap } from "@/lib/bank-recon-server";

/**
 * Task 113 — خرائط كشوف البنك
 * GET  /api/reports/bank-reconciliation/mappings — المفاتيح الموجودة في bank_lines وحالتها
 * POST { bankKey, accountId } — ربط/تعديل (مدير فقط — يؤثر على موضع القيود)
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_bank_recon");
  if ("response" in guard) return guard.response;
  try {
    return ok({ keys: await listBankKeys() });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "فشل جلب المفاتيح.", 400);
  }
}

export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_bank_recon");
  if ("response" in guard) return guard.response;
  if (!["admin", "developer"].includes(guard.user.role)) {
    return jsonError("ربط كشوف البنك بالدليل محصور بالمدير.", 403);
  }
  const body = (await req.json().catch(() => ({}))) as { bankKey?: string; accountId?: number };
  const bankKey = String(body.bankKey || "").trim();
  const accountId = Number(body.accountId || 0);
  if (!bankKey || !accountId) return jsonError("مفتاح الكشف والحساب مطلوبان.", 400);
  try {
    await setBankMap(bankKey, accountId, guard.user.username);
    return ok({ message: `رُبط «${bankKey}» بالحساب.` });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "فشل الربط.", 400);
  }
}
