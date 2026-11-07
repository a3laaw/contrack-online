/**
 * saas-core.ts — منطق SaaS النقي (Task 115) — بلا DB ولا React:
 * حساب الحالة الفعلية للاشتراك، حسابات التجديد، والتحقق من مدخلات طلب الانضمام.
 * نقي 100% ليُختبر آليًا في tests/ ويُستهلك من الخادم والواجهة معًا.
 */

/** الحالة المخزنة في صف الاشتراك */
export type SaasStoredStatus = "trial" | "active" | "frozen" | "cancelled";

/** الحالة الفعلية المعروضة — «expired» تُشتق آليًا من انتهاء المدة */
export type SaasEffectiveStatus =
  | "trial"
  | "active"
  | "frozen"
  | "cancelled"
  | "expired"
  | "none";

export const SAAS_STATUS_LABELS: Record<SaasEffectiveStatus, string> = {
  trial: "تجربة",
  active: "نشط",
  frozen: "مجمّد",
  cancelled: "ملغى",
  expired: "منتهي",
  none: "بدون اشتراك",
};

export interface SubscriptionLike {
  status: string;
  endsAt: Date | string | null;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * الحالة الفعلية للاشتراك:
 * - بلا صف اشتراك ⇒ none (الشركات اليدوية القديمة قبل Task 115 — سلوكها كما كان)
 * - frozen/cancelled تحتجز كما هي مهما كانت المدة
 * - trial/active منتهية المدة ⇒ expired (يُعامل لاحقًا كتجميد قراءة فقط)
 */
export function effectiveSubscriptionStatus(
  sub: SubscriptionLike | null | undefined,
  now: Date = new Date()
): SaasEffectiveStatus {
  if (!sub) return "none";
  if (sub.status === "frozen") return "frozen";
  if (sub.status === "cancelled") return "cancelled";
  if (sub.status === "trial" || sub.status === "active") {
    const end = toDate(sub.endsAt);
    if (end && end.getTime() < now.getTime()) return "expired";
    return sub.status as "trial" | "active";
  }
  return "none";
}

/** الأيام المتبقية حتى الانتهاء — null = دائم بلا انتهاء (سالب = منتهٍ منذ n يومًا) */
export function daysLeft(
  endsAt: Date | string | null | undefined,
  now: Date = new Date()
): number | null {
  const end = toDate(endsAt);
  if (!end) return null;
  return Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
}

export function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 86_400_000);
}

/**
 * نهاية مدة بعد التجديد: تُمدد من نهاية الاشتراك الحالي إن كانت مستقبلًا
 * (فلا يخسر المشترك أيامًا بتجديده مبكرًا)، وإلا فمن الآن.
 */
export function renewEndsAt(
  currentEndsAt: Date | string | null | undefined,
  days: number,
  now: Date = new Date()
): Date {
  const end = toDate(currentEndsAt);
  const base = end && end.getTime() > now.getTime() ? end : now;
  return addDays(base, days);
}

export interface RegistrationInput {
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  activity: string;
  requestedUsername: string;
  password: string;
}

/** تحقق مدخلات طلب الانضمام — يُرجع أول خطأ أو null */
export function validateRegistrationInput(input: RegistrationInput): string | null {
  if (input.companyName.trim().length < 2) return "اسم الشركة مطلوب (حرفان على الأقل)";
  if (!input.contactName.trim()) return "اسم مسؤول التواصل مطلوب";
  const digits = input.phone.replace(/\D/g, "");
  if (digits && digits.length < 6) return "رقم الهاتف غير صالح";
  if (input.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()))
    return "البريد الإلكتروني غير صالح";
  if (input.requestedUsername.trim().length < 3 || /\s/.test(input.requestedUsername.trim()))
    return "اسم المستخدم: 3 أحرف على الأقل وبلا فراغات";
  if (input.password.length < 6) return "كلمة المرور يجب أن تكون 6 أحرف على الأقل";
  return null;
}

/** التحقق نفسه لأسماء مستخدمي المديرين (إنشاء شركة/اعتماد طلب) — نفس قاعدة POST /api/companies */
export function validateAdminUsername(username: string): string | null {
  if (username.length < 3 || /\s/.test(username))
    return "اسم المستخدم: 3 أحرف على الأقل وبلا فراغات";
  return null;
}
