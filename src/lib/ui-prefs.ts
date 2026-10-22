// ============================================================
// ConTrack Online — مساعد قراءة/كتابة Settings.uiPrefs (JSON)
// (prefs_service — تفضيلات الواجهة والإعدادات الناعمة فقط)
// Task 85 — SaaS: صف إعدادات لكل شركة (PK = company_id)
// ============================================================
import { db, currentCompanyId } from '@/lib/db'

export type UiPrefs = Record<string, unknown>

/** يضمن وجود صف الإعدادات لشركة السياق ويعيد uiPrefs مفكوكة بأمان */
export async function getUiPrefs(): Promise<{ prefs: UiPrefs }> {
  const companyId = await currentCompanyId()
  if (companyId == null) return { prefs: {} }
  const s = await db.setting.upsert({
    where: { companyId },
    create: { companyId },
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
  const companyId = await currentCompanyId()
  if (companyId == null) throw new Error('سياق الشركة مفقود لتفضيلات الواجهة')
  const { prefs } = await getUiPrefs()
  const next = { ...prefs, ...patch }
  await db.setting.update({ where: { companyId }, data: { uiPrefs: JSON.stringify(next) } })
  return next
}
