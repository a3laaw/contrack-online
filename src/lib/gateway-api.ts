// ============================================================
// ConTrack Online — عميل API لبوابة الدفع وتسديدات الشركة الأخرى
// (نمط boq-api: توكن Bearer + أخطاء عربية)
// ============================================================
import { ApiError, getStoredToken } from '@/components/contrack/api'
import type {
  ClearingDTO,
  GatewayOpDTO,
  GatewayOpState,
  GatewayProfileDTO,
  GatewayProfileInput,
  ImportResultDTO,
  OtherTransferInput,
  OtherTransfersDTO,
} from '@/lib/gateway-types'

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

export type RawRow = Record<string, string>

export const gatewayApi = {
  // ---------- البوابات ----------
  profiles: () => request<GatewayProfileDTO[]>('/api/gateway/profiles'),
  createProfile: (input: GatewayProfileInput) =>
    request<{ id: number }>('/api/gateway/profiles', { method: 'POST', ...jsonBody(input) }),
  updateProfile: (id: number, input: GatewayProfileInput) =>
    request<{ id: number }>('/api/gateway/profiles', { method: 'PATCH', ...jsonBody({ id, ...input }) }),
  deleteProfile: (id: number) =>
    request<{ ok: boolean }>(`/api/gateway/profiles?id=${id}`, { method: 'DELETE' }),

  // ---------- الاستيراد (صفوف CSV ملصوقة + كشف بنك اختياري) ----------
  import: (input: { profileId: number; rows: RawRow[]; bank?: RawRow[]; batch?: string }) =>
    request<ImportResultDTO>('/api/gateway/import', { method: 'POST', ...jsonBody(input) }),

  // ---------- العمليات ----------
  ops: (
    params: {
      profileId?: number
      state?: string // mine | diff | other | unmarked (يفصل بفواصل)
      distributed?: boolean
      from?: string
      to?: string
      q?: string
    } = {},
  ) => {
    const sp = new URLSearchParams()
    if (params.profileId) sp.set('profileId', String(params.profileId))
    if (params.state) sp.set('state', params.state)
    if (params.distributed !== undefined) sp.set('distributed', String(params.distributed))
    if (params.from) sp.set('from', params.from)
    if (params.to) sp.set('to', params.to)
    if (params.q) sp.set('q', params.q)
    const qs = sp.toString()
    return request<GatewayOpDTO[]>(`/api/gateway/ops${qs ? `?${qs}` : ''}`)
  },

  classifyOps: (ids: number[], state: GatewayOpState, contractHint?: number | null) =>
    request<{ updated: number; skipped: number }>('/api/gateway/ops', {
      method: 'PATCH',
      ...jsonBody({ ids, action: 'classify', state, contractHint: contractHint ?? null }),
    }),

  distributeOps: (ids: number[]) =>
    request<{ distributed: number; skipped: number; reasons: string[] }>('/api/gateway/ops', {
      method: 'PATCH',
      ...jsonBody({ ids, action: 'distribute' }),
    }),

  /** عكس التوزيع — الموزَّع لا يُمس إلا بهذا (والمسدد للشركة الأخرى يُرفض) */
  undistributeOps: (ids: number[]) =>
    request<{ updated: number; skipped: number; reasons: string[] }>('/api/gateway/ops', {
      method: 'PATCH',
      ...jsonBody({ ids, action: 'undistribute' }),
    }),

  // ---------- التصفية اليومية ----------
  clearing: (profileId: number) =>
    request<ClearingDTO>(`/api/gateway/clearing?profileId=${profileId}`),

  // ---------- تسديدات الشركة الأخرى ----------
  otherTransfers: () => request<OtherTransfersDTO>('/api/other-transfers'),
  createOtherTransfer: (input: OtherTransferInput) =>
    request<{ id: number; allocated: number; remaining: number; completedOps: number }>(
      '/api/other-transfers',
      { method: 'POST', ...jsonBody(input) },
    ),
  deleteOtherTransfer: (id: number) =>
    request<{ ok: boolean; reopened: number }>(`/api/other-transfers/${id}`, { method: 'DELETE' }),
}
