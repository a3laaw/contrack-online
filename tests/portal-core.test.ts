/**
 * portal-core.test.ts — اختبارات نواة ر5 «بوابة العميل — رابط الكشف المؤقت الآمن» النقية
 * (docs/customer-portal-design.md §4/§8):
 * • التوليد والهاش الحتمي (د1) · الصلاحية والإبطال والانتهاء (د2/د3)
 * • الرفض العام الموحد (د4) · شارات الحالة (د3) · حد الطلبات (د6)
 */
import { describe, expect, test } from "bun:test";

import {
  PORTAL_DEFAULT_DAYS,
  PORTAL_GENERIC_REJECT,
  PORTAL_IP_FAIL_RATE_PER_HOUR,
  PORTAL_LINK_CHOICES,
  PORTAL_LINK_STATUSES,
  PORTAL_TOKEN_RATE_PER_HOUR,
  isPortalLinkDays,
} from "../src/lib/portal-constants";
import {
  PORTAL_CHOICES_COUNT,
  PORTAL_STATUS_COUNT,
  PORTAL_TOKEN_LENGTH,
  RateWindowStore,
  checkRateWindow,
  generatePortalToken,
  hashPortalToken,
  portalLinkExpiry,
  portalLinkStatus,
  portalStatementUrl,
  validatePortalToken,
} from "../src/lib/portal-core";

/* ==================== د1 — الرمز والهاش ==================== */

describe("توليد الرمز والهاش (د1)", () => {
  test("الرمز base64url بطول 43 بلا محارف +/= — والهاش 64 hex", () => {
    const { token, tokenHash } = generatePortalToken();
    expect(token.length).toBe(PORTAL_TOKEN_LENGTH);
    expect(token).not.toMatch(/[+/=]/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("الهاش حتمي — نفس الرمز يعطي نفس الهاش دائمًا", () => {
    const token = "AbCdEf0123456789AbCdEf0123456789AbCdEf0123456789";
    expect(hashPortalToken(token)).toBe(hashPortalToken(token));
  });

  test("رمزان متتاليان مختلفان (إنتروبيا) وهاشان مختلفان", () => {
    const a = generatePortalToken();
    const b = generatePortalToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  test("الرمز يُخزَّن هاشًا لا صريحًا — الهاش لا يحتوي الرمز", () => {
    const { token, tokenHash } = generatePortalToken();
    expect(tokenHash.includes(token)).toBe(false);
    expect(token.includes(tokenHash)).toBe(false);
  });
});

/* ==================== د2/د3 — الصلاحية والإبطال ==================== */

describe("حكم الصلاحية (د2/د3)", () => {
  const row = (over: Partial<{ expiresAt: Date | string; revokedAt: Date | string | null }> = {}) => ({
    tokenHash: "x".repeat(64),
    customerId: 7,
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    revokedAt: null,
    ...over,
  });

  test("رمز سليم → ok", () => {
    expect(validatePortalToken(row(), new Date("2029-01-01T00:00:00.000Z"))).toEqual({ ok: true });
  });

  test("صف مفقود → not_found", () => {
    expect(validatePortalToken(null)).toEqual({ ok: false, reason: "not_found" });
  });

  test("منتهٍ → expired", () => {
    const v = validatePortalToken(row({ expiresAt: "2025-01-01T00:00:00.000Z" }), new Date("2025-01-02T00:00:00.000Z"));
    expect(v).toEqual({ ok: false, reason: "expired" });
  });

  test("الحد لحظة الانتهاء نفسها → expired (بلا رحمة للحد)", () => {
    const t = new Date("2025-06-01T12:00:00.000Z");
    expect(validatePortalToken(row({ expiresAt: t }), t)).toEqual({ ok: false, reason: "expired" });
  });

  test("مبطول → revoked — حتى لو كانت الصلاحية سارية", () => {
    const v = validatePortalToken(row({ revokedAt: "2026-01-01T00:00:00.000Z" }), new Date("2026-02-01T00:00:00.000Z"));
    expect(v).toEqual({ ok: false, reason: "revoked" });
  });

  test("الإبطال يسبق الانتهاء في ترتيب الفحص", () => {
    const v = validatePortalToken(
      row({ expiresAt: "2025-01-01T00:00:00.000Z", revokedAt: "2026-01-01T00:00:00.000Z" }),
      new Date("2026-02-01T00:00:00.000Z")
    );
    expect(v).toEqual({ ok: false, reason: "revoked" });
  });

  test("تاريخ صيغته فاسدة → expired (فشل آمن)", () => {
    expect(validatePortalToken(row({ expiresAt: "not-a-date" }))).toEqual({ ok: false, reason: "expired" });
  });
});

describe("مدد الصلاحية (د2)", () => {
  test("الاختيارات 30/90/365 والافتراضي 90", () => {
    expect(PORTAL_LINK_CHOICES).toEqual([30, 90, 365]);
    expect(PORTAL_DEFAULT_DAYS).toBe(90);
    expect(PORTAL_CHOICES_COUNT).toBe(3);
  });

  test("حارس الإدخال يرفض ما خارج القائمة", () => {
    expect(isPortalLinkDays(90)).toBe(true);
    expect(isPortalLinkDays(7)).toBe(false);
    expect(isPortalLinkDays("90")).toBe(false);
    expect(isPortalLinkDays(0)).toBe(false);
  });

  test("حساب الانتهاء: 90 يومًا من اليوم المعطى", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(portalLinkExpiry(90, from).getTime()).toBe(from.getTime() + 90 * 86400_000);
    expect(portalLinkExpiry(30, from).getTime()).toBe(from.getTime() + 30 * 86400_000);
    expect(portalLinkExpiry(365, from).getTime()).toBe(from.getTime() + 365 * 86400_000);
  });
});

/* ==================== د3 — شارات الحالة ==================== */

describe("شارات الحالة (د3)", () => {
  test("المفردات الثلاث مغلقة", () => {
    expect(PORTAL_LINK_STATUSES).toEqual(["نشط", "منتهي", "مبطول"]);
    expect(PORTAL_STATUS_COUNT).toBe(3);
  });

  const base = { expiresAt: new Date("2030-01-01T00:00:00.000Z"), revokedAt: null as Date | string | null };
  test("سليم → نشط · منتهٍ → منتهي · مبطول → مبطول", () => {
    expect(portalLinkStatus(base, new Date("2029-01-01T00:00:00.000Z"))).toBe("نشط");
    expect(portalLinkStatus({ ...base, expiresAt: "2025-01-01T00:00:00.000Z" }, new Date("2025-02-01T00:00:00.000Z"))).toBe("منتهي");
    expect(portalLinkStatus({ ...base, revokedAt: "2026-01-01T00:00:00.000Z" }, new Date("2026-02-01T00:00:00.000Z"))).toBe("مبطول");
  });
});

/* ==================== د4/د6 — الرفض العام وحد الطلبات ==================== */

describe("الرفض العام الموحد (د4) وحد الطلبات (د6)", () => {
  test("رسالة الرفض العامة لا تكشف السبب", () => {
    expect(PORTAL_GENERIC_REJECT).toBe("الرابط غير صالح أو منتهي.");
  });

  test("حدود النافذة: 60 للرمز و10 فاشلة للIP", () => {
    expect(PORTAL_TOKEN_RATE_PER_HOUR).toBe(60);
    expect(PORTAL_IP_FAIL_RATE_PER_HOUR).toBe(10);
  });

  test("فحص النافذة النقّي — الحد نفسه مرفوض (أقل منه حصرًا يمر)", () => {
    expect(checkRateWindow(0, 60)).toBe(true);
    expect(checkRateWindow(59, 60)).toBe(true);
    expect(checkRateWindow(60, 60)).toBe(false);
    expect(checkRateWindow(61, 60)).toBe(false);
  });
});

describe("متجر النوافذ RateWindowStore (د6) — الدورة الكاملة", () => {
  test("10 دفعات → الـ11 يتجاوز الحد (نمط المسار count ثم push)", () => {
    const w = new RateWindowStore(10, 3600_000);
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) {
      expect(w.exceeds("ip", now + i)).toBe(false); // قبل الحد يمر
      w.push("ip", now + i);
    }
    expect(w.count("ip", now + 10)).toBe(10);
    expect(w.exceeds("ip", now + 10)).toBe(true); // الـ11 → 429
  });

  test("المفاتيح مستقلة — فشل IP لا يقيّد IP آخر", () => {
    const w = new RateWindowStore(2, 3600_000);
    w.push("a", 1); w.push("a", 2);
    expect(w.exceeds("a", 3)).toBe(true);
    expect(w.exceeds("b", 3)).toBe(false);
  });

  test("النافذة تنزلق — ما قديم عن الساعة يُنسى", () => {
    const w = new RateWindowStore(2, 3600_000);
    w.push("k", 0); w.push("k", 1);
    expect(w.exceeds("k", 3600_000 + 2)).toBe(false); // الاثنان خارج النافذة
  });

  test("count لمفتاح ميت ينظفه من الذاكرة", () => {
    const w = new RateWindowStore(5, 1000);
    w.push("x", 0);
    expect(w.count("x", 999_999)).toBe(0); // انقضت نوافذه
    expect(w.count("x", 999_999)).toBe(0); // الثاني نظيف أيضًا بلا خطأ
  });
});

/* ==================== د8 — بناء الرابط ==================== */

describe("بناء رابط الكشف (د8)", () => {
  test("من أصل الطلب — مسار المسار العام حصرًا والرمز مُشفَّر مسارًا", () => {
    expect(portalStatementUrl("https://contrack-online.vercel.app", "tok")).toBe(
      "https://contrack-online.vercel.app/api/portal/statement/tok"
    );
    expect(portalStatementUrl("http://localhost:3000", "a+b/c")).toBe(
      "http://localhost:3000/api/portal/statement/a%2Bb%2Fc"
    );
  });
});
