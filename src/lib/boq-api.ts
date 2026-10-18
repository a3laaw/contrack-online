// ============================================================
// ConTrack Online — عميل API لبنود العقد (BOQ) والإشراف الهندسي
// يقلد نمط components/contrack/api.ts (توكن Bearer + أخطاء عربية)
// ============================================================
import { ApiError, getStoredToken } from '@/components/contrack/api'
import type {
  BoqInput,
  BoqSummaryDTO,
  SupervisionDTO,
  SupervisionInput,
} from '@/lib/boq-types'

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

export const boqApi = {
  // ---------- بنود العقد (BOQ) ----------
  boqItems: (contractId: number) => request<BoqSummaryDTO>(`/api/contracts/${contractId}/items`),
  addBoqItem: (contractId: number, input: BoqInput) =>
    request<{ id: number }>(`/api/contracts/${contractId}/items`, {
      method: 'POST',
      ...jsonBody(input),
    }),
  updateBoqItem: (itemId: number, input: Partial<BoqInput>) =>
    request<{ id: number }>(`/api/items/${itemId}`, { method: 'PATCH', ...jsonBody(input) }),
  deleteBoqItem: (itemId: number) =>
    request<{ ok: boolean }>(`/api/items/${itemId}`, { method: 'DELETE' }),

  // ---------- الإشراف الهندسي ----------
  supervision: (contractId: number) =>
    request<SupervisionDTO>(`/api/contracts/${contractId}/supervision`),
  updateSupervision: (contractId: number, input: SupervisionInput) =>
    request<{ id: number }>(`/api/contracts/${contractId}/supervision`, {
      method: 'PATCH',
      ...jsonBody(input),
    }),
}
