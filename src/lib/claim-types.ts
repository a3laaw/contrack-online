// ============================================================
// ConTrack Online — أنواع المطالبات المالية (المرحلة 4)
// (JSON-serializable — مطابقة لمساري /api/claims و /api/claims/[id])
// المطالبات سجل متابعة مستقل: لا تدخل كشف الحساب ولا المستحقات —
// أثرها المالي الوحيد: مطالبة سارية تمنع إلغاء سندات العقد.
// ============================================================

export type ClaimDirection = 'out' | 'in'

export type ClaimStatus =
  | 'registered'
  | 'sent'
  | 'in_review'
  | 'approved'
  | 'refused'
  | 'collected'
  | 'paid'
  | 'postponed'
  | 'cancelled'

/** تسميات الحالات (كالأصل STATUS_LABEL) */
export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  registered: 'مسجلة',
  sent: 'مرسلة',
  in_review: 'قيد المراجعة',
  approved: 'معتمدة',
  refused: 'مرفوضة',
  collected: 'محصّلة',
  paid: 'مدفوعة',
  postponed: 'مؤجلة',
  cancelled: 'ملغاة',
}

/**
 * آلة الحالات الصارمة (كالأصل NEXT — spec-8-d §3.2):
 * out:  registered→sent|postponed|cancelled · sent→approved|postponed|cancelled
 *       approved→collected|postponed|cancelled · postponed→registered|sent|approved|cancelled
 *       collected/cancelled نهائية
 * in:   registered→in_review|postponed|cancelled · in_review→approved|refused|postponed|cancelled
 *       approved→paid|postponed|cancelled · postponed→registered|in_review|approved|cancelled
 *       refused/paid/cancelled نهائية
 */
export const CLAIM_NEXT: Record<
  ClaimDirection,
  Partial<Record<ClaimStatus, ClaimStatus[]>>
> = {
  out: {
    registered: ['sent', 'postponed', 'cancelled'],
    sent: ['approved', 'postponed', 'cancelled'],
    approved: ['collected', 'postponed', 'cancelled'],
    postponed: ['registered', 'sent', 'approved', 'cancelled'],
    collected: [],
    cancelled: [],
  },
  in: {
    registered: ['in_review', 'postponed', 'cancelled'],
    in_review: ['approved', 'refused', 'postponed', 'cancelled'],
    approved: ['paid', 'postponed', 'cancelled'],
    postponed: ['registered', 'in_review', 'approved', 'cancelled'],
    refused: [],
    paid: [],
    cancelled: [],
  },
}

/** الحالة النهائية للتسديد: out→collected | in→paid (كالأصل TERMINAL_PAID) */
export const CLAIM_TERMINAL_PAID: Record<ClaimDirection, ClaimStatus> = {
  out: 'collected',
  in: 'paid',
}

export interface ClaimDTO {
  id: number
  claimNumber: string
  direction: ClaimDirection
  contractId: number
  contractNumber: string
  customerName: string
  subContractId: number | null
  /** SUB-00X أو null */
  subContractLabel: string | null
  custLineId: number | null
  custLineTitle: string | null
  subLineId: number | null
  subLineTitle: string | null
  title: string
  amount: number
  /** yyyy-MM-dd كالأصل */
  dueDate: string
  status: ClaimStatus
  voucherRef: string
  notes: string
  postponedUntil: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface ClaimsSummaryDTO {
  claims: ClaimDTO[]
  totals: {
    /** إجمالي مطالبتنا على العملاء */
    out: number
    /** إجمالي مطالبات المقاولين علينا */
    in: number
    /** معتمدة (out) تجاوزت تاريخ الاستحقاق */
    overdueOut: number
    /** عدد المطالبات المفتوحة (غير نهائية) */
    activeCount: number
  }
}

export interface ClaimInput {
  direction: ClaimDirection
  contractId: number
  subContractId?: number | null
  custLineId?: number | null
  subLineId?: number | null
  title: string
  amount: number
  dueDate?: string
  voucherRef?: string
  notes?: string
}
