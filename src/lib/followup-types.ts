// ============================================================
// ConTrack Online — أنواع موديول المتابعة والمستحقات + إدارة المستخدمين
// (JSON-serializable — بنمط report-types.ts / subcontract-types.ts)
// ============================================================

/** صف دفعة مستحقة (متأخرة أو قادمة) في شاشة المتابعة */
export interface DuePaymentRow {
  paymentId: number
  contractId: number
  contractNumber: string
  contractName: string
  customerName: string
  title: string
  /** yyyy-MM-dd */
  dueDate: string
  amount: number
  paidAmount: number
  remaining: number
  /** فرق الأيام التقويمي عن اليوم (للمتأخرة فقط، صفر للقادمة) */
  daysLate: number
  status: 'متأخرة' | 'قادمة'
}

/** مرحلة عقد نشط مفتوحة (بلا إغلاق) وغير متخطاة */
export interface PendingStageRow {
  stageId: number
  contractId: number
  contractNumber: string
  contractName: string
  customerName: string
  name: string
  /** yyyy-MM-dd أو null إن لم تبدأ بعد */
  startDate: string | null
  expectedDays: number
  /** الأيام منذ startDate أو منذ إنشاء العقد */
  daysOpen: number
  /** تجاوزت المدة المتوقعة (expectedDays > 0 و daysOpen > expectedDays) */
  overdue: boolean
}

/** حزمة شاشة المتابعة والمستحقات */
export interface FollowupDTO {
  overdue: DuePaymentRow[]
  upcoming: DuePaymentRow[]
  pendingStages: PendingStageRow[]
  totals: {
    overdueCount: number
    overdueAmount: number
    upcomingCount: number
    upcomingAmount: number
    /** عدد المراحل المتعثرة (تجاوزت مدتها المتوقعة) */
    staleStages: number
  }
}

/** المستخدم كما يظهر في شاشة الإدارة (بدون كلمات المرور)
 *  ملاحظة: lastLogin محجوز ويُعاد null حاليًا — تتبّعه يتطلب حقلًا في
 *  schema.prisma أو تعديل مسار الدخول وكلاهما خارج نطاق هذه المهمة */
export interface UserDTO {
  id: number
  username: string
  fullName: string
  jobTitle: string
  role: string
  isActive: boolean
  lastLogin: string | null
  createdAt: string
}

/** مدخل إنشاء/تعديل مستخدم (كل الحقول اختيارية للتعديل) */
export interface UserInput {
  username?: string
  password?: string
  fullName?: string
  jobTitle?: string
  role?: string
  isActive?: boolean
}
