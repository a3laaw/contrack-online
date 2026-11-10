// ============================================================
// ConTrack Online — عميل API لموديول المتابعة/المستحقات + المستخدمين
// (بنفس نمط report-api.ts: توكن Bearer + أخطاء عربية)
// ============================================================
import { ApiError, getStoredToken } from '@/components/contrack/api'
import type { FollowupDTO, UserDTO, UserInput } from '@/lib/followup-types'

async function followupRequest<T>(url: string, init?: RequestInit): Promise<T> {
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

export const followupApi = {
  /** بيانات شاشة المتابعة والمستحقات (متأخرات + قادمة + مراحل مفتوحة) */
  followup: () => followupRequest<FollowupDTO>('/api/followup'),

  /** قائمة المستخدمين (مدير فقط) */
  users: () => followupRequest<UserDTO[]>('/api/users'),

  /** إنشاء مستخدم جديد (مدير فقط) */
  createUser: (input: UserInput) =>
    followupRequest<{ id: number; username: string }>('/api/users', {
      method: 'POST',
      ...jsonBody(input),
    }),

  /** تعديل مستخدم (مدير فقط) — الحذف غير متاح، استخدم isActive=false */
  updateUser: (id: number, input: UserInput) =>
    followupRequest<{ id: number; username: string; role: string; isActive: boolean }>(
      `/api/users/${id}`,
      { method: 'PATCH', ...jsonBody(input) },
    ),
}
