// ============================================================
// pv-plan-core.ts — نواة ب2 النقية: محرك PV المخطط (بلا I/O)
// ------------------------------------------------------------
// docs/schedule-import-design.md §12 — بطاقة التصميم قبل الكود.
//  • الاستحقاق الخطي لكل بند داخل نافذته (الأساس الموثق §4: «قيمة القسم
//    توزَّع خطياً داخل نافذته — هذا بالضبط مستوى دقة لوحة الاستشاري») —
//    ترقية دلالة PV عن خطوة ج2 عند plannedFinish (§12.1).
//  • القواعد المحفوظة حرفًا من ج2: بلا نافذة ⇒ خارج PV · قيمة ≤ 0 ⇒ صفر ·
//    بلا بداية (نافذة ناقصة يمنعها تحقق ج1) ⇒ سقوط لخطوة النهاية (توافق خلفي).
//  • الدلاء الشهرية من أول شهر بداية إلى آخر شهر نهاية — أشهر الصفر معلنة
//    لا فجوات — والتراكمي عند نهاية كل شهر (دقة شهرية = دقة الاستشاري).
// ============================================================

import { daysBetween, r3 } from "./contrack-core";

// ==================== المدخلات — مرآة ما يجلبهم المسار ====================

/** صف البند كما في مخرج م1 (الأرضية المشتركة) — القيمة تعاقدي×سعر */
export interface PvPlanRow {
  boqItemId: number;
  divisionCode: string;
  divisionName: string;
  contractQty: number;
  unitPrice: number;
}

/** نافذة البند المخططة (ب1/ج1) — YYYY-MM-DD */
export interface PvPlanWindow {
  boqItemId: number;
  plannedStart: string;
  plannedFinish: string;
}

export interface PvPlanMonth {
  /** YYYY-MM */
  month: string;
  /** المخطط بالشهر */
  planned: number;
  /** المخطط التراكمي حتى نهاية الشهر */
  plannedCum: number;
}

export interface DerivePvPlanResult {
  /** Σ استحقاق البنود حتى اليوم المرجعي */
  pv: number;
  /** الدلاء الشهرية الكاملة (أشهر الصفر معلنة) */
  byMonth: PvPlanMonth[];
  /** نهاية الشهر YYYY-MM-DD → مخطط الشهر — مغذّي المنحنى الثلاثي (أشهر > 0 حصرًا) */
  plannedByMonthEnd: Map<string, number>;
}

// ==================== الأدوات النقية ====================

/** آخر يوم في الشهر YYYY-MM — YYYY-MM-DD */
export function monthEnd(m: string): string {
  const [y, mm] = m.split("-").map(Number);
  if (!y || !mm || mm < 1 || mm > 12) return "";
  return new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10);
}

/** الشهر التالي لـYYYY-MM — حساب رقمي بلا كائنات تاريخ (الأمان المحلي) */
export function nextMonth(m: string): string {
  const [y, mm] = m.split("-").map(Number);
  if (!y || !mm || mm < 1 || mm > 12) return "";
  return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
}

/**
 * الاستحقاق الخطي لبند واحد حتى d (§12.2):
 * صفر قبل البداية · كامل من النهاية فصاعدًا · خطي بينهما بأيام شاملة
 * (البداية تحتسب يومًا — نمط الرأس ج2 daysBetween+1).
 * بلا نهاية ⇒ صفر (خارج PV) · بلا بداية ⇒ خطوة عند النهاية (توافق خلفي ج2).
 */
export function accrueLinear(value: number, start: string, finish: string, d: string): number {
  const v = Math.max(0, value);
  if (!(v > 0)) return 0;
  const fin = (finish || "").slice(0, 10);
  if (!fin) return 0; // بلا نافذة نهائيًا ⇒ خارج PV حصرًا
  if (d >= fin) return v; // كامل من النهاية فصاعدًا — وخطوة النهاية للناقصة البداية
  const st = (start || "").slice(0, 10);
  if (!st) return 0; // نافذة ناقصة ولم تُستحق بعد ⇒ صفر (خطوة عند النهاية)
  if (d < st) return 0;
  const windowDays = daysBetween(st, fin) + 1;
  if (!(windowDays > 0)) return 0; // بيانات فاسدة (نهاية قبل بداية) ⇒ لا استحقاق مختلق
  const elapsed = daysBetween(st, d) + 1; // أيام شاملة منذ البداية
  return r3((v * elapsed) / windowDays);
}

/** أيام التداخل الشاملة بين [start, finish] والشهر YYYY-MM — صفر بلا تداخل */
export function monthOverlapDays(start: string, finish: string, month: string): number {
  const st = (start || "").slice(0, 10);
  const fin = (finish || "").slice(0, 10);
  if (!st || !fin || st > fin) return 0;
  const ms = `${month}-01`;
  const me = monthEnd(month);
  if (!me) return 0;
  const lo = st > ms ? st : ms;
  const hi = fin < me ? fin : me;
  if (lo > hi) return 0;
  return daysBetween(lo, hi) + 1;
}

// ==================== المحرك الرئيس ====================

/**
 * محرك ب2 الكامل (§12.2): pv حتى اليوم + الدلاء الشهرية الكاملة + خريطة
 * نهايات الأشهر للمنحنى. بلا بنود بنافذة ⇒ pv صفر وبلا دلاء («يعمل تدريجيًا»).
 */
export function derivePvPlan(rows: PvPlanRow[], plans: PvPlanWindow[], today: string): DerivePvPlanResult {
  const planByItem = new Map(plans.map((p) => [p.boqItemId, p]));

  type WindowedItem = { value: number; start: string; finish: string };
  const windowed: WindowedItem[] = [];
  let pv = 0;
  for (const r of rows) {
    const value = r3(Math.max(0, r.contractQty) * Math.max(0, r.unitPrice));
    if (!(value > 0)) continue;
    const p = planByItem.get(r.boqItemId);
    const fin = (p?.plannedFinish || "").slice(0, 10);
    if (!fin) continue; // بلا نافذة ⇒ خارج PV (قاعدة ج2 حرفًا)
    const st = (p?.plannedStart || "").slice(0, 10);
    windowed.push({ value, start: st, finish: fin });
    pv = r3(pv + accrueLinear(value, st, fin, today));
  }

  // نطاق الأشهر: أول شهر بداية (أو أول شهر نهاية إن كله خطوة نهاية) ← آخر شهر نهاية
  const startMonths = windowed.filter((w) => w.start).map((w) => w.start.slice(0, 7));
  const finishMonths = windowed.map((w) => w.finish.slice(0, 7)).sort();
  const minMonth = startMonths.length ? [...startMonths].sort()[0] : finishMonths[0] || null;
  const maxMonth = finishMonths.length ? finishMonths[finishMonths.length - 1] : null;

  const byMonth: PvPlanMonth[] = [];
  const plannedByMonthEnd = new Map<string, number>();
  if (minMonth && maxMonth && minMonth <= maxMonth) {
    let cum = 0;
    let cursor = minMonth;
    // حارس دورات — نطاق معقول حصرًا (24×40 سنة حد فائق الاحتياط)
    for (let guard = 0; guard < 480 && cursor <= maxMonth; guard++) {
      let planned = 0;
      for (const w of windowed) {
        const share = w.start
          ? (() => {
              const windowDays = daysBetween(w.start, w.finish) + 1;
              if (!(windowDays > 0)) return 0;
              const ov = monthOverlapDays(w.start, w.finish, cursor);
              return ov > 0 ? (w.value * ov) / windowDays : 0;
            })()
          : w.finish.slice(0, 7) === cursor
            ? w.value // خطوة النهاية: كامل القيمة بشهر نهايتها
            : 0;
        planned = r3(planned + share);
      }
      cum = r3(cum + planned);
      byMonth.push({ month: cursor, planned, plannedCum: cum });
      if (planned > 0) plannedByMonthEnd.set(monthEnd(cursor), planned);
      cursor = nextMonth(cursor);
    }
  }

  return { pv, byMonth, plannedByMonthEnd };
}
