/**
 * opportunities-core.ts — النواة النقية لر3 «فرص البيع» (docs/opportunities-design.md §4):
 * دوال خالصة بلا DB ولا React — تُختبَر bun قبل أي ربط (نمط consulting-v1).
 */

import {
  OPPORTUNITY_LOST_REASONS,
  OPPORTUNITY_LOST_REASON_REQUIRED,
  OPPORTUNITY_QUOTED_STAGE,
  opportunityTransitionBlockedMessage,
  opportunityTransitionAllowed,
} from "./opportunities-constants";

/** صف مختصر للفرصة يكفي للمؤشرات (المبالغ تصل أرقامًا من الخلفي) */
export interface OpportunityKpiRow {
  stage: string;
  expectedAmount: number;
}

export interface PipelineKpis {
  /** عدد الفرص في كل مرحلة (كل مفردات المراحل موجودة بمفتاحها حتى لو صفر) */
  byStage: Record<string, number>;
  /** مجموع المبالغ المتوقعة للفرص المفتوحة (غير المقفلة) */
  openExpected: number;
  /** عدد الفرص المقفلة (مقبولة + مفقودة) */
  closedCount: number;
  /** عدد الفرص المقبولة */
  wonCount: number;
  /** عدد الفرص المفقودة */
  lostCount: number;
  /** معدل التحويل = مقبولة ÷ المقفلة (0 إن لم تقفل شيء) */
  conversionRate: number;
}

/** حساب اشتقاقي خالص لمؤشرات خط الأنابيب — بلا جداول عدادات (G9) */
export function pipelineKpis(rows: OpportunityKpiRow[]): PipelineKpis {
  const byStage: Record<string, number> = {};
  for (const stage of ["جديدة", "مؤهَّلة", "عُرض عليها", "مقبولة", "مفقودة"]) byStage[stage] = 0;
  let openExpected = 0;
  let wonCount = 0;
  let lostCount = 0;
  for (const r of rows) {
    const stage = String(r.stage || "");
    if (!(stage in byStage)) continue; // صف غير معروف يُتجاهل لا يُفجّر
    byStage[stage] += 1;
    const amount = Number(r.expectedAmount) || 0;
    if (stage !== "مقبولة" && stage !== "مفقودة") openExpected += amount;
    if (stage === "مقبولة") wonCount += 1;
    if (stage === "مفقودة") lostCount += 1;
  }
  const closedCount = wonCount + lostCount;
  return {
    byStage,
    openExpected: Math.round(openExpected * 1000) / 1000,
    closedCount,
    wonCount,
    lostCount,
    conversionRate: closedCount > 0 ? Math.round((wonCount / closedCount) * 1000) / 1000 : 0,
  };
}

/**
 * حرس انتقال المرحلة اليدوي (د2) — نقية: تعيد ok أو رسالة الرفض العربية.
 * «مفقودة» تتطلب سببًا؛ المقفلة لا تُعدَّل مرحلتها (المصفوفة بلا أهداف منها أصلًا —
 * هذا الحرس الثاني درع للسلوك لا لتكرار المصفوفة).
 */
export function assertStageTransition(
  from: string,
  to: string,
  lostReason: string
): { ok: true } | { ok: false; error: string } {
  if (from === to) return { ok: true }; // لا تغيير — يُقبل
  if (from === "مقبولة" || from === "مفقودة") return { ok: false, error: "الفرصة مقفلة («مقبولة»/«مفقودة») — لا تُعدَّل مرحلتها." };
  if (!opportunityTransitionAllowed(from, to)) {
    return { ok: false, error: opportunityTransitionBlockedMessage(from, to) };
  }
  if (to === "مفقودة" && !String(lostReason ?? "").trim()) {
    return { ok: false, error: OPPORTUNITY_LOST_REASON_REQUIRED };
  }
  return { ok: true };
}

/**
 * المزامنة الآلية مع العرض (د4) — المرحلة المستهدفة عند حدث عرض على الفرصة:
 * إصدار عرض ⇒ «عُرض عليها» · قبول العرض ⇒ «مقبولة» · رفض العرض ⇒ «مفقودة».
 * تعيد null إن كانت الفرصة مقفلة فعلًا أو في الهدف نفسه (لا تغيير).
 */
export function autoStageForQuotationEvent(
  currentStage: string,
  event: "issued" | "accepted" | "rejected"
): string | null {
  if (currentStage === "مقبولة" || currentStage === "مفقودة") return null; // المقفلة لا تتحرك
  const target = event === "issued" ? OPPORTUNITY_QUOTED_STAGE : event === "accepted" ? "مقبولة" : "مفقودة";
  return currentStage === target ? null : target;
}

/** سبب الخسارة الافتراضي عند الرفض الآلي (د4 — قابل للتعديل لاحقًا من الحوار) */
export const AUTO_LOST_REASON = "خسر المنافسة";

/** هل النص ضمن قائمة الأسباب المعتمدة؟ (الحوار يعرضها حصرًا — الخادم يحرس) */
export function isOpportunityLostReason(v: unknown): v is (typeof OPPORTUNITY_LOST_REASONS)[number] {
  return OPPORTUNITY_LOST_REASONS.includes(v as (typeof OPPORTUNITY_LOST_REASONS)[number]);
}

/** تنظيف اسم الفرصة/الملاحظات (TEXT): تشذيب فقط بلا سقط — نمط cleanQuotationText */
export function cleanOpportunityText(raw: unknown): string {
  return String(raw ?? "").trim().slice(0, 500);
}

/** تحقق التاريخ YYYY-MM-DD (نمط parseDay النقي — فراغ مسموح) */
export function cleanOpportunityDate(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

/** حمولة تعبئة معالج العرض من الفرصة (د4) — نمط QuotationContractPreset */
export interface OpportunityQuotePreset {
  opportunityId: number;
  opportunityNumber: string;
  opportunityName: string;
  customerId: number | null;
  customerName: string;
}

/** بناء الحمولة من صف الفرصة (يُستدعى من الخادم في POST /[id]/quotation) */
export function buildOpportunityQuotePreset(row: {
  id: number;
  opportunityNumber: string;
  name: string;
  customerId: number | null;
  customerName?: string | null;
}): OpportunityQuotePreset {
  return {
    opportunityId: row.id,
    opportunityNumber: row.opportunityNumber,
    opportunityName: row.name,
    customerId: row.customerId ?? null,
    customerName: String(row.customerName ?? "").trim(),
  };
}
