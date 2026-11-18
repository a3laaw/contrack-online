// ============================================================
// schedule-items-core.ts — نواة «النافذة المخططة لكل بند» (ج1 المتبقي)
// المرجع: docs/schedule-import-design.md §8 — بُني فوق ب1 حصرًا:
// عمودا plannedStart/plannedFinish على BoqItem قائمان (ب1)، والنواة هنا
// تتحقق من التحرير اليدوي وتشتق العرض الزمني (محور المشروع + شريط البند
// + حالة الجدولة) — كلها مشتقات لحظية (G9: لا حالة مخزنة).
// نواة نقية حصرًا (بلا DB ولا server-only) — قابلة للاختبار مباشرة.
// ============================================================

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** عدد الأيام بين تاريخين بصيغة YYYY-MM-DD (b − a) — بالميللي ثانية ثم تقريب صحيح */
export function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const dbb = new Date(`${b}T00:00:00Z`).getTime();
  if (!Number.isFinite(da) || !Number.isFinite(dbb)) return 0;
  return Math.round((dbb - da) / 86_400_000);
}

export interface PlannedWindowCheck {
  ok: boolean;
  error?: string;
  /** القيم المطبَّعة — undefined عند الإفراغ (الفارغ توافق خلفي كامل: بلا نافذة سلوك ب1 حرفيًا) */
  value?: { plannedStart: string; plannedFinish: string };
}

/**
 * تحقق نافذة البند المخططة — رسائل عربية تُعرض كما هي في المسار والواجهة:
 * - الفارغَان معًا ⇒ إفراغ مقبول (ok بلا value)
 * - نصف نافذة (أحدهما بلا الآخر) ⇒ مرفوضة — النافذة ثنائية بلا وسط
 * - الصيغة YYYY-MM-DD إلزامية — والنص الفاسد رفض صريح لا يتلقم
 * - البداية بعد النهاية ⇒ مرفوضة برسالة الأرقام
 */
export function validatePlannedWindow(start: unknown, finish: unknown): PlannedWindowCheck {
  const s = typeof start === "string" ? start.trim() : "";
  const f = typeof finish === "string" ? finish.trim() : "";
  if (!s && !f) return { ok: true };
  if (s && !f) return { ok: false, error: "نافذة البند ثنائية — تاريخ البداية بلا نهاية غير مقبول" };
  if (!s && f) return { ok: false, error: "نافذة البند ثنائية — تاريخ النهاية بلا بداية غير مقبول" };
  if (!DATE_RE.test(s)) return { ok: false, error: "تاريخ البداية مطلوب بصيغة YYYY-MM-DD" };
  if (!DATE_RE.test(f)) return { ok: false, error: "تاريخ النهاية مطلوب بصيغة YYYY-MM-DD" };
  if (s > f) return { ok: false, error: `تاريخ البداية ${s} بعد تاريخ النهاية ${f}` };
  return { ok: true, value: { plannedStart: s, plannedFinish: f } };
}

/** صف بند كما يصل من GET /boq — أدنى حقول الاشتقاق (النافذة نصان YYYY-MM-DD أو فارغان) */
export interface ScheduleItemRow {
  id: number;
  itemNo: string;
  description: string;
  divisionCode: string;
  divisionName: string;
  plannedStart: string;
  plannedFinish: string;
}

/** حالة الجدولة للبند مقابل اليوم */
export type ScheduleItemStatus = "none" | "upcoming" | "active" | "overdue";

export interface ScheduleItemView extends ScheduleItemRow {
  status: ScheduleItemStatus;
  /** أيام حتى نهاية النافذة (موجب) أو أيام التجاوز (سالب) — صفر بلا نافذة */
  daysToFinish: number;
  /** شريط النافذة على محور المشروع — موضع البداية والعرض % (null بلا نافذة أو محور منحل) */
  bar: { left: number; width: number } | null;
}

/** محور المشروع = نافذة البنود ذات النافذة حصرًا — بلا بنود بنافذة ⇒ null */
export function deriveProjectWindow(rows: ScheduleItemRow[]): { start: string; finish: string } | null {
  let start = "";
  let finish = "";
  for (const r of rows) {
    if (!r.plannedStart || !r.plannedFinish) continue;
    if (!start || r.plannedStart < start) start = r.plannedStart;
    if (!finish || r.plannedFinish > finish) finish = r.plannedFinish;
  }
  return start && finish ? { start, finish } : null;
}

/** حالة البند مقابل اليوم — مقارنات نصية آمنة على YYYY-MM-DD (الترتيب المعجمي = الزمني) */
export function scheduleItemStatus(row: Pick<ScheduleItemRow, "plannedStart" | "plannedFinish">, today: string): ScheduleItemStatus {
  if (!row.plannedStart || !row.plannedFinish) return "none";
  if (today < row.plannedStart) return "upcoming";
  if (today > row.plannedFinish) return "overdue";
  return "active";
}

/**
 * موضع الشريط وعرضه على المحور — تقريب منزلتين:
 * - بلا نافذة أو بلا محور ⇒ null
 * - المحور منحل (البداية = النهاية، مشروع يوم واحد) ⇒ الشريط كامل العرض
 * - النافذة خارج المحور نظريًا مستحيلة (المحور مشتق منها) — القص عند الحواف احتياطي صرف
 */
export function windowBarPct(
  row: Pick<ScheduleItemRow, "plannedStart" | "plannedFinish">,
  projectStart: string,
  projectFinish: string
): { left: number; width: number } | null {
  if (!row.plannedStart || !row.plannedFinish || !projectStart || !projectFinish) return null;
  if (projectStart === projectFinish) return { left: 0, width: 100 };
  const span = daysBetween(projectStart, projectFinish);
  if (span <= 0) return { left: 0, width: 100 };
  const leftDays = daysBetween(projectStart, row.plannedStart);
  const rightDays = daysBetween(projectStart, row.plannedFinish);
  // القص الاحتياطي داخل حدود المحور — النافذة المشروعة دائمًا داخله
  const left = Math.min(Math.max(0, leftDays), span);
  const right = Math.min(Math.max(0, rightDays), span);
  const width = Math.max(right - left, span / 200); // حد أدنى مرئي ≈ نصف يوم واحد من المحور
  return {
    left: Math.round((left / span) * 10000) / 100,
    width: Math.round((width / span) * 10000) / 100,
  };
}

export interface ScheduleItemsView {
  projectWindow: { start: string; finish: string } | null;
  rows: ScheduleItemView[];
  totals: {
    total: number;
    withWindow: number;
    active: number;
    overdue: number;
    upcoming: number;
  };
}

/**
 * الاشتقاق الكامل للعرض (G9 — لا حالة مخزنة):
 * - المرتب زمنيًا حسب البداية ثم النهاية — البنود بلا نافذة آخرًا بالترتيب الأصلي القادم
 * - كل صف بحالته وأيامه وشريطه
 * - الإجماليات: الكلي وبالنافذة وكل حالة
 */
export function scheduleItemsView(rows: ScheduleItemRow[], today: string): ScheduleItemsView {
  const projectWindow = deriveProjectWindow(rows);
  const withIdx = rows.map((r, idx) => ({ r, idx }));
  const sorted = [...withIdx].sort((a, b) => {
    const aw = a.r.plannedStart && a.r.plannedFinish;
    const bw = b.r.plannedStart && b.r.plannedFinish;
    if (aw && bw) {
      if (a.r.plannedStart !== b.r.plannedStart) return a.r.plannedStart < b.r.plannedStart ? -1 : 1;
      if (a.r.plannedFinish !== b.r.plannedFinish) return a.r.plannedFinish < b.r.plannedFinish ? -1 : 1;
      return a.idx - b.idx; // استقرار الترتيب — أصالة القادم
    }
    if (aw !== bw) return aw ? -1 : 1; // بلا نافذة آخرًا
    return a.idx - b.idx;
  });
  const viewRows: ScheduleItemView[] = sorted.map(({ r }) => {
    const status = scheduleItemStatus(r, today);
    return {
      ...r,
      status,
      daysToFinish: r.plannedFinish ? daysBetween(today, r.plannedFinish) : 0,
      bar: projectWindow ? windowBarPct(r, projectWindow.start, projectWindow.finish) : null,
    };
  });
  const totals = { total: viewRows.length, withWindow: 0, active: 0, overdue: 0, upcoming: 0 };
  for (const r of viewRows) {
    if (r.status === "active") totals.active += 1;
    if (r.status === "overdue") totals.overdue += 1;
    if (r.status === "upcoming") totals.upcoming += 1;
    if (r.status !== "none") totals.withWindow += 1;
  }
  return { projectWindow, rows: viewRows, totals };
}
