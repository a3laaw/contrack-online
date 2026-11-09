/**
 * اختبارات نواة «رادار مواعيد المهندسين» — البند الرابع NOVA.
 * docs/consulting-radar-design.md — نواة نقية حصرًا (بلا DB): اشتقاق الخانات من
 * إعدادات الدوام، تطبيع مدة الخانة، حاجز الإجازة المعتمدة، وترتيب فحص الحجز.
 */
import { describe, expect, test } from "bun:test";

import {
  checkRadarBooking,
  isEngineerOnLeave,
  isValidRadarSlot,
  normalizeRadarSlotMinutes,
  radarSlotsFromWorkday,
  type RadarLeaveRef,
} from "../src/lib/consulting-radar-core";

const DAY = { start: "08:00", end: "17:00" };

describe("radarSlotsFromWorkday — اشتقاق الخانات من الدوام", () => {
  test("08:00–17:00 بخطوة 60 ⇒ 9 خانات تنتهي 16:00 بلا 17:00", () => {
    const slots = radarSlotsFromWorkday(DAY.start, DAY.end, 60);
    expect(slots).toHaveLength(9);
    expect(slots[0]).toBe("08:00");
    expect(slots[slots.length - 1]).toBe("16:00");
    expect(slots).toEqual(["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);
    expect(slots.includes("17:00")).toBe(false); // الخانة عند ساعة النهاية نفسها مستبعدة
  });

  test("بخطوة 30 ⇒ 18 خانة تنتهي 16:30", () => {
    const slots = radarSlotsFromWorkday(DAY.start, DAY.end, 30);
    expect(slots).toHaveLength(18);
    expect(slots[slots.length - 1]).toBe("16:30");
  });

  test("بخطوة 90 (لا تقسم النطاق) ⇒ 6 خانات تنتهي 15:30 قبل النهاية", () => {
    expect(radarSlotsFromWorkday(DAY.start, DAY.end, 90)).toEqual([
      "08:00",
      "09:30",
      "11:00",
      "12:30",
      "14:00",
      "15:30",
    ]);
  });

  test("نهاية ≤ بداية ⇒ fallback 08:00→17:00 كاملًا", () => {
    const slots = radarSlotsFromWorkday("17:00", "08:00", 60);
    expect(slots[0]).toBe("08:00");
    expect(slots).toHaveLength(9);
    expect(radarSlotsFromWorkday("10:00", "10:00", 60)).toEqual(slots);
  });

  test("نصوص فارغة أو بصيغة خاطئة («7:5») ⇒ fallback 08:00→17:00", () => {
    expect(radarSlotsFromWorkday("", "", 60)).toHaveLength(9);
    expect(radarSlotsFromWorkday("", "", 60)[0]).toBe("08:00");
    expect(radarSlotsFromWorkday("7:5", "17:00", 60)).toEqual(radarSlotsFromWorkday(DAY.start, DAY.end, 60));
    expect(radarSlotsFromWorkday("08:00", "7:5", 60)).toEqual(radarSlotsFromWorkday(DAY.start, DAY.end, 60));
  });
});

describe("normalizeRadarSlotMinutes — تطبيع المدة", () => {
  test("قيمة مسموحة رقمية أو نصية تمر", () => {
    expect(normalizeRadarSlotMinutes(30)).toBe(30);
    expect(normalizeRadarSlotMinutes("60")).toBe(60);
    expect(normalizeRadarSlotMinutes(120)).toBe(120);
  });

  test("غير مسموحة/صفر/غير معرفة ⇒ الافتراضي 60", () => {
    expect(normalizeRadarSlotMinutes(45)).toBe(60);
    expect(normalizeRadarSlotMinutes(0)).toBe(60);
    expect(normalizeRadarSlotMinutes(undefined)).toBe(60);
    expect(normalizeRadarSlotMinutes(null)).toBe(60);
    expect(normalizeRadarSlotMinutes(-15)).toBe(60);
  });
});

describe("isEngineerOnLeave — حاجز الإجازة المعتمدة", () => {
  const leaves: RadarLeaveRef[] = [
    { startDate: "2026-11-20", endDate: "2026-11-22", status: "معتمدة" },
    { startDate: "2026-12-01", endDate: "2026-12-03", status: "معلقة" },
    { startDate: "2026-12-10", endDate: "2026-12-12", status: "مرفوضة" },
  ];

  test("معتمدة تغطي التاريخ ⇒ true — شاملة الطرفين", () => {
    expect(isEngineerOnLeave("2026-11-21", leaves)).toBe(true);
    expect(isEngineerOnLeave("2026-11-20", leaves)).toBe(true); // يوم البداية
    expect(isEngineerOnLeave("2026-11-22", leaves)).toBe(true); // يوم النهاية
  });

  test("معلقة/مرفوضة أو بلا تقاطع ⇒ false", () => {
    expect(isEngineerOnLeave("2026-12-02", leaves)).toBe(false);
    expect(isEngineerOnLeave("2026-12-11", leaves)).toBe(false);
    expect(isEngineerOnLeave("2026-11-30", leaves)).toBe(false);
    expect(isEngineerOnLeave("2026-11-23", leaves)).toBe(false);
  });
});

describe("checkRadarBooking — ترتيب الفحص الصارم", () => {
  const slots = radarSlotsFromWorkday(DAY.start, DAY.end, 60);
  const base = { slot: "09:00", slots, engineerActive: true, onLeave: false, existing: null };

  test("خانة صالحة ومهندس نشط حُرّ ⇒ ok", () => {
    expect(checkRadarBooking(base).ok).toBe(true);
  });

  test("خانة خارج نطاق الدوام (أو بصيغة خاطئة) ⇒ خطأ أولًا", () => {
    expect(checkRadarBooking({ ...base, slot: "06:00" }).error).toBe("الخانة خارج نطاق الدوام");
    expect(checkRadarBooking({ ...base, slot: "9:00" }).error).toBe("الخانة خارج نطاق الدوام");
  });

  test("مهندس غير نشط ⇒ «المهندس غير نشط» بعد فحص الخانة", () => {
    expect(checkRadarBooking({ ...base, engineerActive: false }).error).toBe("المهندس غير نشط");
    // الخانة المئولة تتفوق على النشاط — الترتيب صارم
    expect(checkRadarBooking({ ...base, slot: "06:00", engineerActive: false }).error).toBe("الخانة خارج نطاق الدوام");
  });

  test("إجازة معتمدة ⇒ «المهندس في إجازة معتمدة هذا اليوم»", () => {
    expect(checkRadarBooking({ ...base, onLeave: true }).error).toBe("المهندس في إجازة معتمدة هذا اليوم");
  });

  test("خانة محجوزة ⇒ «الخانة محجوزة» مع من يشغلها — لا خيار force", () => {
    const occupied = checkRadarBooking({ ...base, existing: { customerName: "عميل التحقق", engineerName: "م. أحمد" } });
    expect(occupied.ok).toBe(false);
    expect(occupied.error).toContain("محجوزة");
    expect(occupied.error).toContain("عميل التحقق");
    expect(checkRadarBooking({ ...base, existing: {} }).error).toBe("الخانة محجوزة");
  });
});

describe("isValidRadarSlot — العضوية في خانات النطاق", () => {
  const slots = radarSlotsFromWorkday(DAY.start, DAY.end, 60);
  test("ضمن النطاق ⇒ true وخارجه ⇒ false", () => {
    expect(isValidRadarSlot("08:00", slots)).toBe(true);
    expect(isValidRadarSlot("16:00", slots)).toBe(true);
    expect(isValidRadarSlot("17:00", slots)).toBe(false); // عند النهاية مستبعدة
    expect(isValidRadarSlot("07:00", slots)).toBe(false);
    expect(isValidRadarSlot("09:30", slots)).toBe(false); // ليست على خطوة 60
  });
});
