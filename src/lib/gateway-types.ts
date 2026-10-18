// ============================================================
// ConTrack Online — أنواع بوابة الدفع وتسديدات الشركة الأخرى
// (مرجع التنفيذ: spec-8-e §4 البوابة و§5 الشركة الأخرى)
// ============================================================

// ---------- البوابات (gateway_profiles) ----------
export interface GatewayProfileDTO {
  id: number
  name: string
  bankAccount: string
  /** كلمات مطابقة طريقة سندات القبض مفصولة بفواصل (KNET,تحويل) */
  methods: string
  lagDays: number // T+N بأيام عمل (الجمعة/السبت عطلة)
  feeFixed: number // عمولة ثابتة لكل عملية
  feePercent: number // أو نسبة من المبلغ
  tolerance: number // تسامح مطابقة البنك والفرق
  lateDays: number // سماح التأخير بعد التسوية
  isActive: boolean
  opsCount: number
}

export interface GatewayProfileInput {
  name: string
  bankAccount?: string
  methods?: string
  lagDays?: number
  feeFixed?: number
  feePercent?: number
  tolerance?: number
  lateDays?: number
  isActive?: boolean
}

// ---------- العمليات (gateway_ops) ----------
export type GatewayOpState = 'mine' | 'diff' | 'other' | 'unmarked'

export const GATEWAY_STATE_LABELS: Record<GatewayOpState, string> = {
  mine: 'لنا',
  diff: 'فرق',
  other: 'للشركة الأخرى',
  unmarked: 'غير مصنفة',
}

export interface GatewayOpDTO {
  id: number
  profileId: number
  profileName: string
  opDate: string
  phone: string
  customerName: string
  amount: number
  ref: string
  state: GatewayOpState
  classifiedManual: boolean
  distributed: boolean
  /** محصلة من البوابة (تحوّلت للبنك) */
  gwPaid: boolean
  gwPaidDate: string | null
  /** T+lag أيام عمل — موعد الوارد البنكي المتوقع */
  effectiveDate: string | null
  /** العمولة المحسوبة عند التوزيع */
  feeAmount: number
  contractHint: number | null
  /** معرّف التسديد الذي اكتملت عليه (للشركة الأخرى) */
  paidTransferId: number | null
  batch: string
  notes: string
}

// ---------- الاستيراد ----------
export interface ImportResultDTO {
  total: number
  inserted: number
  updated: number
  /** صفوف مُكررة محمية (موزَّعة/مسددة/مصنفة يدويًا) لم تُمس */
  locked: number
  /** صفوف فاشلة/ملغاة/بلا هاتف أو مبلغ */
  skipped: number
  /** صفوف صُنفت آليًا «لنا» بمطابقة هاتف عميل أو رابط محفوظ */
  mineMarked: number
  /** بنك: أسطر إيداع جديدة أُدخلت idempotent */
  bankInserted: number
}

// ---------- التصفية اليومية (القفل الثلاثي S⇄G⇄bank_lines) ----------
export type ClearingStatus = 'done' | 'pending' | 'diff' | 'late'

export const CLEARING_STATUS_LABELS: Record<ClearingStatus, string> = {
  done: 'مكتملة',
  pending: 'منتظرة',
  diff: 'فرق',
  late: 'متأخرة',
}

export interface ClearingRowDTO {
  day: string // تاريخ العملية
  sys: number // S: وارد السيستم (سندات قبض سارية بطريقة البوابة)
  gMine: number // G: وارد البوابة «لنا»
  gOther: number // G: وارد البوابة «للأخرى»
  gTotal: number
  opsCount: number
  fees: number // Σ عمولات العمليات المحتسبة
  gap: number // gMine − sys
  expect: number // gTotal − fees (المتوقع بنكيًا)
  settleDate: string // day + lag أيام عمل
  bankAmount: number | null
  bankDate: string | null
  bankDescr: string | null
  myShare: number // gMine − عمولاتنا
  otherShare: number // gOther − عمولات الأخرى
  status: ClearingStatus
}

export interface ClearingDTO {
  profile: GatewayProfileDTO
  rows: ClearingRowDTO[]
  totals: {
    sys: number
    gMine: number
    gOther: number
    expect: number
    bank: number
    myShare: number
    otherShare: number
  }
  /** أسطر بنك إيداع غير مربوطة بأي يوم */
  unmatchedBank: { id: number; cdate: string; amount: number; descr: string; bankAccount: string }[]
}

// ---------- تسديدات الشركة الأخرى ----------
/** بند مستحق للتسديد: operation حالة other موزَّعة غير محصلة وغير مسددة بالكامل */
export interface OtherDueItemDTO {
  opId: number
  profileId: number
  profileName: string
  opDate: string
  phone: string
  customerName: string
  ref: string
  gross: number
  fee: number
  net: number // gross − fee (التوزيع على الصافي — V4.49)
  paid: number // Σ تخصيصات التحويلات
  remaining: number // net − paid
  paidTransferId: number | null
}

export type TransferStatus = 'full' | 'partial' | 'open'

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  full: 'مربوط كامل',
  partial: 'مربوط جزئي',
  open: 'على الحساب',
}

export interface TransferDTO {
  id: number
  tdate: string
  amount: number
  ref: string
  notes: string
  method: string
  voucherId: number | null
  voucherNumber: string
  linkedOps: number
  allocated: number // Σ تخصيصاته
  remaining: number // amount − allocated (فروقات عمولة إن سالب مربوط)
  opDates: string[] // تواريخ العمليات المربوطة (مدمجة)
  status: TransferStatus
  createdBy: string
  createdAt: string
}

export interface OtherBalanceDTO {
  opening: number // الافتتاحي (0 — لا جدول افتتاحي في المخطط)
  dues: number // مستحق تراكمي (Σ صافي العمليات المؤهلة حتى المسددة منها)
  paid: number // Σ التحويلات
  remaining: number // dues − paid (سالب = مدفوع فوق المستحق)
  feeDiff: number // فروقات عمولة = max(0, paid − dues)
}

export interface OtherStatementRowDTO {
  day: string
  due: number
  paid: number
  cumulative: number
}

export interface OtherTransfersDTO {
  balance: OtherBalanceDTO
  dues: OtherDueItemDTO[]
  duesTotals: { gross: number; fees: number; net: number; paid: number; remaining: number }
  transfers: TransferDTO[]
  statement: OtherStatementRowDTO[]
}

export interface OtherTransferInput {
  tdate: string
  amount: number
  ref?: string
  notes?: string
  method?: string
  /** عمليات موزَّعة للحالة other يوزَّع عليها المبلغ على الصافي */
  opIds?: number[]
}
