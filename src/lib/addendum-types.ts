// ============================================================
// ConTrack Online — أنواع الملاحق/الأوامر التغييرية (المرحلة 4)
// (JSON-serializable — مطابقة لمساري /api/contracts/[id]/addendums
//  و /api/addendums/[id])
// قاعدة ذهبية: contracts.amount لا يُمس أبدًا —
// القيمة الحالية = amount + Σ(amountAdd−amountDeduct للمعتمد) + supExtension
// ============================================================

/** جهة الأمر: عميل | مقاول */
export type AddendumSide = 'client' | 'sub'

/** حالة الأمر: مسودة → معتمد | ملغى */
export type AddendumStatus = 'مسودة' | 'معتمد' | 'ملغى'

/** سطر (جزء) من أجزاء الأمر التغييري */
export interface AddendumItemDTO {
  id: number
  side: AddendumSide
  action: 'add' | 'delete' | 'unlink'
  description: string
  qty: number
  unit: string
  unitPrice: number
  amount: number
  /** '' يدوي | boq بند أعمال | plan دفعة خطة | stage مرحلة */
  refKind: '' | 'boq' | 'plan' | 'stage'
  refId: number
  boqItemId: number | null
  subContractId: number | null
  stageId: number | null
  applied: boolean
  /** 1 = البند أُنشئ حديثًا بأمر تغييري (يُمحى فعليًا عند إلغاء الأمر) */
  createdItem: boolean
}

/** ملحق / أمر تغييري */
export interface AddendumDTO {
  id: number
  addendumNumber: string
  contractId: number
  addendumType: string
  /** تاريخ الملحق (ISO) */
  adate: string
  reason: string
  description: string
  amountAdd: number
  amountDeduct: number
  netAmount: number
  status: AddendumStatus
  approvedDate: string
  notes: string
  cancelReason: string
  side: AddendumSide
  subContractId: number | null
  subContractLabel: string | null
  itemsCount: number
  appliedAt: string | null
  createdBy: string
  createdAt: string
  items: AddendumItemDTO[]
}

/** قائمة ملاحق العقد + المجاميع المالية */
export interface AddendumSummaryDTO {
  addendums: AddendumDTO[]
  /** قيمة العقد الأصلية (amount — لا تُمس) */
  contractValue: number
  /** قيمة تمديد الإشراف (supMonthly−supDiscount)×(supMonths−supWaived) */
  supExtension: number
  /** القيمة الحالية = contractValue + netApproved + supExtension */
  currentValue: number
  /** المحصّل الفعلي: سندات قبض سارية غير مخصّصة (allocation='') */
  collected: number
  /** صافي الأوامر المعتمدة Σ(amountAdd−amountDeduct) */
  netApproved: number
  /** صافي المسودات (قبل الاعتماد) */
  netDraft: number
}

/** إنشاء/تعديل رأس الملحق */
export interface AddendumInput {
  addendumType?: string
  adate?: string
  reason?: string
  description?: string
  notes?: string
  side?: AddendumSide
  subContractId?: number | null
}

/** إضافة جزء (سطر) إلى أمر مسودة */
export interface AddendumPartInput {
  side: AddendumSide
  action: 'add' | 'delete' | 'unlink'
  /** '' يدوي | boq | plan | stage */
  refKind?: '' | 'boq' | 'plan' | 'stage'
  refId?: number
  boqItemId?: number | null
  subContractId?: number | null
  stageId?: number | null
  description?: string
  qty?: number
  unit?: string
  unitPrice?: number
  /** لسطر unlink: يشير لسطر الحذف الأب */
  parentPartId?: number
}
