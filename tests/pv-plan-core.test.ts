/**
 * اختبارات نواة ب2 «محرك PV المخطط» — docs/schedule-import-design.md §12.
 * الاستحقاق الخطي داخل النافذة (أيام شاملة) · خطوة النهاية للناقصة البداية ·
 * الدلاء الشهرية بأشهر الصفر المعلنة · التراكمي والخريطة لنهايات الأشهر ·
 * القواعد المحفوظة من ج2 (بلا نافذة خارج PV · قيمة ≤ 0 صفر).
 */
import { describe, expect, test } from "bun:test";

import {
  accrueLinear,
  derivePvPlan,
  monthEnd,
  monthOverlapDays,
  nextMonth,
  type PvPlanRow,
  type PvPlanWindow,
} from "../src/lib/pv-plan-core";

const row = (over: Partial<PvPlanRow>): PvPlanRow => ({
  boqItemId: 1,
  divisionCode: "03",
  divisionName: "CONCRETE",
  contractQty: 100,
  unitPrice: 50,
  ...over,
});

const plan = (over: Partial<PvPlanWindow>): PvPlanWindow => ({
  boqItemId: 1,
  plannedStart: "2026-01-01",
  plannedFinish: "2026-01-31",
  ...over,
});

describe("accrueLinear — الاستحقاق الخطي", () => {
  test("اليوم الأول من النافذة يستحق حصة يوم واحد شاملًا", () => {
    // نافذة 10 أيام شاملة (01→10) — أول يوم = 1000×1/10
    expect(accrueLinear(1000, "2026-01-01", "2026-01-10", "2026-01-01")).toBe(100);
  });
  test("منتصف النافذة استحقاق نسبي بدقة r3", () => {
    // نافذة 11 يومًا (01→11) — السادس = 1000×6/11
    expect(accrueLinear(1000, "2026-01-01", "2026-01-11", "2026-01-06")).toBe(545.455);
  });
  test("قبل البداية صفر", () => {
    expect(accrueLinear(1000, "2026-01-01", "2026-01-11", "2025-12-31")).toBe(0);
  });
  test("عند النهاية ومن بعدها كامل", () => {
    expect(accrueLinear(1000, "2026-01-01", "2026-01-11", "2026-01-11")).toBe(1000);
    expect(accrueLinear(1000, "2026-01-01", "2026-01-11", "2026-02-01")).toBe(1000);
  });
  test("بلا بداية ⇒ خطوة عند النهاية (توافق خلفي ج2)", () => {
    expect(accrueLinear(1000, "", "2026-03-01", "2026-02-28")).toBe(0);
    expect(accrueLinear(1000, "", "2026-03-01", "2026-03-01")).toBe(1000);
  });
  test("بلا نافذة نهائيًا ⇒ صفر دائمًا (خارج PV)", () => {
    expect(accrueLinear(1000, "", "", "2026-01-01")).toBe(0);
    expect(accrueLinear(1000, "2026-01-01", "", "2026-02-01")).toBe(0);
  });
  test("قيمة ≤ 0 ⇒ صفر ونافذة يوم واحد كاملة", () => {
    expect(accrueLinear(0, "2026-01-01", "2026-01-10", "2026-01-05")).toBe(0);
    expect(accrueLinear(-500, "2026-01-01", "2026-01-10", "2026-01-05")).toBe(0);
    expect(accrueLinear(1000, "2026-01-05", "2026-01-05", "2026-01-05")).toBe(1000);
  });
});

describe("أدوات الأشهر", () => {
  test("monthEnd — آخر يوم بالشهر (كبيس يشمل فبراير 29)", () => {
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(monthEnd("2024-02")).toBe("2024-02-29");
    expect(monthEnd("2026-12")).toBe("2026-12-31");
    expect(monthEnd("باطل")).toBe("");
  });
  test("nextMonth — عبور السنة", () => {
    expect(nextMonth("2026-01")).toBe("2026-02");
    expect(nextMonth("2026-12")).toBe("2027-01");
    expect(nextMonth("باطل")).toBe("");
  });
  test("monthOverlapDays — كامل داخل الشهر وعابر لشهرين وخارجه", () => {
    expect(monthOverlapDays("2026-01-05", "2026-01-09", "2026-01")).toBe(5);
    expect(monthOverlapDays("2026-01-25", "2026-02-05", "2026-01")).toBe(7); // 25..31
    expect(monthOverlapDays("2026-01-25", "2026-02-05", "2026-02")).toBe(5); // 01..05
    expect(monthOverlapDays("2026-01-25", "2026-02-05", "2026-03")).toBe(0);
    expect(monthOverlapDays("", "", "2026-01")).toBe(0);
  });
});

describe("derivePvPlan — المحرك الكامل", () => {
  // بند1: 100×50=5000 بنافذة يناير (31 يومًا) · بند2: 10×100=1000 بنافذة 02-10→02-20 (11 يومًا) · بند3 بلا نافذة
  const rows = [
    row({ boqItemId: 1, contractQty: 100, unitPrice: 50 }),
    row({ boqItemId: 2, divisionCode: "04", divisionName: "MASONRY", contractQty: 10, unitPrice: 100 }),
    row({ boqItemId: 3, contractQty: 5, unitPrice: 100 }),
  ];
  const plans = [
    plan({ boqItemId: 1 }),
    plan({ boqItemId: 2, plannedStart: "2026-02-10", plannedFinish: "2026-02-20" }),
    plan({ boqItemId: 3, plannedStart: "", plannedFinish: "" }),
  ];

  test("pv = Σ الاستحقاق حتى اليوم — البعد النافذته مستبعد", () => {
    // 5000×16/31 = 2580.645 — بند2 لم تبدأ نافذته وبند3 بلا نافذة
    const r = derivePvPlan(rows, plans, "2026-01-16");
    expect(r.pv).toBe(2580.645);
  });
  test("الدلاء الشهرية توزع القيمة كاملة وبتداخل صحيح", () => {
    const r = derivePvPlan(rows, plans, "2026-01-16");
    expect(r.byMonth).toHaveLength(2);
    expect(r.byMonth[0]).toEqual({ month: "2026-01", planned: 5000, plannedCum: 5000 });
    expect(r.byMonth[1]).toEqual({ month: "2026-02", planned: 1000, plannedCum: 6000 });
  });
  test("الخريطة لنهايات الأشهر بمفتاح نهاية الشهر الفعلي", () => {
    const r = derivePvPlan(rows, plans, "2026-01-16");
    expect(r.plannedByMonthEnd.get("2026-01-31")).toBe(5000);
    expect(r.plannedByMonthEnd.get("2026-02-28")).toBe(1000);
    expect(r.plannedByMonthEnd.size).toBe(2);
  });
  test("التراكمي رتيب صاعد وأخيره = مجموع القيم", () => {
    const r = derivePvPlan(rows, plans, "2026-06-30");
    for (let i = 1; i < r.byMonth.length; i++) {
      expect(r.byMonth[i].plannedCum).toBeGreaterThanOrEqual(r.byMonth[i - 1].plannedCum);
    }
    expect(r.byMonth[r.byMonth.length - 1].plannedCum).toBe(6000);
    expect(r.pv).toBe(6000); // اليوم بعد كل النوافذ ⇒ pv كامل
  });
  test("شهر الفجوة معلن بصفر ولا يدخل الخريطة", () => {
    const gapRows = [row({ boqItemId: 1, contractQty: 10, unitPrice: 10 })];
    const gapPlans = [plan({ boqItemId: 1, plannedStart: "2026-01-01", plannedFinish: "2026-01-05" })];
    gapPlans.push(plan({ boqItemId: 2, plannedStart: "2026-03-01", plannedFinish: "2026-03-05" }));
    gapRows.push(row({ boqItemId: 2, contractQty: 10, unitPrice: 10 }));
    const r = derivePvPlan(gapRows, gapPlans, "2026-06-01");
    expect(r.byMonth.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(r.byMonth[1].planned).toBe(0);
    expect(r.plannedByMonthEnd.size).toBe(2);
    expect(r.byMonth[2].plannedCum).toBe(200);
  });
  test("خطوة النهاية للناقصة البداية: كامل القيمة بشهر نهايتها", () => {
    const stepRows = [row({ boqItemId: 9, contractQty: 3, unitPrice: 100 })];
    const stepPlans = [plan({ boqItemId: 9, plannedStart: "", plannedFinish: "2026-01-15" })];
    const r = derivePvPlan(stepRows, stepPlans, "2026-01-10");
    expect(r.pv).toBe(0); // قبل النهاية ⇒ الخطوة لم تنقلب
    expect(r.byMonth).toEqual([{ month: "2026-01", planned: 300, plannedCum: 300 }]);
  });
  test("التاريخي قبل كل النوافذ: pv صفر والدلاء كاملة (المخطط مستقبلي مرئي)", () => {
    const r = derivePvPlan(rows, plans, "2025-12-31");
    expect(r.pv).toBe(0);
    expect(r.byMonth).toHaveLength(2);
    expect(r.byMonth[0].planned).toBe(5000);
  });
  test("بلا بنود بنافذة ⇒ pv صفر وبلا دلاء", () => {
    const r = derivePvPlan([row({ boqItemId: 5, contractQty: 10, unitPrice: 10 })], [], "2026-01-01");
    expect(r.pv).toBe(0);
    expect(r.byMonth).toEqual([]);
    expect(r.plannedByMonthEnd.size).toBe(0);
  });
  test("قيمة صفرية لا تفتح نطاق أشهر ولا تساهم", () => {
    const r = derivePvPlan(
      [row({ boqItemId: 6, contractQty: 0, unitPrice: 100 })],
      [plan({ boqItemId: 6 })],
      "2026-01-01"
    );
    expect(r.pv).toBe(0);
    expect(r.byMonth).toEqual([]);
  });
});
