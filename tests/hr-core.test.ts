/**
 * اختبارات نواة HR — الموارد البشرية — bun test.
 * HR-1: الرصيد السنوي (recount) · آلة حالات الإجازة · سلّم المرضية · حساب المسير والخصومات.
 * HR-2: جدول الدوام والدقائق · الخصم الدقائقي · المرضية الفعلية · الدمج بالمسير.
 */
import { describe, expect, test } from "bun:test";
import {
  ANNUAL_LEAVE_PER_YEAR,
  canTransitionLeave,
  computePayrollRecord,
  lateDeductionFor,
  leaveDaysBetween,
  minuteRateOf,
  monthEndDate,
  monthKeyOf,
  monthLabelAr,
  netChargeableMinutes,
  overlapDaysInMonth,
  PayrollCalcEmployee,
  recountAnnualBalance,
  r3,
  scheduleMinutesFromPunches,
  sickDeductionFor,
  sickTierFor,
  sumPayrollRecords,
  workHoursOfSchedule,
  SICK_LEAVE_TIERS,
} from "../src/lib/hr-constants";

// ==================== الرصيد السنوي ====================

describe("رصيد الإجازة السنوي — recount", () => {
  test("موظف قديم (بلا تاريخ تعيين) = استحقاق كامل 30", () => {
    const b = recountAnnualBalance({ hireDate: "", year: 2026, consumedApprovedDays: 0 });
    expect(b.allowance).toBe(ANNUAL_LEAVE_PER_YEAR);
    expect(b.balance).toBe(30);
    expect(b.probation).toBe(false);
  });

  test("خدمة أقل من 9 أشهر = صفر وفترة تجربة", () => {
    // تعيين 2026-06-01 حتى نهاية 2026 = 7 أشهر
    const b = recountAnnualBalance({ hireDate: "2026-06-01", year: 2026, consumedApprovedDays: 0 });
    expect(b.probation).toBe(true);
    expect(b.allowance).toBe(0);
    expect(b.balance).toBe(0);
  });

  test("أشهر الخدمة × 2.5 بحد أقصى 30", () => {
    // تعيين 2024-07-01 حتى نهاية 2026 = 30 شهرًا ⇒ 75 ⇒ سقف 30
    const b = recountAnnualBalance({ hireDate: "2024-07-01", year: 2026, consumedApprovedDays: 8 });
    expect(b.allowance).toBe(30);
    expect(b.balance).toBe(22);
  });

  test("استحقاق جزئي في سنة التعيين بعد تجاوز 9 أشهر", () => {
    // تعيين 2025-01-15 حتى نهاية 2025 = 11 شهرًا ⇒ 27.5
    const b = recountAnnualBalance({ hireDate: "2025-01-15", year: 2025, consumedApprovedDays: 2 });
    expect(b.allowance).toBe(27.5);
    expect(b.balance).toBe(25.5);
  });

  test("الاستهلاك الزائد لا يجعل الرصيد سالبًا", () => {
    const b = recountAnnualBalance({ hireDate: "2020-01-01", year: 2026, consumedApprovedDays: 40 });
    expect(b.balance).toBe(0);
    expect(b.consumed).toBe(40);
  });
});

// ==================== آلة الحالات ====================

describe("آلة حالات الإجازة", () => {
  test("المعلقة تقبل الاعتماد والرفض فقط", () => {
    expect(canTransitionLeave("معلقة", "معتمدة")).toBe(true);
    expect(canTransitionLeave("معلقة", "مرفوضة")).toBe(true);
    expect(canTransitionLeave("معلقة", "بدأت")).toBe(false);
    expect(canTransitionLeave("معلقة", "منتهية")).toBe(false);
  });

  test("المعتمدة تبدأ أو تعلق (قبل البدء) — والبدأة تنتهي ولا ترجع", () => {
    expect(canTransitionLeave("معتمدة", "بدأت")).toBe(true);
    expect(canTransitionLeave("معتمدة", "معلقة")).toBe(true);
    expect(canTransitionLeave("بدأت", "منتهية")).toBe(true);
    expect(canTransitionLeave("بدأت", "معلقة")).toBe(false);
    expect(canTransitionLeave("منتهية", "معلقة")).toBe(false);
  });

  test("المرفوضة حجرة نهائية", () => {
    expect(canTransitionLeave("مرفوضة", "معلقة")).toBe(false);
    expect(canTransitionLeave("مرفوضة", "معتمدة")).toBe(false);
  });

  test("الأيام شاملة الطرفين", () => {
    expect(leaveDaysBetween("2026-11-01", "2026-11-01")).toBe(1);
    expect(leaveDaysBetween("2026-11-01", "2026-11-08")).toBe(8);
    expect(leaveDaysBetween("2026-11-08", "2026-11-01")).toBe(0);
  });
});

// ==================== سلّم المرضية ====================

describe("سلّم الإجازة المرضية (م66)", () => {
  test("الشرائح الخمس = 75 يومًا", () => {
    expect(SICK_LEAVE_TIERS.reduce((a, t) => a + t.days, 0)).toBe(75);
  });

  test("أول 15 يومًا أجر كامل ثم 75%", () => {
    expect(sickTierFor(0).tier).toBe(0);
    expect(sickTierFor(0).pct).toBe(100);
    expect(sickTierFor(14).tier).toBe(0);
    expect(sickTierFor(15).tier).toBe(1);
    expect(sickTierFor(15).pct).toBe(75);
  });

  test("منتصف الشرائح اللاحقة", () => {
    expect(sickTierFor(25).tier).toBe(2); // الشريحة الثانية تنتهي باليوم 25 ⇒ اليوم 26 شريحة 2 (50%)
    expect(sickTierFor(26).tier).toBe(2);
    expect(sickTierFor(36).tier).toBe(3);
    expect(sickTierFor(46).tier).toBe(4);
    expect(sickTierFor(46).pct).toBe(0);
  });

  test("تجاوز 75 يومًا = خارج السلم", () => {
    const t = sickTierFor(75);
    expect(t.exhausted).toBe(true);
    expect(t.tier).toBe(-1);
  });
});

// ==================== حساب المسير ====================

function emp(over: Partial<PayrollCalcEmployee>): PayrollCalcEmployee {
  return {
    employeeId: 1,
    name: "موظف تجربة",
    jobTitle: "محاسب",
    employeeType: "internal",
    paymentBasis: "monthly",
    salary: 900,
    dailyRate: 0,
    presentDays: 0,
    unjustifiedAbsenceDays: 0,
    unpaidLeaveDays: 0,
    advanceRemaining: 0,
    ...over,
  };
}

describe("حساب سجل المسير", () => {
  test("شهري كامل بلا خصومات", () => {
    const r = computePayrollRecord(emp({}));
    expect(r.excluded).toBe(false);
    if (!r.excluded) {
      expect(r.baseAmount).toBe(900);
      expect(r.absenceDeduction).toBe(0);
      expect(r.advanceDeduction).toBe(0);
      expect(r.netAmount).toBe(900);
    }
  });

  test("خصم الغياب غير المبرر = الأيام × الأساسي/30", () => {
    const r = computePayrollRecord(emp({ unjustifiedAbsenceDays: 3 }));
    if (!r.excluded) {
      expect(r.absenceDeduction).toBe(90); // 3 × 900/30
      expect(r.netAmount).toBe(810);
    }
  });

  test("بدون راتب يدخل الخصم نفسه", () => {
    const r = computePayrollRecord(emp({ unjustifiedAbsenceDays: 1, unpaidLeaveDays: 2 }));
    if (!r.excluded) expect(r.absenceDeduction).toBe(90); // 3 أيام فعلًا
  });

  test("السلف: افتراضيًا كامل الرصيد ضمن السقف", () => {
    const r = computePayrollRecord(emp({ advanceRemaining: 200 }));
    if (!r.excluded) {
      expect(r.advanceDeduction).toBe(200);
      expect(r.netAmount).toBe(700);
    }
  });

  test("السلف لا تتجاوز الصافي ولا الرصيد", () => {
    const r = computePayrollRecord(emp({ advanceRemaining: 5000, unjustifiedAbsenceDays: 3 }));
    if (!r.excluded) {
      expect(r.advanceDeduction).toBe(810); // سقف الصافي بعد خصم الغياب
      expect(r.netAmount).toBe(0);
    }
    const r2 = computePayrollRecord(emp({ advanceRemaining: 5000, advancePlan: 100 }));
    if (!r2.excluded) expect(r2.advanceDeduction).toBe(100);
  });

  test("خطة خصم سالبة تُقص إلى صفر", () => {
    const r = computePayrollRecord(emp({ advanceRemaining: 300, advancePlan: -50 }));
    if (!r.excluded) expect(r.advanceDeduction).toBe(0);
  });

  test("اليومي: الأجر = العميل × أيام الحضور والغياب بلا خصم إضافي", () => {
    const r = computePayrollRecord(emp({ paymentBasis: "daily", salary: 0, dailyRate: 30, presentDays: 20, unjustifiedAbsenceDays: 2 }));
    if (!r.excluded) {
      expect(r.baseAmount).toBe(600);
      expect(r.absenceDeduction).toBe(0);
      expect(r.netAmount).toBe(600);
    }
  });

  test("اليومي بلا أجر معرّف مستثنى", () => {
    const r = computePayrollRecord(emp({ paymentBasis: "daily", salary: 0, dailyRate: 0 }));
    expect(r.excluded).toBe(true);
  });

  test("الشهري بلا راتب مستثنى (الخارجي أيضًا)", () => {
    expect(computePayrollRecord(emp({ salary: 0 })).excluded).toBe(true);
    expect(computePayrollRecord(emp({ salary: 0, employeeType: "external" })).excluded).toBe(true);
  });
});

describe("تجميعات الدفعة والشهور", () => {
  test("تجميع الدفعة", () => {
    const a = computePayrollRecord(emp({})) as { excluded: false; baseAmount: number; absenceDeduction: number; advanceDeduction: number; netAmount: number };
    const b = computePayrollRecord(emp({ employeeId: 2, salary: 300, advanceRemaining: 50 })) as typeof a;
    const s = sumPayrollRecords([a, b]);
    expect(s.grossTotal).toBe(1200);
    expect(s.advanceTotal).toBe(50);
    expect(s.netTotal).toBe(1150);
  });

  test("أدوات الشهر", () => {
    expect(monthKeyOf("2026-11-07")).toBe("2026-11");
    expect(monthEndDate("2026-11")).toBe("2026-11-30");
    expect(monthEndDate("2024-02")).toBe("2024-02-29");
    expect(monthLabelAr("2026-11")).toBe("نوفمبر 2026");
  });

  test("تقاطع الإجازة مع الشهر", () => {
    expect(overlapDaysInMonth("2026-10-28", "2026-11-03", "2026-11-01", "2026-11-30")).toBe(3);
    expect(overlapDaysInMonth("2026-11-10", "2026-11-12", "2026-11-01", "2026-11-30")).toBe(3);
    expect(overlapDaysInMonth("2026-12-01", "2026-12-05", "2026-11-01", "2026-11-30")).toBe(0);
  });

  test("r3 التقريب الثلاثي", () => {
    expect(r3(1.0005)).toBe(1.001);
    expect(r3(2.675)).toBe(2.675);
  });
});

// ==================== HR-2 — جدول الدوام والدقائق والمرضية الفعلية ====================

describe("HR-2 — دقائق البصمات مقابل جدول الدوام", () => {
  const schedule = { start: "08:00", end: "17:00", graceMinutes: 15 };

  test("دخول بعد السماحية ⇒ تأخير بالدقائق", () => {
    const m = scheduleMinutesFromPunches("08:40", "17:00", schedule);
    expect(m.late).toBe(25); // 08:40 − (08:00+15)
    expect(m.early).toBe(0);
  });

  test("دخول داخل السماحية ⇒ صفر", () => {
    expect(scheduleMinutesFromPunches("08:15", "17:00", schedule).late).toBe(0);
  });

  test("انصراف مبكر بعد السماحية ⇒ دقائق", () => {
    const m = scheduleMinutesFromPunches("08:00", "16:20", schedule);
    expect(m.early).toBe(25); // (17:00−15) − 16:20
    expect(m.late).toBe(0);
  });

  test("بصمة ناقصة ⇒ صفر (التصحيح يدوي)", () => {
    expect(scheduleMinutesFromPunches("", "17:00", schedule).late).toBe(0);
    expect(scheduleMinutesFromPunches("08:00", "", schedule).early).toBe(0);
  });

  test("جدول باطل ⇒ صفر (أمان)", () => {
    const bad = { start: "17:00", end: "08:00", graceMinutes: 15 };
    expect(scheduleMinutesFromPunches("09:00", "16:00", bad)).toEqual({ late: 0, early: 0 });
  });

  test("ساعات اليوم من الجدول + الأمان", () => {
    expect(workHoursOfSchedule(schedule)).toBe(9);
    expect(workHoursOfSchedule(null)).toBe(8);
    expect(workHoursOfSchedule({ start: "باطل", end: "17:00", graceMinutes: 0 })).toBe(8);
  });
});

describe("HR-2 — الخصم الدقائقي (د3)", () => {
  test("معدل الدقيقة = الأساسي ÷ (30 × ساعات اليوم)", () => {
    expect(minuteRateOf(900, 9)).toBeCloseTo(900 / 270);
  });

  test("الخصم = الدقائق × المعدل", () => {
    // 60 دقيقة × (900/270) = 200
    expect(lateDeductionFor(900, 9, 60)).toBe(200);
  });

  test("الإعفاء يقلل القابل للخصم ولا يجعله سالبًا", () => {
    expect(netChargeableMinutes(40, 60)).toBe(0);
    expect(netChargeableMinutes(70, 30)).toBe(40);
    expect(netChargeableMinutes(-5, 0)).toBe(0);
  });

  test("اليومي يخرج صفرًا من computePayrollRecord حتى مع دقائق", () => {
    const r = computePayrollRecord({
      employeeId: 1, name: "س", jobTitle: "", employeeType: "internal",
      paymentBasis: "daily", salary: 0, dailyRate: 30,
      presentDays: 20, unjustifiedAbsenceDays: 0, unpaidLeaveDays: 0,
      advanceRemaining: 0, lateDeduction: 500,
    }) as { lateDeduction: number; sickDeduction: number };
    expect(r.lateDeduction).toBe(0);
    expect(r.sickDeduction).toBe(0);
  });
});

describe("HR-2 — الخصم المرضي الفعلي (شرائح م66)", () => {
  test("الشريحة الثانية (75%) تخصم ربع قيمة اليوم لكل يوم", () => {
    // 10 أيام × (900/30) × 25% = 75
    expect(sickDeductionFor(900, [{ tier: 1, days: 10 }])).toBe(75);
  });

  test("الشريحة الأولى كاملة الأجر ⇒ صفر", () => {
    expect(sickDeductionFor(900, [{ tier: 0, days: 15 }])).toBe(0);
  });

  test("الشرائح تتجمّع: ثانية + ثالثة", () => {
    // 10×(900/30)×25% + 10×(900/30)×50% = 75 + 150
    expect(sickDeductionFor(900, [{ tier: 1, days: 10 }, { tier: 2, days: 10 }])).toBe(225);
  });

  test("شريحة null (لقطات HR-1 القديمة) = كامل الأجر ⇒ صفر", () => {
    expect(sickDeductionFor(900, [{ tier: null, days: 5 }])).toBe(0);
  });

  test("شريحة خارج السلّم (−1 تجاوز قانوني) تعامل بلا أجر ⇒ خصم كامل", () => {
    // tier −1 ⇒ pct 0 ⇒ (1−0) = كامل قيمة اليوم
    expect(sickDeductionFor(900, [{ tier: -1, days: 2 }])).toBe(60);
  });
});

describe("HR-2 — المسير يدمج المرضية والدقائق في الصافي", () => {
  test("السقف للسلف يخصم المرضية والتأخير قبل السلف", () => {
    const r = computePayrollRecord({
      employeeId: 1, name: "س", jobTitle: "", employeeType: "internal",
      paymentBasis: "monthly", salary: 900, dailyRate: 0,
      presentDays: 0, unjustifiedAbsenceDays: 0, unpaidLeaveDays: 0,
      advanceRemaining: 100, sickDeduction: 75, lateDeduction: 25,
    }) as { advanceDeduction: number; netAmount: number };
    // earned = 900 − 75 − 25 = 800 ⇒ سقف السلف 800 ⇒ تخصم 100 كاملة
    expect(r.advanceDeduction).toBe(100);
    expect(r.netAmount).toBe(700);
  });

  test("deductionTotal يتضمن المرضية والتأخير", () => {
    const a = computePayrollRecord({
      employeeId: 1, name: "أ", jobTitle: "", employeeType: "internal",
      paymentBasis: "monthly", salary: 900, dailyRate: 0,
      presentDays: 0, unjustifiedAbsenceDays: 0, unpaidLeaveDays: 0,
      advanceRemaining: 0, sickDeduction: 75, lateDeduction: 25,
    }) as { baseAmount: number; absenceDeduction: number; sickDeduction: number; lateDeduction: number; advanceDeduction: number; netAmount: number };
    const b = computePayrollRecord({
      employeeId: 2, name: "س", jobTitle: "", employeeType: "internal",
      paymentBasis: "monthly", salary: 300, dailyRate: 0,
      presentDays: 0, unjustifiedAbsenceDays: 0, unpaidLeaveDays: 0,
      advanceRemaining: 50, sickDeduction: 0, lateDeduction: 0,
    }) as typeof a;
    const s = sumPayrollRecords([a, b]);
    expect(s.deductionTotal).toBe(100); // 75+25 + 0
    expect(s.netTotal).toBe(1050); // 800 + (300−50)
  });
});
