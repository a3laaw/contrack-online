// ============================================================
// ConTrack Online — نواة رادار مواعيد المهندسين (بند NOVA 4)
// docs/consulting-radar-design.md — نواة نقية حصرًا (بلا DB ولا server-only)
// - الخانات مشتقة من إعدادات الدوام (Setting.hrWorkStart/hrWorkEnd)
//   بخطوة slotMinutes مخزنة في uiPrefs (radar_slot_minutes)
// - slot مسموح حصرًا ∈ {15,20,30,60,90,120} وإلا 60 — كجدول الزيارات
// - خانة اليوم تُبنى من البداية حتى ما قبل النهاية (خانة عند النهاية نفسها مستبعدة)
// - منع الحجز للمهندس غير النشط أو المعتمد في إجازة، والخانة المحجوزة
//   خطأ واضح — لا خيار force (تعارض = رفض صريح)
// ============================================================

/** نفس نمط خانات الزيارات — HH:mm بصرامة (ساعة خانتين ودقيقة خانتين) */
export const HOUR_SLOT_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** مدد الخانة المسموحة (دقائق) — نفس قيم الزيارات لمصدر واحد للحقيقة */
export const RADAR_SLOT_MINUTES = [15, 20, 30, 60, 90, 120] as const;

/** الافتراضي عند غياب الإعداد أو قيمة غير مسموحة */
export const DEFAULT_RADAR_SLOT_MINUTES = 60;

/** دوام الشركة الافتراضي عند غياب إعدادات HR أو فسادها */
const FALLBACK_WORK_START = "08:00";
const FALLBACK_WORK_END = "17:00";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** تطبيع مدة الخانة: عضو في القائمة المسموحة وإلا الافتراضي 60 */
export function normalizeRadarSlotMinutes(v: unknown): number {
  const n = Math.trunc(Number(v));
  return (RADAR_SLOT_MINUTES as readonly number[]).includes(n) ? n : DEFAULT_RADAR_SLOT_MINUTES;
}

/** HH:mm → دقائق من منتصف الليل — أو null عند صيغة غير صالحة (تقبل 00:00–23:59) */
function parseHhmm(s: string): number | null {
  if (!HOUR_SLOT_RE.test(s)) return null;
  const [h, m] = s.split(":");
  const mins = Number(h) * 60 + Number(m);
  return Number.isFinite(mins) ? mins : null;
}

/**
 * خانات يوم الدوام: من workStart حتى ما قبل workEnd بخطوة slotMinutes.
 * - مدخلات غير صالحة (فارغة/بصيغة خاطئة أو end<=start) ⇒ fallback 08:00→17:00
 * - مدة غير موجبة/غير رقمية ⇒ الافتراضي 60
 * - 08:00–17:00 @60 ⇒ 9 خانات تنتهي 16:00 (الخانة عند 17:00 نفسها مستبعدة)
 * - المدة التي لا تقسم النطاق بالتساوي: آخر خانة يبقى شرطها بدايتها < النهاية (@90 ⇒ 6 خانات)
 */
export function radarSlotsFromWorkday(workStart: string, workEnd: string, slotMinutes: number): string[] {
  const s0 = parseHhmm(String(workStart || ""));
  const e0 = parseHhmm(String(workEnd || ""));
  // أي خلل في المدخلات (بداية أو نهاية غير صالحة أو نهاية ≤ بداية) ⇒ الدوام الافتراضي كاملًا
  const valid = s0 != null && e0 != null && e0 > s0;
  const s = valid ? s0! : parseHhmm(FALLBACK_WORK_START)!;
  const e = valid ? e0! : parseHhmm(FALLBACK_WORK_END)!;
  const step = normalizeRadarSlotMinutes(slotMinutes);

  const slots: string[] = [];
  for (let t = s; t < e; t += step) {
    slots.push(`${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`);
  }
  return slots;
}

/** هل الخانة ضمن خانات نطاق الدوام الحالي؟ */
export function isValidRadarSlot(slot: string, slots: string[]): boolean {
  return slots.includes(slot);
}

/** مرجع إجازة للفحص النقي — يكفي التواريخ والحالة */
export interface RadarLeaveRef {
  startDate: string;
  endDate: string;
  status: string;
}

/**
 * هل المهندس في إجازة معتمدة تغطي تاريخ الموعد؟
 * مقارنة نصية آمنة لصيغة YYYY-MM-DD — شاملة الطرفين (start ≤ date ≤ end).
 */
export function isEngineerOnLeave(appointmentDate: string, leaves: RadarLeaveRef[]): boolean {
  return leaves.some(
    (l) => l.status === "معتمدة" && l.startDate <= appointmentDate && appointmentDate <= l.endDate
  );
}

/** نتيجة فحص الحجز الموحد — ok أو رسالة عربية جاهزة للمسار */
export interface RadarUpsertCheck {
  ok: boolean;
  error?: string;
}

/**
 * فحص الحجز بترتيب صارم (نفس ترتيب المسار):
 * خانة غير صالحة ⇒ مهندس غير نشط («المهندس غير نشط») ⇒ إجازة معتمدة
 * ⇒ خانة محجوزة («الخانة محجوزة» + من يشغلها) — لا خيار force: التعارض خطأ صريح.
 */
export function checkRadarBooking(input: {
  slot: string;
  slots: string[];
  engineerActive: boolean;
  onLeave: boolean;
  existing: { customerName?: string; engineerName?: string } | null;
}): RadarUpsertCheck {
  if (!isValidRadarSlot(input.slot, input.slots)) {
    return { ok: false, error: "الخانة خارج نطاق الدوام" };
  }
  if (!input.engineerActive) {
    return { ok: false, error: "المهندس غير نشط" };
  }
  if (input.onLeave) {
    return { ok: false, error: "المهندس في إجازة معتمدة هذا اليوم" };
  }
  if (input.existing) {
    const holder = input.existing.customerName?.trim() || input.existing.engineerName?.trim() || "";
    return { ok: false, error: holder ? `الخانة محجوزة — يشغلها: ${holder}` : "الخانة محجوزة" };
  }
  return { ok: true };
}
