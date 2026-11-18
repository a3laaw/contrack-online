/**
 * اختبارات نواة م1 «المصالحة» — الرؤيتان المتقابلتان.
 * docs/daily-report-forecast-design.md §3 + §9 — نواة نقية حصرًا (بلا DB):
 * الرسمي من أسطر المعتمد (قرار ز3) · الميداني من اليومية · الفجوة باتجاهين ·
 * المستخلص المتوقع (الموجب حصرًا) · منحنى S التراكمي المالي · التحذيرات الثلاثة.
 */
import { describe, expect, test } from "bun:test";

import {
  addDays,
  deriveForecast,
  deriveForecastWarnings,
  deriveSCurve,
  rateWindowStart,
  summarizeForecast,
  type ForecastExecutionInput,
  type ForecastItemInput,
} from "../src/lib/forecast-core";

const item = (over: Partial<ForecastItemInput>): ForecastItemInput => ({
  id: 1,
  itemNo: "03.30.01",
  divisionCode: "03",
  divisionName: "CONCRETE",
  description: "خرسانة مسلحة",
  qty: 100,
  unit: "م³",
  unitPrice: 50,
  deleted: false,
  deletedAddendumId: 0,
  ...over,
});

const exec = (over: Partial<ForecastExecutionInput>): ForecastExecutionInput => ({
  boqItemId: 1,
  executionDate: "2026-03-10",
  qty: 10,
  documented: true,
  ...over,
});

const baseInput = () => ({
  asOf: null,
  today: "2026-03-20",
  items: [item({})],
  addendums: [],
  addendumItems: [],
  invoices: [{ id: 10, invoiceDate: "2026-03-01", state: "معتمد", status: "normal", approveAt: "2026-03-05" }],
  lines: [{ invoiceId: 10, boqItemId: 1, quantity: 30 }],
  executions: [exec({})],
});

describe("deriveForecast — الرسمي من أسطر المعتمد (قرار ز3)", () => {
  test("المعتمد باعتماد ≤ asOf يدخل بمجموع كميات أسطره — لا اللقطات", () => {
    const r = deriveForecast(baseInput());
    expect(r.rows[0].officialQty).toBe(30);
    expect(r.rows[0].officialAmount).toBe(1500);
  });

  test("الاعتماد الفوري بلا approveAt يُفك إلى تاريخ الفاتورة (قرار ز3)", () => {
    const r = deriveForecast({ ...baseInput(), invoices: [{ id: 10, invoiceDate: "2026-03-01", state: "معتمد", status: "normal", approveAt: "" }] });
    expect(r.rows[0].officialQty).toBe(30);
  });

  test("المسودة والمقدم لا يدخلان الرسمي (ز2: المسودة لا تستهلك) والvoid مستبعدة", () => {
    const r = deriveForecast({
      ...baseInput(),
      invoices: [
        { id: 10, invoiceDate: "2026-03-01", state: "مسودة", status: "normal", approveAt: "" },
        { id: 11, invoiceDate: "2026-03-01", state: "مقدم", status: "normal", approveAt: "" },
        { id: 12, invoiceDate: "2026-03-01", state: "معتمد", status: "void", approveAt: "2026-03-02" },
      ],
      lines: [
        { invoiceId: 10, boqItemId: 1, quantity: 99 },
        { invoiceId: 11, boqItemId: 1, quantity: 88 },
        { invoiceId: 12, boqItemId: 1, quantity: 77 },
      ],
    });
    expect(r.rows[0].officialQty).toBe(0);
  });

  test("اعتماد لاحق لـ asOf لا يدخل في الوضع التاريخي", () => {
    const r = deriveForecast({ ...baseInput(), asOf: "2026-03-04", today: "2026-03-04" });
    expect(r.rows[0].officialQty).toBe(0);
    const r2 = deriveForecast({ ...baseInput(), asOf: "2026-03-05", today: "2026-03-05" });
    expect(r2.rows[0].officialQty).toBe(30);
  });

  test("السطر الحر بلا بند خارج المصالحة بالبند", () => {
    const r = deriveForecast({ ...baseInput(), lines: [{ invoiceId: 10, boqItemId: null, quantity: 500 }] });
    expect(r.rows[0].officialQty).toBe(0);
  });
});

describe("deriveForecast — الميداني من اليومية والموثق فتعة منه", () => {
  test("مجموع التنفيذ ≤ asOf والموثق فتعة منه", () => {
    const r = deriveForecast({
      ...baseInput(),
      executions: [
        exec({ qty: 10, documented: true, executionDate: "2026-03-01" }),
        exec({ qty: 5, documented: false, executionDate: "2026-03-02" }),
        exec({ qty: 7, documented: true, executionDate: "2026-03-15" }),
      ],
    });
    expect(r.rows[0].fieldQty).toBe(22);
    expect(r.rows[0].documentedQty).toBe(17);
    expect(r.rows[0].fieldAmount).toBe(1100);
  });

  test("التنفيذ بعد asOf لا يدخل تاريخيًا", () => {
    const r = deriveForecast({
      ...baseInput(),
      asOf: "2026-03-10",
      today: "2026-03-10",
      executions: [exec({ executionDate: "2026-03-10" }), exec({ qty: 5, executionDate: "2026-03-11" })],
    });
    expect(r.rows[0].fieldQty).toBe(10);
  });
});

describe("الفجوة باتجاهين والمستخلص المتوقع (الموجب حصرًا)", () => {
  test("موجبة = منفذ غير مستخلص — وقيمتها تُحسب بسعر البند", () => {
    const r = deriveForecast(baseInput()); // ميداني 10 × رسمي 30 = فجوة −20
    expect(r.rows[0].gapQty).toBe(-20);
    expect(r.rows[0].gapValue).toBe(-1000);
    expect(r.totals.expectedNextIpc).toBe(0);
    expect(r.totals.totalGapValue).toBe(-1000);
  });

  test("الفجوات الموجبة تُجمَّع فقط في المستخلص المتوقع — والسالبة تعبر بالفجوة الكلية", () => {
    const r = deriveForecast({
      ...baseInput(),
      items: [
        item({ id: 1, itemNo: "A", qty: 100, unitPrice: 50 }),
        item({ id: 2, itemNo: "B", qty: 40, unitPrice: 20 }),
      ],
      invoices: [{ id: 10, invoiceDate: "2026-03-01", state: "معتمد", status: "normal", approveAt: "2026-03-05" }],
      lines: [{ invoiceId: 10, boqItemId: 2, quantity: 30 }],
      executions: [exec({ boqItemId: 1, qty: 60 }), exec({ boqItemId: 2, qty: 10 })],
    });
    // A: ميداني 60 × رسمي 0 = فجوة +60×50=3000 · B: ميداني 10 × رسمي 30 = فجوة −20×20=−400
    expect(r.totals.expectedNextIpc).toBe(3000);
    expect(r.totals.totalGapValue).toBe(2600);
    expect(r.totals.fieldAmount).toBe(3200);
    expect(r.totals.officialAmount).toBe(600);
    expect(r.totals.coveragePct).toBe(18.8); // 600/3200 = 18.75 → 18.8
  });

  test("تغطية الرسمي قد تتجاوز 100 — استباق إشارة حقيقية لا تُخفى", () => {
    const r = deriveForecast({ ...baseInput(), executions: [exec({ qty: 10 })] });
    // رسمي 1500 مقابل ميداني 500
    expect(r.totals.coveragePct).toBe(300);
  });

  test("بلا ميداني: التغطية صفر على قاعدة صفر", () => {
    const r = deriveForecast({ ...baseInput(), executions: [] });
    expect(r.totals.coveragePct).toBe(0);
  });
});

describe("بنية الظهور عند asOf — إعادة استخدام ز3", () => {
  test("البند المحذوف ناعمًا لا يظهر حائمًا — والمحذوف بملحق معتمد يظهر قبل تاريخ حذفه", () => {
    const r = deriveForecast({
      ...baseInput(),
      items: [item({ id: 1, deleted: true, deletedAddendumId: 0 })],
    });
    expect(r.rows).toEqual([]);
  });

  test("البند المُنشأ بملحق معتمد بعد asOf لا يظهر تاريخيًا", () => {
    const r = deriveForecast({
      ...baseInput(),
      asOf: "2026-03-10",
      today: "2026-03-10",
      items: [item({ id: 2, itemNo: "NEW" })],
      addendums: [{ id: 7, addendumNumber: "ADD-1", approvedDate: "2026-03-12" }],
      addendumItems: [{ addendumId: 7, action: "add", createdItemId: 2, boqItemId: null, restoreDeletedBy: 0 }],
      lines: [],
      invoices: [],
      executions: [],
    });
    expect(r.rows.map((x) => x.boqItemId)).not.toContain(2);
    const r2 = deriveForecast({ ...baseInput(), asOf: "2026-03-13", today: "2026-03-13", items: [item({ id: 2, itemNo: "NEW" })], addendums: [{ id: 7, addendumNumber: "ADD-1", approvedDate: "2026-03-12" }], addendumItems: [{ addendumId: 7, action: "add", createdItemId: 2, boqItemId: null, restoreDeletedBy: 0 }], lines: [], invoices: [], executions: [] });
    expect(r2.rows.map((x) => x.boqItemId)).toContain(2);
  });
});

describe("الاكتمال المتوقع — المعدل آخر 30 يومًا", () => {
  test("معدل 10/30 يومًا ومتبقي 90 ⇒ اليوم+270 (المعدل بدقة كاملة بالحساب)", () => {
    // نافذة 30 يومًا المنتهية بـ2026-03-20: تنفيذ واحد 10 وحدات داخل النافذة
    const r = deriveForecast({
      ...baseInput(),
      today: "2026-03-20",
      executions: [exec({ qty: 10, executionDate: "2026-02-21" })],
    });
    expect(r.rows[0].ratePerDay).toBe(0.333); // للعرض ر3 — والحساب بالدقة الكاملة
    expect(r.rows[0].expectedFinish).toBe(addDays("2026-03-20", Math.ceil(90 / (10 / 30))));
    expect(r.rows[0].expectedFinish).toBe("2026-12-15");
  });

  test("بلا نشاط بالنافذة ⇒ بلا تاريخ متوقع (توقف يحسّنه تحذير التوقف)", () => {
    const r = deriveForecast({ ...baseInput(), executions: [exec({ executionDate: "2026-01-01" })] });
    expect(r.rows[0].ratePerDay).toBe(0);
    expect(r.rows[0].expectedFinish).toBeNull();
  });

  test("البند المكتمل ميدانيًا (متبقي صفر) لا يحتاج تاريخًا", () => {
    const r = deriveForecast({ ...baseInput(), executions: [exec({ qty: 100 })] });
    expect(r.rows[0].remainingQty).toBe(0);
    expect(r.rows[0].expectedFinish).toBeNull();
  });

  test("البند الذي لم يبدأ ميدانيًا بلا معدل ولا تاريخ", () => {
    const r = deriveForecast({ ...baseInput(), executions: [] });
    expect(r.rows[0].ratePerDay).toBe(0);
    expect(r.rows[0].expectedFinish).toBeNull();
  });
});

describe("deriveSCurve — النقاط التراكمية المالية المؤرخة", () => {
  test("اتحاد التواريخ تراكميًا تصاعديًا — ونفس اليوم يدمج الرؤيتين", () => {
    const pts = deriveSCurve({
      priceByItem: new Map([[1, 50]]),
      executions: [exec({ qty: 10, executionDate: "2026-03-01" }), exec({ qty: 5, executionDate: "2026-03-05" })],
      lines: [{ invoiceId: 10, boqItemId: 1, quantity: 30 }],
      approveDateById: new Map([[10, "2026-03-05"]]),
    });
    expect(pts.map((p) => p.date)).toEqual(["2026-03-01", "2026-03-05"]);
    expect(pts[0].fieldCum).toBe(500);
    expect(pts[0].officialCum).toBe(0);
    expect(pts[1].fieldCum).toBe(750);
    expect(pts[1].officialCum).toBe(1500);
  });

  test("السطر الحر بلا بند خارج المنحنى — والتنفيذ بلا سعر بند لا يصنع نقطة", () => {
    const pts = deriveSCurve({
      priceByItem: new Map([[1, 50]]),
      executions: [exec({ qty: 10, executionDate: "2026-03-01" }), exec({ qty: 5, executionDate: "2026-03-20" })],
      lines: [{ invoiceId: 10, boqItemId: null, quantity: 99 }],
      approveDateById: new Map(),
    });
    expect(pts.map((p) => p.date)).toEqual(["2026-03-01", "2026-03-20"]);
    expect(pts[0].fieldCum).toBe(500);
    expect(pts[0].officialCum).toBe(0);
    expect(pts[1].fieldCum).toBe(750);
    expect(pts[1].officialCum).toBe(0);
  });
});

describe("deriveForecastWarnings — التحذيرات الثلاثة", () => {
  test("فوترة متأخرة: فجوة موجبة قيمتها > 0 — وبسعر صفر لا تحذير (لا قيمة تُستخلص)", () => {
    const rows = [
      { ...summarizeForecast([]), boqItemId: 1, itemNo: "A", description: "د", unit: "م³", contractQty: 100, unitPrice: 50, fieldQty: 60, documentedQty: 60, officialQty: 40, gapQty: 20, gapValue: 1000, remainingQty: 40, fieldAmount: 3000, officialAmount: 2000, ratePerDay: 0, expectedFinish: null },
    ] as never;
    const w = deriveForecastWarnings(rows, new Map([[1, "2026-03-19"]]), "2026-03-20");
    expect(w.map((x) => x.kind)).toEqual(["late_billing"]);
    expect(w[0].message).toContain("1000");
  });

  test("استباق مقلق: رسمي > ميداني × 1.05 — ويشتعل بميداني صفر وأي رسمي موجبة", () => {
    const mk = (field: number, official: number) =>
      ({ boqItemId: 1, itemNo: "A", description: "د", unit: "وحدة", contractQty: 100, unitPrice: 10, fieldQty: field, documentedQty: 0, officialQty: official, gapQty: field - official, gapValue: (field - official) * 10, remainingQty: 0, fieldAmount: field * 10, officialAmount: official * 10, ratePerDay: 0, expectedFinish: null }) as never;
    expect(deriveForecastWarnings([mk(100, 105)], new Map(), "2026-03-20").map((x) => x.kind)).toEqual([]); // الحد نفسه لا يشتعل (105 = ميداني × 1.05)
    expect(deriveForecastWarnings([mk(100, 106.1)], new Map(), "2026-03-20").map((x) => x.kind)).toEqual(["overrun"]);
    expect(deriveForecastWarnings([mk(0, 3)], new Map(), "2026-03-20").map((x) => x.kind)).toEqual(["overrun"]);
    expect(deriveForecastWarnings([mk(0, 0)], new Map(), "2026-03-20")).toEqual([]);
  });

  test("بند متوقف: آخر نشاط أقدم من stallDays — وحد النافذة الحدية لا يشتري", () => {
    const row = { boqItemId: 1, itemNo: "A", description: "د", unit: "وحدة", contractQty: 100, unitPrice: 10, fieldQty: 20, documentedQty: 20, officialQty: 20, gapQty: 0, gapValue: 0, remainingQty: 80, fieldAmount: 200, officialAmount: 200, ratePerDay: 0, expectedFinish: null } as never;
    expect(deriveForecastWarnings([row], new Map([[1, "2026-03-06"]]), "2026-03-20").map((x) => x.kind)).toEqual([]); // 14 يومًا = حد
    expect(deriveForecastWarnings([row], new Map([[1, "2026-03-05"]]), "2026-03-20").map((x) => x.kind)).toEqual(["stalled"]); // 15 يومًا
  });

  test("ترتيب الجاهزية: التوقف ثم الاستباق ثم الفوترة المتأخرة", () => {
    const row = (id: number, kind: "late" | "over" | "stall") => {
      const fieldQty = kind === "late" ? 60 : 100;
      const officialQty = kind === "late" ? 40 : kind === "over" ? 200 : 100;
      return ({ boqItemId: id, itemNo: `X${id}`, description: "د", unit: "وحدة", contractQty: 100, unitPrice: 10, fieldQty, documentedQty: 0, officialQty, gapQty: fieldQty - officialQty, gapValue: (fieldQty - officialQty) * 10, remainingQty: 0, fieldAmount: 0, officialAmount: 0, ratePerDay: 0, expectedFinish: null }) as never;
    };
    const w = deriveForecastWarnings([row(1, "late"), row(2, "over"), row(3, "stall")], new Map([[3, "2026-03-01"]]), "2026-03-20");
    expect(w.map((x) => x.kind)).toEqual(["stalled", "overrun", "late_billing"]);
  });
});

describe("أدوات التاريخ", () => {
  test("addDays يعبر حدود الشهور والسنوات بلا انزلاق", () => {
    expect(addDays("2026-03-20", 70)).toBe("2026-05-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("", 5)).toBe("");
  });

  test("نافذة المعدل شاملة لآخر n يومًا", () => {
    // 2026-02-19 → 2026-03-20 شاملًا = 30 يومًا
    expect(rateWindowStart("2026-03-20", 30)).toBe("2026-02-19");
    expect(rateWindowStart("2026-03-20", 1)).toBe("2026-03-20");
  });
});
