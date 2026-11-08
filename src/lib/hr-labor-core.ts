// ============================================================
// ConTrack Online — HR-3: نواة نقية لتكلفة العمالة على العقود
// (docs/hr-3-design.md — نقية بلا Prisma ولا React: قابلة لـ bun test)
// د1: طبقة تحليلية بلا قيود · د2: تعرفة معرفية على الموظف · د3: نسب شهرية
// د5: لقطة مجمدة · د7: سقف 100% · د8: تدقيق حقلًا-بحقل بقائمة مغلقة
// ============================================================

import { r3, monthEndDate, EMPLOYEE_FIELD_LABELS, formatEmployeeFieldValue } from "./hr-constants";

// ==================== التعرفة المعرفية (د2) ====================

/** التعرفة الشهرية الفعلية للموظف: monthlyCostRate > 0 وإلا الراتب الأساسي — لقطة لحظة الاستدعاء */
export function effectiveMonthlyRate(e: { monthlyCostRate?: number | string | null; salary?: number | string | null }): number {
  const m = Number(e.monthlyCostRate ?? 0);
  if (Number.isFinite(m) && m > 0) return r3(m);
  return r3(Math.max(0, Number(e.salary ?? 0)));
}

// ==================== مبالغ التخصيص (د3/د5) ====================

/** مبلغ سطر تخصيص = rate × share% — r3 (السالب = صفر) */
export function allocationAmountOf(rate: number, sharePercent: number): number {
  return r3(Math.max(0, Number(rate) || 0) * (Math.max(0, Number(sharePercent) || 0) / 100));
}

/** غير الموزع لموظف: التكلفة الكاملة − ∑ الأسطر — لا يُخزن أبدًا (محسوب) */
export function unallocatedOf(rate: number, amounts: number[]): number {
  const total = r3(Math.max(0, Number(rate) || 0));
  const sum = r3(amounts.reduce((a, b) => a + Math.max(0, Number(b) || 0), 0));
  return r3(Math.max(0, total - sum));
}

// ==================== سقف النسب (د7) ====================

export interface AssignmentShareRow {
  employeeId: number;
  allocationPct: number | string;
  status?: string; // سارية | منتهية — غير السارية تُستبعد
}

/** مخالفات السقف: مجموع تكليفات الموظف السارية > 100% — للرسائل العربية بالأسماء */
export function validateAssignmentShares(rows: AssignmentShareRow[]): { employeeId: number; sum: number }[] {
  const sums = new Map<number, number>();
  for (const r of rows) {
    if (r.status && r.status !== "سارية") continue;
    const pct = Number(r.allocationPct) || 0;
    if (pct <= 0) continue;
    sums.set(r.employeeId, r3((sums.get(r.employeeId) ?? 0) + pct));
  }
  const violations: { employeeId: number; sum: number }[] = [];
  for (const [employeeId, sum] of sums) {
    if (sum > 100 + 1e-9) violations.push({ employeeId, sum: r3(sum) });
  }
  return violations.sort((a, b) => a.employeeId - b.employeeId);
}

// ==================== مخطط توليد التخصيصات من التكليفات السارية ====================

export interface PlanEmployee {
  employeeId: number;
  monthlyCostRate?: number | string | null;
  salary?: number | string | null;
}

export interface PlanAssignment {
  employeeId: number;
  contractId: number;
  allocationPct: number | string;
  status: string; // سارية | منتهية
  startDate: string; // YYYY-MM-DD — فارغ = بلا بداية
  endDate: string; // YYYY-MM-DD — فارغ = بلا نهاية
}

export interface PlanRow {
  employeeId: number;
  contractId: number;
  sharePercent: number;
  rate: number; // لقطة التعرفة لحظة التوليد (Cost Snapping — د5)
  amount: number; // = rate × share% مجمّد
}

export interface AllocationPlan {
  rows: PlanRow[];
  errors: { employeeId: number; sum: number }[]; // تجاوز السقف (د7) — تُحجب كل أسطر الموظف المخالف
  skipped: number[]; // موظفو الدفعة بلا تكليفات متقاطعة — يظهرون «غير موزع»
}

/**
 * مخطط توليد تخصيصات دفعة من التكليفات السارية المتقاطعة مع الشهر (د3):
 * - التكليف يُحتسب إن كان سارية وتقاطع فترته مع الشهر (البداية ≤ آخر الشهر والنهاية ≥ أول الشهر أو فارغة).
 * - لقطة التعرفة effectiveMonthlyRate لحظة التوليد — المبلغ مجمّد عند الكتابة.
 * - موظف مجموع تكليفاته > 100% ⇒ خطأ باسمه ولا أسطر له (د7).
 */
export function buildAllocationPlan(
  employees: PlanEmployee[],
  assignments: PlanAssignment[],
  month: string // YYYY-MM
): AllocationPlan {
  const monthEnd = monthEndDate(month);
  const monthStart = /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : "";
  const rows: PlanRow[] = [];
  const skipped: number[] = [];

  // تجميع التكليفات المتقاطعة لكل موظف
  const byEmployee = new Map<number, PlanAssignment[]>();
  for (const a of assignments) {
    if (a.status !== "سارية") continue;
    const pct = Number(a.allocationPct) || 0;
    if (pct <= 0) continue;
    if (monthStart && a.startDate && a.startDate > monthEnd) continue; // تبدأ بعد الشهر
    if (monthStart && a.endDate && a.endDate < monthStart) continue; // انتهت قبله
    const list = byEmployee.get(a.employeeId) ?? [];
    list.push(a);
    byEmployee.set(a.employeeId, list);
  }

  // مخالفات السقف أولًا — الموظف المخالف يُحجب كليًا
  const allActive: AssignmentShareRow[] = [];
  for (const list of byEmployee.values()) allActive.push(...list);
  const errors = validateAssignmentShares(allActive);
  const blocked = new Set(errors.map((e) => e.employeeId));

  for (const e of employees) {
    if (blocked.has(e.employeeId)) continue;
    const list = byEmployee.get(e.employeeId) ?? [];
    if (list.length === 0) {
      skipped.push(e.employeeId);
      continue;
    }
    const rate = effectiveMonthlyRate(e);
    for (const a of list) {
      const sharePercent = r3(Number(a.allocationPct) || 0);
      rows.push({ employeeId: e.employeeId, contractId: a.contractId, sharePercent, rate, amount: allocationAmountOf(rate, sharePercent) });
    }
  }
  skipped.sort((a, b) => a - b);
  return { rows, errors, skipped };
}

// ==================== تدقيق الملف حقلًا-بحقل (د8/د9) ====================

export interface EmployeeFieldDiff {
  field: string;
  label: string;
  oldValue: string;
  newValue: string;
}

function employeeValuesDiffer(field: string, b: unknown, a: unknown): boolean {
  // الفراغ الموحد: null/undefined/"" كلها «فراغ»
  const emptyB = b == null || b === "";
  const emptyA = a == null || a === "";
  if (emptyB && emptyA) return false;
  if (emptyB !== emptyA) return true;
  if (typeof b === "boolean" || typeof a === "boolean") return Boolean(b) !== Boolean(a);
  const nb = Number(b);
  const na = Number(a);
  if (Number.isFinite(nb) && Number.isFinite(na) && String(b).trim() !== "" && String(a).trim() !== "") {
    // مقارنة عددية متسامحة (نفس عتبة EPS النظام 0.001)
    if (["salary", "dailyRate", "monthlyCostRate"].includes(field)) return Math.abs(nb - na) > 0.0005;
    return nb !== na;
  }
  return String(b).trim() !== String(a).trim();
}

/**
 * فرق حقول ملف الموظف — القائمة المغلقة فقط (د8) والحقول المرسلة فقط (نمط PATCH):
 * after يحمل القيم الخام المحلولة (المسار يحل paymentMethodId إلى رقم/null قبل النواة).
 */
export function diffEmployeeFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  ctx?: { paymentMethodNames?: Record<number, string> }
): EmployeeFieldDiff[] {
  const diffs: EmployeeFieldDiff[] = [];
  for (const field of Object.keys(EMPLOYEE_FIELD_LABELS)) {
    if (!(field in after)) continue; // لم يُرسل — لا تدقيق
    const b = before[field];
    const a = after[field];
    if (!employeeValuesDiffer(field, b, a)) continue;
    diffs.push({
      field,
      label: EMPLOYEE_FIELD_LABELS[field],
      oldValue: formatEmployeeFieldValue(field, b, ctx),
      newValue: formatEmployeeFieldValue(field, a, ctx),
    });
  }
  return diffs;
}
