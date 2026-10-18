// ============================================================
// ConTrack Online — أنواع موديول مقاولي الباطن (JSON-serializable)
// ============================================================

export interface SubcontractorDTO {
  id: number
  subCode: string
  name: string
  phone: string
  email: string
  activity: string
  notes: string
  showAllContracts: boolean
  createdAt: string
  subContractsCount: number
  totalAmount: number
  totalPaid: number
}

export interface SubcontractorInput {
  name: string
  phone?: string
  email?: string
  activity?: string
  notes?: string
  showAllContracts?: boolean
}

export interface SubContractListItem {
  id: number
  contractId: number
  contractNumber: string
  contractName: string
  subcontractorId: number
  subcontractorName: string
  amount: number
  paidAmount: number
  startDate: string | null
  endDate: string | null
  status: string
  description: string
  paymentsCount: number
  itemsCount: number
  createdAt: string
}

export interface SubContractPaymentDTO {
  id: number
  title: string
  dueDate: string
  amount: number
  paidAmount: number
  stageId: number | null
  triggeredAt: string | null
}

export interface SubContractDetailDTO {
  id: number
  contractId: number
  contractNumber: string
  contractName: string
  subcontractorId: number
  subcontractorName: string
  subcontractorPhone: string
  amount: number
  paidAmount: number
  startDate: string | null
  endDate: string | null
  status: string
  description: string
  items: {
    id: number
    boqItemId: number | null
    description: string
    qty: number
    unitPrice: number
    amount: number
  }[]
  payments: SubContractPaymentDTO[]
  createdAt: string
}

export interface SubContractInput {
  contractId: number
  subcontractorId: number
  amount: number
  startDate?: string | null
  endDate?: string | null
  description?: string
  payments?: {
    title: string
    dueDate: string
    amount: number
    stageId?: number | null
  }[]
}

/** مدخل سند صرف لدفعة باطن (يُمرَّر إلى POST /api/vouchers) */
export interface SubPaymentVoucherInput {
  vtype: 'payment'
  vdate: string
  amount: number
  method?: string
  account?: string
  description?: string
  subContractId: number
  subLinks: { lineId: number; amount: number }[]
}
