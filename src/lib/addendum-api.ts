// ============================================================
// ConTrack Online — عميل API للملاحق/الأوامر التغييرية (المرحلة 4)
// يقلد نمط lib/boq-api.ts (توكن Bearer + أخطاء عربية + no-store)
// ============================================================
import { ApiError, getStoredToken } from '@/components/contrack/api'
import type {
  AddendumInput,
  AddendumPartInput,
  AddendumSummaryDTO,
} from '@/lib/addendum-types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
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
    let msg = 'حدث خطأ غير متوقع، يرجى المحاولة مرة أخرى'
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

export const addendumApi = {
  /** قائمة ملاحق العقد + المجاميع — GET /api/contracts/{id}/addendums */
  list: (contractId: number) =>
    request<AddendumSummaryDTO>(`/api/contracts/${contractId}/addendums`),

  /** إنشاء مسودة أمر — POST نفس المسار */
  create: (contractId: number, input: AddendumInput) =>
    request<{ id: number }>(`/api/contracts/${contractId}/addendums`, {
      method: 'POST',
      ...jsonBody(input),
    }),

  /** تعديل رأس الأمر (مسودة فقط) — PATCH /api/addendums/{id} */
  update: (id: number, input: AddendumInput) =>
    request<void>(`/api/addendums/${id}`, { method: 'PATCH', ...jsonBody(input) }),

  /** إضافة جزء (مسودة فقط) — POST /api/addendums/{id} body {op:'addPart', part} */
  addPart: (id: number, part: AddendumPartInput) =>
    request<{ id: number }>(`/api/addendums/${id}`, {
      method: 'POST',
      ...jsonBody({ op: 'addPart', part }),
    }),

  /** إزالة جزء (مسودة فقط) — POST نفس المسار body {op:'removePart', partId} */
  removePart: (id: number, partId: number) =>
    request<void>(`/api/addendums/${id}`, {
      method: 'POST',
      ...jsonBody({ op: 'removePart', partId }),
    }),

  /** اعتماد الأمر وتنفيذه (مسودة فقط) — POST نفس المسار body {op:'approve'} */
  approve: (id: number) =>
    request<void>(`/api/addendums/${id}`, {
      method: 'POST',
      ...jsonBody({ op: 'approve' }),
    }),

  /** إلغاء الأمر (سبب إلزامي — يسترجع البنود إن كان معتمدًا) — body {op:'cancel', cancelReason} */
  cancel: (id: number, cancelReason: string) =>
    request<void>(`/api/addendums/${id}`, {
      method: 'POST',
      ...jsonBody({ op: 'cancel', cancelReason }),
    }),
}
