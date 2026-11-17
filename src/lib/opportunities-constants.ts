/**
 * opportunities-constants.ts — ثوابت ر3 «فرص البيع» (docs/opportunities-design.md):
 * نقي 100% بلا DB ولا React — تستهلكه مسارات الـAPI (حرس الانتقالات) والواجهة
 * (قوائم المراحل والمصادر والأسباب) بنمط quotes-core/consulting-constants حرفيًا.
 * قاعدة ConTrack: لا enum — مفردات نصية بجداول ثابتة (G7).
 */

/** مراحل الفرصة الخمس المفتوحة الانتقالات (د2) — «مقبولة» و«مفقودة» نهائيتان */
export const OPPORTUNITY_STAGES = ["جديدة", "مؤهَّلة", "عُرض عليها", "مقبولة", "مفقودة"] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

/** المرحلة التي ترفعها المعاملة الآلية عند إصدار عرض من الفرصة (د4) */
export const OPPORTUNITY_QUOTED_STAGE = "عُرض عليها";

/** أسباب الخسارة المحدودة (د3) — إلزامي عند «مفقودة» */
export const OPPORTUNITY_LOST_REASONS = [
  "سعر مرتفع",
  "خسر المنافسة",
  "تأجل العميل",
  "لا تناسب لنا",
  "أخرى",
] as const;

/** مصادر الفرصة (د7) — اختياري */
export const OPPORTUNITY_SOURCES = ["مكالمة", "زيارة", "توصية عميل", "معرض/فعالية", "أخرى"] as const;

/** رفض الانتقال المنعوت بالرسالة العربية */
export const OPPORTUNITY_LOST_REASON_REQUIRED = "سبب الخسارة إلزامي عند المرحلة «مفقودة».";
export const OPPORTUNITY_STAGE_CLOSED = "الفرصة مقفلة («مقبولة»/«مفقودة») — لا تُعدَّل مرحلتها.";

/** خريطة الانتقالات المغلقة (د2) — يدويًا لا يُقفز أي مرحلة خارج هذه الروابط */
export const OPPORTUNITY_TRANSITIONS: Record<string, readonly string[]> = {
  "جديدة": ["مؤهَّلة", "مفقودة"],
  "مؤهَّلة": ["عُرض عليها", "مفقودة"],
  "عُرض عليها": ["مقبولة", "مفقودة"],
  "مقبولة": [],
  "مفقودة": [],
};

/** هل حالة الفرصة معروفة في المفردات؟ */
export function isOpportunityStage(status: unknown): status is OpportunityStage {
  return OPPORTUNITY_STAGES.includes(status as OpportunityStage);
}

/** الأهداف المسموحة من مرحلة — قائمة الواجهة تعرضها حصرًا (نمط قائمة حالة العرض في ر1) */
export function opportunityAllowedTargets(from: string): readonly string[] {
  return OPPORTUNITY_TRANSITIONS[from] ?? [];
}

/** رسالة الرفض بالصياغة العربية الموحدة */
export function opportunityTransitionBlockedMessage(from: string, to: string): string {
  return `انتقال مرحلة الفرصة غير مسموح (من ${from} إلى ${to}).`;
}

export function opportunityTransitionAllowed(from: string, to: string): boolean {
  return opportunityAllowedTargets(from).includes(to);
}

/** ألوان الشارات — لوحة NOVA حصرًا: جديدة رمادي · مؤهَّلة كهرماني · عُرض عليها أزرق ملكي معلوماتي · مقبولة رمادي مكتمل · مفقودة أحمر خطر */
export const OPPORTUNITY_STAGE_FALLBACK_CLASS = "bg-secondary text-secondary-foreground";

export function opportunityStageBadgeClass(stage: string): string {
  switch (stage) {
    case "جديدة":
      return "bg-secondary text-secondary-foreground";
    case "مؤهَّلة":
      return "bg-status-warn-bg text-warn-ink";
    case "عُرض عليها":
      return "bg-status-info-bg text-status-info";
    case "مقبولة":
      return "bg-status-done-bg text-status-done";
    case "مفقودة":
      return "bg-status-danger-bg text-status-danger";
    default:
      return OPPORTUNITY_STAGE_FALLBACK_CLASS;
  }
}
