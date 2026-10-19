/**
 * اختبار المرحلة 8 — بنّاء HTML لكشف الحساب (PDF خادميًا)
 * المرجع الحرفي المكتبي: contrack_v9.15.18/app/reports/statement_pdf.py
 *   _header (شريط اللون الأساسي + اسم الشركة + «العنوان | هاتف: … | البريد» + العنوان)
 *   بطاقة العميل/العقد (العميل: الاسم (الكود) · هاتف/عنوان · العقد | التاريخ | القيمة)
 *   الجدول RTL: التاريخ | البيان | المرجع | مدين | دائن | الرصيد («—» عند الصفر، :,.3f)
 *   صندوق الإجماليات 112مم يسار الصفحة بتسميات المكتبي وألوان primary/accent/أخضر-أحمر
 *   التذييل: «تاريخ الإصدار: … · {company_name}»
 *   الكشف الشامل: عمود «العقد» + سطر «النطاق/الفترة» + «رصيد أول الفترة» + تظليل غير الحركات
 */

import { describe, expect, test } from "bun:test";
import {
  buildCustomerStatementHtml,
  buildStatementHtml,
} from "@/lib/pdf/statement-html";

const COMPANY = {
  name: "شركة الأفق للمقاولات",
  address: "الكويت — حولي",
  phone: "99999999",
  email: "info@ofoq.example",
};

const OPTS = { company: COMPANY, currency: "د.ك", issuedAt: "2026-01-15 10:30" };

const CONTRACT_DATA = {
  customer: { name: "عميل الاختبار", customerCode: "C-0001", phone: "5551234", address: "الجهراء" },
  contract: { contractNumber: "CON-0012", contractDate: "2026-10-01", amount: 17500, description: "أعمال مدنية" },
  rows: [
    { date: "2026-10-01", ref: "", desc: "قيمة العقد", debit: 7500, credit: 0, balance: 7500, kind: "move" },
    { date: "2026-10-05", ref: "RV-0001", desc: "سند قبض", debit: 0, credit: 2000, balance: 5500, kind: "move" },
  ],
  totals: { debit: 7500, credit: 2000, remaining: 5500 },
};

const CUSTOMER_DATA = {
  customer: { name: "عميل الشامل", customerCode: "C-0014", phone: "5550000" },
  contractsCount: 2,
  contractNumber: null as string | null,
  rows: [
    { date: "2026-10-01", ref: "", desc: "قيمة العقد", debit: 7500, credit: 0, balance: 7500, kind: "move", contractNumber: "CON-0012" },
    { date: "", ref: "CON-0012", desc: "إجمالي العقد CON-0012", debit: 7500, credit: 2000, balance: 5500, kind: "subtotal", contractNumber: "CON-0012" },
    { date: "", ref: "", desc: "الإجمالي العام", debit: 7500, credit: 2000, balance: 5500, kind: "total" },
  ],
  totals: { debit: 7500, credit: 2000, remaining: 5500, opening: 0 },
  dateFrom: "",
  dateTo: "",
};

describe("buildStatementHtml — كشف العقد", () => {
  const html = buildStatementHtml(CONTRACT_DATA, OPTS);

  test("مستند HTML كامل RTL مع A4 و15مم والخط العربي المضمّن", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("@page");
    expect(html).toContain("A4");
    expect(html).toContain("15mm");
    expect(html).toContain("data:font/ttf;base64,");
    expect(html).toContain("NotoNaskhArabic");
  });

  test("الترويسة: اسم الشركة بنيّة وبيانات الاتصال حسب الحضور والعنوان «كشف حساب عميل»", () => {
    expect(html).toContain("شركة الأفق للمقاولات");
    expect(html).toContain("هاتف: 99999999");
    expect(html).toContain("info@ofoq.example");
    expect(html).toContain("كشف حساب عميل");
    expect(html).toMatch(/class="hdr-company"[^<]*>شركة الأفق للمقاولات</);
  });

  test("بطاقة العميل والعقد: الاسم (الكود) والهاتف/العنوان وسطر العقد بالقيمة :,.3f", () => {
    expect(html).toContain("العميل: عميل الاختبار");
    expect(html).toContain("(C-0001)");
    expect(html).toContain("هاتف: 5551234");
    expect(html).toContain("العقد: CON-0012");
    expect(html).toContain("التاريخ: 2026-10-01");
    expect(html).toContain("القيمة: 17,500.000 د.ك");
    expect(html).toContain("أعمال مدنية");
  });

  test("أعمدة الجدول بترتيب المكتبي RTL", () => {
    const headOrder = ["التاريخ", "البيان", "المرجع", "مدين", "دائن", "الرصيد"];
    let last = -1;
    for (const h of headOrder) {
      const idx = html.indexOf(`>${h}<`);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
  });

  test("المبالغ: صفر ⇒ «—» وغير الصفر بفواصل آلاف و3 خانات", () => {
    expect(html).toContain("7,500.000");
    expect(html).toContain("2,000.000");
    expect(html).toContain(">—</td>");
    expect(html).not.toContain("7500");
  });

  test("الرصيد بخط عريض (صف balance bold)", () => {
    expect(html).toContain("5,500.000");
    expect(html).toMatch(/class="[^"]*balance[^"]*"/);
  });

  test("تسميات صندوق الإجماليات حرفيًا كالمكتبي مع العملة", () => {
    expect(html).toContain("إجمالي المدين (العقد والإضافات)");
    expect(html).toContain("إجمالي الدائن (المحصّل والخصومات)");
    expect(html).toContain("الرصيد المتبقي");
    expect(html).toContain("7,500.000 د.ك");
  });

  test("منطق لون الرصيد: موجب ⇒ pos وأسالب ⇒ neg", () => {
    const pos = buildStatementHtml(CONTRACT_DATA, OPTS);
    expect(pos).toMatch(/class="tot-value[^"]*pos/);
    const neg = buildStatementHtml(
      { ...CONTRACT_DATA, totals: { debit: 2000, credit: 7500, remaining: -5500 } },
      OPTS
    );
    expect(neg).toMatch(/class="tot-value[^"]*neg/);
    expect(neg).toContain("-5,500.000 د.ك");
  });

  test("التذييل: تاريخ الإصدار المعطى + اسم الشركة", () => {
    expect(html).toContain("تاريخ الإصدار: 2026-01-15 10:30 · شركة الأفق للمقاولات");
  });

  test("تظليل الصفوف الزوجية (index%2==0) بلا تظليل للفردية", () => {
    expect(html).toMatch(/<tr class="stripe">/);
    // صف واحد فقط من صفّي البيانات هو الزوجي (الأول)
    const stripes = html.match(/<tr class="stripe">/g) || [];
    expect(stripes.length).toBe(1);
  });

  test("ترويسة الجدول تتكرر عبر صفحات الطباعة (table-header-group)", () => {
    expect(html).toContain("table-header-group");
  });

  test("اللون الأساسي: الافتراضي #1F3A5F ويُستبدل عند تمرير primary", () => {
    expect(html).toContain("#1F3A5F");
    const custom = buildStatementHtml(CONTRACT_DATA, { ...OPTS, primary: "#4A1F5F" });
    expect(custom).toContain("#4A1F5F");
    expect(custom).not.toContain("#1F3A5F");
  });

  test("تهريب HTML في القيم النصية", () => {
    const escaped = buildStatementHtml(
      {
        ...CONTRACT_DATA,
        customer: { ...CONTRACT_DATA.customer, name: `شركة <أ&ب>` },
      },
      OPTS
    );
    expect(escaped).toContain("شركة &lt;أ&amp;ب&gt;");
    expect(escaped).not.toContain("شركة <أ&ب>");
  });
});

describe("buildCustomerStatementHtml — الكشف الشامل", () => {
  const html = buildCustomerStatementHtml(CUSTOMER_DATA, OPTS);

  test("سبعة أعمدة: «العقد» ثانيًا بعد التاريخ", () => {
    const headOrder = ["التاريخ", "العقد", "البيان", "المرجع", "مدين", "دائن", "الرصيد"];
    let last = -1;
    for (const h of headOrder) {
      const idx = html.indexOf(`>${h}<`);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
  });

  test("سطر النطاق: كل العقود (2) | الفترة: الكل", () => {
    expect(html).toContain("النطاق: كل العقود (2)");
    expect(html).toContain("الفترة: الكل");
    expect(html).toContain("كشف حساب عميل — شامل");
  });

  test("الفترة عند وجود تواريخ: «الفترة: من ← إلى» والحدود الغائبة «…»", () => {
    const withPeriod = buildCustomerStatementHtml(
      { ...CUSTOMER_DATA, dateFrom: "2026-01-01", dateTo: "2026-01-31" },
      OPTS
    );
    expect(withPeriod).toContain("الفترة: 2026-01-01 ← 2026-01-31");
    const half = buildCustomerStatementHtml({ ...CUSTOMER_DATA, dateFrom: "2026-01-01", dateTo: "" }, OPTS);
    expect(half).toContain("الفترة: 2026-01-01 ← …");
  });

  test("النطاق بعقد محدد: «العقد: CON-0012»", () => {
    const scoped = buildCustomerStatementHtml({ ...CUSTOMER_DATA, contractNumber: "CON-0012" }, OPTS);
    expect(scoped).toContain("النطاق: العقد: CON-0012");
  });

  test("الإجماليات: تسميات الشامل بلا أقواس + «رصيد أول الفترة» أولًا عند وجود من", () => {
    expect(html).toContain("إجمالي المدين");
    expect(html).not.toContain("إجمالي المدين (العقد والإضافات)");
    const withFrom = buildCustomerStatementHtml(
      { ...CUSTOMER_DATA, dateFrom: "2026-01-01", totals: { debit: 7500, credit: 2000, remaining: 5500, opening: 1200 } },
      OPTS
    );
    const idxOpening = withFrom.indexOf("رصيد أول الفترة");
    const idxDebit = withFrom.indexOf("إجمالي المدين");
    expect(idxOpening).toBeGreaterThan(-1);
    expect(idxOpening).toBeLessThan(idxDebit);
    expect(withFrom).toContain("1,200.000 د.ك");
    // بلا «من» لا سطر رصيد أول الفترة في الصندوق
    expect(html.indexOf("رصيد أول الفترة")).toBe(-1);
  });

  test("تظليل صفوف غير الحركات (subtotal/total) بخلايا وصف عريض", () => {
    expect(html).toMatch(/<tr class="shade">/);
    const shades = html.match(/<tr class="shade">/g) || [];
    expect(shades.length).toBe(2);
    expect(html).toMatch(/class="desc bold"/);
  });

  test("عمود العقد: رقم العقد للحركات و«—» عند غيابه للحركة وفارغ لغيرها", () => {
    // حركة CON-0012 موجودة
    expect(html).toContain("CON-0012");
    // حركة بلا رقم عقد ⇒ «—» (حركة فقط)
    const withMissing = buildCustomerStatementHtml(
      {
        ...CUSTOMER_DATA,
        rows: [
          ...CUSTOMER_DATA.rows,
          { date: "2026-10-09", ref: "RV-0002", desc: "سند قبض", debit: 0, credit: 500, balance: 5000, kind: "move" },
        ],
      },
      OPTS
    );
    expect(withMissing).toContain(">—</td>");
  });
});
