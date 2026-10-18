// ============================================================
// ConTrack Online — أنواع الإدارة: شجرة المراحل، قوالب الدفع،
// الصلاحيات المفصلة، حسابات المصروفات، النسخ الاحتياطي (spec-8-f §7 §9)
// ============================================================

// ------------------------------------------------------------
// شجرة المراحل (WorkflowStage)
// ------------------------------------------------------------
export interface WorkflowStageDTO {
  id: number
  stageName: string
  stageOrder: number
  parentId: number | null
  parentName: string | null
  expectedDays: number
  payPct: number
  payKind: string // '' | achieve | advance | final | days
  color: string
  isPreContract: boolean
  childrenCount: number
  /** كم عقدًا مرّت بهذه المرحلة (لقطة ContractStage بنفس الاسم ونفس النوع) */
  usageCount: number
}

export interface WorkflowStagesResponse {
  contractType: string
  /** عدد العقود على هذا النوع — المراحل المستخدمة محمية من الحذف */
  contractsCount: number
  stages: WorkflowStageDTO[]
}

/** إضافة مرحلة (رئيسية بلا parentName أو فرعية بـ parentName) */
export interface WorkflowStageInput {
  contractType: string
  transactionType?: string // افتراضي 'contract'
  name: string
  parentName?: string | null
  expectedDays?: number
  payPct?: number
  payKind?: string
  sortOrder?: number
  color?: string
}

export interface WorkflowStagePatch {
  name?: string
  parentName?: string | null
  expectedDays?: number
  payPct?: number
  payKind?: string
  sortOrder?: number
  color?: string
}

export const PAY_KIND_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'بلا' },
  { value: 'achieve', label: 'عند الإنجاز' },
  { value: 'advance', label: 'مقدمة' },
  { value: 'final', label: 'ختامية' },
  { value: 'days', label: 'بالأيام' },
]

export function payKindLabel(kind: string): string {
  return PAY_KIND_OPTIONS.find((k) => k.value === kind)?.label ?? kind
}

// ------------------------------------------------------------
// قوالب دفعات نوع العقد (TypePaymentTpl + TypePaymentStage)
// ------------------------------------------------------------
export interface PaymentTemplateStageRef {
  stageId: number
  stageName: string
}

export interface PaymentTemplateDTO {
  id: number
  payNo: number
  title: string
  pct: number
  amountFixed: number
  daysOffset: number
  linkKeyword: string
  /** نسبة | ثابت | مرن-0 (محسوبة من القيم) */
  kind: 'pct' | 'fixed' | 'flex'
  triggerStageId: number | null
  triggerStageName: string | null
  stages: PaymentTemplateStageRef[]
}

export interface PaymentTemplateInput {
  contractType: string
  payNo?: number
  title: string
  /** نمط القيمة: نسبة٪ | مبلغ ثابت | مرن 0 */
  valueMode: 'pct' | 'fixed' | 'flex'
  pct?: number
  amountFixed?: number
  /** مراحل الدفعة (أوراق الشجرة فقط) */
  stageIds?: number[]
  /** المرحلة المحفزة — يجب أن تكون من مراحل الدفعة نفسها */
  triggerStageId?: number | null
  daysOffset?: number
}

export const VALUE_MODE_LABELS: Record<PaymentTemplateInput['valueMode'], string> = {
  pct: 'نسبة من قيمة العقد',
  fixed: 'مبلغ ثابت',
  flex: 'مرن (0)',
}

// ------------------------------------------------------------
// الصلاحيات المفصلة (UserPermission) — واجهة وحفظ فقط الآن،
// الفحص الفعلي في باقي الـ API يُفعَّل تدريجيًا لاحقًا
// ------------------------------------------------------------
export type PermissionMap = Record<string, boolean>

export interface PermissionKeyDef {
  key: string
  label: string
}

/** مفاتيح الشاشات — 11 مفتاحًا */
export const SCREEN_PERMISSIONS: PermissionKeyDef[] = [
  { key: 'screen_dashboard', label: 'لوحة المؤشرات' },
  { key: 'screen_customers', label: 'العملاء' },
  { key: 'screen_contracts', label: 'العقود' },
  { key: 'screen_subcontractors', label: 'المقاولون' },
  { key: 'screen_vouchers', label: 'السندات' },
  { key: 'screen_reports', label: 'التقارير' },
  { key: 'screen_followup', label: 'المتابعة' },
  { key: 'screen_types', label: 'الأنواع' },
  { key: 'screen_users', label: 'المستخدمون' },
  { key: 'screen_settings', label: 'الإعدادات' },
  { key: 'screen_gateway', label: 'بوابة الدفع' },
]

/** مفاتيح الإجراءات — مفتاحان */
export const ACTION_PERMISSIONS: PermissionKeyDef[] = [
  { key: 'action_cancel_voucher', label: 'إلغاء السندات' },
  { key: 'action_change_status', label: 'تغيير حالة العقد' },
]

export const ALL_PERMISSION_KEYS: string[] = [
  ...SCREEN_PERMISSIONS.map((p) => p.key),
  ...ACTION_PERMISSIONS.map((p) => p.key),
]

export interface UserPermissionsDTO {
  userId: number
  role: string
  /** المدير/المطوّر: كلها true دائمًا */
  permissions: PermissionMap
}

// ------------------------------------------------------------
// حسابات المصروفات (شجرة ExpenseAccount) — تاب الإعدادات
// ------------------------------------------------------------
export interface ExpenseAccountAdminDTO {
  id: number
  parentId: number | null
  name: string
  fullPath: string
  accountKind: string // expense | advance | asset
  allowPosting: boolean
  includeInProfitability: boolean
  isActive: boolean
  sortOrder: number
}

export interface ExpenseAccountCreateInput {
  name: string
  parentId?: number | null
  accountKind?: string
}

// ------------------------------------------------------------
// النسخ الاحتياطي — GET /api/backup (مدير فقط)
// ------------------------------------------------------------
export interface BackupMeta {
  app: string
  version: string
  generatedAt: string
  generatedBy: string
  tables: Record<string, number>
}

export interface BackupFile {
  meta: BackupMeta
  data: Record<string, unknown[]>
}
