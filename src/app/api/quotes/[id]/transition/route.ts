import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import {
  isQuotationStatus,
  quotationAllowedTargets,
  quotationTransitionBlockedMessage,
  QUOTATION_INVALID_STATUS,
} from "@/lib/quotes-core";
// ر3 — المزامنة الآلية مع الفرصة المرتبطة داخل معاملة الحدث (د4 — docs/opportunities-design.md)
import { autoStageForQuotationEvent, AUTO_LOST_REASON } from "@/lib/opportunities-core";

type P = { params: Promise<{ id: string }> };

/**
 * انتقال حالة عرض السعر — ر1/2 (docs/qc-completion-design.md — قرار المالك):
 * مصفوفة انتقالات تُحترم خادمًا (المرجع المكتبي كان any→any بلا مصفوفة)،
 * وغير الموجود في المجموعة ⇒ «حالة عرض السعر غير صحيحة.» والانتقال الممنوع
 * بالمصفوفة ⇒ رسالة الانتقال الممنوع. أثر الحالة «مقبول» واجهة فقط:
 * فتح معالج العقد المعبأ (وحدة qc) — لا عقد آلي خادمًا.
 * التدقيق إضافة ويب موثقة (المكتبي لا يدقق هذه الدالة).
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_customers");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف غير صالح");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const status = String(body.status ?? "").trim();
  if (!isQuotationStatus(status)) return jsonError(QUOTATION_INVALID_STATUS, 400);

  const existing = await db.quotation.findUnique({
    where: { id },
    select: { id: true, quotationNumber: true, status: true },
  });
  if (!existing) return jsonError("عرض السعر غير موجود", 404);
  // ر1/2 — حرس المصفوفة: الهدف من أهداف الحالة الحالية فقط
  if (!quotationAllowedTargets(existing.status).includes(status)) {
    return jsonError(quotationTransitionBlockedMessage(existing.status, status), 400);
  }

  const quotation = await db.$transaction(async (tx) => {
    const row = await tx.quotation.update({
      where: { id },
      data: { status },
      select: { id: true, quotationNumber: true, status: true },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "تغيير حالة عرض السعر",
      entityType: "quotation",
      entityId: row.id,
      entityName: row.quotationNumber,
      oldStatus: existing.status,
      newStatus: row.status,
    });
    // ر3 — قبول العرض ⇒ الفرصة «مقبولة» آليًا · رفضه ⇒ «مفقودة» بسبب افتراضي قابل للتعديل (د4)
    // — داخل معاملة حدث العرض نفسها (لا مسار كتابة ثانٍ)، والمقفلة لا تتحرك أصلًا
    if (status === "مقبول" || status === "مرفوض") {
      const opp = await tx.opportunity.findFirst({
        where: { quotationId: id },
        select: { id: true, opportunityNumber: true, stage: true, lostReason: true },
      });
      if (opp) {
        const event = status === "مقبول" ? "accepted" as const : "rejected" as const;
        const next = autoStageForQuotationEvent(opp.stage, event);
        if (next) {
          await tx.opportunity.update({
            where: { id: opp.id },
            data: {
              stage: next,
              ...(event === "rejected" && !String(opp.lostReason ?? "").trim() ? { lostReason: AUTO_LOST_REASON } : {}),
            },
          });
          await audit(tx, {
            username: guard.user.username,
            action: `تحديث مرحلة الفرصة إلى «${next}» — ${status === "مقبول" ? "قبول" : "رفض"} العرض`,
            entityType: "opportunity",
            entityId: opp.id,
            entityName: opp.opportunityNumber,
            oldStatus: opp.stage,
            newStatus: next,
          });
        }
      }
    }
    return row;
  });

  return ok({ quotation });
}
