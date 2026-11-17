import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, moduleGuard, ok } from "@/lib/api-utils";
import { pipelineKpis } from "@/lib/opportunities-core";

/**
 * ر3 — مؤشرات خط الأنابيب (docs/opportunities-design.md §5):
 * عدد الفرص لكل مرحلة + المبلغ المتوقع المفتوح + معدل التحويل — حساب اشتقاقي
 * خالص بلا جداول عدادات (G9) بنمط summary الاستشارات.
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_opportunities");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "crm", "فرص البيع");
  if (mg) return mg;

  const rows = await db.opportunity.findMany({
    select: { stage: true, expectedAmount: true },
  });
  const summary = pipelineKpis(
    rows.map((r) => ({ stage: r.stage, expectedAmount: Number(r.expectedAmount) || 0 }))
  );
  return ok({ summary });
}
