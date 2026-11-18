/**
 * اختبارات نواة «النافذة المخططة لكل بند» — ج1 المتبقي.
 * docs/schedule-import-design.md §8 — نواة نقية حصرًا (بلا DB): تحقق النافذة،
 * محور المشروع، حالة الجدولة، شريط النافذة، واشتقاق العرض الزمني الكامل.
 */
import { describe, expect, test } from "bun:test";

import {
  daysBetween,
  deriveProjectWindow,
  scheduleItemStatus,
  scheduleItemsView,
  validatePlannedWindow,
  windowBarPct,
  type ScheduleItemRow,
} from "../src/lib/schedule-items-core";

const row = (over: Partial<ScheduleItemRow>): ScheduleItemRow => ({
  id: 1,
  itemNo: "01.01.001",
  description: "بند",
  divisionCode: "03",
  divisionName: "CONCRETE",
  plannedStart: "",
  plannedFinish: "",
  ...over,
});

describe("validatePlannedWindow — تحقق نافذة البند", () => {
  test("الفارغَان معًا = إفراغ مقبول (توافق خلفي كامل — سلوك ب1 حرفيًا)", () => {
    const c = validatePlannedWindow("", "");
    expect(c.ok).toBe(true);
    expect(c.value).toBeUndefined();
  });

  test("نصف نافذة مرفوضة — بداية بلا نهاية ونهاية بلا بداية", () => {
    expect(validatePlannedWindow("2026-03-01", "").ok).toBe(false);
    expect(validatePlannedWindow("", "2026-03-05").ok).toBe(false);
  });

  test("الصيغة إلزامية — النص الفاسد رفض صريح لا يتلقم", () => {
    expect(validatePlannedWindow("01/03/2026", "2026-03-05").ok).toBe(false);
    expect(validatePlannedWindow("2026-3-1", "2026-03-05").ok).toBe(false);
    expect(validatePlannedWindow("فاسد", "2026-03-05").ok).toBe(false);
  });

  test("البداية بعد النهاية مرفوضة برسالة الأرقام", () => {
    const c = validatePlannedWindow("2026-03-10", "2026-03-05");
    expect(c.ok).toBe(false);
    expect(c.error).toContain("2026-03-10");
    expect(c.error).toContain("2026-03-05");
  });

  test("نافذة سليمة تُقبل بقيم مطبَّعة — واليوم الواحد (بداية = نهاية) نافذة مشروعة", () => {
    const c = validatePlannedWindow(" 2026-03-01 ", " 2026-03-05 ");
    expect(c.ok).toBe(true);
    expect(c.value).toEqual({ plannedStart: "2026-03-01", plannedFinish: "2026-03-05" });
    expect(validatePlannedWindow("2026-03-01", "2026-03-01").ok).toBe(true);
  });
});

describe("daysBetween — فرق الأيام", () => {
  test("فرق صحيح بين تاريخين — والإتجاه المعاكس سالب", () => {
    expect(daysBetween("2026-03-01", "2026-03-05")).toBe(4);
    expect(daysBetween("2026-03-05", "2026-03-01")).toBe(-4);
    expect(daysBetween("2026-03-01", "2026-03-01")).toBe(0);
  });
});

describe("deriveProjectWindow — محور المشروع من البنود", () => {
  test("min البدايات وmax النهايات للبنود ذات النافذة حصرًا", () => {
    const w = deriveProjectWindow([
      row({ plannedStart: "2026-03-05", plannedFinish: "2026-05-01" }),
      row({ plannedStart: "2026-02-28", plannedFinish: "2026-04-10" }),
      row({}),
      row({ plannedStart: "2026-04-01", plannedFinish: "2026-06-15" }),
    ]);
    expect(w).toEqual({ start: "2026-02-28", finish: "2026-06-15" });
  });

  test("بلا بنود بنافذة ⇒ null — والبند الواحد محوره نافذته نفسها", () => {
    expect(deriveProjectWindow([row({}), row({})])).toBeNull();
    expect(deriveProjectWindow([])).toBeNull();
    expect(deriveProjectWindow([row({ plannedStart: "2026-03-01", plannedFinish: "2026-03-10" })])).toEqual({
      start: "2026-03-01",
      finish: "2026-03-10",
    });
  });
});

describe("scheduleItemStatus — حالة الجدولة مقابل اليوم", () => {
  test("بلا نافذة = none — قادمة/جارية/متجاوزة بالمقارنة النصية الآمنة", () => {
    expect(scheduleItemStatus({ plannedStart: "", plannedFinish: "" }, "2026-03-01")).toBe("none");
    expect(scheduleItemStatus({ plannedStart: "2026-03-05", plannedFinish: "2026-03-10" }, "2026-03-01")).toBe("upcoming");
    expect(scheduleItemStatus({ plannedStart: "2026-03-05", plannedFinish: "2026-03-10" }, "2026-03-07")).toBe("active");
    expect(scheduleItemStatus({ plannedStart: "2026-03-05", plannedFinish: "2026-03-10" }, "2026-03-11")).toBe("overdue");
  });

  test("حدود النافذة شاملة — اليوم=البداية واليوم=النهاية كلاهما جارية", () => {
    expect(scheduleItemStatus({ plannedStart: "2026-03-05", plannedFinish: "2026-03-10" }, "2026-03-05")).toBe("active");
    expect(scheduleItemStatus({ plannedStart: "2026-03-05", plannedFinish: "2026-03-10" }, "2026-03-10")).toBe("active");
  });
});

describe("windowBarPct — شريط النافذة على المحور", () => {
  test("بلا نافذة أو بلا محور ⇒ null", () => {
    expect(windowBarPct(row({}), "2026-03-01", "2026-06-01")).toBeNull();
    expect(windowBarPct(row({ plannedStart: "2026-03-01", plannedFinish: "2026-04-01" }), "", "")).toBeNull();
  });

  test("موضع وعرض صحيحان على محور 90 يوماً (تقريب منزلتين)", () => {
    // محور 2026-03-01 → 2026-05-30 = 90 يوماً؛ نافذة 2026-03-11 → 2026-04-10
    const b = windowBarPct(
      row({ plannedStart: "2026-03-11", plannedFinish: "2026-04-10" }),
      "2026-03-01",
      "2026-05-30"
    )!;
    expect(b.left).toBeCloseTo((10 / 90) * 100, 0);
    expect(b.width).toBeCloseTo((30 / 90) * 100, 0);
    expect(b.left + b.width).toBeLessThanOrEqual(100.01);
  });

  test("المحور المنحل (مشروع يوم واحد) ⇒ الشريط كامل العرض", () => {
    expect(windowBarPct(row({ plannedStart: "2026-03-01", plannedFinish: "2026-03-01" }), "2026-03-01", "2026-03-01")).toEqual({
      left: 0,
      width: 100,
    });
  });

  test("أول الشريط يسار صفر وآخره يمين 100 على محور نفسه", () => {
    expect(windowBarPct(row({ plannedStart: "2026-03-01", plannedFinish: "2026-06-01" }), "2026-03-01", "2026-06-01")).toEqual({
      left: 0,
      width: 100,
    });
  });
});

describe("scheduleItemsView — الاشتقاق الكامل للعرض", () => {
  const today = "2026-03-07";
  const rows = [
    row({ id: 1, plannedStart: "2026-03-05", plannedFinish: "2026-03-20" }), // جارية
    row({ id: 2, plannedStart: "2026-02-20", plannedFinish: "2026-03-01" }), // متجاوزة
    row({ id: 3 }), // بلا نافذة
    row({ id: 4, plannedStart: "2026-04-01", plannedFinish: "2026-04-30" }), // قادمة
  ];

  test("الترتيب الزمني حسب البداية — وبلا نافذة آخرًا بالترتيب الأصلي", () => {
    const v = scheduleItemsView(rows, today);
    expect(v.rows.map((r) => r.id)).toEqual([2, 1, 4, 3]);
    expect(v.projectWindow).toEqual({ start: "2026-02-20", finish: "2026-04-30" });
  });

  test("حالة كل بند وأيامه وشريطه مشتقة لحظياً", () => {
    const v = scheduleItemsView(rows, today);
    expect(v.rows[0].status).toBe("overdue");
    expect(v.rows[0].daysToFinish).toBe(-6);
    expect(v.rows[1].status).toBe("active");
    expect(v.rows[1].daysToFinish).toBe(13);
    expect(v.rows[2].status).toBe("upcoming");
    expect(v.rows[3].status).toBe("none");
    expect(v.rows[3].bar).toBeNull();
    expect(v.rows[0].bar).not.toBeNull();
  });

  test("الإجماليات: 4 كلي / 3 بنافذة / 1 لكل حالة", () => {
    const v = scheduleItemsView(rows, today);
    expect(v.totals).toEqual({ total: 4, withWindow: 3, active: 1, overdue: 1, upcoming: 1 });
  });

  test("قائمة فارغة — بلا محور وبلا صفوف", () => {
    const v = scheduleItemsView([], today);
    expect(v.projectWindow).toBeNull();
    expect(v.rows).toEqual([]);
    expect(v.totals.total).toBe(0);
  });

  test("استقرار الترتيب: نافذتان متطابقتان تحفظان ترتيب القدوم", () => {
    const v = scheduleItemsView(
      [
        row({ id: 7, plannedStart: "2026-03-01", plannedFinish: "2026-03-10" }),
        row({ id: 8, plannedStart: "2026-03-01", plannedFinish: "2026-03-10" }),
      ],
      today
    );
    expect(v.rows.map((r) => r.id)).toEqual([7, 8]);
  });
});
