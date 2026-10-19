/**
 * اختبار المرحلة 7-ب — لوحة «🔄 مرحلة التنفيذ» في تفاصيل العقد
 * قفل المنطق النقي المطابق للمكتبي V9.15.18 (followup.py):
 *   :771/:780  _path_badge  → «🔧 مسار يدوي · » / «📏 مسار إجباري · »
 *   :1063      نسبة الدفع على الشريحة (%g — بلا أصفار زائدة)
 *   :726–746   الشارة الصغيرة لآخر ملاحظة (اقتطاع 42 حرفًا + «…»)
 *   :1301–1324 سجل المراحل — «{YYYY-MM-DD HH:mm} — {الوصف} · {المستخدم}»
 *   workflow_service.revert_contract_stage → من الحالية إلى آخر مكتملة غير متخطاة
 * الدوال كلها نقية — بلا قاعدة بيانات.
 */

import { describe, expect, test } from "bun:test";
import {
  formatStageHistoryLine,
  noteChip,
  pathPrefix,
  pctSuffix,
  resolveRevert,
} from "@/lib/stage-panel";

describe("pathPrefix — شارة المسار (followup.py:765 _path_badge)", () => {
  test("اليدوي 🔧 والإجباري 📏 بالنص الحرفي مع الفاصل « · »", () => {
    expect(pathPrefix(true)).toBe("🔧 مسار يدوي · ");
    expect(pathPrefix(false)).toBe("📏 مسار إجباري · ");
  });
});

describe("pctSuffix — لاحقة نسبة الدفع على الشريحة (followup.py:1063)", () => {
  test("صفر أو سالب ⇒ نص فارغ", () => {
    expect(pctSuffix(0)).toBe("");
    expect(pctSuffix(-5)).toBe("");
  });
  test("صحيح موجب بلا كسور ⇒ « · 25%»", () => {
    expect(pctSuffix(25)).toBe(" · 25%");
  });
  test("كسري يُقتطع من أصفاره: 7.5 و25.5 و10.0", () => {
    expect(pctSuffix(7.5)).toBe(" · 7.5%");
    expect(pctSuffix(25.5)).toBe(" · 25.5%");
    expect(pctSuffix(10.0)).toBe(" · 10%");
  });
  test("كسور طويلة تُقرَّب لثلاث خانات بلا أصفار زائدة (روح %g)", () => {
    expect(pctSuffix(33.3333333)).toBe(" · 33.333%");
    expect(pctSuffix(12.5000)).toBe(" · 12.5%");
  });
  test("يقبل سلسلة رقمية كما في ردود الـAPI (Decimal متسلسل نصًا)", () => {
    expect(pctSuffix("25" as unknown as number)).toBe(" · 25%");
    expect(pctSuffix("7.5" as unknown as number)).toBe(" · 7.5%");
  });
});

describe("noteChip — شارة آخر ملاحظة (followup.py:732–735)", () => {
  test("قصيرة (≤42) تمر كما هي مع بادئة 📝", () => {
    expect(noteChip("واقفة عند البلدية")).toBe("📝 واقفة عند البلدية");
    expect(noteChip("ا".repeat(42))).toBe(`📝 ${"ا".repeat(42)}`);
  });
  test("الأطول من 42 تُقتطع إلى 40 + «…» (42 مع علامة الحذف)", () => {
    const long = "ب".repeat(50);
    expect(noteChip(long)).toBe(`📝 ${"ب".repeat(40)}…`);
    expect(noteChip(long).length).toBe(3 + 40 + 1);
  });
  test("يُقتطع بالعرض البصري (code points) لا بايتات UTF-16", () => {
    // 45 حرفًا عربيًا عاديًا — وليس رموزًا مركبة
    const txt = "واقف عند البلدية بانتظار موافقة الإطفاء ورخصة البناء النهائية مساء";
    expect(noteChip(txt)).toBe(`📝 ${txt.slice(0, 40)}…`);
  });
});

describe("formatStageHistoryLine — سجل المراحل (followup.py:1317–1323)", () => {
  test("صيغة المكتبي: {YYYY-MM-DD HH:mm} — {الوصف} · {المستخدم}", () => {
    expect(
      formatStageHistoryLine({
        eventTime: "2026-01-05T09:30:00.000Z",
        description: "أُنهيت مرحلة «الحفر والأساسات» بتاريخ 2026-01-05",
        username: "admin",
      })
    ).toBe("2026-01-05 09:30 — أُنهيت مرحلة «الحفر والأساسات» بتاريخ 2026-01-05 · admin");
  });
  test("يقبل Date كائنًا ويصيغه بالتوقيت المحلي", () => {
    const d = new Date(2026, 0, 5, 9, 30, 0); // محلي
    expect(
      formatStageHistoryLine({ eventTime: d, description: "تم تخطي مرحلة «التسليم»", username: "secretary" })
    ).toBe("2026-01-05 09:30 — تم تخطي مرحلة «التسليم» · secretary");
  });
  test("دقائق وأيام مفردة تُحشى بصفر", () => {
    const d = new Date(2026, 2, 1, 7, 5, 0);
    expect(formatStageHistoryLine({ eventTime: d, description: "س", username: "u" })).toBe(
      "2026-03-01 07:05 — س · u"
    );
  });
});

describe("resolveRevert — التراجع عن مرحلة (workflow_service.revert_contract_stage)", () => {
  const s = (id: number, name: string, sortOrder: number, endDate: string, isSkipped = false) => ({
    id, name, sortOrder, endDate, isSkipped,
  });

  test("من الحالية (بلا نهاية) إلى آخر مكتملة غير متخطاة", () => {
    const stages = [
      s(1, "الحفر", 0, "2026-01-01"),
      s(2, "الأساسات", 1, ""),
      s(3, "الأسقف", 2, ""),
    ];
    expect(resolveRevert(stages)).toEqual({ fromId: 2, fromName: "الأساسات", toId: 1, toName: "الحفر" });
  });

  test("المرحلة المتخطاة لا تُختار وجهةً للعودة", () => {
    const stages = [
      s(1, "الحفر", 0, "2026-01-01"),
      s(2, "الترميم", 1, "2026-01-02", true), // مكتملة لكن متخطاة
      s(3, "الأساسات", 2, "2026-01-03"),
      s(4, "الأسقف", 3, ""),
    ];
    expect(resolveRevert(stages)).toEqual({ fromId: 4, fromName: "الأسقف", toId: 3, toName: "الأساسات" });
  });

  test("بلا مرحلة مكتملة سابقة ⇒ null", () => {
    expect(
      resolveRevert([
        s(1, "الأساسات", 0, "", false), // لم تبدأ
        s(2, "الأسقف", 1, ""),
      ])
    ).toBeNull();
  });

  test("كل المراحل مكتملة (لا جارية) ⇒ null — لا تراجع بلا مرحلة حالية", () => {
    expect(
      resolveRevert([
        s(1, "الحفر", 0, "2026-01-01"),
        s(2, "الأساسات", 1, "2026-01-05"),
      ])
    ).toBeNull();
  });

  test("مسار فارغ ⇒ null", () => {
    expect(resolveRevert([])).toBeNull();
  });

  test("المتخطاة الحالية تُعد «من» إن لم تُنهَ — والوجهة آخر مكتملة قبلها", () => {
    const stages = [
      s(1, "الحفر", 0, "2026-01-01"),
      s(2, "الأساسات", 1, "2026-01-04"),
      s(3, "التسليم", 2, "", true), // متخطاة ولم تُنهَ بالتاريخ
    ];
    expect(resolveRevert(stages)).toEqual({ fromId: 3, fromName: "التسليم", toId: 2, toName: "الأساسات" });
  });

  test("الترتيب بالـsortOrder لا بترتيب الإدخال", () => {
    const stages = [
      s(3, "الأسقف", 2, ""),
      s(1, "الحفر", 0, "2026-01-01"),
      s(2, "الأساسات", 1, ""),
    ];
    expect(resolveRevert(stages)).toEqual({ fromId: 2, fromName: "الأساسات", toId: 1, toName: "الحفر" });
  });

  test("نفس الـsortOrder: الأصغر id قبله", () => {
    const stages = [
      s(7, "أ", 5, "2026-01-01"),
      s(8, "ب", 5, ""),
    ];
    expect(resolveRevert(stages)).toEqual({ fromId: 8, fromName: "ب", toId: 7, toName: "أ" });
  });
});
