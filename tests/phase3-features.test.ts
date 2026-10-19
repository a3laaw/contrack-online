/**
 * اختبارات المرحلة 3 — المزايا والبوابات (bun test)
 *  · بوابة الميزة rep_* للتقارير (الخريطة الخادمية + الفلترة الواجهية)
 *  · حارس المبلغ amount_guard (المشاكل + رسالة المنع الصارم الحرفية + التوزيع النسبي)
 *  · توليد خطة القالب template_plan_mode (النسبة/اليدوي/المرنة + الاستحقاق)
 *  · اكتمال مفاتيح المرحلة 3/ج في الكتالوج
 */
import { describe, expect, test } from "bun:test";

import { REPORT_FEATURE } from "../src/lib/report-features";
import { REPORTS, visibleReports, DEFAULT_REPORT_KEY } from "../src/components/contrack/reports-list";
import { FEATURE_CATALOG, isEffectivelyEnabled } from "../src/lib/feature-flags";
import {
  AMOUNT_POLICIES,
  amountGuardProblems,
  amountGuardStrictMessage,
  scalePlanAmounts,
  templatePlanRows,
} from "../src/lib/contract-create";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ==================== 3/ب: بوابة المزايا للتقارير ====================

describe("بوابة rep_* للتقارير (المرحلة 3/ب)", () => {
  test("كل تقرير من الـ11 بمفتاح ميزة في الخريطة الخادمية عدا expenses (موثق)", () => {
    const sidebarKeys = REPORTS.map((r) => r.key);
    expect(sidebarKeys.length).toBe(11);
    for (const k of sidebarKeys) {
      if (k === "expenses") {
        expect(REPORT_FEATURE[k]).toBeUndefined();
        expect(REPORTS.find((r) => r.key === k)?.flag).toBeUndefined();
      } else {
        expect(REPORT_FEATURE[k]).toBeString();
        expect(REPORTS.find((r) => r.key === k)?.flag).toBe(REPORT_FEATURE[k]);
      }
    }
  });

  test("مفاتيح التقارير العشرة موجودة في كتالوج المزايا (المطابقة المكتبية)", () => {
    const catalog = new Set(FEATURE_CATALOG.map((f) => f.key));
    for (const feat of Object.values(REPORT_FEATURE)) {
      expect(catalog.has(feat)).toBe(true);
    }
  });

  test("مطابقة المفاتيح المكتبية حرفيًا (feature_service.py)", () => {
    expect(REPORT_FEATURE["customers-balances"]).toBe("rep_customers");
    expect(REPORT_FEATURE["stage-dues"]).toBe("rep_dues_board");
    expect(REPORT_FEATURE["supervision-delays"]).toBe("rep_supervision_delay");
    expect(REPORT_FEATURE["subcontractors"]).toBe("rep_subcontractors");
    expect(REPORT_FEATURE["vouchers"]).toBe("rep_vouchers");
    expect(REPORT_FEATURE["cashflow"]).toBe("rep_cashflow");
    expect(REPORT_FEATURE["contracts"]).toBe("rep_contracts");
    expect(REPORT_FEATURE["execution"]).toBe("rep_execution");
    expect(REPORT_FEATURE["leads"]).toBe("rep_leads");
    expect(REPORT_FEATURE["journal"]).toBe("rep_journal");
  });

  test("rep_execution مفعّل دائمًا (FORCED_ON كالمكتبي)", () => {
    expect(isEffectivelyEnabled("rep_execution", { rep_execution: false })).toBe(true);
  });

  test("visibleReports يخفي التقرير المعطّل ويحفظ البقية", () => {
    const all = visibleReports(() => true);
    expect(all.length).toBe(11);
    expect(DEFAULT_REPORT_KEY).toBe("customers-balances");
    const noJournal = visibleReports((k) => k !== "rep_journal");
    expect(noJournal.some((r) => r.key === "journal")).toBe(false);
    expect(noJournal.length).toBe(10);
  });
});

// ==================== 3/ج: حارس المبلغ amount_guard ====================

describe("amount_guard — المطابقة المكتبية (contracts.py)", () => {
  test("لا مشاكل داخل عتبة 0.001", () => {
    expect(amountGuardProblems(10_000, 10_000.0005)).toHaveLength(0);
    expect(amountGuardProblems(10_000, 9_999.9995)).toHaveLength(0);
  });

  test("الفرق اتجاهين (زائد وناقص) بمجموع الدفعات فقط", () => {
    const over = amountGuardProblems(10_000, 10_500);
    expect(over).toHaveLength(1);
    expect(over[0].label).toBe("مجموع الدفعات");
    expect(over[0].total).toBe(10_500);
    const under = amountGuardProblems(10_000, 8_000);
    expect(under).toHaveLength(1);
    expect(under[0].total).toBe(8_000);
  });

  test("بلا دفعات ⇒ لا مشاكل (الخطة تولد من المراحل/القالب)", () => {
    expect(amountGuardProblems(10_000, null)).toHaveLength(0);
  });

  test("رسالة المنع الصارم الحرفية من المكتبي", () => {
    const msg = amountGuardStrictMessage(10_000, amountGuardProblems(10_000, 10_500));
    expect(msg).toBe(
      "قيمة العقد: 10,000.000 د.ك\n" +
        "مجموع الدفعات: 10,500.000 د.ك (الفرق 500.000)\n" +
        "\nعدّل القيم حتى تتساوى قبل الحفظ.".slice(0) // السطر الفارغ ثم الجملة
    );
    expect(msg.startsWith("قيمة العقد: 10,000.000 د.ك")).toBe(true);
    expect(msg.includes("مجموع الدفعات: 10,500.000 د.ك (الفرق 500.000)")).toBe(true);
    expect(msg.endsWith("عدّل القيم حتى تتساوى قبل الحفظ.")).toBe(true);
  });

  test("السياسات الثلاث فقط (تحديث المبلغ/توزيع الدفعات/الحفظ بالفرق)", () => {
    expect([...AMOUNT_POLICIES]).toEqual(["update_amount", "scale_plan", "keep_diff"]);
  });

  test("التوزيع النسبي: مجموع النتيجة = المبلغ تمامًا (الأخيرة تأخذ الباقي — _rescale_plan_to)", () => {
    const target = 10_000;
    const scaled = scalePlanAmounts([3_000, 3_000, 4_500], target);
    expect(r3(scaled.reduce((s, a) => s + a, 0))).toBe(target);
    // النسب محفوظة: 3000/10500×10000 = 2857.143
    expect(scaled[0]).toBeCloseTo(2_857.143, 2);
    // الصف الأخير = الباقي
    expect(scaled[2]).toBe(r3(target - (scaled[0] + scaled[1])));
  });

  test("التوزيع النسبي يتخطى الصفوف الصفرية ويحفظ مواضعها", () => {
    const scaled = scalePlanAmounts([2_000, 0, 3_000], 6_000);
    expect(scaled[1]).toBe(0);
    expect(r3(scaled[0] + scaled[2])).toBe(6_000);
  });
});

// ==================== 3/ج: توليد خطة القالب ====================

describe("template_plan_mode — توليد الدفعات من قالب النوع (workflow_service)", () => {
  const T = (title: string, pct: number, amountFixed: number, daysOffset: number, triggerStageId: number | null = null) => ({
    title,
    pct,
    amountFixed,
    daysOffset,
    triggerStageId,
  });

  test("النسبة من قيمة العقد (round3)", () => {
    const rows = templatePlanRows([T("دفعة أولى", 30, 0, 0)], 12_345, "2026-01-01");
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(r3((12_345 * 30) / 100));
    expect(rows[0].dueDate).toBe("2026-01-01");
    expect(rows[0].title).toBe("دفعة أولى");
  });

  test("المبلغ اليدوي كما هو + الاستحقاق بتاريخ العقد + الأيام", () => {
    const rows = templatePlanRows([T("دفعة ثانية", 0, 2_500, 30)], 10_000, "2026-01-15");
    expect(rows[0].amount).toBe(2_500);
    expect(rows[0].dueDate).toBe("2026-02-14"); // 15 يناير + 30 يومًا
  });

  test("«المرنة» (بلا نسبة ولا مبلغ) لا تُدرج أصلًا", () => {
    const rows = templatePlanRows(
      [T("مقدمة", 20, 0, 0), T("مرنة", 0, 0, 10), T("ختامية", 80, 0, 60)],
      10_000,
      "2026-03-01"
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.title)).toEqual(["مقدمة", "ختامية"]);
  });

  test("بلا مبلغ عقد أو بلا تاريخ ⇒ لا صفوف", () => {
    expect(templatePlanRows([T("دفعة", 50, 0, 0)], 0, "2026-01-01")).toHaveLength(0);
    expect(templatePlanRows([T("دفعة", 50, 0, 0)], 10_000, "")).toHaveLength(0);
  });

  test("عنوان افتراضي «الدفعة N» بترقيم الصفوف المدرجة فقط", () => {
    const rows = templatePlanRows(
      [T("", 20, 0, 0), T("", 0, 0, 5), T("", 30, 0, 10)],
      1_000,
      "2026-01-01"
    );
    expect(rows.map((r) => r.title)).toEqual(["الدفعة 1", "الدفعة 2"]);
  });

  test("مرحلة الربط تمر مع الصف", () => {
    const rows = templatePlanRows([T("دفعة", 50, 0, 0, 77)], 1_000, "2026-01-01");
    expect(rows[0].triggerStageId).toBe(77);
  });
});

// ==================== 3/ج: مفاتيح المرحلة في الكتالوج ====================

describe("مفاتيح المرحلة 3/ج في الكتالوج", () => {
  const keys = new Set(FEATURE_CATALOG.map((f) => f.key));
  test("المفاتيح السبعة موجودة", () => {
    for (const k of [
      "amount_guard",
      "settle_edit",
      "mode_banner",
      "bank_fee",
      "items_sync",
      "template_plan_mode",
      "notif_cleanup",
    ]) {
      expect(keys.has(k)).toBe(true);
    }
  });

  test("template_plan_mode يعتمد payment_plan وitems_sync يعتمد البنود والخطة (كالمكتبي)", () => {
    const spec = (k: string) => FEATURE_CATALOG.find((f) => f.key === k)!;
    expect(spec("template_plan_mode").requires).toContain("payment_plan");
    expect(spec("items_sync").requires).toContain("boq_items");
    expect(spec("items_sync").requires).toContain("payment_plan");
    expect(spec("notif_cleanup").requires).toContain("followup");
    expect(spec("bank_fee").requires).toContain("cashflow");
    expect(spec("settle_edit").requires).toContain("custody");
  });

  test("تعطيل amount_guard لا يتأثر بغياب الصف (الافتراضي true كالمكتبي)", () => {
    expect(isEffectivelyEnabled("amount_guard", {})).toBe(true);
    expect(isEffectivelyEnabled("amount_guard", { amount_guard: false })).toBe(false);
    // سلسلة الاعتماد: bank_fee معطّل إذا عُطّل cashflow (الأشياء المتداخلة)
    expect(isEffectivelyEnabled("bank_fee", { cashflow: false })).toBe(false);
  });
});
