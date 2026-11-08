/**
 * اختبارات نواة HR-2 — محرك المخصصات الشهري (docs/hr-2-design.md §7 — د5).
 * مخصص الإجازات: 2.5 × (الأساسي ÷ 26) · مخصص نهاية الخدمة: (نصف/كامل شهر) ÷ 12 حسب سنوات الخدمة.
 */
import { describe, expect, test } from "bun:test";
import {
  eosProvisionMonthly,
  HR_PROVISION_ACCOUNTS,
  leaveProvisionMonthly,
  PROVISION_LEAVE_ACCRUAL_DAYS,
  sumProvisions,
} from "../src/lib/hr-provision-core";

// ==================== دبابيس الحسابات ====================

describe("HR_PROVISION_ACCOUNTS — دبابيس البذر المؤجل", () => {
  test("الأكواد الثلاثة المعتمدة بالأنواع الصحيحة", () => {
    expect(HR_PROVISION_ACCOUNTS.leaveProvision.code).toBe("2161");
    expect(HR_PROVISION_ACCOUNTS.leaveProvision.type).toBe("liability");
    expect(HR_PROVISION_ACCOUNTS.eosProvision.code).toBe("2211");
    expect(HR_PROVISION_ACCOUNTS.eosProvision.type).toBe("liability");
    expect(HR_PROVISION_ACCOUNTS.eosExpense.code).toBe("5211");
    expect(HR_PROVISION_ACCOUNTS.eosExpense.type).toBe("expense");
  });

  test("كل حساب بعنصر XBRL موصول", () => {
    for (const acc of [HR_PROVISION_ACCOUNTS.leaveProvision, HR_PROVISION_ACCOUNTS.eosProvision, HR_PROVISION_ACCOUNTS.eosExpense]) {
      expect(acc.xbrl).toMatch(/^(ifrs-full|kw):[A-Za-z]+$/);
    }
  });
});

// ==================== مخصص الإجازات ====================

describe("leaveProvisionMonthly — 2.5 يوم × (÷26)", () => {
  test("راتب 900 ⇒ 2.5 × (900/26) = 86.538", () => {
    expect(leaveProvisionMonthly(900)).toBe(86.538);
  });

  test("أصفار وسلبيات آمنة", () => {
    expect(leaveProvisionMonthly(0)).toBe(0);
    expect(leaveProvisionMonthly(-5)).toBe(0);
  });

  test("المعدل الثابت 2.5 (م70)", () => {
    expect(PROVISION_LEAVE_ACCRUAL_DAYS).toBe(2.5);
  });
});

// ==================== مخصص نهاية الخدمة ====================

describe("eosProvisionMonthly — حسب سنوات الخدمة", () => {
  test("خدمة أقل من 5 سنوات ⇒ نصف شهر ÷ 12", () => {
    expect(eosProvisionMonthly(900, 3)).toBe(37.5); // 0.5×900/12
    expect(eosProvisionMonthly(900, 4.999)).toBe(37.5);
  });

  test("5 سنوات فأكثر ⇒ شهر كامل ÷ 12", () => {
    expect(eosProvisionMonthly(900, 5)).toBe(75);
    expect(eosProvisionMonthly(900, 12)).toBe(75);
  });

  test("أصفار آمنة", () => {
    expect(eosProvisionMonthly(0, 10)).toBe(0);
    expect(eosProvisionMonthly(900, 0)).toBe(37.5);
  });
});

// ==================== التجميع للقيد ====================

describe("sumProvisions — تجميع قيد الاعتماد", () => {
  test("مجموع موظفين بأجور وخدمات مختلفة", () => {
    const t = sumProvisions([
      { employeeId: 1, salary: 900, serviceYears: 3 }, // 86.538 + 37.5
      { employeeId: 2, salary: 1200, serviceYears: 7 }, // 115.385 + 100
    ]);
    expect(t.leave).toBe(201.923); // 86.538 + 115.385
    expect(t.eos).toBe(137.5); // 37.5 + 100
    expect(t.count).toBe(2);
  });

  test("بلا راتب ⇒ مستثنى من العدّ", () => {
    const t = sumProvisions([
      { employeeId: 1, salary: 0, serviceYears: 3 },
      { employeeId: 2, salary: 900, serviceYears: 3 },
    ]);
    expect(t.count).toBe(1);
    expect(t.leave).toBe(86.538);
    expect(t.eos).toBe(37.5);
  });

  test("قائمة فارغة ⇒ أصفار (الخادم يتخطى القيد)", () => {
    const t = sumProvisions([]);
    expect(t.leave).toBe(0);
    expect(t.eos).toBe(0);
    expect(t.count).toBe(0);
  });
});
