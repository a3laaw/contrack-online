import "server-only";

/**
 * إعدادات جدول الزيارات — المصدر الوحيد للشبكة والتبويب (توحيد الجلسة 13):
 * الافتراضي 8→17 بخطوة 60 دقيقة، والتخزين الفعلي في Settings.uiPrefs لكل شركة
 * (visits_slot_minutes / visits_start_hour / visits_end_hour) عبر lib/visit-slots —
 * قواعد التطبيع الحرفية من visits_service.py (spec-8-f §2).
 * (قبل الجلسة 13: قيم ثابتة هنا وتجاهل صامت للـPUT، ومسار موازٍ يتيم
 *  /api/settings/visit-slot يحمل نفس القواعد — دُمجا في مسار واحد /api/visits/config)
 */
import { getUiPrefs } from "@/lib/ui-prefs";
import { normalizeSlotConfig, type VisitSlotConfig } from "@/lib/visit-slots";

/** الافتراضي عند غياب uiPrefs — قيم التأسيس الثابتة (8→17 بخطوة 60) */
export const VISITS_CONFIG = { startHour: 8, endHour: 17, slotMinutes: 60 } as const;

export const HOUR_SLOT_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** الإعدادات الفعلية لشركة السياق — uiPrefs إن وُجدت وإلا الافتراضي */
export async function getVisitsConfig(): Promise<VisitSlotConfig> {
  try {
    const { prefs } = await getUiPrefs();
    const configured =
      prefs.visits_slot_minutes != null ||
      prefs.visits_start_hour != null ||
      prefs.visits_end_hour != null;
    if (!configured) return { ...VISITS_CONFIG };
    return normalizeSlotConfig({
      slotMinutes: prefs.visits_slot_minutes,
      startHour: prefs.visits_start_hour,
      endHour: prefs.visits_end_hour,
    });
  } catch {
    return { ...VISITS_CONFIG };
  }
}

/** الطابع الزمني الحرفي للمصدر: YYYY-MM-DD HH:mm */
export function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
