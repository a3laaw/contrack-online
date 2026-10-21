/**
 * G1 — كشف الرصيد الجاري اليومي للشركة الأخرى
 * متجه الاختبار الذهبي من المكتبي V9.15.19 (tests/test_v9_15_19_running_statement.py):
 *   الافتتاحي O=1000 · عمولة بوابة T=0.5 لكل عملية · بوابة U بلا عمولة
 *   يوم 09-10 دخل 149.5 (99.5+50) · يوم 09-12 دفعنا 40 · يوم 09-15 دخل 199.5 · يوم 09-16 دفعنا 30
 *   النهاية 1279 · الفترة 09-15→09-16: سابق 1109.5 · نهاية 1279
 * استبعاد غير المؤهَّل (غير موزَّع / gwPaid=0) يحدث في SQL عبر DUES_ELIGIBLE —
 * هنا تُمرَّر الصفوف المؤهَّلة فقط إلى النواة النقية (netInByDay + computeRunningStatement).
 */

import { describe, expect, test } from "bun:test";
import {
  computeRunningStatement,
  netInByDay,
  sumByDay,
} from "../src/lib/other-running-core";
import { r3 } from "../src/lib/contrack-core";

// ===== بناء متجه الاختبار الذهبي =====
const FEES = new Map<string, number>([
  ["T", 0.5],
  ["U", 0],
]);

/** الصفوف المؤهَّلة فقط (A3 غير الموزَّعة وB2 بـgwPaid=0 مستبعدة كأن SQL استبعدتها) */
const ELIGIBLE_OPS = [
  { opDate: "2026-09-10", gateway: "T", amount: 100 }, // A1
  { opDate: "2026-09-15", gateway: "T", amount: 200 }, // A2
  { opDate: "2026-09-10", gateway: "U", amount: 50 }, // B1
];

const TRANSFER_ROWS = [
  { day: "2026-09-12", amount: 40 },
  { day: "2026-09-16", amount: 30 },
];

function buildCore(d1: string) {
  const inByDay = netInByDay(ELIGIBLE_OPS, FEES);
  const outByDay = sumByDay(TRANSFER_ROWS);
  return computeRunningStatement({ openingAmount: 1000, d1, inByDay, outByDay });
}

describe("netInByDay — داخل الأخرى بالصافي لكل يوم (المكتبي _other_in_by_day)", () => {
  test("عمولة البوابة الثابتة تُخصم من كل عملية (100 − 0.5 = 99.5)", () => {
    const m = netInByDay([ELIGIBLE_OPS[0]], FEES);
    expect(m.get("2026-09-10")).toBe(99.5);
  });

  test("بوابة بلا عمولة تمر كما هي (U: 50)", () => {
    const m = netInByDay([ELIGIBLE_OPS[2]], FEES);
    expect(m.get("2026-09-10")).toBe(50);
  });

  test("تجميع عدة بوابات في نفس اليوم: 99.5 + 50 = 149.5", () => {
    const m = netInByDay(ELIGIBLE_OPS, FEES);
    expect(m.get("2026-09-10")).toBe(149.5);
  });

  test("يوم 09-15: 200 − 0.5 = 199.5", () => {
    const m = netInByDay(ELIGIBLE_OPS, FEES);
    expect(m.get("2026-09-15")).toBe(199.5);
  });

  test("الكسور ثلاثية الخانات (r3) — 10.3335 − 0.5 تُقرَّب إلى 3 خانات", () => {
    const m = netInByDay([{ opDate: "2026-09-01", gateway: "T", amount: 10.3335 }], FEES);
    expect(m.get("2026-09-01")).toBe(r3(10.3335 - 0.5));
  });

  test("بوابة مجهولة = بلا عمولة (سقوط آمن)", () => {
    const m = netInByDay([{ opDate: "2026-09-01", gateway: "", amount: 25 }], FEES);
    expect(m.get("2026-09-01")).toBe(25);
  });

  test("إدخال فارغ ⇒ خريطة فارغة", () => {
    expect(netInByDay([], FEES).size).toBe(0);
  });

  test("يوم صافيه صفر يبقى موجودًا — بلا تجاوز (مطابق للمكتبي: فلا يضيع أي يوم)", () => {
    const m = netInByDay([{ opDate: "2026-09-02", gateway: "T", amount: 0.5 }], FEES);
    expect(m.has("2026-09-02")).toBe(true);
    expect(m.get("2026-09-02")).toBe(0);
  });
});

describe("computeRunningStatement — الكشف الجاري (المكتبي other_running_statement)", () => {
  const full = buildCore("2000-01-01");

  test("الرصيد السابق = الافتتاحي حين لا شيء قبل بداية الفترة (1000)", () => {
    expect(full.prior).toBe(1000);
  });

  test("عدد الأيام = اتحاد أيام الدخل والخروج (4 أيام)", () => {
    expect(full.days.length).toBe(4);
  });

  test("ترتيب الأيام تصاعديًا", () => {
    expect(full.days.map((d) => d.day)).toEqual(["2026-09-10", "2026-09-12", "2026-09-15", "2026-09-16"]);
  });

  test("يوم 09-10: دخل 149.5 · الجاري 1149.5", () => {
    expect(full.days[0]).toEqual({ day: "2026-09-10", in: 149.5, out: 0, balance: 1149.5 });
  });

  test("يوم 09-12: دفعنا 40 · الجاري 1109.5", () => {
    expect(full.days[1]).toEqual({ day: "2026-09-12", in: 0, out: 40, balance: 1109.5 });
  });

  test("يوم 09-15: دخل 199.5 · الجاري 1309.0", () => {
    expect(full.days[2]).toEqual({ day: "2026-09-15", in: 199.5, out: 0, balance: 1309 });
  });

  test("يوم 09-16: دفعنا 30 · الجاري 1279.0", () => {
    expect(full.days[3]).toEqual({ day: "2026-09-16", in: 0, out: 30, balance: 1279 });
  });

  test("إجمالي الدخل 349", () => {
    expect(full.totalIn).toBe(349);
  });

  test("إجمالي الخروج 70", () => {
    expect(full.totalOut).toBe(70);
  });

  test("النهاية = المتبقي = 1279 (يطابق other_external_report عند date_to حقيقي)", () => {
    expect(full.end).toBe(1279);
  });

  test("صف السابق أول الأيام — الجاري الأول يبدأ من prior + أول داخل", () => {
    expect(full.days[0].balance).toBe(r3(full.prior + full.days[0].in - full.days[0].out));
  });

  test("الجاري التالي يبنى على سابقه (سلسلة كاملة)", () => {
    for (let i = 1; i < full.days.length; i++) {
      const prev = full.days[i - 1];
      const cur = full.days[i];
      expect(cur.balance).toBe(r3(prev.balance + cur.in - cur.out));
    }
  });
});

describe("computeRunningStatement — فترة جزئية 09-15 → 09-16", () => {
  const part = buildCore("2026-09-15");

  test("السابق 1109.5 (1000 + داخل قبلها 149.5 − دفعنا قبلها 40)", () => {
    expect(part.prior).toBe(1109.5);
  });

  test("أيام الفترة فقط (يومان بلا 09-10 و09-12)", () => {
    expect(part.days.map((d) => d.day)).toEqual(["2026-09-15", "2026-09-16"]);
  });

  test("دخل الفترة 199.5 · خروجها 30", () => {
    expect(part.totalIn).toBe(199.5);
    expect(part.totalOut).toBe(30);
  });

  test("النهاية 1279 — مطابقة للفترة الكاملة", () => {
    expect(part.end).toBe(1279);
  });
});

describe("computeRunningStatement — حالات حدّية", () => {
  test("بلا أيام ⇒ السابق = النهاية = الافتتاحي", () => {
    const r = computeRunningStatement({ openingAmount: 500, d1: "2026-01-01", inByDay: new Map(), outByDay: new Map() });
    expect(r.prior).toBe(500);
    expect(r.end).toBe(500);
    expect(r.days.length).toBe(0);
    expect(r.totalIn).toBe(0);
    expect(r.totalOut).toBe(0);
  });

  test("الخروج الأكبر من الدخل يجعل الرصيد سالبًا ويبقى في السلسلة", () => {
    const r = computeRunningStatement({
      openingAmount: 10,
      d1: "2026-01-01",
      inByDay: sumByDay([{ day: "2026-01-02", amount: 5 }]),
      outByDay: sumByDay([{ day: "2026-01-03", amount: 20 }]),
    });
    expect(r.days[1].balance).toBe(-5);
    expect(r.end).toBe(-5);
  });

  test("دخل وخروج في نفس اليوم = صف واحد بالاثنين", () => {
    const r = computeRunningStatement({
      openingAmount: 0,
      d1: "2026-01-01",
      inByDay: sumByDay([{ day: "2026-01-05", amount: 100 }]),
      outByDay: sumByDay([{ day: "2026-01-05", amount: 30 }]),
    });
    expect(r.days.length).toBe(1);
    expect(r.days[0]).toEqual({ day: "2026-01-05", in: 100, out: 30, balance: 70 });
  });

  test("السابق يستبعد أيام d1 نفسها وما بعدها (قبل الفترة حصرًا)", () => {
    const r = computeRunningStatement({
      openingAmount: 0,
      d1: "2026-01-10",
      inByDay: sumByDay([
        { day: "2026-01-09", amount: 10 },
        { day: "2026-01-10", amount: 90 },
      ]),
      outByDay: new Map(),
    });
    expect(r.prior).toBe(10);
    expect(r.days[0].in).toBe(90);
    expect(r.end).toBe(100);
  });

  test("تقريب ثلاثي الخانات يمتد على سلسلة الجاري كاملة", () => {
    const r = computeRunningStatement({
      openingAmount: 0.001,
      d1: "2026-01-01",
      inByDay: sumByDay([{ day: "2026-01-01", amount: 0.0015 }]),
      outByDay: sumByDay([{ day: "2026-01-02", amount: 0.0004 }]),
    });
    expect(r.days[0].balance).toBe(r3(0.001 + 0.0015));
    expect(Number.isInteger(r.days[0].balance * 1000)).toBe(true);
  });
});
