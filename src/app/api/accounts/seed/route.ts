import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { ensureChartOfAccounts } from "@/lib/accounting-server";

/**
 * بذر الدليل الكويتي القياسي — Task 102.
 * POST: يبذر الشركة الفارغة فقط (عديم الأثر التكراري) — الشركات المبذورة تعيد عددها.
 */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_chart_of_accounts");
  if ("response" in guard) return guard.response;

  const result = await ensureChartOfAccounts();
  if (!result.seeded) {
    return jsonError("دليل الشركة مبذور مسبقًا — لا بذر مكرر.", 409);
  }

  await db.$transaction(async (tx) => {
    await audit(tx, {
      username: guard.user.username,
      action: "بذر دليل الحسابات الكويتي القياسي",
      entityType: "account",
      entityName: `دليل الحسابات (${result.count} حسابًا)`,
      newStatus: "seeded",
    });
  });

  return ok({ seeded: true, count: result.count });
}
