/**
 * consulting-constants.ts — ثوابت موديول الاستشارات الهندسية:
 * مقي نقي بلا DB ولا React — تستهلكه مسارات الـAPI (تحقق المدخلات) والواجهة (قوائم الاختيار)
 * بنفس نمط الكتالوج (modules-catalog) كي يبقى مصدر واحد للحقيقة.
 */

/** حالات المهندس */
export const ENGINEER_STATUSES = ["نشط", "في إجازة", "موقوف", "منتهي الخدمة"] as const;

/** التخصصات الهندسية الشائعة في مكاتب الاستشارات الكويتية */
export const ENGINEER_SPECIALTIES = [
  "عمارة",
  "إنشائي",
  "كهرباء",
  "ميكانيكا (تكييف)",
  "مدني (بنية تحتية)",
  "تخطيط عمراني",
  "مساحة",
  "بيئي",
  "حماية من الحريق",
  "أخرى",
] as const;

/** الأدوار عند إسناد مهندس لمشروع/عقد */
export const ASSIGNMENT_ROLES = [
  "مدير مشروع",
  "مهندس تصميم",
  "مهندس إشراف",
  "مراجع فني",
  "منسق تخصصات",
  "مساح",
  "مستشار تخصصي",
] as const;

/** حالات الإسناد */
export const ASSIGNMENT_STATUSES = ["سارية", "منتهية"] as const;

/** أنواع النشاط في ساعات العمل (المخططات/الإشراف/…) */
export const TIMESHEET_ACTIVITIES = ["تصميم", "إشراف", "مراجعة", "اجتماع", "زيارة موقع", "إداري"] as const;

/** أنواع الإجازات (مواءمة قانون العمل الكويتي الشائع) */
export const LEAVE_TYPES = ["سنوية", "مرضية", "طارئة", "بدون راتب"] as const;

/** حالات طلب الإجازة */
export const LEAVE_STATUSES = ["معلقة", "معتمدة", "مرفوضة"] as const;

/** مهلة التنبيه قبل انتهاء عضوية/ترخيص المهندس (يومًا) */
export const LICENSE_WARN_DAYS = 45;

/** سقف ساعات اليوم الواحد في تسجيل الساعات */
export const MAX_DAY_HOURS = 24;

/** حساب أيام الإجازة شاملة الطرفين — 0 عند بيانات غير صالحة */
export function leaveDaysBetween(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
  return Math.max(0, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
}

/** الأيام المتبقية لانتهاء ترخيص (تاريخ YYYY-MM-DD) — سالب = منتهٍ */
export function licenseDaysLeft(expiry: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return Number.MAX_SAFE_INTEGER;
  const e = new Date(`${expiry}T00:00:00`).getTime();
  if (isNaN(e)) return Number.MAX_SAFE_INTEGER;
  return Math.ceil((e - Date.now()) / 86400000);
}
