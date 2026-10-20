/**
 * اختبار بند 7 من المرحلة 9 — الرئيسية الكاملة (تنبيهات + لوحة مهام مضمّنة + عدادات)
 * قفل المنطق النقي المطابق للمكتبي V9.15.18 حرفيًا:
 *   main_window.py:272-420  بناء التنبيهات (الترتيب والألوان والنصوص والعتبات)
 *   main_window.py:403-415  فلترة العمر (30 يومًا) والمخفاة بمفتاح المستخدم
 *   workflow_service.py:5230-5248  execution_alerts (متأخر/قارب)
 *   widgets.py:977-1090     PaginationBar (صفحة 8 ونص المعلومة)
 *   ui/tasks.py:344-380     المتبقي والإجمالي للوحة المهام المضمّنة
 *   task_service.py:20      format_due_at
 *   extras_service.py:12    _label_from_row
 * الدوال كلها نقية — بلا قاعدة بيانات.
 */

import { describe, expect, test } from "bun:test";
import {
  ACTIVITY_EXPANDED,
  ACTIVITY_ROWS,
  ALERT_MAX_AGE_DAYS,
  ALERTS_PER_PAGE,
  DISMISS_CONFIRM_TEXT,
  EMPTY_FEED_TEXT,
  activityBody,
  activityColor,
  ageDaysFromDate,
  alertHiddenNote,
  buildDashboardAlerts,
  chequeAlert,
  contractLabelFrom,
  extensionAlert,
  extensionMonthsText,
  f3,
  fSigned,
  executionAlert,
  expiringAlert,
  expiringColor,
  filterAlerts,
  gFormat,
  lateSettlementAlert,
  nearBaseEndAlert,
  overdueCollectionAlert,
  overdueTaskAlert,
  pageSlice,
  pausedAlert,
  planItemAlert,
  restoredAlertsMessage,
  shortenTaskTitle,
  stalePinnedAlert,
  stripAlertPrefix,
  supervisionDaysLeftText,
  taskDueText,
  taskLeftText,
  taskSummaryText,
  taskTitleDisplay,
  truncateBody,
} from "@/lib/dashboard-core";

const TODAY = "2026-10-19";

// ============================================================
// التنبيهات حرفيًا — أقسام المكتبي بالترتيب
// ============================================================

describe("expiringAlert — انتهاء العقود (main_window.py:283)", () => {
  test("النص الحرفي بالمتبقي والتاريخ", () => {
    const a = expiringAlert({ contractNumber: "CON-0012", customerName: "شركة الأفق للمقاولات", remaining: 45, endDate: "2026-12-03" });
    expect(a.text).toBe("⏰ العقد CON-0012 · شركة الأفق للمقاولات ينتهي بعد 45 يوم (2026-12-03)");
    expect(a.age).toBe(0);
  });
  test("تدرّج الألوان: ≤7 كهرماني غامق · ≤60 تحذير · غير ذلك معلومة", () => {
    expect(expiringColor(3)).toBe("amber");
    expect(expiringColor(7)).toBe("amber");
    expect(expiringColor(8)).toBe("warn");
    expect(expiringColor(60)).toBe("warn");
    expect(expiringColor(61)).toBe("info");
    expect(expiringColor(90)).toBe("info");
    expect(expiringAlert({ contractNumber: "C", customerName: "خ", remaining: 5, endDate: "" }).color).toBe("amber");
  });
});

describe("planItemAlert — دفعات الخطة (main_window.py:287-292)", () => {
  test("المتأخرة حمراء بالنص الحرفي والمبلغ {:,.3f} والعمر = أيام التأخر", () => {
    const a = planItemAlert({ title: "الدفعة الثانية", customerName: "شركة الأفق للمقاولات", contractNumber: "CON-0012", remaining: 17500, daysDiff: -12 });
    expect(a.text).toBe("📆 دفعة متأخرة: «الدفعة الثانية» · شركة الأفق للمقاولات (العقد CON-0012) متبقٍ منه 17,500.000 · تأخر 12 يوم");
    expect(a.color).toBe("danger");
    expect(a.age).toBe(12);
  });
  test("المستحقة خلال أيام كهرمانية بلا عقد بين قوسين", () => {
    const a = planItemAlert({ title: "دفعة أولى", customerName: "عميل", contractNumber: "CON-0003", remaining: 1250.5, daysDiff: 3 });
    expect(a.text).toBe("📆 دفعة تستحق خلال 3 يوم: «دفعة أولى» · عميل (1,250.500)");
    expect(a.color).toBe("warn");
    expect(a.age).toBe(0);
  });
  test("اليوم نفسه (days_diff=0) يدخل فرع «تستحق خلال 0 يوم»", () => {
    const a = planItemAlert({ title: "ت", customerName: "ع", contractNumber: "C", remaining: 1, daysDiff: 0 });
    expect(a.text).toContain("تستحق خلال 0 يوم");
  });
});

describe("stalePinnedAlert — تعليق مثبّت (main_window.py:295-300)", () => {
  test("اقتطاع المتن عند 70 حرفًا بعلامة … وحرفيات السطر للفراغ", () => {
    const long = "ن".repeat(80);
    const a = stalePinnedAlert({ customerName: "شركة الأفق", ageDays: 20, body: long });
    expect(a.text).toBe(`📌 تعليق مثبّت على شركة الأفق منذ 20 يومًا بلا متابعة: ${"ن".repeat(70)}…`);
    expect(a.age).toBe(20);
    expect(a.color).toBe("warn");
  });
  test("الأسطر الجديدة تُستبدل بفراغ", () => {
    const a = stalePinnedAlert({ customerName: "ع", ageDays: 15, body: "سطر1\nسطر2" });
    expect(a.text).toBe("📌 تعليق مثبّت على ع منذ 15 يومًا بلا متابعة: سطر1 سطر2");
  });
});

describe("chequeAlert — الشيكات (main_window.py:303-311)", () => {
  const base = { voucherNumber: "PV-0009", party: "بنك الكويت", amount: 2500, chequeDueDate: "2026-10-25" };
  test("الاستحقاق اليوم بعلامة تعجب وحمراء", () => {
    const a = chequeAlert({ ...base, vtype: "receipt", daysLeft: 0 });
    expect(a.text).toBe("🏦 شيك قبض (PV-0009) من بنك الكويت بقيمة 2,500.000 · يستحق اليوم!");
    expect(a.color).toBe("danger");
  });
  test("المستحق لاحقًا كهرماني بعدد الأيام", () => {
    const a = chequeAlert({ ...base, vtype: "payment", daysLeft: 6 });
    expect(a.text).toBe("🏦 شيك صرف (PV-0009) من بنك الكويت بقيمة 2,500.000 · يستحق بعد 6 يوم (2026-10-25)");
    expect(a.color).toBe("warn");
  });
  test("المتجاوز أحمر «استحق منذ» والعمر = أيام التجاوز", () => {
    const a = chequeAlert({ ...base, vtype: "receipt", daysLeft: -4 });
    expect(a.text).toBe("🏦 شيك قبض (PV-0009) من بنك الكويت بقيمة 2,500.000 · استحق منذ 4 يوم (2026-10-25)");
    expect(a.color).toBe("danger");
    expect(a.age).toBe(4);
  });
});

describe("إشراف: قرب نهاية الأساس والتمديد (main_window.py:314-334)", () => {
  test("صيغ الأيام: اليوم! · يومين · بعد N يوم", () => {
    expect(supervisionDaysLeftText(0)).toBe("اليوم!");
    expect(supervisionDaysLeftText(1)).toBe("بعد 1 يومين");
    expect(supervisionDaysLeftText(2)).toBe("بعد 2 يومين");
    expect(supervisionDaysLeftText(3)).toBe("بعد 3 يوم");
    expect(supervisionDaysLeftText(30)).toBe("بعد 30 يوم");
  });
  test("صيغ الأشهر: شهر واحد · شهرين · {N:g} شهر", () => {
    expect(extensionMonthsText(1)).toBe("شهر واحد");
    expect(extensionMonthsText(2)).toBe("شهران");
    expect(extensionMonthsText(3)).toBe("3 شهر");
    expect(extensionMonthsText(1.5)).toBe("1.5 شهر");
    expect(gFormat(2.25)).toBe("2.25");
    expect(gFormat(3)).toBe("3");
  });
  test("تنبيه قرب النهاية بالنص الحرفي مع تسمية العقد", () => {
    const a = nearBaseEndAlert({ customerName: "شركة الأفق للمقاولات", label: "عقد إشراف هندسي", daysLeft: 10, baseEnd: "2026-10-29", monthly: 250 });
    expect(a.text).toBe("تنبيه إشراف: شركة الأفق للمقاولات · عقد إشراف هندسي تنتهي مدته الأساسية بعد 10 يوم (2026-10-29) · بعدها يبدأ حساب أشهر التمديد (250.000 للشهر)");
    expect(a.color).toBe("warn");
  });
  test("تنبيه التمديد بنصه البنفسجي الحرفي", () => {
    const a = extensionAlert({ customerName: "شركة الأفق للمقاولات", label: "عقد إشراف هندسي", baseEnd: "2026-09-01", billableExtension: 2, extensionValue: 500 });
    expect(a.text).toBe("تمديد إشراف: شركة الأفق للمقاولات · عقد إشراف هندسي انتهت مدته الأساسية (2026-09-01) وعليه شهران تمديد بقيمة 500.000 · للمخالصة: سند قبض أو إلغاء مدة من المدير");
    expect(a.color).toBe("purple");
    expect(a.age).toBe(0);
  });
});

describe("lateSettlementAlert — تسوية بوابة متأخرة (main_window.py:340)", () => {
  test("النص الحرفي بالمتوقع والتاريخ", () => {
    const a = lateSettlementAlert({ gateway: "KNET الرئيسية", day: "2026-10-01", expect: 1234.5, settleDate: "2026-10-04" });
    expect(a.text).toBe("🏦 تسوية بوابة متأخرة: KNET الرئيسية · يوم 2026-10-01 (متوقع 1,234.500 بتاريخ 2026-10-04) لم يصل البنك");
    expect(a.color).toBe("danger");
    expect(a.age).toBe(0);
  });
});

describe("executionAlert — مراحل التنفيذ (workflow_service.py:5230)", () => {
  test("المتأخر: النص الحرفي بالتجاوز والعمر = التجاوز", () => {
    const a = executionAlert({ contractNumber: "CON-0012", customerName: "شركة الأفق للمقاولات", stageName: "الحفر والأساسات", kind: "overdue", daysIn: 45, expected: 30, over: 15 });
    expect(a.text).toBe("🏗 العقد CON-0012 · شركة الأفق للمقاولات متأخر في «الحفر والأساسات»: 45 يوم من أصل 30 (تجاوز 15 يوم)");
    expect(a.color).toBe("danger");
    expect(a.age).toBe(15);
  });
  test("القارب: «بقي K يوم» وعمر صفر", () => {
    const a = executionAlert({ contractNumber: "CON-0012", customerName: "شركة الأفق", stageName: "الأسقف", kind: "near", daysIn: 14, expected: 15, left: 1 });
    expect(a.text).toBe("🏗 العقد CON-0012 · شركة الأفق قارب على نهاية «الأسقف»: بقي 1 يوم (14 من 15)");
    expect(a.color).toBe("warn");
    expect(a.age).toBe(0);
  });
});

describe("overdueCollectionAlert / pausedAlert — تحصيل ومتوقف (main_window.py:372-379)", () => {
  test("متابعة التحصيل بآخر تحصيل معروف", () => {
    const a = overdueCollectionAlert({ customerName: "شركة الأفق للمقاولات", contractNumber: "CON-0012", remaining: 3000, lastReceipt: "2026-08-01", daysSince: 79 });
    expect(a.text).toBe("💰 متابعة تحصيل: شركة الأفق للمقاولات · العقد CON-0012 عليه 3,000.000 متبقية (آخر تحصيل: 2026-08-01 · منذ 79 يوم)");
    expect(a.age).toBe(79);
  });
  test("بلا تحصيل: «لم يُحصّل شيء بعد»", () => {
    const a = overdueCollectionAlert({ customerName: "ع", contractNumber: "C", remaining: 500, lastReceipt: "", daysSince: 40 });
    expect(a.text).toBe("💰 متابعة تحصيل: ع · العقد C عليه 500.000 متبقية (لم يُحصّل شيء بعد · منذ 40 يوم)");
  });
  test("العقد المتوقف بنصه الحرفي", () => {
    const a = pausedAlert({ contractNumber: "CON-0007", name: "مؤسسة النور" });
    expect(a.text).toBe("⏸ العقد CON-0007 · مؤسسة النور متوقف");
    expect(a.color).toBe("warn");
  });
});

describe("overdueTaskAlert — مهمة متأخرة (main_window.py:396-400)", () => {
  test("النص الحرفي وبلا زر «مهمة» والعمر من تاريخ الموعد", () => {
    const a = overdueTaskAlert({ title: "متابعة بلدية", dueAt: "2026-10-01 09:30" }, TODAY);
    expect(a.text).toBe("📌 مهمة متأخرة: «متابعة بلدية» · كان موعدها 2026-10-01 09:30");
    expect(a.noConvert).toBe(true);
    expect(a.age).toBe(18);
  });
});

describe("buildDashboardAlerts — الترتيب المكتبي وحدود 25/10", () => {
  test("الترتيب: انتهاء ← دفعات ← تعليقات ← شيكات ← إشراف ← تمديد ← بوابة ← تنفيذ ← تحصيل ← متوقف ← مهام", () => {
    const alerts = buildDashboardAlerts(
      {
        expiring: [{ contractNumber: "C1", customerName: "ع", remaining: 10, endDate: "2026-10-29" }],
        planItems: [{ title: "د", customerName: "ع", contractNumber: "C1", remaining: 5, daysDiff: 2 }],
        stalePinned: [{ customerName: "ع", ageDays: 20, body: "متن" }],
        cheques: [{ vtype: "receipt", voucherNumber: "V1", party: "بنك", amount: 1, daysLeft: 2, chequeDueDate: "2026-10-21" }],
        nearBaseEnd: [{ customerName: "ع", label: "عقد", daysLeft: 5, baseEnd: "2026-10-24", monthly: 100 }],
        extensions: [{ customerName: "ع", label: "عقد", baseEnd: "2026-09-01", billableExtension: 1, extensionValue: 100 }],
        lateSettlements: [{ gateway: "G", day: "2026-10-01", expect: 1, settleDate: "2026-10-03" }],
        execution: [{ contractNumber: "C1", customerName: "ع", stageName: "س", kind: "overdue", daysIn: 5, expected: 3, over: 2 }],
        overdueCollections: [{ customerName: "ع", contractNumber: "C1", remaining: 9, lastReceipt: "", daysSince: 33 }],
        paused: [{ contractNumber: "C2", name: "م" }],
        overdueTasks: [{ title: "مهمة", dueAt: "2026-10-10 08:00" }],
      },
      TODAY
    );
    expect(alerts).toHaveLength(11);
    expect(alerts[0].text.startsWith("⏰")).toBe(true);
    expect(alerts[1].text.startsWith("📆")).toBe(true);
    expect(alerts[2].text.startsWith("📌 تعليق")).toBe(true);
    expect(alerts[3].text.startsWith("🏦 شيك")).toBe(true);
    expect(alerts[4].text.startsWith("تنبيه إشراف")).toBe(true);
    expect(alerts[5].text.startsWith("تمديد إشراف")).toBe(true);
    expect(alerts[6].text.startsWith("🏦 تسوية")).toBe(true);
    expect(alerts[7].text.startsWith("🏗")).toBe(true);
    expect(alerts[8].text.startsWith("💰")).toBe(true);
    expect(alerts[9].text.startsWith("⏸")).toBe(true);
    expect(alerts[10].text.startsWith("📌 مهمة")).toBe(true);
  });
  test("الحدود المكتبية: 25 لكل قسم و10 للتعليقات والبوابة", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ contractNumber: `C${i}`, customerName: "ع", remaining: 5, endDate: "2026-11-01" }));
    const pinned = Array.from({ length: 15 }, (_, i) => ({ customerName: "ع", ageDays: 20, body: `متن ${i}` }));
    const alerts = buildDashboardAlerts(
      {
        expiring: many, planItems: [], stalePinned: pinned, cheques: [],
        nearBaseEnd: [], extensions: [], lateSettlements: [], execution: [],
        overdueCollections: [], paused: [], overdueTasks: [],
      },
      TODAY
    );
    expect(alerts).toHaveLength(35); // 25 + 10
  });
});

// ============================================================
// الفلترة: العمر 30 يومًا + المخفاة
// ============================================================

describe("filterAlerts — فلترة العمر والمخفاة (main_window.py:403-415)", () => {
  const base = { color: "warn" as const, text: "نص", age: 0 };
  test("الأقدم من 30 يومًا يُخفى بعدّاد (العتبة >30 لا ≥30)", () => {
    const r = filterAlerts([{ ...base, age: 30 }, { ...base, age: 31 }, { ...base, age: 45 }], new Set());
    expect(r.fresh).toHaveLength(1);
    expect(r.hiddenCount).toBe(2);
    expect(alertHiddenNote(2)).toBe("أُخفي 2 تنبيهًا أقدم من 30 يومًا — تفاصيلها في التقارير");
  });
  test("المخفاة بمفتاحها تُسقط صمتًا بلا عدّاد", () => {
    const dismissed = new Set(["k1"]);
    const r = filterAlerts([{ ...base, key: "k1" }, { ...base, key: "k2" }], dismissed);
    expect(r.fresh).toHaveLength(1);
    expect(r.fresh[0].key).toBe("k2");
    expect(r.hiddenCount).toBe(0);
  });
  test("بلا مفاتيح (حجم صفر) لا يُسقط شيئًا حتى لو كانت key موجودة", () => {
    const r = filterAlerts([{ ...base, key: "k1" }], new Set());
    expect(r.fresh).toHaveLength(1);
  });
  test("العمر الكسري يُقرَّب أرضًا (int)", () => {
    const r = filterAlerts([{ ...base, age: 30.9 }], new Set());
    expect(r.fresh).toHaveLength(1);
  });
});

// ============================================================
// النشاط — الألوان والنصوص
// ============================================================

describe("صفوف النشاط (main_window.py:521-556)", () => {
  const row = { when: "2026-10-19T10:30:00.000Z", kind: "سند قبض", text: "دفعة تحت الحساب", amount: 7500, sign: 1, contractId: 15, customerName: "شركة الأفق", contractLabel: "عقد إشراف هندسي" };
  test("المكان: تسمية العقد ← العميل ← «—»", () => {
    expect(activityBody(row)).toBe("عقد إشراف هندسي · دفعة تحت الحساب");
    expect(activityBody({ ...row, contractLabel: "" })).toBe("شركة الأفق · دفعة تحت الحساب");
    expect(activityBody({ ...row, contractLabel: "", customerName: "" })).toBe("— · دفعة تحت الحساب");
    expect(activityBody({ ...row, text: "" })).toBe("عقد إشراف هندسي");
  });
  test("الألوان: وارد أخضر · منصرف أحمر · حدث BRAND", () => {
    expect(activityColor(row)).toBe("#15803D");
    expect(activityColor({ ...row, sign: -1 })).toBe("#B91C1C");
    expect(activityColor({ ...row, sign: 0 })).toBe("#4F46E5");
  });
  test("المبلغ الموقع {:+.3f}", () => {
    expect(fSigned(7500)).toBe("+7,500.000");
    expect(fSigned(-1200.5)).toBe("-1,200.500");
    expect(f3(1234.5)).toBe("1,234.500");
  });
});

// ============================================================
// لوحة المهام المضمّنة (ui/tasks.py compact)
// ============================================================

describe("taskDueText — format_due_at (task_service.py:20)", () => {
  test("DD-MM-YYYY  ·  H:MM ص/م مع إسقاط صفرة الساعة", () => {
    expect(taskDueText("2026-10-19 09:05").text).toBe("19-10-2026  ·  9:05 ص");
    expect(taskDueText("2026-10-19 14:30").text).toBe("19-10-2026  ·  2:30 م");
    expect(taskDueText("2026-10-19 12:00").text).toBe("19-10-2026  ·  12:00 م");
    expect(taskDueText("2026-10-19 00:15").text).toBe("19-10-2026  ·  12:15 ص");
  });
  test("التالف يعود كما هو", () => {
    expect(taskDueText("لا صيغة").text).toBe("لا صيغة");
    expect(taskDueText("").text).toBe("");
  });
});

describe("taskLeftText — المتبقي (ui/tasks.py:344-360)", () => {
  const done = { title: "ت", dueAt: "", status: "منجزة", minutesLeft: -500, overdue: false };
  test("المنجزة «—»", () => {
    expect(taskLeftText(done)).toBe("—");
  });
  test("المتأخرة: س ود · د فقط", () => {
    expect(taskLeftText({ title: "ت", dueAt: "", status: "مفتوحة", minutesLeft: -150, overdue: true })).toBe("متأخرة 2 س 30 د");
    expect(taskLeftText({ title: "ت", dueAt: "", status: "مفتوحة", minutesLeft: -45, overdue: true })).toBe("متأخرة 45 د");
  });
  test("القادمة: يوم · س ود · د", () => {
    expect(taskLeftText({ title: "ت", dueAt: "", status: "مفتوحة", minutesLeft: 1500, overdue: false })).toBe("بعد 1 يوم");
    expect(taskLeftText({ title: "ت", dueAt: "", status: "مفتوحة", minutesLeft: 185, overdue: false })).toBe("بعد 3 س 5 د");
    expect(taskLeftText({ title: "ت", dueAt: "", status: "مفتوحة", minutesLeft: 7, overdue: false })).toBe("بعد 7 د");
  });
  test("عنوان الصف بالروابط المتاحة فقط", () => {
    expect(taskTitleDisplay({ title: "متابعة", dueAt: "", status: "مفتوحة", minutesLeft: 0, overdue: false, customerName: "شركة الأفق", contractNumber: "CON-0012" })).toBe("متابعة  (شركة الأفق · CON-0012)");
    expect(taskTitleDisplay({ title: "متابعة", dueAt: "", status: "مفتوحة", minutesLeft: 0, overdue: false, customerName: "شركة الأفق" })).toBe("متابعة  (شركة الأفق)");
    expect(taskTitleDisplay({ title: "متابعة", dueAt: "", status: "مفتوحة", minutesLeft: 0, overdue: false })).toBe("متابعة");
  });
  test("سطر الإجمالي بثلاث مسافات حول الفاصل", () => {
    expect(taskSummaryText(4, 2)).toBe("مهام مفتوحة: 4   |   متأخرة: 2");
  });
});

describe("عمر المهمة بالأيام (main_window.py _age_days)", () => {
  test("من صيغة الموعد والتاريخ والفارغ", () => {
    expect(ageDaysFromDate("2026-10-01 09:30", TODAY)).toBe(18);
    expect(ageDaysFromDate("2026-10-01", TODAY)).toBe(18);
    expect(ageDaysFromDate("", TODAY)).toBe(0);
    expect(ageDaysFromDate("نص تالف", TODAY)).toBe(0);
  });
});

// ============================================================
// تحويل التنبيه إلى مهمة (main_window.py:1537-1548)
// ============================================================

describe("stripAlertPrefix / shortenTaskTitle", () => {
  test("تُسقط البادئة الرمزية الأولى فقط", () => {
    expect(stripAlertPrefix("⏰ العقد CON-0012 ينتهي بعد 5 يوم (2026-10-24)")).toBe("العقد CON-0012 ينتهي بعد 5 يوم (2026-10-24)");
    expect(stripAlertPrefix("تنبيه إشراف: ع · تنتهي")).toBe("تنبيه إشراف: ع · تنتهي");
    expect(stripAlertPrefix("📌 مهمة متأخرة: «ت»")).toBe("مهمة متأخرة: «ت»");
  });
  test("القص عند 80: 77 + «...»", () => {
    expect(shortenTaskTitle("ا".repeat(80))).toHaveLength(80);
    expect(shortenTaskTitle("ا".repeat(81))).toBe("ا".repeat(77) + "...");
    expect(shortenTaskTitle("ا".repeat(81))).toHaveLength(80);
  });
});

// ============================================================
// الترقيم (PaginationBar)
// ============================================================

describe("pageSlice — ترقيم التغذية (widgets.py:977-1090)", () => {
  test("صفحة 8 من 20 عنصرًا: 3 صفحات ومعلومة حرفية", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const p1 = pageSlice(items, 0);
    expect(p1.chunk).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(p1.pages).toBe(3);
    expect(p1.info).toBe("صفحة 1 من 3   (1–8 من 20)");
    const p3 = pageSlice(items, 2);
    expect(p3.chunk).toEqual([16, 17, 18, 19]);
    expect(p3.info).toBe("صفحة 3 من 3   (17–20 من 20)");
  });
  test("الصفحة الزائدة تُقيَّد لآخر صفحة (widgets.py:1054)", () => {
    const items = Array.from({ length: 9 }, (_, i) => i);
    const p = pageSlice(items, 5);
    expect(p.page).toBe(1);
    expect(p.chunk).toEqual([8]);
  });
  test("≤8 عناصر: بلا ترقيم ونص المعلومة فارغ", () => {
    const p = pageSlice([1, 2, 3], 0);
    expect(p.pages).toBe(1);
    expect(p.info).toBe("");
  });
  test("الثوابت المكتبية", () => {
    expect(ALERTS_PER_PAGE).toBe(8);
    expect(ALERT_MAX_AGE_DAYS).toBe(30);
    expect(ACTIVITY_ROWS).toBe(8);
    expect(ACTIVITY_EXPANDED).toBe(25);
    expect(EMPTY_FEED_TEXT).toBe("✅ لا تنبيهات ولا نشاط بعد · كل شيء على ما يرام");
    expect(DISMISS_CONFIRM_TEXT).toBe("إخفاء كل التنبيهات النظامية الحالية؟\nستعود تلقائيًا إذا تغيّرت بياناتها.");
    expect(restoredAlertsMessage(3)).toBe("تمت إعادة إظهار 3 تنبيهًا.");
    expect(restoredAlertsMessage(0)).toBe("لا توجد تنبيهات مخفية.");
  });
});

// ============================================================
// تسمية العقد (extras_service.py:12 _label_from_row)
// ============================================================

describe("contractLabelFrom — تسمية العقد للعميل", () => {
  test("الاسم موجود: يُسبق بـ«عقد» إن لم يبدأ بها", () => {
    expect(contractLabelFrom("إشراف هندسي", "", "2026-01-01")).toBe("عقد إشراف هندسي");
    expect(contractLabelFrom("عقد توريد خرسانة", "", "2026-01-01")).toBe("عقد توريد خرسانة");
  });
  test("الوصف بديل الاسم", () => {
    expect(contractLabelFrom("", "أعمال تشطيب", "2026-01-01")).toBe("عقد أعمال تشطيب");
  });
  test("لا اسم ولا وصف: «العقد المبرم بتاريخ …»", () => {
    expect(contractLabelFrom("", "", "2026-01-05")).toBe("العقد المبرم بتاريخ 2026-01-05");
  });
});

describe("truncateBody — اقتطاع المتن", () => {
  test("70 حرفًا ثم … والقصير يمر كما هو", () => {
    expect(truncateBody("ب".repeat(70))).toHaveLength(70);
    expect(truncateBody("ب".repeat(71))).toBe("ب".repeat(70) + "…");
    expect(truncateBody("قصير")).toBe("قصير");
  });
});
