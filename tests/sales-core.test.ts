/**
 * sales-core.test.ts — اختبارات نواة المبيعات النقية (docs/sales-design.md §4) — بنمط warehouses-core.test.ts:
 * • حساب سطر البيع مرآةً لمحرك الفواتير · خريطة عرض→فاتورة · جدول تحقق البيع المغلق (G8)
 * • تحذير التكلفة غير المانع (د9) · قابلية التحويل (د2) · توسعة قاعدة الصرف في نواة المخازن (د5)
 */
import { describe, expect, test } from "bun:test";

import { validateStockDoc, type DocHeadInput, type DocLineInput } from "../src/lib/warehouses-core";
import {
  CASH_CUSTOMER_NAME,
  QUOTE_CONVERT_MARKER,
  SALES_ACCOUNTS,
} from "../src/lib/sales-constants";
import {
  POS_CREDIT_REQUIRES_CUSTOMER,
  POS_ITEM_INACTIVE,
  POS_LINES_REQUIRED,
  POS_PAY_METHOD_REQUIRED,
  POS_STOCK_LINE_REQUIRES_ITEM,
  POS_WAREHOUSE_REQUIRED,
  cleanPosLines,
  isKnownQuoteStatus,
  mapQuotationToInvoiceItems,
  posLineTotal,
  posSaleTotal,
  quoteConvertible,
  quoteInvoiceTotal,
  underCostLines,
  validatePosSale,
  type PosLineInput,
  type PosSaleInput,
} from "../src/lib/sales-core";

// ===== بناة الاختبار =====

const pline = (over: Partial<PosLineInput> = {}): PosLineInput => ({
  itemId: null,
  description: "سطر حر",
  quantity: 1,
  unitPrice: 5,
  discountPct: 0,
  ...over,
});

const sale = (over: Partial<PosSaleInput> = {}): PosSaleInput => ({
  warehouseId: 1,
  customerId: null,
  isCashCustomer: true,
  vdate: "2025-11-08",
  lines: [pline({ itemId: 3, description: "إسمنت", quantity: 5, unitPrice: 2, itemName: "إسمنت" })],
  payment: { payNow: true, payMethod: "نقداً" },
  ...over,
});

// ==================== الثوابت ====================

describe("ثوابت المبيعات والبذر المؤجل (د4/د6)", () => {
  test("حساب تكلفة المبيعات 5116 شقيق 5110 بنوع مصروف", () => {
    expect(SALES_ACCOUNTS.salesCost).toMatchObject({ code: "5116", name: "تكلفة المبيعات", type: "expense" });
  });

  test("العميل النقدي المبذور له اسم ثابت وعلامة ملاحظات", () => {
    expect(CASH_CUSTOMER_NAME).toContain("نقدي");
    expect(QUOTE_CONVERT_MARKER).toContain("تحويل");
  });
});

// ==================== حساب سطر البيع (مرآة محرك الفواتير) ====================

describe("posLineTotal — مرآة معادلة الفواتير", () => {
  test("الإجمالي = كمية × سعر بلا خصم", () => {
    expect(posLineTotal(5, 2.0, 0)).toBe(10);
    expect(posLineTotal(3, 3.0, 0)).toBe(9);
  });

  test("الخصم النسبي على السطر", () => {
    expect(posLineTotal(10, 2, 10)).toBe(18); // 20 − 10%
    expect(posLineTotal(1, 1.111, 50)).toBe(0.556); // r3(0.5555)
  });

  test("إجمالي البيع = مجموع الأسطر", () => {
    const lines = [
      pline({ itemId: 1, quantity: 5, unitPrice: 2 }), // 10
      pline({ description: "سطر حر", quantity: 1, unitPrice: 3 }), // 3
    ];
    expect(posSaleTotal(lines)).toBe(13);
  });
});

// ==================== تحقق البيع (جدول قواعد مغلق — G8) ====================

describe("validatePosSale — جدول القواعد المغلق", () => {
  test("بيع سليم (سطر مخزني + سطر حر بقبض فوري) يمر بلا أخطاء", () => {
    const s = sale({
      lines: [
        pline({ itemId: 3, description: "", quantity: 5, unitPrice: 2, itemName: "إسمنت" }),
        pline({ description: "تركيب", quantity: 1, unitPrice: 3 }),
      ],
    });
    expect(validatePosSale(s)).toEqual([]);
  });

  test("المستودع مطلوب والبنود مطلوبة", () => {
    expect(validatePosSale(sale({ warehouseId: 0 }))).toContain(POS_WAREHOUSE_REQUIRED);
    expect(validatePosSale(sale({ lines: [] }))).toContain(POS_LINES_REQUIRED);
  });

  test("كمية صفرية وسعر سالب وخصم خارج المدى ترفض", () => {
    const errs = validatePosSale(
      sale({
        lines: [
          pline({ itemId: 1, quantity: 0, unitPrice: 2 }),
          pline({ description: "سالب", quantity: 1, unitPrice: -1 }),
          pline({ description: "خصم", quantity: 1, unitPrice: 1, discountPct: 101 }),
        ],
      })
    ).join(" ");
    expect(errs).toContain("أكبر من صفر");
    expect(errs).toContain("سالب");
    expect(errs).toContain("بين 0 و 100");
  });

  test("السطر المخزني بلا صنف صحيح مرفوض (G8) — النية محفوظة لا تتحول سطرًا حرًا", () => {
    expect(validatePosSale(sale({ lines: [pline({ itemId: 0, description: "" })] }))).toContain(
      POS_STOCK_LINE_REQUIRES_ITEM
    );
    // وأيضًا عبر التطبيع: حقل itemId موجود وقيمته 0 يبقى سطرًا مخزنيًا معطوبًا
    const rows = cleanPosLines([{ itemId: 0, quantity: 2, unitPrice: 1 }]);
    expect(validatePosSale(sale({ lines: rows }))).toContain(POS_STOCK_LINE_REQUIRES_ITEM);
  });

  test("الصنف الموقوف مرفوض باسمه", () => {
    const errs = validatePosSale(
      sale({ lines: [pline({ itemId: 9, description: "", quantity: 1, unitPrice: 1, itemName: "دهان", itemActive: false })] })
    );
    expect(errs.join(" ")).toContain("دهان");
    expect(errs.join(" ")).toContain(POS_ITEM_INACTIVE);
  });

  test("السطر الحر بلا وصف مرفوض", () => {
    expect(validatePosSale(sale({ lines: [pline({ description: "" })] })).join(" ")).toContain("وصفًا");
  });

  test("القبض الفوري بلا وسيلة دفع مرفوض", () => {
    expect(validatePosSale(sale({ payment: { payNow: true, payMethod: "" } }))).toContain(POS_PAY_METHOD_REQUIRED);
  });

  test("الآجل على العميل النقدي مرفوض — والمسمّى يمر (د3)", () => {
    expect(validatePosSale(sale({ payment: { payNow: false } }))).toContain(POS_CREDIT_REQUIRES_CUSTOMER);
    expect(validatePosSale(sale({ customerId: 7, isCashCustomer: false, payment: { payNow: false } }))).toEqual([]);
  });

  test("الآجل بلا سداد على النقدي = نفس المنع (النقدي بلا سند لا معنى له)", () => {
    const s = sale({ isCashCustomer: true, payment: { payNow: false, payMethod: "نقداً" } });
    expect(validatePosSale(s)).toContain(POS_CREDIT_REQUIRES_CUSTOMER);
  });
});

// ==================== تطبيع الأسطر ====================

describe("cleanPosLines — تطبيع أسطر الطلب", () => {
  test("الصفوف الفارغة تُسقط والأرقام تقرب", () => {
    const rows = cleanPosLines([
      { itemId: 3, quantity: 5, unitPrice: 2 },
      { description: "", quantity: 0, unitPrice: 0 }, // فارغ — يسقط
      { description: "سطر حر", quantity: 2.0005, unitPrice: 1.5 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ itemId: 3, quantity: 5, unitPrice: 2 });
    expect(rows[1]).toMatchObject({ itemId: null, description: "سطر حر", quantity: 2.001 });
  });

  test("سطر حر بوصف فقط يبقى (كمية 0 يرفضها التحقق لاحقًا لا التطبيع)", () => {
    const rows = cleanPosLines([{ description: "نص" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].itemId).toBeNull();
  });
});

// ==================== تحذير التكلفة (د9 — غير مانع) ====================

describe("underCostLines — البيع تحت المتوسط المرجحي", () => {
  const wacOf = (id: number) => (id === 1 ? 2.5 : id === 2 ? 0 : 0);

  test("سعر تحت التكلفة يُعلَّم باسم الصنف", () => {
    const rows = underCostLines([pline({ itemId: 1, description: "حديد", unitPrice: 2, itemName: "حديد" })], wacOf);
    expect(rows).toEqual([{ itemId: 1, name: "حديد", price: 2, wac: 2.5 }]);
  });

  test("السعر عند التكلفة أو فوقها لا يُعلَّم", () => {
    expect(underCostLines([pline({ itemId: 1, unitPrice: 2.5 })], wacOf)).toHaveLength(0);
    expect(underCostLines([pline({ itemId: 1, unitPrice: 3 })], wacOf)).toHaveLength(0);
  });

  test("صنف بلا رصيد (متوسط 0) لا يُعلَّم — والسطر الحر مستثنى", () => {
    expect(underCostLines([pline({ itemId: 2, unitPrice: 0.5 })], wacOf)).toHaveLength(0);
    expect(underCostLines([pline({ itemId: null, description: "حر", unitPrice: 0.1 })], wacOf)).toHaveLength(0);
  });
});

// ==================== خريطة عرض → فاتورة (د2) ====================

describe("mapQuotationToInvoiceItems — التحويل الأول المنسوخ", () => {
  test("بنود العرض تُترجم أسطر فاتورة بخصم صفري وإجماليات مجمّدة", () => {
    const rows = mapQuotationToInvoiceItems([
      { description: "إسمنت", quantity: 50, unitPrice: 1.25 },
      { description: "نقل", quantity: 1, unitPrice: 5 },
    ]);
    expect(rows).toEqual([
      { description: "إسمنت", quantity: 50, unitPrice: 1.25, discountPct: 0, lineTotal: 62.5 },
      { description: "نقل", quantity: 1, unitPrice: 5, discountPct: 0, lineTotal: 5 },
    ]);
    expect(quoteInvoiceTotal(rows)).toBe(67.5);
  });

  test("البنود بلا وصف تُسقط والعرض بلا بنود يعيد قائمة فارغة (يُرفض بالمستدعي)", () => {
    expect(mapQuotationToInvoiceItems([{ description: "", quantity: 5, unitPrice: 1 }])).toEqual([]);
    expect(mapQuotationToInvoiceItems([])).toEqual([]);
    expect(quoteInvoiceTotal([])).toBe(0);
  });
});

// ==================== قابلية التحويل (د2) ====================

describe("quoteConvertible — حالات التحويل", () => {
  test("«جديد» و«مقبول» فقط قابلان للتحويل", () => {
    expect(quoteConvertible("جديد")).toBe(true);
    expect(quoteConvertible("مقبول")).toBe(true);
  });

  test("«مرسل» و«مرفوض» و«منتهي» غير قابلة", () => {
    expect(quoteConvertible("مرسل")).toBe(false);
    expect(quoteConvertible("مرفوض")).toBe(false);
    expect(quoteConvertible("منتهي")).toBe(false);
  });

  test("الحالات كلها معروفة للنواة (مرآة مجموعة العروض)", () => {
    for (const s of ["جديد", "مرسل", "مقبول", "مرفوض", "منتهي"]) expect(isKnownQuoteStatus(s)).toBe(true);
    expect(isKnownQuoteStatus("مسودة")).toBe(false);
  });
});

// ==================== توسعة قاعدة الصرف (د5 — المخازن تتوسع لا تنقض) ====================

describe("قاعدة الصرف تتوسع: عقد أو فاتورة بيع (د5)", () => {
  const whHead = (over: Partial<DocHeadInput> = {}): DocHeadInput => ({
    kind: "issue",
    entrySource: "",
    vdate: "2025-11-08",
    warehouseId: 1,
    contractId: 5,
    ...over,
  });
  const wline = (over: Partial<DocLineInput> = {}): DocLineInput => ({
    itemId: 1,
    qty: 10,
    snapUnitCost: 1.25,
    ...over,
  });

  test("الصرف بلا عقد وبلا فاتورة مرفوض برسالة تسمي الاثنين", () => {
    const errs = validateStockDoc(whHead({ contractId: null }), [wline()]);
    expect(errs.join(" ")).toContain("العقد");
    expect(errs.join(" ")).toContain("فاتورة البيع");
  });

  test("الصرف على فاتورة بيع (بلا عقد) يمر — الباب الجديد للنقطة", () => {
    expect(validateStockDoc(whHead({ contractId: null, saleInvoiceId: 12 }), [wline()])).toEqual([]);
  });

  test("الصرف على عقد يبقى مساريًا كما كان — لا انقضاض للقاعدة القائمة", () => {
    expect(validateStockDoc(whHead(), [wline()])).toEqual([]);
  });
});
