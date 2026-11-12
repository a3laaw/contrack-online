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
  plannedQty?: number
  // ب1 — النافذة المخططة من البرنامج الزمني (نافذة القسم) — عرض لا مصدر
  plannedStart?: string
  plannedFinish?: string
  total: number
  amount?: number // مبلغ الملف الأصلي للبنود المستوردة (قد يخالف كميه×سعره)
  itemNo?: string // رقم البند في BOQ الأصلي — «03.30.01» / «B1-2» / «F1»
  divisionCode?: string
  divisionName?: string
  stageId: number | null
  stageName: string | null
}

export interface BoqInput {
  description: string
  qty: number
  unit?: string
  unitPrice: number
  plannedQty?: number
  stageId?: number | null
  itemNo?: string
  divisionCode?: string
  divisionName?: string
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

// ---------- استيراد BOQ من ملف (docs/boq-import-design.md §2.3-§2.4) ----------

export interface BoqImportItemDTO {
  itemNo: string
  description: string
  qty: number
  unit: string
  unitPrice: number
  amount: number
}

export interface BoqImportDivisionDTO {
  code: string
  name: string
  sheet: string
  itemCount: number
  total: number
  items: BoqImportItemDTO[] // عينة (أول 8) في المعاينة
}

export interface BoqImportMetaDTO {
  sheets: number
  importedSheets: string[]
  skippedSheets: string[]
  narrativeLines: number
  mergedLines: number
  sectionHeaders: number
  totalPages: number
  collectionPages: number
  recapPages: number
  duplicatePages: number
}

export interface BoqImportWarningDTO {
  sheet: string
  line: number
  message: string
}

export interface BoqImportPreviewDTO {
  divisions: BoqImportDivisionDTO[]
  itemCount: number
  grandTotal: number
  warnings: BoqImportWarningDTO[]
  existingCount: number
  meta: BoqImportMetaDTO
}

export interface BoqImportRunDTO {
  created: number
  grandTotal: number
  divisions: { code: string; name: string; itemCount: number; total: number }[]
  warnings: BoqImportWarningDTO[]
  existingCount: number
  meta: BoqImportMetaDTO
}

// ============================================================
// وثيقة جدول كميات مستقلة (BOQ Doc) — قرار المالك 2026-11:
// «بنود العقد حاجة والـBOQ حاجة تانية» — الوثيقة تُبنى في الإعدادات
// قبل العقد، وعند الربط تُنسخ بنودها إلى بنود العقد (المرحلة ب).
// ============================================================

export interface BoqDocDTO {
  id: number
  name: string
  projectName: string
  clientName: string
  consultantName: string
  status: 'draft' | 'ready'
  notes: string
  createdAt: string
  updatedAt: string
  itemCount: number
  grandTotal: number
}

export interface BoqDocItemDTO {
  id: number
  docId: number
  itemNo: string
  divisionCode: string
  divisionName: string
  description: string
  qty: number
  unit: string
  unitPrice: number
  amount: number
  total: number // المبلغ الفعلي للبند (amount إن وُجد وإلا qty×unitPrice)
}

export interface BoqDocDetailDTO extends Omit<BoqDocDTO, 'itemCount' | 'grandTotal'> {
  items: BoqDocItemDTO[]
  itemCount: number
  grandTotal: number
}

export interface BoqDocInput {
  name: string
  projectName?: string
  clientName?: string
  consultantName?: string
  notes?: string
  status?: 'draft' | 'ready'
}

export interface BoqDocItemInput {
  description: string
  qty?: number
  unit?: string
  unitPrice?: number
  itemNo?: string
  divisionCode?: string
  divisionName?: string
}
