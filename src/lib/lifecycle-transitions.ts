/**
 * G7 — الانتقالات الموحدة للحالات (المكتبي unified_cancel_service STATUSES/TRANSITIONS 25–109)
 * بمفردات الويب العربية. المطالبات لديها آلة مكافئة كاملة في claim-server (CLAIM_NEXT/
 * claimTransitionAllowed) — والعهدة في الويب بنموذج حسابات/تسويات بلا عمود حالة، فلا تُحرس هنا.
 * القواعد: الملغى يُسترجع إلى «نشط» فقط · المغلق/المنتهي نهائيان (لا إلغاء من مكتمل — المكتبي).
 * ملف بلا server-only لقابلية الاختبار المباشر.
 */

export type LifecycleEntity = "contract" | "sub_contract";

export const CONTRACT_TRANSITIONS: Record<string, string[]> = {
  "مسودة": ["تحت المراجعة", "معتمد", "نشط", "ملغى"],
  "تحت المراجعة": ["معتمد", "نشط", "ملغى"],
  "معتمد": ["نشط", "متوقف", "ملغى"],
  "نشط": ["متوقف", "منتهي", "مغلق", "ملغى"],
  "متوقف": ["نشط", "منتهي", "مغلق", "ملغى"],
  "منتهي": ["مغلق"],
  "مغلق": [],
  "ملغى": ["نشط"], // استرجاع — المكتبي cancelled→active
};

export const SUB_CONTRACT_TRANSITIONS: Record<string, string[]> = {
  "نشط": ["متوقف", "منتهي", "ملغى"],
  "متوقف": ["نشط", "منتهي", "ملغى"],
  "منتهي": [],
  "ملغى": ["نشط"], // استرجاع
};

export const ENTITY_TRANSITIONS: Record<LifecycleEntity, Record<string, string[]>> = {
  contract: CONTRACT_TRANSITIONS,
  sub_contract: SUB_CONTRACT_TRANSITIONS,
};

export function canTransition(entity: LifecycleEntity, from: string, to: string): boolean {
  if (from === to) return false;
  const allowed = ENTITY_TRANSITIONS[entity]?.[from];
  return Boolean(allowed?.includes(to));
}

/** رسالة الرفض العربية الموحدة — تُستخدم مباشرة في jsonError */
export function transitionError(entity: LifecycleEntity, from: string, to: string): string {
  const allowed = ENTITY_TRANSITIONS[entity]?.[from] ?? [];
  if (allowed.length === 0) return `حالة «${from}» نهائية — لا انتقال منها (الاسترجاع من الملغى فقط).`;
  return `لا يمكن الانتقال من «${from}» إلى «${to}» — المسموح: ${allowed.join(" · ")}`;
}

/** التحقق والرمي عند المخالفة */
export function assertTransition(entity: LifecycleEntity, from: string, to: string): void {
  if (!canTransition(entity, from, to)) {
    throw new Error(transitionError(entity, from, to));
  }
}
