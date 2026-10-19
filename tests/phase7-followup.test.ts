/**
 * اختبار المرحلة 7-أ — إثراء شاشة المتابعة المالية
 * قفل المنطق النقي المطابق للمكتبي V9.15.18:
 *   lifecycle_service.py:412  get_expiry_alert_days (تفكيك أيام التنبيه + الافتراضي)
 *   lifecycle_service.py:429  expiring_contracts (المستوى = أصغر حدّ ≥ المتبقي؛ يستبقي مغلق/ملغى/منتهي)
 *   lifecycle_service.py:5281 overdue_collections (يستبقي مغلق/ملغى/مسودة)
 *   main_window.py:332        تمديد إشراف (أساس منتهٍ والتمديد ساري) — بنفسجي
 *   workflow_service.py:5230  execution_alerts (متأخر أحمر · قارب كهرماني)
 * الدوال كلها نقية — بلا قاعدة بيانات.
 */

import { describe, expect, test } from "bun:test";
import {
  buildExecutionAlertRows,
  classifyStageExecution,
  expiryLevelsOrDefault,
  expiryTier,
  isFollowupCollection,
  isFollowupExpiring,
  isSupervisionInExtension,
  type ExecutionContractInput,
} from "@/lib/followup-alerts";

describe("parseExpiryLevels — تفكيك «أيام التنبيه» (مرآة get_expiry_alert_days)", () => {
  test("الافتراضي 90,60,30,7 يُرتَّب تصاعديًا بلا تكرار", () => {
    expect(expiryLevelsOrDefault("90,60,30,7")).toEqual([7, 30, 60, 90]);
    expect(expiryLevelsOrDefault("7,7,90,30")).toEqual([7, 30, 90]);
    expect(expiryLevelsOrDefault(" 60 , 7 , 30 ")).toEqual([7, 30, 60]);
  });
  test("المدخلات التالفة ⇒ الافتراضي [7,30,60,90]", () => {
    expect(expiryLevelsOrDefault("")).toEqual([7, 30, 60, 90]);
    expect(expiryLevelsOrDefault("abc , ,x")).toEqual([7, 30, 60, 90]);
    expect(expiryLevelsOrDefault(undefined)).toEqual([7, 30, 60, 90]);
    expect(expiryLevelsOrDefault("30.5")).toEqual([7, 30, 60, 90]); // كسري = تالف كالمكتبي int()
  });
});

describe("expiryTier — تدرّج ألوان عقود تنتهي قريبًا (main_window.py:287)", () => {
  test("النافذة 90,60,30,7: ≤7 عميق · ≤30 تحذير · ≤90 معلومة", () => {
    expect(expiryTier(3, "90,60,30,7")).toBe("deep");
    expect(expiryTier(7, "90,60,30,7")).toBe("deep");
    expect(expiryTier(8, "90,60,30,7")).toBe("warn");
    expect(expiryTier(30, "90,60,30,7")).toBe("warn");
    expect(expiryTier(45, "90,60,30,7")).toBe("info");
    expect(expiryTier(60, "90,60,30,7")).toBe("info");
    expect(expiryTier(90, "90,60,30,7")).toBe("info");
  });
  test("اليوم صفر (ينتهي اليوم) عميق", () => {
    expect(expiryTier(0, "90,60,30,7")).toBe("deep");
  });
  test("مستوى واحد ⇒ كل ما دونه عميق، والنافذة = المستوى نفسه", () => {
    expect(expiryTier(10, "45")).toBe("deep");
    expect(expiryTier(45, "45")).toBe("deep");
  });
  test("مستويان 60,30: ≤30 عميق · ≤60 تحذير", () => {
    expect(expiryTier(29, "60,30")).toBe("deep");
    expect(expiryTier(31, "60,30")).toBe("warn");
    expect(expiryTier(60, "60,30")).toBe("warn");
  });
  test("إعداد تالف ⇒ ينسحب الافتراضي", () => {
    expect(expiryTier(5, "tampered")).toBe("deep");
    expect(expiryTier(50, "tampered")).toBe("info");
  });
});

describe("isSupervisionInExtension — قاعدة «تمديد إشراف» (supervision_service.py:431)", () => {
  const today = "2026-02-01";
  test("أساس منتهٍ والتمديد ساري بلا نهاية فعلية ⇒ تمديد", () => {
    expect(isSupervisionInExtension({ isSupervision: true, supEnd: "2026-01-01", supActualEnd: "" }, today)).toBe(true);
  });
  test("اليوم == نهاية الأساس ليس تمديدًا (يجب أن يمر بعده)", () => {
    expect(isSupervisionInExtension({ isSupervision: true, supEnd: "2026-02-01", supActualEnd: "" }, today)).toBe(false);
  });
  test("بلا نهاية أساس أو ليست مرحلة إشراف ⇒ لا", () => {
    expect(isSupervisionInExtension({ isSupervision: true, supEnd: "", supActualEnd: "" }, today)).toBe(false);
    expect(isSupervisionInExtension({ isSupervision: false, supEnd: "2026-01-01", supActualEnd: "" }, today)).toBe(false);
  });
  test("نهاية فعلية بعد اليوم ⇒ ما زال في التمديد · قبل اليوم ⇒ انتهى", () => {
    expect(isSupervisionInExtension({ isSupervision: true, supEnd: "2026-01-01", supActualEnd: "2026-03-01" }, today)).toBe(true);
    expect(isSupervisionInExtension({ isSupervision: true, supEnd: "2026-01-01", supActualEnd: "2026-02-01" }, today)).toBe(true);
    expect(isSupervisionInExtension({ isSupervision: true, supEnd: "2026-01-01", supActualEnd: "2026-01-15" }, today)).toBe(false);
  });
});

describe("isFollowupCollection / isFollowupExpiring — توازي الحالات مع المكتبي", () => {
  test("التحصيل يستبقي مغلق/ملغى/مسودة (lifecycle:5303) ولا يستبقي منتهي", () => {
    expect(isFollowupCollection("مسودة")).toBe(false);
    expect(isFollowupCollection("مغلق")).toBe(false);
    expect(isFollowupCollection("ملغى")).toBe(false);
    expect(isFollowupCollection("ملغي")).toBe(false);
    expect(isFollowupCollection("ساري")).toBe(true);
    expect(isFollowupCollection("منتهي")).toBe(true);
  });
  test("الانتهاء يستبقي مغلق/ملغى/منتهي (lifecycle:437)", () => {
    expect(isFollowupExpiring("مغلق")).toBe(false);
    expect(isFollowupExpiring("ملغى")).toBe(false);
    expect(isFollowupExpiring("منتهي")).toBe(false);
    expect(isFollowupExpiring("ساري")).toBe(true);
  });
});

describe("classifyStageExecution — حالة المرحلة الجارية (workflow_service stage_status)", () => {
  const stage = (startDate: string, expectedDays: number, extra: Partial<{ endDate: string; isSkipped: boolean }> = {}) => ({
    name: "أساسات", startDate, endDate: "", isSkipped: false, expectedDays, ...extra,
  });
  test("تجاوز المتوقع ⇒ overdue مع over", () => {
    expect(classifyStageExecution(stage("2026-01-01", 30), "2026-02-15")).toEqual({
      kind: "overdue", daysIn: 45, expected: 30, over: 15,
    });
  });
  test("اليوم == المتوقع أو بقي ≤3 ⇒ near مع left", () => {
    expect(classifyStageExecution(stage("2026-01-01", 30), "2026-01-31")).toEqual({
      kind: "near", daysIn: 30, expected: 30, left: 0,
    });
    expect(classifyStageExecution(stage("2026-01-01", 30), "2026-01-28")?.left).toBe(3);
  });
  test("بعد المتوقع بـ4+ أيام قبل الاقتراب ⇒ لا تنبيه", () => {
    expect(classifyStageExecution(stage("2026-01-01", 30), "2026-01-27")).toBeNull();
  });
  test("مرحلة منتهية أو متخطاة أو بلا متوقع ⇒ لا تنبيه", () => {
    expect(classifyStageExecution(stage("2026-01-01", 30, { endDate: "2026-01-20" }), "2026-02-15")).toBeNull();
    expect(classifyStageExecution(stage("2026-01-01", 30, { isSkipped: true }), "2026-02-15")).toBeNull();
    expect(classifyStageExecution(stage("2026-01-01", 0), "2026-02-15")).toBeNull();
    expect(classifyStageExecution(stage("", 30), "2026-02-15")).toBeNull();
  });
});

describe("buildExecutionAlertRows — بناء صفوف تنبيهات مراحل التنفيذ", () => {
  const today = "2026-02-15";
  const contracts: ExecutionContractInput[] = [
    {
      id: 1, contractNumber: "CON-002", customerName: "عميل قارب", status: "ساري",
      stages: [{ name: "التشطيبات", startDate: "2026-02-01", endDate: "", isSkipped: false, expectedDays: 20 }],
    }, // near: daysIn 14 · left 6? لا — 14 < 17 ⇒ بلا تنبيه… نمطها أدناه
    {
      id: 2, contractNumber: "CON-001", customerName: "عميل متأخر", status: "ساري",
      stages: [{ name: "أساسات", startDate: "2026-01-01", endDate: "", isSkipped: false, expectedDays: 30 }],
    }, // overdue over=15
    {
      id: 3, contractNumber: "CON-003", customerName: "عميل مغلق", status: "مغلق",
      stages: [{ name: "أساسات", startDate: "2026-01-01", endDate: "", isSkipped: false, expectedDays: 5 }],
    }, // مستبعد بالحالة
    {
      id: 4, contractNumber: "CON-004", customerName: "بلا مرحلة جارية", status: "ساري",
      stages: [{ name: "أساسات", startDate: "2026-01-01", endDate: "2026-01-20", isSkipped: false, expectedDays: 5 }],
    }, // لا مرحلة جارية
    {
      id: 5, contractNumber: "CON-005", customerName: "عميل قارب فعليًا", status: "ساري",
      stages: [{ name: "الأسقف", startDate: "2026-02-01", endDate: "", isSkipped: false, expectedDays: 15 }],
    }, // daysIn 14 · left 1 ⇒ near
  ];

  test("المتأخر أولًا ثم القارب، وبشكل صحيح الصفوف", () => {
    const rows = buildExecutionAlertRows(contracts, today);
    expect(rows.map((r) => r.contractId)).toEqual([2, 5]);
    expect(rows[0]).toEqual({
      contractId: 2, contractNumber: "CON-001", customerName: "عميل متأخر",
      stageName: "أساسات", kind: "overdue", daysIn: 45, expected: 30, over: 15,
    });
    expect(rows[1]).toEqual({
      contractId: 5, contractNumber: "CON-005", customerName: "عميل قارب فعليًا",
      stageName: "الأسقف", kind: "near", daysIn: 14, expected: 15, left: 1,
    });
  });
  test("المتأخرون بينهم بترتيب التجاوز تنازليًا والقاربون بترتيب ما بقي تصاعديًا", () => {
    const many: ExecutionContractInput[] = [
      {
        id: 10, contractNumber: "CON-010", customerName: "أ", status: "ساري",
        stages: [{ name: "م1", startDate: "2026-01-05", endDate: "", isSkipped: false, expectedDays: 30 }],
      }, // over 11
      {
        id: 11, contractNumber: "CON-011", customerName: "ب", status: "ساري",
        stages: [{ name: "م2", startDate: "2026-01-01", endDate: "", isSkipped: false, expectedDays: 30 }],
      }, // over 15
      {
        id: 12, contractNumber: "CON-012", customerName: "ج", status: "مسودة",
        stages: [{ name: "م3", startDate: "2026-01-01", endDate: "", isSkipped: false, expectedDays: 30 }],
      }, // مسودة مستبعدة
      {
        id: 13, contractNumber: "CON-013", customerName: "د", status: "ساري",
        stages: [{ name: "م4", startDate: "2026-02-02", endDate: "", isSkipped: false, expectedDays: 15 }],
      }, // left 2
    ];
    const rows = buildExecutionAlertRows(many, today);
    expect(rows.map((r) => r.contractId)).toEqual([11, 10, 13]);
    expect(rows[0].over).toBe(15);
    expect(rows[1].over).toBe(11);
    expect(rows[2].left).toBe(2);
  });
});
