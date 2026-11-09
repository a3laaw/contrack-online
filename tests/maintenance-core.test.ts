/**
 * اختبارات نواة الصيانة والتشغيل (docs/maintenance-design.md §4 — د2/د4/د5/د6/د8/د9 + درسا G8/G9).
 * النواة نقية 100% — حالة الحدث اشتقاقية والتوليد بمعايرة نهاية الشهر.
 */
import { describe, expect, test } from "bun:test";
import {
  MAINTENANCE_TYPE_NAME,
  OCCURRENCE_STATUS_LABELS,
  PLAN_INTERVALS,
  PLAN_INTERVAL_LABELS,
  PLAN_MAX_OCCURRENCES,
  WO_PREFIX,
  WO_STATUSES,
  WO_STATUS_LABELS,
  WO_TRANSITIONS,
} from "../src/lib/maintenance-constants";
import {
  addMonthsClamped,
  canCancelOrder,
  canEditOrder,
  canInvoiceOrder,
  canIssueMaterials,
  generateOccurrenceDates,
  maintenanceKpis,
  occurrenceStatusOf,
  regeneratePending,
  suggestInvoiceAmount,
  validatePlan,
  validateTransition,
  validateWorkOrder,
  type ExistingOccurrence,
  type KpiOccurrenceRef,
} from "../src/lib/maintenance-core";

describe("ثوابت الصيانة", () => {
  test("بادئة الترقيم MO متميزة عن WO- المخزني (د10)", () => {
    expect(WO_PREFIX).toBe("MO");
  });

  test("الفواصل المغلقة الخمسة وتسمياتها (د5)", () => {
    expect(PLAN_INTERVALS).toEqual([1, 2, 3, 6, 12]);
    expect(PLAN_INTERVAL_LABELS[3]).toBe("ربع سنويًا");
    expect(PLAN_MAX_OCCURRENCES).toBe(60);
  });

  test("آلة الحالة المغلقة (د4 — G7)", () => {
    expect(WO_STATUSES).toEqual(["مفتوحة", "جارية", "منجزة", "ملغاة"]);
    expect(WO_TRANSITIONS["مفتوحة"]).toEqual(["جارية", "منجزة", "ملغاة"]);
    expect(WO_TRANSITIONS["جارية"]).toEqual(["منجزة", "ملغاة"]);
    expect(WO_TRANSITIONS["منجزة"]).toEqual([]); // نهائية
    expect(WO_TRANSITIONS["ملغاة"]).toEqual([]); // نهائية
    expect(WO_STATUS_LABELS["مفتوحة"]).toBe("مفتوحة");
  });

  test("حالات الحدث الاشتقاقية الأربع وتسمياتها (د6)", () => {
    expect(OCCURRENCE_STATUS_LABELS).toMatchObject({ "مجدولة": "مجدولة", "متخطاة": "متخطاة" });
  });

  test("نوع البذر المؤجل «صيانة دورية» (د2)", () => {
    expect(MAINTENANCE_TYPE_NAME).toBe("صيانة دورية");
  });
});

describe("توليد التواريخ بمعايرة نهاية الشهر (د5)", () => {
  test("31 يناير +1 شهر = 28 فبراير (سنة عادية)", () => {
    expect(addMonthsClamped("2025-01-31", 1)).toBe("2025-02-28");
  });

  test("31 يناير +1 شهر = 29 فبراير (سنة كبيسة)", () => {
    expect(addMonthsClamped("2024-01-31", 1)).toBe("2024-02-29");
  });

  test("31 يناير +3 أشهر = 30 أبريل", () => {
    expect(addMonthsClamped("2025-01-31", 3)).toBe("2025-04-30");
  });

  test("اليوم الأصغر يمر كما هو، وعبور السنة سليم", () => {
    expect(addMonthsClamped("2025-03-10", 1)).toBe("2025-04-10");
    expect(addMonthsClamped("2025-12-15", 2)).toBe("2026-02-15");
    expect(addMonthsClamped("2025-10-31", 2)).toBe("2025-12-31");
  });

  test("سلسلة الخطة الشهرية من تاريخ البداية", () => {
    const dates = generateOccurrenceDates({ startDate: "2025-01-31", intervalMonths: 1, occurrencesCount: 3 });
    expect(dates).toEqual(["2025-01-31", "2025-02-28", "2025-03-31"]);
  });

  test("فاصل ربع سنوي من نقطة ارتكاز", () => {
    const dates = generateOccurrenceDates({ startDate: "2025-01-10", intervalMonths: 3, occurrencesCount: 3 }, "2025-06-10");
    expect(dates).toEqual(["2025-06-10", "2025-09-10", "2025-12-10"]);
  });

  test("العدد صفر يعيد قائمة فارغة", () => {
    expect(generateOccurrenceDates({ startDate: "2025-01-01", intervalMonths: 1, occurrencesCount: 0 })).toEqual([]);
  });
});

describe("اشتقاق حالة الحدث من أمره (د6 — G9 بلا عمود حالة مخزن)", () => {
  test("المتخطاة حصرًا بالعلم بغض النظر عن الأمر", () => {
    expect(occurrenceStatusOf({ skipped: true }, { status: "منجزة" })).toBe("متخطاة");
    expect(occurrenceStatusOf({ skipped: true }, null)).toBe("متخطاة");
  });

  test("بلا أمر أو أمره ملغى ⇒ مجدولة", () => {
    expect(occurrenceStatusOf({ skipped: false }, null)).toBe("مجدولة");
    expect(occurrenceStatusOf({ skipped: false }, { status: "ملغاة" })).toBe("مجدولة");
  });

  test("أمر منجز ⇒ منجزة، وأمر مفتوح/جارٍ ⇒ مفتوحة", () => {
    expect(occurrenceStatusOf({ skipped: false }, { status: "منجزة" })).toBe("منجزة");
    expect(occurrenceStatusOf({ skipped: false }, { status: "مفتوحة" })).toBe("مفتوحة");
    expect(occurrenceStatusOf({ skipped: false }, { status: "جارية" })).toBe("مفتوحة");
  });
});

describe("تحقق الخطة والأمر (G8)", () => {
  test("خطة سليمة تمر بلا أخطاء", () => {
    expect(validatePlan({ intervalMonths: 3, occurrencesCount: 4, startDate: "2025-01-10" })).toEqual([]);
  });

  test("فاصل خارج المجموعة المرفوض", () => {
    const e = validatePlan({ intervalMonths: 5, occurrencesCount: 4, startDate: "2025-01-10" });
    expect(e.join(" ")).toContain("الفاصل الزمني");
  });

  test("عدد الزيارات خارج 1..60 مرفوض", () => {
    expect(validatePlan({ intervalMonths: 1, occurrencesCount: 0, startDate: "2025-01-10" }).join(" ")).toContain("عدد الزيارات");
    expect(validatePlan({ intervalMonths: 1, occurrencesCount: 61, startDate: "2025-01-10" }).join(" ")).toContain("عدد الزيارات");
    expect(validatePlan({ intervalMonths: 1, occurrencesCount: 2.5, startDate: "2025-01-10" }).join(" ")).toContain("عدد الزيارات");
  });

  test("أمر سليم يمر بلا أخطاء", () => {
    const e = validateWorkOrder(
      { title: "صيانة تكييف", scheduledDate: "2025-11-10", contractId: 5 },
      { contract: { id: 5, status: "نشط", isMaintenance: true } }
    );
    expect(e).toEqual([]);
  });

  test("أمر بلا عنوان أو تاريخ مرفوض", () => {
    const e = validateWorkOrder(
      { title: " ", scheduledDate: "10/11/2025", contractId: 5 },
      { contract: { id: 5, status: "نشط", isMaintenance: true } }
    );
    expect(e.join(" ")).toContain("عنوان");
    expect(e.join(" ")).toContain("YYYY-MM-DD");
  });

  test("أمر على عقد غير موسوم صيانة مرفوض بالعربية (د2 — G8)", () => {
    const e = validateWorkOrder(
      { title: "أمر", scheduledDate: "2025-11-10", contractId: 7 },
      { contract: { id: 7, status: "نشط", isMaintenance: false } }
    );
    expect(e.join(" ")).toContain("ليس عقد صيانة");
  });

  test("أمر على عقد غير نشط مرفوض (G8)", () => {
    const e = validateWorkOrder(
      { title: "أمر", scheduledDate: "2025-11-10", contractId: 7 },
      { contract: { id: 7, status: "ملغي", isMaintenance: true } }
    );
    expect(e.join(" ")).toContain("غير نشط");
  });

  test("أمر بلا عقد مرفوض حرفيًا (G8)", () => {
    const e = validateWorkOrder({ title: "أمر", scheduledDate: "2025-11-10", contractId: 0 }, {});
    expect(e.join(" ")).toContain("عقد الصيانة");
  });

  test("فني معطّل مرفوض (د7)", () => {
    const e = validateWorkOrder(
      { title: "أمر", scheduledDate: "2025-11-10", contractId: 5, technicianId: 3 },
      { contract: { id: 5, status: "نشط", isMaintenance: true }, technician: { id: 3, active: false } }
    );
    expect(e.join(" ")).toContain("معطّل");
  });
});

describe("بوابات آلة الحالة (د4)", () => {
  test("الانتقالات السليمة تمر وغيرها ترفض برسالة عربية", () => {
    expect(validateTransition("مفتوحة", "جارية")).toBeNull();
    expect(validateTransition("مفتوحة", "منجزة")).toBeNull();
    expect(validateTransition("مفتوحة", "ملغاة")).toBeNull();
    expect(validateTransition("جارية", "مفتوحة")).toContain("لا يمكن الانتقال");
    expect(validateTransition("منجزة", "جارية")).toContain("لا شيء");
    expect(validateTransition("ملغاة", "مفتوحة")).toContain("لا شيء");
    expect(validateTransition("مفتوحة", "مفتوحة")).toContain("أصلًا");
  });

  test("التعديل وهو مفتوحة حصرًا (د4)", () => {
    expect(canEditOrder({ status: "مفتوحة" })).toBeNull();
    expect(canEditOrder({ status: "جارية" })).toContain("مفتوحة");
    expect(canEditOrder({ status: "منجزة" })).toContain("مفتوحة");
  });
});

describe("بوابات المستندات (د8/د9 — رفض صريح بلا شلالات)", () => {
  test("صرف المواد قبل الإنهاء حصرًا وبإذن واحد (د8)", () => {
    expect(canIssueMaterials({ status: "مفتوحة" })).toBeNull();
    expect(canIssueMaterials({ status: "جارية" })).toBeNull();
    expect(canIssueMaterials({ status: "مفتوحة", materialsDocId: 9 })).toContain("إذن صرف مرتبط بالفعل");
    expect(canIssueMaterials({ status: "منجزة" })).toContain("قبل الإنهاء حصرًا");
    expect(canIssueMaterials({ status: "ملغاة" })).toContain("قبل الإنهاء حصرًا");
  });

  test("فاتورة الزيارة بعد الإنهاء حصرًا (د9)", () => {
    expect(canInvoiceOrder({ status: "منجزة" })).toBeNull();
    expect(canInvoiceOrder({ status: "مفتوحة" })).toContain("بعد إنهاء الأمر حصرًا");
    expect(canInvoiceOrder({ status: "منجزة", invoiceId: 4 })).toContain("فاتورة مرتبطة بالفعل");
  });

  test("إلغاء أمر ذي إذن صرف مرفوض برسالة تسمّيه (د8)", () => {
    const e = canCancelOrder({ status: "مفتوحة", materialsDocId: 12, materialsDocNumber: "WO-0007" });
    expect(e).toContain("WO-0007");
    expect(e).toContain("شاشة المخازن");
  });

  test("إلغاء أمر أُسحب إذنه من المخازن (الإذن ملغى) يمر — الرفض للإذن الحي حصرًا (د8)", () => {
    expect(
      canCancelOrder({ status: "مفتوحة", materialsDocId: 12, materialsDocNumber: "WO-0007", materialsDocCancelled: true })
    ).toBeNull();
    expect(canCancelOrder({ status: "جارية", materialsDocId: 12, materialsDocCancelled: true })).toBeNull();
  });

  test("إلغاء أمر ذي فاتورة مرفوض برسالة تسمّيها (د8)", () => {
    const e = canCancelOrder({ status: "جارية", invoiceId: 3, invoiceNumber: "INV-0009" });
    expect(e).toContain("INV-0009");
    expect(e).toContain("شاشة الفواتير");
  });

  test("إلغاء أمر نظيف من مفتوحة/جارية يمر، والمنجز/الملغى مرفوض", () => {
    expect(canCancelOrder({ status: "مفتوحة" })).toBeNull();
    expect(canCancelOrder({ status: "جارية" })).toBeNull();
    expect(canCancelOrder({ status: "منجزة" })).toContain("لا يمكن إلغاء");
    expect(canCancelOrder({ status: "ملغاة" })).toContain("لا يمكن إلغاء");
  });
});

describe("إعادة توليد الخطة (د5 — المنجز والمتخطى محفوظان)", () => {
  const spec = { startDate: "2025-01-10", intervalMonths: 1, occurrencesCount: 3 };

  test("خطة جديدة بلا أحداث ⇒ توليد كامل من تاريخ البداية", () => {
    const r = regeneratePending([], spec);
    expect(r.createDates).toEqual(["2025-01-10", "2025-02-10", "2025-03-10"]);
    expect(r.keepIds).toEqual([]);
    expect(r.removeIds).toEqual([]);
  });

  test("حدث منجز يحفظ والمعلق يُعاد من الارتكاز (آخر منجز + فاصل)", () => {
    const existing: ExistingOccurrence[] = [
      { id: 1, dueDate: "2025-01-10", skipped: false, workOrderId: 11, workOrderStatus: "منجزة" },
      { id: 2, dueDate: "2025-02-10", skipped: false },
      { id: 3, dueDate: "2025-03-10", skipped: false },
    ];
    const r = regeneratePending(existing, spec);
    expect(r.keepIds).toEqual([1]);
    expect(r.removeIds).toEqual([2, 3]);
    expect(r.createDates).toEqual(["2025-02-10", "2025-03-10"]); // 3 − 1 محفوظ = 2 جديدان من 2025-01-10
  });

  test("المتخطى يُحفظ ويغطي موعده — لا تصادم فريد", () => {
    const existing: ExistingOccurrence[] = [
      { id: 1, dueDate: "2025-01-10", skipped: true },
      { id: 2, dueDate: "2025-02-10", skipped: false },
    ];
    const r = regeneratePending(existing, spec);
    expect(r.keepIds).toEqual([1]);
    expect(r.removeIds).toEqual([2]);
    expect(r.createDates).toEqual(["2025-02-10", "2025-03-10"]);
  });

  test("أمر ملغى لا يُعد محفوظًا — حدثه معلق يُعاد", () => {
    const existing: ExistingOccurrence[] = [
      { id: 1, dueDate: "2025-01-10", skipped: false, workOrderId: 11, workOrderStatus: "ملغاة" },
    ];
    const r = regeneratePending(existing, spec);
    expect(r.keepIds).toEqual([]);
    expect(r.removeIds).toEqual([1]);
    expect(r.createDates).toEqual(["2025-01-10", "2025-02-10", "2025-03-10"]);
  });

  test("كل المحفوظ ⇒ صفر توليد جديد", () => {
    const existing: ExistingOccurrence[] = [
      { id: 1, dueDate: "2025-01-10", skipped: false, workOrderId: 11, workOrderStatus: "منجزة" },
      { id: 2, dueDate: "2025-02-10", skipped: false, workOrderId: 12, workOrderStatus: "منجزة" },
      { id: 3, dueDate: "2025-03-10", skipped: false, workOrderId: 13, workOrderStatus: "جارية" },
    ];
    const r = regeneratePending(existing, spec);
    expect(r.createDates).toEqual([]);
    expect(r.removeIds).toEqual([]);
  });
});

describe("المؤشرات والاقتراح (د12/د9)", () => {
  const today = "2025-11-20";

  test("عدّ المفتوحة والمجدولة بالشهر والعقود النشطة", () => {
    const k = maintenanceKpis({
      orders: [{ status: "مفتوحة" }, { status: "جارية" }, { status: "منجزة" }, { status: "ملغاة" }],
      occurrences: [
        { dueDate: "2025-11-25", skipped: false, planActive: true, woStatus: null },
        { dueDate: "2025-11-05", skipped: false, planActive: true, woStatus: null },
        { dueDate: "2025-12-01", skipped: false, planActive: true, woStatus: null },
      ],
      maintenanceContractsActive: 2,
      today,
    });
    expect(k.openOrders).toBe(2);
    expect(k.dueThisMonth).toBe(2);
    expect(k.overdue).toBe(1);
    expect(k.activeContracts).toBe(2);
    expect(k.nextDue).toBe("2025-11-25");
  });

  test("قواعد الاستبعاد: متخطى وخطة معطلة وأمر منجز لا يعدّون متأخرين", () => {
    const occurrences: KpiOccurrenceRef[] = [
      { dueDate: "2025-11-01", skipped: true, planActive: true, woStatus: null },
      { dueDate: "2025-11-02", skipped: false, planActive: false, woStatus: null },
      { dueDate: "2025-11-03", skipped: false, planActive: true, woStatus: "منجزة" },
      { dueDate: "2025-11-04", skipped: false, planActive: true, woStatus: "ملغاة" },
      { dueDate: "2025-11-05", skipped: false, planActive: true, woStatus: null },
    ];
    const k = maintenanceKpis({ orders: [], occurrences, maintenanceContractsActive: 1, today });
    expect(k.overdue).toBe(2); // 2025-11-04 (أمره ملغى ⇒ مجدولة) + 2025-11-05
    expect(k.dueThisMonth).toBe(2);
  });

  test("اقتراح فاتورة الزيارة = القيمة ÷ الزيارات (د9)", () => {
    expect(suggestInvoiceAmount(360, 3)).toBe(120);
    expect(suggestInvoiceAmount(360.0, 12)).toBe(30);
    expect(suggestInvoiceAmount(500, null)).toBe(500); // بلا خطة ⇒ من واحد
    expect(suggestInvoiceAmount(100, 3)).toBe(33.333); // تقريب ثلاثي
  });
});
