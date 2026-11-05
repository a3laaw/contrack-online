// ============================================================
// ConTrack Online — أنواع مشتركة بين الواجهة وواجهات API
// (نسخ JSON-serializable من نماذج Prisma)
// ============================================================

export type UserRole = 'developer' | 'admin' | 'secretary'

export interface SessionUser {
  id: number
  username: string
  role: string
  fullName: string
  jobTitle: string
}

export interface CustomerDTO {
  id: number
  customerCode: string
  name: string
  phone: string
  address: string
  addressGovernorate: string
  addressArea: string
  addressBlock: string
  addressPlot: string
  email: string
  notes: string
  contractsCount: number
  contractsAmount: number
  createdAt: string
}

export interface CustomerInput {
  name: string
  phone?: string
  address?: string
  addressGovernorate?: string
  addressArea?: string
  addressBlock?: string
  addressPlot?: string
  email?: string
  notes?: string
}

export interface ContractStageDTO {
  id: number
  contractId: number
  name: string
  level: number
  parentName: string
  expectedDays: number
  payPct: number
  payKind: string
  sortOrder: number
  startDate: string | null
  endDate: string | null
  isSkipped: boolean
  isSupervision: boolean
  supMonthly: number
}

export interface PaymentDTO {
  id: number
  contractId: number
  title: string
  dueDate: string
  amount: number
  paidAmount: number
  remaining: number
  sortOrder: number
  stageId: number | null
  stageName: string | null
  notes: string
  triggeredAt: string | null
  /** مسدد | متأخر | مُحفز | مستحق */
  status: 'مسدد' | 'متأخر' | 'مُحفز' | 'مستحق'
}

export interface VoucherDTO {
  id: number
  voucherNumber: string
  vtype: string
  vdate: string
  party: string
  partyType: string
  method: string
  account: string
  amount: number
  description: string
  contractId: number | null
  contractNumber: string | null
  contractName: string | null
  notes: string
  cancelled: boolean
  cancelReason: string
  /** اسم الحساب المسجّل على السند (الدليل الموحد — Task 105) */
  accountSnapshot: string | null
}

export interface ContractEventDTO {
  id: number
  contractId: number
  contractNumber: string
  customerName: string
  eventTime: string
  eventType: string
  description: string
  username: string
}

export interface ContractListItem {
  id: number
  contractNumber: string
  contractName: string
  contractType: string
  contractDate: string
  amount: number
  paidAmount: number
  status: string
  statusReason: string
  manualTrack: boolean
  customer: { id: number; customerCode: string; name: string }
}

export interface ContractDetailDTO extends ContractListItem {
  description: string
  notes: string
  startDate: string | null
  endDate: string | null
  qty: number
  unitPrice: number
  supMonths: number
  supMonthly: number
  supDiscount: number
  currency: string
  customer: { id: number; customerCode: string; name: string; phone: string; address: string }
  stages: ContractStageDTO[]
  payments: PaymentDTO[]
  vouchers: VoucherDTO[]
  events: ContractEventDTO[]
}

export interface DashboardDTO {
  counts: {
    customers: number
    contracts: number
    activeContracts: number
    vouchers: number
  }
  financials: {
    totalContractAmount: number
    totalReceived: number
    receivedThisMonth: number
    overduePayments: number
    overdueAmount: number
  }
  recentEvents: ContractEventDTO[]
  recentVouchers: VoucherDTO[]
  monthlyReceipts: { month: string; label: string; total: number }[]
}

export interface TypeStageDTO {
  id: number
  stageName: string
  stageOrder: number
  expectedDays: number
  payPct: number
  payKind: string
  isSupervision: boolean
}

export interface TypePaymentTplDTO {
  id: number
  payNo: number
  title: string
  pct: number
  amountFixed: number
  daysOffset: number
  triggerStageName: string
}

export interface ContractTypeDTO {
  id: number
  name: string
  defaultAmount: number
  notes: string
  manualTrack: boolean
  unitLabel: string
  unitPrice: number
  pricingMode: string
  isSupervision: boolean
  stages: TypeStageDTO[]
  payments: TypePaymentTplDTO[]
}

/**
 * حساب في دليل الحسابات الموحد — GET /api/accounts (Task 105 — الدليل الوحيد،
 * بديل شجرة حسابات المصروفات المُسقَطة).
 */
export interface AccountNode {
  id: number
  code: string
  name: string
  type: string // asset | liability | equity | revenue | expense
  nature: string // debit | credit
  parentId: number | null
  isLeaf: boolean
  allowPosting: boolean
  isActive: boolean
  isSystem: boolean
  /** دور الحساب: standard | custody (العُهد والسلف) */
  accountRole?: string
  /** يستهلكه تقارير ربحية العقود */
  includeInProfitability?: boolean
  openingBalance?: number
  notes?: string
  sortOrder: number
  xbrlElement?: string
}

export interface AccountsResponse {
  accounts: AccountNode[]
  seeded?: boolean
}

export interface SettingsDTO {
  companyName: string
  companyAddress: string
  companyPhone: string
  companyEmail: string
  headerTitle: string
  currency: string
  openingBalanceBank: number
  openingBalanceCash: number
  bankFeeEnabled: boolean
  bankFeeAmount: number
  bankFeeMethod: string
}

export interface ContractInput {
  customerId: number
  contractType?: string
  contractName: string
  contractDate: string
  amount: number
  description?: string
  qty?: number
  unitPrice?: number
  supMonths?: number
  supMonthly?: number
  supDiscount?: number
  startDate?: string
  endDate?: string
  notes?: string
  manualTrack?: boolean
}

export interface VoucherLinkInput {
  lineId: number
  amount: number
}

export interface ReceiptVoucherInput {
  vdate: string
  customerId: number
  method: string
  account: string
  amount: number
  description?: string
  contractId?: number
  links?: VoucherLinkInput[]
}

export interface PaymentVoucherInput {
  vdate: string
  party: string
  method: string
  account: string
  amount: number
  description?: string
  accountId?: number
  contractId?: number
}
