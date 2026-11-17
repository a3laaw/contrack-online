/**
 * purchase-core.test.ts — اختبارات نواة ر4 «الموردون وأوامر الشراء» النقية (docs/purchase-design.md §4/§8):
 * • آلة الحالات المغلقة (د3) · حارس الزيادة على المطلوب (د4) · الحالة والقيمة بعد الاستلام اشتقاقيًا (G9)
 * • منع إلغاء المستلم منه · إجمالي الأمر المجمّد · المؤشرات الاشتقاقية
 */
import { describe, expect, test } from "bun:test";

import {
  PO_STATUSES,
  PO_CREATE_STATUSES,
  poAllowedTargets,
  poStatusBadgeClass,
  poTransitionAllowed,
  isPurchaseOrderStatus,
} from "../src/lib/purchase-constants";
import {
  assertCancelAllowed,
  assertReceiptLine,
  cleanPurchaseDate,
  cleanPurchaseText,
  poLineRemaining,
  poReceivedAmountAfter,
  poStatusAfterReceipt,
  poTotalAmount,
  purchaseKpis,
  r3,
} from "../src/lib/purchase-core";

describe("مفردات أوامر الشراء المغلقة (G7)", () => {
  test("الحالات الخمس والانتقالات المسموحة فقط", () => {
    expect(PO_STATUSES).toEqual(["مسودة", "مرسل للمورد", "جزئي", "مستلم", "ملغى"]);
    expect(PO_CREATE_STATUSES).toEqual(["مسودة", "مرسل للمورد"]);
    expect(poAllowedTargets("مسودة")).toEqual(["مرسل للمورد", "ملغى"]);
    expect(poAllowedTargets("مرسل للمورد")).toEqual(["جزئي", "مستلم", "ملغى"]);
    expect(poAllowedTargets("جزئي")).toEqual(["مستلم", "ملغى"]);
    expect(poAllowedTargets("مستلم")).toEqual([]);
    expect(poAllowedTargets("ملغى")).toEqual([]);
    expect(poTransitionAllowed("مسودة", "مستلم")).toBeFalse(); // لا قفز إلى المستلم
    expect(isPurchaseOrderStatus("جزئي")).toBeTrue();
    expect(isPurchaseOrderStatus("مرحلة وهمية")).toBeFalse();
  });

  test("شارات الحالات من لوحة NOVA حصرًا", () => {
    expect(poStatusBadgeClass("مسودة")).toBe("bg-secondary text-secondary-foreground");
    expect(poStatusBadgeClass("مرسل للمورد")).toBe("bg-status-warn-bg text-warn-ink");
    expect(poStatusBadgeClass("جزئي")).toBe("bg-status-info-bg text-status-info");
    expect(poStatusBadgeClass("مستلم")).toBe("bg-status-done-bg text-status-done");
    expect(poStatusBadgeClass("ملغى")).toBe("bg-status-danger-bg text-status-danger");
    expect(poStatusBadgeClass("غير معروف")).toBe("bg-secondary text-secondary-foreground");
  });
});

describe("حارس الزيادة (د4) والباقي السطري", () => {
  const line = { itemId: 1, itemName: "أسمنت مقاوم", qty: 100, receivedQty: 40, unitPrice: 2.5 };

  test("استلام ضمن المطلوب يمر — والزيادة ترفض برسالة بالأرقام", () => {
    const ok = assertReceiptLine(line, 60);
    expect(ok.ok).toBeTrue();
    if (ok.ok) expect(ok.remainingAfter).toBe(0);
    const bad = assertReceiptLine(line, 61);
    expect(bad.ok).toBeFalse();
    if (!bad.ok) {
      expect(bad.error).toContain("أسمنت مقاوم");
      expect(bad.error).toContain("100");
      expect(bad.error).toContain("40");
    }
  });

  test("كمية صفر أو سالبة ترفض", () => {
    const zero = assertReceiptLine(line, 0);
    expect(zero.ok).toBeFalse();
    const negative = assertReceiptLine(line, -5);
    expect(negative.ok).toBeFalse();
    if (!negative.ok) expect(negative.error).toContain("أكبر من صفر");
  });

  test("poLineRemaining لا سالب أبدًا", () => {
    expect(poLineRemaining({ itemId: 1, qty: 10, receivedQty: 12, unitPrice: 1 })).toBe(0);
    expect(poLineRemaining(line)).toBe(60);
  });
});

describe("الحالة والقيمة بعد الاستلام (اشتقاقية — G9)", () => {
  const lines = [
    { itemId: 1, qty: 10, receivedQty: 10, unitPrice: 2 },
    { itemId: 2, qty: 5, receivedQty: 5, unitPrice: 4 },
  ];

  test("اكتمال كل السطور ⇒ «مستلم» — وإلا «جزئي»", () => {
    expect(poStatusAfterReceipt(lines)).toBe("مستلم");
    expect(poStatusAfterReceipt([{ itemId: 1, qty: 10, receivedQty: 4, unitPrice: 2 }])).toBe("جزئي");
    expect(poStatusAfterReceipt([])).toBe("جزئي"); // بلا بنود لا يُحتسب مستلمًا أبدًا
  });

  test("قيمة المستلم تجمّد على الرأس بعد كل استلام — لا تتجاوز قيمة المطلوب", () => {
    const after = poReceivedAmountAfter(
      [{ itemId: 1, qty: 10, receivedQty: 0, unitPrice: 2.5 }, { itemId: 2, qty: 4, receivedQty: 0, unitPrice: 1 }],
      [{ itemId: 1, qty: 6 }]
    );
    expect(after).toBe(15);
    // استلام زائد محتمل (قبل الحرس) لا يرفع القيمة فوق قيمة السطر
    const capped = poReceivedAmountAfter(
      [{ itemId: 1, qty: 10, receivedQty: 8, unitPrice: 2 }],
      [{ itemId: 1, qty: 5 }]
    );
    expect(capped).toBe(20);
  });

  test("إجمالي الأمر المجمّد = Σ كمية×سعر بثلاث منازل", () => {
    expect(poTotalAmount([{ qty: 3.333, unitPrice: 2.5 }, { qty: 1, unitPrice: 0.005 }])).toBe(r3(3.333 * 2.5 + 0.005));
    expect(poTotalAmount([])).toBe(0);
  });

  test("r3 المحلية مطابقة لسلوك التقريب الثلاثي", () => {
    expect(r3(1.0005)).toBe(1.001);
    expect(r3(NaN)).toBe(0);
  });
});

describe("الإلغاء (د3/جدول المسارات)", () => {
  test("المستلم منه جزئيًا ممنوع برسالة — والمسودة/المرسل تُلغى", () => {
    const blocked = assertCancelAllowed("جزئي", 100);
    expect(blocked.ok).toBeFalse();
    if (!blocked.ok) expect(blocked.error).toContain("مستلم منه جزئيًا");
    expect(assertCancelAllowed("مسودة", 0)).toEqual({ ok: true });
    expect(assertCancelAllowed("مرسل للمورد", 0)).toEqual({ ok: true });
    const closed = assertCancelAllowed("مستلم", 500);
    expect(closed.ok).toBeFalse();
  });
});

describe("التشذيب والمؤشرات", () => {
  test("cleanPurchaseText والتاريخ", () => {
    expect(cleanPurchaseText("  مورد البرج  ")).toBe("مورد البرج");
    expect(cleanPurchaseDate("2026-11-20")).toBe("2026-11-20");
    expect(cleanPurchaseDate("20-11-2026")).toBe("");
  });

  test("مؤشرات الملخص: المفتوح بقيمه والمستلم والموردون النشطون", () => {
    const k = purchaseKpis([
      { status: "مسودة", totalAmount: 100, receivedAmount: 0, supplierId: 1, active: true },
      { status: "مرسل للمورد", totalAmount: 250, receivedAmount: 0, supplierId: 2, active: true },
      { status: "جزئي", totalAmount: 500, receivedAmount: 200, supplierId: 1, active: true },
      { status: "مستلم", totalAmount: 300, receivedAmount: 300, supplierId: 3, active: false },
      { status: "ملغى", totalAmount: 999, receivedAmount: 0, supplierId: 2, active: true },
    ]);
    expect(k.openCount).toBe(3);
    expect(k.openValue).toBe(850);
    // المستلم من المستلم فقط — والملغى بلا قيمة مستلمة
    expect(k.receivedValue).toBe(500);
    // النشطون: 1 و2 فقط — المورد 3 غير نشط (G9 اشتقاقي من الصفوف)
    expect(k.activeSuppliers).toBe(2);
  });
});
