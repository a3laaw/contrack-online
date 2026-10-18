// ============================================================
// ConTrack Online — أنواع الفواتير (للعلم فقط — V3.14)
// الفاتورة صف ثابت بلا حالات: لا تخفض المديونية ولا تغطي دفعة
// ============================================================

export interface InvoiceDTO {
  id: number
  invoiceNumber: string // INV-0001
  customerId: number
  customerName: string
  customerPhone: string
  contractId: number
  contractNumber: string
  contractName: string
  /** قيمة العقد الخام (كما في الأصل — الحارس يقارن عليها) */
  contractAmount: number
  /** إجمالي فواتير العقد كلها (بما فيها الحالية) */
  contractInvoicesTotal: number
  /** المتبقي من العقد بعد الفواتير = contractAmount − contractInvoicesTotal */
  contractRemaining: number
  invoiceDate: string
  description: string
  amount: number
  notes: string
  createdBy: string
  createdAt: string
}

export interface InvoiceInput {
  customerId: number
  contractId: number
  invoiceDate: string // yyyy-MM-dd
  description?: string
  amount: number
  notes?: string
}

/** ملخص قابلية الفوترة لعقد (يُستخدم في حوار الإنشاء والطباعة) */
export interface ContractBillingDTO {
  contractAmount: number
  invoicesTotal: number
  billableRemaining: number
  invoicesCount: number
}
