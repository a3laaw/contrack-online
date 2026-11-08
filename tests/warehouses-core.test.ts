/**
 * اختبارات نواة المخازن (docs/warehouses-design.md §4/§5 — د2/د4/د7/د8 + درسا G1/G9).
 * النواة نقية 100% — كل الأرصدة اشتقاقية ولا جدول أرصدة.
 */
import { describe, expect, test } from "bun:test";
import {
  DOC_PREFIXES,
  ENTRY_SOURCE_LABELS,
  DOC_KIND_LABELS,
  fmtQty,
  WAREHOUSE_ACCOUNTS,
} from "../src/lib/warehouses-constants";
import {
  balanceOf,
  computeBalances,
  computeCountDeltas,
  deviationOfBoq,
  docMovements,
  materialsCostOfContract,
  validateAvailability,
  validateStockDoc,
  type DocHeadInput,
  type DocLineInput,
  type MovementInput,
} from "../src/lib/warehouses-core";

const head = (over: Partial<DocHeadInput> = {}): DocHeadInput => ({
  kind: "entry",
  entrySource: "cash",
  vdate: "2025-11-01",
  warehouseId: 1,
  ...over,
});

const line = (over: Partial<DocLineInput> = {}): DocLineInput => ({
  itemId: 1,
  qty: 10,
  snapUnitCost: 1.25,
  ...over,
});

describe("ثوابت المخازن", () => {
  test("البادئات الأربعة المعتمدة (د5)", () => {
    expect(DOC_PREFIXES).toEqual({ entry: "WI", issue: "WO", transfer: "WT", count: "WC" });
  });

  test("تسميات عربية للأنواع والمصادر", () => {
    expect(DOC_KIND_LABELS.entry).toBe("إدخال");
    expect(DOC_KIND_LABELS.count).toBe("جرد");
    expect(ENTRY_SOURCE_LABELS.return).toBe("مرتجع من موقع");
  });

  test("حسابات البذر المؤجل 1160/5115 (د9)", () => {
    expect(WAREHOUSE_ACCOUNTS.stock).toMatchObject({ code: "1160", type: "asset" });
    expect(WAREHOUSE_ACCOUNTS.countDiff).toMatchObject({ code: "5115", type: "expense" });
  });

  test("منسق الكميات يزيح الأصفار ويعالج سالب الصفر", () => {
    expect(fmtQty(0.5)).toBe("0.5");
    expect(fmtQty(12.3456)).toBe("12.346");
    expect(fmtQty(-0)).toBe("0");
  });
});

describe("الحركة الموحدة docMovements", () => {
  test("الإدخال النقدي = داخل موجب بالمستودع", () => {
    const mv = docMovements(head({ kind: "entry", entrySource: "cash", warehouseId: 2 }), [line({ qty: 50, snapUnitCost: 1.25 })]);
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ itemId: 1, warehouseId: 2, qty: 50, value: 62.5 });
  });

  test("الصرف = خارج سالب وبالقيمة المجمّدة (د2)", () => {
    const mv = docMovements(head({ kind: "issue", entrySource: "", contractId: 7 }), [line({ qty: 20, snapUnitCost: 1.25 })]);
    expect(mv[0]).toMatchObject({ qty: -20, value: -25 });
  });

  test("التحويل = زوج خارج المصدر وداخل المستهدف بنفس اللقطة (بلا قيد)", () => {
    const mv = docMovements(head({ kind: "transfer", entrySource: "", warehouseId: 1, targetWarehouseId: 2 }), [
      line({ qty: 10, snapUnitCost: 2 }),
    ]);
    expect(mv).toHaveLength(2);
    expect(mv[0]).toMatchObject({ warehouseId: 1, qty: -10, value: -20 });
    expect(mv[1]).toMatchObject({ warehouseId: 2, qty: 10, value: 20 });
  });

  test("الجرد = ± بالفرق المقيّد", () => {
    const mv = docMovements(head({ kind: "count", entrySource: "" }), [line({ qty: -2, snapUnitCost: 1.25, countedQty: 18 })]);
    expect(mv[0]).toMatchObject({ qty: -2, value: -2.5 });
  });

  test("الملغاة شفافة — لا حركة أبدًا (د6)", () => {
    const mv = docMovements(head({ kind: "issue", entrySource: "", contractId: 1, status: "cancelled" }), [line()]);
    expect(mv).toHaveLength(0);
  });
});

describe("الأرصدة الاشتقاقية computeBalances (G9)", () => {
  const movements: MovementInput[] = [
    { itemId: 1, warehouseId: 1, date: "2025-11-01", qty: 50, value: 62.5 }, // @1.25
    { itemId: 1, warehouseId: 1, date: "2025-11-05", qty: 50, value: 87.5 }, // @1.75
    { itemId: 1, warehouseId: 1, date: "2025-11-08", qty: -20, value: -30 }, // صرف بلقطة متوسط 1.5
    { itemId: 2, warehouseId: 1, date: "2025-11-02", qty: 10, value: 20 },
  ];

  test("المتوسط المرجح الاشتقاقي بعد صرف مجفف", () => {
    const bal = computeBalances(movements);
    const b = balanceOf(bal, 1, 1)!;
    expect(b.qty).toBe(80);
    expect(b.value).toBe(120);
    expect(b.wac).toBe(1.5);
  });

  test("حتى تاريخ معين يستبعد ما بعده", () => {
    const bal = computeBalances(movements, "2025-11-05");
    const b = balanceOf(bal, 1, 1)!;
    expect(b.qty).toBe(100);
    expect(b.wac).toBe(1.5);
  });

  test("صنف مستنزف بالكامل: qty=0 وwac=0 بلا قسمة", () => {
    const bal = computeBalances([
      { itemId: 9, warehouseId: 1, date: "2025-11-01", qty: 5, value: 10 },
      { itemId: 9, warehouseId: 1, date: "2025-11-02", qty: -5, value: -10 },
    ]);
    const b = balanceOf(bal, 9, 1)!;
    expect(b.qty).toBe(0);
    expect(b.value).toBe(0);
    expect(b.wac).toBe(0);
  });
});

describe("منع السالب validateAvailability (د4)", () => {
  const existing: MovementInput[] = [
    { itemId: 1, warehouseId: 1, date: "2025-11-01", qty: 50, value: 62.5 },
    { itemId: 1, warehouseId: 1, date: "2025-11-03", qty: -20, value: -25 },
  ];

  test("صرف ضمن المتاح يمر بلا مخالفات", () => {
    expect(validateAvailability(existing, [{ itemId: 1, warehouseId: 1, date: "2025-11-05", qty: -30, value: 0 }])).toEqual([]);
  });

  test("صرف يتجاوز المتاح يرفض ببنية تسمّي الصنف والمستودع والمتاح", () => {
    const v = validateAvailability(existing, [{ itemId: 1, warehouseId: 1, date: "2025-11-05", qty: -40, value: 0 }]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ itemId: 1, warehouseId: 1, available: 30, required: 40 });
  });

  test("إذن مؤرّخ قبل نقطة النفاد يرفض (حماية الرجوع بالتواريخ)", () => {
    const v = validateAvailability(existing, [{ itemId: 1, warehouseId: 1, date: "2025-11-02", qty: -40, value: 0 }]);
    expect(v).toHaveLength(1);
    expect(v[0].available).toBe(50);
  });

  test("صنف مختلف لا يُلمس", () => {
    expect(validateAvailability(existing, [{ itemId: 3, warehouseId: 1, date: "2025-11-05", qty: -10, value: 0 }])).toHaveLength(1);
  });
});

describe("تحقق المستند validateStockDoc (G8)", () => {
  test("إذن سليم يمر بلا أخطاء", () => {
    expect(validateStockDoc(head({ kind: "issue", entrySource: "", contractId: 5 }), [line({ qty: 3 })])).toEqual([]);
  });

  test("الصرف بلا عقد مرفوض (د7)", () => {
    const errs = validateStockDoc(head({ kind: "issue", entrySource: "", contractId: null }), [line()]);
    expect(errs.join(" ")).toContain("العقد");
  });

  test("المرتجع بلا عقد مرفوض", () => {
    const errs = validateStockDoc(head({ kind: "entry", entrySource: "return" }), [line()]);
    expect(errs.join(" ")).toContain("مرتجع");
  });

  test("النقدي بلا حساب دفع مرفوض والآجل بلا مورد مرفوض", () => {
    expect(validateStockDoc(head({ kind: "entry", entrySource: "cash", payAccountId: null }), [line()]).join(" ")).toContain("الصندوق");
    expect(validateStockDoc(head({ kind: "entry", entrySource: "credit", party: "" }), [line()]).join(" ")).toContain("المورد");
  });

  test("التحويل لنفس المستودع أو بلا مستهدف مرفوض", () => {
    expect(validateStockDoc(head({ kind: "transfer", entrySource: "", targetWarehouseId: 1 }), [line()]).join(" ")).toContain("يختلف");
    expect(validateStockDoc(head({ kind: "transfer", entrySource: "", targetWarehouseId: null }), [line()]).join(" ")).toContain("المستهدف");
  });

  test("الصنف المكرر والكميات الغير موجبة ترفض", () => {
    const errs = validateStockDoc(head(), [line({ qty: 2 }), line({ qty: 3 })]);
    expect(errs.join(" ")).toContain("مكرر");
    expect(validateStockDoc(head(), [line({ qty: 0 })]).join(" ")).toContain("أكبر من صفر");
    expect(validateStockDoc(head(), [line({ qty: -5 })]).join(" ")).toContain("أكبر من صفر");
    expect(validateStockDoc(head(), [line({ snapUnitCost: -1 })]).join(" ")).toContain("سالب");
  });

  test("الجرد: المفحوص لا يقبل السالب والإذن بلا أسطر مرفوض", () => {
    expect(validateStockDoc(head({ kind: "count", entrySource: "" }), [line({ qty: -1, countedQty: -2 })]).join(" ")).toContain("المفحوصة");
    expect(validateStockDoc(head(), []).join(" ")).toContain("بلا أسطر");
  });
});

describe("فروق الجرد computeCountDeltas (د10)", () => {
  const balances = [
    { itemId: 1, warehouseId: 1, qty: 20, value: 25, wac: 1.25 },
    { itemId: 2, warehouseId: 1, qty: 0, value: 0, wac: 0 },
  ];

  test("نقص: فرق سالب بسعر اللقطة الحالي", () => {
    const d = computeCountDeltas(balances, [{ itemId: 1, countedQty: 18 }]);
    expect(d).toEqual([{ itemId: 1, delta: -2, unitCost: 1.25, amount: -2.5 }]);
  });

  test("زيادة على صنف مستنزف: سعر اللقطة صفر", () => {
    const d = computeCountDeltas(balances, [{ itemId: 2, countedQty: 3 }]);
    expect(d[0]).toMatchObject({ itemId: 2, delta: 3, unitCost: 0, amount: 0 });
  });

  test("التطابق لا سطر له", () => {
    expect(computeCountDeltas(balances, [{ itemId: 1, countedQty: 20 }])).toEqual([]);
  });
});

describe("انحراف بنود BOQ deviationOfBoq (G1)", () => {
  const boq = [
    { id: 11, description: "إسمنت بورتلاندي", qty: 100, unitPrice: 1.25, amount: 125, unit: "كيس" },
    { id: 12, description: "حديد تسليح", qty: 10, unitPrice: 2, amount: 20, unit: "طن" },
  ];

  test("المنصرف مقابل التعاقدي والمتبقي", () => {
    const rows = deviationOfBoq(boq, [{ boqItemId: 11, qty: 40, value: 50 }]);
    expect(rows[0]).toMatchObject({ issuedQty: 40, issuedValue: 50, remainingQty: 60, overQty: 0 });
    expect(rows[1]).toMatchObject({ issuedQty: 0, remainingQty: 10 });
  });

  test("تجاوز الكمية يظهر overQty موجبًا ومتبقيًا سالبًا", () => {
    const rows = deviationOfBoq([boq[1]], [{ boqItemId: 12, qty: 12, value: 24 }]);
    expect(rows[0]).toMatchObject({ remainingQty: -2, overQty: 2 });
  });
});

describe("تكلفة العقد materialsCostOfContract (د8)", () => {
  test("صرف − مرتجع موقعي من أذون posted حصرًا", () => {
    const docs = [
      { kind: "issue", contractId: 5, status: "posted", totalAmount: 25 },
      { kind: "issue", contractId: 5, status: "posted", totalAmount: 10 },
      { kind: "entry", entrySource: "return", contractId: 5, status: "posted", totalAmount: 6.25 },
      { kind: "issue", contractId: 5, status: "cancelled", totalAmount: 999 }, // ملغاة شفافة
      { kind: "issue", contractId: 6, status: "posted", totalAmount: 777 }, // عقد آخر
      { kind: "entry", entrySource: "cash", contractId: 5, status: "posted", totalAmount: 50 }, // شراء ليس تكلفة عقد
    ] as const;
    expect(materialsCostOfContract(docs as never, 5)).toBe(28.75);
  });

  test("عقد بلا حركة = صفر", () => {
    expect(materialsCostOfContract([], 9)).toBe(0);
  });
});
