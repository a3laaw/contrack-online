// ============================================================
// ConTrack Online — عميل API للمطالبات المالية (المرحلة 4)
// يقلد نمط lib/boq-api.ts (توكن Bearer + أخطاء عربية + no-store)
// ============================================================
import { ApiError, getStoredToken } from '@/components/contrack/api'
import type { ClaimsSummaryDTO, ClaimStatus } from '@/lib/claim-types'

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

export interface ClaimUpdatePatch {
  title?: string
  amount?: number
  dueDate?: string
  voucherRef?: string
  notes?: string
}

export const claimApi = {
  /** قائمة المطالبات + المجاميع — GET /api/claims بفلاتر query */
  list: (filters?: { direction?: 'out' | 'in'; status?: string; contractId?: number; q?: string }) => {
    const qs = new URLSearchParams()
    if (filters?.direction) qs.set('direction', filters.direction)
    if (filters?.status) qs.set('status', filters.status)
    if (filters?.contractId) qs.set('contractId', String(filters.contractId))
    if (filters?.q) qs.set('q', filters.q)
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    return request<ClaimsSummaryDTO>(`/api/claims${suffix}`)
  },

  /** تسجيل مطالبة جديدة (حالة ابتدائية registered) — POST /api/claims */
  create: (input: {
    direction: 'out' | 'in'
    contractId: number
    subContractId?: number | null
    custLineId?: number | null
    subLineId?: number | null
    title: string
    amount: number
    dueDate?: string
    voucherRef?: string
    notes?: string
  }) => request<{ id: number }>('/api/claims', { method: 'POST', ...jsonBody(input) }),

  /** تعديل (registered فقط) — PATCH /api/claims/{id} body {op:'update',...} */
  update: (id: number, patch: ClaimUpdatePatch) =>
    request<void>(`/api/claims/${id}`, {
      method: 'PATCH',
      ...jsonBody({ op: 'update', ...patch }),
    }),

  /** تغيير الحالة (آلة انتقالات صارمة) — PATCH body {op:'status', status, postponedUntil} */
  setStatus: (id: number, status: ClaimStatus, postponedUntil?: string) =>
    request<void>(`/api/claims/${id}`, {
      method: 'PATCH',
      ...jsonBody({ op: 'status', status, postponedUntil }),
    }),

  /** حذف (registered فقط) — DELETE /api/claims/{id} */
  remove: (id: number) => request<void>(`/api/claims/${id}`, { method: 'DELETE' }),
}
