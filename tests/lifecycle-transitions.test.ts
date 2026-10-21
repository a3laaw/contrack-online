/**
 * G7 — الانتقالات الموحدة للحالات (المكتبي unified_cancel_service TRANSITIONS 25–109)
 * بمفردات الويب: الملغى يُسترجع إلى نشط فقط · المغلق/المنتهي نهائيان · لا قفزات عشوائية.
 */

import { describe, expect, test } from "bun:test";
import { canTransition, transitionError, CONTRACT_TRANSITIONS, SUB_CONTRACT_TRANSITIONS } from "../src/lib/lifecycle-transitions";

describe("انتقالات العقد (contract)", () => {
  test("المسودة تتقدم للأمام أو تُلغى", () => {
    expect(canTransition("contract", "مسودة", "نشط")).toBe(true);
    expect(canTransition("contract", "مسودة", "تحت المراجعة")).toBe(true);
    expect(canTransition("contract", "مسودة", "معتمد")).toBe(true);
    expect(canTransition("contract", "مسودة", "ملغى")).toBe(true);
  });

  test("مسودة لا تقفز إلى منتهي أو مغلق", () => {
    expect(canTransition("contract", "مسودة", "منتهي")).toBe(false);
    expect(canTransition("contract", "مسودة", "مغلق")).toBe(false);
  });

  test("نشط: إيقاف/إنهاء/إغلاق/إلغاء — بلا قفز للمسودة", () => {
    expect(canTransition("contract", "نشط", "متوقف")).toBe(true);
    expect(canTransition("contract", "نشط", "منتهي")).toBe(true);
    expect(canTransition("contract", "نشط", "مغلق")).toBe(true);
    expect(canTransition("contract", "نشط", "ملغى")).toBe(true);
    expect(canTransition("contract", "نشط", "مسودة")).toBe(false);
    expect(canTransition("contract", "نشط", "معتمد")).toBe(false);
  });

  test("منتهي → مغلق فقط (لا إلغاء من مكتمل — المكتبي completed→archived)", () => {
    expect(canTransition("contract", "منتهي", "مغلق")).toBe(true);
    expect(canTransition("contract", "منتهي", "ملغى")).toBe(false);
    expect(canTransition("contract", "منتهي", "نشط")).toBe(false);
  });

  test("مغلق نهائي بلا انتقالات (المكتبي مجمّد)", () => {
    for (const to of ["نشط", "ملغى", "منتهي", "مغلق", "مسودة"]) {
      expect(canTransition("contract", "مغلق", to)).toBe(false);
    }
    expect(CONTRACT_TRANSITIONS["مغلق"]).toEqual([]);
  });

  test("الملغى يُسترجع إلى نشط فقط (المكتبي cancelled→active)", () => {
    expect(canTransition("contract", "ملغى", "نشط")).toBe(true);
    expect(canTransition("contract", "ملغى", "مسودة")).toBe(false);
    expect(canTransition("contract", "ملغى", "منتهي")).toBe(false);
  });

  test("نفس الحالة ليست انتقالًا", () => {
    expect(canTransition("contract", "نشط", "نشط")).toBe(false);
  });
});

describe("انتقالات عقد الباطن (sub_contract)", () => {
  test("نشط: إيقاف/إنهاء/إلغاء", () => {
    expect(canTransition("sub_contract", "نشط", "متوقف")).toBe(true);
    expect(canTransition("sub_contract", "نشط", "منتهي")).toBe(true);
    expect(canTransition("sub_contract", "نشط", "ملغى")).toBe(true);
  });

  test("منتهي نهائي (لا إلغاء من مكتمل)", () => {
    expect(SUB_CONTRACT_TRANSITIONS["منتهي"]).toEqual([]);
    expect(canTransition("sub_contract", "منتهي", "ملغى")).toBe(false);
    expect(canTransition("sub_contract", "منتهي", "نشط")).toBe(false);
  });

  test("الملغى يُسترجع إلى نشط فقط", () => {
    expect(canTransition("sub_contract", "ملغى", "نشط")).toBe(true);
    expect(canTransition("sub_contract", "ملغى", "متوقف")).toBe(false);
  });
});

describe("رسائل الرفض العربية", () => {
  test("حالة نهائية برسالة واضحة", () => {
    expect(transitionError("contract", "مغلق", "نشط")).toContain("نهائية");
  });

  test("انتقال مرفوض يعرض المسموح", () => {
    const msg = transitionError("contract", "مسودة", "منتهي");
    expect(msg).toContain("لا يمكن الانتقال");
    expect(msg).toContain("نشط");
  });
});
