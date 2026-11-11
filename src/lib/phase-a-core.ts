// ============================================================
// phase-a-core.ts — نواة المرحلة (أ) النقية (بلا I/O)
// ------------------------------------------------------------
// docs/retention-subipc-advance-design.md §1-§3
//  §1 المحتجزات على مستخلص العميل (Retention)
//  §2 استرداد الدفعة المقدمة (Advance Recovery)
//  §3 مستخلص الباطن SubIPC — آلة حالات مغلقة + التراكمي الكمي
// كل الدوال hereزية قابلة للاختبار المباشر (نمط *-core.ts الموحد)
// ============================================================

import { EPS, r3 } from "./contrack-core";

// ==================== §1 المحتجزات ====================

/** سقف نسبة المحتجزات (NOVA IPC) — 0-25% */
export const RETENTION_RATE_MAX = 25;

export function validateRetentionRate(raw: unknown): { ok: true; rate: number } | { ok: false; error: string } {
  const n = typeof raw === "string" ? Number(raw.trim()) : Number(raw);
  if (raw === undefined || raw === null || raw === "" || !Number.isFinite(n)) {
    return { ok: true, rate: 0 };
  }
  if (n < 0 || n > RETENTION_RATE_MAX) {
    return { ok: false, error: `نسبة المحتجزات يجب أن تكون بين 0 و ${RETENTION_RATE_MAX}%` };
  }
  return { ok: true, rate: r3(n) };
}

/** المحتجز الفعلي = round3(total × rate/100) */
export function computeRetentionAmount(total: number, rate: number): number {
  if (!(rate > 0) || !(total > 0)) return 0;
  return r3((total * rate) / 100);
}

/** صافي المطلوب نقدًا = total − المحتجزات − المسترد من الدفعة المقدمة (حقل عرض لا مخزّن) */
export function computeNetDue(total: number, retentionAmount: number, advanceRecovered: number): number {
  return r3(total - retentionAmount - advanceRecovered);
}

/** حواجز الإفراج عن المحتجزات — قيد واحد متوازن عبر postJournalEntry */
export function canReleaseRetention(inv: {
  status: string;
  retentionAmount: number;
  retentionReleased: boolean;
}): { ok: boolean; error?: string } {
  if (inv.status === "void") return { ok: false, error: "الفاتورة ملغاة — لا إفراج عن محتجزاتها" };
  if (!(inv.retentionAmount > EPS)) return { ok: false, error: "لا توجد محتجزات على هذه الفاتورة" };
  if (inv.retentionReleased) return { ok: false, error: "المحتجزات مُفرج عنها من قبل" };
  return { ok: true };
}

/**
 * أسطر قيد الإصدار الموسّع (§1.2):
 *   مدين ذمم/فرعي (total − R) · مدين محتجزات العملاء (R) · دائن إيرادات (total)
 * بلا محتجزات = السطران القائمان حرفيًا (تغيير جذري صفر على المسار الحالي).
 */
export interface RetentionEntryLineInput {
  accountId: number;
  debit: number;
  credit: number;
  description: string;
  customerId?: number | null;
  contractId?: number | null;
}

export function buildInvoiceIssueLines(args: {
  receivableAccountId: number;
  retentionAccountId: number | null;
  revenueAccountId: number;
  total: number;
  retentionAmount: number;
  dims?: { customerId?: number | null; contractId?: number | null };
  receivableName: string;
  retentionName: string;
  revenueName: string;
}): RetentionEntryLineInput[] {
  const { total, retentionAmount, dims } = args;
  const retention = retentionAmount > EPS ? r3(retentionAmount) : 0;
  const net = r3(total - retention);
  const base = { customerId: dims?.customerId ?? null, contractId: dims?.contractId ?? null };
  if (retention <= EPS || !args.retentionAccountId) {
    // المسار القائم حرفيًا — سطران
    return [
      { accountId: args.receivableAccountId, debit: total, credit: 0, description: args.receivableName, ...base },
      { accountId: args.revenueAccountId, debit: 0, credit: total, description: args.revenueName, ...base },
    ];
  }
  return [
    { accountId: args.receivableAccountId, debit: net, credit: 0, description: args.receivableName, ...base },
    { accountId: args.retentionAccountId, debit: retention, credit: 0, description: args.retentionName, ...base },
    { accountId: args.revenueAccountId, debit: 0, credit: total, description: args.revenueName, ...base },
  ];
}

// ==================== §2 استرداد الدفعة المقدمة ====================

/**
 * لقطة الاسترداد المحسوبة خادميًا عند الإصدار (§2.1):
 *   advanceRecovered = min(round3(total × pct/100), advanceAmount − Σ المسترد سابقًا)
 * قرار معلن (§2.2): الاسترداد جدولة تحصيل لا حركة حساب — لا يدخل القيد.
 */
export function computeAdvanceRecovery(
  total: number,
  pct: number,
  advanceAmount: number,
  alreadyRecovered: number
): number {
  if (!(pct > 0) || !(advanceAmount > EPS)) return 0;
  const want = r3((total * pct) / 100);
  const remaining = r3(advanceAmount - Math.max(0, alreadyRecovered));
  if (remaining <= EPS) return 0;
  return r3(Math.max(0, Math.min(want, remaining)));
}

/** التحقق من حقول الدفعة المقدمة على العقد (PATCH) */
export function validateAdvanceFields(body: { advanceAmount?: unknown; advanceRecoveryPct?: unknown }):
  | { ok: true; advanceAmount?: number; advanceRecoveryPct?: number }
  | { ok: false; error: string } {
  const out: { advanceAmount?: number; advanceRecoveryPct?: number } = {};
  if (body.advanceAmount !== undefined) {
    const a = Number(body.advanceAmount);
    if (!Number.isFinite(a) || a < 0) return { ok: false, error: "الدفعة المقدمة لا يمكن أن تكون سالبة" };
    out.advanceAmount = r3(a);
  }
  if (body.advanceRecoveryPct !== undefined) {
    const p = Number(body.advanceRecoveryPct);
    if (!Number.isFinite(p) || p < 0 || p > 100) {
      return { ok: false, error: "نسبة استرداد الدفعة المقدمة يجب أن تكون بين 0 و 100" };
    }
    out.advanceRecoveryPct = r3(p);
  }
  return { ok: true, ...out };
}

// ==================== §3 مستخلص الباطن SubIPC ====================

/** آلة الحالات المغلقة (G7 — قرار نهائي) */
export const SUBCERT_DRAFT = "مسودة";
export const SUBCERT_SUBMITTED = "مقدم";
export const SUBCERT_APPROVED = "معتمد";
export const SUBCERT_PAID = "مدفوع";
export const SUBCERT_CANCELLED = "ملغي";
export const SUBCERT_STATUSES = [
  SUBCERT_DRAFT,
  SUBCERT_SUBMITTED,
  SUBCERT_APPROVED,
  SUBCERT_PAID,
  SUBCERT_CANCELLED,
] as const;

export function canSubCertEdit(status: string): boolean {
  return status === SUBCERT_DRAFT; // تعديل: مسودة حصرًا
}
export function canSubCertDelete(status: string): boolean {
  return status === SUBCERT_DRAFT; // حذف: مسودة حصرًا
}
export function canSubCertSubmit(status: string): boolean {
  return status === SUBCERT_DRAFT;
}
export function canSubCertApprove(status: string): boolean {
  return status === SUBCERT_SUBMITTED;
}
export function canSubCertPay(status: string): boolean {
  return status === SUBCERT_APPROVED; // الصرف: معتمد حصرًا
}
/** الإلغاء من الثلاثة الأولى — المدفوع يُعالج عبر إلغاء سند الصرف (رجوع آلي لمعتمد) */
export function canSubCertCancel(status: string): boolean {
  return status === SUBCERT_DRAFT || status === SUBCERT_SUBMITTED || status === SUBCERT_APPROVED;
}

/** المتاح من بند = كميته − Σ كميات المستخلصات غير الملغاة السابقة */
export function subItemAvailable(itemQty: number, usedQty: number): number {
  return r3(Math.max(0, r3(itemQty) - Math.max(0, usedQty)));
}

export interface SubCertLineInput {
  subItemId: number | null;
  description: string;
  qty: number;
  unitPrice: number;
}

/**
 * تحقق أسطر المستخلص: الكمية > 0 وتجاور المتاح الكمي للبند (§3.4).
 * الدالة نقية — جلب المتاحات (itemQty − Σ المستخلصات غير الملغاة) مسؤولية المستدعي.
 */
export function validateSubCertLines(
  lines: SubCertLineInput[],
  availabilityByItemId: Map<number, number>
): { ok: true; gross: number } | { ok: false; error: string } {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { ok: false, error: "المستخلص يحتاج سطرًا واحدًا على الأقل" };
  }
  let gross = 0;
  for (const [i, l] of lines.entries()) {
    const description = String(l.description ?? "").trim();
    const qty = Number(l.qty);
    const unitPrice = Number(l.unitPrice);
    if (!description) return { ok: false, error: `السطر ${i + 1}: الوصف مطلوب` };
    if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: `السطر ${i + 1}: الكمية يجب أن تكون أكبر من صفر` };
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return { ok: false, error: `السطر ${i + 1}: سعر الوحدة غير صالح` };
    if (l.subItemId != null && l.subItemId > 0) {
      const available = availabilityByItemId.get(l.subItemId);
      if (available === undefined) return { ok: false, error: `السطر ${i + 1}: بند العقد الباطن غير موجود` };
      if (qty > available + EPS) {
        return { ok: false, error: `السطر ${i + 1}: الكمية ${qty} تتجاوز المتاح من البند (${available})` };
      }
    }
    gross += qty * unitPrice;
  }
  return { ok: true, gross: r3(gross) };
}

/** صافي المستخلص = gross − محتجزات − استرداد − خصومات أخرى (≥0) */
export function computeSubCertNet(gross: number, retention: number, advanceRecovery: number, otherDeductions: number): number {
  return r3(Math.max(0, gross - retention - advanceRecovery - otherDeductions));
}

export function validateSubCertDeductions(body: {
  retentionRate?: unknown;
  otherDeductions?: unknown;
}): { ok: true; retentionRate: number; otherDeductions: number } | { ok: false; error: string } {
  const rate = body.retentionRate === undefined || body.retentionRate === null || body.retentionRate === "" ? 0 : Number(body.retentionRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > RETENTION_RATE_MAX) {
    return { ok: false, error: `نسبة المحتجزات يجب أن تكون بين 0 و ${RETENTION_RATE_MAX}%` };
  }
  const other = body.otherDeductions === undefined || body.otherDeductions === null || body.otherDeductions === "" ? 0 : Number(body.otherDeductions);
  if (!Number.isFinite(other) || other < 0) {
    return { ok: false, error: "الخصومات الأخرى لا يمكن أن تكون سالبة" };
  }
  return { ok: true, retentionRate: r3(rate), otherDeductions: r3(other) };
}

/** مؤشرات مستخلصات الباطن (تراكمي معتمد/مدفوع/محتجز قائم) */
export function subCertKpis(certs: { status: string; netAmount: number; retentionAmount: number; advanceRecovery: number }[]): {
  approvedCumulative: number;
  paidCumulative: number;
  pendingRetention: number;
  count: number;
} {
  let approvedCumulative = 0;
  let paidCumulative = 0;
  let pendingRetention = 0;
  let count = 0;
  for (const c of certs) {
    if (c.status === SUBCERT_CANCELLED) continue;
    count += 1;
    // المحتجز يبقى قائمًا حتى بعد الصرف — الصرف يسدد الصافي، والإفراج عن المحتجز
    // سند صرف لاحق عبر الشاشة القائمة (§3.6 — لا ازدواج حسابين لالتزام واحد)
    if (c.status === SUBCERT_APPROVED || c.status === SUBCERT_PAID) {
      approvedCumulative += c.netAmount;
      pendingRetention += c.retentionAmount;
    }
    if (c.status === SUBCERT_PAID) {
      paidCumulative += c.netAmount;
    }
  }
  return {
    approvedCumulative: r3(approvedCumulative),
    paidCumulative: r3(paidCumulative),
    pendingRetention: r3(pendingRetention),
    count,
  };
}
