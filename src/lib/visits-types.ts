// ============================================================
// ConTrack Online — أنواع جدول الزيارات (spec-8-f §2)
// الخانة = (date, hourSlot, employeeId) فريدة — الخانة عميل واحد
// ============================================================

/** الموظف كما يرجع من GET /api/employees (ملكية وكيل 14-a) */
export interface EmployeeDTO {
  id: number
  name: string
  phone: string
  active: boolean
}

/** إعدادات شبكة الزيارات (تُخزن في Settings.uiPrefs) */
export interface VisitSlotConfig {
  /** خطوة الحصة بالدقائق — المسموح حصرًا 15|20|30|60|90|120 وإلا 60 */
  slotMinutes: number
  /** ساعة البداية 0-23 (افتراضي 8 ⇒ 08:00) */
  startHour: number
  /** ساعة النهاية 1-24 (افتراضي 20) */
  endHour: number
}

/** زيارة كما تظهر في الشبكة */
export interface VisitDTO {
  id: number
  date: string // yyyy-MM-dd
  hourSlot: string // "09:30"
  employeeId: number
  employeeName: string
  customerId: number | null
  customerName: string | null
  customerPhone: string | null
  contractId: number | null
  contractNumber: string | null
  contractName: string | null
  notes: string
  taskId: number | null // مرحَّلة كمهمة؟
  createdBy: string
  createdAt: string
}

/** استجابة GET /api/visits — شبكة يوم واحد */
export interface VisitsGridDTO {
  date: string
  config: VisitSlotConfig
  /** خانات اليوم ["08:00","08:30",…] حتى قبل النهاية */
  slots: string[]
  /** احتياطي: الموظفون النشطون من قاعدة البيانات (يُستخدم إن لم تكتمل /api/employees) */
  employees: EmployeeDTO[]
  visits: VisitDTO[]
}

/** حجز/تحديث خانة */
export interface VisitBookingInput {
  date: string // yyyy-MM-dd
  hourSlot: string // "HH:MM"
  employeeId: number
  customerId: number
  contractId?: number | null
  notes?: string
}

/** إعدادات تاب «الزيارات» في الإعدادات */
export interface VisitSlotSettingsDTO extends VisitSlotConfig {
  /** تاريخ آخر نسخة احتياطية ناجحة (ISO) — null إن لم تُنشأ */
  lastBackupAt: string | null
}

/** ترحيل زيارة كمهمة — POST /api/tasks (ملكية وكيل 15-b) */
export interface VisitTaskInput {
  op: 'create'
  title: string
  description: string
  dueAt: string
  customerId?: number | null
  contractId?: number | null
  source: string
}
