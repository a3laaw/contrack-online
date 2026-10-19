/**
 * منطق نقي لشاشة المتابعة (المرحلة 7-أ) — بلا قاعدة بيانات وإنما قابل للاختبار
 * مرجعيته المكتبية:
 *   lifecycle_service.py:412 get_expiry_alert_days · :429 expiring_contracts · :5281 overdue_collections
 *   supervision_service.py:431 contracts_in_extension (فلترة الحالة)
 *   workflow_service.py:5230 execution_alerts (متأخر/قارب) · main_window.py:287 تدرّج ألوان الانتهاء
 */
import { daysBetween } from "@/lib/contrack-core";

// ===== حالات العقود (مرآة نصية لثوابت report-server لتبقى هذه الوحدة نقية) =====
const AR_CANCELLED = ["ملغى", "ملغي"];
const AR_DRAFT = ["مسودة"];
const AR_CLOSED = ["مغلق"];
const AR_FINISHED = ["منتهي"];

/** تعثر التحصيل: يستبقي مغلق/ملغى/مسودة كالمكتبي (lifecycle:5303) — لا يستبقي منتهي */
export function isFollowupCollection(status: string): boolean {
  return !AR_CANCELLED.includes(status) && !AR_DRAFT.includes(status) && !AR_CLOSED.includes(status);
}

/** عقود تنتهي قريبًا: يستبقي مغلق/ملغى/منتهي كالمكتبي (lifecycle:437) */
export function isFollowupExpiring(status: string): boolean {
  return !AR_CANCELLED.includes(status) && !AR_CLOSED.includes(status) && !AR_FINISHED.includes(status);
}

/** تنبيهات مراحل التنفيذ: العقود السارية فقط (بلا مغلق/ملغى/مسودة) */
export function isFollowupExecutionContract(status: string): boolean {
  return !AR_CANCELLED.includes(status) && !AR_CLOSED.includes(status) && !AR_DRAFT.includes(status);
}

// ===== 1) تدرّج تنبيه الانتهاء (GAP 1) =====

/** تفكيك «أيام التنبيه» نصيًا كالمكتبي: أعداد صحيحة فقط، ترتيب تصاعدي بلا تكرار */
export function parseExpiryLevels(raw: string | undefined | null): number[] {
  const days: number[] = [];
  for (const part of String(raw ?? "").split(",")) {
    const t = part.trim();
    if (/^-?\d+$/.test(t)) days.push(Number.parseInt(t, 10));
  }
  return [...new Set(days)].sort((a, b) => a - b);
}

/** المستويات مع ضمان الافتراضي 90,60,30,7 عند التلف (تصاعديًا) */
export function expiryLevelsOrDefault(raw: string | undefined | null): number[] {
  const levels = parseExpiryLevels(raw);
  return levels.length > 0 ? levels : [7, 30, 60, 90];
}

export type ExpiryTier = "deep" | "warn" | "info";

/**
 * مستوى التنبيه لمتبقٍ معطى: أصغر حدّ L يحقق daysLeft ≤ L —
 * deep إذا كان L أصغر مستوى، warn إذا الثاني، وإلا info (main_window.py:287).
 */
export function expiryTier(daysLeft: number, levelsRaw: string | undefined | null): ExpiryTier {
  const levels = expiryLevelsOrDefault(levelsRaw);
  const window = levels[levels.length - 1];
  if (daysLeft > window) return "info";
  const L = levels.find((d) => daysLeft <= d) ?? window;
  if (L === levels[0]) return "deep";
  if (L === levels[1]) return "warn";
  return "info";
}

// ===== 2) تمديد إشراف (GAP 2) =====

export interface SupervisionStageLike {
  isSupervision: boolean;
  supEnd: string;
  supActualEnd: string;
}

/**
 * مرحلة إشراف في التمديد: نهاية الأساس مرّت والتمديد ما زال ساريًا
 * (لم تنهَ فعليًا أو نهايتها الفعلية لم تأتِ بعد).
 */
export function isSupervisionInExtension(stage: SupervisionStageLike, today: string): boolean {
  if (!stage.isSupervision) return false;
  if (!stage.supEnd) return false;
  if (!(today > stage.supEnd)) return false;
  if (stage.supActualEnd && today > stage.supActualEnd) return false;
  return true;
}

// ===== 3) تنبيهات مراحل التنفيذ (GAP 3) — منطق مشترك مع تقرير مراحل التنفيذ =====

export interface StageExecLike {
  name: string;
  startDate: string;
  endDate: string;
  isSkipped: boolean;
  expectedDays: number;
}

export interface StageExecAlert {
  kind: "overdue" | "near";
  daysIn: number;
  expected: number;
  over?: number;
  left?: number;
}

/**
 * حالة المرحلة الجارية: overdue إذا تجاوزت الأيام المتوقع، near إذا اقتربت (≥ المتوقع − 3) —
 * نفس معيار تقرير مراحل التنفيذ الحرفي؛ null = بلا تنبيه.
 */
export function classifyStageExecution(stage: StageExecLike, today: string): StageExecAlert | null {
  if (stage.isSkipped) return null;
  if (!stage.startDate || stage.endDate) return null;
  const expected = Number(stage.expectedDays) || 0;
  if (expected <= 0) return null;
  const daysIn = Math.max(0, daysBetween(stage.startDate, today));
  if (daysIn > expected) return { kind: "overdue", daysIn, expected, over: daysIn - expected };
  if (daysIn >= expected - 3) return { kind: "near", daysIn, expected, left: expected - daysIn };
  return null;
}

export interface ExecutionContractInput {
  id: number;
  contractNumber: string;
  customerName: string;
  status: string;
  stages: StageExecLike[];
}

export interface ExecutionAlertRow {
  contractId: number;
  contractNumber: string;
  customerName: string;
  stageName: string;
  kind: "overdue" | "near";
  daysIn: number;
  expected: number;
  over?: number;
  left?: number;
}

/** بناء صفوف التنبيهات: المتأخرون أولًا (بالتجاوز تنازليًا) ثم القاربون (بما بقي تصاعديًا) */
export function buildExecutionAlertRows(contracts: ExecutionContractInput[], today: string): ExecutionAlertRow[] {
  const out: ExecutionAlertRow[] = [];
  for (const c of contracts) {
    if (!isFollowupExecutionContract(c.status)) continue;
    const current = c.stages.find((s) => s.startDate && !s.endDate && !s.isSkipped);
    if (!current) continue;
    const alert = classifyStageExecution(current, today);
    if (!alert) continue;
    out.push({
      contractId: c.id,
      contractNumber: c.contractNumber,
      customerName: c.customerName,
      stageName: current.name,
      kind: alert.kind,
      daysIn: alert.daysIn,
      expected: alert.expected,
      ...(alert.kind === "overdue" ? { over: alert.over } : { left: alert.left }),
    });
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "overdue" ? -1 : 1;
    if (a.kind === "overdue") return (b.over ?? 0) - (a.over ?? 0) || b.daysIn - a.daysIn;
    return (a.left ?? 0) - (b.left ?? 0) || b.daysIn - a.daysIn;
  });
  return out;
}
