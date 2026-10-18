// ============================================================
// ConTrack Online — عميل API لسلف الموظفين والموظفين (spec-8-e §2)
// يقلد نمط lib/boq-api.ts (توكن Bearer + أخطاء عربية)
// ============================================================
import { ApiError, getStoredToken } from '@/components/contrack/api'
import type {
  AddEmployeeInput,
  AdvanceOpInput,
  AdvanceSummaryDTO,
  EmployeeListItemDTO,
} from '@/lib/advance-types'

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

export const advanceApi = {
  /** الموظفون بأرصدتهم + كشف الحركات (الأرصدة محسوبة دائمًا في الخادم) */
  list: () => request<AdvanceSummaryDTO>('/api/advances'),

  /** صرف سلفة — سند PV على حساب «سلف موظفين / قرض راتب» حصرًا */
  advance: (input: Omit<AdvanceOpInput, 'op'>) =>
    request<{ id: number; voucherNumber: string; amount: number }>('/api/advances', {
      method: 'POST',
      ...jsonBody({ op: 'advance', ...input }),
    }),

  /** رد نقدي — سند CV يخفض المصروف بحارس المتبقي */
  cashReturn: (input: Omit<AdvanceOpInput, 'op'>) =>
    request<{ id: number; voucherNumber: string; amount: number }>('/api/advances', {
      method: 'POST',
      ...jsonBody({ op: 'return', ...input }),
    }),

  /** خصم من راتب — سند SD بلا حركة نقدية على حساب «رواتب» */
  deduct: (input: Omit<AdvanceOpInput, 'op'>) =>
    request<{ id: number; voucherNumber: string; amount: number }>('/api/advances', {
      method: 'POST',
      ...jsonBody({ op: 'deduct', ...input }),
    }),

  /** إضافة موظف (مدير فقط) */
  addEmployee: (input: AddEmployeeInput) =>
    request<{ id: number; name: string }>('/api/advances', {
      method: 'POST',
      ...jsonBody({ op: 'addEmployee', ...input }),
    }),
}

export const employeesApi = {
  /** قائمة الموظفين مع الأرصدة */
  list: () => request<EmployeeListItemDTO[]>('/api/employees'),

  /** إنشاء موظف (مدير فقط) */
  create: (input: AddEmployeeInput) =>
    request<{ id: number; name: string }>('/api/employees', {
      method: 'POST',
      ...jsonBody(input),
    }),

  /** تعطيل/تفعيل موظف — ممنوع التعطيل برصيد > 0 (مدير فقط) */
  setActive: (id: number, active: boolean) =>
    request<{ id: number; active: boolean }>(`/api/employees?id=${id}`, {
      method: 'PATCH',
      ...jsonBody({ active }),
    }),
}
