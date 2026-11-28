/**
 * اختبارات نواة ب3 «الأنشطة: الشجرة والFloat والربط والتوزيع» — docs/schedule-import-design.md §13.
 * الشجرة بأول ظهور وترتيب داخلي زمني · Float null بلا تواريخ وصفره حرج ·
 * نافذة البند من أنشطته المؤرخة work حصرًا · التوزيع بوزن المدة والميلستون بلا وزن.
 */
import { describe, expect, test } from "bun:test";

import {
  activityFloat,
  buildActivityTree,
  deriveItemWindowFromActivities,
  distributeSectionAcrossActivities,
  type ScheduleActivityRow,
} from "../src/lib/schedule-activities-core";

const act = (over: Partial<ScheduleActivityRow>): ScheduleActivityRow => ({
  id: 1,
  activityCode: "P-FL-C-00100",
  name: "CONCRETE FOUNDATION",
  kind: "work",
  family: "P-FL",
  durationDays: 10,
  earlyStart: "2026-03-01",
  earlyFinish: "2026-03-10",
  lateStart: "2026-03-05",
  lateFinish: "2026-03-14",
  isSummary: false,
  groupName: "FOUNDATION LEVEL",
  divisionCode: "03",
  boqItemId: null,
  sortOrder: 0,
  ...over,
});

describe("activityFloat — الحجم الحر المشتق", () => {
  test("طبيعي: lateFinish − earlyFinish", () => {
    expect(activityFloat("2026-03-10", "2026-03-14")).toBe(4);
  });
  test("الصفر = نشطة مسار حرج", () => {
    expect(activityFloat("2026-03-10", "2026-03-10")).toBe(0);
  });
  test("بلا تواريخ ⇒ null لا اختلاق", () => {
    expect(activityFloat("", "2026-03-14")).toBe(null);
    expect(activityFloat("2026-03-10", "")).toBe(null);
    expect(activityFloat("", "")).toBe(null);
  });
});

describe("buildActivityTree — الشجرة بالـbands", () => {
  test("الأبنية بأول ظهور وفق ترتيب المدخل، والداخلية بترتيب زمني", () => {
    const rows = [
      act({ id: 1, groupName: "FOUNDATION", earlyStart: "2026-03-05", sortOrder: 0 }),
      act({ id: 2, groupName: "GROUND LEVEL", earlyStart: "2026-04-01", sortOrder: 1 }),
      act({ id: 3, groupName: "FOUNDATION", earlyStart: "2026-03-01", sortOrder: 2 }),
    ];
    const tree = buildActivityTree(rows);
    expect(tree.map((b) => b.name)).toEqual(["FOUNDATION", "GROUND LEVEL"]); // أول ظهور
    expect(tree[0].count).toBe(2);
    expect(tree[0].items.map((i) => i.id)).toEqual([3, 1]); // زمنيًا 03-01 ثم 03-05
  });
  test("الفراغ groupName يعامل band صريح «—»", () => {
    const tree = buildActivityTree([act({ groupName: "" })]);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("—");
  });
  test("غير المؤرخة آخر الشريط داخل bandها", () => {
    const tree = buildActivityTree([
      act({ id: 1, earlyStart: "2026-03-01" }),
      act({ id: 2, earlyStart: "", earlyFinish: "" }),
    ]);
    expect(tree[0].items.map((i) => i.id)).toEqual([1, 2]);
  });
});

describe("deriveItemWindowFromActivities — نافذة البند المربوط", () => {
  test("min بداية / max نهاية لأنشطة work المؤرخة", () => {
    const w = deriveItemWindowFromActivities([
      { kind: "work", isSummary: false, earlyStart: "2026-03-10", earlyFinish: "2026-03-20" },
      { kind: "work", isSummary: false, earlyStart: "2026-03-01", earlyFinish: "2026-03-08" },
    ]);
    expect(w).toEqual({ start: "2026-03-01", finish: "2026-03-20" });
  });
  test("تسليمات واعتمادات وملخصات لا تدخل النافذة", () => {
    const w = deriveItemWindowFromActivities([
      { kind: "submittal", isSummary: false, earlyStart: "2026-01-01", earlyFinish: "2026-01-05" },
      { kind: "work", isSummary: true, earlyStart: "2026-01-01", earlyFinish: "2026-06-30" },
      { kind: "work", isSummary: false, earlyStart: "2026-03-01", earlyFinish: "2026-03-10" },
    ]);
    expect(w).toEqual({ start: "2026-03-01", finish: "2026-03-10" });
  });
  test("بلا مؤرخة ⇒ null — والأنشطة بلا نصف تواريخ مستبعدة", () => {
    expect(deriveItemWindowFromActivities([])).toBe(null);
    expect(
      deriveItemWindowFromActivities([{ kind: "work", isSummary: false, earlyStart: "", earlyFinish: "" }])
    ).toBe(null);
    expect(
      deriveItemWindowFromActivities([{ kind: "work", isSummary: false, earlyStart: "2026-03-01", earlyFinish: "" }])
    ).toBe(null);
  });
});

describe("distributeSectionAcrossActivities — التوزيع بوزن المدة", () => {
  test("حصص الأنشطة بوزن المدة والدلاء الشهرية تكتمل بقيمة القسم", () => {
    // نشطتان بنافذتين منفصلتين — قسم قيمته 3000: وزن 20 و10 ⇒ 2000 و1000
    const buckets = distributeSectionAcrossActivities(3000, [
      { durationDays: 20, earlyStart: "2026-01-01", earlyFinish: "2026-01-20" },
      { durationDays: 10, earlyStart: "2026-02-01", earlyFinish: "2026-02-10" },
    ]);
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toEqual({ month: "2026-01", planned: 2000, plannedCum: 2000 });
    expect(buckets[1]).toEqual({ month: "2026-02", planned: 1000, plannedCum: 3000 });
  });
  test("نشطة عابرة لشهرين تتوزع خطيًا بأيام شاملة", () => {
    // نشطة واحدة بمدة 21 يومًا عبر يناير (11 يومًا 21→31؟) — 2026-01-21→2026-02-10: يناير 11 يومًا وفبراير 10
    const buckets = distributeSectionAcrossActivities(2100, [
      { durationDays: 21, earlyStart: "2026-01-21", earlyFinish: "2026-02-10" },
    ]);
    expect(buckets).toHaveLength(2);
    expect(buckets[0].planned).toBe(1100); // 2100×11/21
    expect(buckets[1].planned).toBe(1000); // 2100×10/21
    expect(buckets[1].plannedCum).toBe(2100);
  });
  test("الميلستون الصفرية بلا وزن — لا تمحو الحصص (§7.3)", () => {
    const buckets = distributeSectionAcrossActivities(1000, [
      { durationDays: 10, earlyStart: "2026-01-01", earlyFinish: "2026-01-10" },
      { durationDays: 0, earlyStart: "2026-01-15", earlyFinish: "2026-01-15" },
    ]);
    expect(buckets).toEqual([{ month: "2026-01", planned: 1000, plannedCum: 1000 }]);
  });
  test("بلا أنشطة مؤرخة بمدة ⇒ دلاء فارغة (لا اختلاق منحنى)", () => {
    expect(distributeSectionAcrossActivities(1000, [])).toEqual([]);
    expect(
      distributeSectionAcrossActivities(1000, [{ durationDays: 0, earlyStart: "2026-01-01", earlyFinish: "2026-01-10" }])
    ).toEqual([]);
    expect(
      distributeSectionAcrossActivities(1000, [{ durationDays: 10, earlyStart: "", earlyFinish: "" }])
    ).toEqual([]);
  });
  test("قيمة ≤ 0 ⇒ فارغة — والنافذة المعكوسة مستبعدة", () => {
    expect(distributeSectionAcrossActivities(0, [{ durationDays: 5, earlyStart: "2026-01-01", earlyFinish: "2026-01-05" }])).toEqual([]);
    expect(
      distributeSectionAcrossActivities(-100, [{ durationDays: 5, earlyStart: "2026-01-01", earlyFinish: "2026-01-05" }])
    ).toEqual([]);
    expect(
      distributeSectionAcrossActivities(1000, [{ durationDays: 5, earlyStart: "2026-01-10", earlyFinish: "2026-01-05" }])
    ).toEqual([]);
  });
});
