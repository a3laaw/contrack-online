// ============================================================
// ConTrack Online — عميل API للفواتير (نمط boq-api: توكن Bearer + أخطاء عربية)
// ============================================================
import { ApiError, getStoredToken } from '@/components/contrack/api'
import type { InvoiceDTO, InvoiceInput } from '@/lib/invoice-types'

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

export const invoiceApi = {
  list: (params: { q?: string; customerId?: number; contractId?: number } = {}) => {
    const sp = new URLSearchParams()
    if (params.q) sp.set('q', params.q)
    if (params.customerId) sp.set('customerId', String(params.customerId))
    if (params.contractId) sp.set('contractId', String(params.contractId))
    const qs = sp.toString()
    return request<InvoiceDTO[]>(`/api/invoices${qs ? `?${qs}` : ''}`)
  },

  create: (input: InvoiceInput) =>
    request<{ id: number; invoiceNumber: string; amount: number; billableRemaining: number }>(
      '/api/invoices',
      { method: 'POST', ...jsonBody(input) },
    ),

  update: (id: number, patch: Partial<Pick<InvoiceInput, 'invoiceDate' | 'description' | 'amount' | 'notes'>>) =>
    request<{ id: number }>(`/api/invoices/${id}`, { method: 'PATCH', ...jsonBody(patch) }),

  /** حذف فيزيائي — مدير فقط (كالأصل DELETE بلا أرشفة) */
  remove: (id: number) => request<{ ok: boolean }>(`/api/invoices/${id}`, { method: 'DELETE' }),
}
