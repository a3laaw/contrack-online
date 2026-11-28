/**
 * اختبارات نواة ج2 «مؤشرات القيمة المكتسبة EVM» — فوق مخرجات م1 حصرًا.
 * docs/project-dashboard-design.md §3 + §8 — نواة نقية حصرًا (بلا DB):
 * BAC أرضية BOQ · PV من نوافذ ج1 · EV برؤيتين من م1 · AC بثلاثة مكوّنات
 * معلنة · القسمة على صفر null لا صفر · البنود المتأخرة بالميداني ·
 * المال والحرق · المنحنى الثلاثي · التحذيرات بالعتبات.
 */
import { describe, expect, test } from "bun:test";

import {
  EVM_DEFAULT_THRESHOLDS,
  deriveEvm,
  deriveEvmSCurve,
  parseEvmThresholds,
  safeDiv,
  type EvmInvoiceInput,
  type EvmLaborInput,
  type EvmMaterialInput,
  type EvmPlanInput,
  type EvmVoucherInput,
} from "../src/lib/evm-core";
import type { ForecastRow, SCurvePoint } from "../src/lib/forecast-core";

const row = (over: Partial<ForecastRow>): ForecastRow => ({
  boqItemId: 1,
  itemNo: "03.30.01",
  divisionCode: "03",
  divisionName: "CONCRETE",
  description: "خرسانة مسلحة",
  unit: "م³",
  contractQty: 100,
  unitPrice: 50,
  fieldQty: 60,
  documentedQty: 50,
  officialQty: 40,
  gapQty: 20,
  gapValue: 1000,
  remainingQty: 40,
  fieldAmount: 3000,
  officialAmount: 2000,
  ratePerDay: 2,
  expectedFinish: null,
  ...over,
});

const plan = (over: Partial<EvmPlanInput>): EvmPlanInput => ({
  boqItemId: 1,
  plannedStart: "2026-09-01",
  plannedFinish: "2026-11-10",
  ...over,
});

const pay = (over: Partial<EvmVoucherInput>): EvmVoucherInput => ({ vdate: "2026-10-05", amount: 1500, ...over });
const rec = (over: Partial<EvmVoucherInput>): EvmVoucherInput => ({ vdate: "2026-11-01", amount: 4000, ...over });
const labor = (over: Partial<EvmLaborInput>): EvmLaborInput => ({ amount: 300, batchMonth: "2026-10", batchStatus: "approved", ...over });
const material = (over: Partial<EvmMaterialInput>): EvmMaterialInput => ({ vdate: "2026-10-10", amount: 400, boqItemId: 1, ...over });
const inv = (over: Partial<EvmInvoiceInput>): EvmInvoiceInput => ({
  total: 5000,
  retentionAmount: 500,
  retentionReleased: false,
  approveDate: "2026-11-05",
  ...over,
});

const m1Curve: SCurvePoint[] = [{ date: "2026-11-05", fieldCum: 3000, officialCum: 2000 }];

/** السيناريو المرجعي (أ) — بندان: أحدهما متأخر والآخر مستقبلي مكتمل ميدانيًا */
const scenarioA = () => ({
  today: "2026-11-20",
  rows: [
    row({ boqItemId: 1 }), // قيمة 5000 · ميداني 3000 · رسمي 2000
    row({
      boqItemId: 2,
      itemNo: "05.10.01",
      divisionCode: "05",
      divisionName: "STEEL",
      contractQty: 200,
      unitPrice: 20,
      fieldQty: 200,
      documentedQty: 200,
      officialQty: 200,
      gapQty: 0,
      gapValue: 0,
      remainingQty: 0,
      fieldAmount: 4000,
      officialAmount: 4000,
      expectedFinish: null,
    }), // قيمة 4000 · مكتمل تمامًا
  ],
  plans: [
    plan({ boqItemId: 1, plannedStart: "2026-09-01", plannedFinish: "2026-11-10" }),
    plan({ boqItemId: 2, plannedStart: "2026-08-01", plannedFinish: "2026-12-01" }),
  ],
  paymentVouchers: [pay(), pay({ vdate: "2026-11-15", amount: 500 })],
  receiptVouchers: [rec()],
  laborAllocations: [
    labor(),
    labor({ amount: 100, batchMonth: "2026-11", batchStatus: "draft" }), // مسودة لا تكلفة
    labor({ amount: 200, batchMonth: "2026-12", batchStatus: "paid" }), // شهر مستقبلي
    labor({ amount: 50, batchMonth: "2026-09", batchStatus: "cancelled" }), // ملغاة
  ],
  materialLines: [material(), material({ vdate: "2026-11-25", amount: 700 })], // المستقبلي مستبعد
  approvedInvoices: [
    inv(),
    inv({ total: 800, retentionAmount: 80, retentionReleased: true, approveDate: "2026-10-01" }), // مفرج عنه
    inv({ total: 1000, retentionAmount: 100, approveDate: "2026-11-25" }), // مستقبلي
  ],
  sCurve: m1Curve,
});

describe("evm-core — safeDiv والقسمة على صفر (§8.2.5)", () => {
  test("القسمة السليمة بدقة 3 منازل", () => {
    expect(safeDiv(10, 4)).toBe(2.5);
    expect(safeDiv(6000, 5000)).toBe(1.2);
  });

  test("القسمة على صفر ⇒ null لا صفر — وصفر لا يعني تأخرًا ولا كفاءة", () => {
    expect(safeDiv(10, 0)).toBe(null);
    expect(safeDiv(10, -5)).toBe(null);
  });
});

describe("evm-core — السيناريو المرجعي (أ): المؤشرات", () => {
  const r = deriveEvm(scenarioA());

  test("BAC أرضية BOQ = Σ تعاقدي×سعر للبنود الظاهرة (§8.2.1)", () => {
    expect(r.bac).toBe(9000); // 5000 + 4000
  });

  test("PV بالاستحقاق الخطي داخل النافذة — ب2 §12 (§8.2.2 مُرقّى)", () => {
    // بند 1: نافذته انتهت 11-10 ⇒ كامل 5000 · بند 2: نافذة 123 يومًا (08-01→12-01 شاملًا)
    // والمنقضي حتى 11-20 = 112 يومًا شاملًا ⇒ 4000×112/123 = 3642.276
    expect(r.pv).toBe(8642.276);
    expect(r.pvPct).toBe(96.0); // 8642.276/9000
  });

  test("pvPlan — الدلاء الشهرية للمخطط (ب2 §12.4)", () => {
    // بند1: 30/71 + 31/71 + 10/71 من 5000 بالأشهر 09/10/11 · بند2: 31/123+30/123+31/123+30/123+1/123 من 4000
    expect(r.pvPlan.byMonth.map((m) => m.month)).toEqual(["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
    expect(r.pvPlan.byMonth[0]).toEqual({ month: "2026-08", planned: 1008.13, plannedCum: 1008.13 });
    expect(r.pvPlan.byMonth[1].planned).toBe(3088.286);
    expect(r.pvPlan.byMonth[2].planned).toBe(3191.229);
    expect(r.pvPlan.byMonth[3].planned).toBe(1679.835);
    expect(r.pvPlan.byMonth[4]).toEqual({ month: "2026-12", planned: 32.52, plannedCum: 9000 });
  });

  test("EV برؤيتين من م1 حصرًا (§8.2.3)", () => {
    expect(r.evOfficial).toBe(6000); // 2000 + 4000
    expect(r.evField).toBe(7000); // 3000 + 4000
    expect(r.evOfficialPct).toBe(66.7);
    expect(r.evFieldPct).toBe(77.8);
  });

  test("AC بثلاثة مكوّنات معلنة: سندات + رواتب معتمدة بشهرها + مواد (§8.2.4)", () => {
    expect(r.acBreakdown.vouchers).toBe(2000); // 1500 + 500
    expect(r.acBreakdown.labor).toBe(300); // المسودة والمستقبلي والملغاة مستبعدة
    expect(r.acBreakdown.materials).toBe(400); // المستقبلي مستبعد
    expect(r.ac).toBe(2700);
  });

  test("SPI/CPI/EAC برؤيتين — بدقة الأرقام المحسوبة", () => {
    expect(r.spiOfficial).toBe(0.694); // 6000/8642.276 بالاستحقاق الخطي
    expect(r.spiField).toBe(0.81); // 7000/8642.276
    expect(r.cpiOfficial).toBe(2.222); // 6000/2700
    expect(r.cpiField).toBe(2.593); // 7000/2700
    expect(r.eacOfficial).toBe(4050); // 9000×2700/6000 بالنسبة الخام جبريًا
    expect(r.eacField).toBe(3471.429); // 9000×2700/7000
  });

  test("البنود المتأخرة: غير المكتمل ميدانيًا ونافذته فاتت (§8.2.7)", () => {
    expect(r.delayedItems).toHaveLength(1); // بند 2 مكتمل وبنافذة مستقبلية — خارج التأخر
    const d = r.delayedItems[0];
    expect(d.boqItemId).toBe(1);
    expect(d.plannedFinish).toBe("2026-11-10");
    expect(d.delayDays).toBe(10); // 11-10 → 11-20
    expect(d.fieldPct).toBe(60);
  });

  test("الأقسام: الأوزان والأداء مشتقًا والترتيب بالقيمة (§8.2.8)", () => {
    expect(r.divisions).toHaveLength(2);
    const concrete = r.divisions[0];
    expect(concrete.divisionName).toBe("CONCRETE");
    expect(concrete.value).toBe(5000);
    expect(concrete.weightPct).toBe(55.6);
    expect(concrete.plannedPct).toBe(100);
    expect(concrete.fieldPct).toBe(60);
    expect(concrete.officialPct).toBe(40);
    expect(concrete.delayedCount).toBe(1);
    expect(concrete.maxDelayDays).toBe(10);
    const steel = r.divisions[1];
    expect(steel.value).toBe(4000);
    expect(steel.weightPct).toBe(44.4);
    expect(steel.plannedPct).toBe(91.1); // الاستحقاق الخطي 3642.276/4000 — ب2 §12.3
    expect(steel.fieldPct).toBe(100);
    expect(steel.delayedCount).toBe(0);
  });

  test("بطاقة الرأس: المدة شاملة الطرفين والمنقضي مقيّد والإتمام المتوقع من م1 (§8.2.9)", () => {
    expect(r.header.projectStart).toBe("2026-08-01");
    expect(r.header.plannedFinishMax).toBe("2026-12-01");
    expect(r.header.durationDays).toBe(123); // 08-01 → 12-01 شاملًا
    expect(r.header.elapsedDays).toBe(111); // 08-01 → 11-20
    expect(r.header.elapsedPct).toBe(90.2); // 111/123
    expect(r.header.expectedFinish).toBe(null); // بند 2 بلا اكتمال متوقع وبند 1 غير مثبت هنا
  });

  test("المال: المفوتر بالمُفكوك والمحتجز بغير المفرج والنقد والحرق (§8.2.10)", () => {
    expect(r.money.billed).toBe(5800); // 5000 + 800 — المستقبلي مستبعد
    expect(r.money.retentionOutstanding).toBe(500); // المفرج عنه مستبعد
    expect(r.money.collected).toBe(4000);
    expect(r.money.cashRemaining).toBe(1300); // 4000 − 2700
    expect(r.money.burnPerDay).toBe(52.941); // 2700 ÷ 51 يومًا (من 10-01 شاملًا)
    expect(r.money.runwayDays).toBe(24); // floor(1300/52.941)
  });

  test("التحذيرات: بالاستحقاق الخطي SPI دون العتبة يشتعل مع المتأخرة (§8.2.12)", () => {
    // SPI الرسمي 0.694 والميداني 0.81 كلاهما دون 0.95 بالخطي — والمتأخر 10 > 7
    expect(r.warnings).toHaveLength(3);
    expect(r.warnings.map((w) => w.kind)).toEqual(["spi_official", "spi_field", "delayed_items"]);
    const delayed = r.warnings[2];
    expect(delayed.message).toContain("بندًا متأخرًا");
    expect(delayed.message).toContain("03.30.01");
  });

  test("المنحنى الثلاثي: المخطط بخطوات شهرية عند نهاية الشهر — ب2 §12.1 (§8.2.6)", () => {
    // اتحاد: نهايات الأشهر الخمسة + م1 (11-05) + الختام (11-20)
    expect(r.sCurve).toHaveLength(7);
    expect(r.sCurve[0]).toEqual({ date: "2026-08-31", plannedCum: 1008.13, officialCum: 0, fieldCum: 0 });
    expect(r.sCurve[1]).toEqual({ date: "2026-09-30", plannedCum: 4096.416, officialCum: 0, fieldCum: 0 });
    expect(r.sCurve[2]).toEqual({ date: "2026-10-31", plannedCum: 7287.645, officialCum: 0, fieldCum: 0 });
    expect(r.sCurve[3]).toEqual({ date: "2026-11-05", plannedCum: 7287.645, officialCum: 2000, fieldCum: 3000 });
    expect(r.sCurve[4]).toEqual({ date: "2026-11-20", plannedCum: 7287.645, officialCum: 2000, fieldCum: 3000 });
    expect(r.sCurve[5]).toEqual({ date: "2026-11-30", plannedCum: 8967.48, officialCum: 2000, fieldCum: 3000 });
    expect(r.sCurve[6]).toEqual({ date: "2026-12-31", plannedCum: 9000, officialCum: 2000, fieldCum: 3000 });
  });
});

describe("evm-core — العتبات بالباراميتر والتحذيرات بالرؤيتين (§8.1)", () => {
  test("عتبة تأخر أعلى تُطفئ تحذير التأخر — وSPI الخطي يبقى مشتعلًا", () => {
    const r = deriveEvm({ ...scenarioA(), thresholds: { ...EVM_DEFAULT_THRESHOLDS, maxDelayDays: 14 } });
    // التأخر 10 ≤ 14 لا يشعل — لكن SPI الرسمي 0.694 والميداني 0.81 كلاهما دون العتبة
    expect(r.warnings.map((w) => w.kind)).toEqual(["spi_official", "spi_field"]);
    expect(r.warnings).not.toContainEqual(expect.objectContaining({ kind: "delayed_items" }));
  });

  test("SPI ميداني متأخر بالعتبة المرفوعة — يشتعل بمؤشره لا غيره", () => {
    const base = scenarioA();
    const r = deriveEvm({
      ...base,
      rows: [base.rows[0]], // الرسمي 2000/ميداني 3000 على PV 5000
      plans: [base.plans[0]],
      paymentVouchers: [],
      laborAllocations: [],
      materialLines: [],
      approvedInvoices: [],
      receiptVouchers: [],
      thresholds: { spiMin: 0.7, cpiMin: 0.95, maxDelayDays: 14 }, // الرسمي 0.4 يعيبه · الميداني 0.6 يعيبه · التأخر 10 ≤ 14 لا يشعل
    });
    const kinds = r.warnings.map((w) => w.kind);
    expect(kinds).toContain("spi_official"); // 0.4 < 0.7
    expect(kinds).toContain("spi_field"); // 0.6 < 0.7
    expect(kinds).not.toContain("cpi_official"); // بلا AC ⇒ null لا تشعل
    expect(kinds).not.toContain("cpi_field");
    expect(kinds).not.toContain("delayed_items"); // 10 ≤ 14
  });
});

describe("evm-core — بلا PV وبلا AC: null لا صفر ولا تحذير (§8.2.5)", () => {
  const base = scenarioA();
  const r = deriveEvm({ ...base, plans: [], paymentVouchers: [], laborAllocations: [], materialLines: [] });

  test("SPI/EAC null بلا PV — وCPI null بلا AC", () => {
    expect(r.pv).toBe(0);
    expect(r.ac).toBe(0);
    expect(r.spiOfficial).toBe(null);
    expect(r.spiField).toBe(null);
    expect(r.cpiOfficial).toBe(null);
    expect(r.cpiField).toBe(null);
    expect(r.eacOfficial).toBe(null);
    expect(r.eacField).toBe(null);
  });

  test("بلا مؤشرات ⇒ صفر تحذيرات — والنقد المتبقي بلا صرف = كل القبض", () => {
    expect(r.warnings).toHaveLength(0);
    expect(r.money.cashRemaining).toBe(4000); // قبض 4000 − صرف 0
    expect(r.money.runwayDays).toBe(null); // حرق صفري ⇒ null
  });
});

describe("evm-core — التدريجية: بلا بنود ⇒ المال يشتغل وEVM صفري (§6)", () => {
  const r = deriveEvm({
    today: "2026-11-20",
    rows: [],
    plans: [],
    paymentVouchers: [pay()],
    receiptVouchers: [rec()],
    laborAllocations: [labor()],
    materialLines: [],
    approvedInvoices: [inv()],
    sCurve: [],
  });

  test("كل المؤشرات المبنية على البنود صفري/null والأقسام فارغة", () => {
    expect(r.bac).toBe(0);
    expect(r.pv).toBe(0);
    expect(r.evOfficial).toBe(0);
    expect(r.evField).toBe(0);
    expect(r.divisions).toHaveLength(0);
    expect(r.delayedItems).toHaveLength(0);
    expect(r.header.projectStart).toBe(null);
    expect(r.header.durationDays).toBe(null);
    expect(r.header.elapsedPct).toBe(null);
    expect(r.sCurve).toHaveLength(0);
  });

  test("المال يعمل حصرًا: المفوتر والقبض وAC بالسند والرواتب", () => {
    expect(r.money.billed).toBe(5000);
    expect(r.money.retentionOutstanding).toBe(500);
    expect(r.money.collected).toBe(4000);
    expect(r.ac).toBe(1800); // 1500 + 300
    expect(r.money.cashRemaining).toBe(2200);
    expect(r.money.burnPerDay).toBe(35.294); // 1800 ÷ 51 يومًا (أول صرف 10-05)
    expect(r.money.runwayDays).toBe(62); // floor(2200/35.294)
  });
});

describe("evm-core — الوضع التاريخي: المرجعي asOf يفلتر كل المصادر (§8.2.11)", () => {
  const base = scenarioA();
  const r = deriveEvm({ ...base, today: "2026-10-15" });

  test("المؤشرات عند التاريخ: PV بالاستحقاق الخطي حتى 10-15 وSPI فوق الواحد", () => {
    // بند1: 45/71 من 5000 = 3169.014 · بند2: 76/123 من 4000 = 2471.545 ⇒ pv = 5640.559
    expect(r.pv).toBe(5640.559);
    expect(r.spiOfficial).toBe(1.064); // 6000/5640.559 — الرواية ساكنة بالمصدر في هذه الحافظة
    expect(r.spiField).toBe(1.241); // 7000/5640.559
    expect(r.delayedItems).toHaveLength(0); // نافذة البند 11-10 بعد التاريخ
  });

  test("AC عند التاريخ: سند 11-15 ومواد 11-25 مستبعدان والرواتب بشهر ≤ 10", () => {
    expect(r.acBreakdown.vouchers).toBe(1500);
    expect(r.acBreakdown.labor).toBe(300);
    expect(r.acBreakdown.materials).toBe(400);
    expect(r.ac).toBe(2200);
  });

  test("المال عند التاريخ: فاتورة 11-05 و11-25 مستبعدتان", () => {
    expect(r.money.billed).toBe(800);
    expect(r.money.retentionOutstanding).toBe(0); // 80 مفرج عنه
    expect(r.money.collected).toBe(0); // قبض 11-01 بعد التاريخ
    expect(r.money.cashRemaining).toBe(-2200);
    expect(r.money.runwayDays).toBe(null); // نقد سالب
  });

  test("الحرق عند التاريخ بأول صرف ضمن النافذة", () => {
    expect(r.money.burnPerDay).toBe(146.667); // 2200 ÷ 15 يومًا (من 10-01 — شهر الرواتب — شاملًا)
  });
});

describe("evm-core — deriveEvmSCurve نقية", () => {
  test("منحنى م1 فارغ وبلا مخطط ⇒ فارغ", () => {
    expect(deriveEvmSCurve([], new Map(), "2026-11-20")).toHaveLength(0);
  });

  test("المخطط وحده بلا حركات: نقطة عند كل نافذة + الختام", () => {
    const out = deriveEvmSCurve([], new Map([["2026-11-10", 5000]]), "2026-11-20");
    expect(out).toEqual([
      { date: "2026-11-10", plannedCum: 5000, officialCum: 0, fieldCum: 0 },
      { date: "2026-11-20", plannedCum: 5000, officialCum: 0, fieldCum: 0 },
    ]);
  });

  test("م1 وحده: يمر عبره بترحيل ونقطة ختامية عند اليوم", () => {
    const out = deriveEvmSCurve(m1Curve, new Map(), "2026-11-20");
    expect(out).toEqual([
      { date: "2026-11-05", plannedCum: 0, officialCum: 2000, fieldCum: 3000 },
      { date: "2026-11-20", plannedCum: 0, officialCum: 2000, fieldCum: 3000 },
    ]);
  });
});

describe("evm-core — parseEvmThresholds تدقيق عتبات الإعدادات (ج3 §9.3)", () => {
  test("بلا مدخل ⇒ الافتراضي حرفيًا", () => {
    expect(parseEvmThresholds()).toEqual(EVM_DEFAULT_THRESHOLDS);
    expect(parseEvmThresholds(undefined)).toEqual(EVM_DEFAULT_THRESHOLDS);
    expect(parseEvmThresholds({})).toEqual(EVM_DEFAULT_THRESHOLDS);
  });

  test("قيم صالحة تُمر كما هي — والنص الرقمي (Decimal كنص) يُقبل", () => {
    expect(parseEvmThresholds({ spiMin: 0.9, cpiMin: "0.85", maxDelayDays: 14 })).toEqual({
      spiMin: 0.9,
      cpiMin: 0.85,
      maxDelayDays: 14,
    });
    expect(parseEvmThresholds({ spiMin: "0.95", cpiMin: "0.95", maxDelayDays: "10" })).toEqual({
      spiMin: 0.95,
      cpiMin: 0.95,
      maxDelayDays: 10,
    });
  });

  test("خارج النطاق ⇒ سقوط للافتراضي لا قبول فاسد", () => {
    // صفر وسالب وفوق الواحد وغير رقم — كلها سقوط
    expect(parseEvmThresholds({ spiMin: 0 })!.spiMin).toBe(0.95);
    expect(parseEvmThresholds({ spiMin: -0.5 })!.spiMin).toBe(0.95);
    expect(parseEvmThresholds({ cpiMin: 1.5 })!.cpiMin).toBe(0.95);
    expect(parseEvmThresholds({ cpiMin: "abc" })!.cpiMin).toBe(0.95);
    expect(parseEvmThresholds({ spiMin: Infinity })!.spiMin).toBe(0.95);
    // الحد الأعلى 1 مقبول (تعطيل الحارس بالتساوي حرفيًا)
    expect(parseEvmThresholds({ spiMin: 1, cpiMin: 1 })).toEqual({ spiMin: 1, cpiMin: 1, maxDelayDays: 7 });
  });

  test("أيام التأخر: سالب وغير رقم يسقط — والكسري يُجزأ", () => {
    expect(parseEvmThresholds({ maxDelayDays: -3 })!.maxDelayDays).toBe(7);
    expect(parseEvmThresholds({ maxDelayDays: null })!.maxDelayDays).toBe(7);
    expect(parseEvmThresholds({ maxDelayDays: 12.8 })!.maxDelayDays).toBe(12);
    expect(parseEvmThresholds({ maxDelayDays: 0 })!.maxDelayDays).toBe(0); // الصفر مقبول — تحذير فوري لأي تأخر
  });
});
