/**
 * fiscal-close-core.ts — نواة الإقفال النقية (بلا React ولا server-only) — Task 109.
 * قرار معماري (docs/roadmap-accounting.md Task 109): فتح/قفل فترة شهرية، قيد إغلاق سنوي
 * للنتيجة إلى الأرباح المحتجزة، افتتاح السنة الجديدة، وسجل إقفالات موثق.
 *
 * قرار هيكلي موثق «افتتاحية السنة الجديدة»: الأستاذ مستمر (JournalLine بلا بعد سنة) —
 * أرصدة الميزانية تُحمل آليًا للسنة التالية، فلا يُنشر قيد افتتاحية فعلي (كان سيزدوج الأرصدة).
 * «الافتتاحية» هنا = ميزان افتتاحي محسوب من الأستاذ بتاريخ نهاية السنة المقفلة (بعد إغلاق
 * النتيجة) يُعرض ويُوثق في سجل الإقفال (openingSnapshot) لأغراض المراجعة — نفس قرار
 * الأنظمة المحاسبية الحديثة (الدفتر المستمر لا يحتاج قيد افتتاح).
 *
 * المنهجية الحسابية (بتوقيع مدين موجب signed = debit − credit):
 *  • كل حساب دخلٍ (إيراد/مصروف) برصيد غير صفري يُقفل بالطرف المعاكس: مدين التوازن ⇒ دائن،
 *    دائن التوازن ⇒ مدين — يعالج الأرصدة المعاكسة تلقائيًا.
 *  • النتيجة الصافية net = إيرادات − مصروفات؛ سطر الأرباح المحتجزة: ربح ⇒ دائن، خسارة ⇒ مدين.
 *  • التوازن مضمون بالبناء: مجموع الأطراف صفر دائمًا.
 */

import { r3 } from "@/lib/accounting-journal";

/** نوع حساب الدخل — المشارك في الإقفال السنوي حصرًا */
export type PnlAccountType = "revenue" | "expense";

/** رصيد حساب دخلٍ موقَّع مدينًا — الإيراد الطبيعي (دائن) سالب والمصروف الطبيعي موجب */
export interface PnlAccountBalance {
  accountId: number;
  code: string;
  name: string;
  type: PnlAccountType;
  signed: number;
}

/** سطر إغلاق جاهز للنشر عبر المحرك الموحد */
export interface ClosingLineDraft {
  accountId: number;
  debit: number;
  credit: number;
  description: string;
}

export interface ClosingBuildResult {
  lines: ClosingLineDraft[];
  totalRevenue: number;
  totalExpense: number;
  net: number; // موجب = ربح، سالب = خسارة
  retainedSide: "debit" | "credit" | null; // null عند تعادل كامل بلا أثر
  retainedAmount: number;
}

/**
 * بناء أسطر قيد الإغلاق السنوي من أرصدة حسابات الدخل — دالة نقية مُختبَرة.
 * تعيد null إن لم يوجد أي رصيد (سنة بلا حركة دخل — لا قيد يُنشر).
 */
export function buildClosingLines(
  balances: PnlAccountBalance[],
  retained: { id: number; name: string }
): ClosingBuildResult | null {
  const active = balances.filter((b) => r3(b.signed) !== 0);
  if (!active.length) return null;

  const lines: ClosingLineDraft[] = [];
  for (const b of active.sort((a, x) => a.code.localeCompare(x.code))) {
    const signed = r3(b.signed);
    const amount = r3(Math.abs(signed));
    lines.push(
      signed > 0
        ? {
            accountId: b.accountId,
            debit: 0,
            credit: amount,
            description: `إقفال رصيد ${b.name} (${b.code})`,
          }
        : {
            accountId: b.accountId,
            debit: amount,
            credit: 0,
            description: `إقفال رصيد ${b.name} (${b.code})`,
          }
    );
  }

  const totalRevenue = r3(
    -balances.filter((b) => b.type === "revenue").reduce((s, b) => s + r3(b.signed), 0)
  );
  const totalExpense = r3(
    balances.filter((b) => b.type === "expense").reduce((s, b) => s + r3(b.signed), 0)
  );
  const net = r3(totalRevenue - totalExpense);

  let retainedSide: ClosingBuildResult["retainedSide"] = null;
  let retainedAmount = 0;
  if (net > 0) {
    retainedSide = "credit"; // الربح يُحمل دائنًا للأرباح المحتجزة
    retainedAmount = net;
    lines.push({
      accountId: retained.id,
      debit: 0,
      credit: net,
      description: `نتيجة السنة (ربح) إلى ${retained.name}`,
    });
  } else if (net < 0) {
    retainedSide = "debit"; // الخسارة تُحمل مدينًا على الأرباح المحتجزة
    retainedAmount = r3(-net);
    lines.push({
      accountId: retained.id,
      debit: retainedAmount,
      credit: 0,
      description: `نتيجة السنة (خسارة) إلى ${retained.name}`,
    });
  }

  return { lines, totalRevenue, totalExpense, net, retainedSide, retainedAmount };
}

// ==================== ميزان الافتتاحية ====================

export interface OpeningSourceRow {
  accountId: number;
  code: string;
  name: string;
  type: string;
  opening: number; // الرصيد الافتتاحي الموقَّع على الحساب (قبل أي قيود)
  movementDr: number;
  movementCr: number;
}

export interface OpeningRow {
  accountId: number;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  net: number;
  side: "debit" | "credit";
}

export interface OpeningTrialResult {
  rows: OpeningRow[];
  totals: { debit: number; credit: number; diff: number };
}

/**
 * ميزان افتتاحي من أرصدة الحسابات — الأسطر ذات الرصيد غير الصفري حصرًا،
 * مرتبة بالكود، والأطراف حسب الجهة. التوازن مضمون (مشتق من أستاذ متوازن).
 */
export function buildOpeningTrialRows(src: OpeningSourceRow[]): OpeningTrialResult {
  const rows: OpeningRow[] = [];
  for (const s of [...src].sort((a, b) => a.code.localeCompare(b.code))) {
    const net = r3(Number(s.opening) + r3(Number(s.movementDr)) - r3(Number(s.movementCr)));
    if (net === 0) continue;
    rows.push({
      accountId: s.accountId,
      code: s.code,
      name: s.name,
      type: s.type,
      debit: net > 0 ? net : 0,
      credit: net < 0 ? r3(-net) : 0,
      net: r3(Math.abs(net)),
      side: net > 0 ? "debit" : "credit",
    });
  }
  const debit = r3(rows.reduce((acc, r) => acc + r.debit, 0));
  const credit = r3(rows.reduce((acc, r) => acc + r.credit, 0));
  return { rows, totals: { debit, credit, diff: r3(debit - credit) } };
}

// ==================== الفترات الشهرية ====================

export const MONTH_NAMES_AR = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
] as const;

/** «2025-03» → «مارس 2025» */
export function monthLabelOf(periodDate: string): string {
  const m = Number(String(periodDate || "").slice(5, 7));
  const y = String(periodDate || "").slice(0, 4);
  const name = MONTH_NAMES_AR[m - 1];
  return name ? `${name} ${y}` : periodDate;
}

// ==================== التحققات ====================

/** تحقق سنة الإقفال — رسالة عربية أو null */
export function validateYearForClose(year: unknown): string | null {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) {
    return "سنة الإقفال غير صحيحة (2000–2100).";
  }
  return null;
}

/** سبب منع إجراء على فترة (فتح/قفل شهر) — null يعني مسموح */
export function validatePeriodToggle(action: "open" | "close", yearStatus: string): string | null {
  if (action === "open" && yearStatus === "closed") {
    return "السنة مقفلة سنويًا — أعد فتح السنة من الإقفال السنوي أولًا.";
  }
  return null;
}

/** مفتاح المصدر لقيود الإغلاق السنوي في الأستاذ */
export const CLOSE_SOURCE_TYPE = "closing";

export const FISCAL_STATUS_LABEL_AR: Record<string, string> = {
  open: "مفتوحة",
  closed: "مقفلة",
  reverted: "معاد للفتح",
};

/** وصف قيد الإغلاق السنوي الموحد */
export function closingEntryDescription(year: number): string {
  return `قيد الإغلاق السنوي لسنة ${year} — تحويل النتيجة إلى الأرباح المحتجزة`;
}
