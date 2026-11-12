/**
 * اختبار المرحلة 9 — بند 6: الإعدادات بتبويباتها (settings.py كمرجع حرفي).
 * المنطق النقي في settings/tabs-catalog.ts — مرآة SettingsPage._build:
 *   settings.py:508-533  بناء التبويبات حسب الدور (is_admin يشمل المطور —
 *                        auth_service.py:166-168 · is_developer :171-173).
 *   settings.py:1020-1242 أدوات المطور تابات داخلية خمسة بترتيبها الحرفي.
 * الجلسة 12 — قرار المالك: تابا «أنواع العقود» و«مراحل المتابعة» حُذفا من الإعدادات
 *   — موضعُهما الوحيد وحدة «القوائم المرجعية» (انحراف ويب معتمد)، والأقسام القديمة
 *   تُرد للتبويب الافتراضي عبر resolveInitialSection.
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
  TAB_DEVELOPER,
  TAB_SECURITY_ADMIN,
  TAB_SECURITY_SECRETARY,
  TAB_POSTING_RULES,
  TAB_VISITS,
  defaultSettingsTab,
  resolveInitialSection,
  securityTabLabel,
  visibleSettingsTabs,
} from "@/components/contrack/settings/tabs-catalog";

describe("SETTINGS_TABS — التبويبات بترتيب المكتبي وأسمائه الحرفية (settings.py:509-532)", () => {
  test("تسعة تبويبات — الجلسة 12: بلا أنواع العقود ومراحل المتابعة (في «القوائم المرجعية» حصراً — قرار المالك)", () => {
    expect(SETTINGS_TABS.map((t) => t.value)).toEqual([
      "company",
      "companies",
      "appearance",
      "security",
      "boq-docs",
      "visits",
      "posting-rules",
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
    expect(byValue.get("boq-docs")).toBe("▦  جدول الكميات BOQ"); // انحراف ويب معتمد — قرار المالك
    expect(byValue.get("expense-accounts")).toBeUndefined(); // Task 105 — أُسقط مع الشجرة القديمة
    expect(byValue.get("contract-types")).toBeUndefined(); // الجلسة 12 — في «القوائم المرجعية» حصراً
    expect(byValue.get("workflow")).toBeUndefined(); // الجلسة 12 — في «القوائم المرجعية» حصراً
    expect(byValue.get("visits")).toBe("◷  جدول الزيارات");
    expect(byValue.get("posting-rules")).toBe("≡  قواعد الترحيل"); // Task 106
    expect(byValue.get("backup")).toBe("⊞  البيانات والنسخ الاحتياطي");
    expect(byValue.get("developer")).toBe("⚙  أدوات المطور");
  });

  test("بوابات الأدوار: الإدارية adminOnly وأدوات المطور developerOnly", () => {
    const adminOnly = SETTINGS_TABS.filter((t) => t.adminOnly).map((t) => t.value);
    expect(adminOnly).toEqual(["company", "companies", "boq-docs", "visits", "posting-rules", "backup"]);
    // Task 97 — قرار معتمد: الشركات للمطور حصرًا (انحراف ويب موثق عن المكتبي)
    const devOnly = SETTINGS_TABS.filter((t) => t.developerOnly).map((t) => t.value);
    expect(devOnly).toEqual(["companies", "developer"]);
  });
});

describe("visibleSettingsTabs — قواعد الظهور الثلاثة كالمكتبي", () => {
  test("المدير: الإدارية بلا الشركات (Task 97: للمطور حصرًا) وبلا أدوات المطور", () => {
    const tabs = visibleSettingsTabs(true, false);
    expect(tabs.map((t) => t.value)).toEqual([
      "company",
      "appearance",
      "security",
      "boq-docs",
      "visits",
      "posting-rules",
      "backup",
    ]);
  });

  test("المطور: كل التبويبات — is_admin يشمل المطور (auth_service.py:168)", () => {
    const tabs = visibleSettingsTabs(true, true);
    expect(tabs.map((t) => t.value)).toEqual(SETTINGS_TABS.map((t) => t.value));
    expect(tabs.length).toBe(9); // الجلسة 12: 8 إدارية+عامة (بواب BOQ) + أدوات المطور
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
    for (const s of ["company", "appearance", "security", "boq-docs", "visits", "posting-rules"]) {
      expect(resolveInitialSection(s, true, false)).toBe(s);
    }
  });

  test("قسما الأنواع والمراحل القديمان يُردان للتبويب الافتراضي (الجلسة 12 — انتقلا للقوائم المرجعية)", () => {
    expect(resolveInitialSection("contract-types", true, false)).toBe("company");
    expect(resolveInitialSection("workflow", true, false)).toBe("company");
  });

  test("قسم developer يفتح أدوات المطور للمطور فقط ويُرد للمدير والسكرتير", () => {
    expect(resolveInitialSection("developer", true, true)).toBe("developer");
    expect(resolveInitialSection("developer", true, false)).toBe("company"); // تبويب محجوب ⇒ الافتراضي
    expect(resolveInitialSection("developer", false, false)).toBe("appearance");
  });

  test("قسم companies يفتح للإطور فقط ويُرد للمدير (Task 97: عزل الشركات)", () => {
    expect(resolveInitialSection("companies", true, true)).toBe("companies");
    expect(resolveInitialSection("companies", true, false)).toBe("company"); // محجوب للمدير ⇒ الافتراضي
    expect(resolveInitialSection("companies", false, false)).toBe("appearance");
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
  test("كل بند settings في الشل له section يفتح تبويبًا صالحًا لدوره", () => {
    expect(settingsModule).toBeDefined();
    for (const child of settingsModule!.children) {
      if (child.view !== "settings" || !child.section) continue;
      // developerOnly (الشركات/أدوات المطور — الجلسة 14) يُقاس بدور المطور
      const isDev = child.developerOnly === true;
      expect(resolveInitialSection(child.section, true, isDev)).toBe(child.section);
    }
  });

  test("بنود developerOnly تُخفى عن المدير غير المطور وتفتح للمطور (Task 97 + الجلسة 14)", () => {
    const devOnly = settingsModule!.children.filter((c) => c.developerOnly && c.view === "settings");
    expect(devOnly.map((c) => c.section)).toEqual(["companies", "developer"]);
    for (const child of devOnly) {
      // للمدير غير المطور: القسم يرد للتبويب الافتراضي بدل فتح تاب محجوب
      expect(resolveInitialSection(child.section!, true, false)).not.toBe(child.section!);
      // للمطور: يفتح التاب نفسه
      expect(resolveInitialSection(child.section!, true, true)).toBe(child.section!);
    }
  });

  test("بنود الشل غير الإدارية (screen_settings) تصلح للسكرتير أيضًا", () => {
    for (const child of settingsModule!.children) {
      if (child.view !== "settings" || !child.section || child.adminOnly || child.developerOnly) continue;
      expect(resolveInitialSection(child.section, false, false)).toBe(child.section);
    }
  });
});
