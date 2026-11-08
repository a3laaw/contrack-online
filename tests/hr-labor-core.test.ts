/**
 * اختبارات نواة HR-3 — تكلفة العمالة على العقود (docs/hr-3-design.md §4/§6 — د2/د3/د5/د7/د8).
 * التعرفة المعرفية · مبالغ التخصيص · سقف النسب · مخطط التوليد · فرق حقول الملف.
 */
import { describe, expect, test } from "bun:test";
import { EMPLOYEE_FIELD_LABELS, formatEmployeeFieldValue } from "../src/lib/hr-constants";
import {
  allocationAmountOf,
  buildAllocationPlan,
  diffEmployeeFields,
  effectiveMonthlyRate,
  unallocatedOf,
  validateAssignmentShares,
} from "../src/lib/hr-labor-core";

// ==================== التعرفة المعرفية (د2) ====================

describe("effectiveMonthlyRate — التعرفة أو الراتب", () => {
  test("monthlyCostRate > 0 يغلب الراتب", () => {
    expect(effectiveMonthlyRate({ monthlyCostRate: 850, salary: 900 })).toBe(850);
    expect(effectiveMonthlyRate({ monthlyCostRate: 1200, salary: 0 })).toBe(1200);
  });

  test("صفر/فارغ/نص ⇒ الراتب الأساسي", () => {
    expect(effectiveMonthlyRate({ monthlyCostRate: 0, salary: 900 })).toBe(900);
    expect(effectiveMonthlyRate({ monthlyCostRate: null, salary: 1200 })).toBe(1200);
    expect(effectiveMonthlyRate({ monthlyCostRate: "", salary: 750 })).toBe(750);
    expect(effectiveMonthlyRate({ monthlyCostRate: "abc", salary: 750 })).toBe(750);
  });

  test("كلاهما صفر ⇒ صفر (آمن)", () => {
    expect(effectiveMonthlyRate({ monthlyCostRate: 0, salary: 0 })).toBe(0);
    expect(effectiveMonthlyRate({})).toBe(0);
  });

  test("سلبي ⇒ يُعامل كصفر ثم يرجع للراتب", () => {
    expect(effectiveMonthlyRate({ monthlyCostRate: -5, salary: 900 })).toBe(900);
  });
});

// ==================== مبالغ التخصيص وغير الموزع (د3/د5) ====================

describe("allocationAmountOf وunallocatedOf", () => {
  test("900 × 100% = 900 · 1200 × 40% = 480", () => {
    expect(allocationAmountOf(900, 100)).toBe(900);
    expect(allocationAmountOf(1200, 40)).toBe(480);
    expect(allocationAmountOf(1200, 60)).toBe(720);
  });

  test("التقريب المالي الثلاثي", () => {
    expect(allocationAmountOf(999.999, 33.333)).toBe(333.33); // 999.999×0.33333 = 333.329… → 333.329
  });

  test("سالب النسبة أو المعدل ⇒ صفر", () => {
    expect(allocationAmountOf(900, -10)).toBe(0);
    expect(allocationAmountOf(-900, 50)).toBe(0);
  });

  test("غير الموزع: كامل − ∑ الأسطر", () => {
    expect(unallocatedOf(2100, [1380])).toBe(720);
    expect(unallocatedOf(2100, [1380, 720])).toBe(0);
    expect(unallocatedOf(900, [])).toBe(900);
  });

  test("مجموع الأسطر تجاوز التكلفة ⇒ يُقصّ عند صفر", () => {
    expect(unallocatedOf(900, [500, 600])).toBe(0);
  });
});

// ==================== سقف النسب (د7) ====================

describe("validateAssignmentShares — سقف 100%", () => {
  test("مجموع 170 ⇒ مخالفة بالموظف", () => {
    const v = validateAssignmentShares([
      { employeeId: 1, allocationPct: 100, status: "سارية" },
      { employeeId: 1, allocationPct: 70, status: "سارية" },
    ]);
    expect(v).toEqual([{ employeeId: 1, sum: 170 }]);
  });

  test("100 و40+60 ⇒ لا مخالفات", () => {
    const v = validateAssignmentShares([
      { employeeId: 1, allocationPct: 100, status: "سارية" },
      { employeeId: 2, allocationPct: 40, status: "سارية" },
      { employeeId: 2, allocationPct: 60, status: "سارية" },
    ]);
    expect(v).toEqual([]);
  });

  test("المنتهية وغير الصالحة تستبعد من المجموع", () => {
    const v = validateAssignmentShares([
      { employeeId: 1, allocationPct: 100, status: "سارية" },
      { employeeId: 1, allocationPct: 80, status: "منتهية" },
      { employeeId: 2, allocationPct: 0, status: "سارية" },
      { employeeId: 2, allocationPct: -5, status: "سارية" },
    ]);
    expect(v).toEqual([]);
  });

  test("حد 100 بالضبط ليس مخالفة (تسامح عشري)", () => {
    const v = validateAssignmentShares([
      { employeeId: 1, allocationPct: 33.33, status: "سارية" },
      { employeeId: 1, allocationPct: 33.33, status: "سارية" },
      { employeeId: 1, allocationPct: 33.34, status: "سارية" },
    ]);
    expect(v).toEqual([]);
  });
});

// ==================== مخطط التوليد (د3/د5/د7) ====================

describe("buildAllocationPlan — توليد من التكليفات السارية", () => {
  const EMPLOYEES = [
    { employeeId: 1, monthlyCostRate: 900, salary: 1000 }, // التعرفة تغلب
    { employeeId: 2, monthlyCostRate: 0, salary: 1200 }, // افتراضي الراتب
    { employeeId: 3, monthlyCostRate: 800, salary: 0 }, // بلا تكليفات
  ];
  const MONTH = "2026-11";

  test("السيناريو المعياري: 100% و40/60% وثالث متخطى", () => {
    const p = buildAllocationPlan(
      EMPLOYEES,
      [
        { employeeId: 1, contractId: 10, allocationPct: 100, status: "سارية", startDate: "", endDate: "" },
        { employeeId: 2, contractId: 10, allocationPct: 40, status: "سارية", startDate: "2026-01-01", endDate: "" },
        { employeeId: 2, contractId: 20, allocationPct: 60, status: "سارية", startDate: "", endDate: "2027-05-31" },
      ],
      MONTH
    );
    expect(p.errors).toEqual([]);
    expect(p.skipped).toEqual([3]);
    expect(p.rows).toEqual([
      { employeeId: 1, contractId: 10, sharePercent: 100, rate: 900, amount: 900 },
      { employeeId: 2, contractId: 10, sharePercent: 40, rate: 1200, amount: 480 },
      { employeeId: 2, contractId: 20, sharePercent: 60, rate: 1200, amount: 720 },
    ]);
  });

  test("تجاوز السقف ⇒ خطأ وحجب أسطر الموظف المخالف (د7)", () => {
    const p = buildAllocationPlan(
      EMPLOYEES,
      [
        { employeeId: 1, contractId: 10, allocationPct: 70, status: "سارية", startDate: "", endDate: "" },
        { employeeId: 1, contractId: 20, allocationPct: 70, status: "سارية", startDate: "", endDate: "" },
        { employeeId: 2, contractId: 10, allocationPct: 100, status: "سارية", startDate: "", endDate: "" },
      ],
      MONTH
    );
    expect(p.errors).toEqual([{ employeeId: 1, sum: 140 }]);
    expect(p.rows.every((r) => r.employeeId !== 1)).toBe(true);
    expect(p.rows).toEqual([{ employeeId: 2, contractId: 10, sharePercent: 100, rate: 1200, amount: 1200 }]);
    expect(p.skipped).toEqual([3]);
  });

  test("فلترة الفترة: تكليف يبدأ بعد الشهر أو انتهى قبله مستبعد", () => {
    const p = buildAllocationPlan(
      [{ employeeId: 1, salary: 900 }],
      [
        { employeeId: 1, contractId: 10, allocationPct: 100, status: "سارية", startDate: "2026-12-01", endDate: "" },
        { employeeId: 1, contractId: 20, allocationPct: 100, status: "سارية", startDate: "2026-01-01", endDate: "2026-10-31" },
        { employeeId: 1, contractId: 30, allocationPct: 100, status: "سارية", startDate: "2026-11-15", endDate: "" },
      ],
      MONTH
    );
    // فقط التكليف المتقاطع فعليًا مع نوفمبر (يبدأ وسط الشهر)
    expect(p.rows).toEqual([{ employeeId: 1, contractId: 30, sharePercent: 100, rate: 900, amount: 900 }]);
  });

  test("المنتهية مستبعدة حتى لو تقاطعت تواريخها", () => {
    const p = buildAllocationPlan(
      [{ employeeId: 1, salary: 900 }],
      [{ employeeId: 1, contractId: 10, allocationPct: 100, status: "منتهية", startDate: "", endDate: "" }],
      MONTH
    );
    expect(p.rows).toEqual([]);
    expect(p.skipped).toEqual([1]);
  });
});

// ==================== فرق حقول الملف (د8/د9) ====================

describe("diffEmployeeFields — القائمة المغلقة وPATCH", () => {
  const NAMES = { 3: "بنك الكويت الوطني" };

  test("تعديل الراتب: قيم منسقة قديم→جديد", () => {
    const d = diffEmployeeFields({ salary: 900 }, { salary: 1200 });
    expect(d).toEqual([{ field: "salary", label: "الراتب الشهري", oldValue: "900", newValue: "1200" }]);
  });

  test("الحالة والنوع وأساس الأجر تُنسّق عربيًا", () => {
    const d = diffEmployeeFields(
      { active: true, employeeType: "internal", paymentBasis: "monthly" },
      { active: false, employeeType: "external", paymentBasis: "daily" }
    );
    expect(d).toEqual([
      { field: "active", label: "الحالة", oldValue: "نشط", newValue: "موقوف" },
      { field: "employeeType", label: "نوع الموظف", oldValue: "داخلي", newValue: "خارجي" },
      { field: "paymentBasis", label: "أساس الأجر", oldValue: "شهري", newValue: "يومي" },
    ]);
  });

  test("وسيلة الدفع بالاسم المحلول والفراغ الموحد", () => {
    const d = diffEmployeeFields({ paymentMethodId: 3 }, { paymentMethodId: null }, { paymentMethodNames: NAMES });
    expect(d).toEqual([{ field: "paymentMethodId", label: "وسيلة الدفع", oldValue: "بنك الكويت الوطني", newValue: "فراغ" }]);
  });

  test("بدون أسماء محلولة ⇒ #معرف", () => {
    const d = diffEmployeeFields({ paymentMethodId: null }, { paymentMethodId: 7 });
    expect(d[0].newValue).toBe("#7");
  });

  test("الحقول غير المرسلة لا تُدقَّق والمتطابقة صامتة", () => {
    const d = diffEmployeeFields(
      { name: "أحمد", phone: "90000000", notes: "قديم" },
      { name: "أحمد الفهد", phone: "90000000" } // notes لم يُرسل
    );
    expect(d).toEqual([{ field: "name", label: "الاسم", oldValue: "أحمد", newValue: "أحمد الفهد" }]);
  });

  test("التسامح العددي: فرق دون 0.0005 ليس تغييرًا", () => {
    const d = diffEmployeeFields({ salary: 900 }, { salary: 900.0004 });
    expect(d).toEqual([]);
  });

  test("التكلفة الشهرية ضمن القائمة المغلقة", () => {
    expect(EMPLOYEE_FIELD_LABELS.monthlyCostRate).toBe("التكلفة الشهرية على الشركة");
    const d = diffEmployeeFields({ monthlyCostRate: 0 }, { monthlyCostRate: 850 });
    expect(d).toEqual([{ field: "monthlyCostRate", label: "التكلفة الشهرية على الشركة", oldValue: "0", newValue: "850" }]);
  });

  test("formatEmployeeFieldValue — الفراغ والقيم النصية", () => {
    expect(formatEmployeeFieldValue("phone", "")).toBe("فراغ");
    expect(formatEmployeeFieldValue("hireDate", null)).toBe("فراغ");
    expect(formatEmployeeFieldValue("department", "الحسابات")).toBe("الحسابات");
    expect(formatEmployeeFieldValue("civilId", 1234567890)).toBe("1234567890");
  });
});
