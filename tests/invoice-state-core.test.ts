/**
 * اختبارات نواة ز2 — آلة اعتماد مستخلص العميل
 * (docs/boq-state-timeline-design.md §3 — مرآة اختبارات SubCertificate في phase-a-core):
 *  • المفردات المقفلة الثلاث (مسودة/مقدم/معتمد) ورفض أي قيمة دخيلة
 *  • الانتقالان الوحيدان: تقديم من المسودة، اعتماد من المقدم — ما عدا ذلك رفض
 *  • التعديل: مسودة حصرًا + تمييز رسالة المقدم عن المعتمد
 *  • الروابط المالية (سداد FIFO/إفراج محتجزات): معتمد حصرًا
 *  • الإلغاء متاح من الثلاث ولايات
 */
import { describe, expect, test } from "bun:test";

import {
  canInvoiceApprove,
  canInvoiceEdit,
  canInvoiceLinkPayments,
  canInvoiceReleaseRetention,
  canInvoiceSubmit,
  canInvoiceVoidState,
  INV_STATE_APPROVED,
  INV_STATE_DRAFT,
  INV_STATE_SUBMITTED,
  INVOICE_STATES,
  invoiceEditBlockedReason,
  isInvoiceState,
} from "../src/lib/invoice-state-core";

describe("ز2 — مفردات آلة الحالات المقفلة", () => {
  test("الولايات الثلاث حصرًا بالترتيب الصحيح وبأسماء عربية مطابقة للشقيقة SubCertificate", () => {
    expect(INVOICE_STATES).toEqual(["مسودة", "مقدم", "معتمد"]);
    expect(INVOICE_STATES).toHaveLength(3);
  });

  test("فحص المفردات: الثلاث صالحة وأي قيمة دخيلة مرفوضة (بلا enum — String مقفلة)", () => {
    for (const s of INVOICE_STATES) expect(isInvoiceState(s)).toBe(true);
    expect(isInvoiceState("")).toBe(false);
    expect(isInvoiceState("مدفوع")).toBe(false); // المدفوع حالة مالية متعامدة لا ولاية آلة
    expect(isInvoiceState("ملغي")).toBe(false); // الملغي حالة status لا ولاية آلة
    expect(isInvoiceState("معتمدة")).toBe(false); // صيغة مختلفة حرفيًا = دخيلة
    expect(isInvoiceState("draft")).toBe(false); // لا إنجليزية — المفردات عربية مقفلة
  });
});

describe("ز2 — الانتقالان الوحيدان (تقديم/اعتماد)", () => {
  test("التقديم من المسودة حصرًا", () => {
    expect(canInvoiceSubmit(INV_STATE_DRAFT)).toBe(true);
    expect(canInvoiceSubmit(INV_STATE_SUBMITTED)).toBe(false);
    expect(canInvoiceSubmit(INV_STATE_APPROVED)).toBe(false);
  });

  test("الاعتماد من المقدم حصرًا — لا قفز من المسودة مباشرة (المسار موحى: تقديم ثم اعتماد)", () => {
    expect(canInvoiceApprove(INV_STATE_SUBMITTED)).toBe(true);
    expect(canInvoiceApprove(INV_STATE_DRAFT)).toBe(false);
    expect(canInvoiceApprove(INV_STATE_APPROVED)).toBe(false);
  });

  test("لا انتقال رجعي: المعتمد لا يعود مقدمًا ولا مسودة (السقوط — ما اعتُمد لا يُفتح)", () => {
    // ليست هناك دوال «إرجاع» أصلًا — والتقديم/الاعتماد على المعتمد مرفوض حصرًا
    expect(canInvoiceSubmit(INV_STATE_APPROVED)).toBe(false);
    expect(canInvoiceApprove(INV_STATE_APPROVED)).toBe(false);
  });
});

describe("ز2 — حراسة التعديل (مسودة حصرًا)", () => {
  test("التعديل من المسودة وحدها", () => {
    expect(canInvoiceEdit(INV_STATE_DRAFT)).toBe(true);
    expect(canInvoiceEdit(INV_STATE_SUBMITTED)).toBe(false);
    expect(canInvoiceEdit(INV_STATE_APPROVED)).toBe(false);
  });

  test("رسالة رفض التعديل تميز المقدم المقفل عن المعتمد الساق", () => {
    const submitted = invoiceEditBlockedReason(INV_STATE_SUBMITTED);
    const approved = invoiceEditBlockedReason(INV_STATE_APPROVED);
    expect(submitted).toContain("المقدم");
    expect(submitted).toContain("مسودة");
    expect(approved).toContain("لا يُعدَّل");
    expect(approved).toContain("لحظة الحقيقة");
    expect(submitted).not.toBe(approved);
  });

  test("رسالة التعديل لأي ولاية دخيلة تعود بنص المعتمد الآمن", () => {
    expect(invoiceEditBlockedReason("قيمة دخيلة")).toBe(
      invoiceEditBlockedReason(INV_STATE_APPROVED)
    );
  });
});

describe("ز2 — حراسة الروابط المالية (معتمد حصرًا)", () => {
  test("تخصيص سداد FIFO على المعتمد حصرًا — المسودة والمقدم لا تلتقطان سندات", () => {
    expect(canInvoiceLinkPayments(INV_STATE_APPROVED)).toBe(true);
    expect(canInvoiceLinkPayments(INV_STATE_DRAFT)).toBe(false);
    expect(canInvoiceLinkPayments(INV_STATE_SUBMITTED)).toBe(false);
  });

  test("الإفراج عن المحتجزات على المعتمد حصرًا", () => {
    expect(canInvoiceReleaseRetention(INV_STATE_APPROVED)).toBe(true);
    expect(canInvoiceReleaseRetention(INV_STATE_DRAFT)).toBe(false);
    expect(canInvoiceReleaseRetention(INV_STATE_SUBMITTED)).toBe(false);
  });
});

describe("ز2 — الإلغاء من الثلاث ولايات", () => {
  test("الإلغاء متاح من مسودة ومقدم ومعتمد — ورفضه لأي قيمة دخيلة", () => {
    expect(canInvoiceVoidState(INV_STATE_DRAFT)).toBe(true);
    expect(canInvoiceVoidState(INV_STATE_SUBMITTED)).toBe(true);
    expect(canInvoiceVoidState(INV_STATE_APPROVED)).toBe(true);
    expect(canInvoiceVoidState("")).toBe(false);
    expect(canInvoiceVoidState("مدفوع")).toBe(false);
  });
});

describe("ز2 — التكامل مع البعد المالي المتعامد", () => {
  test("الولايات الثلاث لا تتضمن حالات status المالية (تعامد البعدين)", () => {
    for (const financial of ["unpaid", "partial", "paid", "void"]) {
      expect(isInvoiceState(financial)).toBe(false);
    }
    // الآلة تُطبق فوق status القائم — أي status مالي مع أي ولاية ممكن (لا تعارض)
    const orthogonal = INVOICE_STATES.flatMap((s) =>
      ["unpaid", "partial", "paid"].map((f) => `${s}/${f}`)
    );
    expect(orthogonal).toHaveLength(9); // 3 ولايات × 3 حالات مالية سارية
  });
});
