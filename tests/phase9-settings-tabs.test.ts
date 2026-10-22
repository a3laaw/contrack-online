/**
 * اختبار المرحلة 9 — بند 6: الإعدادات بتبويباتها (settings.py كمرجع حرفي).
 * المنطق النقي في settings/tabs-catalog.ts — مرآة SettingsPage._build:
 *   settings.py:508-533  بناء التبويبات حسب الدور (is_admin يشمل المطور —
 *                        auth_service.py:166-168 · is_developer :171-173).
 *   settings.py:1020-1242 أدوات المطور تابات داخلية خمسة بترتيبها الحرفي.
 * الدوال كلها نقية — بلا قاعدة بيانات ولا React.
 */

import { describe, expect, test } from "bun:test";
import { NAV_MODULES } from "@/components/contrack/nav-structure";
import {
  DEV_DEFAULT_TAB,
  DEV_TABS,
  SETTINGS_TABS,
  TAB_APPEARANCE,
  TAB_BACKUP,
  TAB_COMPANY,
  TAB_CONTRACT_TYPES,
  TAB_DEVELOPER,
  TAB_EXPENSE_ACCOUNTS,
  TAB_SECURITY_ADMIN,
  TAB_SECURITY_SECRETARY,
  TAB_VISITS,
  TAB_WORKFLOW,
  defaultSettingsTab,
  resolveInitialSection,
  securityTabLabel,
  visibleSettingsTabs,
} from "@/components/contrack/settings/tabs-catalog";

describe("SETTINGS_TABS — التسع تبويبات بترتيب المكتبي وأسمائه الحرفية (settings.py:509-532)", () => {
  test("تسع تبويبات: الإدارية الثمانية + أدوات المطور بترتيب _build", () => {
    expect(SETTINGS_TABS.map((t) => t.value)).toEqual([
      "company",
      "companies",
      "appearance",
      "security",
      "contract-types",
      "expense-accounts",
      "workflow",
      "visits",
      "backup",
      "developer",
    ]);
  });

  test("التسميات حرفية حرفًا حرفًا (بالرمز والمسافتين من المصدر المكتبي)", () => {
    const byValue = new Map(SETTINGS_TABS.map((t) => [t.value, t.label]));
    expect(byValue.get("company")).toBe("⌂  بيانات الشركة");
    expect(byValue.get("companies")).toBe("🏢  الشركات"); // Task 85 — SaaS
    expect(byValue.get("appearance")).toBe("▤  الطباعة والعرض");
    expect(byValue.get("security")).toBe("◆  الأمان والمستخدمون");
    expect(byValue.get("contract-types")).toBe("☰  أنواع العقود");
    expect(byValue.get("expense-accounts")).toBe("§  حسابات المصروفات");
    expect(byValue.get("workflow")).toBe("⇄  مراحل المتابعة");
    expect(byValue.get("visits")).toBe("◷  جدول الزيارات");
    expect(byValue.get("backup")).toBe("⊞  البيانات والنسخ الاحتياطي");
    expect(byValue.get("developer")).toBe("⚙  أدوات المطور");
  });

  test("بوابات الأدوار: الإدارية adminOnly وأدوات المطور developerOnly", () => {
    const adminOnly = SETTINGS_TABS.filter((t) => t.adminOnly).map((t) => t.value);
    // المكتبي يحصر هذه الست خلف is_admin (settings.py:508/516/521)
    expect(adminOnly).toEqual(["company", "companies", "contract-types", "expense-accounts", "workflow", "visits", "backup"]);
    const devOnly = SETTINGS_TABS.filter((t) => t.developerOnly).map((t) => t.value);
    expect(devOnly).toEqual(["developer"]);
  });
});

describe("visibleSettingsTabs — قواعد الظهور الثلاثة كالمكتبي", () => {
  test("المدير: الإدارية الثمانية بلا أدوات المطور (is_developer false)", () => {
    const tabs = visibleSettingsTabs(true, false);
    expect(tabs.map((t) => t.value)).toEqual([
      "company",
      "companies",
      "appearance",
      "security",
      "contract-types",
      "expense-accounts",
      "workflow",
      "visits",
      "backup",
    ]);
  });

  test("المطور: كل التسعة — is_admin يشمل المطور (auth_service.py:168)", () => {
    const tabs = visibleSettingsTabs(true, true);
    expect(tabs.map((t) => t.value)).toEqual(SETTINGS_TABS.map((t) => t.value));
    expect(tabs.length).toBe(10); // Task 85: + تاب الشركات
  });

  test("السكرتير: الطباعة والعرض + كلمة المرور فقط بترتيب المكتبي (settings.py:510-515)", () => {
    const tabs = visibleSettingsTabs(false, false);
    expect(tabs.map((t) => t.value)).toEqual(["appearance", "security"]);
    expect(tabs.map((t) => t.label)).toEqual([TAB_APPEARANCE, TAB_SECURITY_SECRETARY]);
  });

  test("تسمية تبويب الأمان تتغير بالدور (◆ الأمان والمستخدمون / ◆ كلمة المرور)", () => {
    expect(securityTabLabel(true)).toBe(TAB_SECURITY_ADMIN);
    expect(securityTabLabel(false)).toBe(TAB_SECURITY_SECRETARY);
    const secAdmin = visibleSettingsTabs(true, false).find((t) => t.value === "security");
    const secSec = visibleSettingsTabs(false, false).find((t) => t.value === "security");
    expect(secAdmin?.label).toBe("◆  الأمان والمستخدمون");
    expect(secSec?.label).toBe("◆  كلمة المرور");
  });

  test("الافتراضي أول تبويب مرئي: بيانات الشركة للإدارة والطباعة للسكرتير", () => {
    expect(defaultSettingsTab(true, false)).toBe("company");
    expect(defaultSettingsTab(true, true)).toBe("company");
    expect(defaultSettingsTab(false, false)).toBe("appearance");
  });
});

describe("resolveInitialSection — قسم الشل إلى تبويب صالح للدور", () => {
  test("أقسام الشل الحقيقية تمر كما هي للمدير", () => {
    for (const s of ["company", "appearance", "security", "contract-types", "expense-accounts", "workflow", "visits"]) {
      expect(resolveInitialSection(s, true, false)).toBe(s);
    }
  });

  test("قسم developer يفتح أدوات المطور للمطور فقط ويُرد للمدير والسكرتير", () => {
    expect(resolveInitialSection("developer", true, true)).toBe("developer");
    expect(resolveInitialSection("developer", true, false)).toBe("company"); // تبويب محجوب ⇒ الافتراضي
    expect(resolveInitialSection("developer", false, false)).toBe("appearance");
  });

  test("قسم إداري لسكرتير يُرد للافتراضي (لا فتح تبويب محجوب)", () => {
    expect(resolveInitialSection("company", false, false)).toBe("appearance");
    expect(resolveInitialSection("backup", false, false)).toBe("appearance");
  });

  test("قسم مجهول/فارغ يُرد للتبويب الافتراضي للدور", () => {
    expect(resolveInitialSection(undefined, true, false)).toBe("company");
    expect(resolveInitialSection("", true, false)).toBe("company");
    expect(resolveInitialSection("قسم_غير_موجود", false, false)).toBe("appearance");
    expect(resolveInitialSection("قسم_غير_موجود", true, true)).toBe("company");
  });
});

describe("DEV_TABS — تابات أدوات المطور الخمسة الداخلية (settings.py:1098-1239)", () => {
  test("خمسة تابات بترتيب المكتبي الحرفي", () => {
    expect(DEV_TABS.map((t) => t.value)).toEqual(["features", "identity", "migration", "network", "cleanup"]);
    expect(DEV_TABS.map((t) => t.label)).toEqual([
      "المزايا",
      "الهوية والترخيص",
      "الترحيل والاستيراد",
      "الشبكة والنسخ",
      "✱ تنظيف البيانات",
    ]);
  });

  test("الافتراضي أول تاب داخلي (المزايا)", () => {
    expect(DEV_DEFAULT_TAB).toBe("features");
  });
});

describe("توافق الشل — كل قسم في بنود الإعدادات (nav-structure) يقود تبويبًا مرئيًا", () => {
  const settingsModule = NAV_MODULES.find((m) => m.id === "settings");
  test("كل بند settings في الشل له section يفتح تبويبًا صالحًا للمدير", () => {
    expect(settingsModule).toBeDefined();
    for (const child of settingsModule!.children) {
      if (child.view !== "settings" || !child.section) continue;
      expect(resolveInitialSection(child.section, true, false)).toBe(child.section);
    }
  });

  test("بنود الشل غير الإدارية (screen_settings) تصلح للسكرتير أيضًا", () => {
    for (const child of settingsModule!.children) {
      if (child.view !== "settings" || !child.section || child.adminOnly) continue;
      expect(resolveInitialSection(child.section, false, false)).toBe(child.section);
    }
  });
});
