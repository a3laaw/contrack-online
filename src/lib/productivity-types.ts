// ============================================================
// ConTrack Online — أنواع وحدات الإنتاجية (Task 15-b)
// البحث الشامل · المهام · التعليقات · ملف العميل · الأرشيف · مجموعات العقود
// (نسخ JSON-serializable — مطابقة لمسارات /api/search|tasks|comments|
//  customer-file|archive|groups)
// ============================================================

import type { SessionUser } from '@/lib/contrack-types'

// ------------------------------------------------------------
// البحث الشامل
// ------------------------------------------------------------

export type SearchEntityType =
  | 'customer'
  | 'contract'
  | 'subcontractor'
  | 'voucher'
  | 'invoice'
  | 'task'
  | 'group'

export interface SearchResultItem {
  type: SearchEntityType
  id: number
  title: string
  subtitle: string
  amount: number | null
  meta: string
}

export interface SearchGroupDTO {
  type: SearchEntityType
  label: string
  icon: string
  total: number
  results: SearchResultItem[]
}

export interface SearchResponseDTO {
  q: string
  types: SearchGroupDTO[]
  totalResults: number
  totalTypes: number
}

// ------------------------------------------------------------
// المهام
// ------------------------------------------------------------

/** الحالات نصوص عربية مخزنة كالأصل (spec-8-f §1.1) */
export type TaskStatus = 'مفتوحة' | 'منجزة'

export interface TaskDTO {
  id: number
  title: string
  description: string
  status: TaskStatus
  dueAt: string | null
  customerId: number | null
  customerName: string | null
  contractId: number | null
  contractNumber: string | null
  source: string
  createdBy: string
  createdAt: string
  completedAt: string | null
  /** مفتوحة + موعد فائت (يحسبها الخادم) */
  overdue: boolean
}

export type TaskFilterStatus = 'all' | 'open' | 'done' | 'overdue'

export interface TaskInput {
  title: string
  description?: string
  status?: TaskStatus
  dueAt?: string | null // ISO كامل أو yyyy-MM-ddTHH:mm
  customerId?: number | null
  contractId?: number | null
}

export interface TasksResponseDTO {
  tasks: TaskDTO[]
  totals: { all: number; open: number; done: number; overdue: number }
}

// ------------------------------------------------------------
// التعليقات (جدول واحد بكل meta — spec-8-f §3)
// ------------------------------------------------------------

export type CommentKind = 'تعليق' | 'تنبيه' | 'تلقائي'
export type CommentPriority = 'عادي' | 'مهم' | 'عاجل'

export const COMMENT_KINDS: CommentKind[] = ['تعليق', 'تنبيه', 'تلقائي']
export const COMMENT_PRIORITIES: CommentPriority[] = ['عادي', 'مهم', 'عاجل']

export interface CommentDTO {
  id: number
  customerId: number | null
  customerName: string | null
  contractId: number | null
  contractNumber: string | null
  author: string
  createdBy: string
  text: string
  kind: CommentKind
  priority: CommentPriority
  pinned: boolean
  followupDate: string | null
  deletedAt: string | null
  createdAt: string
  editedAt: string | null
  editor: string | null
}

export interface CommentInput {
  /** عميل أو عقد (واحد منهما إلزامي) — العقد يملأ العميل تلقائيًا من الخادم */
  customerId?: number
  contractId?: number
  text: string
  kind?: CommentKind
  priority?: CommentPriority
  followupDate?: string | null
}

export interface CommentsResponseDTO {
  comments: CommentDTO[]
  total: number
}

// ------------------------------------------------------------
// ملف العميل التفصيلي
// ------------------------------------------------------------

export interface CustomerFileSummary {
  contractsCount: number
  activeCount: number
  /** Σ قيمة العقود الخام (غير الملغاة) */
  totalRaw: number
  /** Σ القيمة الحالية بقاعدة 35 (amount + أوامر معتمدة + إشراف) */
  currentTotal: number
  collected: number
  remaining: number
  overdue: {
    has: boolean
    /** عدد الأقساط المتأخرة */
    count: number
    /** عدد العقود ذات تأخر */
    contracts: number
    maxDaysLate: number
  }
}

export interface CustomerFileContract {
  id: number
  contractNumber: string
  contractName: string
  contractType: string
  status: string
  contractDate: string
  amountRaw: number
  currentValue: number
  collected: number
  remaining: number
  progressPct: number
  hasOverdue: boolean
}

export interface CustomerFileVoucher {
  id: number
  voucherNumber: string
  vtype: string
  vdate: string
  amount: number
  party: string
  description: string
  contractId: number | null
  contractNumber: string | null
  cancelled: boolean
}

export interface CustomerFileInvoice {
  id: number
  invoiceNumber: string
  invoiceDate: string
  amount: number
  description: string
  contractId: number | null
  contractNumber: string | null
}

export interface CustomerFileEvent {
  id: number
  contractId: number
  contractNumber: string
  eventTime: string
  eventType: string
  description: string
  username: string
}

export interface CustomerFileDTO {
  customer: {
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
    archived: boolean
    createdAt: string
  }
  summary: CustomerFileSummary
  contracts: CustomerFileContract[]
  vouchers: CustomerFileVoucher[]
  invoices: CustomerFileInvoice[]
  comments: CommentDTO[]
  timeline: CustomerFileEvent[]
  tasks: TaskDTO[]
}

// ------------------------------------------------------------
// الأرشيف
// ------------------------------------------------------------

export interface ArchiveCustomerRow {
  id: number
  customerCode: string
  name: string
  phone: string
  contractsCount: number
  totalRaw: number
}

export interface ArchiveContractRow {
  id: number
  contractNumber: string
  contractName: string
  customerName: string
  amount: number
  currentValue: number
  status: string
}

export interface ArchiveVoucherRow {
  id: number
  voucherNumber: string
  vtype: string
  vdate: string
  amount: number
  party: string
  contractNumber: string | null
  cancelReason: string
}

export interface ArchiveDTO {
  customers: ArchiveCustomerRow[]
  contracts: ArchiveContractRow[]
  vouchers: ArchiveVoucherRow[]
}

export type ArchiveOpType = 'customer' | 'contract'

// ------------------------------------------------------------
// مجموعات العقود
// ------------------------------------------------------------

export interface GroupContractRow {
  id: number
  contractNumber: string
  contractName: string
  customerName: string
  customerId: number
  status: string
  currentValue: number
}

export interface GroupSummaryDTO {
  id: number
  groupNumber: string
  name: string
  notes: string
  createdBy: string
  createdAt: string
  contractsCount: number
  /** Σ القيمة الحالية للعقود غير الملغاة (قاعدة 35) */
  currentTotal: number
  collected: number
  paid: number
  /** Σ عقود الباطن */
  subTotal: number
  /** cost = paid + max(0, subTotal − paid) — حرفيًا من spec-8-f §6.2 */
  cost: number
  /** profit = collected − cost */
  profit: number
  marginPct: number
  contracts: GroupContractRow[]
}

export interface GroupCreateInput {
  name: string
  notes?: string
  contractIds: number[]
}

export interface GroupsResponseDTO {
  groups: GroupSummaryDTO[]
  totals: {
    groups: number
    contracts: number
    collected: number
    paid: number
    cost: number
    profit: number
  }
}

/** مستخدم الجلسة — معاد تصديره للراحة */
export type { SessionUser }

// ------------------------------------------------------------
// تحليل تاريخ/وقت المهمة — يقبل 'yyyy-MM-ddTHH:mm' أو 'yyyy-MM-dd HH:mm' أو ISO كامل
// يعيد Date | null (فراغ = حذف الموعد) | undefined (صيغة غير صالحة)
// ------------------------------------------------------------
export function parseDueDate(v: unknown): Date | null | undefined {
  if (v == null || v === '') return null
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s)
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0))
    return isNaN(d.getTime()) ? undefined : d
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? undefined : d
}

// ------------------------------------------------------------
// المُطبّع العربي المشترك (spec-8-f §5.1 — نفس قواعد search_utils.py)
// يُستخدم في /api/search و/api/tasks — آمن للعميل والخادم
// (أإآٱ)→ا · ؤ→و · ئ→ي · ة→ه · ى→ي · إزالة التشكيل والتطويل · تقليص المسافات
// ------------------------------------------------------------
export function normalizeAr(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // التشكيل
    .replace(/\u0640/g, '') // التطويل ـ
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
}
