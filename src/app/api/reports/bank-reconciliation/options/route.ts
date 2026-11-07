import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { db } from "@/lib/db";
import { listBankKeys, listClosedBankRecons } from "@/lib/bank-recon-server";

/**
 * Task 113 — خيارات شاشة التسوية
 * GET /api/reports/bank-reconciliation/options
 * حسابات البنوك (111x ورقية نشطة) + الحسابات المقابلة المتاحة + المفاتيح + آخر الإقفالات
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_bank_recon");
  if ("response" in guard) return guard.response;

  try {
    const accounts = await db.account.findMany({
      where: { isActive: true, isLeaf: true, allowPosting: true },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: "asc" },
    });
    const bankAccounts = accounts.filter((a) => a.type === "asset" && a.code.startsWith("111"));
    const counterpartAccounts = accounts;
    const [keys, closed] = await Promise.all([listBankKeys(), listClosedBankRecons()]);
    return ok({ bankAccounts, counterpartAccounts, keys, closed });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "فشل جلب الخيارات.", 400);
  }
}
