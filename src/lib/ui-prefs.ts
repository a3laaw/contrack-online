// ============================================================
// ConTrack Online — مساعد قراءة/كتابة Settings.uiPrefs (JSON)
// (prefs_service — تفضيلات الواجهة والإعدادات الناعمة فقط)
// ============================================================
import { db } from '@/lib/db'

export type UiPrefs = Record<string, unknown>

/** يضمن وجود صف الإعدادات الواحد ويعيد uiPrefs مفكوكة بأمان */
export async function getUiPrefs(): Promise<{ prefs: UiPrefs }> {
  const s = await db.settings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  })
  let prefs: UiPrefs = {}
  if (s.uiPrefs) {
    try {
      const parsed: unknown = JSON.parse(s.uiPrefs)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        prefs = parsed as UiPrefs
      }
    } catch {
      prefs = {}
    }
  }
  return { prefs }
}

/** دمج مفاتيح فوق uiPrefs الحالية وكتابتها */
export async function updateUiPrefs(patch: UiPrefs): Promise<UiPrefs> {
  const { prefs } = await getUiPrefs()
  const next = { ...prefs, ...patch }
  await db.settings.update({ where: { id: 1 }, data: { uiPrefs: JSON.stringify(next) } })
  return next
}
