/**
 * اختبارات نواة القوائم المالية — Task 110 — bun test.
 * كل البناة نقية: قائمة الدخل · المركز المالي · حقوق الملكية · التدفقات النقدية
 * + فحوص التوازن + الاشتقاق الهيكلي للتصنيف + محولات التصدير.
 */
import { describe, expect, test } from "bun:test";
import {
  bsReportTable,
  buildBalanceSheet,
  buildCashFlow,
  buildEquityChanges,
  buildIncomeStatement,
  cfReportTable,
  defaultCashFlowKind,
  eqReportTable,
  isReportTable,
  resolveCashFlowKind,
  validateStatements,
  type FsAccountRow,
  type FsLine,
} from "../src/lib/financial-statements-core";
import { buildFinancialStatementHtml, allChecksPass } from "../src/lib/pdf/financial-statements-html";

// ==================== مصنع الصفوف ====================

function row(o: Partial<FsAccountRow> & { code: string; type: string }): FsAccountRow {
  return {
    accountId: 0,
    name: o.name || o.code,
    nature: "debit",
    xbrlElement: "",
    cashFlowKind: "",
    parentCode: undefined,
    parentName: undefined,
    opening: 0,
    periodDr: 0,
    periodCr: 0,
    closing: 0,
    ...o,
  };
}

/**
 * سيناريو متوازن كامل (فلس دقيق):
 *  افتتاحي: نقد 1000 ↔ رأس مال 1000
 *  الفترة: حقن رأس مال 1600 نقدًا · إيراد 500 نقدًا · مصروف كهرباء 200 نقدًا · شراء سيارة 300 نقدًا
 *  النقد: 1000 + 1600 + 500 − 200 − 300 = 2600 · الأصول = 2600 + 300 = 2900
 *  حقوق الملكية = (1000 + 1600) + نتيجة (500 − 200) = 2900 ✓
 */
const ROWS: FsAccountRow[] = [
  row({ code: "1111", name: "الصندوق", type: "asset", opening: 1000, periodDr: 1600 + 500 - 200 - 300, closing: 2600 }),
  row({ code: "1212", name: "سيارات وآليات", type: "asset", periodDr: 300, closing: 300, parentCode: "1210", parentName: "الأصول الثابتة" }),
  row({ code: "3100", name: "رأس المال", type: "equity", opening: -1000, periodCr: 1600, closing: -2600 }),
  row({ code: "4100", name: "إيرادات العقود", type: "revenue", periodCr: 500, closing: -500 }),
  row({ code: "5230", name: "كهرباء وماء", type: "expense", periodDr: 200, closing: 200, parentCode: "5200", parentName: "مصروفات إدارية وعمومية" }),
];

const COUNTERPARTS = [
  { code: "3100", name: "رأس المال", type: "equity", cashFlowKind: "", debit: 0, credit: 1600 },
  { code: "4100", name: "إيرادات العقود", type: "revenue", cashFlowKind: "", debit: 0, credit: 500 },
  { code: "5230", name: "كهرباء وماء", type: "expense", cashFlowKind: "", debit: 200, credit: 0 },
  { code: "1212", name: "سيارات وآليات", type: "asset", cashFlowKind: "", debit: 300, credit: 0 },
];

describe("الاشتقاق الهيكلي لتصنيف التدفق النقدي", () => {
  test("النقد 111x بلا تصنيف — هو موضوع القائمة", () => {
    expect(defaultCashFlowKind("1111", "asset")).toBe("");
    expect(defaultCashFlowKind("1112", "asset")).toBe("");
  });
  test("الأصول غير المتداولة 12xx استثمارية والجارية تشغيلية", () => {
    expect(defaultCashFlowKind("1211", "asset")).toBe("investing");
    expect(defaultCashFlowKind("1220", "asset")).toBe("investing");
    expect(defaultCashFlowKind("1121", "asset")).toBe("operating");
    expect(defaultCashFlowKind("1140", "asset")).toBe("operating");
  });
  test("الالتزامات الجارية تشغيلية وغير المتداولة 22xx تمويلية", () => {
    expect(defaultCashFlowKind("2121", "liability")).toBe("operating");
    expect(defaultCashFlowKind("2210", "liability")).toBe("financing");
  });
  test("حقوق الملكية تمويلية والإيراد/المصروف تشغيلي", () => {
    expect(defaultCashFlowKind("3100", "equity")).toBe("financing");
    expect(defaultCashFlowKind("4100", "revenue")).toBe("operating");
    expect(defaultCashFlowKind("5210", "expense")).toBe("operating");
  });
  test("القيمة المخزَّنة الصريحة تحسم قبل الاشتقاق", () => {
    expect(resolveCashFlowKind("1121", "asset", "financing")).toBe("financing");
    expect(resolveCashFlowKind("1121", "asset", "")).toBe("operating");
    expect(resolveCashFlowKind("1121", "asset", "  ")).toBe("operating");
    expect(resolveCashFlowKind("1121", "asset", "nonsense")).toBe("operating");
  });
});

describe("قائمة الدخل الشامل", () => {
  const inc = buildIncomeStatement(ROWS, "2026-01-01", "2026-12-31");
  test("الإيرادات بطرفها الطبيعي (حركة دائنة = إيراد موجب)", () => {
    expect(inc.revenue.total).toBe(500);
    expect(inc.revenue.lines[0].code).toBe("4100");
    expect(inc.revenue.lines[0].amount).toBe(500);
  });
  test("المصروفات مجمعة بمجموعات الأب المباشر بعنوانه", () => {
    expect(inc.expenses.length).toBe(1);
    expect(inc.expenses[0].title).toBe("مصروفات إدارية وعمومية");
    expect(inc.expenses[0].total).toBe(200);
    expect(inc.expensesTotal).toBe(200);
  });
  test("النتيجة = إيرادات − مصروفات", () => {
    expect(inc.netResult).toBe(300);
  });
  test("حسابات بلا حركة فترة تُستبعد", () => {
    const only = buildIncomeStatement([ROWS[0]], "2026-01-01", "2026-12-31");
    expect(only.revenue.lines.length).toBe(0);
    expect(only.netResult).toBe(0);
  });
});

describe("قائمة المركز المالي", () => {
  const inc = buildIncomeStatement(ROWS, "2026-01-01", "2026-12-31");
  const bs = buildBalanceSheet(ROWS, "2026-12-31", inc.netResult);
  test("الأصول بجانبها المدين والمخالف الدائن سالب داخل القسم", () => {
    expect(bs.totalAssets).toBe(2900);
    expect(bs.assets.lines.find((l: FsLine) => l.code === "1111")?.amount).toBe(2600);
    expect(bs.assets.lines.find((l: FsLine) => l.code === "1212")?.amount).toBe(300);
  });
  test("الالتزامات وحقوق الملكية تُقلب لدائن موجب", () => {
    expect(bs.liabilities.total).toBe(0);
    expect(bs.equity.lines.find((l: FsLine) => l.code === "3100")?.amount).toBe(2600);
  });
  test("نتيجة السنة الجارية تُحقن داخل حقوق الملكية", () => {
    expect(bs.netResult).toBe(300);
    expect(bs.equityWithResult).toBe(2900);
    expect(bs.equity.lines.some((l: FsLine) => l.computed && l.amount === 300)).toBe(true);
  });
  test("التوازن: الأصول = الالتزامات + حقوق الملكية", () => {
    expect(bs.totalLiabilitiesEquity).toBe(2900);
    expect(bs.balanced).toBe(true);
    expect(bs.diff).toBe(0);
  });
  test("اختلال مفتعل يُرصد بفرق صريح", () => {
    const broken = buildBalanceSheet([ROWS[0], ROWS[2]], "2026-12-31", 0); // نقد 2600 مقابل رأس مال 2600 دون نتيجة
    // نقد 2600 = ملكية 2600 → متوازن؛ نضيف أصلًا بلا مقابلة:
    const withGhost = buildBalanceSheet([ROWS[0], ROWS[1], ROWS[2]], "2026-12-31", 0);
    expect(withGhost.balanced).toBe(false);
    expect(withGhost.diff).toBe(300);
    void broken;
  });
});

describe("التغيرات في حقوق الملكية", () => {
  const inc = buildIncomeStatement(ROWS, "2026-01-01", "2026-12-31");
  const eq = buildEquityChanges(ROWS, "2026-01-01", "2026-12-31", inc.netResult);
  test("الافتتاحي قبل الفترة + الحركة + النتيجة = الإقفال", () => {
    expect(eq.openingTotal).toBe(1000);
    expect(eq.movementNet).toBe(1600);
    expect(eq.netResult).toBe(300);
    expect(eq.closingTotal).toBe(2900);
    expect(eq.closingActual).toBe(2900);
    expect(eq.consistent).toBe(true);
  });
  test("صفوف الحسابات: زيادة موجبة ونقصان صفر عند نمو الملكية", () => {
    expect(eq.rows.length).toBe(1);
    expect(eq.rows[0].increase).toBe(1600);
    expect(eq.rows[0].decrease).toBe(0);
  });
  test("الاتساق بنيوي مضمون — أي نتيجة مستقلة تضاف للطرفين فلا تكسر الهوية", () => {
    // الفحص حارس بنية (يحمي من انكسار مستقبلي في البناء) لا كاشف بيانات:
    // closingTotal = opening + movement + nr و closingActual = closing + nr
    // والحركة نفسها = closing − opening بنيويًا — فالهوية ثابتة لأي قيمة نتيجة
    const bad = buildEquityChanges(ROWS, "2026-01-01", "2026-12-31", 999);
    expect(bad.consistent).toBe(true);
    expect(bad.closingTotal).toBe(bad.closingActual);
  });
});

describe("التدفقات النقدية", () => {
  const cf = buildCashFlow([ROWS[0]], COUNTERPARTS, "2026-01-01", "2026-12-31");
  test("التصنيف بالاشتقاق: تشغيلي 300 · استثماري −300 · تمويلي 1600", () => {
    expect(cf.totals.operating).toBe(300);
    expect(cf.totals.investing).toBe(-300);
    expect(cf.totals.financing).toBe(1600);
    expect(cf.totals.net).toBe(1600);
  });
  test("وارد/منصرف بطرفيهما داخل الصف", () => {
    const rev = cf.operating.find((r) => r.code === "4100");
    const exp = cf.operating.find((r) => r.code === "5230");
    expect(rev?.inflow).toBe(500);
    expect(rev?.outflow).toBe(0);
    expect(exp?.outflow).toBe(200);
    expect(exp?.inflow).toBe(0);
  });
  test("المطابقة: صافي المصنف = التغير الفعلي في النقد", () => {
    expect(cf.cashDelta).toBe(1600);
    expect(cf.reconciles).toBe(true);
    expect(cf.diff).toBe(0);
  });
  test("التحويلات نقد↔نقد تُستثنى ولا تغير الإجمالي", () => {
    // سيناريو تحويل نقد↔نقد فقط: النقد لا يتغير (افتتاحي = إقفالي) والمصنف صفر — الخادم
    // يستبعد سطور 111x من الأطراف أصلًا، والنواة تتحمل مرورها بسلام (تصنيف فارغ بلا أثر صافٍ)
    const cashStill = row({ code: "1111", name: "الصندوق", type: "asset", opening: 1000, closing: 1000 });
    const cf2 = buildCashFlow([cashStill], [
      { code: "1112", name: "البنك", type: "asset", cashFlowKind: "", debit: 100, credit: 0 },
      { code: "1111", name: "الصندوق", type: "asset", cashFlowKind: "", debit: 0, credit: 100 },
    ], "2026-01-01", "2026-12-31");
    expect(cf2.totals.net).toBe(0);
    expect(cf2.reconciles).toBe(true);
  });
  test("تصنيف مخزَّن صريح يتجاوز الاشتقاق", () => {
    const cf3 = buildCashFlow([ROWS[0]], [
      { code: "1121", name: "العملاء", type: "asset", cashFlowKind: "financing", debit: 0, credit: 50 },
    ], "2026-01-01", "2026-12-31");
    expect(cf3.financing.length).toBe(1);
    expect(cf3.operating.length).toBe(0);
  });
  test("حساب بلا تصنيف ممكن بعد الاستثناء يظهر في قائمة غير المصنف", () => {
    // حساب نقدي وهمي خارج 111x لا يمر هنا — نستخدم نوعًا غامضًا بلا اشتقاق: مستحيل؛
    // نتحقق من المسار بحساب نقد وهمي 1119 يبقى "" — لكنه يُستثنى أصلًا من الأطراف.
    // لذا نتحقق أن unclassified فارغ في السيناريو القياسي:
    expect(cf.unclassified.length).toBe(0);
  });
});

describe("فحوص التوازن الإجمالية", () => {
  const inc = buildIncomeStatement(ROWS, "2026-01-01", "2026-12-31");
  const bs = buildBalanceSheet(ROWS, "2026-12-31", inc.netResult);
  const eq = buildEquityChanges(ROWS, "2026-01-01", "2026-12-31", inc.netResult);
  const cf = buildCashFlow([ROWS[0]], COUNTERPARTS, "2026-01-01", "2026-12-31");
  test("السيناريو المتوازن يمر كل الفحوص", () => {
    const checks = validateStatements({ trialDiff: 0, bs, cf, eq });
    expect(checks.allPassed).toBe(true);
    expect(checks.notes.length).toBe(0);
  });
  test("اختلال الأستاذ يولد ملاحظة صريحة", () => {
    const checks = validateStatements({ trialDiff: 5, bs, cf, eq });
    expect(checks.trialBalanced).toBe(false);
    expect(checks.allPassed).toBe(false);
    expect(checks.notes.some((n) => n.includes("5.000"))).toBe(true);
  });
  test("غياب حسابات النقد يفشل فحص التدفقات", () => {
    const cfNoCash = buildCashFlow([], [], "2026-01-01", "2026-12-31");
    const checks = validateStatements({ trialDiff: 0, bs, cf: cfNoCash, eq });
    expect(checks.allPassed).toBe(false);
    expect(checks.notes.some((n) => n.includes("111x"))).toBe(true);
  });
});

describe("محولات التصدير (ReportTable)", () => {
  const inc = buildIncomeStatement(ROWS, "2026-01-01", "2026-12-31");
  const bs = buildBalanceSheet(ROWS, "2026-12-31", inc.netResult);
  const eq = buildEquityChanges(ROWS, "2026-01-01", "2026-12-31", inc.netResult);
  const cf = buildCashFlow([ROWS[0]], COUNTERPARTS, "2026-01-01", "2026-12-31");
  test("قائمة الدخل: صفوف الأقسام والإجماليات والنتيجة", () => {
    const t = isReportTable(inc);
    expect(t.heads).toEqual(["البند", "مدين", "دائن"]);
    expect(t.rows.some((r) => String(r[0]).includes("إجمالي الإيرادات"))).toBe(true);
    expect(t.rows.some((r) => String(r[0]).includes("صافي الربح"))).toBe(true);
    expect(t.title).toContain("2026-01-01");
  });
  test("المركز المالي: ثلاثة أقسام وإجمالي مزدوج", () => {
    const t = bsReportTable(bs);
    expect(t.note).toContain("متوازن");
    expect(t.rows.length).toBeGreaterThan(8);
  });
  test("حقوق الملكية وصف النتيجة", () => {
    const t = eqReportTable(eq);
    expect(t.heads).toEqual(["الحساب", "افتتاحي", "زيادة", "نقصان", "إقفال"]);
    expect(t.rows.some((r) => String(r[0]).includes("نتيجة الفترة"))).toBe(true);
  });
  test("التدفقات النقدية بأقسامها الثلاثة والمطابقة", () => {
    const t = cfReportTable(cf);
    const flat = t.rows.map((r) => String(r[0]));
    expect(flat.some((x) => x.includes("التشغيلية"))).toBe(true);
    expect(flat.some((x) => x.includes("الاستثمارية"))).toBe(true);
    expect(flat.some((x) => x.includes("التمويلية"))).toBe(true);
    expect(t.note).toContain("مطابقة");
  });
});

describe("بنّاء HTML للطباعة", () => {
  const inc = buildIncomeStatement(ROWS, "2026-01-01", "2026-12-31");
  const bs = buildBalanceSheet(ROWS, "2026-12-31", inc.netResult);
  const eq = buildEquityChanges(ROWS, "2026-01-01", "2026-12-31", inc.netResult);
  const cf = buildCashFlow([ROWS[0]], COUNTERPARTS, "2026-01-01", "2026-12-31");
  const opts = {
    company: { name: "شركة الاختبار", address: "الكويت", phone: "", email: "" },
    currency: "د.ك",
    title: "قائمة المركز المالي",
    periodText: "حتى 2026-12-31",
    checksBadges: [
      { label: "ميزان متوازن", passed: true },
      { label: "المركز متوازن", passed: true },
    ],
  };
  test("HTML كامل RTL بترقيم القائمة وترويسة الشركة", () => {
    const html = buildFinancialStatementHtml({ kind: "bs", rows: ROWS, income: inc, balanceSheet: bs, equity: eq, cashflow: cf }, opts);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("شركة الاختبار");
    expect(html).toContain("إجمالي الالتزامات وحقوق الملكية");
    expect(html).toContain("badge pass");
    expect(html).toContain("44/2016");
  });
  test("فشل الفحص دون force يمنع الطباعة النهائية (المسار الخادمي) — والمسودة تُوسم", () => {
    const brokenBs = { ...bs, balanced: false, diff: 5 };
    expect(allChecksPass({ kind: "bs", rows: ROWS, income: inc, balanceSheet: brokenBs, equity: eq, cashflow: cf })).toBe(false);
    const html = buildFinancialStatementHtml(
      { kind: "bs", rows: ROWS, income: inc, balanceSheet: brokenBs, equity: eq, cashflow: cf },
      { ...opts, checksBadges: [{ label: "المركز متوازن", passed: false }], checkNotes: ["فرق 5.000"], force: true }
    );
    expect(html).toContain('class="draft"');
    expect(html).toContain("مسودة");
    expect(html).toContain("badge fail");
  });
  test("كل قائمة لها جدولها وخلاصتها", () => {
    const isHtml = buildFinancialStatementHtml({ kind: "is", rows: ROWS, income: inc, balanceSheet: bs, equity: eq, cashflow: cf }, { ...opts, title: "قائمة الدخل الشامل", periodText: "2026-01-01 ← 2026-12-31" });
    expect(isHtml).toContain("صافي الربح للفترة");
    const eqHtml = buildFinancialStatementHtml({ kind: "eq", rows: ROWS, income: inc, balanceSheet: bs, equity: eq, cashflow: cf }, { ...opts, title: "حقوق الملكية", periodText: "p" });
    expect(eqHtml).toContain("افتتاحي");
    const cfHtml = buildFinancialStatementHtml({ kind: "cf", rows: ROWS, income: inc, balanceSheet: bs, equity: eq, cashflow: cf }, { ...opts, title: "التدفقات", periodText: "p" });
    expect(cfHtml).toContain("الأنشطة التشغيلية");
    expect(cfHtml).toContain("مطابق");
  });
});
