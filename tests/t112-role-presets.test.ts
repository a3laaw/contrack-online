/**
 * اختبارات Task 112 — الأدوار المحاسبية الجاهزة + سلامة الكتالوج.
 */
import { describe, expect, test } from "bun:test";
import { ACCOUNTING_ROLE_PRESETS, PERMISSIONS, isSuperRole } from "../src/lib/permissions-catalog";
import { FEATURE_CATALOG, isEffectivelyEnabled, isRawEnabled } from "../src/lib/feature-flags";

describe("الأدوار المحاسبية الجاهزة (Task 112)", () => {
  const catalogKeys = new Set(PERMISSIONS.map((p) => p.key));

  test("كل مفتاح في كل الأدوار موجود في الكتالوج — لا مفاتيح هجائية", () => {
    for (const [role, preset] of Object.entries(ACCOUNTING_ROLE_PRESETS)) {
      for (const k of preset.keys) {
        expect(catalogKeys.has(k)).toBe(true);
        expect(preset.keys.filter((x) => x === k).length).toBe(1); // لا تكرار داخل الدور
      }
    }
  });
  test("ثلاثة أدوار معرفة بتسميات ووصف لكل منها", () => {
    const roles = Object.keys(ACCOUNTING_ROLE_PRESETS);
    expect(roles.sort()).toEqual(["accountant", "auditor", "chief_accountant"].sort());
    for (const preset of Object.values(ACCOUNTING_ROLE_PRESETS)) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.desc.length).toBeGreaterThan(0);
      expect(preset.keys.length).toBeGreaterThan(3);
    }
  });
  test("المراجع بلا إجراءات تعديل — قراءة حصرًا", () => {
    const auditor = ACCOUNTING_ROLE_PRESETS.auditor.keys;
    expect(auditor.some((k) => k.startsWith("action_"))).toBe(false);
    expect(auditor).toContain("screen_ledger");
    expect(auditor).toContain("screen_financial_statements");
  });
  test("المحاسب الرئيسي يشمل الإقفال والتقديم — والمحاسب يبني ولا يعتمد", () => {
    expect(ACCOUNTING_ROLE_PRESETS.chief_accountant.keys).toContain("screen_fiscal_close");
    expect(ACCOUNTING_ROLE_PRESETS.chief_accountant.keys).toContain("screen_zakat_xbrl");
    expect(ACCOUNTING_ROLE_PRESETS.accountant.keys).not.toContain("screen_fiscal_close");
    expect(ACCOUNTING_ROLE_PRESETS.accountant.keys).toContain("screen_journal_entries");
  });
});

describe("إزالة علم التوازي full_accounting (Task 112 — المحاسبة هي النظام)", () => {
  test("المفتاح خارج الكتالوج ولا يظهر للمستخدم — والمراجع القديمة تعامل كمفعّل", () => {
    expect(FEATURE_CATALOG.some((f) => f.key === "full_accounting")).toBe(false);
    expect(isRawEnabled("full_accounting", {})).toBe(true);
    expect(isEffectivelyEnabled("full_accounting", { full_accounting: false })).toBe(true);
  });
  test("بقية الأعلام سليمة (نموذج إزالة انتقائي لا مسح شامل)", () => {
    expect(FEATURE_CATALOG.length).toBeGreaterThan(3);
    expect(FEATURE_CATALOG.some((f) => f.key === "invoices")).toBe(true);
  });
});

describe("حارس الدور الفائق (وضع الاعتماد على الخادم)", () => {
  test("admin/developer فائق — السكرتير لا", () => {
    expect(isSuperRole("admin")).toBe(true);
    expect(isSuperRole("developer")).toBe(true);
    expect(isSuperRole("secretary")).toBe(false);
  });
});
