// ============================================================
// ConTrack Online — أنواع DTO لموديول التقارير المالية
// (مطابقة لاستجابات مسارات /api/reports/*)
// ============================================================

/** ملخص المالية العامة (تبويب «ملخص مالي») */
export interface ReportSummaryDTO {
  range: { from: string | null; to: string | null }
  totals: {
    contractsCount: number
    contractsAmount: number
    receiptsCount: number
    receiptsAmount: number
    paymentsCount: number
    paymentsAmount: number
    netCash: number
    overdueCount: number
    overdueAmount: number
  }
  /** month بصيغة '2025-01' — آخر 12 شهرًا حتى لو صفر */
  monthly: { month: string; receipts: number; payments: number }[]
  byStatus: { status: string; count: number; amount: number }[]
}

/** صف تقرير العقود — القيمة الحالية (قاعدة 35) */
export interface ReportContractRow {
  id: number
  contractNumber: string
  contractName: string
  customerName: string
  contractType: string
  contractDate: string
  /** القيمة الحالية = الخام + صافي ملحقات معتمدة + تمديد إشراف */
  amount: number
  rawAmount: number
  netAddendum: number
  supExtension: number
  paidAmount: number
  remaining: number
  progressPct: number
  status: string
}

export interface ReportContractsDTO {
  rows: ReportContractRow[]
  totals: {
    count: number
    amount: number
    paidAmount: number
    remaining: number
  }
}

/** صف كشف حساب عميل v2 — قيود statement_service كاملة */
export interface CustomerStatementRow {
  date: string
  contractNumber: string
  /** move | opening | subtotal | total */
  kind: 'move' | 'opening' | 'subtotal' | 'total'
  ref: string
  description: string
  debit: number
  credit: number
  balance: number
}

export interface CustomerStatementDTO {
  customer: { id: number; name: string; phone: string; code: string }
  contracts: string[]
  rows: CustomerStatementRow[]
  totals: {
    /** رصيد أول الفترة (0 بلا فلتر) */
    opening: number
    /** إجمالي المدين للفترة */
    debit: number
    /** إجمالي الدائن للفترة */
    credit: number
    /** الرصيد الختامي (المتبقي) */
    balance: number
  }
}

/** صف تقرير السندات */
export interface ReportVoucherRow {
  id: number
  voucherNumber: string
  vtype: string
  vdate: string
  party: string
  method: string
  account: string
  amount: number
  description: string
  contractNumber: string | null
  cancelled: boolean
}

export interface ReportVouchersDTO {
  rows: ReportVoucherRow[]
  totals: {
    count: number
    amount: number
  }
}

/** عميل مختصر لقوائم الاختيار في التقارير */
export interface ReportCustomerOption {
  id: number
  name: string
  phone: string
}

// ============================================================
// تقرير «العملاء والأرصدة» (customers_full)
// ============================================================

export interface CustomerBalanceRow {
  customerId: number
  code: string
  name: string
  phone: string
  contractsCount: number
  /** مجموع قيمة العقود الخام */
  rawValue: number
  /** القيمة الحالية بقاعدة 35 */
  currentValue: number
  collected: number
  /** المستحق الآن (صارم V4.3 + عقود بلا خطة) */
  dueNow: number
  /** المتبقي = القيمة الحالية − المحصّل */
  remaining: number
  /** كشف: إجمالي المدين */
  debit: number
  /** كشف: إجمالي الدائن */
  credit: number
  /** مستحق الآن | عليه رصيد | مسدّد بالكامل | '' */
  status: string
}

export interface CustomerBalanceDTO {
  rows: CustomerBalanceRow[]
  totals: {
    customers: number
    contracts: number
    rawValue: number
    currentValue: number
    collected: number
    dueNow: number
    remaining: number
    debit: number
    credit: number
  }
}

// ============================================================
// تقرير المستحقات (dues_report)
// ============================================================

export interface DuesRow {
  contractId: number
  contractNumber: string
  contractName: string
  customerName: string
  contractType: string
  status: string
  contractDate: string
  /** القيمة الحالية بقاعدة 35 */
  value: number
  rawAmount: number
  netAddendum: number
  supExtension: number
  collected: number
  remaining: number
}

export interface DuesDTO {
  rows: DuesRow[]
  totals: { count: number; value: number; collected: number; remaining: number }
}

// ============================================================
// مستحقات العملاء بالمراحل (stage_dues V4.4)
// ============================================================

export interface StageDuesRow {
  contractId: number
  contract: string
  customer: string
  stage: string
  /** تاريخ انتهاء المرحلة أو '—' */
  ended: string
  /** عناوين الدفعات مفصولة بـ«،» */
  titles: string
  /** المستحق الآن الصارم */
  due: number
  remaining: number
  status: string
  overdue: boolean
}

export interface StageDuesDTO {
  rows: StageDuesRow[]
  totals: { n: number; dueNow: number; remaining: number; overdueN: number }
}

// ============================================================
// لوحة مستحقات الباطن (dues_board V4.3)
// ============================================================

export interface DuesBoardRow {
  subContractId: number
  contractId: number
  contract: string
  party: string
  stage: string
  title: string
  /** تاريخ الاستحقاق أو triggered + ' ✓' */
  due: string
  amount: number
  paid: number
  remaining: number
  status: string
  /** مرحلة | أيام | مشتق */
  source: string
  sources: string
  /** المستحق الآن حسب قاعدة _due_now */
  dueNow: boolean
}

export interface DuesBoardDTO {
  rows: DuesBoardRow[]
  totals: { n: number; amount: number; paid: number; subRemaining: number; overdueN: number }
}

// ============================================================
// الربحية (profitability_report)
// ============================================================

export interface ProfitabilityRow {
  id: number
  customerId?: number
  customerName?: string
  contractNumber: string
  contractName: string
  contractType: string
  /** amount + صافي ملحقات معتمدة (بلا تمديد إشراف — كالأصل) */
  value: number
  collected: number
  subcontracts: number
  otherExpenses: number
  /** المنصرف الفعلي */
  cost: number
  /** الربح الفعلي = collected − cost */
  profit: number
  expectedCost: number
  expectedProfit: number
  margin: number
}

export interface ProfitabilityDTO {
  groupBy: 'contract' | 'customer'
  rows: ProfitabilityRow[]
  totals: {
    value: number
    collected: number
    cost: number
    profit: number
    expectedCost: number
    expectedProfit: number
    margin: number
    expectedMargin: number
  }
}

// ============================================================
// تقرير التنفيذ (execution)
// ============================================================

export interface ExecutionRow {
  contractId: number
  contractNumber: string
  contractName: string
  customerName: string
  doneCount: number
  totalCount: number
  progressPct: number
  currentStage: string
  startedAt: string
  daysOpen: number
  expectedDays: number
  nextStage: string
  /** سليمة | متأخرة | بلا مرحلة */
  status: string
}

export interface ExecutionDTO {
  rows: ExecutionRow[]
  totals: { count: number; delayed: number; avgProgress: number }
}

// ============================================================
// تقرير المصروفات (expenses مجمّع حسب الحساب)
// ============================================================

export interface ExpenseGroupRow {
  account: string
  count: number
  total: number
}

export interface ExpenseDetailRow {
  id: number
  voucherNumber: string
  vdate: string
  account: string
  party: string
  method: string
  amount: number
  description: string
  contractNumber: string | null
}

export interface ExpensesDTO {
  rows: ExpenseGroupRow[]
  detail: ExpenseDetailRow[]
  totals: { count: number; total: number; accounts: number }
}

// ============================================================
// تقرير مقاولي الباطن (subcontractors_report)
// ============================================================

export interface SubcontractorRow {
  subContractorId: number
  subCode: string
  name: string
  phone: string
  contractsCount: number
  value: number
  paid: number
  remaining: number
}

export interface SubcontractorsDTO {
  rows: SubcontractorRow[]
  totals: { count: number; contracts: number; value: number; paid: number; remaining: number }
}

// ============================================================
// تقرير تأخيرات الإشراف (supervision_delays_report)
// ============================================================

export interface SupervisionDelayRow {
  contractId: number
  /** رقم العقد أو «👁 رقم — مرحلة» للمراحل الإشرافية */
  label: string
  customerName: string
  supStart: string
  baseEnd: string
  /** مدة العقد الأساسي بالأشهر */
  months: number
  monthly: number
  /** أشهر التمديد المستحقة (بعد التنازل) */
  extensionMonths: number
  waivedMonths: number
  waiveReason: string
  extensionValue: number
  paidExtensionMonths: number
  paidExtensionValue: number
  /** عنوان الموقع: عنوان العميل ← اسم العقد */
  address: string
  fullEnd: string
  delayMonths: number
  delayDays: number
  delayText: string
  delayValue: number
  totalDue: number
  collected: number
  remaining: number
  isStage: boolean
}

export interface SupervisionDelaysDTO {
  rows: SupervisionDelayRow[]
  totals: {
    count: number
    baseMonths: number
    extensionMonths: number
    extensionValue: number
    paidExtensionMonths: number
    paidExtensionValue: number
    waivedMonths: number
    waivedValue: number
    delayMonths: number
    delayDays: number
    delayValue: number
    stageCount: number
    stageDelayMonths: number
    stageDelayValue: number
  }
}

// ============================================================
// التدفق النقدي (cash_flow_detail + الملخص بالفترات)
// ============================================================

export interface CashFlowMovementRow {
  id: number
  voucherNumber: string
  date: string
  party: string
  contractNumber: string | null
  amount: number
  method: string
  /** bank | cash | null (بلا أثر نقدي) */
  wallet: 'bank' | 'cash' | null
  description: string
  /** وصف القسم للسطور الخاصة */
  kind?: string
}

export interface CashFlowPeriodRow {
  key: string
  label: string
  in: number
  out: number
  recoveries: number
  advances: number
  partnerNet: number
  net: number
  balance: number
}

export interface CashFlowDTO {
  mode: 'detail' | 'periods'
  /** أرضية الكشف = openingBalanceDate من الإعدادات */
  floorDate: string | null
  group?: 'daily' | 'monthly' | 'yearly'
  receipts: CashFlowMovementRow[]
  payments: CashFlowMovementRow[]
  recoveries: CashFlowMovementRow[]
  advances: CashFlowMovementRow[]
  transfers: CashFlowMovementRow[]
  partner: CashFlowMovementRow[]
  periods: CashFlowPeriodRow[]
  totals: {
    in: number
    out: number
    recoveries: number
    advancesReturned: number
    partnerNet: number
    net: number
    openingBank: number
    openingCash: number
    opening: number
    bank: number
    cash: number
    closing: number
  }
  rows: never[]
}
