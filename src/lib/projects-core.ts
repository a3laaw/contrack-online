/**
 * المشاريع — بند 11 من المرحلة 9 (منطق نقي قابل للاختبار).
 * المصدر المكتبي: app/services/lifecycle_service.py (add_project/update_project/
 * list_projects/get_project/delete_project) + database_schema_postgresql.sql §48.
 *
 * اكتشاف النطاق الموثق: واجهة المكتبي بلا شاشة ولا حوار لإدارة المشاريع —
 * «العقد هو المشروع» (dealings.py:8) والمشاريع تُنشأ تلقائيًا عبر contracts.project_id
 * (غير موجودة في مخطط PostgreSQL المرجعي). لذلك:
 *  - لا بند شل للمشاريع (لا مدخل في PAGE_PERMS) — والبوابة شاشة الحاضن screen_customers
 *    (فتح نتيجة بحث مشروع بالمكتبي محروس بها — main_window.py:1813).
 *  - حالات المشاريع: لا قائمة حالات بالمكتبي للمشاريع إطلاقًا؛ الافتراضي «جديد»
 *    من المخطط المرجعي §48، والشرائح الأخرى من مفردات STATUS_COLORS المكتبية (style.py:123)
 *    التي يُلوّن بها أي status غير معروف يرجع الرمادي الافتراضي.
 *  - حذف المكتبي يُمنع عند الارتباط: «لا يمكن حذف المشروع لأنه مرتبط بعقود أو سندات.»
 *    (delete_project — الويب: السندات فقط لأن العقود بلا ربط مشاريع).
 */

/** طول name في المخطط المرجعي VARCHAR(200) */
export const PROJECT_NAME_MAX = 200;

/** الافتراضي من المخطط المرجعي: status VARCHAR(20) DEFAULT 'جديد' */
export const PROJECT_STATUS_DEFAULT = "جديد";

/**
 * شرائح الحالة المعروضة في نافذة الإدارة — من مفردات STATUS_COLORS المكتبية
 * (نشط أخضر · متوقف كهرماني · منتهي بنفسجي/مكتمل · ملغى أحمر) مع افتراضي المخطط «جديد».
 * المكتبي لا يعرض محدّد حالة للمشاريع (لا واجهة) — قائمة ويب محدودة بالمفردات المعتمدة فقط.
 */
export const PROJECT_STATUSES = ["جديد", "نشط", "متوقف", "منتهي"] as const;

/** رسالة تحقق الاسم الحرفية من add_project/update_project (lifecycle_service.py:128/141) */
export const PROJECT_NAME_REQUIRED = "اسم المشروع مطلوب.";

/** رسالة منع الحذف الحرفية من delete_project (lifecycle_service.py:176) */
export const PROJECT_DELETE_BLOCKED = "لا يمكن حذف المشروع لأنه مرتبط بعقود أو سندات.";

/** تنظيف اسم المشروع: إلزامي بعد التشذيب وبسقط 200 حرف (VARCHAR(200)) */
export function cleanProjectName(raw: unknown): string {
  return String(raw ?? "").trim().slice(0, PROJECT_NAME_MAX);
}

/** حقل نصي حر (description/location): تشذيب فقط بلا سقط (TEXT) */
export function cleanProjectText(raw: unknown): string {
  return String(raw ?? "").trim();
}

/** تاريخ YYYY-MM-DD أو "" — نمط parseDay الموحد (api-utils) */
export function cleanProjectDate(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const d = new Date(`${s}T00:00:00`);
  return isNaN(d.getTime()) ? "" : s;
}

/** الحالة: من القائمة المعتمدة أو نص حر مشذّب بسقط 20 (VARCHAR(20)) — فارغ ⇒ الافتراضي */
export function cleanProjectStatus(raw: unknown): string {
  const s = String(raw ?? "").trim().slice(0, 20);
  return s || PROJECT_STATUS_DEFAULT;
}

/** معرف العميل: رقم صحيح موجب أو null (customer_id اختياري في المخطط المرجعي) */
export function cleanProjectCustomerId(raw: unknown): number | null {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/** صف مشروع كما يعيده الـAPI (التواريخ نصوص والأموال لا وجود لها هنا) */
export interface ProjectRow {
  id: number;
  customerId: number | null;
  customerName: string;
  name: string;
  description: string;
  location: string;
  startDate: string;
  endDate: string;
  status: string;
  vouchersCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** ترتيب القائمة المكتبية: ORDER BY p.id DESC (lifecycle_service.list_projects) */
export function sortProjectsDesc(rows: ProjectRow[]): ProjectRow[] {
  return [...rows].sort((a, b) => b.id - a.id);
}

/** فلتر العميل محليًا (مرآة فلتر customerId في GET — للعرض قبل رد الخادم) */
export function filterProjectsByCustomer(
  rows: ProjectRow[],
  customerId: number | null
): ProjectRow[] {
  if (!customerId) return rows;
  return rows.filter((r) => r.customerId === customerId);
}

/** فترة المشروع للعرض: «بداية → نهاية» أو طرف واحد أو — */
export function projectPeriodLabel(p: Pick<ProjectRow, "startDate" | "endDate">): string {
  const s = p.startDate || "";
  const e = p.endDate || "";
  if (s && e) return `${s} → ${e}`;
  if (s || e) return s || e;
  return "—";
}

/** لون الشارة: نفس خريطة format.statusBadgeClass («جديد» يرجع الرمادي الافتراضي كالمكتبي) */
export const PROJECT_STATUS_FALLBACK_CLASS = "bg-secondary text-secondary-foreground";
