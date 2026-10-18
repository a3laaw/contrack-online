/** تنسيق المبالغ بالدينار الكويتي — 3 خانات عشرية */
export function formatKWD(n: number | string | null | undefined): string {
  const v = Number(n || 0);
  return v.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return s.slice(0, 10);
}

export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  return s.slice(0, 16).replace("T", " ");
}

const STATUS_STYLES: Record<string, string> = {
  // ===== جدول الحالات المعتمد (أربع حالات فقط — بلا أخضر) =====
  // مكتمل/منفّذ/مُرحَّل ⇒ رمادي #334155 على #E2E8F0
  // قيد التنفيذ/بانتظار ⇒ أزرق #1D4ED8 على #DBEAFE
  // تحذير/مسودة/متبقٍ ⇒ كهرماني #92400E على #FEF3C7
  // متأخر/خطر ⇒ أحمر #B91C1C على #FEE2E2
  // عقد
  "نشط": "bg-status-info-bg text-status-info",
  "مسودة": "bg-status-warn-bg text-status-warn",
  "تحت المراجعة": "bg-status-info-bg text-status-info",
  "معتمد": "bg-status-done-bg text-status-done",
  "متوقف": "bg-status-warn-bg text-status-warn",
  "منتهي": "bg-status-done-bg text-status-done",
  "مغلق": "bg-status-done-bg text-status-done",
  "ملغى": "bg-status-danger-bg text-status-danger",
  "معتمد (سند)": "bg-status-done-bg text-status-done",
  "مُرحَّل": "bg-status-done-bg text-status-done",
  "مكتمل": "bg-status-done-bg text-status-done",
  "منفّذ": "bg-status-done-bg text-status-done",
  // مطالبات
  registered: "bg-status-info-bg text-status-info",
  in_review: "bg-status-info-bg text-status-info",
  approved: "bg-status-done-bg text-status-done",
  refused: "bg-status-danger-bg text-status-danger",
  collected: "bg-status-done-bg text-status-done",
  paid: "bg-status-done-bg text-status-done",
  cancelled: "bg-status-danger-bg text-status-danger",
  postponed: "bg-status-warn-bg text-status-warn",
  partial: "bg-status-warn-bg text-status-warn",
  overdue: "bg-status-danger-bg text-status-danger",
  due: "bg-status-warn-bg text-status-warn",
  upcoming: "bg-status-info-bg text-status-info",
  awaiting_stage: "bg-status-info-bg text-status-info",
  skipped: "bg-status-done-bg text-status-done",
  // تعليقات
  "مفتوح": "bg-status-info-bg text-status-info",
  "تم": "bg-status-done-bg text-status-done",
  "مؤجل": "bg-status-warn-bg text-status-warn",
  // مهام
  "عاجل": "bg-status-danger-bg text-status-danger",
  "متأخر": "bg-status-danger-bg text-status-danger",
  "قيد التنفيذ": "bg-status-info-bg text-status-info",
  "بانتظار": "bg-status-info-bg text-status-info",
  "متبقٍ": "bg-status-warn-bg text-status-warn",
};

/** الحالات المكتملة — تُعرض بعلامة ✓ داخل الشارة (جدول الحالات: رمادي مع ✓) */
export const DONE_STATUSES = new Set([
  "مكتمل", "منفّذ", "مُرحَّل", "منتهي", "مغلق", "معتمد", "معتمد (سند)",
  "تم", "approved", "collected", "paid", "done",
]);

export function statusBadgeClass(status: string): string {
  return STATUS_STYLES[status] || "bg-secondary text-secondary-foreground";
}

export const CLAIM_STATUS_LABEL: Record<string, string> = {
  registered: "مسجلة",
  sent: "مُرسلة",
  in_review: "تحت المراجعة",
  approved: "معتمدة",
  refused: "مرفوضة",
  collected: "مُحصّلة",
  paid: "مدفوعة",
  postponed: "مؤجلة",
  cancelled: "ملغاة",
  archived: "مؤرشفة",
};

export const CLAIM_NEXT: Record<string, { label: string; next: string }[]> = {
  out: [
    { label: "إرسال للعميل", next: "sent" },
    { label: "اعتماد", next: "approved" },
    { label: "تحصيل", next: "collected" },
  ],
  in: [
    { label: "إحالة للمراجعة", next: "in_review" },
    { label: "اعتماد", next: "approved" },
    { label: "دفع", next: "paid" },
  ],
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  paid: "مدفوعة",
  partial: "جزئية",
  overdue: "متأخرة",
  due: "مستحقة",
  upcoming: "قادمة",
  awaiting_stage: "بانتظار المرحلة",
  skipped: "متخطاة",
  advance: "دفعة مقدمة",
};

/** طرق الدفع الافتراضية (كقائمة المكتب — تُستخدم في حوارات السندات) */
export const PAYMENT_METHODS = ["نقدًا", "تحويل بنكي", "KNET", "شيك", "أخرى"] as const;

const VOUCHER_TYPE_LABEL: Record<string, string> = {
  payment: "سند صرف",
  receipt: "سند قبض",
  transfer: "سند تحويل",
  custody_return: "إرجاع عهدة",
  salary_deduction: "خصم راتب",
};

/** تسمية عربية لنوع السند */
export function voucherTypeLabel(vtype: string): string {
  return VOUCHER_TYPE_LABEL[vtype] ?? vtype;
}

/** اسم بديل متوافق مع حوارات الطباعة */
export const formatDate = fmtDate;

/** تاريخ اليوم المحلي بصيغة YYYY-MM-DD (آمن للعميل — بدون انزياح UTC) */
export function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
