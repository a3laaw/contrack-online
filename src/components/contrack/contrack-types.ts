/**
 * أنواع مشتركة لعميل ConTrack — مطابقة لعقد الـAPI الخلفي الفعلي.
 * المبالغ تصل كأرقام (الخلفي يحوّل Decimal إلى number).
 */

export type ViewName =
  | "dashboard"
  | "due"
  | "customers"
  | "customer-file"
  | "contracts"
  | "contract-groups"
  | "forms"
  | "contract"
  | "vouchers"
  | "custody"
  | "advances"
  | "invoices"
  | "subcontractors"
  | "reports"
  | "statement"
  | "followup"
  | "claims"
  | "tasks"
  | "visits"
  | "comments"
  | "gateway"
  | "other-company"
  | "settings"
  | "users"
  | "data-mgmt";

export type UserRole = "admin" | "secretary" | "developer";

export const ROLE_LABEL: Record<string, string> = {
  admin: "مدير",
  secretary: "سكرتير",
  developer: "مطور",
};

/** المدير/المطور = صلاحيات كاملة دائمًا (قاعدة المصدر) */
export function isManagerRole(role?: string | null): boolean {
  return role === "admin" || role === "developer";
}

/** أدوار قابلة للتعيين عند إنشاء/تعديل مستخدم (الخلفي يقبل admin|secretary فقط) */
export const ASSIGNABLE_ROLES = [
  { value: "admin", label: "مدير" },
  { value: "secretary", label: "سكرتير" },
] as const;

export const CONTRACT_STATUSES = [
  "نشط",
  "مسودة",
  "تحت المراجعة",
  "معتمد",
  "متوقف",
  "منتهي",
  "مغلق",
  "ملغى",
] as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/** حالات يمكن الانتقال إليها من نافذة تغيير الحالة — القائمة الكاملة الثمانية بترتيب المكتبي (lifecycle_service.CONTRACT_STATUSES) */
export const STATUS_CHANGE_OPTIONS = [
  "مسودة",
  "تحت المراجعة",
  "معتمد",
  "نشط",
  "متوقف",
  "منتهي",
  "مغلق",
  "ملغى",
] as const;

/** الحالات التي يُلزم فيها السبب (إلغاء/إغلاق) */
export const STATUS_REASON_REQUIRED = new Set(["ملغى", "مغلق"]);

// ==================== السندات ====================

export type VoucherType = "receipt" | "payment" | "transfer" | "custody_return" | "salary_deduction";

export const VOUCHER_TYPE_LABEL: Record<VoucherType | string, string> = {
  receipt: "قبض",
  payment: "صرف",
  transfer: "تحويل",
  custody_return: "إرجاع عهدة",
  salary_deduction: "خصم راتب",
};

export const VOUCHER_TYPE_PREFIX: Record<VoucherType | string, string> = {
  receipt: "RV",
  payment: "PV",
  transfer: "TV",
  custody_return: "CV",
  salary_deduction: "SD",
};

/** شارة لون نوع السند: RV أخضر/PV أحمر/TV سماوي/CV برتقالي/SD رمادي */
export const VOUCHER_TYPE_BADGE: Record<VoucherType | string, string> = {
  receipt: "bg-status-info-bg text-status-info",
  payment: "bg-status-danger-bg text-status-danger",
  transfer: "bg-status-done-bg text-status-done",
  custody_return: "bg-status-warn-bg text-status-warn",
  salary_deduction: "bg-status-warn-bg text-status-warn",
};

export interface VoucherItem {
  id: number;
  voucherNumber: string;
  vtype: VoucherType | string;
  vdate: string;
  party?: string;
  partyType?: string | null;
  partyName?: string;
  method?: string;
  account?: string;
  amount: number;
  advanceAmount?: number;
  description?: string;
  contractId?: number | null;
  contractNumber?: string;
  allocation?: string;
  custodyAccountSnapshot?: string;
  advanceEmployeeId?: number | null;
  employeeName?: string;
  expenseAccountSnapshot?: string;
  parentVoucherId?: number | null;
  cancelled: boolean;
  cancelReason?: string;
  receiptGroupRef?: string;
  feeChildren?: { voucherNumber: string; amount: number }[];
}

export interface VouchersResponse {
  items: VoucherItem[];
}

export interface VoucherLinkRow {
  lineId: number;
  amount: number;
  kind: string;
}

export interface VoucherDetailResponse {
  item: VoucherItem;
  links: VoucherLinkRow[];
  feeChildren: { voucherNumber: string; amount: number }[];
}

/** خط دفعة من /api/payment-link — يُستخدم للربط بالسند ولخطة الباطن */
export interface PayLinkLine {
  id: number;
  title: string;
  dueDate: string;
  amountN: number;
  covered: number;
  remaining: number;
  state: string;
  stateLabel?: string;
  eligible?: boolean;
  room?: number;
  gated?: boolean;
}

export interface PaymentLinkResponse {
  lines: PayLinkLine[];
  collected: number;
}

export interface PaymentLinkValidateResult {
  valid?: boolean;
  message?: string;
  suggested?: { lineId: number; amount: number }[];
  [key: string]: unknown;
}

// ==================== المقاولون والعقود الباطنة ====================

export interface SubContractor {
  id: number;
  subCode: string;
  name: string;
  phone?: string;
  email?: string;
  activity?: string;
  notes?: string;
  /** محاذاة Task 63 لأسماء /api/subcontractors الفعلية (كانت _total/_paid/_activeContracts ولا تصلك أبدًا) */
  activeContracts?: number;
  activeAmount?: number;
  paid?: number;
}

export interface SubContractorsResponse {
  /** شكل الخلفي الفعلي: { subcontractors: rows } */
  subcontractors: SubContractor[];
  /** احتياط قرائي للأشكال القديمة */
  items?: SubContractor[];
}

export interface SubContractListItem {
  id: number;
  subcontractor: { id: number; subCode: string; name: string };
  contract: { id: number; contractNumber: string };
  amount: number;
  status: string;
  paid: number;
  remaining: number;
}

export interface SubContractsResponse {
  items: SubContractListItem[];
}

export interface SubPlanLine {
  id: number;
  title: string;
  amount: number;
  dueDate: string;
  state?: string;
  stateLabel?: string;
  gated?: boolean;
  eligible?: boolean;
  sources?: { planLineId: number; title: string; dueDate: string }[];
}

export interface SubContractDetailItem extends SubContractListItem {
  description?: string;
  startDate?: string;
  endDate?: string;
  plan: SubPlanLine[];
  capRemaining?: number;
}

export interface SubContractDetailResponse {
  item: SubContractDetailItem;
}

export interface SubContractItemsResponse {
  items: { id: number; description: string; qty: number; unit?: string; unitPrice: number; amount: number; boqItemId?: number | null }[];
}

export interface SubPayBlockSubLine {
  id: number;
  title: string;
  amount: number;
  dueDate: string;
  state?: string;
  stateLabel?: string;
  gated?: boolean;
  sourcesReady?: boolean;
}

export interface SubPayBlockRow {
  custTitle: string;
  custAmount: number;
  custCovered: number;
  custState: string;
  subLines: SubPayBlockSubLine[];
}

export interface SubPayBlocksResponse {
  rows: SubPayBlockRow[];
}

export interface EmployeeDTO {
  id: number;
  name: string;
  jobTitle?: string;
}

export interface ExpenseAccountDTO {
  id: number;
  name: string;
  accountKind?: string;
  parentId?: number | null;
}

export interface User {
  id: number;
  username: string;
  role: UserRole | string;
  fullName: string;
  jobTitle?: string;
  active?: boolean;
  /** SaaS (Task 85) — شركة المستخدم الحالية */
  companyId?: number;
  companyName?: string;
}

// ==================== العملاء ====================

export interface Customer {
  id: number;
  customerCode: string;
  name: string;
  phone?: string;
  email?: string;
  governorate?: string;
  area?: string;
  block?: string;
  plot?: string;
  address?: string;
  notes?: string;
  _count?: { contracts: number };
}

/** صف عقد داخل تفاصيل العميل (GET /api/customers/[id]) */
export interface CustomerContractRow {
  id: number;
  contractNumber: string;
  contractName: string;
  contractType: string;
  status: string;
  amount: number;
  contractDate: string;
  signDate?: string;
  startDate?: string;
  endDate?: string;
}

export interface CustomersResponse {
  customers: Customer[];
}

export interface CustomerDetailResponse {
  customer: Customer;
  contracts: CustomerContractRow[];
}

// ==================== ملف العميل (صفحة داخلية — مقابل المكتبي archive.py) ====================

/** عقد داخل ملف العميل — Master-Detail + الأهم */
export interface CustomerFileContract {
  id: number;
  contractNumber: string;
  name: string;
  contractType: string;
  status: string;
  startDate: string;
  endDate: string;
  current: number;
  collected: number;
  paid: number;
  remaining: number;
  hasOverdue: boolean;
  overdueDays: number;
  overdueTitle: string;
  isSupervision: boolean;
}

export interface CustomerFileTopContract {
  id: number;
  contractNumber: string;
  name: string;
  status: string;
  current: number;
  collected: number;
  remaining: number;
}

export interface CustomerFileTimelineRow {
  contractId: number;
  contractName: string;
  eventTime: string;
  eventType: string;
  description: string;
  username: string;
}

/** مرفق ضمن ملف العميل (مرفق عقد من عقود العميل) — GET /api/attachments?customerId= */
export interface CustomerAttachment {
  id: number;
  contractId: number;
  contractNumber?: string;
  contractName?: string;
  fileName: string;
  addedAt: string;
  sizeBytes: number;
}

/** GET /api/customer-file/[id] */
export interface CustomerFileResponse {
  customer: {
    id: number;
    customerCode: string;
    name: string;
    phone: string;
    email: string;
    governorate: string;
    area: string;
    block: string;
    plot: string;
    address: string;
    notes: string;
    folderPath: string;
  };
  totals: {
    count: number;
    active: number;
    overdueCount: number;
    overdueDays: number;
    current: number;
    collected: number;
    paid: number;
    remaining: number;
  };
  cheques14: number;
  topContracts: CustomerFileTopContract[];
  contracts: CustomerFileContract[];
  timeline: CustomerFileTimelineRow[];
  meta: { today: string; overdueTooltip: string };
}

// ==================== العقود ====================

/** صف قائمة العقود — GET /api/contracts (مُسطّح: customerName نص) */
export interface ContractListItem {
  id: number;
  contractNumber: string;
  contractName: string;
  contractType: string;
  customerId: number;
  customerName: string;
  contractDate: string;
  signDate?: string;
  startDate?: string;
  endDate?: string;
  status: string;
  statusReason?: string;
  cancelledAt?: string;
  amount: number;
  current: number;
  collected: number;
  remaining: number;
  planCount?: number;
  isSupervision?: boolean;
}

export interface ContractsResponse {
  contracts: ContractListItem[];
}

export interface ContractStage {
  id: number;
  name: string;
  level?: number;
  parentName?: string;
  expectedDays?: number;
  payPct?: number;
  payKind?: string;
  sortOrder?: number;
  startDate?: string;
  endDate?: string;
  isSkipped?: boolean;
  closedBy?: string;
  isSupervision?: boolean;
  /** الطابع الإشرافي للمرحلة (V3.21) — يعود في تفاصيل العقد من كامل صف contract_stages */
  supStart?: string;
  supEnd?: string;
  supActualEnd?: string;
  supMonthly?: number | string;
}

export interface ContractPlanBrief {
  id: number;
  title: string;
  dueDate: string;
  amount: number;
  sortOrder?: number;
  stageId?: number | null;
  triggeredAt: string;
  notes?: string;
}

/** حالة الإشراف المحسوبة (contrack-core.supervisionStatus) */
export interface SupervisionComputed {
  grossValue: number;
  baseValue: number;
  baseEnd: string;
  extensionMonths: number;
  billableExtMonths: number;
  extensionValue: number;
  totalDue: number;
  collected: number;
  remaining: number;
  fullEnd: string;
  delayMonths: number;
  delayValue: number;
  unpaidExtMonths: number;
}

/** استجابة GET /api/contracts/[id] */
export interface ContractDetailResponse {
  contract: {
    id: number;
    contractNumber: string;
    contractName: string;
    contractType: string;
    customerId: number;
    customer: { id: number; name: string; customerCode?: string } | null;
    contractDate: string;
    signDate?: string;
    startDate?: string;
    endDate?: string;
    status: string;
    statusReason?: string;
    cancelledAt?: string;
    /** المسار اليدوي — في صفحة الدفعات يظهر «🔧 مسار يدوي — المنجز X من Y · Z٪» بدل «📏 مسار إجباري» */
    manualPath?: boolean;
    description?: string;
    notes?: string;
    amount: number;
    currency?: string;
    qty?: number;
    unitPrice?: number;
    supStartDate?: string;
    supMonths?: number;
    supMonthly?: number;
    supDiscount?: number;
    supWaivedMonths?: number;
    supWaiveReason?: string;
  };
  stages: ContractStage[];
  plan: ContractPlanBrief[];
  current: number;
  collected: number;
  remaining: number;
  isSupervision: boolean;
  sup: SupervisionComputed | null;
}

/** بذرة تصفية وإغلاق العقد — GET /api/contracts/[id]/settle */
export interface ContractSettlementResponse {
  current: number;
  collected: number;
  remaining: number;
  fullyCollected: boolean;
  stageRequired: boolean;
  stagesComplete: boolean;
  status: string;
  closable: boolean;
  subDues: { count: number; unpaid: number };
}

/** لوحة «نظرة عامة» — GET /api/contracts/[id]/overview (contract_dashboard المكتبية) */
export interface ContractOverviewResponse {
  contract: { id: number; contractNumber: string; status: string; currency: string };
  /** G6 — نمط تسعير هذا العقد تحديدًا (bundle|items|unit|lump) */
  pricingMode?: string;
  originalValue: number;
  addendumsNet: number;
  supExtension: number;
  currentValue: number;
  totalReceipts: number;
  totalPayments: number;
  otherPayments: number;
  totalSubs: number;
  profit: number;
  expectedProfit: number;
  remaining: number;
  timeline: { duration: number; elapsed: number; remaining: number; percent: number; timeStatus: string };
  settlement: { fullyCollected: boolean; stageRequired: boolean; stagesComplete: boolean; closable: boolean; remaining: number };
  subDues: { count: number; unpaid: number };
  manualPath: boolean;
  stagePath: {
    current: { id: number; name: string; daysIn: number; expectedDays: number } | null;
    state: "ok" | "near" | "over" | "none" | "done";
    path: { id: number; name: string; state: "done" | "skip" | "current" | "future"; days: number; expectedDays: number; isSkipped: boolean }[];
    manualDone: number;
    manualTotal: number;
    manualPct: number;
  };
}

/** صفحة «الدفعات والمقاولون» — GET /api/contracts/[id]/pay-view (contract_payment_compare + كتل المقاولين) */
export interface PayViewLine {
  id: number;
  title: string;
  dueDate: string;
  amountN: number;
  covered: number;
  remaining: number;
  state: string;
  stateLabel?: string;
  triggeredAt?: string;
  notes?: string;
  sortOrder?: number;
  stageId?: number | null;
}

export interface PayViewSubLine extends PayViewLine {
  gated?: boolean;
  sourceIds: number[];
}

export interface PayViewSubBlock {
  id: number;
  subcontractorId: number;
  name: string;
  subCode: string;
  amount: number;
  status: string;
  /** بنود العقد الباطن كاملة (Task 63 — بدل itemsCount) */
  items: SubLedgerItem[];
  due: number;
  paid: number;
  remaining: number;
  waiting: number;
  plan: { lines: PayViewSubLine[]; paid: number; planTotal: number; gateEnabled: boolean } | null;
}

export interface ContractPayViewResponse {
  manualPath: boolean;
  manual: { done: number; total: number; pct: number };
  currentStageName: string;
  client: { lines: PayViewLine[]; due: number; collected: number; remaining: number };
  blocks: PayViewSubBlock[];
  freeClientIds: number[];
  totals: {
    clientDue: number;
    clientCollected: number;
    clientRemaining: number;
    subsDue: number;
    subsPaid: number;
    subsRemaining: number;
    subsWaiting: number;
  };
}

// ==================== كشف المقاول الموحّد (Task 63) ====================

/** بند عقد باطن مع وصفه المحسوم (من بنود الكميات أو عنوان خط الخطة المنزّل منه) */
export interface SubLedgerItem {
  id: number;
  boqItemId: number | null;
  description: string;
  unit: string;
  qty: number;
  unitPrice: number;
  amount: number;
}

/** كتلة عقد باطن واحد في كشف المقاول — بنود + دفعات موحدة (مشترك بين ملف العميل وصفحة المقاول) */
export interface SubcontractorLedgerBlock {
  id: number;
  contractId: number;
  contractNumber: string;
  customerName: string;
  amount: number;
  status: string;
  startDate: string;
  endDate: string;
  items: SubLedgerItem[];
  itemsTotal: number;
  clientLines: PayViewLine[];
  plan: { lines: PayViewSubLine[]; paid: number; planTotal: number; gateEnabled: boolean } | null;
  due: number;
  paid: number;
  remaining: number;
  waiting: number;
}

/** GET /api/subcontractors/[id]/ledger — صفحة المقاول الكاملة */
export interface SubcontractorLedgerResponse {
  item: {
    id: number;
    name: string;
    subCode: string;
    phone: string;
    activity: string;
    email: string;
    notes: string;
  };
  blocks: SubcontractorLedgerBlock[];
  totals: {
    contractsCount: number;
    activeCount: number;
    totalAmount: number;
    totalPaid: number;
    totalRemaining: number;
    totalWaiting: number;
  };
}


// ==================== خطة الدفعات ====================

export interface PlanLine {
  id: number;
  title: string;
  dueDate: string;
  amountN: number;
  covered: number;
  explicit?: number;
  remaining: number;
  state: string;
  stateLabel?: string;
  daysDiff?: number;
  triggeredAt?: string;
  stageId?: number | null;
  notes?: string;
}

/** استجابة GET /api/contracts/[id]/plan */
export interface PlanResponse {
  contract: { id: number; contractNumber: string; contractName: string; customerId: number; customerName: string };
  current: number;
  collected: number;
  totalCollected: number;
  currentCoverage?: number;
  supTotalDue?: number | null;
  lines: PlanLine[];
}

// ==================== بنود الكميات BOQ ====================

export interface BoqItemDTO {
  id: number;
  contractId: number;
  stageId?: number | null;
  stageName?: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  amount: number;
  sortOrder?: number;
}

export interface BoqResponse {
  items: BoqItemDTO[];
}

// ==================== الأحداث ====================

export interface ContractEventDTO {
  id: number;
  eventTime: string;
  eventType: string;
  description: string;
  username?: string;
}

export interface EventsResponse {
  events: ContractEventDTO[];
}

// ==================== الإشراف ====================

/** استجابة GET /api/contracts/[id]/supervision */
export interface SupervisionResponse {
  isSupervision: boolean;
  supStartDate: string;
  supMonths: number;
  supMonthly: number;
  supDiscount: number;
  supWaivedMonths: number;
  supWaiveReason: string;
  actualEnd: string;
  sup: SupervisionComputed | null;
}

// ==================== المراجع والإعدادات ====================

export interface ContractTypeDTO {
  id: number;
  name: string;
  defaultAmount?: number;
  notes?: string;
  active?: boolean;
  /** عدد دفعات قالب النوع (type_payment_tpl) — المرحلة 3/ج: وضع القالب في التعديل */
  templatesCount?: number;
  manualTrack?: boolean;
  unitLabel?: string;
  unitPrice?: number;
  pricingMode?: string;
  isSupervision?: boolean;
  /** عدد العقود المرتبطة بالنوع (الربط اسمي عبر contract.contractType) — المرحلة 7-ج */
  contractsCount?: number;
  /** Task 89b — صفوف قالب الدفع (وضع التلقائي: توليد الدفعات مع تعديل المبالغ) */
  paymentTemplates?: TypePaymentTemplateDTO[];
  /** Task 89b — مكوّنات الشامل (pricing_mode=bundle) */
  bundleComponents?: TypeBundleComponentDTO[];
}

/** صف قالب دفع النوع — triggerStageName لربط الدفعة بمرحلة العقد بالاسم (V4.48) */
export interface TypePaymentTemplateDTO {
  title: string;
  pct: number;
  amountFixed: number;
  daysOffset: number;
  triggerStageName: string;
}

/** مكوّن الشامل من إعدادات النوع — الإشرافي يدخل بأشهر × قيمة شهر، وغيره كمية × سعر مرجعي */
export interface TypeBundleComponentDTO {
  componentTypeId: number;
  name: string;
  qty: number;
  unitPrice: number;
  unitLabel: string;
  isSupervision: boolean;
  pricingMode: string;
}

export interface ContractTypesResponse {
  types: ContractTypeDTO[];
}

export interface WorkflowStageDTO {
  id: number;
  transactionType: string;
  stageName: string;
  stageOrder: number;
  color?: string;
  parentId?: number | null;
  expectedDays?: number;
  isPreContract?: boolean;
  contractType?: string;
  /** Task 89b — حقل النقل إلى نسخة العقد (نسبة الدفع وطابعه الإشرافي) */
  paymentPct?: number;
  payKind?: string;
  isSupervision?: boolean;
  supMonthly?: number;
}

export interface PaymentMethodDTO {
  id: number;
  name: string;
  feeType: "amount" | "percent" | string;
  feeValue: number;
  isActive: boolean;
}

export interface PaymentMethodsResponse {
  methods: PaymentMethodDTO[];
}

export interface SettingsDTO {
  id?: number;
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  headerTitle?: string;
  currency: string;
  bankFeeAmount: number;
  bankFeeMethod: string;
  bankFeeEnabled: boolean;
  cashflowEnabled?: boolean;
  openingBalanceBank: number;
  openingBalanceCash: number;
  openingBalanceDate: string;
  cashStartDate?: string;
  subPayClientGate: boolean;
  collectionAlertDays: number;
  expiryAlerts?: string;
  uiTheme?: string;
}

export interface SettingsResponse {
  settings: SettingsDTO;
}

// ==================== المؤشرات ====================

// ==================== الرئيسية الكاملة (بند 7 — مطابقة المكتبي DashboardPage) ====================

/** تنبيه النظام — اللون والنص والعمر كما المكتبي حرفيًا */
export interface DashboardAlertRow {
  /** بصمة sha1 لنص التنبيه — تستخدم للإخفاء (alert_key المكتبي) */
  key: string;
  color: "danger" | "warn" | "info" | "purple" | "amber";
  text: string;
  age: number;
  noConvert?: boolean;
}

/** صف نشاط — أحداث العقود والسندات السارية (recent_activity المكتبي) */
export interface DashboardActivityRow {
  when: string;
  kind: string;
  text: string;
  amount: number;
  sign: number; // 1 وارد | -1 منصرف | 0 حدث
  contractId: number | null;
  customerId: number | null;
  customerName: string;
  contractLabel: string;
}

/** مهمة لوحة الرئيسية المضمّنة — أعمدة المهمة/الموعد/المتبقي (TasksPage compact) */
export interface DashboardTaskRow {
  id: number;
  title: string;
  details: string;
  dueAt: string; // YYYY-MM-DD HH:mm
  remindMinutes: number;
  taskType: string; // تذكير | موعد
  status: string; // مفتوحة | منجزة
  doneAt: string;
  minutesLeft: number;
  overdue: boolean;
  customerId: number | null;
  customerName: string | null;
  contractId: number | null;
  contractNumber: string | null;
}

export interface DashboardResponse {
  generatedAt: string;
  today: string;
  counts: {
    customers: number;
    contracts: number;
    vouchers: number;
    projects: number;
  };
  alerts: DashboardAlertRow[];
  alertsHidden: number;
  /** عدد التنبيهات المخفاة حاليًا للمستخدم (لبند «إظهار التنبيهات المخفية» في القائمة) */
  dismissedCount: number;
  activity: DashboardActivityRow[];
  tasks: DashboardTaskRow[];
}

// ==================== كشوف الحساب ====================

/** صف كشف حساب — kind: move | opening | subtotal | total | invoice_info */
export interface StatementRow {
  date: string;
  ref: string;
  desc: string;
  debit: number;
  credit: number;
  balance: number;
  kind?: string;
  contractNumber?: string;
  contractId?: number;
}

export interface StatementTotals {
  debit: number;
  credit: number;
  remaining: number;
  current?: number;
  collected?: number;
}

/** GET /api/statement/contract/[id]?from&to — القاعدة 5: الفواتير «للعلم» لا تخفض الرصيد */
export interface ContractStatementResponse {
  contract?: { id: number; contractNumber: string; customerName?: string };
  rows: StatementRow[];
  totals: StatementTotals;
}

export interface CustomerStatementSection {
  contract: { contractNumber: string; customerName: string; contractId?: number };
  rows: StatementRow[];
  subtotal: { debit: number; credit: number };
}

/** GET /api/statement/customer/[id]?contractId&from&to */
export interface CustomerStatementResponse {
  sections: CustomerStatementSection[];
  totals: StatementTotals;
}

/** GET /api/statement/subcontractor/[id]?from&to */
export interface SubcontractorStatementResponse {
  subcontractor?: { id: number; name: string; subCode: string };
  rows: StatementRow[];
  totals: StatementTotals;
}

/** هدف فتح شاشة الكشوفات مسبق التعبئة */
export interface StatementTarget {
  kind: "contract" | "customer" | "subcontractor";
  id: number;
}

// ==================== التقارير ====================

export type ReportCellValue = string | number;

/** عقد تقرير موحد: GET /api/reports/{key} → {title, heads, rows, numberCols, accentRows?, totals?, note?} */
export interface ReportResponse {
  title: string;
  heads: string[];
  rows: ReportCellValue[][];
  numberCols: number[];
  accentRows?: number[];
  totals?: ReportCellValue[] | Record<string, ReportCellValue>;
  note?: string;
}

// ==================== المتابعة ====================

export interface FollowupDueRow {
  contractId?: number;
  contractNumber: string;
  customerName: string;
  remaining: number;
  daysDiff?: number;
  title?: string;
}

export interface FollowupOverdueRow {
  contractId?: number;
  contractNumber: string;
  customerName: string;
  remaining: number;
  daysSince: number;
  lastReceiptDate?: string;
}

export interface FollowupExpiringRow {
  contractId?: number;
  contractNumber: string;
  customerName: string;
  endDate: string;
  daysLeft: number;
  /** مستوى التنبيه من تدرّج أيام الإعدادات (أصغر حدّ ≥ المتبقي) */
  tier: FollowupExpiryTier;
}

export interface FollowupBaseEndRow {
  contractId?: number;
  contractNumber: string;
  customerName?: string;
  baseEnd: string;
  daysLeft: number;
}

/** صف «تمديد إشراف»: أساس الإشراف انتهى والتمديد ساري */
export interface FollowupExtensionRow {
  contractId?: number;
  contractNumber: string;
  customerName: string;
  baseEnd: string;
  actualEnd?: string;
  supMonthly: number;
}

/** صف تنبيه مراحل التنفيذ: متأخر (over) أو قارب (left) */
export interface FollowupExecutionRow {
  contractId?: number;
  contractNumber: string;
  customerName: string;
  stageName: string;
  kind: "overdue" | "near";
  daysIn: number;
  expected: number;
  over?: number;
  left?: number;
}

export type FollowupExpiryTier = "deep" | "warn" | "info";

/** إعدادات المتابعة المُعادة من الخادم */
export interface FollowupSettings {
  collectionAlertDays: number;
  expiryWindow: number;
}

/** GET /api/followup */
export interface FollowupResponse {
  generatedAt: string;
  today: string;
  settings: FollowupSettings;
  dueNowTotal: number;
  dueNow: FollowupDueRow[];
  overdueCollections: FollowupOverdueRow[];
  expiring: FollowupExpiringRow[];
  nearBaseEnd: FollowupBaseEndRow[];
  extension: FollowupExtensionRow[];
  execution: FollowupExecutionRow[];
}

// ==================== البحث الشامل ====================

export interface SearchItem {
  id: number;
  title: string;
  subtitle?: string;
  contractId?: number;
}

export interface SearchGroup {
  type: string;
  label: string;
  items: SearchItem[];
}

/** GET /api/search?q=&limit=8 */
export interface SearchResponse {
  groups: SearchGroup[];
}

// ==================== المستخدمون والصلاحيات ====================

export interface UserListItem extends User {
  active: boolean;
}

export interface UsersResponse {
  users: UserListItem[];
}

export interface PermissionCatalogItem {
  key: string;
  label: string;
  group: string;
}

/** استجابة GET /api/users/[id]/permissions */
export interface PermissionsResponse {
  user: User;
  catalog: PermissionCatalogItem[];
  permissions: { permKey: string; allowed: boolean }[];
}

// ==================== الملاحق (الأوامر التغييرية) ====================

/** حالة الملحق حرفيًا من المخطط: مسودة|تحت المراجعة|معتمد|ملغى */
export const ADDENDUM_STATUSES = ["مسودة", "تحت المراجعة", "معتمد", "ملغى"] as const;

/** شارة نوع الملحق: «عقد إضافي» emerald / «أمر تغييري» سماوي */
export const ADDENDUM_TYPE_BADGE: Record<string, string> = {
  "عقد إضافي": "bg-status-info-bg text-status-info",
  "أمر تغييري": "bg-status-warn-bg text-status-warn",
};

export const ADDENDUM_TYPES = ["عقد إضافي", "أمر تغييري"] as const;

/** صف ملحق في قائمة العقد — GET /api/contracts/[id]/addendums */
export interface AddendumRow {
  id: number;
  addendumNumber: string;
  addendumType: string;
  adate: string;
  reason: string;
  description?: string;
  amountAdd: number;
  amountDeduct: number;
  net: number;
  status: string;
  approvedDate?: string;
  cancelReason?: string;
  itemsCount: number;
  side: string; // client | sub
  subContractId?: number | null;
  /** هل يمكن تعديله (مسودة/تحت المراجعة — من الخلفي) */
  editable?: boolean;
}

export interface AddendumsResponse {
  items: AddendumRow[];
}

/** جزء (بند) من ملحق — GET /api/addendums/[id] */
export interface AddendumPart {
  id: number;
  action: string; // add | delete | unlink
  refKind: string; // boq | plan | stage
  refId: number;
  boqItemId?: number | null;
  description: string;
  qty: number;
  unit?: string;
  unitPrice: number;
  amount: number;
  applied: boolean;
  createdItemId?: number;
  restoreDeletedBy?: number;
  /** تاريخ الدفعة لأجزاء plan (من الخلفي) */
  dueDate?: string;
  /** وصف العنصر المرجعي (من الخلفي) */
  refLabel?: string;
}

export interface AddendumDetailResponse {
  /** مفتاح المفرد «addendum» من الخلفي (نقبل «item» احتياطًا) */
  item?: AddendumRow;
  addendum?: AddendumRow;
  items: AddendumPart[];
}

// ==================== المطالبات ====================

/** صف مطالبة — GET /api/claims */
export interface ClaimRow {
  id: number;
  claimNumber: string;
  direction: string; // out | in
  contract: { id: number; contractNumber: string; contractName?: string; customerId: number; customerName?: string; customer: { id: number; name: string } | null };
  subContract?: { id: number; title?: string; amount?: number } | null;
  title: string;
  amount: number;
  dueDate: string;
  status: string;
  postponedUntil: string;
  voucherRef: string;
  notes: string;
}

export interface ClaimsResponse {
  claims: ClaimRow[];
  counters?: Record<string, number>;
  totals?: { count: number; openAmount: number; doneAmount: number; overdueCount: number; overdueAmount: number };
}

// ==================== العُهد ====================

/**
 * حساب عهدة = ExpenseAccount(accountKind='advance') — الرصيد محسوب لحظيًا:
 * balance = handed (تسليم) − spent (تصفية) − returned (إرجاع). القاعدة 8.
 */
export interface CustodyAccountItem {
  id: number;
  name: string;
  parentId?: number | null;
  /** المسار الكامل مثل «مصروفات / العُهد / عهدة عامة» (من الخلفي إن وُجد) */
  fullPath?: string;
  isActive: boolean;
  balance: number;
  handed: number;
  spent: number;
  returned: number;
  children?: CustodyAccountItem[];
}

export interface CustodyAccountsResponse {
  items: CustodyAccountItem[];
}

/** نوع حركة دفتر العهدة: handover تسليم | settlement تصفية | return إرجاع */
export type CustodyLedgerKind = "handover" | "settlement" | "return";

export const CUSTODY_KIND_LABEL: Record<string, string> = {
  handover: "تسليم",
  settlement: "تصفية",
  return: "إرجاع",
};

/** شارة لون حركة العهدة: تسليم amber / تصفية sky / إرجاع emerald */
export const CUSTODY_KIND_BADGE: Record<string, string> = {
  handover: "bg-status-warn-bg text-status-warn",
  settlement: "bg-status-info-bg text-status-info",
  return: "bg-status-done-bg text-status-done",
};

/** صف دفتر حركة العهدة — balance التراكمي من الخلفي إن وُجد وإلا يُحسب محليًا */
export interface CustodyLedgerRow {
  voucherId: number;
  voucherNumber: string;
  vtype: string;
  vdate: string;
  amount: number;
  kind: CustodyLedgerKind | string;
  groupRef?: string | null;
  description?: string;
  balance?: number;
}

export interface CustodyLedgerResponse {
  rows: CustodyLedgerRow[];
  balance: number;
}

/** مرجع التصفية PAY-GRP-YYYYMMDD-NNN — التصفية لا تصرف نقدًا جديدًا (توزيع مبلغ سبق صرفه) */
export interface CustodySettlementItem {
  ref: string;
  vdate: string;
  custodyAccountId: number;
  custodyName: string;
  total: number;
  linesCount: number;
  description?: string;
}

export interface CustodySettlementsResponse {
  items: CustodySettlementItem[];
}

/** بند تصفية — كل بند سند PV مستقل تحت مرجع المجموعة نفسه */
export interface CustodySettlementLine {
  id?: number;
  voucherId?: number;
  voucherNumber?: string;
  vdate?: string;
  amount: number;
  expenseAccountId?: number | null;
  expenseAccountName?: string;
  customerId?: number | null;
  customerName?: string;
  contractId?: number | null;
  contractNumber?: string;
  description?: string;
  cancelled?: boolean;
}

export interface CustodySettlementDetailResponse {
  item: CustodySettlementItem;
  lines: CustodySettlementLine[];
}

/** GET /api/custody/overview — بطاقات علوية ولوحة العهد المعلقة */
export interface CustodyOverviewItem {
  accountId: number;
  name: string;
  balance: number;
  lastHandover?: string | null;
  lastSettlement?: string | null;
  settlementsCount: number;
}

export interface CustodyOverviewResponse {
  items: CustodyOverviewItem[];
}

// ==================== الفواتير ====================

/** فاتورة INV-#### — القاعدة 5: للعلم لا تخفض المديونية، ولا تتجاوز متبقي العقد */
export interface InvoiceItem {
  id: number;
  invoiceNumber: string;
  customer: { id: number; name: string };
  contract: { id: number; contractNumber: string };
  invoiceDate: string;
  description?: string;
  amount: number;
  notes?: string;
}

export interface InvoicesResponse {
  items: InvoiceItem[];
}

export interface InvoiceDetailResponse {
  item: InvoiceItem;
}

// ==================== البوابة المالية ====================

/**
 * تصنيف عملية البوابة — القاعدة 9: المطابقة الآلية بالهاتف/الاسم/الرابط ضد سندات القبض فقط؛
 * mine = شركتنا (مطابق) / other = الشركة الأخرى / unmarked = غير مصنّف.
 */
export type GatewayOpStatus = "mine" | "other" | "unmarked";

export const GATEWAY_STATUS_LABEL: Record<string, string> = {
  mine: "لنا",
  other: "شركة أخرى",
  unmarked: "غير مصنّفة",
};

/** شارة الحالة: لنا أخضر / أخرى برتقالي / غير مصنّفة رمادي */
export const GATEWAY_STATUS_BADGE: Record<string, string> = {
  mine: "bg-status-info-bg text-status-info",
  other: "bg-status-warn-bg text-status-warn",
  unmarked: "bg-status-done-bg text-status-done",
};

/** حالة يوم التصفية: done مطابق / pending معلق / late متأخر / diff فرق */
export const CLEARING_STATUS_BADGE: Record<string, string> = {
  done: "bg-status-done-bg text-status-done",
  pending: "bg-status-info-bg text-status-info",
  late: "bg-status-danger-bg text-status-danger",
  diff: "bg-status-warn-bg text-status-warn",
};

/** إعدادات بوابة دفع — العمولة ثابتة لكل عملية (تُخصم من مستحق الشركة الأخرى) */
export interface GatewayProfile {
  id: number;
  name: string;
  bankAccount: string;
  /** طرق دفع مفصولة بفوترة تُطابَق على vouchers.method */
  methods: string;
  /** T+N — أيام التأجيل للتحصيل الفعلي */
  lagDays: number;
  /** عمولة ثابتة لكل عملية */
  feeFixed: number;
  tolerance: number;
  /** أيام التأخير المسموحة قبل «متأخرة التسديد» */
  lateDays: number;
  isActive: boolean;
  methodsList?: string[];
}

export interface GatewayProfilesResponse {
  profiles: GatewayProfile[];
}

/** صف عملية بوابة — GET /api/gateway/ops (مفتاح ops) */
export interface GatewayOpRow {
  id: number;
  gateway: string;
  opDate: string;
  phone: string;
  amount: number;
  ref?: string;
  status: GatewayOpStatus | string;
  statusLabel?: string;
  receiptNo?: string | null;
  customer?: string | null;
  batch?: string;
  classifiedManual?: boolean;
  distributed: boolean;
  distributedAt?: string | null;
  /** 1 محوَّلة / 0 معلقة / 2 ملغاة / −1 فاشلة / null مجهول */
  gwPaid?: number | null;
  gwPaidDate?: string;
  /** تاريخ الاستحقاق الفعلي T+N */
  effectiveDate?: string;
  fee?: number;
  net?: number;
  paidAllocated?: number;
  remainingNet?: number;
  paidTransferId?: number;
  /** مقفلة = موزعة أو لها تخصيص تسديد — لا تصنيف ولا توزيع بعدها */
  locked?: boolean;
}

export interface GatewayOpsResponse {
  ops: GatewayOpRow[];
  totals?: { count: number; amount: number; net: number };
}

/** نتيجة معالجة ملف التسديد — POST /api/gateway/settlement-file (تثبيت تراكمي + مطابقة آلية) */
export interface GatewaySettlementFileResult {
  received?: number;
  inserted: number;
  updated?: number;
  ignoredLocked?: number;
  matched: number;
  summary?: {
    mine: { count: number; amount: number };
    other: { count: number; amount: number };
    unmarked: { count: number; amount: number };
    total: { count: number; amount: number };
  };
  checklist?: string[];
  skipped?: number;
  skipReasons?: string[];
}

/** سطر بنك — إيداع من كشف حساب */
export interface GatewayBankLine {
  id: number;
  cdate: string;
  amount: number;
  descr?: string;
  bankAccount?: string;
  batch?: string;
}

export interface GatewayBankLinesResponse {
  lines: GatewayBankLine[];
  totals?: { count: number; amount: number };
}

/** يوم تصفية لكل (بوابة، يوم) — التصفية اليومية ثلاثية sys×gw×bank (القاعدة 9) */
export interface GatewayClearingRow {
  gateway: string;
  day: string;
  /** سيستم: سندات القبض بطرق البوابة */
  sys: number;
  /** البوابة: الموزَّعة لنا/للأخرى */
  g_mine: number;
  g_other: number;
  n_mine: number;
  n_other: number;
  /** الفرق: متوقع − بنك فعلي */
  gap: number;
  /** متوقع للبنك بعد العمولة */
  expect: number;
  settle_date: string;
  bank_amount: number;
  bank_date: string;
  bank_descr: string;
  my_share: number;
  other_share: number;
  status: "done" | "pending" | "late" | "diff" | string;
  statusLabel: string;
}

export interface GatewayDailyClearingResponse {
  rows: GatewayClearingRow[];
  totals?: Record<string, number>;
  from?: string;
  to?: string;
}

/** GET /api/gateway/summary — بطاقات KPI العلوية (late = أيام تصفية متأخرة آخر 60 يومًا) */
export interface GatewaySummaryResponse {
  total: { count: number; amount: number };
  collected: { count: number; amount: number };
  pendingT1: { count: number; amount: number };
  collectedToday: { count: number; amount: number };
  late: GatewayClearingRow[];
  lateLabel?: string;
}

// ==================== الشركة الأخرى ====================

/**
 * تسديد الشركة الأخرى لا ينشئ أي سند (القاعدة 9) — توزيع على صافي العمليات
 * (gross − fee) جزئيًا عبر transfer_op_allocs.
 */
export interface OtherDueItem {
  opId: number;
  gateway?: string;
  opDate: string;
  phone: string;
  customer?: string;
  ref?: string;
  gross: number;
  fee: number;
  net: number;
  paidAllocated: number;
  remaining: number;
}

export interface OtherDueItemsResponse {
  items: OtherDueItem[];
  totals?: { count: number; gross: number; fees: number; net: number; paid: number; remaining: number };
}

export interface OtherTransferItem {
  id: number;
  tdate: string;
  amount: number;
  method?: string;
  ref?: string;
  notes?: string;
  /** المخصص من التحويل على عمليات */
  alloc?: number;
  /** غير المخصص «دفعة على الحساب» */
  unalloc?: number;
  nOps?: number;
  dates?: string[];
  /** open على الحساب | partial جزئي | full مخصص كامل */
  status?: "open" | "full" | "partial" | string;
  allocs?: { opId: number; amount: number; opDate: string; customer: string; phone: string; gateway: string }[];
}

export interface OtherTransfersResponse {
  transfers: OtherTransferItem[];
  totals?: { count: number; amount: number; alloc: number; unalloc: number };
}

/** GET /api/other-company/balance — الرصيد = الافتتاحي + المستحق الصافي − المسدد (سالب = فروقات عمولة لصالحنا) */
export interface OtherBalanceResponse {
  opening?: { amount: number; note?: string; updatedAt?: string };
  dues: number;
  paid: number;
  remaining: number;
  side?: { duesTotal?: number; grossDue?: number; feesTotal?: number } & Record<string, unknown>;
}

/** GET/PUT /api/other-company/opening — رصيد افتتاحي (سالب مرفوض) */
export interface OtherOpeningResponse {
  opening: number;
}

/** ماذا غطى التسديد — GET /api/other-company/transfers/[id]/coverage */
export interface OtherTransferCoverageResponse {
  transfer?: OtherTransferItem;
  ops?: { id: number; opDate: string; gateway?: string; customer?: string; phone?: string; gross: number; net: number; alloc: number }[];
  groups?: { date: string; n: number; gross: number; net: number; paid: number }[];
  totals?: Record<string, unknown>;
}

/** سطر دفتر الشركة الأخرى — مستحق (plus) أو تسديد (minus) برصيد تراكمي */
export interface OtherLedgerRow {
  date: string;
  kind: "due" | "pay" | string;
  text?: string;
  gateway?: string;
  plus: number;
  minus: number;
  tid?: number;
  balance?: number;
}

export interface OtherLedgerResponse {
  opening?: { amount: number; note?: string };
  /** رصيد أول الفترة (شامل الافتتاحي) */
  prior?: number;
  lines: OtherLedgerRow[];
  totalPlus?: number;
  totalMinus?: number;
  end?: number;
}

export interface OtherDailySettlementRow {
  day: string;
  n?: number;
  gross?: number;
  fees?: number;
  /** المستحق الصافي لليوم */
  net: number;
  paid: number;
  remaining?: number;
  /** paid | partial | unpaid */
  status?: string;
  cumulative_due?: number;
  cumulative_paid?: number;
  /** الفرق التراكمي (يُحسب بالخلفي) */
  cumulative_diff?: number;
}

export interface OtherDailySettlementResponse {
  days: OtherDailySettlementRow[];
  totals?: { n?: number; gross?: number; fees?: number; net?: number; paid?: number; remaining?: number };
  transfersTotal?: number;
}

/** GET /api/other-company/running-statement — كشف يومي بالرصيد الجاري (G1) */
export interface OtherRunningStatementResponse {
  opening: number;
  prior: number;
  days: { day: string; in: number; out: number; balance: number }[];
  totalIn: number;
  totalOut: number;
  end: number;
  transfers: { id: number; tdate: string; amount: number; ref?: string | null; method?: string | null }[];
}

// ==================== المهام (المرحلة 7) ====================

export const TASK_TYPES = ["تذكير", "موعد"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const REMIND_OPTIONS = [
  { value: 0, label: "بدون تذكير" },
  { value: 15, label: "قبل 15 دقيقة" },
  { value: 30, label: "قبل 30 دقيقة" },
  { value: 60, label: "قبل ساعة" },
  { value: 120, label: "قبل ساعتين" },
  { value: 1440, label: "قبل يوم" },
] as const;

export interface TaskItem {
  id: number;
  title: string;
  details: string;
  dueAt: string; // YYYY-MM-DD HH:mm
  remindMinutes: number;
  taskType: string; // تذكير | موعد
  status: string; // مفتوحة | منجزة
  doneAt?: string | null;
  notifiedBefore?: boolean;
  notifiedAfter?: boolean;
  customerId?: number | null;
  customerName?: string | null;
  contractId?: number | null;
  contractNumber?: string | null;
  source?: string; // يدوية | جدول الزيارات
}

export interface TasksResponse {
  /** الخلفي يرسل tasks — items احتياط وفق العقد المتوقع */
  tasks: TaskItem[];
  items?: TaskItem[];
}

/** GET /api/tasks/notifications — عناصر استحق التذكير قبل/بعد الموعد */
export interface TaskNotificationsResponse {
  before: TaskItem[];
  after: TaskItem[];
}

// ==================== الزيارات (المرحلة 7) ====================

export interface VisitStaffMember {
  id: number;
  name: string;
  phone?: string;
  active: boolean;
  sort?: number;
  /** عدد زيارات اليوم (الخلفي يرسلها بأسماء مختلفة) */
  todayVisits?: number;
  dayCount?: number;
}

export interface VisitsStaffResponse {
  staff?: VisitStaffMember[];
  items?: VisitStaffMember[];
}

/** خلية شبكة الجدولة — null عند الفراغ (شكل مرن: المفاتيح strings، والمعرف قد يأتي visitId) */
export interface VisitCell {
  id?: number;
  visitId?: number;
  customerId?: number | null;
  customerName?: string | null;
  customerCode?: string;
  note?: string;
  taskId?: number | null;
  taskTitle?: string;
  taskStatus?: string;
  createdBy?: string;
}

export interface VisitGridRow {
  hourSlot: string; // "08:00"
  cells: Record<string, VisitCell | null>;
}

/** صف أملس احتياطي إن أرسل الخلفي قائمة زيارات بدل شبكة */
export interface VisitFlatRow {
  id?: number;
  visitId?: number;
  hourSlot: string;
  staffId: number;
  customerId?: number | null;
  customerName?: string | null;
  note?: string;
  taskId?: number | null;
}

export interface VisitsDayResponse {
  date: string;
  config?: { startHour: number; endHour: number; slotMinutes: number };
  staff?: VisitStaffMember[];
  hours?: string[];
  /** شبكة صفوف جاهزة [{hourSlot, cells:{staffId: cell|null}}] */
  grid?: VisitGridRow[];
  /** أو خريطة {hourSlot: {staffId: cell}} */
  cells?: Record<string, Record<string, VisitCell | null>>;
  /** أو قائمة زيارات مسطّحة */
  visits?: VisitFlatRow[];
  items?: VisitFlatRow[];
  total?: number;
  /** إن أرسل الخلفي تنبيه تعارض/ملاحظة على مستوى اليوم */
  warning?: string;
}

// ==================== التعليقات (المرحلة 7) ====================

export const COMMENT_KINDS = ["عام", "مالية", "بلدية", "قانونية", "تنفيذ", "مستندات", "اتصال"] as const;
export const COMMENT_PRIORITIES = ["عادي", "مهم", "عاجل"] as const;
export const COMMENT_STATUSES = ["مفتوح", "تم", "مؤجل", "ملغى"] as const;

export const COMMENT_PRIORITY_BADGE: Record<string, string> = {
  "عاجل": "bg-status-danger-bg text-status-danger",
  "مهم": "bg-status-warn-bg text-status-warn",
  "عادي": "bg-status-done-bg text-status-done",
};

export const COMMENT_STATUS_BADGE: Record<string, string> = {
  "مفتوح": "bg-status-info-bg text-status-info",
  "تم": "bg-status-done-bg text-status-done",
  "مؤجل": "bg-status-warn-bg text-status-warn",
  "ملغى": "bg-status-done-bg text-status-done",
};

export interface CommentItem {
  id: number;
  customerId: number;
  customerName?: string | null;
  contractId?: number | null;
  contractNumber?: string | null;
  body: string;
  author: string;
  createdBy?: string; // username للتدقيق (يحدد صاحب التعليق)
  createdAt: string;
  pinned: boolean;
  editedAt?: string | null;
  editor?: string | null;
  kind: string;
  priority: string;
  status: string;
  tags: string; // مفصولة بفواصل
  followupDate: string; // YYYY-MM-DD أو ""
  isDeleted?: boolean;
  deletedAt?: string | null;
  deleteReason?: string | null;
  source?: string;
}

export interface CommentsResponse {
  /** الخلفي يرسل comments — items احتياط وفق العقد المتوقع */
  comments: CommentItem[];
  items?: CommentItem[];
  count?: number;
  summary?: { total?: number; open?: number; urgent?: number; due?: number };
}

// ==================== الحوكمة: التدقيق والنسخ وإدارة البيانات (المهمة 15) ====================

export interface AuditItem {
  id: number;
  ts: string;
  username: string;
  action: string;
  entityType: string;
  entityId: number;
  entityName: string;
  oldStatus: string;
  newStatus: string;
  reason: string;
}

export interface AuditResponse {
  items: AuditItem[];
  total: number;
}

export type BackupKind = "db" | "full" | "safety";

export interface BackupItem {
  fileName: string;
  kind: BackupKind;
  username: string;
  sizeKB: number;
  createdAt: string;
  exists: boolean;
}

export interface BackupsResponse {
  items: BackupItem[];
}

export interface BackupCreateResponse {
  created: boolean;
  fileName: string;
  message?: string;
}

export interface BackupRestoreResponse {
  restored: boolean;
  safetyFile: string;
  message: string;
}

export interface PurgeTreeItem {
  key: string;
  label: string;
  count: number;
}

export interface PurgePreviewResponse {
  preview: boolean;
  kind: "contract" | "customer";
  id: number;
  label: string;
  tree: PurgeTreeItem[];
  total: number;
}

export interface PurgeExecuteResponse {
  purged: boolean;
  auditId: number;
  label: string;
  counts: Record<string, number>;
  filesRemoved?: number;
  message: string;
}

export interface PurgeAuditItem {
  id: number;
  purgedAt: string;
  purgedBy: string;
  entity: string;
  entityId: number;
  label: string;
  reason: string;
  snapshotSize: number;
}

export interface PurgeAuditResponse {
  items: PurgeAuditItem[];
  total: number;
}

export interface FullResetResponse {
  reset: boolean;
  deleted: Record<string, number>;
  total: number;
  message: string;
}

export const BACKUP_KIND_LABEL: Record<BackupKind, string> = {
  db: "قاعدة البيانات",
  full: "كاملة",
  safety: "أمان",
};

export const PURGE_KIND_LABEL: Record<string, string> = {
  contract: "عقد",
  customer: "عميل",
  full_reset: "إعادة ضبط",
};

// ==================== أدوات مشتركة ====================

/** استخراج رسالة عربية من خطأ API/شبكة */
export function errMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return "حدث خطأ غير متوقع";
}
