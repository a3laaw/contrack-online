// ============================================================
// ConTrack Online — عميل API لموديول مقاولي الباطن
// يقلد نمط components/contrack/api.ts (توكن Bearer + أخطاء عربية)
// ============================================================
import { ApiError, getStoredToken } from '@/components/contrack/api'
import type {
  SubContractDetailDTO,
  SubContractInput,
  SubContractListItem,
  SubContractPaymentDTO,
  SubPaymentVoucherInput,
  SubcontractorDTO,
  SubcontractorInput,
} from '@/lib/subcontract-types'

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

export interface SubContractPatch {
  amount?: number
  startDate?: string | null
  endDate?: string | null
  description?: string
  status?: string
}

export interface SubPaymentInput {
  title: string
  dueDate: string
  amount: number
  stageId?: number | null
}

export const subApi = {
  // ---------- مقاولو الباطن ----------
  subcontractors: (q = '') =>
    request<SubcontractorDTO[]>(`/api/subcontractors${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  createSubcontractor: (input: SubcontractorInput) =>
    request<{ id: number; subCode: string }>('/api/subcontractors', {
      method: 'POST',
      ...jsonBody(input),
    }),
  updateSubcontractor: (id: number, patch: Partial<SubcontractorInput>) =>
    request<{ id: number }>(`/api/subcontractors/${id}`, { method: 'PATCH', ...jsonBody(patch) }),
  deleteSubcontractor: (id: number) =>
    request<{ ok: boolean }>(`/api/subcontractors/${id}`, { method: 'DELETE' }),

  // ---------- العقود الباطنة ----------
  subcontracts: (filters: { contractId?: number; subcontractorId?: number; status?: string } = {}) => {
    const sp = new URLSearchParams()
    if (filters.contractId) sp.set('contractId', String(filters.contractId))
    if (filters.subcontractorId) sp.set('subcontractorId', String(filters.subcontractorId))
    if (filters.status) sp.set('status', filters.status)
    const qs = sp.toString()
    return request<SubContractListItem[]>(`/api/subcontracts${qs ? `?${qs}` : ''}`)
  },
  subContract: (id: number) => request<SubContractDetailDTO>(`/api/subcontracts/${id}`),
  createSubContract: (input: SubContractInput) =>
    request<{ id: number }>('/api/subcontracts', { method: 'POST', ...jsonBody(input) }),
  updateSubContract: (id: number, patch: SubContractPatch) =>
    request<{ id: number }>(`/api/subcontracts/${id}`, { method: 'PATCH', ...jsonBody(patch) }),

  // ---------- دفعات العقود الباطنة ----------
  addSubPayment: (id: number, input: SubPaymentInput) =>
    request<{ id: number }>(`/api/subcontracts/${id}/payments`, {
      method: 'POST',
      ...jsonBody(input),
    }),
  deleteSubPayment: (id: number) =>
    request<{ ok: boolean }>(`/api/sub-payments/${id}`, { method: 'DELETE' }),

  // ---------- سند صرف مرتبط بدفعة باطن ----------
  createSubPaymentVoucher: (input: SubPaymentVoucherInput) =>
    request<{ id: number; voucherNumber: string; amount: number }>('/api/vouchers', {
      method: 'POST',
      ...jsonBody(input),
    }),
}

export type { SubContractDetailDTO, SubContractListItem, SubContractPaymentDTO, SubcontractorDTO }
