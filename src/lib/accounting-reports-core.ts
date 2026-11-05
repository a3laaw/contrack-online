/**
 * accounting-reports-core.ts — نواة مخرجات المحاسبة النقية (بلا React ولا server-only) — Task 108.
 * دفتر الأستاذ + ميزان المراجعة + أعمار الذمم — كلها دوال نقية قابلة للاختبار بـ bun test مباشرة،
 * والخادم (accounting-reports-server) يغذيها من الأستاذ عبر SQL داخل سياق الشركة.
 *
 * قرارات التصميم الموثقة (docs/roadmap-accounting.md — Task 108):
 *  • الأستاذ مصدر الحقيقة الوحيد: الحركات من القيود posted حصرًا — الملغى/المسودة لا يُحسب.
 *  • الرصيد الموقَّع موحد الدلالة: مدين موجب / دائن سالب — نفس دلالة openingBalance (Task 103)،
 *    والعرض في العمود بطرفيه (مدين/دائن) لا بإشارة سالبة ظاهرة.
 *  • أعمار الذمم بالتسوية FIFO: الدفعات تُسوّى أقدم بند مدين أولًا (للعملاء) وأقدم بند دائن
 *    أولًا (للباطن) — الأعمار من تاريخ البنود المفتوحة المتبقية لا من آخر حركة.
 *  • الأعمار من «الجانب التحليلي» لسطور القيد: بُعد customerId على حسابات الذمم 112x للعملاء،
 *    وبُعد subContractId على حسابات 212x للباطن — أقسام الدليل القياسي الموثقة في البذرة.
 *  • ميزان المراجعة يُجمَّع بالـSQL (groupBy على journal_line) لا بإعادة الحساب في JS.
 */

import type { ReportTable } from "./report-server";
import { r3 } from "./accounting-journal";

// ==================== أنواع مشتركة ====================

export type AgingKind = "customers" | "subcontractors";

/** حركة أستاذ جاهزة للعرض — الجانب النقية قبل بناء الرصيد الجاري */
export interface GlMovement {
  entryNo: number;
  entryDate: string;
  description: string;
  lineDescription: string;
  debit: number;
  credit: number;
  sourceType: string;
  /** الأبعاد الظاهرة — أسماء محسومة من الخادم */
  customerName?: string;
  contractNumber?: string;
  subcontractLabel?: string;
  costCenter?: string;
}

export type BalanceSide = "debit" | "credit";

/** صف دفتر الأستاذ بالرصيد الجاري — الرصيد موقَّع (مدين موجب) مع طرفه الظاهر */
export interface GlRow extends GlMovement {
  balance: number; // القيمة المطلقة المعروضة
  balanceSide: BalanceSide;
}

/**
 * بناء صفوف دفتر الأستاذ برصيد جارٍ من افتتاحي موقَّع + حركات مرتبة زمنيًا.
 * الرصيد الموقَّع = مدين موجب / دائن سالب، والعمود يعرض القيمة المطلقة مع طرفها.
 */
export function buildGlRows(openingSigned: number, movements: GlMovement[]): GlRow[] {
  let signed = r3(openingSigned);
  const rows: GlRow[] = [];
  for (const m of movements) {
    signed = r3(signed + r3(m.debit) - r3(m.credit));
    rows.push({
      ...m,
      debit: r3(m.debit),
      credit: r3(m.credit),
      balance: r3(Math.abs(signed)),
      balanceSide: signed >= 0 ? "debit" : "credit",
    });
  }
  return rows;
}

// ==================== أعمار الذمم ====================

export const AGING_BUCKET_LABELS = ["حتى 30 يوم", "31–60", "61–90", "فوق 90"] as const;

/** فهرس_bucket من أيام الانقطاع: ≤30 → 0 · 31–60 → 1 · 61–90 → 2 · >90 → 3 · المستقبل → 0 */
export function agingBucketIndex(daysPast: number): 0 | 1 | 2 | 3 {
  if (daysPast <= 30) return 0;
  if (daysPast <= 60) return 1;
  if (daysPast <= 90) return 2;
  return 3;
}

/** فرق الأيام بين تاريخين ISO (YYYY-MM-DD) — asOf − date · تاريخ مستقبل = 0 */
export function daysPast(asOf: string, date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
  const a = Date.UTC(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)) - 1, Number(asOf.slice(8, 10)));
  const d = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return Math.max(0, Math.round((a - d) / 86_400_000));
}

export interface AgingLine {
  date: string;
  debit: number;
  credit: number;
}

export interface AgingResult {
  /** صافي المديونية القائمة بالقيمة المطلقة — صفر إذا لا بند مفتوح */
  balance: number;
  /** طبيعة المديونية القائمة: debit = مدين عليه (عميل مديون) · credit = دائن (سلفة/دفع مقدم) */
  direction: BalanceSide | null;
  buckets: [number, number, number, number];
  oldestDays: number | null;
  lastActivity: string;
}

/**
 * أعمار طرف واحد بالتسوية FIFO — nature طبيعة حساب الذمم (عملاء مدين · باطن دائن).
 * الفواتير/الاستحقاق بندها المفتوح تُشيَّخ بتاريخها، والسداد يستهلك الأقدم أولًا.
 * فائض التسوية بلا بنود مفتوحة يُحمَل للأمام (رصيد معاكس) ويُسوّى بالبنود اللاحقة —
 * فلا يظهر عميل مديونًا بمبلغ تجاهله دفعة مقدمه السابقة (اتساق مع رصيد الأستاذ).
 * إن بقي الفائض بعد آخر بند = رصيد معاكس يظهر في الحالية بإشارة اتجاهه.
 */
export function fifoAging(
  lines: AgingLine[],
  asOf: string,
  nature: "debit" | "credit"
): AgingResult {
  // الترتيب الزمني داخل مجموعة الطرف (الخادم يرسلها مرتبة — والترتيب هنا ضمانة النقاء)
  const ordered = [...lines].sort((a, b) =>
    a.date === b.date ? 0 : a.date < b.date ? -1 : 1
  );

  const open: { date: string; remaining: number }[] = []; // بنود مفتوحة بطبيعة الحساب
  let carry = 0; // فائض تسوية محمَّل للأمام
  let lastActivity = "";

  for (const l of ordered) {
    if (!l.date) continue;
    lastActivity = l.date > lastActivity ? l.date : lastActivity;
    const dr = r3(l.debit);
    const cr = r3(l.credit);
    const own = nature === "debit" ? dr : cr; // بند يستحق الشيخوخة
    const other = nature === "debit" ? cr : dr; // تسوية تستهلك الأقدم

    let added = r3(own);
    if (carry > 0.0005 && added > 0) {
      const applied = Math.min(carry, added);
      carry = r3(carry - applied);
      added = r3(added - applied);
    }
    if (added > 0.0005) open.push({ date: l.date, remaining: added });

    let pay = other;
    while (pay > 0 && open.length > 0) {
      const head = open[0];
      const take = Math.min(head.remaining, pay);
      head.remaining = r3(head.remaining - take);
      pay = r3(pay - take);
      if (head.remaining <= 0.0005) open.shift();
    }
    carry = r3(carry + pay); // فائض التسوية بلا بنود مفتوحة
  }

  const buckets: [number, number, number, number] = [0, 0, 0, 0];
  let oldestDays: number | null = null;
  let balance = 0;
  for (const item of open) {
    const dp = daysPast(asOf, item.date);
    buckets[agingBucketIndex(dp)] = r3(buckets[agingBucketIndex(dp)] + item.remaining);
    balance = r3(balance + item.remaining);
    oldestDays = oldestDays == null ? dp : Math.max(oldestDays, dp);
  }

  if (balance > 0.0005) {
    return { balance, direction: nature, buckets, oldestDays, lastActivity };
  }
  // لا بنود مفتوحة — فائض تسوية = رصيد معاكس (دفع مقدم للعميل / سداد زائد للباطن)
  if (carry > 0.0005) {
    buckets[0] = r3(-carry);
    return { balance: carry, direction: nature === "debit" ? "credit" : "debit", buckets, oldestDays: null, lastActivity };
  }
  return { balance: 0, direction: null, buckets: [0, 0, 0, 0], oldestDays: null, lastActivity };
}

// ==================== ميزان المراجعة ====================

export interface TbAccountRow {
  accountId: number;
  code: string;
  name: string;
  type: string;
  /** الصافي الموقَّع: مدين موجب / دائن سالب (شامل الافتتاحي) */
  net: number;
  opening: number;
  movementDr: number;
  movementCr: number;
}

/** صف ميزان: الصافي الموجب في عمود المدين والسالب في عمود الدائن (بالقيمة المطلقة) */
export function tbDebitCredit(row: TbAccountRow): { debit: number; credit: number } {
  return row.net >= 0
    ? { debit: r3(row.net), credit: 0 }
    : { debit: 0, credit: r3(-row.net) };
}

export interface TbTotals {
  debit: number;
  credit: number;
  diff: number;
  balanced: boolean;
}

/** إجمالي الميزان: مجموع عمودي المدين/الدائن المعروضين والفرق — متوازن ضمن فلس */
export function tbTotals(rows: TbAccountRow[]): TbTotals {
  let debit = 0;
  let credit = 0;
  for (const row of rows) {
    const dc = tbDebitCredit(row);
    debit = r3(debit + dc.debit);
    credit = r3(credit + dc.credit);
  }
  const diff = r3(debit - credit);
  return { debit, credit, diff, balanced: Math.abs(diff) < 0.001 };
}

/** ملخّص بالنوع — مجموع الصافي الموقَّع لكل قسم دليل (أصول/التزامات/حقوق/إيرادات/مصروفات) */
export function tbByType(rows: TbAccountRow[]): { type: string; net: number; count: number }[] {
  const map = new Map<string, { net: number; count: number }>();
  for (const row of rows) {
    const cur = map.get(row.type) || { net: 0, count: 0 };
    cur.net = r3(cur.net + row.net);
    cur.count += 1;
    map.set(row.type, cur);
  }
  return Array.from(map.entries()).map(([type, v]) => ({ type, net: v.net, count: v.count }));
}

// ==================== تحويلات التصدير (ReportTable الموحد) ====================

const glDimsText = (m: GlMovement): string => {
  const parts: string[] = [];
  if (m.customerName) parts.push(m.customerName);
  if (m.contractNumber) parts.push(`عقد ${m.contractNumber}`);
  if (m.subcontractLabel) parts.push(m.subcontractLabel);
  if (m.costCenter) parts.push(`مركز: ${m.costCenter}`);
  return parts.join(" · ");
};

/** دفتر الأستاذ → جدول التصدير الموحد (CSV/Excel عبر /api/reports/export) */
export function glReportTable(opts: {
  accountCode: string;
  accountName: string;
  from: string;
  to: string;
  rows: GlRow[];
  opening: number;
  totals: { debit: number; credit: number };
}): ReportTable {
  const rows = opts.rows.map((r) => [
    r.entryDate,
    `#${r.entryNo}`,
    r.lineDescription || r.description,
    glDimsText(r),
    r.debit,
    r.credit,
    r.balance,
    r.balanceSide === "debit" ? "مدين" : "دائن",
  ]);
  return {
    title: `دفتر الأستاذ — ${opts.accountCode} ${opts.accountName}`,
    heads: ["التاريخ", "المرجع", "البيان", "الأبعاد التحليلية", "مدين", "دائن", "الرصيد", "الطرف"],
    rows,
    numberCols: [4, 5, 6],
    accentRows: [],
    totals: ["الإجمالي", "", "", `افتتاحي: ${opts.opening.toFixed(3)}`, opts.totals.debit, opts.totals.credit, "", ""],
    note:
      `الحركات من القيود المنشورة حصرًا${opts.from ? ` من ${opts.from}` : ""}${opts.to ? ` إلى ${opts.to}` : ""}` +
      " — المصدر: الأستاذ العام (JournalLine).",
  };
}

/** ميزان المراجعة → جدول التصدير */
export function tbReportTable(opts: {
  asOf: string;
  rows: TbAccountRow[];
  totals: TbTotals;
}): ReportTable {
  const rows = opts.rows.map((r) => {
    const dc = tbDebitCredit(r);
    return [r.code, r.name, r.movementDr, r.movementCr, dc.debit, dc.credit];
  });
  return {
    title: `ميزان المراجعة حتى ${opts.asOf}`,
    heads: ["الكود", "الحساب", "حركة مدين", "حركة دائن", "رصيد مدين", "رصيد دائن"],
    rows,
    numberCols: [2, 3, 4, 5],
    accentRows: [],
    totals: ["الإجمالي", "", "", "", opts.totals.debit, opts.totals.credit],
    note: `الفارق ${opts.totals.diff.toFixed(3)} — ${opts.totals.balanced ? "الميزان متوازن ✔" : "غير متوازن ✖"} — الافتتاحي موقَّع (مدين موجب/دائن سالب) + حركة القيود المنشورة حتى التاريخ.`,
  };
}

/** أعمار الذمم → جدول التصدير */
export function agingReportTable(opts: {
  kind: AgingKind;
  asOf: string;
  rows: {
    name: string;
    code: string;
    balance: number;
    direction: BalanceSide | null;
    buckets: [number, number, number, number];
    lastActivity: string;
  }[];
  totals: { balance: number; buckets: [number, number, number, number] };
}): ReportTable {
  const rows = opts.rows.map((r) => [
    r.name,
    r.code,
    r.direction === "credit" ? -r.balance : r.balance,
    r.buckets[0],
    r.buckets[1],
    r.buckets[2],
    r.buckets[3],
    r.lastActivity,
  ]);
  return {
    title: `أعمار ${opts.kind === "customers" ? "ذمم العملاء" : "مستحقات الباطن"} حتى ${opts.asOf}`,
    heads: ["الاسم", "الكود", "الرصيد", ...AGING_BUCKET_LABELS, "آخر حركة"],
    rows,
    numberCols: [2, 3, 4, 5, 6],
    accentRows: [],
    totals: ["الإجمالي", "", opts.totals.balance, opts.totals.buckets[0], opts.totals.buckets[1], opts.totals.buckets[2], opts.totals.buckets[3], ""],
    note: "التسوية FIFO — السداد يستهلك أقدم بند أولًا والأعمار من تاريخ البنود المفتوحة على سطور القيد.",
  };
}
