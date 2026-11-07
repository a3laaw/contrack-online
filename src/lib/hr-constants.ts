// ============================================================
// ConTrack Online — HR-1: ثوابت ونوى نقية لموديول الموارد البشرية
// (docs/hr-module-design.md — نقية بلا Prisma ولا DB: قابلة لـ bun test)
// الامتثال الكويتي: قانون العمل 6/2010 — الإجازة السنوية م70 (30 يومًا) والمرضية م66 (سلّم الشرائح)
// ============================================================

/** تقريب مالي ثلاثي — نفس اصطلاح النظام (r3) */
export function r3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

// ==================== أنواع الموظف وأسس الأجر ====================

export const EMPLOYEE_TYPES = [
  { value: "internal", label: "داخلي" },
  { value: "external", label: "خارجي" },
] as const;

export const PAYMENT_BASES = [
  { value: "monthly", label: "شهري" },
  { value: "daily", label: "يومي" },
] as const;

export const JOB_NUMBER_START = 1001; // الرقم الوظيفي الأول — توليد آلي تصاعدي

// ==================== الحضور (يدوي في HR-1 — البصمة في HR-2) ====================

export const ATTENDANCE_STATUSES = [
  { value: "present", label: "حاضر" },
  { value: "absent", label: "غياب غير مبرر" },
  { value: "justified_absent", label: "غياب مبرر" },
  { value: "leave", label: "في إجازة" },
  { value: "holiday", label: "عطلة" },
] as const;

export function attendanceLabel(status: string): string {
  return ATTENDANCE_STATUSES.find((s) => s.value === status)?.label ?? status;
}

// ==================== الإجازات: آلة الحالات ====================

/** آلة الحالات القانونية — الأنواع */
export const HR_LEAVE_TYPES = ["سنوية", "مرضية", "طارئة", "بدون راتب"] as const;

/** آلة الحالات: معلقة → معتمدة → بدأت → منتهية (والرفض من معلقة فقط بقرار موثق) */
export const HR_LEAVE_STATUSES = ["معلقة", "معتمدة", "بدأت", "منتهية", "مرفوضة"] as const;

/** الانتقالات المسموحة — نواة الآلة (الرفض من المعلقة حصرًا بقرار موثق) */
export const HR_LEAVE_TRANSITIONS: Record<string, readonly string[]> = {
  "معلقة": ["معتمدة", "مرفوضة"],
  "معتمدة": ["بدأت", "معلقة"], // رجوع للتعليق قبل البدء — قرار موثق
  "بدأت": ["منتهية"],
  "منتهية": [],
  "مرفوضة": [],
};

export function canTransitionLeave(from: string, to: string): boolean {
  return (HR_LEAVE_TRANSITIONS[from] ?? []).includes(to);
}

/** أيام الفترة شاملة الطرفين — نفس منطق consulting (validateDayPair يسبقها) */
export function leaveDaysBetween(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T00:00:00Z`).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 0;
  return Math.round((e - s) / 86_400_000) + 1;
}

// ==================== الرصيد السنوي — recount لا تخزين (درس G9) ====================

export const ANNUAL_LEAVE_PER_YEAR = 30; // م70 — قانون 6/2010
export const ANNUAL_ACCRUAL_PER_MONTH = 2.5; // 30 ÷ 12
export const PROBATION_MONTHS = 9; // لا استحقاق قبل إتمام 9 أشهر خدمة

export interface AnnualBalanceInput {
  hireDate: string; // YYYY-MM-DD — فارغ = غير معروف (يعامل كموظف قديم: استحقاق كامل)
  year: number; // سنة الاستحقاق (سنة بداية الإجازة)
  consumedApprovedDays: number; // ∑ أيام الإجازات السنوية المعتمدة/الجارية التي بدأت في هذه السنة
}

export interface AnnualBalanceResult {
  allowance: number; // الاستحقاق لهذه السنة
  consumed: number;
  balance: number; // = max(0, allowance − consumed)
  probation: boolean; // لم يُتمّ 9 أشهر بعد
}

/**
 * رصيد الإجازة السنوي محسوب دائمًا لا مخزن:
 * الأشهر الكاملة للخدمة حتى نهاية السنة × 2.5 بحد أقصى 30 — وصفر قبل إتمام 9 أشهر.
 * (تقريب موثق للسياسة: الاستحقاق الجزئي في سنة التعيين يكتمل بالأشهر الفعلية للخدمة الإجمالية.)
 */
export function recountAnnualBalance(input: AnnualBalanceInput): AnnualBalanceResult {
  const { hireDate, year, consumedApprovedDays } = input;
  let probation = false;
  let allowance = ANNUAL_LEAVE_PER_YEAR;
  if (hireDate) {
    const h = new Date(`${hireDate}T00:00:00Z`);
    const yEnd = new Date(Date.UTC(year, 11, 31));
    if (Number.isFinite(h.getTime()) && yEnd.getTime() >= h.getTime()) {
      // أشهر الخدمة الكاملة حتى نهاية السنة
      const months =
        (yEnd.getUTCFullYear() - h.getUTCFullYear()) * 12 + (yEnd.getUTCMonth() - h.getUTCMonth());
      if (months < PROBATION_MONTHS) {
        probation = true;
        allowance = 0;
      } else {
        allowance = Math.min(ANNUAL_LEAVE_PER_YEAR, Math.floor(months * ANNUAL_ACCRUAL_PER_MONTH * 100) / 100);
        if (months >= 12) allowance = ANNUAL_LEAVE_PER_YEAR;
      }
    }
  }
  const consumed = Math.max(0, consumedApprovedDays);
  return { allowance: r3(allowance), consumed: r3(consumed), balance: r3(Math.max(0, allowance - consumed)), probation };
}

// ==================== سلّم الإجازة المرضية (م66 — 6/2010) ====================

export interface SickTier {
  days: number; // حد الشريحة
  pct: number; // نسبة الأجر
  label: string;
}

/** 75 يومًا: 15 كامل + 10 بـ75% + 10 بـ50% + 10 بـ25% + 30 بلا أجر */
export const SICK_LEAVE_TIERS: SickTier[] = [
  { days: 15, pct: 100, label: "أجر كامل" },
  { days: 10, pct: 75, label: "75% من الأجر" },
  { days: 10, pct: 50, label: "50% من الأجر" },
  { days: 10, pct: 25, label: "25% من الأجر" },
  { days: 30, pct: 0, label: "بلا أجر" },
];

/**
 * شريحة الطلب الحالي انطلاقًا من ∑ أيام المرضية المستهلكة بالسنة قبله:
 * تمشي الشرائح تسلسليًا وتعيد فهرس الشريحة التي يقع فيها اليوم التالي + النسبة.
 * daysUsed ≥ مجموع الشرائح (75) ⇒ خارج السلم (فهرس -1 — تجاوز قانوني يحتذى التنبيه).
 */
export function sickTierFor(daysUsedBefore: number): { tier: number; pct: number; label: string; exhausted: boolean } {
  let remaining = Math.max(0, daysUsedBefore); // الأيام المستهلكة قبل هذا الطلب
  for (let i = 0; i < SICK_LEAVE_TIERS.length; i++) {
    const t = SICK_LEAVE_TIERS[i];
    if (remaining < t.days) return { tier: i, pct: t.pct, label: t.label, exhausted: false };
    remaining -= t.days;
  }
  return { tier: -1, pct: 0, label: "تجاوز السلّم القانوني", exhausted: true };
}

// ==================== المسير: الحساب النقي (لقطة مجمّدة) ====================

export const PAYROLL_BATCH_STATUSES = ["draft", "approved", "paid", "cancelled"] as const;
export const PAYROLL_BATCH_LABELS: Record<string, string> = {
  draft: "مسودة",
  approved: "معتمد — بانتظار الدفع",
  paid: "مدفوع",
  cancelled: "ملغى",
};

/** دخال الشهر YYYY-MM من تاريخ YYYY-MM-DD */
export function monthKeyOf(dateStr: string): string {
  return /^\d{4}-\d{2}/.test(dateStr) ? dateStr.slice(0, 7) : "";
}

/** آخر يوم في الشهر YYYY-MM */
export function monthEndDate(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return "";
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

/** صيغة العرض العربية للشهر: 2026-11 ⇒ «نوفمبر 2026» */
const MONTH_NAMES_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
export function monthLabelAr(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  return `${MONTH_NAMES_AR[Number(m[2]) - 1]} ${m[1]}`;
}

export interface PayrollCalcEmployee {
  employeeId: number;
  name: string;
  jobTitle: string;
  employeeType: "internal" | "external";
  paymentBasis: "monthly" | "daily";
  salary: number; // الأساسي الشهري
  dailyRate: number; // أجر اليوم لأساس يومي
  presentDays: number; // حاضر (HR-1: الحاضر فقط يؤسس أجر اليومي)
  unjustifiedAbsenceDays: number; // غياب غير مبرر بالشهر
  unpaidLeaveDays: number; // أيام إجازات «بدون راتب» المعتمدة المتقاطعة مع الشهر
  advanceRemaining: number; // رصيد السلف المفتوح (من الخادم — سندات PV−CV−SD)
  advancePlan?: number | null; // خطة خصم مقترحة — null/غياب = كامل الرصيد ضمن السقف
}

export interface PayrollCalcResult {
  employeeId: number;
  excluded: false;
  baseAmount: number;
  absenceDeduction: number;
  advanceDeduction: number;
  netAmount: number;
}

export interface PayrollCalcExcluded {
  employeeId: number;
  excluded: true;
  reason: string;
}

/** خطوة الحساب النقية للسجل — اللقطة تُكتب مرة ولا تُقرأ من ملف الموظف لاحقًا */
export function computePayrollRecord(e: PayrollCalcEmployee): PayrollCalcResult | PayrollCalcExcluded {
  const salary = Math.max(0, e.salary || 0);
  const dailyRate = Math.max(0, e.dailyRate || 0);
  const basis = e.paymentBasis === "daily" ? "daily" : "monthly";

  // مستثنى: بلا دخل معرّف (الخارجي يحرر الإلزامية لكنه يخرج من المسير إن كان صفرًا)
  if (basis === "monthly" && salary <= 0) {
    return { employeeId: e.employeeId, excluded: true, reason: "بلا راتب شهري معرّف" };
  }
  if (basis === "daily" && dailyRate <= 0) {
    return { employeeId: e.employeeId, excluded: true, reason: "بلا أجر يومي معرّف" };
  }

  let baseAmount: number;
  let absenceDeduction = 0;
  if (basis === "monthly") {
    baseAmount = r3(salary);
    const deductionDays = Math.max(0, e.unjustifiedAbsenceDays || 0) + Math.max(0, e.unpaidLeaveDays || 0);
    absenceDeduction = r3((deductionDays * salary) / 30);
    if (absenceDeduction > baseAmount) absenceDeduction = baseAmount;
  } else {
    // اليومي: الأجر بمنزلة الحضور — الغياب يعني بلا أجر أصلًا
    baseAmount = r3(dailyRate * Math.max(0, e.presentDays || 0));
  }

  const capForAdvance = r3(Math.max(0, baseAmount - absenceDeduction));
  const remaining = Math.max(0, e.advanceRemaining || 0);
  let advanceDeduction = e.advancePlan == null ? remaining : Math.max(0, Number(e.advancePlan) || 0);
  advanceDeduction = r3(Math.min(advanceDeduction, remaining, capForAdvance));

  const netAmount = r3(Math.max(0, capForAdvance - advanceDeduction));
  return { employeeId: e.employeeId, excluded: false, baseAmount, absenceDeduction, advanceDeduction, netAmount };
}

/** تجميعات الدفعة من سجلات محسوبة */
export function sumPayrollRecords(records: PayrollCalcResult[]): {
  grossTotal: number;
  deductionTotal: number;
  advanceTotal: number;
  netTotal: number;
} {
  let grossTotal = 0;
  let deductionTotal = 0;
  let advanceTotal = 0;
  let netTotal = 0;
  for (const r of records) {
    grossTotal += r.baseAmount;
    deductionTotal += r.absenceDeduction;
    advanceTotal += r.advanceDeduction;
    netTotal += r.netAmount;
  }
  return { grossTotal: r3(grossTotal), deductionTotal: r3(deductionTotal), advanceTotal: r3(advanceTotal), netTotal: r3(netTotal) };
}

/**
 * أيام إجازة متقاطعة مع شهر مسير — لاحتساب «بدون راتب»:
 * تعيد تقاطع [start,end] مع [first,last] بالأيام (شاملة الطرفين).
 */
export function overlapDaysInMonth(start: string, end: string, first: string, last: string): number {
  const s = start > first ? start : first;
  const e = end < last ? end : last;
  return leaveDaysBetween(s, e);
}
