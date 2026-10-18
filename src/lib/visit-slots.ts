// ============================================================
// ConTrack Online — منطق خانات جدول الزيارات (خادمي)
// القواعد الحرفية من visits_service.py (spec-8-f §2):
// - slot مسموح حصرًا ∈ {15,20,30,60,90,120} وإلا 60 (س23-39)
// - start ∈ [0,23]، end ∈ [1,24]، end>start (وإلا start+1)
// - hourSlots تبني ["08:00","08:15",…] حتى قبل النهاية (س55-63)
// التخزين: Settings.uiPrefs (visits_slot_minutes / visits_start_hour / visits_end_hour)
// ============================================================
import { getUiPrefs } from '@/lib/ui-prefs'

export const ALLOWED_SLOT_MINUTES = [15, 20, 30, 60, 90, 120] as const
export type AllowedSlotMinute = (typeof ALLOWED_SLOT_MINUTES)[number]

export interface VisitSlotConfig {
  slotMinutes: number
  startHour: number
  endHour: number
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** تطبيع الإعدادات بقواعد visits_service */
export function normalizeSlotConfig(raw: {
  slotMinutes?: unknown
  startHour?: unknown
  endHour?: unknown
}): VisitSlotConfig {
  const slotMinutesNum = Number(raw.slotMinutes)
  const slotMinutes = ALLOWED_SLOT_MINUTES.includes(slotMinutesNum as AllowedSlotMinute)
    ? slotMinutesNum
    : 60

  let startHour = Math.trunc(Number(raw.startHour))
  if (!Number.isFinite(startHour) || startHour < 0) startHour = 0
  if (startHour > 23) startHour = 23

  let endHour = Math.trunc(Number(raw.endHour))
  if (!Number.isFinite(endHour) || endHour < 1) endHour = 1
  if (endHour > 24) endHour = 24

  if (endHour <= startHour) endHour = startHour + 1
  return { slotMinutes, startHour, endHour }
}

/** خانات اليوم ["08:00","08:30",…] حتى قبل النهاية */
export function hourSlots(cfg: VisitSlotConfig): string[] {
  const slots: string[] = []
  for (let t = cfg.startHour * 60; t < cfg.endHour * 60; t += cfg.slotMinutes) {
    slots.push(`${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`)
  }
  return slots
}

/** قراءة إعدادات الزيارات من uiPrefs (افتراضي 08:00→20:00 بخطوة 60) */
export async function readVisitSlotConfig(): Promise<VisitSlotConfig> {
  const { prefs } = await getUiPrefs()
  return normalizeSlotConfig({
    slotMinutes: prefs.visits_slot_minutes,
    startHour: prefs.visits_start_hour,
    endHour: prefs.visits_end_hour,
  })
}

/** كتابة إعدادات الزيارات في uiPrefs */
export async function writeVisitSlotConfig(cfg: VisitSlotConfig): Promise<void> {
  const { updateUiPrefs } = await import('@/lib/ui-prefs')
  await updateUiPrefs({
    visits_slot_minutes: cfg.slotMinutes,
    visits_start_hour: cfg.startHour,
    visits_end_hour: cfg.endHour,
  })
}

/** yyyy-MM-dd → Date منتصف ليل UTC (توحيد قيد UNIQUE date+hourSlot+employeeId) */
export function dayToUtcMidnight(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00.000Z')
}

/** Date → yyyy-MM-dd (UTC) */
export function dateToDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}
