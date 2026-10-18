// ============================================================
// ConTrack Online — عميل API للعُهد والتصفيات (spec-8-e §1)
// يقلد نمط lib/boq-api.ts (توكن Bearer + أخطاء عربية)
// ============================================================
import { ApiError, getStoredToken } from '@/components/contrack/api'
import type {
  CustodyAddAccountInput,
  CustodyHandoverInput,
  CustodyOpResult,
  CustodyReturnInput,
  CustodySettleInput,
  CustodySettleResult,
  CustodySummaryDTO,
} from '@/lib/custody-types'

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

export const custodyApi = {
  /** حسابات العهدة + الحركات (الأرصدة محسوبة دائمًا في الخادم) */
  list: (params: { employee?: string; accountId?: number } = {}) => {
    const sp = new URLSearchParams()
    if (params.employee) sp.set('employee', params.employee)
    if (params.accountId) sp.set('accountId', String(params.accountId))
    const qs = sp.toString()
    return request<CustodySummaryDTO>(`/api/custody${qs ? `?${qs}` : ''}`)
  },

  /** ① تسليم عهدة — سند صرف PV على حساب العهدة (بلا حساب مصروف) */
  handover: (input: CustodyHandoverInput) =>
    request<{ id: number; voucherNumber: string; amount: number }>('/api/custody', {
      method: 'POST',
      ...jsonBody({ op: 'handover', ...input }),
    }),

  /** ② تصفية عهدة — دفعة سندات مجمّعة تحت مرجع PAY-GRP-YYYYMMDD-### (بلا نقدية جديدة) */
  settle: (input: CustodySettleInput) =>
    request<CustodySettleResult>('/api/custody', {
      method: 'POST',
      ...jsonBody({ op: 'settle', ...input }),
    }),

  /** ③ إرجاع متبقٍ للخزينة — سند custody_return بحارس المتبقي */
  returnCustody: (input: CustodyReturnInput) =>
    request<{ id: number; voucherNumber: string; amount: number }>('/api/custody', {
      method: 'POST',
      ...jsonBody({ op: 'return', ...input }),
    }),

  /** إنشاء حساب عهدة (مدير فقط) — تحت الجذر «عهد الموظفين» */
  addAccount: (input: CustodyAddAccountInput) =>
    request<{ id: number; name: string }>('/api/custody', {
      method: 'POST',
      ...jsonBody({ op: 'addAccount', ...input }),
    }),
}

export type { CustodyOpResult }
