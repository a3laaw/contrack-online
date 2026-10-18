// ============================================================
// ConTrack Online — عميل API لموديول التقارير المالية
// (بنفس نمط components/contrack/api.ts: توكن Bearer + أخطاء عربية)
// ============================================================
import { ApiError, getStoredToken } from '@/components/contrack/api'
import type {
  CashFlowDTO,
  CustomerBalanceDTO,
  CustomerStatementDTO,
  DuesBoardDTO,
  DuesDTO,
  ExecutionDTO,
  ExpensesDTO,
  ProfitabilityDTO,
  ReportContractsDTO,
  ReportCustomerOption,
  ReportSummaryDTO,
  ReportVouchersDTO,
  StageDuesDTO,
  SubcontractorsDTO,
  SupervisionDelaysDTO,
} from '@/lib/report-types'

async function reportRequest<T>(url: string): Promise<T> {
  const token = getStoredToken()
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: 'no-store',
  })
  if (!res.ok) {
    let msg = 'تعذر جلب بيانات التقرير، يرجى المحاولة مرة أخرى'
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

/** بناء سلسلة استعلام من باراميترات اختيارية */
function buildQuery(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

export const reportApi = {
  /** ملخص مالي عام (إحصائيات + شهري + توزيع الحالات) */
  reportSummary: (params: { from?: string; to?: string } = {}) =>
    reportRequest<ReportSummaryDTO>(`/api/reports/summary${buildQuery({ from: params.from, to: params.to })}`),

  /** تقرير العقود مع المسدد ونسبة التقدم */
  reportContracts: (params: { status?: string; customerId?: number; from?: string; to?: string } = {}) =>
    reportRequest<ReportContractsDTO>(
      `/api/reports/contracts${buildQuery({
        status: params.status,
        customerId: params.customerId,
        from: params.from,
        to: params.to,
      })}`,
    ),

  /** كشف حساب عميل v2 (قيمة العقد/الملحقات المعتمدة/تمديد الإشراف/فواتير للعلم/رصيد تراكمي) */
  customerStatement: (params: { customerId: number; from?: string; to?: string; contractId?: number }) =>
    reportRequest<CustomerStatementDTO>(
      `/api/reports/customer-statement${buildQuery({
        customerId: params.customerId,
        from: params.from,
        to: params.to,
        contractId: params.contractId,
      })}`,
    ),

  /** العملاء والأرصدة (customers_full) */
  customersFull: (params: { from?: string; to?: string } = {}) =>
    reportRequest<CustomerBalanceDTO>(
      `/api/reports/customers-full${buildQuery({ from: params.from, to: params.to })}`,
    ),

  /** المستحقات (dues_report بقاعدة 35) */
  dues: (params: { from?: string; to?: string; customerId?: number } = {}) =>
    reportRequest<DuesDTO>(
      `/api/reports/dues${buildQuery({ from: params.from, to: params.to, customerId: params.customerId })}`,
    ),

  /** مستحقات العملاء بالمراحل (stage_dues) */
  stageDues: (params: { option?: string } = {}) =>
    reportRequest<StageDuesDTO>(`/api/reports/stage-dues${buildQuery({ option: params.option })}`),

  /** لوحة مستحقات الباطن (dues_board) */
  duesBoard: (params: { option?: string } = {}) =>
    reportRequest<DuesBoardDTO>(`/api/reports/dues-board${buildQuery({ option: params.option })}`),

  /** الربحية حسب العقد أو العميل */
  profitability: (params: { groupBy?: string; customerId?: number } = {}) =>
    reportRequest<ProfitabilityDTO>(
      `/api/reports/profitability${buildQuery({ groupBy: params.groupBy, customerId: params.customerId })}`,
    ),

  /** تقرير التنفيذ (المراحل المنجزة والمرحلة الحالية) */
  execution: (params: { filter?: string } = {}) =>
    reportRequest<ExecutionDTO>(`/api/reports/execution${buildQuery({ filter: params.filter })}`),

  /** المصروفات مجمّعة حسب حساب المصروف */
  expenses: (params: { from?: string; to?: string } = {}) =>
    reportRequest<ExpensesDTO>(`/api/reports/expenses${buildQuery({ from: params.from, to: params.to })}`),

  /** مقاولو الباطن */
  subcontractors: () => reportRequest<SubcontractorsDTO>('/api/reports/subcontractors'),

  /** تأخيرات الإشراف */
  supervisionDelays: (params: { filter?: string } = {}) =>
    reportRequest<SupervisionDelaysDTO>(`/api/reports/supervision-delays${buildQuery({ filter: params.filter })}`),

  /** التدفق النقدي التفصيلي أو الملخص بالفترات */
  cashFlow: (params: { mode?: string; group?: string; from?: string; to?: string } = {}) =>
    reportRequest<CashFlowDTO>(
      `/api/reports/cash-flow${buildQuery({ mode: params.mode, group: params.group, from: params.from, to: params.to })}`,
    ),

  /** تقرير السندات (قبض/صرف) مع فلاتر وبحث */
  reportVouchers: (params: { vtype?: string; from?: string; to?: string; contractId?: number; contractNumber?: string; q?: string } = {}) =>
    reportRequest<ReportVouchersDTO>(
      `/api/reports/vouchers${buildQuery({
        vtype: params.vtype,
        from: params.from,
        to: params.to,
        contractId: params.contractId,
        contractNumber: params.contractNumber,
        q: params.q,
      })}`,
    ),

  /** قائمة عملاء مختصرة لقوائم الاختيار (من /api/customers) */
  customers: async (): Promise<ReportCustomerOption[]> => {
    const token = getStoredToken()
    const res = await fetch('/api/customers', {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: 'no-store',
    })
    if (!res.ok) {
      let msg = 'تعذر جلب قائمة العملاء'
      try {
        const data = (await res.json()) as { error?: string }
        if (data?.error) msg = data.error
      } catch {
        /* تجاهل */
      }
      throw new ApiError(msg, res.status)
    }
    const data = (await res.json()) as { id: number; name: string; phone?: string }[]
    return data.map((c) => ({ id: c.id, name: c.name, phone: c.phone ?? '' }))
  },
}
