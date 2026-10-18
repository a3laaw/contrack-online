// ============================================================
// ConTrack Online — أنواع موديول بنود العقد (BOQ) والإشراف الهندسي
// (JSON-serializable — مطابقة لمسارات /api/contracts/[id]/items
//  و /api/items/[id] و /api/contracts/[id]/supervision)
// ============================================================

export interface BoqItemDTO {
  id: number
  description: string
  qty: number
  unit: string
  unitPrice: number
  total: number
  stageId: number | null
  stageName: string | null
}

export interface BoqInput {
  description: string
  qty: number
  unit?: string
  unitPrice: number
  stageId?: number | null
}

export interface BoqSummaryDTO {
  items: BoqItemDTO[]
  itemsTotal: number
  contractAmount: number
  diff: number
}

export interface SupervisionDTO {
  supStartDate: string | null
  supMonths: number
  supMonthly: number
  supDiscount: number
  supWaivedMonths: number
  supWaiveReason: string
  effectiveMonthly: number
  totalContractValue: number
  schedule: {
    seq: number
    monthLabel: string
    expectedDate: string
    baseAmount: number
    amount: number
    waived: boolean
  }[]
}

export interface SupervisionInput {
  supStartDate?: string | null
  supMonths?: number
  supMonthly?: number
  supDiscount?: number
  supWaivedMonths?: number
  supWaiveReason?: string
}
