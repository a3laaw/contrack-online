// ============================================================
// ConTrack Online — عميل API لجدول الزيارات + إعدادات خانات الزيارات
// + جسر إلى وحدة المهام (productivityApi — ملكية وكيل 15-b)
// بنفس نمط followup-api.ts: توكن Bearer + أخطاء عربية
// ============================================================
import { ApiError, getStoredToken } from '@/components/contrack/api'
import type {
  EmployeeDTO,
  VisitBookingInput,
  VisitDTO,
  VisitsGridDTO,
  VisitSlotSettingsDTO,
  VisitTaskInput,
} from './visits-types'

async function visitsRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken()
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  })
  if (!res.ok) {
    let msg = 'تعذر تنفيذ الطلب، يرجى المحاولة مرة أخرى'
    try {
      const data = (await res.json()) as { error?: string }
      if (data?.error) msg = data.error
    } catch {
      /* تجاهل */
    }
    throw new ApiError(msg, res.status)
  }
  return (await res.json()) as T
}

const jsonBody = (body: unknown): RequestInit => ({ body: JSON.stringify(body) })

export const visitsApi = {
  /** موظفون من شاشة السلف (وكيل 14-a) — قد لا يكتمل المسار: ترجع [] عند الفشل */
  async employees(): Promise<EmployeeDTO[]> {
    try {
      return await visitsRequest<EmployeeDTO[]>('/api/employees')
    } catch {
      return [] // المسار غير جاهز أو فشل — تعتمد الشبكة على احتياطي /api/visits
    }
  },

  /** شبكة يوم كامل: الخانات + الزيارات + إعدادات الحصص */
  grid: (date: string) =>
    visitsRequest<VisitsGridDTO>(`/api/visits?date=${encodeURIComponent(date)}`),

  /** حجز خانة (تعارض عميل آخر ⇒ 400) أو تحديث زيارة نفس العميل */
  book: (input: VisitBookingInput) =>
    visitsRequest<{ visit: VisitDTO }>('/api/visits', { method: 'POST', ...jsonBody(input) }),

  /** تفريغ خانة = حذف فعلي للزيارة */
  clear: (id: number) =>
    visitsRequest<{ ok: boolean }>(`/api/visits?id=${id}`, { method: 'DELETE' }),

  /** تثبيت معرّف المهمة على الزيارة بعد الترحيل (visits.task_id كالأصل) */
  markTask: (id: number, taskId: number) =>
    visitsRequest<{ ok: boolean }>('/api/visits', {
      method: 'PATCH',
      ...jsonBody({ id, taskId }),
    }),

  /** إعدادات تاب الزيارات (slot_minutes + ساعات البداية/النهاية + آخر نسخة احتياطية) */
  slotSettings: () => visitsRequest<VisitSlotSettingsDTO>('/api/settings/visit-slot'),

  /** حفظ إعدادات خانات الزيارات (مدير فقط) */
  saveSlotSettings: (input: { slotMinutes: number; startHour: number; endHour: number }) =>
    visitsRequest<VisitSlotSettingsDTO>('/api/settings/visit-slot', {
      method: 'PUT',
      ...jsonBody(input),
    }),
}

// ------------------------------------------------------------
// جسر وحدة المهام (يملكها وكيل 15-b عبر /api/tasks)
// التوقيع المتفق عليه: POST {op:'create', title, description, dueAt, customerId, contractId, source}
// إن لم يكن المسار جاهزًا فالأزرار تُخفى (لا تكسر البناء)
// ------------------------------------------------------------
export const productivityApi = {
  /** فحص توفر وحدة المهام — GET /api/tasks يرجع 200 إن وُجد المسار */
  async available(): Promise<boolean> {
    try {
      const token = getStoredToken()
      const res = await fetch('/api/tasks', {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        cache: 'no-store',
      })
      // 200 = وحدة المهام جاهزة؛ أي شيء آخر (404/405/500) = غير متاحة بعد
      return res.ok
    } catch {
      return false
    }
  },

  /** ترحيل زيارة كمهمة */
  createTask: (input: VisitTaskInput) =>
    visitsRequest<{ id: number }>('/api/tasks', { method: 'POST', ...jsonBody(input) }),
}
