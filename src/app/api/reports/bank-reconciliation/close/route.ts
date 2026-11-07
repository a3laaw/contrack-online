import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { closeBankRecon, listClosedBankRecons } from "@/lib/bank-recon-server";

/**
 * Task 113 — الإقفال الموثق للتسوية البنكية (مدير فقط — كنمط الإقفال السنوي)
 * POST /api/reports/bank-reconciliation/close { bankAccountId, asOf, statementBalance, tolerance?, window? }
 * يُرفض مع أي فرق غير مفسَّر — GET ?accountId= يسرد آخر الإقفالات.
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_bank_recon");
  if ("response" in guard) return guard.response;
  const accountId = Number(req.nextUrl.searchParams.get("accountId") || 0);
  try {
    return ok({ closed: await listClosedBankRecons(accountId || undefined) });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "فشل جلب السجل.", 400);
  }
}

export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_bank_recon");
  if ("response" in guard) return guard.response;
  if (!["admin", "developer"].includes(guard.user.role)) {
    return jsonError("إقفال التسوية البنكية محصور بالمدير.", 403);
  }
  const body = (await req.json().catch(() => ({}))) as {
    bankAccountId?: number;
    asOf?: string;
    statementBalance?: number;
    tolerance?: number;
    window?: number;
  };
  const bankAccountId = Number(body.bankAccountId || 0);
  const asOf = String(body.asOf || "").trim();
  const statementBalance = Number(body.statementBalance || 0);
  if (!bankAccountId || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return jsonError("حساب البنك وتاريخ التسوية مطلوبان.", 400);
  }
  if (!Number.isFinite(statementBalance)) return jsonError("رصيد الكشف يجب أن يكون رقمًا.", 400);

  try {
    const res = await closeBankRecon(
      {
        bankAccountId,
        asOf,
        statementBalance,
        tolerance: Number.isFinite(Number(body.tolerance)) ? Number(body.tolerance) : 0,
        windowDays: Number.isFinite(Number(body.window)) ? Number(body.window) : 15,
      },
      guard.user.username
    );
    return ok(res);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "فشل الإقفال.", 400);
  }
}
