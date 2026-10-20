/**
 * اختبار المرحلة 9 — المشاريع (بند 11)
 * قفل المنطق النقي المطابق للمكتبي V9.15.18 والمخطط المرجعي §48:
 *   lifecycle_service.py:125-180  add/update/list/get/delete_project
 *   :128/141  «اسم المشروع مطلوب.» · :176 «لا يمكن حذف المشروع لأنه مرتبط بعقود أو سندات.»
 *   :153      list_projects ORDER BY p.id DESC (بحث مطبَّع على الاسم/العميل/الهاتف)
 *   database_schema_postgresql.sql:847-858  projects (status DEFAULT 'جديد' · name VARCHAR(200)
 *                                             · customer_id ON DELETE CASCADE · بلا حقول مال)
 * الدوال كلها نقية — بلا قاعدة بيانات.
 */

import { describe, expect, test } from "bun:test";
import {
  cleanProjectCustomerId,
  cleanProjectDate,
  cleanProjectName,
  cleanProjectStatus,
  cleanProjectText,
  filterProjectsByCustomer,
  PROJECT_DELETE_BLOCKED,
  PROJECT_NAME_MAX,
  PROJECT_NAME_REQUIRED,
  PROJECT_STATUSES,
  PROJECT_STATUS_DEFAULT,
  PROJECT_STATUS_FALLBACK_CLASS,
  projectPeriodLabel,
  sortProjectsDesc,
  type ProjectRow,
} from "@/lib/projects-core";
import { statusBadgeClass } from "@/lib/format";

const row = (over: Partial<ProjectRow>): ProjectRow => ({
  id: 1,
  customerId: null,
  customerName: "",
  name: "مشروع",
  description: "",
  location: "",
  startDate: "",
  endDate: "",
  status: PROJECT_STATUS_DEFAULT,
  vouchersCount: 0,
  ...over,
});

describe("التحقق والحقول — مرآة add_project/update_project", () => {
  test("الاسم إلزامي برسالة المكتبي الحرفية «اسم المشروع مطلوب.»", () => {
    expect(PROJECT_NAME_REQUIRED).toBe("اسم المشروع مطلوب.");
    expect(cleanProjectName("   ")).toBe("");
    expect(cleanProjectName("")).toBe("");
    expect(cleanProjectName(undefined)).toBe("");
    expect(cleanProjectName("  مشروع فيلا  ")).toBe("مشروع فيلا");
  });

  test("سقط الاسم على VARCHAR(200)", () => {
    expect(PROJECT_NAME_MAX).toBe(200);
    expect(cleanProjectName("أ".repeat(250)).length).toBe(200);
  });

  test("الحقول النصية الحرة تُشذَّب فقط (description/location TEXT)", () => {
    expect(cleanProjectText("  بناء سكني \n")).toBe("بناء سكني");
    expect(cleanProjectText(null)).toBe("");
  });

  test("التواريخ YYYY-MM-DD فقط وإلا سلسلة فارغة (نمط parseDay الموحد)", () => {
    expect(cleanProjectDate("2025-03-14")).toBe("2025-03-14");
    expect(cleanProjectDate("14/03/2025")).toBe("");
    expect(cleanProjectDate("2025-13-40")).toBe("");
    expect(cleanProjectDate("")).toBe("");
    expect(cleanProjectDate(undefined)).toBe("");
  });

  test("الحالة: افتراضي المخطط «جديد» والنص الحر يسقط على 20 حرفًا", () => {
    expect(PROJECT_STATUS_DEFAULT).toBe("جديد");
    expect(cleanProjectStatus("")).toBe("جديد");
    expect(cleanProjectStatus(undefined)).toBe("جديد");
    expect(cleanProjectStatus(" نشط ")).toBe("نشط");
    expect(cleanProjectStatus("ا".repeat(30)).length).toBe(20);
  });

  test("العميل: معرف موجب صحيح أو null (customer_id اختياري مع CASCADE)", () => {
    expect(cleanProjectCustomerId(7)).toBe(7);
    expect(cleanProjectCustomerId("12")).toBe(12);
    expect(cleanProjectCustomerId(0)).toBeNull();
    expect(cleanProjectCustomerId(-3)).toBeNull();
    expect(cleanProjectCustomerId("x")).toBeNull();
    expect(cleanProjectCustomerId(4.9)).toBe(4);
  });
});

describe("الحالات — مفردات STATUS_COLORS المكتبية وافتراضي «جديد»", () => {
  test("«جديد» أول القائمة (افتراضي المخطط §48)", () => {
    expect(PROJECT_STATUSES[0]).toBe("جديد");
    expect(PROJECT_STATUSES).toContain("نشط");
    expect(PROJECT_STATUSES).toContain("متوقف");
    expect(PROJECT_STATUSES).toContain("منتهي");
  });

  test("ألوان الشارات تتبع خريطة الحالات الموحدة و«جديد» يرجع الرمادي كالمكتبي", () => {
    // المكتبي STATUS_COLORS: نشط OK_GREEN · متوقف WARN · منتهي PURPLE · غير المعروف رمادي
    expect(statusBadgeClass("نشط")).toBe("bg-status-info-bg text-status-info");
    expect(statusBadgeClass("متوقف")).toBe("bg-status-warn-bg text-status-warn");
    expect(statusBadgeClass("منتهي")).toBe("bg-status-done-bg text-status-done");
    expect(statusBadgeClass("جديد")).toBe(PROJECT_STATUS_FALLBACK_CLASS);
  });
});

describe("القائمة — مرآة list_projects (ORDER BY id DESC + فلتر العميل)", () => {
  test("الأحدث أولًا بمعرف id تنازليًا", () => {
    const rows = [row({ id: 3, name: "ثالث" }), row({ id: 1, name: "أول" }), row({ id: 2, name: "ثانٍ" })];
    expect(sortProjectsDesc(rows).map((r) => r.id)).toEqual([3, 2, 1]);
    // بلا إتلاف المصدر
    expect(rows.map((r) => r.id)).toEqual([3, 1, 2]);
  });

  test("فلتر العميل: null يعيد الكل ورقم يرشّح حصرًا", () => {
    const rows = [row({ id: 1, customerId: 5 }), row({ id: 2, customerId: 6 })];
    expect(filterProjectsByCustomer(rows, null)).toHaveLength(2);
    expect(filterProjectsByCustomer(rows, 0)).toHaveLength(2);
    expect(filterProjectsByCustomer(rows, 6).map((r) => r.id)).toEqual([2]);
  });
});

describe("العرض والحذف", () => {
  test("فترة المشروع: بداية→نهاية أو طرف واحد أو —", () => {
    expect(projectPeriodLabel({ startDate: "2025-01-01", endDate: "2025-12-31" })).toBe(
      "2025-01-01 → 2025-12-31"
    );
    expect(projectPeriodLabel({ startDate: "2025-01-01", endDate: "" })).toBe("2025-01-01");
    expect(projectPeriodLabel({ startDate: "", endDate: "2025-12-31" })).toBe("2025-12-31");
    expect(projectPeriodLabel({ startDate: "", endDate: "" })).toBe("—");
  });

  test("حارس الحذف المكتبي حرفيًا: الارتباط يمنع الحذف", () => {
    expect(PROJECT_DELETE_BLOCKED).toBe("لا يمكن حذف المشروع لأنه مرتبط بعقود أو سندات.");
  });

  test("بلا حقول مال — صف المشروع لا يحوي أي مفتاح مالي", () => {
    const keys = Object.keys(row({}));
    expect(keys).not.toContain("amount");
    expect(keys).not.toContain("total");
    expect(keys).not.toContain("price");
  });
});
