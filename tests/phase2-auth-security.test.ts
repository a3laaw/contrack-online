/**
 * اختبارات المرحلة 2 — الأمان والصلاحيات (برومبت مطابقة المكتبي V9.15.19):
 *   أ) حدّ محاولات الدخول: MAX_ATTEMPTS=3 (حرفيًا من ui/login.py) + قفل مؤقت + رسائل عربية.
 *   ب) افتراضيات الأدوار: السكرتير بندًا بندًا (أعلام secretary من PAGE_PERMS المكتبي)
 *      والمدير/المطور الكل — مع مواءمة موثقة للمفاتيح.
 * التشغيل: bun test tests/phase2-auth-security.test.ts
 */
import { describe, expect, test } from "bun:test";
import {
  MAX_ATTEMPTS,
  LOCK_MS,
  attemptKey,
  clearAttempts,
  lockState,
  registerFailedAttempt,
} from "../src/lib/login-rate-limit";
import { PERMISSIONS, roleDefaultAllowed } from "../src/lib/permissions-catalog";

// ============================================================
// 1) حدّ المحاولات — سلوك المكتبي (3 محاولات) مع قفل مؤقت
// ============================================================
describe("حدّ محاولات الدخول (المرحلة 2/أ)", () => {
  test("MAX_ATTEMPTS = 3 مطابق للمكتبي ui/login.py:19", () => {
    expect(MAX_ATTEMPTS).toBe(3);
  });

  test("المحاولتان الأوليان تُرجعان متبقيًا متناقصًا ثم الثالثة تقفل", () => {
    const key = attemptKey("tester-a", "1.2.3.4");
    clearAttempts(key);
    expect(registerFailedAttempt(key)).toEqual({ remaining: 2, lockedNow: false });
    expect(registerFailedAttempt(key)).toEqual({ remaining: 1, lockedNow: false });
    const third = registerFailedAttempt(key);
    expect(third.lockedNow).toBe(true);
    expect(third.remaining).toBe(0);
  });

  test("بعد القفل: lockState يرجع مقفولًا مع ثوانٍ متبقية", () => {
    const key = attemptKey("tester-b", "1.2.3.4");
    clearAttempts(key);
    for (let i = 0; i < MAX_ATTEMPTS; i++) registerFailedAttempt(key);
    const st = lockState(key);
    expect(st.locked).toBe(true);
    expect(st.retryAfterSec).toBeGreaterThan(0);
    expect(st.retryAfterSec).toBeLessThanOrEqual(LOCK_MS / 1000);
  });

  test("نجاح الدخول يصفر المحاولات (clearAttempts)", () => {
    const key = attemptKey("tester-c", "5.6.7.8");
    clearAttempts(key);
    registerFailedAttempt(key);
    registerFailedAttempt(key);
    clearAttempts(key);
    expect(lockState(key).locked).toBe(false);
    const again = registerFailedAttempt(key);
    expect(again).toEqual({ remaining: 2, lockedNow: false });
  });

  test("مفاتيح مختلفة (مستخدم/IP) معزولة عن بعضها", () => {
    const k1 = attemptKey("tester-d", "9.9.9.9");
    const k2 = attemptKey("tester-d", "8.8.8.8");
    const k3 = attemptKey("tester-e", "9.9.9.9");
    clearAttempts(k1);
    clearAttempts(k2);
    clearAttempts(k3);
    registerFailedAttempt(k1);
    expect(lockState(k2).locked).toBe(false);
    expect(lockState(k3).locked).toBe(false);
  });
});

// ============================================================
// 2) افتراضيات الأدوار — السكرتير بندًا بندًا كالمكتبي
// ============================================================
describe("افتراضيات الصلاحيات (المرحلة 2/ب/ج)", () => {
  test("المدير والمطور: الكل دائمًا (كالمكتبي role_perm_defaults)", () => {
    for (const p of PERMISSIONS) {
      expect(roleDefaultAllowed("admin", p.key)).toBe(true);
      expect(roleDefaultAllowed("developer", p.key)).toBe(true);
    }
  });

  test("السكرتير: الممنوعات المكتبية (secretary:false) من固定ة", () => {
    const denied = PERMISSIONS.filter((p) => !p.secretary).map((p) => p.key);
    // عيّنة من الممنوع على السكرتير كالمكتبي حرفيًا:
    for (const k of [
      "screen_gateway",
      "screen_clearing",
      "report_customers_balances",
      "report_customer_profitability",
      "report_cashflow",
      "report_journal",
      "action_cancel_voucher",
      "action_view_financial",
      "action_delete",
      "action_supervision_waive",
      "action_form_design",
      "action_change_status",
      "action_add_subcontractor",
    ]) {
      expect(denied).toContain(k);
      expect(roleDefaultAllowed("secretary", k)).toBe(false);
    }
  });

  test("السكرتير: المسموحات المكتبية (secretary:true) ثابتة", () => {
    for (const k of [
      "screen_customers",
      "screen_subcontractors",
      "screen_vouchers",
      "screen_visits",
      "screen_statement",
      "screen_reports",
      "screen_followup",
      "screen_settings",
      "screen_claims",
      "report_supervision_delays",
      "report_subcontractors",
      "report_contracts",
      "report_execution",
      "report_prospects",
      "action_add_voucher",
      "action_edit_voucher",
      "action_whatsapp",
      "action_print_statement",
    ]) {
      expect(roleDefaultAllowed("secretary", k)).toBe(true);
    }
  });

  test("مفتاح مجهول لا يُقيّد السكرتير (كالمصدر)", () => {
    expect(roleDefaultAllowed("secretary", "key_does_not_exist")).toBe(true);
  });

  test("كل مفاتيح الكتالوج تحمل علم secretary صريحًا (لا غموض)", () => {
    for (const p of PERMISSIONS) {
      expect(typeof p.secretary).toBe("boolean");
    }
  });

  test("المفاتيح الـ16 المطلوب إضافتها موجودة في الكتالوج", () => {
    const keys = new Set(PERMISSIONS.map((p) => p.key));
    for (const k of [
      "screen_statement",
      "screen_reports",
      "screen_followup",
      "screen_settings",
      "screen_claims",
      "screen_forms",
      "screen_receipts",
      "screen_payments",
      "report_customer_profitability",
      "action_print_statement",
      "action_view_financial",
      "action_whatsapp",
      "action_delete",
      "action_supervision_waive",
      "action_form_design",
      "action_change_status",
      "action_edit_voucher",
      "action_add_subcontractor",
    ]) {
      expect(keys.has(k)).toBe(true);
    }
  });
});
