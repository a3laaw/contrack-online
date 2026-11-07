/**
 * اختبار Task 115 — منطق SaaS النقي:
 * الحالة الفعلية للاشتراك (اشتقاق «منتهي»)، حسابات التجديد (بلا فقدان أيام)،
 * والتحقق من مدخلات طلب الانضمام — كلها دوال نقية بلا قاعدة بيانات.
 */

import { describe, expect, test } from "bun:test";
import {
  SAAS_STATUS_LABELS,
  addDays,
  daysLeft,
  effectiveSubscriptionStatus,
  renewEndsAt,
  validateAdminUsername,
  validateRegistrationInput,
} from "@/lib/saas-core";

const NOW = new Date("2026-02-10T12:00:00Z");

describe("effectiveSubscriptionStatus", () => {
  test("بلا صف اشتراك ⇒ none (الشركات اليدوية القديمة)", () => {
    expect(effectiveSubscriptionStatus(null, NOW)).toBe("none");
    expect(effectiveSubscriptionStatus(undefined, NOW)).toBe("none");
  });

  test("التجميد والإلغاء يحتجزان مهما كانت المدة", () => {
    const past = { status: "frozen", endsAt: addDays(NOW, -30) };
    expect(effectiveSubscriptionStatus(past, NOW)).toBe("frozen");
    const cancelled = { status: "cancelled", endsAt: null };
    expect(effectiveSubscriptionStatus(cancelled, NOW)).toBe("cancelled");
  });

  test("تجربة/نشط سارية ⇒ كما هي", () => {
    expect(effectiveSubscriptionStatus({ status: "trial", endsAt: addDays(NOW, 5) }, NOW)).toBe("trial");
    expect(effectiveSubscriptionStatus({ status: "active", endsAt: null }, NOW)).toBe("active"); // دائم
  });

  test("انتهاء المدة ⇒ expired مشتق آليًا (trial وactive سواء)", () => {
    expect(effectiveSubscriptionStatus({ status: "trial", endsAt: addDays(NOW, -1) }, NOW)).toBe("expired");
    expect(effectiveSubscriptionStatus({ status: "active", endsAt: addDays(NOW, -100) }, NOW)).toBe("expired");
  });

  test("حد الانتهاء بالضبط = لم ينتهِ بعد (سقف اليوم)", () => {
    expect(effectiveSubscriptionStatus({ status: "trial", endsAt: NOW }, NOW)).toBe("trial");
  });

  test("الحالة المخزنة غير المعروفة ⇒ none", () => {
    expect(effectiveSubscriptionStatus({ status: "weird", endsAt: null }, NOW)).toBe("none");
  });
});

describe("daysLeft", () => {
  test("null/دائم ⇒ null (∞)", () => {
    expect(daysLeft(null, NOW)).toBeNull();
  });
  test("مستقبل موجب ومنتهٍ سالب", () => {
    expect(daysLeft(addDays(NOW, 14), NOW)).toBe(14);
    expect(daysLeft(addDays(NOW, -3), NOW)).toBe(-3);
  });
});

describe("renewEndsAt — التجديد بلا فقدان أيام", () => {
  test("تجديد مبكر: يُمدد من نهاية الاشتراك الحالي المستقبلية", () => {
    const end = addDays(NOW, 10);
    expect(renewEndsAt(end, 30, NOW)).toEqual(addDays(end, 30));
  });

  test("تجديد بعد الانتهاء: يبدأ من الآن", () => {
    const end = addDays(NOW, -5);
    expect(renewEndsAt(end, 30, NOW)).toEqual(addDays(NOW, 30));
  });

  test("تجديد بلا نهاية سابقة: من الآن", () => {
    expect(renewEndsAt(null, 90, NOW)).toEqual(addDays(NOW, 90));
  });
});

describe("validateRegistrationInput", () => {
  const base = {
    companyName: "شركة الأمل",
    contactName: "أحمد",
    phone: "+9651234567",
    email: "a@b.com",
    activity: "مقاولات",
    requestedUsername: "amal_admin",
    password: "secret123",
  };

  test("مدخلات سليمة ⇒ null", () => {
    expect(validateRegistrationInput(base)).toBeNull();
  });

  test("اسم الشركة قصير", () => {
    expect(validateRegistrationInput({ ...base, companyName: "ش" })).toContain("اسم الشركة");
  });

  test("مسؤول التواصل مطلوب", () => {
    expect(validateRegistrationInput({ ...base, contactName: "  " })).toContain("التواصل");
  });

  test("هاتف غير صالح", () => {
    expect(validateRegistrationInput({ ...base, phone: "123" })).toContain("الهاتف");
  });

  test("بريد غير صالح", () => {
    expect(validateRegistrationInput({ ...base, email: "not-mail" })).toContain("البريد");
  });

  test("اسم مستخدم قصير أو بفراغات", () => {
    expect(validateRegistrationInput({ ...base, requestedUsername: "ab" })).toContain("المستخدم");
    expect(validateRegistrationInput({ ...base, requestedUsername: "ab cd" })).toContain("المستخدم");
  });

  test("كلمة مرور قصيرة", () => {
    expect(validateRegistrationInput({ ...base, password: "123" })).toContain("كلمة المرور");
  });

  test("validateAdminUsername نفس القاعدة", () => {
    expect(validateAdminUsername("admin")).toBeNull();
    expect(validateAdminUsername("ab")).toContain("المستخدم");
    expect(validateAdminUsername("a b")).toContain("المستخدم");
  });
});

describe("تسميات الحالات — عربية كاملة", () => {
  test("كل الحالات الست لها تسمية", () => {
    for (const s of ["trial", "active", "frozen", "cancelled", "expired", "none"] as const) {
      expect(SAAS_STATUS_LABELS[s].length).toBeGreaterThan(0);
    }
  });
});
