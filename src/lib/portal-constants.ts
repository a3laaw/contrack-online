/**
 * portal-constants.ts — ثوابت ر5 «بوابة العميل — رابط الكشف المؤقت الآمن»
 * (docs/customer-portal-design.md): نقي 100% بلا DB ولا React — نمط
 * opportunities-constants/quotes-core حرفيًا. قاعدة ConTrack: لا enum.
 */

/** مدد الصلاحية المسموحة عند إنشاء الرابط (د2) — بالأيام */
export const PORTAL_LINK_CHOICES = [30, 90, 365] as const;
export type PortalLinkDays = (typeof PORTAL_LINK_CHOICES)[number];

/** الافتراضي في الحوار (د2) */
export const PORTAL_DEFAULT_DAYS: PortalLinkDays = 90;

/** هل المدة من المفردات المعتمدة؟ (حارس إدخال المسار) */
export function isPortalLinkDays(value: unknown): value is PortalLinkDays {
  return PORTAL_LINK_CHOICES.includes(value as PortalLinkDays);
}

/** حدود حد الطلبات (د6) — نافذة انزلاقية في الذاكرة حصرًا (سياسة المشروع: ذاكرة محلية) */
export const PORTAL_TOKEN_RATE_PER_HOUR = 60; // طلبًا ناجحًا لكل رمز/ساعة
export const PORTAL_IP_FAIL_RATE_PER_HOUR = 10; // محاولة فاشلة لكل IP/ساعة
export const PORTAL_RATE_WINDOW_MS = 60 * 60 * 1000;

/** شارات حالة الرابط بالقائمة (د3) — مفردات نصية مغلقة */
export const PORTAL_LINK_STATUSES = ["نشط", "منتهي", "مبطول"] as const;
export type PortalLinkStatus = (typeof PORTAL_LINK_STATUSES)[number];

/**
 * الرفض العام الموحد (د4) — الطرف العام يرى رسالة واحدة بلا تمييز الأسباب
 * (لا حصر للأسباب ولا تسريب وجود/انتهاء الرمز). السبب الدقيق للسجل الداخلي حصرًا.
 */
export const PORTAL_GENERIC_REJECT = "الرابط غير صالح أو منتهي.";

/** أسباب الرفض الداخلية — للسجل وواجهة الفريق لا للطرف العام (د4) */
export type PortalRejectReason = "not_found" | "expired" | "revoked";
