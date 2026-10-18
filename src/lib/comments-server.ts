import "server-only";

/** قيم مركز التعليقات الحرفية من المصدر (comment_center_service.py:14–16) */
export const COMMENT_KINDS = ["عام", "مالية", "بلدية", "قانونية", "تنفيذ", "مستندات", "اتصال"] as const;
export const COMMENT_PRIORITIES = ["عادي", "مهم", "عاجل"] as const;
export const COMMENT_STATUSES = ["مفتوح", "تم", "مؤجل", "ملغى"] as const;
