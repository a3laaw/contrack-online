/**
 * اختبار المرحلة 5 — أنماط التقرير المالي الأربعة + بيانات الرسم الشهري
 * قفل سلوك المكتبي V9.15.18 حرفيًا:
 *   reports_page.py:474  _data_cash_flow (receipts_only/payments_only/recoveries_only/transfers_only)
 *   reports_page.py:455  _transfer_buckets (V4.33: بنك→صندوق · صندوق→بنك · نفس المحفظة)
 *   reports_page.py:1364 خيارات العرض التسعة للتقرير المالي
 *   cashflow_chart.py    الأعمدة الشهرية (أخضر وارد / أحمر منصرف) وتنسيق القيم k
 *   tests/test_financial_report_transfer_filters.py (السيناريو الذهبي المكتبي: 200/50/100)
 */

import { describe, expect, test } from "bun:test";
import {
  chartValueLabel,
  cashflowPaymentsOnly,
  cashflowReceiptsOnly,
  cashflowRecoveriesOnly,
  cashflowTransfersOnly,
  classifyWallet,
  monthlyChartData,
  transferBuckets,
  type CashItem,
  type TransferItem,
} from "@/lib/cashflow-modes-core";

const NORMAL_HEADS = ["م", "التاريخ", "العميل", "العقد", "المبلغ", "البيان"];
const TRANSFER_HEADS = ["م", "التاريخ", "من حساب", "إلى حساب", "المبلغ", "البيان"];

describe("classifyWallet — تصنيف المحفظة نصيًا (مرآة openingForAccount)", () => {
  test("البنك بأي صيغة ⇒ bank", () => {
    expect(classifyWallet("البنك")).toBe("bank");
    expect(classifyWallet("بنك الأهلي")).toBe("bank");
    expect(classifyWallet("بنك")).toBe("bank");
  });
  test("الصندوق والنقد ⇒ cash", () => {
    expect(classifyWallet("الصندوق")).toBe("cash");
    expect(classifyWallet("صندوق الفرع")).toBe("cash");
    expect(classifyWallet("نقدًا")).toBe("cash");
  });
  test("غيره ⇒ other", () => {
    expect(classifyWallet("المحفظة")).toBe("other");
    expect(classifyWallet("")).toBe("other");
  });
});

describe("transferBuckets — مرآة _transfer_buckets (V4.33)", () => {
  const items: TransferItem[] = [
    { vdate: "2026-01-01", from: "البنك", to: "الصندوق", amount: 100, desc: "" },
    { vdate: "2026-01-02", from: "الصندوق", to: "البنك", amount: 30, desc: "" },
    { vdate: "2026-01-03", from: "بنك الأهلي", to: "بنك الخليج", amount: 5, desc: "" },
    { vdate: "2026-01-04", from: "صندوق", to: "صندوق الفرع", amount: 7, desc: "" },
  ];
  test("الاتجاهات الثلاثة والصافي (طرح لا جمع)", () => {
    const b = transferBuckets(items);
    expect(b.bankToCash).toBe(100);
    expect(b.cashToBank).toBe(30);
    expect(b.sameWallet).toBe(12); // 5 + 7
    expect(b.net).toBe(70); // 100 − 30
  });
  test("قائمة فارغة ⇒ أصفار", () => {
    const b = transferBuckets([]);
    expect(b.bankToCash).toBe(0);
    expect(b.cashToBank).toBe(0);
    expect(b.sameWallet).toBe(0);
    expect(b.net).toBe(0);
  });
});

describe("السيناريو الذهبي المكتبي (200 قبض / 50 صرف / 100 تحويل)", () => {
  const receipt: CashItem = { vdate: "2026-10-19", party: "عميل", contract: "C-1", amount: 200, desc: "إيراد" };
  const payment: CashItem = { vdate: "2026-10-19", party: "مورد", contract: "", amount: 50, desc: "مصروف" };
  const transfer: TransferItem = { vdate: "2026-10-19", from: "البنك", to: "الصندوق", amount: 100, desc: "تحويل داخلي من البنك إلى الصندوق" };

  test("وارد فقط: صف واحد ورؤوس مطابقة وإجمالي 200", () => {
    const t = cashflowReceiptsOnly([receipt]);
    expect(t.heads).toEqual(NORMAL_HEADS);
    expect(t.rows).toEqual([[1, "2026-10-19", "عميل", "C-1", 200, "إيراد"]]);
    expect(t.totalsRow).toEqual(["الإجمالي", "", "", "", 200, ""]);
    expect(t.note).toContain("وارد فقط");
    expect(t.note).toContain("إجمالي الوارد: 200.000 د.ك");
    expect(t.note).toContain("العدد: 1");
  });
  test("منصرف فقط: صف واحد وإجمالي 50", () => {
    const t = cashflowPaymentsOnly([payment]);
    expect(t.heads).toEqual(NORMAL_HEADS);
    expect(t.totalsRow).toEqual(["الإجمالي", "", "", "", 50, ""]);
    expect(t.note).toContain("منصرف فقط");
    expect(t.note).toContain("إجمالي المنصرف: 50.000 د.ك");
  });
  test("مسترد فقط: صف واحد وإجمالي", () => {
    const t = cashflowRecoveriesOnly([{ vdate: "2026-10-19", party: "عهدة عامة", contract: "", amount: 75, desc: "إرجاع عهدة" }]);
    expect(t.heads).toEqual(NORMAL_HEADS);
    expect(t.totalsRow[4]).toBe(75);
    expect(t.note).toContain("مسترد فقط");
    expect(t.note).toContain("إجمالي المسترد: 75.000 د.ك");
  });
  test("تحويلات فقط: رؤوس من/إلى + الصافي + نص الملاحظة الحرفي", () => {
    const t = cashflowTransfersOnly([transfer]);
    expect(t.heads).toEqual(TRANSFER_HEADS);
    expect(t.rows).toEqual([[1, "2026-10-19", "البنك", "الصندوق", 100, "تحويل داخلي من البنك إلى الصندوق"]]);
    expect(t.totalsRow).toEqual(["الصافي", "", "", "", 100, ""]);
    expect(t.note).toContain("تحويلات داخلية فقط");
    expect(t.note).toContain("لا تُحسب ضمن المنصرف ولا الوارد");
    expect(t.note).toContain("العدد: 1");
  });
});

describe("تحويلات فقط — نص الملاحظة بترتيب المكتبي الحرفي", () => {
  test("بنك→صندوق 100 وصندوق→بنك 30: الصافي داخل الصندوق 70", () => {
    const t = cashflowTransfersOnly([
      { vdate: "2026-01-01", from: "البنك", to: "الصندوق", amount: 100, desc: "" },
      { vdate: "2026-01-02", from: "الصندوق", to: "البنك", amount: 30, desc: "" },
    ]);
    expect(t.note).toBe(
      "تقرير تحويلات داخلية فقط · من البنك إلى الصندوق: 100.000 · من الصندوق إلى البنك: 30.000 · " +
      "الصافي (داخل الصندوق): 70.000 د.ك · العدد: 2 · هذه الحركات لا تُحسب ضمن المنصرف ولا الوارد"
    );
    expect(t.note).not.toContain("داخل نفس المحفظة");
  });
  test("تحويلات بنفس المحفظة تُدرج قبل «العدد» حرفيًا", () => {
    const t = cashflowTransfersOnly([
      { vdate: "2026-01-01", from: "البنك", to: "الصندوق", amount: 100, desc: "" },
      { vdate: "2026-01-03", from: "بنك الأهلي", to: "بنك الخليج", amount: 5, desc: "" },
    ]);
    expect(t.note).toContain("داخل نفس المحفظة: 5.000 · العدد:");
    expect(t.note.indexOf("داخل نفس المحفظة")).toBeLessThan(t.note.indexOf("العدد:"));
    expect(t.totalsRow).toEqual(["الصافي", "", "", "", 100, ""]);
  });
});

describe("تنسيق الأرقام في الملاحظات (:,.3f مكتبية)", () => {
  test("آلاف بثلاث خانات", () => {
    const t = cashflowReceiptsOnly([{ vdate: "2026-01-01", party: "ع", contract: "", amount: 1234.5, desc: "" }]);
    expect(t.note).toContain("إجمالي الوارد: 1,234.500 د.ك");
  });
  test("صفر ⇒ 0.000", () => {
    const t = cashflowPaymentsOnly([]);
    expect(t.note).toContain("إجمالي المنصرف: 0.000 د.ك");
    expect(t.note).toContain("العدد: 0");
    expect(t.rows).toEqual([]);
  });
  test("تقريب 3 خانات (0.1+0.2 ⇒ 0.3)", () => {
    const t = cashflowReceiptsOnly([
      { vdate: "2026-01-01", party: "ع", contract: "", amount: 0.1, desc: "" },
      { vdate: "2026-01-02", party: "ع", contract: "", amount: 0.2, desc: "" },
    ]);
    expect(t.totalsRow[4]).toBe(0.3);
  });
});

describe("بيانات الرسم الشهري — مرآة cashflow_chart.py", () => {
  test("استخراج {label, in, out} من صفوف الوضع الشهري", () => {
    const rows: (string | number)[][] = [
      ["2026-08", 1500, 800, 10, 0, 0, 690, 1000],
      ["2026-09", 2000, 1200, 0, 100, 0, 900, 1900],
    ];
    expect(monthlyChartData(rows)).toEqual([
      { label: "2026-08", in: 1500, out: 800 },
      { label: "2026-09", in: 2000, out: 1200 },
    ]);
  });
  test("قائمة فارغة", () => {
    expect(monthlyChartData([])).toEqual([]);
  });
  test("تنسيق قيم الأعمدة: k للآلاف وفارغ للصفر", () => {
    expect(chartValueLabel(1000)).toBe("1k");
    expect(chartValueLabel(1234567)).toBe("1,235k");
    expect(chartValueLabel(750)).toBe("750");
    expect(chartValueLabel(999)).toBe("999");
    expect(chartValueLabel(0)).toBe("");
  });
});
