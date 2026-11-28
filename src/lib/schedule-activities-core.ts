// ============================================================
// schedule-activities-core.ts — نواة ب3 النقية (بلا I/O)
// ------------------------------------------------------------
// docs/schedule-import-design.md §13 — بطاقة التصميم قبل الكود.
//  • شجرة الأنشطة بالـbands (أول ظهور وفق ترتيب المدخل المرتب بـsortOrder) —
//    وداخل كل band الترتيب بـ(earlyStart, sortOrder) — G9: الشجرة عرض لا تخزين.
//  • Total Float مشتق من التواريخ المحفوظة (earlyFinish → lateFinish) —
//    null بلا تواريخ (لا اختلاق) — والصفر = نشطة مسار حرج (شارة معلنة).
//  • نافذة البند المربوط من أنشطته المؤرخة (min start / max finish) — أساس
//    «الربط المباشر يجري EVM بدقة الأنشطة» §13.2.
//  • توزيع قيمة القسم على أنشطته بوزن المدة (Milestones صفرية بلا وزن §7.3)
//    وكل نشطة تنتشر خطيًا داخل نافذتها — منحنى أدق §4 حرفيًا.
// ============================================================

import { daysBetween, r3 } from "./contrack-core";
import { monthOverlapDays, nextMonth } from "./pv-plan-core";

// ==================== المدخلات — مرآة صف النشطة ====================

export interface ScheduleActivityRow {
  id: number;
  activityCode: string;
  name: string;
  kind: string;
  family: string;
  durationDays: number;
  earlyStart: string;
  earlyFinish: string;
  lateStart: string;
  lateFinish: string;
  isSummary: boolean;
  groupName: string;
  divisionCode: string;
  boqItemId: number | null;
  sortOrder: number;
}

// ==================== Float والشجرة ====================

/** Total Float بالأيام (lateFinish − earlyFinish) — null بلا تواريخ — الصفر مسار حرج */
export function activityFloat(earlyFinish: string, lateFinish: string): number | null {
  const e = (earlyFinish || "").slice(0, 10);
  const l = (lateFinish || "").slice(0, 10);
  if (!e || !l) return null;
  return daysBetween(e, l);
}

export interface ActivityBand {
  /** اسم الـband كما ورد (الفارغ = «—» band صريح) */
  name: string;
  count: number;
  items: ScheduleActivityRow[];
}

/**
 * الشجرة بالـbands — ترتيب أول ظهور وفق ترتيب المدخل (المسار يرسله بـsortOrder)،
 * وداخل كل band الترتيب بـ(earlyStart، ثم sortOrder، ثم id) — غير المؤرخة آخرًا.
 */
export function buildActivityTree(activities: ScheduleActivityRow[]): ActivityBand[] {
  const bands: ActivityBand[] = [];
  const byName = new Map<string, ActivityBand>();
  for (const a of activities) {
    const key = a.groupName || "—";
    let band = byName.get(key);
    if (!band) {
      band = { name: key, count: 0, items: [] };
      byName.set(key, band);
      bands.push(band);
    }
    band.count += 1;
    band.items.push(a);
  }
  for (const band of bands) {
    band.items.sort(
      (a, b) =>
        (a.earlyStart || "9999-12-31").localeCompare(b.earlyStart || "9999-12-31") ||
        a.sortOrder - b.sortOrder ||
        a.id - b.id
    );
  }
  return bands;
}

// ==================== نافذة البند المربوط ====================

/** أصغر مدخل للنافذة — النشطة work غير الملخصة المؤرخة حصرًا */
export interface ActivityWindowInput {
  kind: string;
  isSummary: boolean;
  earlyStart: string;
  earlyFinish: string;
}

/**
 * نافذة البند المربوط من أنشطته (§13.2): min earlyStart / max earlyFinish
 * لأنشطة work المؤرخة — null بلا تواريخ (لا اختلاق نافذة).
 */
export function deriveItemWindowFromActivities(activities: ActivityWindowInput[]): { start: string; finish: string } | null {
  let start = "";
  let finish = "";
  for (const a of activities) {
    if (a.isSummary || a.kind !== "work") continue;
    const s = (a.earlyStart || "").slice(0, 10);
    const f = (a.earlyFinish || "").slice(0, 10);
    if (!s || !f) continue;
    if (!start || s < start) start = s;
    if (!finish || f > finish) finish = f;
  }
  return start && finish ? { start, finish } : null;
}

// ==================== التوزيع الشهري بالأقسام من الأنشطة ====================

/** مدخل التوزيع — ما تحتاجه النواة من النشطة */
export interface ActivityShareInput {
  durationDays: number;
  earlyStart: string;
  earlyFinish: string;
}

export interface ActivityMonthBucket {
  /** YYYY-MM */
  month: string;
  planned: number;
  plannedCum: number;
}

/**
 * منحنى أدق §4 — قيمة القسم توزَّع على أنشطته بوزن المدة (durationDays؛
 * Milestones صفرية بلا وزن) وكل نشطة تنتشر خطيًا داخل نافذتها early بأيام
 * شاملة — دلاء شهرية من أقدم بداية لأحدث نهاية. بلا أنشطة مؤرخة بمدة ⇒
 * دلاء فارغة (لا اختلاق منحنى) — والتراكمي النهائي = قيمة القسم.
 */
export function distributeSectionAcrossActivities(value: number, activities: ActivityShareInput[]): ActivityMonthBucket[] {
  const v = Math.max(0, value);
  if (!(v > 0)) return [];
  const dated = activities
    .map((a) => ({
      weight: Math.max(0, a.durationDays || 0),
      start: (a.earlyStart || "").slice(0, 10),
      finish: (a.earlyFinish || "").slice(0, 10),
    }))
    .filter((a) => a.weight > 0 && a.start && a.finish && a.start <= a.finish);
  const totalWeight = dated.reduce((sum, a) => sum + a.weight, 0);
  if (!(totalWeight > 0)) return [];

  const minMonth = [...dated.map((a) => a.start)].sort()[0].slice(0, 7);
  const maxMonth = [...dated.map((a) => a.finish)].sort().slice(-1)[0].slice(0, 7);

  const buckets: ActivityMonthBucket[] = [];
  let cum = 0;
  let cursor = minMonth;
  // حارس دورات — نطاق معقول حصرًا
  for (let guard = 0; guard < 480 && cursor <= maxMonth; guard++) {
    let planned = 0;
    for (const a of dated) {
      const share = (v * a.weight) / totalWeight;
      const ov = monthOverlapDays(a.start, a.finish, cursor);
      if (ov > 0) {
        const windowDays = daysBetween(a.start, a.finish) + 1;
        planned = r3(planned + (share * ov) / windowDays);
      }
    }
    cum = r3(cum + planned);
    buckets.push({ month: cursor, planned, plannedCum: cum });
    cursor = nextMonth(cursor);
  }
  return buckets;
}
