// ============================================================
// اختبارات نواة ز3 — محرك الحالة الزمنية لـ BOQ
// docs/boq-state-timeline-design.md §4 (السابق/الحالي/النسبة/المتاح + بنية as-of)
// مرآة اختبارات النواة النقية الموحدة (invoice-state-core.test.ts نمطًا)
// ============================================================

import { describe, expect, it } from "bun:test";

import {
  boqItemVisibleAt,
  datePart10,
  deriveBoqItemStructure,
  deriveBoqState,
  deriveBoqTimeline,
  pctOf,
  type BoqStateAddendumInput,
  type BoqStateAddendumItemInput,
  type BoqStateInvoiceInput,
  type BoqStateItemInput,
  type BoqStateLineInput,
} from "../src/lib/boq-state-core";

// ==================== مولدات مصغرة ====================

function item(over: Partial<BoqStateItemInput> & { id: number }): BoqStateItemInput {
  return {
    itemNo: `IT-${over.id}`,
    divisionCode: "03",
    divisionName: "CONCRETE",
    description: `بند ${over.id}`,
    qty: 100,
    unit: "م3",
    unitPrice: 10,
    amount: 1000,
    deleted: false,
    deletedAddendumId: 0,
    ...over,
  };
}

function inv(over: Partial<BoqStateInvoiceInput> & { id: number }): BoqStateInvoiceInput {
  return {
    invoiceNumber: `INV-000${over.id}`,
    invoiceDate: "2026-11-01",
    state: "معتمد",
    status: "unpaid",
    submitAt: "",
    approveAt: "2026-11-05",
    total: 500,
    ...over,
  };
}

function line(invoiceId: number, boqItemId: number | null, quantity: number): BoqStateLineInput {
  return { invoiceId, boqItemId, quantity };
}

// ==================== 1) أدوات التاريخ والنسبة ====================

describe("ز3 — datePart10 وpctOf", () => {
  it("يقتطع الجزء التاريخي من أي صيغة مخزنة", () => {
    expect(datePart10("2026-11-18")).toBe("2026-11-18");
    expect(datePart10("2026-11-18T10:30:00.000Z")).toBe("2026-11-18");
    expect(datePart10("")).toBe("");
  });

  it("pctOf: نسبة عادية وأرضية صفر وتجاوز 100 عمدًا", () => {
    expect(pctOf(50, 100)).toBe(50);
    expect(pctOf(30, 0)).toBe(0);
    expect(pctOf(120, 100)).toBe(120); // تنفيذ زائد — إشارة حقيقية لا تُخفى
    expect(pctOf(1, 3)).toBe(33.3);
  });
});

// ==================== 2) بنية as-of ====================

describe("ز3 — بنية البنود من الملاحق المعتمدة", () => {
  // البند 3 محذوف بملحق 11 — مرآة آلية التطبيق الفعلية (addendum-server: deleted+deletedAddendumId)
  const base = [item({ id: 1 }), item({ id: 2 }), item({ id: 3, deleted: true, deletedAddendumId: 11 })];
  const addenda: BoqStateAddendumInput[] = [
    { id: 10, addendumNumber: "ADD-001", approvedDate: "2026-10-01" }, // أضاف البند 2
    { id: 11, addendumNumber: "ADD-002", approvedDate: "2026-12-01" }, // حذف البند 3
    { id: 12, addendumNumber: "ADD-003", approvedDate: "" }, // غير معتمد — لا أثر
  ];
  const addItems: BoqStateAddendumItemInput[] = [
    { addendumId: 10, action: "add", createdItemId: 2, boqItemId: null, restoreDeletedBy: 0 },
    { addendumId: 11, action: "delete", createdItemId: 0, boqItemId: 3, restoreDeletedBy: 0 },
    { addendumId: 12, action: "add", createdItemId: 3, boqItemId: null, restoreDeletedBy: 0 },
  ];
  const struct = deriveBoqItemStructure(base, addenda, addItems);

  it("البند الأساسي بلا تواريخ", () => {
    expect(struct.get(1)).toEqual({ createdDate: null, deletedDate: null, restoreDate: null });
  });

  it("المضاف بملحق معتمد يحمل تاريخ اعتماد ملحقه", () => {
    expect(struct.get(2)?.createdDate).toBe("2026-10-01");
  });

  it("المحذوف بملحق معتمد يفك الحذف إلى تاريخ اعتماد ملحقه", () => {
    expect(struct.get(3)?.deletedDate).toBe("2026-12-01");
  });

  it("الملحق غير المعتمد لا يضيف تاريخ إنشاء (البند 2 بلا إنشاء بملحق غير معتمد)", () => {
    // البند 3 لم يُنشأ بملحق (أساسي) — والملحق 12 غير المعتمد لا يضيف تاريخًا
    expect(struct.get(3)?.createdDate).toBeNull();
    expect(struct.get(1)?.createdDate).toBeNull();
  });
});

describe("ز3 — ظهور البند عند asOf", () => {
  const itemRow = item({ id: 5, deleted: true, deletedAddendumId: 9 });
  const structDel = deriveBoqItemStructure(
    [itemRow],
    [{ id: 9, addendumNumber: "ADD-009", approvedDate: "2026-06-01" }],
    []
  );

  it("الحاضر: غير المحذوف ظاهر والمحذوف مخفي (مطابق لفلتر GET /boq)", () => {
    expect(boqItemVisibleAt(undefined, { deleted: false, deletedAddendumId: 0 }, null)).toBe(true);
    expect(boqItemVisibleAt(undefined, { deleted: true, deletedAddendumId: 9 }, null)).toBe(false);
  });

  it("تاريخي: البند ظاهر قبل تاريخ ملحق الحذف ومخفي بعده", () => {
    expect(boqItemVisibleAt(structDel.get(5), itemRow, "2026-05-31")).toBe(true);
    expect(boqItemVisibleAt(structDel.get(5), itemRow, "2026-06-01")).toBe(false);
    expect(boqItemVisibleAt(structDel.get(5), itemRow, "2026-11-18")).toBe(false);
  });

  it("تاريخي: الحذف اليدوي بلا ملحق مخفي في كل التواريخ (حد v1)", () => {
    const manual = item({ id: 6, deleted: true, deletedAddendumId: 0 });
    expect(boqItemVisibleAt(undefined, manual, "2026-01-01")).toBe(false);
  });

  it("تاريخي: البند المضاف بملحق معتمد بعد asOf لم يظهر بعد", () => {
    const added = item({ id: 7 });
    const structAdd = deriveBoqItemStructure(
      [added],
      [{ id: 20, addendumNumber: "ADD-020", approvedDate: "2026-09-01" }],
      [{ addendumId: 20, action: "add", createdItemId: 7, boqItemId: null, restoreDeletedBy: 0 }]
    );
    expect(boqItemVisibleAt(structAdd.get(7), added, "2026-08-31")).toBe(false);
    expect(boqItemVisibleAt(structAdd.get(7), added, "2026-09-01")).toBe(true);
  });

  it("تاريخي: الحذف ثم الاسترجاع — مخفي بينهما وظاهر بعده", () => {
    const restored = item({ id: 8, deleted: false, deletedAddendumId: 30 });
    const structRest = deriveBoqItemStructure(
      [restored],
      [
        { id: 30, addendumNumber: "ADD-030", approvedDate: "2026-04-01" }, // حذفه
        { id: 31, addendumNumber: "ADD-031", approvedDate: "2026-07-01" }, // استرجعه
      ],
      [{ addendumId: 31, action: "add", createdItemId: 0, boqItemId: 8, restoreDeletedBy: 30 }]
    );
    expect(boqItemVisibleAt(structRest.get(8), restored, "2026-03-31")).toBe(true);
    expect(boqItemVisibleAt(structRest.get(8), restored, "2026-05-01")).toBe(false);
    expect(boqItemVisibleAt(structRest.get(8), restored, "2026-07-01")).toBe(true);
    expect(boqItemVisibleAt(structRest.get(8), restored, "2026-11-18")).toBe(true);
  });
});

// ==================== 3) السابق/الحالي في الحاضر ====================

describe("ز3 — الحالة الحالية (asOf=null)", () => {
  const items = [item({ id: 1, qty: 100, unitPrice: 10 }), item({ id: 2, qty: 50, unitPrice: 4, divisionCode: "05", divisionName: "STEEL" })];
  const invoices = [
    inv({ id: 1, state: "معتمد", approveAt: "2026-11-05" }), // سابق
    inv({ id: 2, state: "مسودة", approveAt: "" }), // حالي
    inv({ id: 3, state: "مقدم", approveAt: "" }), // حالي
    inv({ id: 4, state: "معتمد", status: "void", approveAt: "2026-11-06" }), // ملغاة مستبعدة
  ];
  const lines = [
    line(1, 1, 30),
    line(1, 2, 10),
    line(2, 1, 20),
    line(3, 1, 5),
    line(4, 1, 999), // ملغاة — يجب ألا تدخل
    line(1, null, 77), // سطر حر — لا يدخل أي بند
  ];

  const res = deriveBoqState({ asOf: null, items, addendums: [], addendumItems: [], invoices, lines });

  it("المعتمد يجمَّع سابقًا والمسودة/المقدم حاليًا والملغاة مستبعدة", () => {
    const i1 = res.items.find((r) => r.id === 1)!;
    expect(i1.priorQty).toBe(30);
    expect(i1.currentQty).toBe(25); // 20 مسودة + 5 مقدم
    expect(i1.availableQty).toBe(70); // 100 − 30 (المسودة لا تحجز)
    expect(i1.totalPct).toBe(55); // (30+25)/100
  });

  it("قيم سابق/حالي المالية = الكمية × سعر الوحدة", () => {
    const i2 = res.items.find((r) => r.id === 2)!;
    expect(i2.priorQty).toBe(10);
    expect(i2.priorAmount).toBe(40);
    expect(i2.currentAmount).toBe(0);
  });

  it("إجماليات العقد من البنود الظاهرة بالنسب المالية", () => {
    expect(res.totals.contractAmount).toBe(1000 + 200);
    expect(res.totals.priorAmount).toBe(300 + 40);
    expect(res.totals.currentAmount).toBe(250);
  });

  it("إجماليات الأقسام تُجمَّع بالكود والبنود الظاهرة حصرًا", () => {
    expect(res.divisions.length).toBe(2);
    const conc = res.divisions.find((d) => d.divisionCode === "03")!;
    expect(conc.itemsCount).toBe(1);
    expect(conc.contractAmount).toBe(1000);
    const steel = res.divisions.find((d) => d.divisionCode === "05")!;
    expect(steel.itemsCount).toBe(1);
    expect(steel.pct).toBe(20); // 40/200
  });

  it("أدوار المستخلصات في الحاضر: معتمد سابق ومسودة/مقدم حالي", () => {
    expect(res.invoices.find((i) => i.id === 1)?.role).toBe("سابق");
    expect(res.invoices.find((i) => i.id === 2)?.role).toBe("حالي");
    expect(res.invoices.find((i) => i.id === 3)?.role).toBe("حالي");
    expect(res.invoices.find((i) => i.id === 4)).toBeUndefined(); // الملغاة خارج القائمة
  });
});

// ==================== 4) الاسترجاع الزمني (as-of) ====================

describe("ز3 — الوضع التاريخي (asOf=2026-11-10)", () => {
  const items = [item({ id: 1, qty: 100, unitPrice: 10 })];
  const invoices = [
    inv({ id: 1, invoiceDate: "2026-11-01", state: "معتمد", approveAt: "2026-11-05", total: 300 }), // سابق عند التاريخ
    inv({ id: 2, invoiceDate: "2026-11-08", state: "معتمد", approveAt: "2026-11-15", total: 200 }), // كان حاليًا ثم ساق
    inv({ id: 3, invoiceDate: "2026-11-20", state: "مسودة", approveAt: "" }), // لاحق — خارج التاريخ
    inv({ id: 4, invoiceDate: "2026-11-09", state: "مقدم", approveAt: "" }), // حالي عند التاريخ
  ];
  const lines = [line(1, 1, 30), line(2, 1, 20), line(3, 1, 50), line(4, 1, 10)];

  const res = deriveBoqState({ asOf: "2026-11-10", items, addendums: [], addendumItems: [], invoices, lines });

  it("المعتمد قبل asOf سابق والمعتمد بعده كان حاليًا وساق", () => {
    const i1 = res.items.find((r) => r.id === 1)!;
    expect(i1.priorQty).toBe(30);
    expect(i1.currentQty).toBe(30); // 20 (ساق) + 10 (مقدم)
    expect(i1.totalPct).toBe(60);
  });

  it("شارات ساق على من أغلقته اعتمادات أحدث حصرًا", () => {
    expect(res.invoices.find((i) => i.id === 1)?.role).toBe("سابق");
    expect(res.invoices.find((i) => i.id === 1)?.sakat).toBe(false);
    const s = res.invoices.find((i) => i.id === 2)!;
    expect(s.role).toBe("حالي");
    expect(s.sakat).toBe(true);
    expect(res.invoices.find((i) => i.id === 3)?.role).toBe("لاحق");
    const p = res.invoices.find((i) => i.id === 4)!;
    expect(p.role).toBe("حالي");
    expect(p.sakat).toBe(false);
  });

  it("الصادر فورًا بلا تأشيرة اعتماد (approveAt فارغ) لحظة اعتماده = تاريخ الفاتورة (دلالة ز2)", () => {
    // INV صدر معتمدًا 2026-10-10 (approveAt="") — عند 11-10 سابق بالفعل وعند 10-05 لاحق
    const res2 = deriveBoqState({
      asOf: "2026-11-10",
      items,
      addendums: [],
      addendumItems: [],
      invoices: [inv({ id: 5, invoiceDate: "2026-10-10", state: "معتمد", approveAt: "" })],
      lines: [line(5, 1, 25)],
    });
    expect(res2.invoices[0].role).toBe("سابق");
    expect(res2.invoices[0].sakat).toBe(false);
    expect(res2.items[0].priorQty).toBe(25);
    const res3 = deriveBoqState({
      asOf: "2026-10-05",
      items,
      addendums: [],
      addendumItems: [],
      invoices: [inv({ id: 5, invoiceDate: "2026-10-10", state: "معتمد", approveAt: "" })],
      lines: [line(5, 1, 25)],
    });
    expect(res3.invoices[0].role).toBe("لاحق");
    expect(res3.items[0].priorQty).toBe(0);
  });

  it("فاتورة مستخلص اعتمد في يوم asOf نفسه يعدّ سابقًا (شامل اليوم)", () => {
    const res2 = deriveBoqState({
      asOf: "2026-11-15",
      items,
      addendums: [],
      addendumItems: [],
      invoices: [inv({ id: 2, invoiceDate: "2026-11-08", state: "معتمد", approveAt: "2026-11-15" })],
      lines: [line(2, 1, 20)],
    });
    expect(res2.invoices[0].role).toBe("سابق");
    expect(res2.items[0].priorQty).toBe(20);
    expect(res2.items[0].currentQty).toBe(0);
  });
});

// ==================== 5) تنفيذ زائد وحدود ====================

describe("ز3 — تنفيذ زائد وأسطر حرة", () => {
  it("النسبة تتجاوز 100 بلا خفض (إشارة حقيقية)", () => {
    const res = deriveBoqState({
      asOf: null,
      items: [item({ id: 1, qty: 10, unitPrice: 5 })],
      addendums: [],
      addendumItems: [],
      invoices: [inv({ id: 1, state: "معتمد", approveAt: "2026-11-01" })],
      lines: [line(1, 1, 12)],
    });
    expect(res.items[0].priorQty).toBe(12);
    expect(res.items[0].availableQty).toBe(0);
    expect(res.items[0].totalPct).toBe(120);
    expect(res.totals.pct).toBe(120);
  });

  it("بند مخفي تاريخيًا يخرج من إجماليات العقد لكنه يبقى في القائمة بوسم visible=false", () => {
    const deleted = item({ id: 9, deleted: true, deletedAddendumId: 40, qty: 100, unitPrice: 10 });
    const res = deriveBoqState({
      asOf: "2026-11-10",
      items: [item({ id: 1, qty: 100, unitPrice: 10 }), deleted],
      addendums: [{ id: 40, addendumNumber: "ADD-040", approvedDate: "2026-10-01" }],
      addendumItems: [],
      invoices: [inv({ id: 1, state: "معتمد", approveAt: "2026-11-01" })],
      lines: [line(1, 1, 30), line(1, 9, 999)],
    });
    expect(res.items.find((r) => r.id === 9)?.visible).toBe(false);
    expect(res.totals.contractAmount).toBe(1000); // البند المحذوف خارج الإجمالي
    expect(res.items.find((r) => r.id === 9)?.priorQty).toBe(999); // القيم محسوبة لكن غير مرئية
  });
});

// ==================== 6) التايملاين ====================

describe("ز3 — deriveBoqTimeline", () => {
  it("فتح ← تقديم ← اعتماد لمستخلص واحد بترتيب تصاعدي داخل اليوم الصحيح", () => {
    const events = deriveBoqTimeline({
      invoices: [
        inv({ id: 1, invoiceDate: "2026-11-01", submitAt: "2026-11-01", approveAt: "2026-11-02", total: 500 }),
      ],
      addendums: [],
      voidEvents: [],
    });
    expect(events.map((e) => e.kind)).toEqual(["فتح مستخلص", "تقديم مستخلص", "اعتماد مستخلص"]);
    expect(events[0].date).toBe("2026-11-01");
    expect(events[0].invoiceId).toBe(1);
    expect(events[2].label).toContain("INV-0001");
  });

  it("الإلغاء من حدث ContractEvent بمطابقة رقم المستخلص من الوصف", () => {
    const events = deriveBoqTimeline({
      invoices: [inv({ id: 2, status: "void", state: "معتمد", approveAt: "2026-11-05", invoiceDate: "2026-11-01" })],
      addendums: [],
      voidEvents: [
        { eventTime: "2026-11-08T09:00:00.000Z", description: "إلغاء الفاتورة INV-0002 بمبلغ 500 — السبب: خطأ إدخال" },
      ],
    });
    // الفاتورة الملغاة: فتحها يظهر، وتقديم/اعتمادها لا يظهران (status=void)، والإلغاء من الحدث
    expect(events.map((e) => e.kind)).toEqual(["فتح مستخلص", "إلغاء مستخلص"]);
    const voidEv = events.find((e) => e.kind === "إلغاء مستخلص")!;
    expect(voidEv.date).toBe("2026-11-08");
    expect(voidEv.invoiceNumber).toBe("INV-0002");
    expect(voidEv.invoiceId).toBe(2);
  });

  it("الملحق المعتمد يسبق أحداث اليوم نفسه (البنية قبل الفتح)", () => {
    const events = deriveBoqTimeline({
      invoices: [inv({ id: 1, invoiceDate: "2026-10-01", approveAt: "2026-10-02" })],
      addendums: [{ addendumNumber: "ADD-001", approvedDate: "2026-10-01", description: "أمر تغييري إضافي" }],
      voidEvents: [],
    });
    expect(events[0]).toMatchObject({ date: "2026-10-01", kind: "ملحق معتمد" });
    expect(events.find((e) => e.kind === "فتح مستخلص")?.date).toBe("2026-10-01");
  });

  it("الفراغ الآمن: بلا مدخلات = بلا أحداث", () => {
    expect(deriveBoqTimeline({ invoices: [], addendums: [], voidEvents: [] })).toEqual([]);
  });
});
