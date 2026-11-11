/**
 * اختبارات نواة المرحلة (أ) (docs/retention-subipc-advance-design.md §1-§3):
 *  §1 المحتجزات: التحقق من النسبة · المحتجز الفعلي · المطلوب نقدًا · حواجز الإفراج · أسطر القيد
 *  §2 استرداد الدفعة المقدمة: min(المطلوب، المتبقي) · التحقق من حقول العقد
 *  §3 مستخلص الباطن: آلة الحالات المغلقة · التراكمي الكمي · الصافي · المؤشرات
 */
import { describe, expect, test } from "bun:test";

import { EPS, r3 } from "../src/lib/contrack-core";
import {
  buildInvoiceIssueLines,
  canReleaseRetention,
  canSubCertApprove,
  canSubCertCancel,
  canSubCertDelete,
  canSubCertEdit,
  canSubCertPay,
  canSubCertSubmit,
  computeAdvanceRecovery,
  computeNetDue,
  computeRetentionAmount,
  computeSubCertNet,
  RETENTION_RATE_MAX,
  SUBCERT_APPROVED,
  SUBCERT_CANCELLED,
  SUBCERT_DRAFT,
  SUBCERT_PAID,
  SUBCERT_SUBMITTED,
  subCertKpis,
  subItemAvailable,
  validateAdvanceFields,
  validateRetentionRate,
  validateSubCertDeductions,
  validateSubCertLines,
} from "../src/lib/phase-a-core";

// ==================== §1 المحتجزات ====================

describe("validateRetentionRate — النسبة 0-25 حصرًا", () => {
  test("القيم السليمة تُمرر مع التقريب", () => {
    expect(validateRetentionRate(0)).toEqual({ ok: true, rate: 0 });
    expect(validateRetentionRate(5)).toEqual({ ok: true, rate: 5 });
    expect(validateRetentionRate(12.5)).toEqual({ ok: true, rate: 12.5 });
    expect(validateRetentionRate(RETENTION_RATE_MAX)).toEqual({ ok: true, rate: 25 });
  });

  test("الفارغ/غير المرسل = صفر (سلوك قائم حرفيًا)", () => {
    expect(validateRetentionRate(undefined)).toEqual({ ok: true, rate: 0 });
    expect(validateRetentionRate(null)).toEqual({ ok: true, rate: 0 });
    expect(validateRetentionRate("")).toEqual({ ok: true, rate: 0 });
  });

  test("خارج السقف أو سالب ⇒ رفض (المدخلات غير الرقمية تُعامل صفرًا كنمط numOr الموحد)", () => {
    expect(validateRetentionRate(25.5).ok).toBe(false);
    expect(validateRetentionRate(-1).ok).toBe(false);
    expect(validateRetentionRate("abc")).toEqual({ ok: true, rate: 0 });
  });
});

describe("computeRetentionAmount — المحتجز الفعلي", () => {
  test("round3(total × rate/100)", () => {
    expect(computeRetentionAmount(1000, 10)).toBe(100);
    expect(computeRetentionAmount(1234.567, 5)).toBe(61.728);
    expect(computeRetentionAmount(999.999, 25)).toBe(250);
  });

  test("الصفر لا يحسب", () => {
    expect(computeRetentionAmount(1000, 0)).toBe(0);
    expect(computeRetentionAmount(0, 10)).toBe(0);
  });
});

describe("computeNetDue — المطلوب نقدًا", () => {
  test("total − محتجزات − مسترد", () => {
    expect(computeNetDue(1000, 100, 50)).toBe(850);
    expect(computeNetDue(1000, 0, 0)).toBe(1000);
  });
});

describe("canReleaseRetention — حواجز الإفراج", () => {
  const base = { status: "unpaid", retentionAmount: 100, retentionReleased: false };
  test("الفاتورة السليمة تُفرج", () => {
    expect(canReleaseRetention(base).ok).toBe(true);
  });
  test("الملغاة/المفرج عنها/بلا محتجزات تُرفض", () => {
    expect(canReleaseRetention({ ...base, status: "void" }).ok).toBe(false);
    expect(canReleaseRetention({ ...base, retentionReleased: true }).ok).toBe(false);
    expect(canReleaseRetention({ ...base, retentionAmount: 0 }).ok).toBe(false);
  });
});

describe("buildInvoiceIssueLines — قيد الإصدار الموسّع", () => {
  const args = {
    receivableAccountId: 11,
    retentionAccountId: 22,
    revenueAccountId: 33,
    receivableName: "ذمم العملاء",
    retentionName: "محتجزات العملاء",
    revenueName: "إيرادات العقود",
    dims: { customerId: 7, contractId: 5 as number | null },
  };

  test("بلا محتجزات = السطران القائمان حرفيًا", () => {
    const lines = buildInvoiceIssueLines({ ...args, total: 1000, retentionAmount: 0 });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ accountId: 11, debit: 1000, credit: 0 });
    expect(lines[1]).toMatchObject({ accountId: 33, debit: 0, credit: 1000 });
  });

  test("مع محتجزات = 3 أسطر متوازنة: (total−R) + R = total", () => {
    const lines = buildInvoiceIssueLines({ ...args, total: 1000, retentionAmount: 100 });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ accountId: 11, debit: 900, credit: 0 });
    expect(lines[1]).toMatchObject({ accountId: 22, debit: 100, credit: 0 });
    expect(lines[2]).toMatchObject({ accountId: 33, debit: 0, credit: 1000 });
    const debitSum = r3(lines.reduce((s, l) => s + l.debit, 0));
    const creditSum = r3(lines.reduce((s, l) => s + l.credit, 0));
    expect(debitSum).toBe(creditSum);
  });

  test("بلا حساب محتجزات ⇒ انسحاب آلي للسطرين (ضمان رخو)", () => {
    const lines = buildInvoiceIssueLines({ ...args, retentionAccountId: null, total: 1000, retentionAmount: 100 });
    expect(lines).toHaveLength(2);
  });
});

// ==================== §2 الدفعة المقدمة ====================

describe("computeAdvanceRecovery — لقطة الاسترداد", () => {
  test("min(المطلوب، المتبقي من الدفعة)", () => {
    expect(computeAdvanceRecovery(1000, 10, 500, 0)).toBe(100); // المطلوب أقل
    expect(computeAdvanceRecovery(10000, 10, 500, 0)).toBe(500); // المتبقي أقل
    expect(computeAdvanceRecovery(10000, 10, 800, 500)).toBe(300); // المتبقي بعد المسترد
  });

  test("استنفدت الدفعة ⇒ صفر", () => {
    expect(computeAdvanceRecovery(1000, 10, 500, 500)).toBe(0);
    expect(computeAdvanceRecovery(1000, 10, 500, 600)).toBe(0);
  });

  test("بلا نسبة أو بلا دفعة ⇒ صفر", () => {
    expect(computeAdvanceRecovery(1000, 0, 500, 0)).toBe(0);
    expect(computeAdvanceRecovery(1000, 10, 0, 0)).toBe(0);
  });
});

describe("validateAdvanceFields — حقول العقد", () => {
  test("مبالغ سالبة مرفوضة والنسبة 0-100", () => {
    expect(validateAdvanceFields({ advanceAmount: -5 }).ok).toBe(false);
    expect(validateAdvanceFields({ advanceRecoveryPct: 101 }).ok).toBe(false);
    expect(validateAdvanceFields({ advanceRecoveryPct: -1 }).ok).toBe(false);
  });

  test("القيم السليمة تُقرَّب", () => {
    expect(validateAdvanceFields({ advanceAmount: 1500.1234, advanceRecoveryPct: 15 })).toEqual({
      ok: true,
      advanceAmount: 1500.123,
      advanceRecoveryPct: 15,
    });
  });

  test("عدم الإرسال = لا تغيير", () => {
    const r = validateAdvanceFields({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.advanceAmount).toBeUndefined();
      expect(r.advanceRecoveryPct).toBeUndefined();
    }
  });
});

// ==================== §3 مستخلص الباطن SubIPC ====================

describe("آلة حالات SubIPC — G7 مغلقة", () => {
  test("التعديل والحذف: مسودة حصرًا", () => {
    expect(canSubCertEdit(SUBCERT_DRAFT)).toBe(true);
    expect(canSubCertDelete(SUBCERT_DRAFT)).toBe(true);
    for (const s of [SUBCERT_SUBMITTED, SUBCERT_APPROVED, SUBCERT_PAID, SUBCERT_CANCELLED]) {
      expect(canSubCertEdit(s)).toBe(false);
      expect(canSubCertDelete(s)).toBe(false);
    }
  });

  test("التقديم من المسودة · الاعتماد من المقدم · الصرف من المعتمد", () => {
    expect(canSubCertSubmit(SUBCERT_DRAFT)).toBe(true);
    expect(canSubCertSubmit(SUBCERT_SUBMITTED)).toBe(false);
    expect(canSubCertApprove(SUBCERT_SUBMITTED)).toBe(true);
    expect(canSubCertApprove(SUBCERT_DRAFT)).toBe(false);
    expect(canSubCertPay(SUBCERT_APPROVED)).toBe(true);
    expect(canSubCertPay(SUBCERT_SUBMITTED)).toBe(false);
  });

  test("الإلغاء من الثلاثة الأولى — المدفوع يُعالج عبر سنده", () => {
    for (const s of [SUBCERT_DRAFT, SUBCERT_SUBMITTED, SUBCERT_APPROVED]) {
      expect(canSubCertCancel(s)).toBe(true);
    }
    expect(canSubCertCancel(SUBCERT_PAID)).toBe(false);
    expect(canSubCertCancel(SUBCERT_CANCELLED)).toBe(false);
  });
});

describe("التراكمي الكمي — subItemAvailable + validateSubCertLines", () => {
  test("المتاح = الكمية − المستخدم، لا سالب", () => {
    expect(subItemAvailable(100, 40)).toBe(60);
    expect(subItemAvailable(100, 120)).toBe(0);
    expect(subItemAvailable(0, 0)).toBe(0);
  });

  test("سطر يتجاوز المتاح يُرفض", () => {
    const avail = new Map([[1, 50]]);
    const res = validateSubCertLines([{ subItemId: 1, description: "بند", qty: 60, unitPrice: 10 }], avail);
    expect(res.ok).toBe(false);
  });

  test("سطر داخل المتاح يمر والgross محصول", () => {
    const avail = new Map([[1, 50]]);
    const res = validateSubCertLines([{ subItemId: 1, description: "بند", qty: 20, unitPrice: 15.5 }], avail);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.gross).toBe(310);
  });

  test("سطر حر بلا بند يمر بلا تحقق كمي — الوصف والكمية إلزاميان", () => {
    const res = validateSubCertLines([{ subItemId: null, description: "أعمال إضافية", qty: 1, unitPrice: 500 }], new Map());
    expect(res.ok).toBe(true);
    expect(validateSubCertLines([{ subItemId: null, description: "", qty: 1, unitPrice: 5 }], new Map()).ok).toBe(false);
    expect(validateSubCertLines([{ subItemId: null, description: "x", qty: 0, unitPrice: 5 }], new Map()).ok).toBe(false);
    expect(validateSubCertLines([], new Map()).ok).toBe(false);
  });
});

describe("computeSubCertNet — الصافي ≥ 0", () => {
  test("gross − محتجز − مسترد − أخرى", () => {
    expect(computeSubCertNet(1000, 50, 30, 20)).toBe(900);
  });
  test("لا سالب أبدًا", () => {
    expect(computeSubCertNet(100, 50, 50, 50)).toBe(0);
  });
});

describe("validateSubCertDeductions", () => {
  test("نسبة المحتجزات 0-25 والخصومات غير سالبة", () => {
    expect(validateSubCertDeductions({ retentionRate: 30 }).ok).toBe(false);
    expect(validateSubCertDeductions({ otherDeductions: -1 }).ok).toBe(false);
    const ok = validateSubCertDeductions({ retentionRate: 10, otherDeductions: 25.5 });
    expect(ok).toEqual({ ok: true, retentionRate: 10, otherDeductions: 25.5 });
  });
});

describe("subCertKpis — المؤشرات", () => {
  test("الملغي مستبعد · المعتمد والمدفوع يدخلان التراكمي · المحتجز يبقى قائمًا حتى بعد الصرف", () => {
    const kpis = subCertKpis([
      { status: SUBCERT_APPROVED, netAmount: 900, retentionAmount: 100, advanceRecovery: 0 },
      { status: SUBCERT_PAID, netAmount: 450, retentionAmount: 50, advanceRecovery: 0 },
      { status: SUBCERT_CANCELLED, netAmount: 999, retentionAmount: 999, advanceRecovery: 0 },
    ]);
    expect(kpis.approvedCumulative).toBe(1350);
    expect(kpis.paidCumulative).toBe(450);
    expect(kpis.pendingRetention).toBe(150);
    expect(kpis.count).toBe(2);
  });

  test("تقريب ثلاثي على المؤشرات", () => {
    const kpis = subCertKpis([
      { status: SUBCERT_APPROVED, netAmount: 1.0005, retentionAmount: 0.0004, advanceRecovery: 0 },
    ]);
    expect(kpis.approvedCumulative).toBe(1.001);
    expect(Math.abs(kpis.pendingRetention - 0) < EPS).toBe(true);
  });
});
