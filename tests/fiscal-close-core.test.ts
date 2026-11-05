/**
 * اختبارات نواة الإقفال — Task 109.
 * الغلاف: بناء أسطر قيد الإغلاق السنوي (ربح/خسارة/تعادل/أرصدة معاكسة)،
 * ميزان الافتتاحية، تسميات الفترات، والتحقق من حواجز الفتح/القفل — دوال نقية بلا قاعدة بيانات.
 */
import { describe, expect, test } from "bun:test";
import {
  buildClosingLines,
  buildOpeningTrialRows,
  closingEntryDescription,
  CLOSE_SOURCE_TYPE,
  FISCAL_STATUS_LABEL_AR,
  monthLabelOf,
  validatePeriodToggle,
  validateYearForClose,
  type OpeningSourceRow,
  type PnlAccountBalance,
} from "../src/lib/fiscal-close-core";

/** دليل مصغّر: إيرادان + مصروفان + أرباح محتجزة */
const REV1 = { accountId: 1, code: "4100", name: "إيرادات العقود", type: "revenue" as const };
const REV2 = { accountId: 2, code: "4300", name: "إيرادات أخرى", type: "revenue" as const };
const EXP1 = { accountId: 3, code: "5210", name: "رواتب وأجور", type: "expense" as const };
const EXP2 = { accountId: 4, code: "5230", name: "كهرباء وماء", type: "expense" as const };
const RETAINED = { id: 9, name: "الأرباح المحتجزة" };

const bal = (
  base: { accountId: number; code: string; name: string; type: "revenue" | "expense" },
  signed: number
): PnlAccountBalance => ({ ...base, signed });

/** مجموع الأطراف (يجب صفر في كل قيد متوازن) */
const balanceDiff = (lines: { debit: number; credit: number }[]) =>
  Math.round(lines.reduce((s, l) => s + l.debit - l.credit, 0) * 1000) / 1000;

describe("buildClosingLines — بناء أسطر الإغلاق", () => {
  test("ربح: إيراد 100 ومصروف 60 ⇒ دائن المحتجزة 40 وميزان مضبوط", () => {
    const out = buildClosingLines(
      [bal(REV1, -100), bal(EXP1, 60)],
      RETAINED
    );
    expect(out).not.toBeNull();
    expect(out!.totalRevenue).toBe(100);
    expect(out!.totalExpense).toBe(60);
    expect(out!.net).toBe(40);
    expect(out!.retainedSide).toBe("credit");
    expect(out!.retainedAmount).toBe(40);
    // سطر الإيراد: مدين 100 (إصفار دائن التوازن) وسطر المصروف: دائن 60 + المحتجزة دائن 40
    expect(balanceDiff(out!.lines)).toBe(0);
    const revLine = out!.lines.find((l) => l.accountId === 1)!;
    expect(revLine.debit).toBe(100);
    expect(revLine.credit).toBe(0);
    const retLine = out!.lines.find((l) => l.accountId === RETAINED.id)!;
    expect(retLine.credit).toBe(40);
    expect(retLine.debit).toBe(0);
  });

  test("خسارة: إيراد 40 ومصروف 90 ⇒ مدين المحتجزة 50", () => {
    const out = buildClosingLines([bal(REV1, -40), bal(EXP1, 90)], RETAINED)!;
    expect(out.net).toBe(-50);
    expect(out.retainedSide).toBe("debit");
    expect(out.retainedAmount).toBe(50);
    expect(balanceDiff(out.lines)).toBe(0);
  });

  test("حسابات متعددة وتفاصيل الأسطر بأسماء الأكواد", () => {
    const out = buildClosingLines(
      [bal(REV1, -700), bal(REV2, -120), bal(EXP1, 500), bal(EXP2, 45.5)],
      RETAINED
    )!;
    expect(out.totalRevenue).toBe(820);
    expect(out.totalExpense).toBe(545.5);
    expect(out.net).toBe(274.5);
    expect(out.lines).toHaveLength(5); // 4 حسابات دخل + سطر المحتجزة
    expect(out.lines[0].description).toContain("4100"); // مرتبة بالكود
    expect(balanceDiff(out.lines)).toBe(0);
  });

  test("تعادل كامل بلا أثر على المحتجزة (نتيجة صفرية بأرصدة نشطة)", () => {
    const out = buildClosingLines([bal(REV1, -100), bal(EXP1, 100)], RETAINED)!;
    expect(out.net).toBe(0);
    expect(out.retainedSide).toBeNull();
    expect(out.retainedAmount).toBe(0);
    expect(out.lines).toHaveLength(2); // لا سطر للمحتجزة
    expect(balanceDiff(out.lines)).toBe(0);
  });

  test("أرصدة معاكسة (إيراد مدين — مرتجعات) تُقفل بالطرف الصحيح", () => {
    const out = buildClosingLines(
      [bal(REV1, 30), bal(EXP1, 80), bal(REV2, -200)],
      RETAINED
    )!;
    // الإيراد المدين يُقفل دائنًا 30 — والمحتجزة: 200 - (80 + (-30))؟ الحساب: إيراد 200+(-30)=170، مصروف 80 ⇒ ربح 90 دائن
    expect(out.totalRevenue).toBe(170);
    expect(out.totalExpense).toBe(80);
    expect(out.net).toBe(90);
    const revDebitLine = out.lines.find((l) => l.accountId === REV1.accountId)!;
    expect(revDebitLine.credit).toBe(30); // رصيد مدين ⇒ يُقفل دائنًا
    expect(balanceDiff(out.lines)).toBe(0);
  });

  test("سنة بلا حركة ⇒ null (لا قيد يُنشر)", () => {
    expect(buildClosingLines([bal(REV1, 0), bal(EXP1, 0)], RETAINED)).toBeNull();
    expect(buildClosingLines([], RETAINED)).toBeNull();
  });
});

describe("buildOpeningTrialRows — ميزان الافتتاحية", () => {
  const src = (over: Partial<OpeningSourceRow> & Pick<OpeningSourceRow, "accountId" | "code" | "name" | "type">): OpeningSourceRow => ({
    opening: 0,
    movementDr: 0,
    movementCr: 0,
    ...over,
  });

  test("الأصول مدين والالتزامات دائن — والحسابات الصفرية مستبعدة", () => {
    const out = buildOpeningTrialRows([
      src({ accountId: 1, code: "1111", name: "الصندوق", type: "asset", movementDr: 5000 }),
      src({ accountId: 2, code: "1121", name: "العملاء", type: "asset", opening: 120, movementDr: 9707, movementCr: 9587 }),
      src({ accountId: 3, code: "2121", name: "مستحقات الباطن", type: "liability", movementCr: 3000 }),
      src({ accountId: 4, code: "3300", name: "الأرباح المحتجزة", type: "equity", movementCr: 2240 }),
      src({ accountId: 5, code: "4100", name: "إيرادات العقود", type: "revenue" }), // صفري بعد الإقفال — مستبعد
    ]);
    expect(out.rows).toHaveLength(4);
    expect(out.rows[0].side).toBe("debit");
    expect(out.rows[0].debit).toBe(5000);
    expect(out.rows[1].net).toBe(120 + 9707 - 9587);
    expect(out.totals.diff).toBe(0);
  });

  test("الافتتاحي السالب على حساب أصل يظهر دائنًا (سحب على الصندوق)", () => {
    const out = buildOpeningTrialRows([
      src({ accountId: 1, code: "1111", name: "الصندوق", type: "asset", opening: -50 }),
    ]);
    expect(out.rows[0].side).toBe("credit");
    expect(out.rows[0].credit).toBe(50);
    expect(out.totals.credit).toBe(50);
    expect(out.totals.diff).toBe(-50); // غير متوازن — يحتاج الطرف المقابل من بيانات حقيقية
  });
});

describe("الفترات والتحقق", () => {
  test("تسمية الشهر العربي من مفتاح الفترة", () => {
    expect(monthLabelOf("2025-01")).toBe("يناير 2025");
    expect(monthLabelOf("2025-12")).toBe("ديسمبر 2025");
    expect(monthLabelOf("سيء")).toBe("سيء");
  });

  test("سنة الإقفال غير الصحيحة تُرفض", () => {
    expect(validateYearForClose(2025)).toBeNull();
    expect(validateYearForClose(1999)).not.toBeNull();
    expect(validateYearForClose("abc")).not.toBeNull();
    expect(validateYearForClose(2101)).not.toBeNull();
  });

  test("فتح فترة في سنة مقفلة سنويًا يُرفض — والقفل في سنة مفتوحة مسموح", () => {
    expect(validatePeriodToggle("open", "closed")).not.toBeNull();
    expect(validatePeriodToggle("open", "open")).toBeNull();
    expect(validatePeriodToggle("close", "open")).toBeNull();
  });

  test("ثوابت المصدر والحالة والوصف", () => {
    expect(CLOSE_SOURCE_TYPE).toBe("closing");
    expect(FISCAL_STATUS_LABEL_AR["closed"]).toBe("مقفلة");
    expect(closingEntryDescription(2025)).toContain("2025");
    expect(closingEntryDescription(2025)).toContain("الأرباح المحتجزة");
  });
});
