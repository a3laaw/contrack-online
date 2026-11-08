/**
 * اختبارات نواة HR-2 — حاسبة نهاية الخدمة (قانون العمل الكويتي 6/2010 — م41/44/51/53).
 * docs/hr-2-design.md §6 — د4: نصف شهر أول 5 سنوات + شهر كامل بعدها + كسر السنة + سقف 18 شهرًا.
 */
import { describe, expect, test } from "bun:test";
import {
  computeEos,
  EOS_CAP_MONTHS,
  EOS_SCENARIOS,
  eosCapApplied,
  eosFullGratuity,
  eosScenarioByValue,
  eosServiceYears,
  resignationFraction,
} from "../src/lib/hr-eos-core";

// ==================== سنوات الخدمة ====================

describe("eosServiceYears — سنوات الخدمة", () => {
  test("سنة كاملة بالضبط (365 يومًا — سنة غير كبيسة)", () => {
    expect(eosServiceYears("2021-01-01", "2022-01-01")).toBe(1);
  });

  test("كسر السنة بالنسبة (سنة غير كبيسة: 181 يومًا ≈ 0.496)", () => {
    expect(eosServiceYears("2021-01-01", "2022-07-01")).toBe(1.496);
  });

  test("تاريخ نهاية قبل البداية ⇒ صفر", () => {
    expect(eosServiceYears("2020-06-01", "2020-01-01")).toBe(0);
  });

  test("تاريخ فارغ أو غير صالح ⇒ صفر", () => {
    expect(eosServiceYears("", "2026-01-01")).toBe(0);
    expect(eosServiceYears("باطل", "2026-01-01")).toBe(0);
  });

  test("6 سنوات و10 أشهر ≈ 6.86", () => {
    const y = eosServiceYears("2021-01-01", "2027-11-08");
    expect(y).toBeGreaterThan(6.8);
    expect(y).toBeLessThan(6.9);
  });
});

// ==================== المكافأة الكاملة م53 ====================

describe("eosFullGratuity — صيغة م53 (د4)", () => {
  test("سنتان خدمة = شهر واحد كامل (نصف × 2)", () => {
    expect(eosFullGratuity(900, 2)).toBe(900);
  });

  test("خمس سنوات بالضبط = 2.5 شهر", () => {
    expect(eosFullGratuity(900, 5)).toBe(2250);
  });

  test("6 سنوات = 2.5 + 1 = 3.5 شهر", () => {
    expect(eosFullGratuity(900, 6)).toBe(3150);
  });

  test("كسر السنة بالنسبة: 5.5 سنة = 2.5 + 0.5 = 3 أشهر", () => {
    expect(eosFullGratuity(900, 5.5)).toBe(2700);
  });

  test("سقف 18 شهرًا: 30 سنة تُحصر", () => {
    const raw = 2.5 * 900 + 25 * 900; // 27.5 شهر
    expect(raw).toBeGreaterThan(EOS_CAP_MONTHS * 900);
    expect(eosFullGratuity(900, 30)).toBe(EOS_CAP_MONTHS * 900);
    expect(eosCapApplied(900, 30)).toBe(true);
  });

  test("لا سقف تحت الحد", () => {
    expect(eosCapApplied(900, 6)).toBe(false);
  });
});

// ==================== سلالم الاستقالة م51 ====================

describe("resignationFraction — سلالم م51", () => {
  test("أقل من 3 سنوات ⇒ صفر", () => {
    expect(resignationFraction(2.999)).toBe(0);
  });

  test("3 سنوات ⇒ الثلث", () => {
    expect(resignationFraction(3)).toBeCloseTo(1 / 3);
  });

  test("أقل من 5 بقليل ⇒ الثلث", () => {
    expect(resignationFraction(4.99)).toBeCloseTo(1 / 3);
  });

  test("5 سنوات ⇒ الثلثان", () => {
    expect(resignationFraction(5)).toBeCloseTo(2 / 3);
  });

  test("أقل من 10 بقليل ⇒ الثلثان", () => {
    expect(resignationFraction(9.9)).toBeCloseTo(2 / 3);
  });

  test("10 سنوات ⇒ الكامل", () => {
    expect(resignationFraction(10)).toBe(1);
    expect(resignationFraction(15)).toBe(1);
  });
});

// ==================== الحساب الموحد computeEos ====================

describe("computeEos — السيناريوهات", () => {
  const base = { wage: 900, hireDate: "2020-01-01", endDate: "2026-11-08", leaveBalanceDays: 12.5 };

  test("انتهاء عقد (6.86 سنة) ⇒ كامل = 2.5 + 1.86 شهر", () => {
    const r = computeEos({ ...base, scenario: "انتهاء عقد" });
    expect(r.fractionApplied).toBe(1);
    // first 5y: 2.5×900=2250 + 1.86×900 — total years ≈ 6.858 → rest ≈ 1.858×900
    expect(r.gratuity).toBeGreaterThan(3800);
    expect(r.gratuity).toBeLessThan(4000);
    expect(r.capped).toBe(false);
    // بدل الإجازات: 12.5 × (900/26)
    expect(r.leaveEncashment).toBe(432.692);
    expect(r.total).toBe(r3add(r.gratuity, r.leaveEncashment));
  });

  test("استقالة بعد 6.86 سنة ⇒ الثلثان", () => {
    const r = computeEos({ ...base, scenario: "استقالة" });
    expect(r.fractionApplied).toBeCloseTo(2 / 3);
    const full = eosFullGratuity(900, r.years);
    expect(r.gratuity).toBe(Math.round(full * (2 / 3) * 1000) / 1000);
  });

  test("استقالة قبل 3 سنوات ⇒ صفر", () => {
    const r = computeEos({ wage: 900, hireDate: "2024-06-01", endDate: "2026-05-01", scenario: "استقالة", leaveBalanceDays: 5 });
    expect(r.gratuity).toBe(0);
    expect(r.fractionApplied).toBe(0);
    // بدل الإجازات يبقى مستحقًا حتى مع صفر المكافأة
    expect(r.leaveEncashment).toBeGreaterThan(0);
    expect(r.total).toBe(r.leaveEncashment);
  });

  test("استقالة بعد 10 سنوات ⇒ كامل", () => {
    const r = computeEos({ wage: 1000, hireDate: "2015-01-01", endDate: "2026-01-01", scenario: "استقالة", leaveBalanceDays: 0 });
    expect(r.fractionApplied).toBe(1);
    expect(r.gratuity).toBe(eosFullGratuity(1000, r.years));
    expect(r.gratuity).toBeGreaterThan(8000);
  });

  test("فصل (م41) ⇒ صفر مكافأة", () => {
    const r = computeEos({ ...base, scenario: "فصل (م41)" });
    expect(r.gratuity).toBe(0);
    expect(r.total).toBe(r.leaveEncashment);
  });

  test("انصراف (م44) ⇒ كامل كما انتهاء العقد", () => {
    const r = computeEos({ ...base, scenario: "انصراف (م44)" });
    const r2 = computeEos({ ...base, scenario: "انتهاء عقد" });
    expect(r.gratuity).toBe(r2.gratuity);
  });

  test("زواج وولادة ⇒ كامل مهما كانت السنوات (م51 خاصة)", () => {
    const inputM = { wage: 900, hireDate: "2025-01-01", endDate: "2026-06-01", leaveBalanceDays: 0 };
    const rMarriage = computeEos({ ...inputM, scenario: "زواج" });
    expect(rMarriage.gratuity).toBe(eosFullGratuity(900, rMarriage.years));
    const rBirth = computeEos({ ...inputM, scenario: "ولادة" });
    expect(rBirth.gratuity).toBe(rMarriage.gratuity);
  });

  test("وفاة ⇒ كامل", () => {
    const r = computeEos({ ...base, scenario: "وفاة" });
    const r2 = computeEos({ ...base, scenario: "انتهاء عقد" });
    expect(r.gratuity).toBe(r2.gratuity);
  });

  test("اتفاق الطرفين: الافتراضي كامل، والمبلغ المتجاوز يحسم", () => {
    const rDefault = computeEos({ ...base, scenario: "اتفاق الطرفين", leaveBalanceDays: 0 });
    const rFull = computeEos({ ...base, scenario: "انتهاء عقد", leaveBalanceDays: 0 });
    expect(rDefault.gratuity).toBe(rFull.gratuity);

    const rAgreed = computeEos({ ...base, scenario: "اتفاق الطرفين", leaveBalanceDays: 0, agreementAmount: 2000 });
    expect(rAgreed.gratuity).toBe(2000);
    expect(rAgreed.fractionApplied).toBeLessThan(1);

    const rZero = computeEos({ ...base, scenario: "اتفاق الطرفين", leaveBalanceDays: 0, agreementAmount: 0 });
    expect(rZero.gratuity).toBe(0);
  });

  test("سيناريو غير معروف ⇒ صفر مكافأة (حماية)", () => {
    const r = computeEos({ ...base, scenario: "باطل", leaveBalanceDays: 0 });
    expect(r.gratuity).toBe(0);
  });
});

// ==================== السيناريوهات والقيم ====================

describe("EOS_SCENARIOS — سلامة الكتالوج", () => {
  test("8 سيناريوهات وقيم فريدة وقواعد معروفة", () => {
    expect(EOS_SCENARIOS.length).toBe(8);
    const values = new Set(EOS_SCENARIOS.map((s) => s.value));
    expect(values.size).toBe(8);
    for (const s of EOS_SCENARIOS) expect(["full", "resignation", "none", "agreement"]).toContain(s.rule);
  });

  test("eosScenarioByValue يطابق", () => {
    expect(eosScenarioByValue("استقالة")?.rule).toBe("resignation");
    expect(eosScenarioByValue("فصل (م41)")?.rule).toBe("none");
    expect(eosScenarioByValue("غير موجود")).toBeUndefined();
  });
});

/** جمع بتقريب r3 نفسه — لفحص total = gratuity + encashment */
function r3add(a: number, b: number): number {
  return Math.round((a + b) * 1000) / 1000;
}
