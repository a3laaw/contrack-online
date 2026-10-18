import "server-only";

/**
 * إعدادات جدول الزيارات — ثابتة مؤقتًا:
 * ساعات العمل 8→17 والحصة 60 دقيقة. لا توجد أعمدة مناسبة في schema
 * (Setting لا يملك حقول الزيارات وFeatureFlag يقبل Boolean فقط)،
 * لذا تعاد القيم الثابتة ويُقبل PUT بتجاهل صامت حتى تتوفر أعمدة إعدادات حقيقية.
 */
export const VISITS_CONFIG = { startHour: 8, endHour: 17, slotMinutes: 60 } as const;

export const HOUR_SLOT_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** خانات اليوم: من ساعة البداية حتى ما قبل نهاية العمل بخطوة الحصة (08:00 … 16:00) */
export function buildHourSlots(): string[] {
  const slots: string[] = [];
  for (let h = VISITS_CONFIG.startHour; h < VISITS_CONFIG.endHour; h += VISITS_CONFIG.slotMinutes / 60) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
  }
  return slots;
}

/** الطابع الزمني الحرفي للمصدر: YYYY-MM-DD HH:mm */
export function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
