/**
 * اختبار مصفوفة المطابقة — المرحلة 1: بيان السند التلقائي (قبض/صرف × كامل/جزئي/زيادة × مربوط/غير مربوط)
 * المرجع المكتبي:
 *   - voucher_payment_link_service: _ordinal_i / _alloc_core / partial_tail / describe_items
 *   - extras_service: smart_receipt_description / allocated_description / apply_description_prefix
 *   - supervision_service: supervision_receipt_description
 * الأمثلة الذهبية حرفيًا من البرومبت المعتمد (V9.15.19) — X = اسم العقد.
 * التشغيل: bun test tests/voucher-describe-matrix.test.ts
 */
import { describe, expect, test } from "bun:test";
import {
  allocatedDescription,
  applyDescriptionPrefix,
  describeForLinks,
  describeItems,
  ordinalI,
  partialTail,
  smartReceiptDescription,
  supervisionReceiptDescription,
} from "@/lib/voucher-describe";

type Db = Parameters<typeof applyDescriptionPrefix>[0];
type Core = Parameters<typeof smartReceiptDescription>[1];

// ==== قاعدة بيانات وهمية (تغطي كل ما تستهلكه دوال البيان) ====
interface MockOpts {
  settings?: Record<string, unknown> | null;
  stages?: { id: number; name: string }[];
  addendums?: Record<string, unknown>[];
  allocRows?: { allocation: string; _sum: { amount: number } }[];
  prevLinks?: { lineId: number; voucherId: number }[];
  prevCount?: number;
}

function mockDb(over: MockOpts = {}): Db {
  return {
    setting: { findUnique: async () => over.settings ?? null, findFirst: async () => over.settings ?? null },
    contractStage: { findMany: async () => over.stages ?? [] },
    addendum: { findMany: async () => over.addendums ?? [] },
    voucher: {
      groupBy: async () => over.allocRows ?? [],
      count: async () => over.prevCount ?? 0,
    },
    voucherPaymentLink: { findMany: async () => over.prevLinks ?? [] },
  } as unknown as Db;
}

function makeCore(over: {
  value?: number;
  collected?: number;
  lines?: { id: number; amountN: number; stageId?: number | null; remaining?: number; explicit?: number; title?: string }[];
  sup?: { collected: number; baseValue: number; extensionValue: number } | null;
  supMonthly?: number;
}): Core {
  return {
    contract: {
      id: 1, contractName: "X", description: "", contractNumber: "C-1",
      supStartDate: over.sup ? "2026-01-01" : "",
      supMonths: over.sup ? 12 : 0,
      supMonthly: over.supMonthly ?? 0,
      supDiscount: 0, supWaivedMonths: 0,
    },
    sup: over.sup ?? null,
    current: over.value ?? 0,
    computed: { collected: over.collected ?? 0, lines: over.lines ?? [] },
    receipts: [],
  } as unknown as Core;
}

// ============================================================
// 1) الترقيم الترتيبي — مرآة _ordinal_i
// ============================================================
describe("ordinalI (V9.15.19)", () => {
  test("١-١٠ كلمات ترتيبية", () => {
    expect(ordinalI(1)).toBe("الأولى");
    expect(ordinalI(2)).toBe("الثانية");
    expect(ordinalI(3)).toBe("الثالثة");
    expect(ordinalI(10)).toBe("العاشرة");
  });
  test("١١ وما بعدها «رقم N»", () => {
    expect(ordinalI(11)).toBe("رقم 11");
    expect(ordinalI(12)).toBe("رقم 12");
    expect(ordinalI(0)).toBe("رقم 0");
  });
});

// ============================================================
// 2) ذيل الدفع الجزئي — مرآة partial_tail
// ============================================================
describe("partialTail (V9.15.19)", () => {
  test("الصيغة الحرفية « ومتبقي منها {X:,.3f} د.ك»", () => {
    expect(partialTail(2000)).toBe(" ومتبقي منها 2,000.000 د.ك");
    expect(partialTail(1500)).toBe(" ومتبقي منها 1,500.000 د.ك");
    expect(partialTail(400)).toBe(" ومتبقي منها 400.000 د.ك");
  });
  test("لا ذيل عند التغطية الكاملة أو تحت العتبة 0.001", () => {
    expect(partialTail(0)).toBe("");
    expect(partialTail(-5)).toBe("");
    expect(partialTail(0.0008)).toBe("");
    expect(partialTail(0.002)).toBe(" ومتبقي منها 0.002 د.ك");
  });
});

// ============================================================
// 3) مصفوفة المربوط (الروابط الصريحة) — describeItems
// ============================================================
describe("المصفوفة المربوطة — describeItems", () => {
  test("قبض كامل بمرحلة: «سداد الدفعة الأولى وهي عن أعمال استلام — عقد X»", () => {
    const t = describeItems(
      [{ number: 1, stage: "استلام", full: true, remaining: 3000, amount: 3000 }], 0, "X");
    expect(t).toBe("سداد الدفعة الأولى وهي عن أعمال استلام — عقد X");
  });
  test("قبض جزئي: «سداد جزء من الدفعة الثانية ومتبقي منها 2,000.000 د.ك — عقد X»", () => {
    const t = describeItems(
      [{ number: 2, full: false, remaining: 5000, amount: 3000 }], 0, "X");
    expect(t).toBe("سداد جزء من الدفعة الثانية ومتبقي منها 2,000.000 د.ك — عقد X");
  });
  test("الجزء الثاني جزئي: «سداد الجزء الثاني من الدفعة الثانية ومتبقي منها 1,500.000 د.ك — عقد X»", () => {
    const t = describeItems(
      [{ number: 2, full: false, part_ordinal: "الثاني", remaining: 3000, amount: 1500 }], 0, "X");
    expect(t).toBe("سداد الجزء الثاني من الدفعة الثانية ومتبقي منها 1,500.000 د.ك — عقد X");
  });
  test("استكمال دفعة كانت جزئية: «استكمال الدفعة الثانية — عقد X»", () => {
    const t = describeItems(
      [{ number: 2, full: true, continuation: true, remaining: 2000, amount: 2000 }], 0, "X");
    expect(t).toBe("استكمال الدفعة الثانية — عقد X");
  });
  test("زيادة مقدمة بلا دفعات: «سداد على الحساب وزيادة مقدمة — عقد X»", () => {
    expect(describeItems([], 500, "X")).toBe("سداد على الحساب وزيادة مقدمة — عقد X");
  });
  test("على الحساب: «سداد على الحساب — عقد X»", () => {
    expect(describeItems([], 0, "X")).toBe("سداد على الحساب — عقد X");
  });
  test("دفعة 11: «سداد الدفعة رقم 11 — عقد X»", () => {
    const t = describeItems([{ number: 11, full: true, remaining: 0, amount: 0 }], 0, "X");
    expect(t).toBe("سداد الدفعة رقم 11 — عقد X");
  });
  test("دفعتان كاملتان: «سداد الدفعة الأولى والدفعة الثانية — عقد X»", () => {
    const t = describeItems(
      [{ number: 1, full: true, remaining: 1000, amount: 1000 },
       { number: 2, full: true, remaining: 2000, amount: 2000 }], 0, "X");
    expect(t).toBe("سداد الدفعة الأولى والدفعة الثانية — عقد X");
  });
});

// ============================================================
// 4) مصفوفة غير المربوط — smartReceiptDescription (ق1–ق12)
// ============================================================
describe("المصفوفة غير المربوطة — smartReceiptDescription", () => {
  test("عقد بلا خطة سُدد كاملًا: «سداد كامل قيمة العقد — عقد X»", async () => {
    const db = mockDb();
    const core = makeCore({ value: 3000, collected: 0 });
    expect(await smartReceiptDescription(db, core, 3000)).toBe("سداد كامل قيمة العقد — عقد X");
  });
  test("عقد بلا خطة أول قبض: «سداد دفعة أولى — عقد X»", async () => {
    const db = mockDb();
    const core = makeCore({ value: 3000, collected: 0 });
    expect(await smartReceiptDescription(db, core, 1000)).toBe("سداد دفعة أولى — عقد X");
  });
  test("عقد بلا خطة قبض لاحق: «سداد على الحساب — عقد X»", async () => {
    const db = mockDb();
    const core = makeCore({ value: 3000, collected: 1000 });
    expect(await smartReceiptDescription(db, core, 1000)).toBe("سداد على الحساب — عقد X");
  });
  test("زيادة تتجاوز قيمة العقد: «سداد على الحساب وزيادة مقدمة — عقد X»", async () => {
    const db = mockDb();
    const core = makeCore({ value: 3000, collected: 1000 });
    expect(await smartReceiptDescription(db, core, 3000)).toBe("سداد على الحساب وزيادة مقدمة — عقد X");
  });
  test("قبض جزئي من الدفعة الأولى: «سداد جزء من الدفعة الأولى ومتبقي منها 400.000 د.ك — عقد X»", async () => {
    const db = mockDb();
    const core = makeCore({
      value: 3000, collected: 0,
      lines: [{ id: 1, amountN: 1000 }, { id: 2, amountN: 2000 }],
    });
    expect(await smartReceiptDescription(db, core, 600))
      .toBe("سداد جزء من الدفعة الأولى ومتبقي منها 400.000 د.ك — عقد X");
  });
  test("قبض يكمل الأولى ويجزّئ الثانية: «سداد الدفعة الأولى وجزء من الدفعة الثانية ومتبقي منها 1,000.000 د.ك — عقد X»", async () => {
    const db = mockDb();
    const core = makeCore({
      value: 3000, collected: 600,
      lines: [{ id: 1, amountN: 1000 }, { id: 2, amountN: 2000 }],
    });
    expect(await smartReceiptDescription(db, core, 1400))
      .toBe("سداد الدفعة الأولى وجزء من الدفعة الثانية ومتبقي منها 1,000.000 د.ك — عقد X");
  });
  test("قبض كامل بمرحلة: «سداد الدفعة الأولى وهي عن أعمال استلام — عقد X»", async () => {
    const db = mockDb({ stages: [{ id: 7, name: "استلام" }] });
    const core = makeCore({
      value: 1000, collected: 0,
      lines: [{ id: 1, amountN: 1000, stageId: 7 }],
    });
    expect(await smartReceiptDescription(db, core, 1000))
      .toBe("سداد الدفعة الأولى وهي عن أعمال استلام — عقد X");
  });
});

// ============================================================
// 5) القبض المخصّص — allocatedDescription (أمر تغييري/عقد إضافي)
// ============================================================
describe("المصفوفة المخصّصة — allocatedDescription", () => {
  const addendums = [
    { addendumNumber: "ADD-001", addendumType: "أمر تغييري", reason: "السبب", amountAdd: 2000, amountDeduct: 0 },
    { addendumNumber: "ADD-002", addendumType: "عقد إضافي", reason: "السبب", amountAdd: 3000, amountDeduct: 0 },
  ];
  test("أمر تغييري كامل: «سداد الأمر التغييري ADD-001 (السبب) — عقد X»", async () => {
    const db = mockDb({ addendums });
    expect(await allocatedDescription(db, 1, 2000, "ADD-001", "X"))
      .toBe("سداد الأمر التغييري ADD-001 (السبب) — عقد X");
  });
  test("عقد إضافي كامل: «سداد العقد الإضافي ADD-002 (السبب) — عقد X»", async () => {
    const db = mockDb({ addendums });
    expect(await allocatedDescription(db, 1, 3000, "ADD-002", "X"))
      .toBe("سداد العقد الإضافي ADD-002 (السبب) — عقد X");
  });
  test("جزء أول: «سداد جزء من الأمر التغييري ADD-001 (السبب) — عقد X»", async () => {
    const db = mockDb({ addendums });
    expect(await allocatedDescription(db, 1, 500, "ADD-001", "X"))
      .toBe("سداد جزء من الأمر التغييري ADD-001 (السبب) — عقد X");
  });
  test("جزء ثانٍ: «سداد الجزء الثاني من الأمر التغييري ADD-001 (السبب) — عقد X»", async () => {
    const db = mockDb({ addendums, allocRows: [{ allocation: "ADD-001", _sum: { amount: 500 } }], prevCount: 1 });
    expect(await allocatedDescription(db, 1, 500, "ADD-001", "X"))
      .toBe("سداد الجزء الثاني من الأمر التغييري ADD-001 (السبب) — عقد X");
  });
  test("استكمال: «استكمال الأمر التغييري ADD-001 (السبب) — عقد X»", async () => {
    const db = mockDb({ addendums, allocRows: [{ allocation: "ADD-001", _sum: { amount: 1500 } }], prevCount: 1 });
    expect(await allocatedDescription(db, 1, 500, "ADD-001", "X"))
      .toBe("استكمال الأمر التغييري ADD-001 (السبب) — عقد X");
  });
  test("تخصيص غير معروف: «سداد مقابل بند إضافي — عقد X»", async () => {
    const db = mockDb({ addendums });
    expect(await allocatedDescription(db, 1, 500, "ADD-999", "X"))
      .toBe("سداد مقابل بند إضافي — عقد X");
  });
});

// ============================================================
// 6) بادئة الإعدادات + منع تكرار «سداد» (V9.15.19)
// ============================================================
describe("applyDescriptionPrefix — منع التكرار", () => {
  const text = "سداد الدفعة الأولى — عقد X";
  test("بادئة تحتوي «سداد» + نص يبدأ بـ«سداد » ⇒ يُحذف التكرار", async () => {
    const db = mockDb({ settings: { descPrefixReceipt: "سداد مقطوعات" } });
    expect(await applyDescriptionPrefix(db, "receipt", text))
      .toBe("سداد مقطوعات: الدفعة الأولى — عقد X");
  });
  test("بادئة بلا «سداد» ⇒ النص كما هو مع البادئة", async () => {
    const db = mockDb({ settings: { descPrefixReceipt: "بيان الاستلام" } });
    expect(await applyDescriptionPrefix(db, "receipt", text))
      .toBe("بيان الاستلام: سداد الدفعة الأولى — عقد X");
  });
  test("بادئة فارغة ⇒ النص كما هو", async () => {
    const db = mockDb();
    expect(await applyDescriptionPrefix(db, "receipt", text)).toBe(text);
  });
  test("إزالة «:» الزائدة من البادئة", async () => {
    const db = mockDb({ settings: { descPrefixReceipt: "سداد:" } });
    expect(await applyDescriptionPrefix(db, "receipt", "الدفعة الأولى — عقد X"))
      .toBe("سداد: الدفعة الأولى — عقد X");
  });
});

// ============================================================
// 7) نهاية-إلى-نهاية عبر describeForLinks (الخوارزمية الكاملة)
// ============================================================
describe("describeForLinks — مسار الروابط الفعلي", () => {
  const plan = [
    { id: 1, amountN: 3000, remaining: 0, explicit: 0, stageId: null, title: "" },
    { id: 2, amountN: 5000, remaining: 5000, explicit: 0, stageId: null, title: "" },
  ] as unknown as Parameters<typeof describeForLinks>[3];
  test("ربط جزئي بالدفعة الثانية = المثال الذهبي حرفيًا", async () => {
    const db = mockDb();
    const r = await describeForLinks(db, 3000, [{ lineId: 2, amount: 3000 }], plan, new Set(), "receipt", "X", new Map());
    expect(r.text).toBe("سداد جزء من الدفعة الثانية ومتبقي منها 2,000.000 د.ك — عقد X");
  });
  test("ربط كامل بالدفعة الثانية = «سداد الدفعة الثانية»", async () => {
    const db = mockDb();
    const r = await describeForLinks(db, 5000, [{ lineId: 2, amount: 5000 }], plan, new Set(), "receipt", "X", new Map());
    expect(r.text).toBe("سداد الدفعة الثانية — عقد X");
  });
  test("مبلغ يتجاوز الخطة = «سداد الدفعة الثانية وزيادة مقدمة»", async () => {
    const db = mockDb();
    const r = await describeForLinks(db, 6000, [{ lineId: 2, amount: 6000 }], plan, new Set(), "receipt", "X", new Map());
    expect(r.text).toBe("سداد الدفعة الثانية وزيادة مقدمة — عقد X");
  });
});

// ============================================================
// 8) قفل سلوك الإشراف (لم يتغير — مرآة supervision_receipt_description V9.15.18)
// ============================================================
describe("supervisionReceiptDescription — قفل السلوك القائم", () => {
  test("شهر صحيح: «سداد شهر واحد من عقد الإشراف — عقد X»", async () => {
    const db = mockDb();
    const core = makeCore({ sup: { collected: 0, baseValue: 3000, extensionValue: 0 }, supMonthly: 1000 });
    expect(await supervisionReceiptDescription(db, core, 1000))
      .toBe("سداد شهر واحد من عقد الإشراف — عقد X");
  });
  test("جزء شهر: «سداد جزء من قيمة عقد الإشراف والمتبقي منها 2,000.000 — عقد X» (بلا د.ك — كالمكتبي)", async () => {
    const db = mockDb();
    const core = makeCore({ sup: { collected: 0, baseValue: 3000, extensionValue: 0 }, supMonthly: 0 });
    expect(await supervisionReceiptDescription(db, core, 1000))
      .toBe("سداد جزء من قيمة عقد الإشراف والمتبقي منها 2,000.000 — عقد X");
  });
});
