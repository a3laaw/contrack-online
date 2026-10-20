/**
 * منطق الصلاحيات النقي للتنقل (بلا React ولا "use client") — المرحلة 9 / بند 5:
 * مواءمة حرفية مع المكتبي contrack_v9.15.18 (قراءة فقط):
 *   • auth_service.py:485-501 has_permission:
 *       المدير/المطور → دائمًا نعم · المفاتيح غير المعروفة لا تقيّد شيئًا ·
 *       السكرتير → تخصيصه المحفوظ وإلا افتراضيات دوره.
 *   • main_window.py:616-632 PAGE_PERMS · :782-828 بناء الشل المشروط بhas_permission ·
 *     :1961-1988 حرس _navigate برسالة «هذه الشاشة غير متاحة لحسابك.» الحرفية.
 * شكل خريطة الصلاحيات الواصلة من /api/auth/me (permsForUser): كل مفاتيح الكتالوج
 * موجودة فيها (المسموح=true والممنوع=false) — فالمفتاح المفقود = مجهول لا يقيّد.
 */
import type { NavChild, NavModule } from "./nav-structure";
import type { ViewName } from "./contrack-types";

/** رسالة حرس التنقل — حرفية المكتبي style.toast في _navigate (main_window.py:1966/1987) */
export const NAVIGATE_DENIED_MSG = "هذه الشاشة غير متاحة لحسابك.";

/** خريطة صلاحيات المستخدم كما تعيدها /api/auth/me (null = لم تُحمّل بعد ⇒ السماح منعًا للوميض) */
export type PermsMap = Record<string, boolean> | null | undefined;

/**
 * قاعدة has_permission: الدور أولًا (المدير/المطور دائمًا) ثم الخريطة
 * (الممنوع صراحةً = false فقط يُرفض) والمفتاح المجهول/الخريطة غير المحمّلة لا يقيّدان.
 */
export function permAllows(perms: PermsMap, key: string, isManager = false): boolean {
  if (isManager) return true;
  if (!perms) return true;
  return perms[key] !== false;
}

/** مدخلات باب البند — الثلاثة نفسها التي يفلتر بها AppShell (adminOnly ثم الميزة ثم الصلاحية) */
export interface ChildGateInput {
  adminOnly?: boolean;
  flag?: string;
  perm?: string;
}

export interface ChildGate {
  isAdmin: boolean;
  flagOn: (f: string) => boolean;
  permOn: (k: string) => boolean;
}

/** مرآة فلتر الشل لبند واحد — بنفس ترتيب شروط visibleChildren المكتبية */
export function isChildVisible(child: ChildGateInput, gate: ChildGate): boolean {
  if (child.adminOnly && !gate.isAdmin) return false;
  if (child.flag && !gate.flagOn(child.flag)) return false;
  if (child.perm && !gate.permOn(child.perm)) return false;
  return true;
}

/** بنود وحدة معروصة بالصلاحيات والمزايا — نُقل من AppShell لنقية قابلة للاختبار (نفس السلوك) */
export function visibleChildren(
  module: NavModule,
  isAdmin: boolean,
  flagOn: (f: string) => boolean,
  permOn: (k: string) => boolean
): NavChild[] {
  return module.children.filter((c) => isChildVisible(c, { isAdmin, flagOn, permOn }));
}

/**
 * باب فتح الشاشة مباشرة من مسارات جانبية (بحث شامل/رجوع/فتح كشف من عقد/ملف عميل)
 * — كحرس _navigate المكتبي. مرآة PAGE_PERMS مع انحرافات الويب الموثقة:
 *   screen_custody بديل حالة screen_payments المكتبية للعُهد/السلف ·
 *   screen_other_company بديل screen_gateway لتسديدات الشركة الأخرى ·
 *   الرئيسية (dashboard) بلا باب كالمكتبي (nav_tree[0] بلا شرط) ·
 *   الميزات (flag) لا تمنع فتح الشاشة في المكتبي — تخفي الزر فقط.
 */
export const VIEW_PERMS: Partial<Record<ViewName, string>> = {
  due: "screen_customers",
  customers: "screen_customers",
  "customer-file": "screen_customers",
  contracts: "screen_customers",
  "contract-groups": "screen_customers",
  forms: "screen_forms",
  contract: "screen_customers",
  comments: "screen_customers",
  tasks: "screen_tasks",
  visits: "screen_visits",
  followup: "screen_followup",
  subcontractors: "screen_subcontractors",
  vouchers: "screen_vouchers",
  statement: "screen_statement",
  custody: "screen_custody",
  advances: "screen_custody",
  gateway: "screen_gateway",
  "other-company": "screen_other_company",
  claims: "screen_claims",
  invoices: "screen_invoices",
  reports: "screen_reports",
  settings: "screen_settings",
};

/** هل يفتح هذا المستخدم هذا الـview؟ — users/data-mgmt إدارة ويبية للمدير/المطور فقط */
export function canOpenView(
  view: ViewName,
  gate: { isAdmin: boolean; permOn: (k: string) => boolean }
): boolean {
  if (view === "users" || view === "data-mgmt") return gate.isAdmin;
  const key = VIEW_PERMS[view];
  if (!key) return true; // الرئيسية بلا باب كالمكتبي
  return gate.permOn(key);
}
