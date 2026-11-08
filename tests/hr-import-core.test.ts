/**
 * اختبارات نواة HR-2 — محلل بصمة الحضور CSV/TXT النقي.
 * docs/hr-2-design.md §5 — د6/د7: قالب موثق · تسامح الأوقات · دمج البصمات · ترويجة ذكية.
 */
import { describe, expect, test } from "bun:test";
import {
  mergePunches,
  normalizeDateToken,
  normalizeTimeToken,
  parseAttendanceCsv,
} from "../src/lib/hr-import-core";

// ==================== تطبيع الأوقات والتواريخ ====================

describe("normalizeTimeToken", () => {
  test("أرقام مفردة تُكمل صفرًا", () => {
    expect(normalizeTimeToken("8:5")).toBe("08:05");
    expect(normalizeTimeToken("9:00")).toBe("09:00");
  });

  test("صيغة كاملة تبقى كما هي", () => {
    expect(normalizeTimeToken("08:05")).toBe("08:05");
    expect(normalizeTimeToken("17:30")).toBe("17:30");
  });

  test("غير الصالح ⇒ فارغ", () => {
    expect(normalizeTimeToken("24:00")).toBe("");
    expect(normalizeTimeToken("12:60")).toBe("");
    expect(normalizeTimeToken("باطل")).toBe("");
    expect(normalizeTimeToken("")).toBe("");
  });
});

describe("normalizeDateToken", () => {
  test("شرطة وشرطة مائلة", () => {
    expect(normalizeDateToken("2026-11-08")).toBe("2026-11-08");
    expect(normalizeDateToken("2026/11/8")).toBe("2026-11-08");
  });

  test("شهر/يوم غير منطقي ⇒ فارغ", () => {
    expect(normalizeDateToken("2026-13-01")).toBe("");
    expect(normalizeDateToken("2026-00-10")).toBe("");
  });

  test("صيغ أخرى مرفوضة (لا تخمين اتجاهات)", () => {
    expect(normalizeDateToken("08/11/2026")).toBe("");
    expect(normalizeDateToken("20261108")).toBe("");
  });
});

// ==================== دمج البصمات ====================

describe("mergePunches — دمج الدخول والخروج", () => {
  test("الأبكر دخولًا والأحدث خروجًا — الوسطى تُتجاهل", () => {
    const m = mergePunches(["08:30", "08:05"], ["16:40", "17:00"]);
    expect(m?.checkIn).toBe("08:05");
    expect(m?.checkOut).toBe("17:00");
  });

  test("بصمة دخول فقط", () => {
    const m = mergePunches(["08:05"], []);
    expect(m?.checkIn).toBe("08:05");
    expect(m?.checkOut).toBe("");
  });

  test("بصمة خروج فقط", () => {
    const m = mergePunches([], ["17:00"]);
    expect(m?.checkIn).toBe("");
    expect(m?.checkOut).toBe("17:00");
  });

  test("لا بصمات صالحة ⇒ null", () => {
    expect(mergePunches(["باطل"], [""])).toBeNull();
  });
});

// ==================== تحليل الملف الكامل ====================

describe("parseAttendanceCsv", () => {
  test("قالب كامل بترويجة وفواصل مختلطة", () => {
    const text = [
      "رقم وظيفي,التاريخ,دخول,خروج,دخول2,خروج2",
      "1001,2026-11-01,8:05,17:00",
      "1001;2026-11-02;08:10;16:00;16:45;17:10",
      "1001,2026/11/03,09:30,17:00",
    ].join("\n");
    const r = parseAttendanceCsv(text);
    expect(r.rejected).toHaveLength(0);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toEqual({ line: 2, jobNumber: "1001", workDate: "2026-11-01", checkIn: "08:05", checkOut: "17:00" });
    // دمج: أحدث خروج 17:10
    expect(r.rows[1].checkIn).toBe("08:10");
    expect(r.rows[1].checkOut).toBe("17:10");
    expect(r.rows[2].workDate).toBe("2026-11-03");
  });

  test("أسطر مرفوضة بسبب واضح ورقم سطر", () => {
    const text = [
      "1001,2026-11-01,08:00,17:00",
      "سالم,2026-11-02,08:00,17:00", // رقم وظيفي غير رقمي
      "1001,11-08-2026,08:00,17:00", // تاريخ مرفوض
      "1001,2026-11-03,25:00,17:00", // وقت مرفوض
      "1001,2026-11-04", // بلا أعمدة بصمات
      "1001,2026-11-05,,", // أعمدة كافية لكن بلا أي بصمة
      "", // فارغ يُتخطى
    ].join("\n");
    const r = parseAttendanceCsv(text);
    expect(r.rows).toHaveLength(1);
    expect(r.rejected).toHaveLength(5);
    expect(r.rejected.map((x) => x.line)).toEqual([2, 3, 4, 5, 6]);
    const reasons = r.rejected.map((x) => x.reason).join(" | ");
    expect(reasons).toContain("الرقم الوظيفي");
    expect(reasons).toContain("التاريخ");
    expect(reasons).toContain("وقت");
    expect(reasons).toContain("أعمدة غير كافية");
    expect(reasons).toContain("بلا أي بصمة");
  });

  test("ترويجة إنجليزية تُكتشف وتُتخطى", () => {
    const text = "job,date,in,out\n1001,2026-11-01,08:00,17:00";
    const r = parseAttendanceCsv(text);
    expect(r.rows).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });

  test("بصمة خروج فقط تُقبل (ناقصة تُصحح يدويًا لاحقًا)", () => {
    const text = "1001,2026-11-05,,17:00";
    const r = parseAttendanceCsv(text);
    expect(r.rows[0].checkIn).toBe("");
    expect(r.rows[0].checkOut).toBe("17:00");
  });

  test("نص فارغ ⇒ لا شيء", () => {
    const r = parseAttendanceCsv("");
    expect(r.rows).toHaveLength(0);
    expect(r.rejected).toHaveLength(0);
    expect(r.totalLines).toBe(0);
  });
});
