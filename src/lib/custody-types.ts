// ============================================================
// ConTrack Online — أنواع موديول العُهد والتصفيات (spec-8-e §1)
// (JSON-serializable — مطابقة لمسار /api/custody)
// ============================================================

/** نوع حركة العهدة:
 *  handover   = تسليم عهدة (سند صرف PV بلا حساب مصروف)
 *  settlement = بند تصفية (سند صرف PV بحساب مصروف فعلي تحت مرجع مجموعة)
 *  return     = إرجاع متبقٍ للخزينة (سند CV) */
export type CustodyKind = 'handover' | 'settlement' | 'return'

export interface CustodyAccountDTO {
  id: number
  name: string
  fullPath: string
  /** Σ تسليم العهدة (سندات PV بلا حساب مصروف) */
  handed: number
  /** Σ بنود التصفية (سندات PV بحساب مصروف + مرجع مجموعة) */
  spent: number
  /** Σ الإرجاع (سندات custody_return) */
  returned: number
  /** الرصيد محسوب دائمًا = handed − spent − returned (لا تخزين) */
  balance: number
}

export interface CustodyMovementDTO {
  id: number
  voucherNumber: string
  vtype: string // payment | custody_return
  kind: CustodyKind
  vdate: string // yyyy-MM-dd
  custodyAccountId: number
  custodyAccountName: string
  expenseAccountId: number | null
  expenseAccountName: string | null
  /** مرجع الدفعة المجمعة PAY-GRP-YYYYMMDD-### (فارغ لغير بنود التصفية) */
  groupRef: string
  amount: number
  party: string
  method: string
  description: string
  cancelled: boolean
  cancelReason: string
}

export interface CustodySummaryDTO {
  accounts: CustodyAccountDTO[]
  movements: CustodyMovementDTO[]
  totals: {
    handed: number
    spent: number
    returned: number
    balance: number
  }
}

/** بند ضمن دفعة تصفية مجمّعة */
export interface CustodySettleItemInput {
  expenseAccountId: number
  description?: string
  amount: number
}

export interface CustodyHandoverInput {
  custodyAccountId: number
  amount: number
  vdate: string
  party?: string
  description?: string
}

export interface CustodySettleInput {
  custodyAccountId: number
  vdate: string
  items: CustodySettleItemInput[]
}

export interface CustodyReturnInput {
  custodyAccountId: number
  amount: number
  vdate: string
  method?: string
  description?: string
}

export interface CustodyAddAccountInput {
  name: string
}

/** نتيجة عملية تصفية: مرجع الدفعة المجمعة + أرقام السندات المنشأة */
export interface CustodySettleResult {
  groupRef: string
  total: number
  created: { id: number; voucherNumber: string; amount: number }[]
}

export type CustodyOpResult =
  | { id: number; voucherNumber: string; amount: number }
  | CustodySettleResult
  | { id: number; name: string }
