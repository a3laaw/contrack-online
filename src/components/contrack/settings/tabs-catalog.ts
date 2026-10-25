/**
 * كتالوج تبويبات الإعدادات — مرآة المكتبي حرفيًا (settings.py:461-533).
 * المنطق نقي بلا React — قابل للاختبار (tests/phase9-settings-tabs.test.ts).
 *
 * قواعد الظهور المكتبية (SettingsPage._build):
 *   - is_admin() = الدور admin أو developer (auth_service.py:166-168) ⇒
 *     «بيانات الشركة» وأنواع العقود وحسابات المصروفات ومراحل المتابعة
 *     وجدول الزيارات والبيانات والنسخ الاحتياطي للمدير/المطور فقط.
 *   - «الطباعة والعرض» للجميع، و«الأمان والمستخدمون» للجميع مع اختلاف
 *     التسمية: «◆ الأمان والمستخدمون» للإدارة و«◆ كلمة المرور» للسكرتير.
 *   - «⚙ أدوات المطور» لـ developer فقط (is_developer — auth_service.py:171).
 *   - انحراف ويب موثق (Task 97 — قرار معتمد): تاب «الشركات» للمطور حصرًا
 *     (adminOnly+developerOnly معًا) — عزل الشركات: مدير الشركة يبقى داخل شركته.
 *   - أدوات المطور تابات داخلية خمسة (settings.py:1020-1242) بترتيبها
 *     الحرفي: المزايا · الهوية والترخيص · الترحيل والاستيراد ·
 *     الشبكة والنسخ · ✱ تنظيف البيانات.
 */

export interface SettingsTabDef {
  /** قيمة التبويب — تطابق section في بنود الشل (nav-structure) */
  value: string;
  /** التسمية الحرفية من settings.py (بالرمز والمسافتين كما هي) */
  label: string;
  /** يظهر للإدارة فقط (is_admin: admin أو developer) */
  adminOnly: boolean;
  /** يظهر للمطور فقط (is_developer) */
  developerOnly: boolean;
}

// ===== التسميات الحرفية من settings.py:509-532 =====
export const TAB_COMPANY = "⌂  بيانات الشركة";
export const TAB_COMPANIES = "🏢  الشركات";
export const TAB_APPEARANCE = "▤  الطباعة والعرض";
export const TAB_SECURITY_ADMIN = "◆  الأمان والمستخدمون";
export const TAB_SECURITY_SECRETARY = "◆  كلمة المرور";
export const TAB_CONTRACT_TYPES = "☰  أنواع العقود";
export const TAB_EXPENSE_ACCOUNTS = "§  حسابات المصروفات";
export const TAB_WORKFLOW = "⇄  مراحل المتابعة";
export const TAB_VISITS = "◷  جدول الزيارات";
export const TAB_BACKUP = "⊞  البيانات والنسخ الاحتياطي";
export const TAB_DEVELOPER = "⚙  أدوات المطور";

/** كل التبويبات التسعة بترتيب المكتبي _build (الإدارية الثمانية + أدوات المطور) */
export const SETTINGS_TABS: SettingsTabDef[] = [
  { value: "company", label: TAB_COMPANY, adminOnly: true, developerOnly: false },
  // Task 97 — قرار معتمد: الشركات للمطور حصرًا (البابان معًا = يستثني المدير والسكرتير)
  { value: "companies", label: TAB_COMPANIES, adminOnly: true, developerOnly: true },
  { value: "appearance", label: TAB_APPEARANCE, adminOnly: false, developerOnly: false },
  { value: "security", label: TAB_SECURITY_ADMIN, adminOnly: false, developerOnly: false },
  { value: "contract-types", label: TAB_CONTRACT_TYPES, adminOnly: true, developerOnly: false },
  { value: "expense-accounts", label: TAB_EXPENSE_ACCOUNTS, adminOnly: true, developerOnly: false },
  { value: "workflow", label: TAB_WORKFLOW, adminOnly: true, developerOnly: false },
  { value: "visits", label: TAB_VISITS, adminOnly: true, developerOnly: false },
  { value: "backup", label: TAB_BACKUP, adminOnly: true, developerOnly: false },
  { value: "developer", label: TAB_DEVELOPER, adminOnly: false, developerOnly: true },
];

/** تبويب الأمان يتغير نصه حسب الدور (settings.py:514-515) */
export function securityTabLabel(isAdmin: boolean): string {
  return isAdmin ? TAB_SECURITY_ADMIN : TAB_SECURITY_SECRETARY;
}

/**
 * التبويبات المرئية لدور معين — بنفس ترتيب المكتبي مع انحراف الويب الموثق (Task 97):
 *   سكرتير  ⇒ الطباعة والعرض + كلمة المرور فقط (تعليق settings.py:510-511)
 *   مدير    ⇒ الإدارية (بلا الشركات — للمطور حصرًا Task 97) وبلا أدوات المطور
 *   مطور    ⇒ كل التبويبات (is_admin يشمل المطور + الشركات وأدوات المطور)
 */
export function visibleSettingsTabs(isAdmin: boolean, isDeveloper: boolean): SettingsTabDef[] {
  return SETTINGS_TABS.filter((t) => {
    if (t.adminOnly && !isAdmin) return false;
    if (t.developerOnly && !isDeveloper) return false;
    return true;
  }).map((t) => (t.value === "security" ? { ...t, label: securityTabLabel(isAdmin) } : t));
}

/** التبويب الافتراضي عند الدخول: أول تبويب مرئي (المكتبي يفتح أول تاب) */
export function defaultSettingsTab(isAdmin: boolean, isDeveloper: boolean): string {
  return visibleSettingsTabs(isAdmin, isDeveloper)[0]?.value ?? "appearance";
}

/**
 * تحويل قسم الشل (initialSection) إلى تبويب صالح للدور —
 * القسم غير المرئي/المجهول يرجع للتبويب الافتراضي بدل فتح تبويب محجوب.
 */
export function resolveInitialSection(
  section: string | undefined,
  isAdmin: boolean,
  isDeveloper: boolean
): string {
  if (section) {
    const found = visibleSettingsTabs(isAdmin, isDeveloper).find((t) => t.value === section);
    if (found) return found.value;
  }
  return defaultSettingsTab(isAdmin, isDeveloper);
}

// ===== تابات أدوات المطور الخمسة الداخلية (settings.py:1098/1174/1216/1230/1239) =====

export interface DevTabDef {
  value: string;
  label: string;
}

export const DEV_TABS: DevTabDef[] = [
  { value: "features", label: "المزايا" },
  { value: "identity", label: "الهوية والترخيص" },
  { value: "migration", label: "الترحيل والاستيراد" },
  { value: "network", label: "الشبكة والنسخ" },
  { value: "cleanup", label: "✱ تنظيف البيانات" },
];

/** التبويب الافتراضي لأدوات المطور (أول تاب داخلي — كالمكتبي) */
export const DEV_DEFAULT_TAB = DEV_TABS[0].value;
