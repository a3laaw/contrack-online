// ============================================================
// ConTrack Online — عميل API لوحدات الإنتاجية (Task 15-b)
// البحث الشامل · المهام · التعليقات · ملف العميل · الأرشيف · المجموعات
// (يقلد نمط boq-api.ts / followup-api.ts: توكن Bearer + أخطاء عربية)
// ============================================================
import { ApiError, getStoredToken } from '@/components/contrack/api'
import type {
  ArchiveDTO,
  ArchiveOpType,
  CommentDTO,
  CommentInput,
  CommentsResponseDTO,
  CustomerFileDTO,
  GroupCreateInput,
  GroupsResponseDTO,
  SearchResponseDTO,
  TaskInput,
  TasksResponseDTO,
} from '@/lib/productivity-types'

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

export const searchApi = {
  /** البحث الشامل (حرفان على الأقل — الخادم يطبّع العربية) */
  search: (q: string) =>
    request<SearchResponseDTO>(`/api/search?q=${encodeURIComponent(q)}`),
}

export const tasksApi = {
  list: (params: { status?: string; q?: string; customerId?: number; contractId?: number } = {}) => {
    const sp = new URLSearchParams()
    if (params.status && params.status !== 'all') sp.set('status', params.status)
    if (params.q) sp.set('q', params.q)
    if (params.customerId) sp.set('customerId', String(params.customerId))
    if (params.contractId) sp.set('contractId', String(params.contractId))
    const qs = sp.toString()
    return request<TasksResponseDTO>(`/api/tasks${qs ? `?${qs}` : ''}`)
  },
  create: (input: TaskInput) =>
    request<{ id: number }>('/api/tasks', { method: 'POST', ...jsonBody(input) }),
  update: (id: number, input: TaskInput & { op?: 'update' | 'complete' | 'reopen' }) =>
    request<{ id: number }>(`/api/tasks/${id}`, { method: 'PATCH', ...jsonBody(input) }),
  complete: (id: number) =>
    request<{ id: number }>(`/api/tasks/${id}`, { method: 'PATCH', ...jsonBody({ op: 'complete' }) }),
  reopen: (id: number) =>
    request<{ id: number }>(`/api/tasks/${id}`, { method: 'PATCH', ...jsonBody({ op: 'reopen' }) }),
  remove: (id: number) =>
    request<{ ok: boolean }>(`/api/tasks/${id}`, { method: 'DELETE' }),
}

export const commentsApi = {
  list: (params: { customerId?: number; contractId?: number; latest?: number } = {}) => {
    const sp = new URLSearchParams()
    if (params.customerId) sp.set('customerId', String(params.customerId))
    if (params.contractId) sp.set('contractId', String(params.contractId))
    if (params.latest) sp.set('latest', String(params.latest))
    const qs = sp.toString()
    return request<CommentsResponseDTO>(`/api/comments${qs ? `?${qs}` : ''}`)
  },
  create: (input: CommentInput) =>
    request<{ id: number }>('/api/comments', { method: 'POST', ...jsonBody(input) }),
  /** تعديل نص/نوع/أولوية (مدير فقط) */
  edit: (id: number, input: Pick<CommentInput, 'text' | 'kind' | 'priority' | 'followupDate'>) =>
    request<{ id: number }>(`/api/comments/${id}`, {
      method: 'PATCH',
      ...jsonBody({ op: 'edit', ...input }),
    }),
  /** تثبيت/إلغاء تثبيت (مدير فقط) — يعيد الحالة الجديدة */
  togglePin: (id: number) =>
    request<{ id: number; pinned: boolean }>(`/api/comments/${id}`, {
      method: 'PATCH',
      ...jsonBody({ op: 'pin' }),
    }),
  /** حذف ناعم (صاحب التعليق أو المدير) */
  remove: (id: number) =>
    request<{ ok: boolean }>(`/api/comments/${id}`, { method: 'DELETE' }),
}

export const customerFileApi = {
  file: (customerId: number) => request<CustomerFileDTO>(`/api/customer-file/${customerId}`),
}

export const archiveApi = {
  list: () => request<ArchiveDTO>('/api/archive'),
  /** أرشفة/استرجاع (مدير فقط) — أرشفة العقد لا تغير حساباته ماليًا */
  setArchived: (op: 'archive' | 'unarchive', type: ArchiveOpType, id: number) =>
    request<{ ok: boolean }>('/api/archive', { method: 'POST', ...jsonBody({ op, type, id }) }),
}

export const groupsApi = {
  list: () => request<GroupsResponseDTO>('/api/groups'),
  create: (input: GroupCreateInput) =>
    request<{ id: number; groupNumber: string }>('/api/groups', { method: 'POST', ...jsonBody(input) }),
  addContract: (groupId: number, contractId: number) =>
    request<{ ok: boolean }>(`/api/groups/${groupId}`, {
      method: 'PATCH',
      ...jsonBody({ op: 'add', contractId }),
    }),
  removeContract: (groupId: number, contractId: number) =>
    request<{ ok: boolean }>(`/api/groups/${groupId}`, {
      method: 'PATCH',
      ...jsonBody({ op: 'remove', contractId }),
    }),
  update: (groupId: number, input: { name?: string; notes?: string }) =>
    request<{ id: number }>(`/api/groups/${groupId}`, {
      method: 'PATCH',
      ...jsonBody({ op: 'update', ...input }),
    }),
  remove: (groupId: number) =>
    request<{ ok: boolean }>(`/api/groups/${groupId}`, { method: 'DELETE' }),
}
