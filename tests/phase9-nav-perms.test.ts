/**
 * اختبار المرحلة 9 — بند 5: مواءمة الصلاحيات PAGE_PERMS (إخفاء الشل حسب الصلاحية + حرس التنقل)
 * المنطق النقي كله في nav-perms.ts — مرآة المكتبي contrack_v9.15.18 حرفيًا:
 *   auth_service.py:485-501  has_permission: admin/developer دائمًا True ·
 *                            المفاتيح غير المعروفة True (لا تقيّد) ·
 *                            السكرتير تخصيصه المحفوظ وإلا افتراض دوره.
 *   main_window.py:616-632   PAGE_PERMS (14 مدخلًا) ·
 *   main_window.py:782-828   بناء الشل المشروط بhas_permission ·
 *   main_window.py:1961-1988 حرس _navigate برسالة «هذه الشاشة غير متاحة لحسابك.» الحرفية.
 * الدوال كلها نقية — بلا قاعدة بيانات ولا React.
 */

import { describe, expect, test } from "bun:test";
import { PERMISSIONS } from "@/lib/permissions-catalog";
import { NAV_MODULES, REPORT_PERM } from "@/components/contrack/nav-structure";
import {
  NAVIGATE_DENIED_MSG,
  VIEW_PERMS,
  canOpenView,
  isChildVisible,
  permAllows,
  visibleChildren,
} from "@/components/contrack/nav-perms";

const CATALOG_KEYS = new Set(PERMISSIONS.map((p) => p.key));

/** خريطة صلاحيات سكرتير كما يبنيها permsForUser: كل مفاتيح الكتالوج حسب افتراضات دوره */
function secretaryPerms(overrides: Record<string, boolean> = {}): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const p of PERMISSIONS) map[p.key] = p.secretary;
  return { ...map, ...overrides };
}

/** خريطة ممنوع كل شيء — تكشف تجاوز الدور للخريطة (has_permission يفحص الدور أولًا) */
const allDenied: Record<string, boolean> = Object.fromEntries(PERMISSIONS.map((p) => [p.key, false]));

function findChild(id: string) {
  for (const m of NAV_MODULES) {
    const c = m.children.find((x) => x.id === id);
    if (c) return { module: m, child: c };
  }
  throw new Error(`بند غير موجود في nav-structure: ${id}`);
}

describe("permAllows — قاعدة has_permission المكتبي (auth_service.py:485-501)", () => {
  test("الخريطة غير المحمّلة (null/undefined) لا تقيّد — منعًا لوميض الأخفاء قبل /api/auth/me", () => {
    expect(permAllows(null, "screen_receipts")).toBe(true);
    expect(permAllows(undefined, "screen_receipts")).toBe(true);
    expect(permAllows(null, "أي مفتاح")).toBe(true);
  });

  test("المفتاح المجهول لا يقيّد (توافق مع أي استدعاء قديم — سطر :494)", () => {
    expect(permAllows({}, "screen_receipts")).toBe(true);
    expect(permAllows({ screen_customers: true }, "مفتاح_غير_موجود")).toBe(true);
  });

  test("الممنوع صراحةً (false) فقط يُرفض — والمسموح يمر", () => {
    const perms = { screen_receipts: false, screen_customers: true };
    expect(permAllows(perms, "screen_receipts")).toBe(false);
    expect(permAllows(perms, "screen_customers")).toBe(true);
  });

  test("الدور أولًا: المدير/المطور يرى كل شيء حتى لو كانت الخريطة ممنوعة الكل", () => {
    expect(permAllows(allDenied, "screen_receipts", true)).toBe(true);
    expect(permAllows(allDenied, "screen_settings", true)).toBe(true);
    expect(permAllows(null, "screen_receipts", true)).toBe(true);
  });
});

describe("visibleChildren — فلتر الشل (نقل من AppShell بلا تغيير سلوك)", () => {
  const accounting = NAV_MODULES.find((m) => m.id === "accounting")!;
  const flagOnTrue = () => true;

  test("سكرتير بافتراضيات دوره يرى محاسبة كاملة", () => {
    const perms = secretaryPerms();
    const kids = visibleChildren(accounting, false, flagOnTrue, (k) => permAllows(perms, k));
    expect(kids.map((c) => c.id)).toContain("vouchers-receipt");
    expect(kids.map((c) => c.id)).toContain("vouchers-payment");
  });

  test("سكرتير منوعٍ منه screen_receipts ⇒ «سندات القبض» تُخفى و«سندات الصرف» تبقى (main_window.py:782-787)", () => {
    const perms = secretaryPerms({ screen_receipts: false });
    const kids = visibleChildren(accounting, false, flagOnTrue, (k) => permAllows(perms, k));
    const ids = kids.map((c) => c.id);
    expect(ids).not.toContain("vouchers-receipt");
    expect(ids).toContain("vouchers-payment");
    // بقية البنود ظاهرة — المفتاح المجهول لا يخفي شيئًا
    expect(ids).toContain("statement");
    expect(ids).toContain("custody");
    expect(ids).toContain("claims");
  });

  test("المدير يرى كل شيء حتى مع خريطة ممنوعة الكل (الدور أولًا)", () => {
    const kids = visibleChildren(accounting, true, flagOnTrue, (k) => permAllows(allDenied, k, true));
    expect(kids.length).toBe(accounting.children.length);
  });

  test("ميزة مطفأة تُخفي بندًا (statement=false يخفي كشف الحساب) والمفعّلة تبقيه", () => {
    const perms = secretaryPerms();
    const off = visibleChildren(accounting, false, (f) => f !== "statement", (k) => permAllows(perms, k));
    expect(off.map((c) => c.id)).not.toContain("statement");
    const on = visibleChildren(accounting, false, flagOnTrue, (k) => permAllows(perms, k));
    expect(on.map((c) => c.id)).toContain("statement");
  });

  test("adminOnly يُخفى عن غير المدير ويظهر للمدير (users وbackup وdevtools)", () => {
    const settings = NAV_MODULES.find((m) => m.id === "settings")!;
    const perms = secretaryPerms();
    forSecretary: {
      const kids = visibleChildren(settings, false, flagOnTrue, (k) => permAllows(perms, k));
      const ids = kids.map((c) => c.id);
      expect(ids).not.toContain("users");
      expect(ids).not.toContain("backup");
      expect(ids).not.toContain("devtools");
      expect(ids).toContain("settings-printing"); // صلاحية screen_settings الافتراضية للسكرتير
      break forSecretary;
    }
    const kidsAdmin = visibleChildren(settings, true, flagOnTrue, (k) => permAllows(allDenied, k, true));
    const idsAdmin = kidsAdmin.map((c) => c.id);
    expect(idsAdmin).toContain("users");
    expect(idsAdmin).toContain("backup");
    expect(idsAdmin).toContain("devtools");
  });

  test("وحدة تصير بلا بنود مرئية تُسقط كليًا من الشل (البوابة الافتراضية ممنوعة على السكرتير)", () => {
    // screen_gateway: secretary=false في الكتالوج ⇒ بند بوابة الدفع مخفي افتراضيًا عن السكرتير
    const perms = secretaryPerms();
    const gatewayChild = findChild("gateway");
    const kids = visibleChildren(gatewayChild.module, false, flagOnTrue, (k) => permAllows(perms, k));
    expect(kids.map((c) => c.id)).not.toContain("gateway");
  });

  test("تقارير: منع report_vouchers يخفي تقرير الإيرادات والمصروفات وحده (المفاتيح الأغنى للويب)", () => {
    const reports = NAV_MODULES.find((m) => m.id === "reports")!;
    const perms = secretaryPerms({ report_vouchers: false });
    const kids = visibleChildren(reports, false, flagOnTrue, (k) => permAllows(perms, k));
    const ids = kids.map((c) => c.id);
    expect(ids).not.toContain("report-vouchers");
    expect(ids).toContain("report-stage-dues");
    // افتراضيات السكرتير المكتبية تخفي 4 تقارير أصلًا (secretary=false في الكتالوج):
    // العملاء والأرصدة · الإيرادات (المنعة هنا) · المصروفات · التدفق · اليومية
    expect(ids).toEqual([
      "report-stage-dues",
      "report-supervision-delays",
      "report-subcontractors",
      "report-contracts",
      "report-execution",
      "report-leads",
    ]);
  });
});

describe("isChildVisible — باب البند المفرد (نفس ترتيب شروط الفلتر)", () => {
  const gate = (over: Partial<{ adminOnly: boolean; perm: string; flag: string }> = {}) => ({
    isAdmin: false,
    flagOn: (f: string) => f !== "flag_off",
    permOn: (k: string) => permAllows({ screen_receipts: false }, k),
    ...over,
  });

  test("adminOnly يمنع غير المدير ويُتجاوز للمدير", () => {
    expect(isChildVisible({ adminOnly: true }, { isAdmin: false, flagOn: () => true, permOn: () => true })).toBe(false);
    expect(isChildVisible({ adminOnly: true }, { isAdmin: true, flagOn: () => true, permOn: () => true })).toBe(true);
  });

  test("صلاحية ممنوعة تمنع — ومجهولة لا تمنع", () => {
    expect(isChildVisible({ perm: "screen_receipts" }, gate())).toBe(false);
    expect(isChildVisible({ perm: "screen_nonsense" }, gate())).toBe(true);
  });

  test("ميزة مطفأة تمنع العرض (لكنها لا تمنع الفتح — انظر canOpenView)", () => {
    expect(isChildVisible({ flag: "flag_off" }, gate())).toBe(false);
    expect(isChildVisible({ flag: "flag_on" }, gate())).toBe(true);
  });

  test("الشروط مجتمعة: أول رفض يفوز", () => {
    expect(isChildVisible({ adminOnly: true, perm: "screen_receipts" }, gate())).toBe(false);
    expect(isChildVisible({ adminOnly: true, perm: "screen_receipts" }, { ...gate(), isAdmin: true })).toBe(false);
  });
});

describe("canOpenView — حرس التنقل الجانبي (مرآة _navigate: main_window.py:1961-1988)", () => {
  const gate = (perms: Record<string, boolean> | null, isAdmin = false) => ({
    isAdmin,
    permOn: (k: string) => permAllows(perms, k, isAdmin),
  });

  test("رسالة الحرس حرفية المكتبي حرفًا حرفًا", () => {
    expect(NAVIGATE_DENIED_MSG).toBe("هذه الشاشة غير متاحة لحسابك.");
  });

  test("users/data-mgmt إدارة ويبية للمدير/المطور فقط", () => {
    const perms = secretaryPerms();
    expect(canOpenView("users", gate(perms))).toBe(false);
    expect(canOpenView("data-mgmt", gate(perms))).toBe(false);
    expect(canOpenView("users", gate(allDenied, true))).toBe(true);
    expect(canOpenView("data-mgmt", gate(allDenied, true))).toBe(true);
  });

  test("الرئيسية بلا باب كالمكتبي — حتى مع خريطة ممنوعة الكل", () => {
    expect(canOpenView("dashboard", gate(allDenied))).toBe(true);
    expect(canOpenView("dashboard", gate(null))).toBe(true);
  });

  test("فتح كشف الحساب/ملف العميل/العقد من مسار جانبي يمر بأبوابها", () => {
    const perms = secretaryPerms();
    expect(canOpenView("statement", gate(perms))).toBe(true);
    expect(canOpenView("customer-file", gate(perms))).toBe(true);
    expect(canOpenView("contract", gate(perms))).toBe(true);
    expect(canOpenView("statement", gate(secretaryPerms({ screen_statement: false })))).toBe(false);
    expect(canOpenView("customer-file", gate(secretaryPerms({ screen_customers: false })))).toBe(false);
  });

  test("السندات من البحث: بوابة الويب المدمجة screen_vouchers (لا تغيير بحراس الـAPI)", () => {
    expect(canOpenView("vouchers", gate(secretaryPerms()))).toBe(true);
    expect(canOpenView("vouchers", gate(secretaryPerms({ screen_vouchers: false })))).toBe(false);
    // منع القبض وحده لا يغلق الشاشة كلها — إخفاء بند القبض مسؤولية فلتر الشل
    expect(canOpenView("vouchers", gate(secretaryPerms({ screen_receipts: false })))).toBe(true);
  });

  test("العُهد والسلف ببوابة screen_custody (الانحراف الموثق عن حالة screen_payments المكتبية)", () => {
    expect(canOpenView("custody", gate(secretaryPerms({ screen_custody: false })))).toBe(false);
    expect(canOpenView("advances", gate(secretaryPerms({ screen_custody: false })))).toBe(false);
    expect(canOpenView("custody", gate(secretaryPerms()))).toBe(true);
  });

  test("شاشة التقارير المفتوحة مباشرة بباب screen_reports كالمكتبي (PAGE_PERMS[IDX_REPORTS])", () => {
    expect(canOpenView("reports", gate(secretaryPerms()))).toBe(true);
    expect(canOpenView("reports", gate(secretaryPerms({ screen_reports: false })))).toBe(false);
  });

  test("الخريطة غير المحمّلة لا تحرس (سماح مؤقت منعًا للوميض)", () => {
    expect(canOpenView("vouchers", gate(null))).toBe(true);
    expect(canOpenView("users", { isAdmin: false, permOn: () => true })).toBe(false);
  });
});

describe("الاكتمال البنيوي — كل مفاتيح التنقل قابلة للتحرير من كتالوج المستخدمين", () => {
  test("كل perm في NAV_MODULES موجود في كتالوج الصلاحيات PERMISSIONS", () => {
    const missing: string[] = [];
    for (const m of NAV_MODULES) {
      for (const c of m.children) {
        if (c.perm && !CATALOG_KEYS.has(c.perm)) missing.push(`${c.id}→${c.perm}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("كل قيم VIEW_PERMS وREPORT_PERM موجودة في الكتالوج", () => {
    const missing: string[] = [];
    for (const [view, key] of Object.entries(VIEW_PERMS)) {
      if (key && !CATALOG_KEYS.has(key)) missing.push(`${view}→${key}`);
    }
    for (const [rep, key] of Object.entries(REPORT_PERM)) {
      if (!CATALOG_KEYS.has(key)) missing.push(`${rep}→${key}`);
    }
    expect(missing).toEqual([]);
  });

  test("سندات القبض/الصرف بمفتاحين منفصلين حرفيًا كالمكتبي (main_window.py:782-787)", () => {
    expect(findChild("vouchers-receipt").child.perm).toBe("screen_receipts");
    expect(findChild("vouchers-payment").child.perm).toBe("screen_payments");
  });

  test("العُهد والسلف على screen_custody — الانحراف الموثق ثابت (بديل حالة screen_payments)", () => {
    expect(findChild("custody").child.perm).toBe("screen_custody");
    expect(findChild("advances").child.perm).toBe("screen_custody");
  });

  test("بندا القبض والصرف يبقيان view=vouchers بأوضاع مختلفة — فتظل بوابة الـAPI واحدة", () => {
    expect(findChild("vouchers-receipt").child.view).toBe("vouchers");
    expect(findChild("vouchers-payment").child.view).toBe("vouchers");
    expect(findChild("vouchers-receipt").child.mode).toBe("receipt");
    expect(findChild("vouchers-payment").child.mode).toBe("payment");
  });

  test("كل بند شل له باب صلاحية أو adminOnly — لا بند مجهول الباب", () => {
    const noGate: string[] = [];
    for (const m of NAV_MODULES) {
      for (const c of m.children) {
        if (!c.perm && !c.adminOnly) noGate.push(`${c.id}`);
      }
    }
    expect(noGate).toEqual([]);
  });
});
