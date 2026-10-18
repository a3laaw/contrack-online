import "server-only";

/** المطالبات المالية — ثوابت وآلة انتقالات حرفيًا من المصدر (claims_service.py V4.47) */

export const DIR_OUT = "out"; // مطالبتنا على العميل
export const DIR_IN = "in"; // مطالبات المقاولين علينا

export const CLAIM_STATUS_LABEL: Record<string, string> = {
  registered: "مسجلة",
  sent: "مرسلة",
  in_review: "قيد المراجعة",
  approved: "معتمدة",
  refused: "مرفوضة",
  collected: "محصّلة",
  paid: "مدفوعة",
  postponed: "مؤجلة",
  cancelled: "ملغاة",
};

/** ملخص الحالة للعرض في الجدول (كالمصدر STATUS_DISPLAY) */
export const CLAIM_STATUS_DISPLAY: Record<string, string> = {
  registered: "مستحقة",
  sent: "مستحقة",
  in_review: "مستحقة",
  approved: "مستحقة",
  refused: "مرفوضة",
  collected: "مسددة",
  paid: "مسددة",
  postponed: "مؤجلة",
  cancelled: "ملغاة",
};

export const CLAIM_DIRECTION_LABEL: Record<string, string> = {
  out: "مطالبة على العميل",
  in: "مطالبة مقاول علينا",
};

/** الحالات النهائية التي تمنع التعديل (كالمصدر) */
export const CLAIM_FINAL_STATUSES = ["collected", "paid", "refused", "cancelled"];

/** الحالات السارية التي تمنع حذف السند/العقد (spec G) */
export const CLAIM_ACTIVE_STATUSES = ["registered", "sent", "in_review", "approved", "postponed"];

/** الانتقالات المسموحة لكل اتجاه (NEXT حرفيًا من المصدر) */
export const CLAIM_NEXT: Record<string, Record<string, string[]>> = {
  out: {
    registered: ["sent", "postponed", "cancelled"],
    sent: ["approved", "postponed", "cancelled"],
    approved: ["collected", "postponed", "cancelled"],
    postponed: ["registered", "sent", "approved", "cancelled"],
    collected: [],
    cancelled: [],
  },
  in: {
    registered: ["in_review", "postponed", "cancelled"],
    in_review: ["approved", "refused", "postponed", "cancelled"],
    approved: ["paid", "postponed", "cancelled"],
    postponed: ["registered", "in_review", "approved", "cancelled"],
    refused: [],
    paid: [],
    cancelled: [],
  },
};

/** الحالات غير النهائية — «مرفوضة» مسموحة منها من أي حالة غير نهائية (نص المهمة) */
export function claimTransitionAllowed(direction: string, from: string, to: string): boolean {
  const allowed = CLAIM_NEXT[direction]?.[from] || [];
  if (allowed.includes(to)) return true;
  // الرفض من أي حالة غير نهائية (غير محصّلة/مدفوعة/مرفوضة/ملغاة)
  if (to === "refused" && !CLAIM_FINAL_STATUSES.includes(from)) return true;
  return false;
}

/** المتأخر = معتمدة وتجاوزت استحقاقها بلا تحصيل/دفع (كالمصدر is_overdue) */
export function claimIsOverdue(row: { status: string; dueDate: string }, today: string): boolean {
  if (row.status !== "approved") return false;
  const due = (row.dueDate || "").trim();
  if (!due) return false;
  return due < today;
}
