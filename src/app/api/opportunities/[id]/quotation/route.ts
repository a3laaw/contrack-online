import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { buildOpportunityQuotePreset } from "@/lib/opportunities-core";

type P = { params: Promise<{ id: string }> };

/**
 * ر3 — «إصدار عرض سعر من الفرصة» (docs/opportunities-design.md §5 د4):
 * يعيد حمولة تعبئة معالج العرض القائم حرفيًا (لا شاشة عروض ثانية — G3) —
 * والربط الفعلي + رفع المرحلة يحدثان داخل معاملة إنشاء العرض (POST /api/quotes
 * بـopportunityId) كي تبقى كل كتابة الحدث في معاملة واحدة.
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_opportunities");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "crm", "فرص البيع");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف غير صالح");

  const row = await db.opportunity.findUnique({
    where: { id },
    select: {
      id: true, opportunityNumber: true, name: true, stage: true, quotationId: true,
      customer: { select: { id: true, name: true } },
    },
  });
  if (!row) return jsonError("الفرصة غير موجودة", 404);
  // المقفلة (مقبولة/مفقودة) لا يُصدر منها عرض — والمنتَظرة «عُرض عليها» تعيد الحمولة للتعديل/إعادة الإصدار
  if (row.stage === "مقبولة" || row.stage === "مفقودة") {
    return jsonError("الفرصة مقفلة — لا يُصدر منها عرض جديد.", 400);
  }
  return ok({
    preset: buildOpportunityQuotePreset({
      id: row.id,
      opportunityNumber: row.opportunityNumber,
      name: row.name,
      customerId: row.customer?.id ?? null,
      customerName: row.customer?.name ?? "",
    }),
  });
}
