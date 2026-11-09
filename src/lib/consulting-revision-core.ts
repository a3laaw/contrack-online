/**
 * consulting-revision-core.ts — نواة مراجعات المخططات (docs/revisions-ipc-design.md §1.2)
 * نقية 100% بلا DB ولا React — بند 1 من خريطة NOVA:
 * • آلة حالات مغلقة G7: «بانتظار مراجعة» ⇐ (مقبول | معاد بتعديلات) — القرار نهائي
 * • الترقيم revNo خادميًا لكل (عقد، عنوان): max+1 — بلا قيد فريد (النص الحر لا يُحاصَر)
 * • ملاحظة الإرجاع إلزامية (نمط إجازات المهندسين — توثيق القرار)
 */

export const REVISION_PENDING = "بانتظار مراجعة";
export const REVISION_APPROVED = "مقبول";
export const REVISION_RETURNED = "معاد بتعديلات";

export const REVISION_STATUSES = [REVISION_PENDING, REVISION_APPROVED, REVISION_RETURNED] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

export const REVISION_DECISIONS = [REVISION_APPROVED, REVISION_RETURNED] as const;
export type RevisionDecision = (typeof REVISION_DECISIONS)[number];

export interface RevisionRow {
  title: string;
  revNo: number;
  status: string;
}

/** الترقيم الآلي: أعلى رقم قائم + 1 (القائمة الفارغة تبدأ من 1) */
export function nextRevNo(existingRevNos: number[]): number {
  return existingRevNos.reduce((m, n) => Math.max(m, Math.trunc(Number(n) || 0)), 0) + 1;
}

/** هل الصنف قابل للقرار؟ — المحسوم نهائي (G7) */
export function canDecide(status: string): boolean {
  return status === REVISION_PENDING;
}

/** التعديل قبل الحسم فقط */
export function canEdit(status: string): boolean {
  return status === REVISION_PENDING;
}

/** الحذف قبل الحسم فقط — المحسوم تاريخ لا يُمس */
export function canDelete(status: string): boolean {
  return status === REVISION_PENDING;
}

export type ValidateResult<T> = { ok: true; value: T } | { ok: false; error: string };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** تحقق مدخلات إنشاء/تعديل دورة — العنوان إلزامي والمهندس اختياري بمعرّف موجب */
export function validateRevisionInput(raw: {
  title?: unknown;
  engineerId?: unknown;
  submittedAt?: unknown;
  notes?: unknown;
}): ValidateResult<{ title: string; engineerId: number | null; submittedAt: string; notes: string }> {
  const title = String(raw.title ?? "").trim();
  if (!title) return { ok: false, error: "اسم المخطط/الوثيقة مطلوب" };
  if (title.length > 200) return { ok: false, error: "اسم المخطط طويل — 200 حرف كحد أقصى" };

  let engineerId: number | null = null;
  if (raw.engineerId != null && raw.engineerId !== "") {
    const n = Math.trunc(Number(raw.engineerId));
    if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "المهندس غير صالح" };
    engineerId = n;
  }

  const submittedAt = String(raw.submittedAt ?? "").trim();
  if (submittedAt && !DAY_RE.test(submittedAt)) {
    return { ok: false, error: "تاريخ رفع الإصدار بصيغة YYYY-MM-DD" };
  }

  const notes = String(raw.notes ?? "").trim();
  return { ok: true, value: { title, engineerId, submittedAt, notes } };
}

/** تحقق القرار — الإرجاع بلا ملاحظة مرفوض (توثيق إلزامي) */
export function validateDecision(raw: { decision?: unknown; note?: unknown }): ValidateResult<{ decision: RevisionDecision; note: string }> {
  const decision = String(raw.decision ?? "").trim();
  if (decision !== REVISION_APPROVED && decision !== REVISION_RETURNED) {
    return { ok: false, error: "القرار إما «مقبول» أو «معاد بتعديلات»" };
  }
  const note = String(raw.note ?? "").trim();
  if (decision === REVISION_RETURNED && !note) {
    return { ok: false, error: "سبب الإرجاع إلزامي — وضّح التعديلات المطلوبة" };
  }
  return { ok: true, value: { decision: decision as RevisionDecision, note } };
}

export interface RevisionKpis {
  pending: number;
  approved: number;
  returned: number;
  /** دورات نشطة = عناوين آخر إصدار فيها ليس «مقبولًا» */
  activeCycles: number;
}

/** مؤشرات المراجعات — اشتقاقية حصرًا من الصفوف (درس G9: لا حالة مخزنة) */
export function revisionKpis(rows: RevisionRow[]): RevisionKpis {
  const pending = rows.filter((r) => r.status === REVISION_PENDING).length;
  const approved = rows.filter((r) => r.status === REVISION_APPROVED).length;
  const returned = rows.filter((r) => r.status === REVISION_RETURNED).length;

  const latestByTitle = new Map<string, RevisionRow>();
  for (const r of rows) {
    const cur = latestByTitle.get(r.title);
    if (!cur || r.revNo > cur.revNo) latestByTitle.set(r.title, r);
  }
  const activeCycles = [...latestByTitle.values()].filter((r) => r.status !== REVISION_APPROVED).length;

  return { pending, approved, returned, activeCycles };
}
