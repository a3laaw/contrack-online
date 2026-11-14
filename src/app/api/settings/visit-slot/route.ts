// ============================================================
// GET /api/settings/visit-slot — إعدادات جدول الزيارات + آخر نسخة احتياطية
// PUT /api/settings/visit-slot — حفظ slot_minutes وساعات البداية/النهاية (مدير فقط)
// التخزين في Settings.uiPrefs: visits_slot_minutes / visits_start_hour / visits_end_hour
// القواعد: slot ∈ {15,20,30,60,90,120} وإلا رفض؛ start ∈ [0,23]؛ end ∈ [1,24]؛ end>start
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { adminGuard, authGuard, jsonError } from '@/lib/api-utils'
import { getUiPrefs } from '@/lib/ui-prefs'
import { ALLOWED_SLOT_MINUTES, normalizeSlotConfig, writeVisitSlotConfig } from '@/lib/visit-slots'
import type { VisitSlotSettingsDTO } from '@/lib/visits-types'

async function buildResponse(): Promise<VisitSlotSettingsDTO> {
  const { prefs } = await getUiPrefs()
  const cfg = normalizeSlotConfig({
    slotMinutes: prefs.visits_slot_minutes,
    startHour: prefs.visits_start_hour,
    endHour: prefs.visits_end_hour,
  })
  const lastBackupAt =
    typeof prefs.last_backup_at === 'string' ? (prefs.last_backup_at as string) : null
  return {
    slotMinutes: cfg.slotMinutes,
    startHour: cfg.startHour,
    endHour: cfg.endHour,
    lastBackupAt,
  }
}

export async function GET(req: NextRequest) {
  const g = await authGuard(req)
  if ('response' in g) return g.response
  return NextResponse.json(await buildResponse())
}

export async function PUT(req: NextRequest) {
  const g = await adminGuard(req)
  if ('response' in g) return g.response

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonError('طلب غير صالح', 400)
  }

  const slotMinutes = Math.trunc(Number(body.slotMinutes))
  if (!(ALLOWED_SLOT_MINUTES as readonly number[]).includes(slotMinutes)) {
    return jsonError(
      `مدة الحصة يجب أن تكون إحدى القيم: ${ALLOWED_SLOT_MINUTES.join(' / ')} دقيقة`,
      400,
    )
  }

  const startHour = Math.trunc(Number(body.startHour))
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) {
    return jsonError('ساعة البداية يجب أن تكون بين 0 و 23', 400)
  }
  const endHour = Math.trunc(Number(body.endHour))
  if (!Number.isInteger(endHour) || endHour < 1 || endHour > 24) {
    return jsonError('ساعة النهاية يجب أن تكون بين 1 و 24', 400)
  }
  if (endHour <= startHour) {
    return jsonError('ساعة النهاية يجب أن تكون بعد ساعة البداية', 400)
  }

  await writeVisitSlotConfig({ slotMinutes, startHour, endHour })
  return NextResponse.json(await buildResponse())
}
