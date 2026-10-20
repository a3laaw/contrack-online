/**
 * اختبار المرحلة 9 — عروض الأسعار (بند 12)
 * قفل المنطق النقي المطابق للمكتبي V9.15.18 والمخطط المرجعي §49-50:
 *   lifecycle_service.py:96      next_quote_number → QUO-%04d
 *   :4781-4782                   «يجب اختيار العميل.» · «يجب إضافة بند واحد على الأقل لعرض السعر.»
 *   :4802-4825                   list_quotations (بحث مطبَّع · status فلتر · ORDER BY q.id DESC)
 *   :4845-4849                   set_quotation_status بلا مصفوفة انتقالات + «حالة عرض السعر غير صحيحة.»
 *   :4851-4884                   convert_quotation_to_contract (خارج نطاق الويب — موثق)
 *   database_schema_postgresql.sql:865-898  quotations/quotation_items (RESTRICT/SET NULL/CASCADE
 *                                            · status DEFAULT 'جديد' · إجمالي البند مولَّد)
 * الدوال كلها نقية — بلا قاعدة بيانات.
 */

import { describe, expect, test } from "bun:test";
import {
  cleanQuotationAmount,
  cleanQuotationCustomerId,
  cleanQuotationDate,
  cleanQuotationItems,
  cleanQuotationProjectId,
  cleanQuotationText,
  computeItemsTotal,
  isQuotationStatus,
  itemsMatchTotal,
  nextQuotationNumber,
  quotationStatusBadgeClass,
  quotationTransitionAllowed,
  sortQuotationsDesc,
  QUOTATION_CUSTOMER_REQUIRED,
  QUOTATION_INVALID_STATUS,
  QUOTATION_ITEMS_REQUIRED,
  QUOTATION_NUMBER_PREFIX,
  QUOTATION_STATUSES,
  QUOTATION_STATUS_DEFAULT,
  QUOTATION_STATUS_FALLBACK_CLASS,
  type QuotationRow,
} from "@/lib/quotes-core";

describe("الترقيم الآلي — مرآة next_quote_number (QUO-%04d)", () => {
  test("البادئة المكتبية QUO وأول رقم QUO-0001 بلا سابق", () => {
    expect(QUOTATION_NUMBER_PREFIX).toBe("QUO");
    expect(nextQuotationNumber(null)).toBe("QUO-0001");
    expect(nextQuotationNumber(undefined)).toBe("QUO-0001");
  });

  test("يزيد أعلى رقم موجود — والتالفة تعود للأول", () => {
    expect(nextQuotationNumber("QUO-0007")).toBe("QUO-0008");
    expect(nextQuotationNumber("QUO-0042")).toBe("QUO-0043");
    expect(nextQuotationNumber("QUO-9999")).toBe("QUO-10000");
    expect(nextQuotationNumber("garbage")).toBe("QUO-0001");
    expect(nextQuotationNumber("")).toBe("QUO-0001");
  });
});

describe("دورة الحالة — مرآة set_quotation_status (بلا مصفوفة انتقالات)", () => {
  test("قيم المخطط المرجعي §49 حرفيًا وافتراضيها «جديد»", () => {
    expect(QUOTATION_STATUS_DEFAULT).toBe("جديد");
    expect([...QUOTATION_STATUSES]).toEqual(["جديد", "مرسل", "مقبول", "مرفوض", "منتهي"]);
  });

  test("رسالة الحالة غير الشرعية الحرفية من lifecycle_service.py:4847", () => {
    expect(QUOTATION_INVALID_STATUS).toBe("حالة عرض السعر غير صحيحة.");
  });

  test("العضوية: من المجموعة صحيح وما دخلها غير شرعي", () => {
    for (const s of QUOTATION_STATUSES) expect(isQuotationStatus(s)).toBe(true);
    expect(isQuotationStatus("مسودة")).toBe(false); // حالة المكتبي SQLite خارج مرجع الويب
    expect(isQuotationStatus("تم تحويله إلى عقد")).toBe(false);
    expect(isQuotationStatus("")).toBe(false);
    expect(isQuotationStatus(null)).toBe(false);
  });

  test("الانتقالات: أي حالة من المجموعة تصلح لأي أخرى — وخارجها مرفوض", () => {
    // المكتبي بلا مصفوفة: any→any داخل المجموعة (ومنها «مقبول» بلا أثر جانبي)
    for (const from of QUOTATION_STATUSES) {
      for (const to of QUOTATION_STATUSES) {
        expect(quotationTransitionAllowed(from, to)).toBe(true);
      }
    }
    expect(quotationTransitionAllowed("جديد", "مسودة")).toBe(false);
    expect(quotationTransitionAllowed("مقبول", "تم تحويله إلى عقد")).toBe(false);
    expect(quotationTransitionAllowed("جديد", "")).toBe(false);
  });

  test("ألوان الشارات: مرسل أزرق · مقبول/منتهي بنفسجي · مرفوض أحمر · جديد رمادي", () => {
    expect(quotationStatusBadgeClass("مرسل")).toBe("bg-status-info-bg text-status-info");
    expect(quotationStatusBadgeClass("مقبول")).toBe("bg-status-done-bg text-status-done");
    expect(quotationStatusBadgeClass("منتهي")).toBe("bg-status-done-bg text-status-done");
    expect(quotationStatusBadgeClass("مرفوض")).toBe("bg-status-danger-bg text-status-danger");
    expect(quotationStatusBadgeClass("جديد")).toBe(QUOTATION_STATUS_FALLBACK_CLASS);
    expect(quotationStatusBadgeClass("مجهول")).toBe(QUOTATION_STATUS_FALLBACK_CLASS);
  });
});

describe("الرسائل المكتبية الحرفية — add_quotation", () => {
  test("«يجب اختيار العميل.» و«يجب إضافة بند واحد على الأقل لعرض السعر.»", () => {
    expect(QUOTATION_CUSTOMER_REQUIRED).toBe("يجب اختيار العميل.");
    expect(QUOTATION_ITEMS_REQUIRED).toBe("يجب إضافة بند واحد على الأقل لعرض السعر.");
  });
});

describe("التحقق والحقول", () => {
  test("النصوص الحرة تُشذَّب فقط (description/notes TEXT)", () => {
    expect(cleanQuotationText("  تجهيز صالة استقبال \n")).toBe("تجهيز صالة استقبال");
    expect(cleanQuotationText(null)).toBe("");
  });

  test("التواريخ YYYY-MM-DD فقط وإلا سلسلة فارغة (valid_until DATE)", () => {
    expect(cleanQuotationDate("2025-06-30")).toBe("2025-06-30");
    expect(cleanQuotationDate("30/06/2025")).toBe("");
    expect(cleanQuotationDate("2025-13-40")).toBe("");
    expect(cleanQuotationDate("")).toBe("");
    expect(cleanQuotationDate(undefined)).toBe("");
  });

  test("العميل إلزامي موجب (customer_id NOT NULL مع RESTRICT)", () => {
    expect(cleanQuotationCustomerId(7)).toBe(7);
    expect(cleanQuotationCustomerId("12")).toBe(12);
    expect(cleanQuotationCustomerId(0)).toBeNull();
    expect(cleanQuotationCustomerId(-3)).toBeNull();
    expect(cleanQuotationCustomerId("x")).toBeNull();
  });

  test("المشروع اختياري موجب أو null (project_id مع SET NULL)", () => {
    expect(cleanQuotationProjectId(4)).toBe(4);
    expect(cleanQuotationProjectId(0)).toBeNull();
    expect(cleanQuotationProjectId(null)).toBeNull();
    expect(cleanQuotationProjectId(2.9)).toBe(2);
  });

  test("الكمية/السعر: غير سالبة ومقرَّبة لثلاث خانات (DECIMAL(15,3) — عتبة 0.001)", () => {
    expect(cleanQuotationAmount(2.5)).toBe(2.5);
    expect(cleanQuotationAmount("3.14159")).toBe(3.142);
    expect(cleanQuotationAmount(-5)).toBe(0);
    expect(cleanQuotationAmount("abc")).toBe(0);
    expect(cleanQuotationAmount(undefined)).toBe(0);
  });
});

describe("البنود والإجمالي — مجموع البنود = totalAmount (عتبة 0.001)", () => {
  test("تطبيع البنود: الوصف إلزامي والفارغ يُسقط والترتيب يُعاد فهرسته", () => {
    const items = cleanQuotationItems([
      { description: " تكييف مركزي ", unit: "عدد", quantity: 2, unitPrice: 450 },
      { description: "   ", quantity: 9, unitPrice: 9 }, // يُسقط — بلا وصف
      { description: "دهانات", unit: "م2", quantity: "120.5", unitPrice: "1.5" },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      description: "تكييف مركزي",
      unit: "عدد",
      quantity: 2,
      unitPrice: 450,
      totalPrice: 900,
      sortOrder: 0,
    });
    expect(items[1].sortOrder).toBe(1);
    expect(items[1].totalPrice).toBe(180.75);
  });

  test("بلا بنود صالحة ⇒ قائمة فارغة (يُرفض الإنشاء بالرسالة المكتبية)", () => {
    expect(cleanQuotationItems([])).toEqual([]);
    expect(cleanQuotationItems(undefined)).toEqual([]);
    expect(cleanQuotationItems([{ description: "" }])).toEqual([]);
  });

  test("مجموع البنود = الإجمالي، والمطابقة بعتبة 0.001 الموحدة", () => {
    const items = cleanQuotationItems([
      { description: "أ", quantity: 2, unitPrice: 450.125 },
      { description: "ب", quantity: 3, unitPrice: 100 },
    ]);
    const total = computeItemsTotal(items);
    expect(total).toBe(1200.25);
    expect(itemsMatchTotal(total, items)).toBe(true);
    expect(itemsMatchTotal(total + 0.0009, items)).toBe(true);
    expect(itemsMatchTotal(total + 0.002, items)).toBe(false);
  });

  test("الإجمالي الصفري مشروع (كمية/سعر أصفار)", () => {
    const items = cleanQuotationItems([{ description: "بند", quantity: 0, unitPrice: 0 }]);
    expect(computeItemsTotal(items)).toBe(0);
    expect(itemsMatchTotal(0, items)).toBe(true);
  });
});

describe("القائمة — مرآة list_quotations (ORDER BY id DESC)", () => {
  test("الأحدث أولًا بمعرف id تنازليًا بلا إتلاف المصدر", () => {
    const rows = [
      { id: 3, quotationNumber: "QUO-0003" },
      { id: 1, quotationNumber: "QUO-0001" },
      { id: 2, quotationNumber: "QUO-0002" },
    ] as unknown as QuotationRow[];
    expect(sortQuotationsDesc(rows).map((r) => r.id)).toEqual([3, 2, 1]);
    expect(rows.map((r) => r.id)).toEqual([3, 1, 2]);
  });

  test("صف العرض يحمل الحقول المالية والارتباطات حسب المخطط المرجعي", () => {
    const row: QuotationRow = {
      id: 1,
      quotationNumber: "QUO-0001",
      customerId: 1,
      customerName: "عميل",
      projectId: null,
      projectName: "",
      description: "",
      totalAmount: 10.5,
      status: "جديد",
      validUntil: "2025-12-31",
      notes: "",
      createdBy: 1,
      createdByName: "admin",
      itemsCount: 2,
    };
    expect(row.totalAmount).toBe(10.5);
    expect(row.projectId).toBeNull(); // SET NULL
    expect(row.status).toBe("جديد");
  });
});
