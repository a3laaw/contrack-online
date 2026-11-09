/**
 * maintenance-constants.ts — ثوابت موديول الصيانة والتشغيل (docs/maintenance-design.md §4) — نقي 100% بلا DB ولا React:
 * • آلة حالة أمر العمل المغلقة (د4 — G7: قيم معرفية بتسميات ثابتة لا نصوص حرة)
 * • بادئة الترقيم MO لكل شركة (د10 — متميزة عن WO- المخزني)
 * • فواصل الخطة المغلقة {1,2,3,6,12} وسقف السلامة (د5)
 * • الحالات الاشتقاقية للأحداث الوقائية (د6 — G9: لا عمود حالة مخزن)
 */

/** تقريب مالي موحد — د.ك ثلاثي العشرة (نفس r3 في بقية الثوابت) */
export function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** فحص تاريخ ISO بسيط (YYYY-MM-DD) — الأنماط القائمة كلها تاريخ نصي */
export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// ===== آلة حالة أمر العمل (د4) =====
export const WO_STATUSES = ["مفتوحة", "جارية", "منجزة", "ملغاة"] as const;
export type WoStatus = (typeof WO_STATUSES)[number];

export const WO_STATUS_LABELS: Record<WoStatus, string> = {
  "مفتوحة": "مفتوحة",
  "جارية": "جارية",
  "منجزة": "منجزة",
  "ملغاة": "ملغاة",
};

/** خريطة الانتقالات المغلقة (د4): البدء من مفتوحة، الإنهاء من مفتوحة/جارية، الإلغاء من مفتوحة/جارية بسبب */
export const WO_TRANSITIONS: Record<WoStatus, WoStatus[]> = {
  "مفتوحة": ["جارية", "منجزة", "ملغاة"],
  "جارية": ["منجزة", "ملغاة"],
  "منجزة": [],
  "ملغاة": [],
};

export function isWoStatus(v: unknown): v is WoStatus {
  return (WO_STATUSES as readonly string[]).includes(String(v));
}

// ===== الجدول الوقائي (د5) =====
export const PLAN_INTERVALS = [1, 2, 3, 6, 12] as const;
export type PlanInterval = (typeof PLAN_INTERVALS)[number];

export const PLAN_INTERVAL_LABELS: Record<PlanInterval, string> = {
  1: "شهريًا",
  2: "كل شهرين",
  3: "ربع سنويًا",
  6: "نصف سنويًا",
  12: "سنويًا",
};

/** سقف سلامة التوليد — 60 زيارة (5 سنوات شهريًا) */
export const PLAN_MAX_OCCURRENCES = 60;

// ===== الحالات الاشتقاقية للحدث (د6 — G9) =====
export const OCCURRENCE_STATUSES = ["مجدولة", "مفتوحة", "منجزة", "متخطاة"] as const;
export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];

export const OCCURRENCE_STATUS_LABELS: Record<OccurrenceStatus, string> = {
  "مجدولة": "مجدولة",
  "مفتوحة": "مفتوحة",
  "منجزة": "منجزة",
  "متخطاة": "متخطاة",
};

// ===== الترقيم (د10) =====
/** بادئة أوامر الصيانة عبر nextNumber لكل شركة — متميزة عن WO- المخزني (د5 المخازن) */
export const WO_PREFIX = "MO";

// ===== بذر مؤجل واحد (د2 — نمط ensureOne) =====
/** نوع عقد الصيانة المبذور عند أول استخدام — manualTrack لأن أوامر العمل هي التتبع بلا مراحل */
export const MAINTENANCE_TYPE_NAME = "صيانة دورية";
export const MAINTENANCE_TYPE_CATEGORY = "صيانة";
