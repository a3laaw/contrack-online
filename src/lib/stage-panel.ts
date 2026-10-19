/**
 * منطق نقي للوحة «🔄 مرحلة التنفيذ» في تفاصيل العقد (المرحلة 7-ب) — بلا قاعدة بيانات
 * مرجعيته المكتبية (followup.py):
 *   :771/:780  _path_badge  → «🔧 مسار يدوي · » / «📏 مسار إجباري · »
 *   :1063      لاحقة نسبة الدفع على شريحة المرحلة (بصيغة %g بلا أصفار زائدة)
 *   :726–746   شارة آخر ملاحظة: اقتطاع 42 حرفًا + «…» وبادئة 📝
 *   :1301–1324 سجل المراحل: «{YYYY-MM-DD HH:mm} — {الوصف} · {المستخدم}»
 *   workflow_service.revert_contract_stage → من المرحلة الحالية إلى آخر مكتملة غير متخطاة
 */

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** شارة المسار قبل اسم المرحلة في الترويسة (followup.py:765 _path_badge) */
export function pathPrefix(isManualPath: boolean): string {
  return isManualPath ? "🔧 مسار يدوي · " : "📏 مسار إجباري · ";
}

/** لاحقة نسبة الدفع على الشريحة — « · 25%» مع اقتصاص الأصفار كصيغة %g المكتبية */
export function pctSuffix(payPct: number | string): string {
  const n = Number(payPct);
  if (!Number.isFinite(n) || n <= 0) return "";
  const trimmed = String(Number(n.toFixed(3)));
  return ` · ${trimmed}%`;
}

/** شارة آخر ملاحظة: ≤42 حرفًا كما هي، وإلا 40 + «…» — وبادئة 📝 (followup.py:732–735) */
export function noteChip(text: string): string {
  const txt = String(text || "");
  const short = txt.length <= 42 ? txt : `${txt.slice(0, 40)}…`;
  return `📝 ${short}`;
}

/** سطر سجل المراحل: «{YYYY-MM-DD HH:mm} — {الوصف} · {المستخدم}» (followup.py:1317) */
export function formatStageHistoryLine(ev: {
  eventTime: string | Date;
  description: string;
  username: string;
}): string {
  let stamp: string;
  if (ev.eventTime instanceof Date) {
    stamp = `${ev.eventTime.getFullYear()}-${pad2(ev.eventTime.getMonth() + 1)}-${pad2(
      ev.eventTime.getDate()
    )} ${pad2(ev.eventTime.getHours())}:${pad2(ev.eventTime.getMinutes())}`;
  } else {
    stamp = String(ev.eventTime || "").replace("T", " ").slice(0, 16);
  }
  return `${stamp} — ${ev.description} · ${ev.username || "مستخدم"}`;
}

export interface RevertStageLike {
  id: number;
  name: string;
  sortOrder: number;
  endDate: string;
  isSkipped: boolean;
}

export interface RevertPlan {
  fromId: number;
  fromName: string;
  toId: number;
  toName: string;
}

/**
 * خطة التراجع: من أول مرحلة غير منتهية (الحالية) إلى آخر مرحلة مكتملة غير متخطاة قبلها —
 * null إن لم توجد وجهة (لا مكتملة سابقة) أو لا توجد مرحلة حالية أصلًا.
 */
export function resolveRevert(stages: RevertStageLike[]): RevertPlan | null {
  const sorted = [...stages].sort((a, b) =>
    a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.id - b.id
  );
  const idx = sorted.findIndex((s) => !s.endDate);
  if (idx <= 0) return null; // لا حالية أو الحالية هي الأولى
  const from = sorted[idx];
  for (let i = idx - 1; i >= 0; i -= 1) {
    const w = sorted[i];
    if (w.endDate && !w.isSkipped) {
      return { fromId: from.id, fromName: from.name, toId: w.id, toName: w.name };
    }
  }
  return null;
}
