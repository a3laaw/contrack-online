/**
 * purchase-constants.ts — ثوابت ر4 «الموردون وأوامر الشراء» (docs/purchase-design.md):
 * نقي 100% بلا DB ولا React — تستهلكه مسارات الـAPI والواجهة بنمط quotes-core حرفيًا.
 */

/** حالات أمر الشراء المغلقة الانتقالات (د3) — «مستلم» و«ملغى» نهائيتان */
export const PO_STATUSES = ["مسودة", "مرسل للمورد", "جزئي", "مستلم", "ملغى"] as const;
export type PurchaseOrderStatus = (typeof PO_STATUSES)[number];

/** حالات الأمر المسموح بإنشائه مباشرة (الإنشاء لا يدخل «جزئي/مستلم» أبدًا — الاستلام يرفعها آليًا) */
export const PO_CREATE_STATUSES = ["مسودة", "مرسل للمورد"] as const;

/** خريطة الانتقالات المغلقة (د3) */
export const PO_TRANSITIONS: Record<string, readonly string[]> = {
  "مسودة": ["مرسل للمورد", "ملغى"],
  "مرسل للمورد": ["جزئي", "مستلم", "ملغى"],
  "جزئي": ["مستلم", "ملغى"],
  "مستلم": [],
  "ملغى": [],
};

/** نوع إذن الإدخال الآلي عند الاستلام — دائمًا ائتماني (السداد عبر سند صرف المورد د6) */
export const PO_RECEIVE_ENTRY_SOURCE = "credit";

/** مفاتيح الترقيم الذري (د7) */
export const PO_NUMBER_KEY = "purchase_order:number";
export const PO_NUMBER_PREFIX = "PO";
export const SUPPLIER_NUMBER_KEY = "supplier:number";
export const SUPPLIER_NUMBER_PREFIX = "SUP";

export const PO_INVALID_STATUS = "حالة أمر الشراء غير صحيحة.";
export const PO_EDIT_ONLY_DRAFT = "التعديل متاح على الأمر في حالة «مسودة» فقط.";
export const PO_DELETE_ONLY_DRAFT = "الحذف متاح على الأمر في حالة «مسودة» فقط.";
export const PO_ITEMS_REQUIRED = "يجب إضافة بند واحد على الأقل لأمر الشراء.";
export const PO_SUPPLIER_REQUIRED = "يجب اختيار المورد.";
export const PO_CANCEL_BLOCKED_RECEIVED =
  "لا يمكن إلغاء الأمر المستلم منه جزئيًا — أكمل الاستلام أو راجع الإدخالات المولدة.";

/** الأهداف المسموحة من حالة — قائمة الواجهة تعرضها حصرًا (نمط قائمة حالة العرض) */
export function poAllowedTargets(from: string): readonly string[] {
  return PO_TRANSITIONS[from] ?? [];
}

export function poTransitionBlockedMessage(from: string, to: string): string {
  return `انتقال حالة أمر الشراء غير مسموح (من ${from} إلى ${to}).`;
}

export function poTransitionAllowed(from: string, to: string): boolean {
  return poAllowedTargets(from).includes(to);
}

export function isPurchaseOrderStatus(status: unknown): status is PurchaseOrderStatus {
  return PO_STATUSES.includes(status as PurchaseOrderStatus);
}

/** ألوان الشارات — لوحة NOVA حصرًا: مسودة رمادي · مرسل للمورد كهرماني · جزئي أزرق ملكي معلوماتي · مستلم رمادي مكتمل · ملغى أحمر خطر */
export const PO_STATUS_FALLBACK_CLASS = "bg-secondary text-secondary-foreground";

export function poStatusBadgeClass(status: string): string {
  switch (status) {
    case "مسودة":
      return "bg-secondary text-secondary-foreground";
    case "مرسل للمورد":
      return "bg-status-warn-bg text-warn-ink";
    case "جزئي":
      return "bg-status-info-bg text-status-info";
    case "مستلم":
      return "bg-status-done-bg text-status-done";
    case "ملغى":
      return "bg-status-danger-bg text-status-danger";
    default:
      return PO_STATUS_FALLBACK_CLASS;
  }
}
