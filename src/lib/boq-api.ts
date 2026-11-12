// ============================================================
// ConTrack Online — عميل API لبنود العقد (BOQ) والإشراف الهندسي
// يقلد نمط components/contrack/api.ts (توكن Bearer + أخطاء عربية)
// ============================================================
import { ApiError, getStoredToken } from '@/components/contrack/api'
import type {
  BoqDocDTO,
  BoqDocDetailDTO,
  BoqDocInput,
  BoqDocItemInput,
  BoqImportPreviewDTO,
  BoqImportRunDTO,
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

/** رفع ملف BOQ — multipart (لا يضبط Content-Type ليترك للمتصفح حد_boundary). */
async function upload<T>(url: string, file: File, mode: 'preview' | 'run'): Promise<T> {
  const token = getStoredToken()
  const fd = new FormData()
  fd.append('file', file)
  fd.append('mode', mode)
  const res = await fetch(url, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: fd,
  })
  if (!res.ok) {
    let msg = 'تعذر استيراد الملف'
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

  // ---------- استيراد BOQ من ملف ----------
  importPreview: (contractId: number, file: File) =>
    upload<BoqImportPreviewDTO>(`/api/contracts/${contractId}/boq/import`, file, 'preview'),
  importRun: (contractId: number, file: File) =>
    upload<BoqImportRunDTO>(`/api/contracts/${contractId}/boq/import`, file, 'run'),

  // ---------- وثائق جدول الكميات المستقلة (BOQ Doc — الإعدادات) ----------
  docs: () => request<{ docs: BoqDocDTO[] }>('/api/boq-docs'),
  createDoc: (input: BoqDocInput) =>
    request<{ doc: BoqDocDTO }>('/api/boq-docs', { method: 'POST', ...jsonBody(input) }),
  doc: (docId: number) => request<BoqDocDetailDTO>(`/api/boq-docs/${docId}`),
  updateDoc: (docId: number, input: Partial<BoqDocInput>) =>
    request<{ doc: BoqDocDetailDTO }>(`/api/boq-docs/${docId}`, { method: 'PATCH', ...jsonBody(input) }),
  deleteDoc: (docId: number) =>
    request<{ ok: boolean }>(`/api/boq-docs/${docId}`, { method: 'DELETE' }),
  addDocItem: (docId: number, input: BoqDocItemInput) =>
    request<{ id: number }>(`/api/boq-docs/${docId}/items`, { method: 'POST', ...jsonBody(input) }),
  updateDocItem: (itemId: number, input: Partial<BoqDocItemInput>) =>
    request<{ id: number }>(`/api/boq-doc-items/${itemId}`, { method: 'PATCH', ...jsonBody(input) }),
  deleteDocItem: (itemId: number) =>
    request<{ ok: boolean }>(`/api/boq-doc-items/${itemId}`, { method: 'DELETE' }),
  docImportPreview: (docId: number, file: File) =>
    upload<BoqImportPreviewDTO>(`/api/boq-docs/${docId}/import`, file, 'preview'),
  docImportRun: (docId: number, file: File) =>
    upload<BoqImportRunDTO>(`/api/boq-docs/${docId}/import`, file, 'run'),
}
