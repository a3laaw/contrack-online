/**
 * اختبارات نواة التسوية البنكية — Task 113.
 * الغلاف: المطابقة الحتمية (تامة ثم متسامحة)، النافذة الزمنية، الإشارات،
 * معادلة الفوارق (gap/explained/unexplained)، حراسة الإقفال، واتجاه النشر السريع.
 */
import { describe, expect, test } from "bun:test";
import {
  buildQuickPostLines,
  dayDiff,
  reconcileBank,
  validateReconClose,
  type BankSideLine,
  type GlSideLine,
} from "../src/lib/bank-recon-core";

const bank = (id: number, cdate: string, amount: number, descr = ""): BankSideLine => ({ id, cdate, amount, descr });
const gl = (id: number, entryDate: string, amount: number, entryNo = 1): GlSideLine => ({
  id, entryId: id, entryNo, entryDate, description: `قيد ${entryNo}`, amount,
});

// ==================== فرق الأيام ====================

describe("dayDiff", () => {
  test("نفس اليوم = 0 وعبر الشهور صحيح", () => {
    expect(dayDiff("2026-03-01", "2026-03-01")).toBe(0);
    expect(dayDiff("2026-03-01", "2026-02-25")).toBe(4);
    expect(dayDiff("2026-02-25", "2026-03-01")).toBe(-4);
    expect(dayDiff("2027-01-01", "2026-12-31")).toBe(1);
  });
});

// ==================== المطابقة ====================

describe("reconcileBank — المطابقة التامة", () => {
  test("زوج واحد متطابق بنفس اليوم", () => {
    const r = reconcileBank([bank(1, "2026-03-05", 500)], [gl(10, "2026-03-05", 500)], {
      statementBalance: 500, bookBalance: 500,
    });
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0].bank.id).toBe(1);
    expect(r.pairs[0].gl.id).toBe(10);
    expect(r.totals.matchedCount).toBe(1);
    expect(r.totals.bankOnlyCount).toBe(0);
    expect(r.totals.glOnlyCount).toBe(0);
    expect(r.totals.unexplained).toBe(0);
  });

  test("one-to-one: سطر دفتر واحد لا يُطابق بندين", () => {
    const r = reconcileBank(
      [bank(1, "2026-03-05", 300), bank(2, "2026-03-06", 300)],
      [gl(10, "2026-03-05", 300)],
      { statementBalance: 600, bookBalance: 300 }
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.totals.bankOnlyCount).toBe(1);
    expect(r.bankOnly[0].id).toBe(2);
  });

  test("خارج النافذة الزمنية لا يُطابق", () => {
    const r = reconcileBank([bank(1, "2026-05-01", 200)], [gl(10, "2026-03-05", 200)], {
      statementBalance: 200, bookBalance: 200, windowDays: 15,
    });
    expect(r.pairs).toHaveLength(0);
    expect(r.totals.bankOnlyCount).toBe(1);
    expect(r.totals.glOnlyCount).toBe(1);
  });

  test("داخل النافذة يُطابق حتى بتأخر أيام", () => {
    const r = reconcileBank([bank(1, "2026-03-15", 200)], [gl(10, "2026-03-05", 200)], {
      statementBalance: 200, bookBalance: 200, windowDays: 15,
    });
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0].dayGap).toBe(10);
  });

  test("السحب السالب يطابق الحركة الدائنة", () => {
    const r = reconcileBank([bank(1, "2026-03-05", -75.5)], [gl(10, "2026-03-05", -75.5)], {
      statementBalance: -75.5, bookBalance: -75.5,
    });
    expect(r.pairs).toHaveLength(1);
    expect(r.totals.unexplained).toBe(0);
  });

  test("الأقرب تاريخًا يُختار عند تعدد المرشحين", () => {
    const r = reconcileBank(
      [bank(1, "2026-03-10", 100)],
      [gl(10, "2026-03-01", 100), gl(11, "2026-03-09", 100)],
      { statementBalance: 100, bookBalance: 200 }
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0].gl.id).toBe(11);
    // المتبقي في الدفتر عالق
    expect(r.glOnly.map((l) => l.id)).toEqual([10]);
  });
});

describe("reconcileBank — المطابقة المتسامحة", () => {
  test("فرق فلس واحد يتطابق بتسامح 0.001 لا بصفر", () => {
    const base = { statementBalance: 100.001, bookBalance: 100.001 };
    const strict = reconcileBank([bank(1, "2026-03-05", 100.001)], [gl(10, "2026-03-05", 100)], base);
    expect(strict.pairs).toHaveLength(0);

    const lenient = reconcileBank([bank(1, "2026-03-05", 100.001)], [gl(10, "2026-03-05", 100)], { ...base, tolerance: 0.001 });
    expect(lenient.pairs).toHaveLength(1);
    expect(lenient.pairs[0].diff).toBe(0.001);
  });

  test("التسامح لا يتجاوز حده", () => {
    const r = reconcileBank([bank(1, "2026-03-05", 100.5)], [gl(10, "2026-03-05", 100)], {
      statementBalance: 100.5, bookBalance: 100, tolerance: 0.1,
    });
    expect(r.pairs).toHaveLength(0);
  });

  test("المطابقة التامة تُنجز أولًا قبل المتسامحة", () => {
    // بنك 100 يطابق تامًا القيد الثاني؛ المتسامح يأخذ ما تبقى
    const r = reconcileBank(
      [bank(1, "2026-03-05", 100)],
      [gl(10, "2026-03-05", 99.999), gl(11, "2026-03-05", 100)],
      { statementBalance: 100, bookBalance: 199.999, tolerance: 0.001 }
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0].gl.id).toBe(11); // التامة حسمت الغموض
    expect(r.glOnly[0].id).toBe(10);
  });
});

// ==================== معادلة الفوارق ====================

describe("معادلة الفوارق", () => {
  test("حالة كاملة: بنود غير مسجلة + عالقة + مطابقة — unexplained صفر", () => {
    // الكشف: 1000 إيداع مسجل + 50 رسوم غير مسجلة + 200 إيداع آخر غير مسجل
    const bankLines = [bank(1, "2026-03-05", 1000), bank(2, "2026-03-06", 50, "رسوم"), bank(3, "2026-03-07", 200)];
    // الدفتر: 1000 مدين + سحب 300 (شيك لم يظهر بالكشف)
    const glLines = [gl(10, "2026-03-05", 1000), gl(11, "2026-03-06", -300)];
    // statement = 950 (1000+50+200-300)؟ رصيد الكشف الفعلي عند المستخدم
    const r = reconcileBank(bankLines, glLines, { statementBalance: 1250, bookBalance: 700 });
    expect(r.totals.bankOnlySum).toBe(250); // 50+200
    expect(r.totals.glOnlySum).toBe(-300);
    expect(r.totals.explained).toBe(550); // 250-(-300)
    expect(r.totals.gap).toBe(550); // 1250-700
    expect(r.totals.unexplained).toBe(0);
  });

  test("رصيد كشف خاطئ يظهر فرقًا غير مفسَّر", () => {
    const r = reconcileBank([bank(1, "2026-03-05", 100)], [gl(10, "2026-03-05", 100)], {
      statementBalance: 999, bookBalance: 100,
    });
    expect(r.totals.gap).toBe(899);
    expect(r.totals.explained).toBe(0);
    expect(r.totals.unexplained).toBe(899);
  });
});

// ==================== حراسة الإقفال ====================

describe("validateReconClose", () => {
  test("يرفض فرقًا غير مفسَّر", () => {
    const r = reconcileBank([], [], { statementBalance: 10, bookBalance: 0 });
    expect(validateReconClose(r.totals).ok).toBe(false);
  });
  test("يقبل التسوية المصفرة", () => {
    const r = reconcileBank([bank(1, "2026-03-05", 100)], [gl(10, "2026-03-05", 100)], {
      statementBalance: 100, bookBalance: 100,
    });
    expect(validateReconClose(r.totals).ok).toBe(true);
  });
});

// ==================== النشر السريع ====================

describe("buildQuickPostLines", () => {
  const BANK = 2;
  const FEE = 7;

  test("إيداع موجب: مدين البنك / دائن المقابل", () => {
    const lines = buildQuickPostLines(250, BANK, FEE, "إيداع عميل");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ accountId: BANK, debit: 250, credit: 0, description: "إيداع عميل" });
    expect(lines[1]).toEqual({ accountId: FEE, debit: 0, credit: 250, description: "إيداع عميل" });
  });

  test("سحب سالب: مدين المقابل / دائن البنك (رسوم)", () => {
    const lines = buildQuickPostLines(-12.5, BANK, FEE, "رسوم بنكية");
    expect(lines[0].accountId).toBe(FEE);
    expect(lines[0].debit).toBe(12.5);
    expect(lines[1].accountId).toBe(BANK);
    expect(lines[1].credit).toBe(12.5);
  });

  test("صفر مرفوض وتطابق الحسابين مرفوض", () => {
    expect(() => buildQuickPostLines(0, BANK, FEE, "")).toThrow();
    expect(() => buildQuickPostLines(10, BANK, BANK, "")).toThrow();
  });
});

// ==================== الحتمية ====================

describe("الحتمية", () => {
  test("نفس المدخلات بترتيب مختلف ⇒ نفس النتيجة", () => {
    const b = [bank(1, "2026-03-06", 100), bank(2, "2026-03-05", 200)];
    const g = [gl(10, "2026-03-06", 100, 2), gl(11, "2026-03-05", 200, 1)];
    const r1 = reconcileBank(b, g, { statementBalance: 300, bookBalance: 300 });
    const r2 = reconcileBank([...b].reverse(), [...g].reverse(), { statementBalance: 300, bookBalance: 300 });
    expect(r1.pairs.map((p) => [p.bank.id, p.gl.id])).toEqual(r2.pairs.map((p) => [p.bank.id, p.gl.id]));
    expect(r1.totals).toEqual(r2.totals);
  });
});

// ==================== استيراد نص الكشف ====================

import { parseStatementText } from "../src/lib/bank-recon-core";

describe("parseStatementText", () => {
  test("CSV بفواصل: تاريخ أولاً ثم مبلغ ثم بيان", () => {
    const r = parseStatementText("2026-03-01,1000.500,إيداع عميل\n2026-03-02,-45,رسوم بنكية");
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ cdate: "2026-03-01", amount: 1000.5, descr: "إيداع عميل" });
    expect(r.lines[1]).toMatchObject({ cdate: "2026-03-02", amount: -45, descr: "رسوم بنكية" });
    expect(r.skipped).toBe(0);
  });

  test("تاريخ يوم/شهر/سنة وأقواس السالب وTab وفواصل الآلاف", () => {
    const r = parseStatementText("05/03/2026\t1,250.750\tحوالة\n06/03/2026\t(90)\tعمولة");
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ cdate: "2026-03-05", amount: 1250.75 });
    expect(r.lines[1]).toMatchObject({ cdate: "2026-03-06", amount: -90 });
  });

  test("رأس الجدول والسطور المشوهة تُتخطى مع عينات", () => {
    const r = parseStatementText("التاريخ,المبلغ,البيان\n2026-03-01,100,إيداع\nنص غير مفهوم\n,,\n2026-13-40,50,تاريخ خاطئ");
    expect(r.lines).toHaveLength(1);
    expect(r.skipped).toBe(4);
    expect(r.skippedSamples.length).toBeGreaterThan(0);
  });

  test("صفر مرفوض كأحد بنود الكشف", () => {
    const r = parseStatementText("2026-03-01,0,صفر");
    expect(r.lines).toHaveLength(0);
    expect(r.skipped).toBe(1);
  });
});
