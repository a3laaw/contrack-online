// ============================================================
// ConTrack Online — أنواع موديول سلف الموظفين (spec-8-e §2)
// (JSON-serializable — مطابقة لمساري /api/advances و /api/employees)
// ============================================================

import type { SessionUser } from '@/lib/contrack-types'

/** نوع حركة السلفة:
 *  advance     = صرف سلفة (سند PV بـ advanceEmployeeId على حساب «سلف موظفين / قرض راتب»)
 *  cash_return = رد نقدي (سند CV يخفض المصروف)
 *  deduction   = خصم من راتب (سند SD بلا حركة نقدية على حساب «رواتب») */
export type AdvanceKind = 'advance' | 'cash_return' | 'deduction'

export interface AdvanceEmployeeDTO {
  id: number
  name: string
  phone: string
  notes: string
  active: boolean
  /** Σ السلف المصروفة (غير الملغاة) */
  handed: number
  /** Σ الرد النقدي */
  recovered: number
  /** Σ الخصم من الراتب */
  deducted: number
  /** الرصيد المستحق على الموظف = handed − recovered − deducted (محسوب دائمًا) */
  balance: number
}

export interface AdvanceMovementDTO {
  id: number
  voucherNumber: string
  vtype: string // payment | custody_return | salary_deduction
  kind: AdvanceKind
  vdate: string // yyyy-MM-dd
  employeeId: number
  employeeName: string
  amount: number
  description: string
  method: string
  cancelled: boolean
  cancelReason: string
}

export interface AdvanceSummaryDTO {
  employees: AdvanceEmployeeDTO[]
  movements: AdvanceMovementDTO[]
  totals: {
    handed: number
    recovered: number
    deducted: number
    balance: number
  }
}

export interface AdvanceOpInput {
  op: 'advance' | 'return' | 'deduct'
  employeeId: number
  amount: number
  vdate: string
  method?: string
  notes?: string
}

export interface AddEmployeeInput {
  name: string
  phone?: string
  notes?: string
}

export type EmployeeListItemDTO = AdvanceEmployeeDTO

/** props موحدة لشاشة السلف (نمط UsersView/VouchersView) */
export interface AdvancesViewProps {
  user: SessionUser
}
