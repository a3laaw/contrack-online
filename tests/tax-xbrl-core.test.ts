/**
 * اختبارات نواة الزكاة والضريبة + iXBRL — Task 111 — bun test.
 */
import { describe, expect, test } from "bun:test";
import {
  computeTax,
  DEFAULT_ZAKAT_ADJUSTMENTS,
  FOREIGN_TAX_RATE,
  provisionEntryDescription,
  TAX_ACCOUNT_PINS,
  TAX_KIND_LABEL,
  validateAdjustments,
  validateForApproval,
  ZAKAT_RATE,
} from "../src/lib/tax-core";
import { buildIxbrlDocument, checkCoverage, type XbrlMeta } from "../src/lib/xbrl-core";
import { buildBalanceSheet, buildIncomeStatement, type FsAccountRow } from "../src/lib/financial-statements-core";

// ==================== الحسبة ====================

describe("حسبة الزكاة والضريبة", () => {
  test("الزكاة 1% على صافي الربح بلا تعديلات", () => {
    const c = computeTax("zakat", 10000, []);
    expect(c.base).toBe(10000);
    expect(c.rate).toBe(ZAKAT_RATE);
    expect(c.amount).toBe(100);
  });
  test("التعديلات تجمع على الوعاء (إضافة موجبة وخصم سالب)", () => {
    const c = computeTax("zakat", 10000, [
      { label: "إهلاك معاد إضافته", amount: 500 },
      { label: "أرباح خارج الكويت (خصم)", amount: -200 },
    ]);
    expect(c.adjustmentsTotal).toBe(300);
    expect(c.base).toBe(10300);
    expect(c.amount).toBe(103);
  });
  test("خسارة الزكاة (وعاء سالب) تُحصر عند صفر — لا زكاة على الخسارة", () => {
    const c = computeTax("zakat", -5000, []);
    expect(c.base).toBe(0);
    expect(c.amount).toBe(0);
  });
  test("الخسارة مع تعديلات موجبة جزئية تحصر فقط بعد الجمع", () => {
    const c = computeTax("zakat", -5000, [{ label: "إهلاك", amount: 3000 }]);
    expect(c.base).toBe(0); // -2000 تُحصر
    expect(c.amount).toBe(0);
    const c2 = computeTax("zakat", -5000, [{ label: "إهلاك", amount: 6000 }]);
    expect(c2.base).toBe(1000);
    expect(c2.amount).toBe(10);
  });
  test("ضريبة الأجانب 15% على الوعاء نفسه", () => {
    const c = computeTax("foreign_tax", 20000, []);
    expect(c.rate).toBe(FOREIGN_TAX_RATE);
    expect(c.amount).toBe(3000);
  });
  test("دقة الفلس: التقريب ثلاثي", () => {
    const c = computeTax("zakat", 1001.555, []);
    expect(c.amount).toBe(10.016); // 10.01555 → 10.016
  });
});

describe("تعديلات النموذج المعلن", () => {
  test("القالب الافتراضي تسميات موثقة بأصفار", () => {
    expect(DEFAULT_ZAKAT_ADJUSTMENTS.length).toBeGreaterThan(2);
    expect(DEFAULT_ZAKAT_ADJUSTMENTS.every((a) => a.amount === 0 && a.label.length > 0)).toBe(true);
  });
  test("التحقق: كل تعديل يحتاج وصفًا ومبلغًا رقميًا", () => {
    const bad = validateAdjustments([{ label: "", amount: 5 }]);
    expect(bad.ok).toBe(false);
    const bad2 = validateAdjustments([{ label: "x", amount: "abc" }]);
    expect(bad2.ok).toBe(false);
    expect(validateAdjustments("nope").ok).toBe(false);
  });
  test("أصفار القالب تُتجاهل ولا تدخل الوعاء", () => {
    const r = validateAdjustments(DEFAULT_ZAKAT_ADJUSTMENTS);
    expect(r.ok).toBe(true);
    expect(r.clean.length).toBe(0);
    expect(r.total).toBe(0);
  });
  test("التقريب ثلاثي للمجاميع", () => {
    const r = validateAdjustments([
      { label: "أ", amount: 1.0 },
      { label: "ب", amount: 2.001 },
    ]);
    expect(r.total).toBe(3.001);
  });
});

describe("تحقق جاهزية الاعتماد", () => {
  test("مسودة فقط تُعتمد — والمكرر يرفض", () => {
    expect(validateForApproval({ status: "approved", kind: "zakat", year: 2026, netProfit: 1, base: 1, amount: 1 }).ok).toBe(false);
    expect(validateForApproval({ status: "draft", kind: "zakat", year: 2026, netProfit: 1, base: 1, amount: 1, hasApprovedSameYear: true }).ok).toBe(false);
    expect(validateForApproval({ status: "draft", kind: "zakat", year: 2026, netProfit: 1, base: 1, amount: 1 }).ok).toBe(true);
  });
  test("ضريبة الأجانب تحتاج علم الشركة الأجنبية", () => {
    expect(validateForApproval({ status: "draft", kind: "foreign_tax", year: 2026, netProfit: 1, base: 1, amount: 1, foreignOwned: false }).ok).toBe(false);
    expect(validateForApproval({ status: "draft", kind: "foreign_tax", year: 2026, netProfit: 1, base: 1, amount: 1, foreignOwned: true }).ok).toBe(true);
  });
  test("صفر مخصص يرفض والسنة تتحقق", () => {
    expect(validateForApproval({ status: "draft", kind: "zakat", year: 2026, netProfit: 0, base: 0, amount: 0 }).ok).toBe(false);
    expect(validateForApproval({ status: "draft", kind: "zakat", year: 3000, netProfit: 1, base: 1, amount: 1 }).ok).toBe(false);
  });
  test("حسابات القيد الثابتة للنوعين", () => {
    expect(TAX_ACCOUNT_PINS.zakat.debitCode).toBe("5400");
    expect(TAX_ACCOUNT_PINS.zakat.creditCode).toBe("2170");
    expect(TAX_ACCOUNT_PINS.foreign_tax.creditCode).toBe("2180");
    expect(provisionEntryDescription("zakat", 2026)).toContain("2026");
    expect(TAX_KIND_LABEL.foreign_tax).toContain("15%");
  });
});

// ==================== iXBRL ====================

function row(o: Partial<FsAccountRow> & { code: string; type: string }): FsAccountRow {
  return {
    accountId: 0, name: o.name || o.code, nature: "debit", xbrlElement: "", cashFlowKind: "",
    opening: 0, periodDr: 0, periodCr: 0, closing: 0, ...o,
  };
}

/** سيناريو صغير — العناصر مخلوطة (مغطاة وغير مغطاة) لاختبار تقرير الاكتمال */
const ROWS: FsAccountRow[] = [
  row({ code: "1111", name: "الصندوق", type: "asset", closing: 2600, xbrlElement: "kw:CashOnHand" }),
  row({ code: "1212", name: "سيارات", type: "asset", closing: 300, xbrlElement: "" }),
  row({ code: "3100", name: "رأس المال", type: "equity", closing: -2900, xbrlElement: "ifrs-full:IssuedCapital" }),
  row({ code: "4100", name: "إيرادات العقود", type: "revenue", periodCr: 500, closing: -500, xbrlElement: "ifrs-full:RevenueFromContractsWithCustomers" }),
  row({ code: "5230", name: "كهرباء وماء", type: "expense", periodDr: 200, closing: 200, xbrlElement: "kw:UtilitiesAndTelecomExpense" }),
  row({ code: "4200", name: "إيرادات أوامر التغيير", type: "revenue", periodDr: 50, closing: 50, xbrlElement: "kw:RevenueFromVariationOrders" }),
];

const META: XbrlMeta = {
  companyName: "شركة الاختبار",
  companyLicense: "123456",
  year: 2026,
  asOf: "2026-12-31",
  from: "2026-01-01",
  currency: "KWD",
};

function buildStatements() {
  const income = buildIncomeStatement(ROWS, META.from, META.asOf);
  const balanceSheet = buildBalanceSheet(ROWS, META.asOf, income.netResult);
  return { income, balanceSheet };
}

describe("فحص اكتمال خريطة XBRL", () => {
  test("السطر بلا عنصر يظهر في العناصر غير المغطاة والمغطى يُعد", () => {
    const { income, balanceSheet } = buildStatements();
    const cov = checkCoverage({ income, balanceSheet, equity: { rows: [] } as never, cashflow: { operating: [], investing: [], financing: [], unclassified: [] } as never });
    expect(cov.tagged).toBeGreaterThan(2);
    expect(cov.complete).toBe(false);
    expect(cov.uncovered.some((u) => u.code === "1212")).toBe(true);
    expect(cov.uncovered.every((u) => u.statement.length > 0)).toBe(true);
  });
  test("خريطة كاملة تصير complete", () => {
    const full = ROWS.map((r) => ({ ...r, xbrlElement: r.xbrlElement || `kw:El${r.code}` }));
    const income = buildIncomeStatement(full, META.from, META.asOf);
    const balanceSheet = buildBalanceSheet(full, META.asOf, income.netResult);
    const cov = checkCoverage({ income, balanceSheet, equity: { rows: [] } as never, cashflow: { operating: [], investing: [], financing: [], unclassified: [] } as never });
    expect(cov.complete).toBe(true);
    expect(cov.uncovered.length).toBe(0);
  });
});

describe("بنّاء وثيقة iXBRL", () => {
  const { income, balanceSheet } = buildStatements();
  const coverage = checkCoverage({ income, balanceSheet, equity: { rows: [] } as never, cashflow: { operating: [], investing: [], financing: [], unclassified: [] } as never });
  const input = { meta: META, income, balanceSheet, equity: { rows: [] } as never, cashflow: { operating: [], investing: [], financing: [], unclassified: [] } as never, coverage };

  test("وثيقة RTL بشارات iXBRL وسياقات لحظية ومدى وبيانات وصفية", () => {
    const { html } = buildIxbrlDocument(input, {});
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("ix:nonFraction");
    expect(html).toContain('name="ifrs-full:Assets"');
    expect(html).toContain('name="ifrs-full:ProfitLoss"');
    expect(html).toContain('contextRef="ctx_instant"');
    expect(html).toContain('contextRef="ctx_duration"');
    expect(html).toContain('scheme="kw:LicenseNo">123456');
    expect(html).toContain("2026-12-31");
    expect(html).toContain("شركة الاختبار");
    expect(html).toContain('sign="-"'); // المعاكس يرمى بعلامة
  });
  test("النقص يمنع التصدير النهائي وforce يوسم المسودة", () => {
    const blocked = buildIxbrlDocument(input, {});
    expect(blocked.html).toContain("التصدير محجوب");
    const forced = buildIxbrlDocument({ ...input, force: true }, {});
    expect(forced.html).not.toContain("التصدير محجوب");
    expect(forced.html).toContain("untagged");
  });
  test("الاكتمال يزيل الحظر", () => {
    const full = ROWS.map((r) => ({ ...r, xbrlElement: r.xbrlElement || `kw:El${r.code}` }));
    const income2 = buildIncomeStatement(full, META.from, META.asOf);
    const bs2 = buildBalanceSheet(full, META.asOf, income2.netResult);
    const cov2 = checkCoverage({ income: income2, balanceSheet: bs2, equity: { rows: [] } as never, cashflow: { operating: [], investing: [], financing: [], unclassified: [] } as never });
    const { html } = buildIxbrlDocument({ ...input, income: income2, balanceSheet: bs2, coverage: cov2 }, {});
    expect(html).not.toContain("التصدير محجوب");
    expect(html).not.toContain('class="untagged"');
  });
});
