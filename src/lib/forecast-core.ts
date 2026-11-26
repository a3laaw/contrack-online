// ============================================================
// forecast-core.ts — نواة م1 النقية: المصالحة بين الرسمي والميداني (بلا I/O)
// ------------------------------------------------------------
// docs/daily-report-forecast-design.md §3 + §9 — docs/forecast-engine-vision.md
//  • بند واحد برؤيتين: الرسمي = Σ أسطر المستخلصات المعتمدة (ز1/ز2) ·
//    الميداني = Σ سجلات التنفيذ (اليومية) — والفجوة بينهما باتجاهين دلالة مختلفة:
//    موجبة = منفذ غير مستخلص (مستحق قادم) · سالبة = مفوتر فوق الميداني (استباق)
//  • المستخلص القادم المتوقع = Σ قيم الفجوات الموجبة حصرًا — «مقترحات لا أفعال»:
//    النواة تقترح، والمال يعبر حصرًا عبر اعتماد موقّع (آلة ز2).
//  • منحنى S: نقاط تراكمية مالية مؤرخة من الحركات نفسها (G9 — لا لقطات مخزنة).
//  • التحذيرات الثلاثة مشتقة لحظيًا (§3.2) — لا إشعارات مخزنة ولا مجدولة.
// قرار الحساب (موثق §9.1): الرسمي مجموع كميات الأسطر لا اللقطات (قرار ز3 —
// اللقطات تتضاعف عبر الفواتير) · الاعتماد الفوري بلا approveAt يُفك إلى تاريخ
// الفاتورة · الأسعار الحالية للبند (حد ز3 §7) · المقارنات النصية الآمنة
// YYYY-MM-DD · كل الدوال نقية قابلة للاختبار المباشر (نمط *-core.ts الموحد).
// م2 (§10 — الجلسة 28): deriveDraftProposal (أسطر المسودة من الفجوات الموجبة —
// مقترح قابل للتحرير لا فعل مالي) + deriveSubMatch (مطابقة الباطن بالميدان
// لكل بند — المرآة الزوجية للمصالحة الرئيسية بأسعار باطن لا عقد) — صفر جداول
// ولا أعمدة: المسودة كائن ز2 والمطابقة مشتق من SubContractItem.boqItemId القائم.
// حدود v1 معلنة: لا مواد/عمالة/نقد (م3) · لا مسار «مخطط» بمنحنى S (ج2) ·
// لا تجميع محفظة — المصالحة على مستوى العقد حصرًا.
// ============================================================

import { r3 } from "./contrack-core";
import { INV_STATE_APPROVED } from "./invoice-state-core";
import {
  boqItemVisibleAt,
  datePart10,
  deriveBoqItemStructure,
  pctOf,
  type BoqStateAddendumInput,
  type BoqStateAddendumItemInput,
} from "./boq-state-core";

// ==================== مدخلات — مرآة ما يجلبهم المسار من القاعدة ====================

export interface ForecastItemInput {
  id: number;
  itemNo: string;
  divisionCode: string;
  divisionName: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  deleted: boolean;
  deletedAddendumId: number;
}

export interface ForecastExecutionInput {
  boqItemId: number;
  /** YYYY-MM-DD */
  executionDate: string;
  qty: number;
  documented: boolean;
}

export interface ForecastInvoiceInput {
  id: number;
  /** YYYY-MM-DD — تاريخ المنشأة (يُفك إليه الاعتماد الفوري بلا approveAt — قرار ز3) */
  invoiceDate: string;
  state: string;
  /** void مستبعدة من كل الاشتقاقات */
  status: string;
  approveAt: string;
}

export interface ForecastLineInput {
  invoiceId: number;
  boqItemId: number | null;
  quantity: number;
}

/** عتبات التحذيرات — افتراضيات موثقة §9.1 (بلا مخزن إعدادات في v1) */
export interface ForecastThresholds {
  /** أيام التوقف المقلق بعد آخر نشاط */
  stallDays: number;
  /** هامش الاستباق — رسمي يتجاوز الميداني بنسبة أكثر منه */
  overrunPct: number;
}

export const DEFAULT_THRESHOLDS: ForecastThresholds = { stallDays: 14, overrunPct: 5 };

// ==================== مخرجات ====================

export interface ForecastRow {
  boqItemId: number;
  itemNo: string;
  divisionCode: string;
  divisionName: string;
  description: string;
  unit: string;
  /** كمية البند الظاهرة عند asOf (القيم الحالية للبند — حد ز3 §7) */
  contractQty: number;
  unitPrice: number;
  /** Σ سجلات التنفيذ ≤ asOf */
  fieldQty: number;
  /** فتعة الميداني الموثقة (شهادة مهندس الموقع) */
  documentedQty: number;
  /** Σ كميات أسطر المستخلصات المعتمدة باعتمادها ≤ asOf */
  officialQty: number;
  /** الفجوة = ميداني − رسمي — موجبة مستحق قادم · سالبة استباق */
  gapQty: number;
  /** قيمة الفجوة = الفجوة × سعر الوحدة — إسهام البند في المستخلص القادم المتوقع */
  gapValue: number;
  /** ما بقي من البند بعد الميداني */
  remainingQty: number;
  fieldAmount: number;
  officialAmount: number;
  /** المعدل اليومي آخر 30 يومًا — صفر بلا نشاط بالنافذة */
  ratePerDay: number;
  /** التاريخ المتوقع للإنجاز لكل بند نشط — null بلا نشاط حديث أو بلا متبقي */
  expectedFinish: string | null;
}

export interface ForecastTotals {
  /** Σ قيم الفجوات الموجبة حصرًا — المستخلص القادم المتوقع */
  expectedNextIpc: number;
  /** الفجوة الكلية ماليًا بإشارتها (موجبة تعويض السالبة) */
  totalGapValue: number;
  fieldAmount: number;
  officialAmount: number;
  /** تغطية الرسمي للميداني ×100 — قد تتجاوز 100 (استباق) */
  coveragePct: number;
}

export interface SCurvePoint {
  /** YYYY-MM-DD */
  date: string;
  /** التراكمي المالي الميداني حتى هذا اليوم */
  fieldCum: number;
  /** التراكمي المالي الرسمي حتى هذا اليوم */
  officialCum: number;
}

export type ForecastWarningKind = "late_billing" | "overrun" | "stalled";

export interface ForecastWarning {
  kind: ForecastWarningKind;
  boqItemId: number;
  itemNo: string;
  description: string;
  /** عنوان عربي جاهز */
  title: string;
  /** رسالة الإدارة — الرقم والمعنى كما تُعرض */
  message: string;
  /** القيمة الدالة على التحذير (قيمة الفجوة / نسبة الاستباق / أيام التوقف) */
  value: number;
}

export interface DeriveForecastResult {
  asOf: string | null;
  /** اليوم المرجعي المستخدم بالمعدلات والتوقف (الحائم = يوم الخادم · التاريخي = asOf) */
  today: string;
  rows: ForecastRow[];
  totals: ForecastTotals;
  sCurve: SCurvePoint[];
  warnings: ForecastWarning[];
}

// ==================== أدوات التاريخ النقية ====================

/** إضافة أيام على تاريخ YYYY-MM-DD — حساب UTC آمن (لا مناطق ولا انزلاق) */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}

/** نافذة المعدل: أول يوم بآخر n يومًا المنتهية باليوم (شاملة) */
export function rateWindowStart(today: string, windowDays: number): string {
  return addDays(today, -(windowDays - 1));
}

// ==================== المحرك الرئيس ====================

/**
 * المحرك الكامل لم1 (§9.1) — بنية الظهور عند asOf + الرؤيتان لكل بند +
 * المستخلص المتوقع + منحنى S + التحذيرات الثلاثة. كل شيء مشتق لحظيًا (G9).
 */
export function deriveForecast(input: {
  asOf: string | null;
  /** يوم الخادم بالوضع الحائم — النواة لا تقرأ الساعة بنفسها */
  today: string;
  items: ForecastItemInput[];
  addendums: BoqStateAddendumInput[];
  addendumItems: BoqStateAddendumItemInput[];
  invoices: ForecastInvoiceInput[];
  lines: ForecastLineInput[];
  executions: ForecastExecutionInput[];
  thresholds?: Partial<ForecastThresholds>;
  /** أيام نافذة المعدل — 30 افتراضيًا (§3.1) */
  rateWindowDays?: number;
}): DeriveForecastResult {
  const { asOf, today } = input;
  const th: ForecastThresholds = { ...DEFAULT_THRESHOLDS, ...(input.thresholds || {}) };
  const windowDays = input.rateWindowDays ?? 30;
  const struct = deriveBoqItemStructure(input.items, input.addendums, input.addendumItems);

  // الرسمي: أسطر المستخلصات المعتمدة حصرًا بتاريخ اعتمادها ≤ asOf (قرار ز3 في
  // فك الاعتماد الفوري إلى تاريخ الفاتورة) — مجموع كميات الأسطر لا اللقطات
  const approveDateById = new Map<number, string>();
  for (const inv of input.invoices) {
    if (inv.status === "void") continue;
    if (inv.state !== INV_STATE_APPROVED) continue; // ز2: المسودة والمقدم لا يستهلكان
    const approveDate = datePart10(inv.approveAt) || datePart10(inv.invoiceDate);
    if (approveDate && (asOf === null || approveDate <= asOf)) {
      approveDateById.set(inv.id, approveDate);
    }
  }
  const officialByItem = new Map<number, number>();
  for (const l of input.lines) {
    if (l.boqItemId == null || l.boqItemId <= 0) continue; // سطر حر — خارج المصالحة بالبند
    if (!(l.quantity > 0)) continue;
    if (!approveDateById.has(l.invoiceId)) continue;
    officialByItem.set(l.boqItemId, r3((officialByItem.get(l.boqItemId) || 0) + Number(l.quantity)));
  }

  // الميداني: Σ التنفيذ ≤ asOf + الموثق فتعة منه + آخر نشاط لكل بند
  const fieldByItem = new Map<number, number>();
  const documentedByItem = new Map<number, number>();
  const lastActivityByItem = new Map<number, string>();
  const recentQtyByItem = new Map<number, number>();
  const windowStart = rateWindowStart(today, windowDays);
  for (const ex of input.executions) {
    const d = datePart10(ex.executionDate);
    if (!d) continue;
    if (asOf !== null && d > asOf) continue;
    const q = Number(ex.qty);
    if (!(q > 0)) continue;
    fieldByItem.set(ex.boqItemId, r3((fieldByItem.get(ex.boqItemId) || 0) + q));
    if (ex.documented) documentedByItem.set(ex.boqItemId, r3((documentedByItem.get(ex.boqItemId) || 0) + q));
    const last = lastActivityByItem.get(ex.boqItemId);
    if (!last || d > last) lastActivityByItem.set(ex.boqItemId, d);
    if (d >= windowStart && d <= today) recentQtyByItem.set(ex.boqItemId, r3((recentQtyByItem.get(ex.boqItemId) || 0) + q));
  }

  // صفوف البنود الظاهرة عند asOf (بنية ز3 المعاد استخدامها) + الاكتمال المتوقع
  const rows: ForecastRow[] = input.items.map((it) => {
    if (!boqItemVisibleAt(struct.get(it.id), it, asOf)) return null;
    const qty = Math.max(0, Number(it.qty) || 0);
    const price = Math.max(0, Number(it.unitPrice) || 0);
    const field = r3(fieldByItem.get(it.id) || 0);
    const official = r3(officialByItem.get(it.id) || 0);
    const gap = r3(field - official);
    const remaining = r3(Math.max(0, qty - field));
    // الاكتمال المتوقع: معدل آخر windowDays يومًا ÷ أيامها — لأي بند نشط بمتبقي
    // (المعدل بدقة كاملة في الحساب — والتقريب للعرض فقط ر3)
    const recent = recentQtyByItem.get(it.id) || 0;
    const rate = recent / windowDays;
    let expectedFinish: string | null = null;
    if (field > 0 && remaining > 0 && rate > 0) {
      expectedFinish = addDays(today, Math.ceil(remaining / rate));
    }
    return {
      boqItemId: it.id,
      itemNo: it.itemNo,
      divisionCode: it.divisionCode,
      divisionName: it.divisionName,
      description: it.description,
      unit: it.unit,
      contractQty: r3(qty),
      unitPrice: r3(price),
      fieldQty: field,
      documentedQty: r3(documentedByItem.get(it.id) || 0),
      officialQty: official,
      gapQty: gap,
      gapValue: r3(gap * price),
      remainingQty: remaining,
      fieldAmount: r3(field * price),
      officialAmount: r3(official * price),
      ratePerDay: r3(rate),
      expectedFinish,
    };
  }).filter((r): r is ForecastRow => r !== null);

  const totals = summarizeForecast(rows);

  // منحنى S — نقاط مالية تراكمية من تواريخ الحركات الفعلية (لا يخفي التاريخ
  // بحالة البند الراهنة: ما نُفذ واعتمد عبر الزمن وقعت بقيمته)
  const sCurve = deriveSCurve({
    priceByItem: new Map(input.items.map((it) => [it.id, Math.max(0, Number(it.unitPrice) || 0)])),
    executions: input.executions.filter((ex) => asOf === null || datePart10(ex.executionDate) <= asOf),
    lines: input.lines,
    approveDateById,
  });

  // التحذيرات الثلاثة — على البنود الظاهرة حصرًا (§3.2)
  const warnings = deriveForecastWarnings(rows, lastActivityByItem, today, th);

  return { asOf, today, rows, totals, sCurve, warnings };
}

// ==================== الإجماليات ====================

/** المستخلص القادم المتوقع = الفجوات الموجبة حصرًا — والسالبة تعبر بالفجوة الكلية بإشارتها */
export function summarizeForecast(rows: ForecastRow[]): ForecastTotals {
  let expectedNextIpc = 0;
  let totalGapValue = 0;
  let fieldAmount = 0;
  let officialAmount = 0;
  for (const r of rows) {
    if (r.gapValue > 0) expectedNextIpc = r3(expectedNextIpc + r.gapValue);
    totalGapValue = r3(totalGapValue + r.gapValue);
    fieldAmount = r3(fieldAmount + r.fieldAmount);
    officialAmount = r3(officialAmount + r.officialAmount);
  }
  return {
    expectedNextIpc,
    totalGapValue,
    fieldAmount,
    officialAmount,
    coveragePct: pctOf(officialAmount, fieldAmount),
  };
}

// ==================== منحنى S ====================

/**
 * نقاط المنحنى التراكمية المالية: اتحاد تواريخ التنفيذ والاعتماد — كل نقطة
 * تراكمي حتى ذلك اليوم شاملًا. الأسطر المرتبطة بالبنود حصرًا (أرضية مشتركة
 * مع الجدول)، والملغاة خارجها أصلاً لأن خريطة الاعتماد بُنيت من غير الملغاة.
 */
export function deriveSCurve(input: {
  priceByItem: Map<number, number>;
  executions: ForecastExecutionInput[];
  lines: ForecastLineInput[];
  approveDateById: Map<number, string>;
}): SCurvePoint[] {
  const byDate = new Map<string, { field: number; official: number }>();
  const bump = (date: string, key: "field" | "official", amount: number) => {
    if (!(amount > 0)) return;
    const cell = byDate.get(date) || { field: 0, official: 0 };
    cell[key] = r3(cell[key] + amount);
    byDate.set(date, cell);
  };
  for (const ex of input.executions) {
    const d = datePart10(ex.executionDate);
    const price = input.priceByItem.get(ex.boqItemId);
    if (!d || price == null) continue;
    bump(d, "field", Number(ex.qty) * price);
  }
  for (const l of input.lines) {
    if (l.boqItemId == null || l.boqItemId <= 0) continue;
    const d = input.approveDateById.get(l.invoiceId);
    const price = input.priceByItem.get(l.boqItemId);
    if (!d || price == null) continue;
    bump(d, "official", Number(l.quantity) * price);
  }
  const dates = Array.from(byDate.keys()).sort();
  let fieldCum = 0;
  let officialCum = 0;
  return dates.map((date) => {
    const cell = byDate.get(date)!;
    fieldCum = r3(fieldCum + cell.field);
    officialCum = r3(officialCum + cell.official);
    return { date, fieldCum, officialCum };
  });
}

// ==================== التحذيرات الثلاثة (§3.2 — مشتقة لا مخزنة) ====================

/**
 * فوترة متأخرة: فجوة موجبة قيمتها > 0 — أعمال منفذة بالموقع لم تُستخلص بعد.
 * استباق مقلق: رسمي > ميداني × (1 + overrunPct/100) بالكمية — يشتعل حتى بميداني
 * صفر وأي رسمي موجبة (فوترة بلا ميدان = أخطر أشكال الاستباق).
 * بند متوقف: بدأ ميدانيًا وآخر نشاط أقدم من stallDays أيام عن اليوم المرجعي.
 */
export function deriveForecastWarnings(
  rows: ForecastRow[],
  lastActivityByItem: Map<number, string>,
  today: string,
  thresholds: ForecastThresholds = DEFAULT_THRESHOLDS
): ForecastWarning[] {
  const out: ForecastWarning[] = [];
  for (const r of rows) {
    if (r.gapQty > 0 && r.gapValue > 0) {
      out.push({
        kind: "late_billing",
        boqItemId: r.boqItemId,
        itemNo: r.itemNo,
        description: r.description,
        title: "فوترة متأخرة",
        message: `البند ${r.itemNo} — فجوة موجبة ${r.gapQty} ${r.unit} بقيمة ${r.gapValue} د.ك: أعمال منفذة لم تُستخلص — حرّر المستخلص القادم`,
        value: r.gapValue,
      });
    }
    const overrunLimit = r3(r.fieldQty * (1 + thresholds.overrunPct / 100));
    if (r.officialQty > overrunLimit) {
      const pct = r.fieldQty > 0 ? Math.round(((r.officialQty / r.fieldQty) - 1) * 1000) / 10 : null;
      out.push({
        kind: "overrun",
        boqItemId: r.boqItemId,
        itemNo: r.itemNo,
        description: r.description,
        title: "استباق مقلق",
        message:
          `البند ${r.itemNo} — رسمي ${r.officialQty} مقابل ميداني ${r.fieldQty} ${r.unit}` +
          (pct !== null ? ` (+${pct}٪)` : " بلا أي ميدان") +
          ": فوترة تتجاوز الواقع — خطر اعتراض الاستشاري وخصم",
        value: pct !== null ? pct : r.officialQty,
      });
    }
    const last = lastActivityByItem.get(r.boqItemId);
    if (r.fieldQty > 0 && last && today && last <= today) {
      const stalledDays = Math.floor((Date.parse(today) - Date.parse(last)) / 86400000);
      if (stalledDays > thresholds.stallDays) {
        out.push({
          kind: "stalled",
          boqItemId: r.boqItemId,
          itemNo: r.itemNo,
          description: r.description,
          title: "بند متوقف",
          message: `البند ${r.itemNo} — آخر نشاط ميداني ${last} (${stalledDays} يومًا دون حركة): توقف يستدعي فحص موقع`,
          value: stalledDays,
        });
      }
    }
  }
  // التوقف أولًا (الأخطر تشغيليًا) ثم الاستباق (الأخطر ماليًا) ثم الفوترة المتأخرة
  const order: Record<ForecastWarningKind, number> = { stalled: 0, overrun: 1, late_billing: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || b.value - a.value);
}

// ==================== م2 — المحرك (§10): المسودة المقترحة + مطابقة الباطن ====================

/** سطر مسودة مقترح — نموذج جاهز يحرَّره المالك ثم يقدّم ويعتمد (§4 الجسر حرفيًا) */
export interface DraftProposalLine {
  boqItemId: number;
  itemNo: string;
  description: string;
  unit: string;
  /** الكمية المقترحة = min(الفجوة الموجبة، المتاح = max(0, تعاقدي − رسمي)) — تمر على حارس المتاح القائم */
  proposedQty: number;
  /** سعر البند الحالي (حد ز3 §7) */
  unitPrice: number;
  /** القيمة بالكمية المقترحة × السعر */
  amount: number;
  /** هل قُصّت الكمية إلى المتاح؟ (فجوة تتجاوز التعاقدي — ميداني فاق التعاقدي) */
  cappedToAvailable: boolean;
}

export interface DraftProposal {
  lines: DraftProposalLine[];
  /** إجمالي المسودة المقترحة = Σ قيم الأسطر */
  total: number;
}

/**
 * أسطر المسودة المقترحة من الفجوات الموجبة حصرًا (§10.1):
 *  • الفجوة موجبة بالكمية والقيمة ⇒ سطر — الموجبة وحدها «منفذ غير مستخلص»؛
 *    السالبة استباق لا يفوتر، والصفرية/بلا قيمة لا معنى لها.
 *  • المتاح = max(0, تعاقدي − رسمي) — المقترح لا يتجاوزه فتُقبل المسودة على
 *    حارس المتاح القائم دون أي تخفيف له (ز1)، والمستهلك بالكامل (المتاح ≤ 0)
 *    مستبعد — استباق الرسمي فوق التعاقدي ليس مسودة.
 *  • بلا فجوات مؤهلة ⇒ قائمة فارغة — والمسار يرفض التحويل برسالة صريحة.
 */
export function deriveDraftProposal(rows: ForecastRow[]): DraftProposal {
  const lines: DraftProposalLine[] = [];
  for (const r of rows) {
    if (!(r.gapQty > 0) || !(r.gapValue > 0)) continue;
    const available = r3(Math.max(0, r.contractQty - r.officialQty));
    if (available <= 0) continue;
    const proposedQty = r3(Math.min(r.gapQty, available));
    if (!(proposedQty > 0)) continue;
    lines.push({
      boqItemId: r.boqItemId,
      itemNo: r.itemNo,
      description: r.description,
      unit: r.unit,
      proposedQty,
      unitPrice: r.unitPrice,
      amount: r3(proposedQty * r.unitPrice),
      cappedToAvailable: proposedQty < r.gapQty,
    });
  }
  return { lines, total: r3(lines.reduce((s, l) => s + l.amount, 0)) };
}

/** سطر شهادة باطن — بمدخلات مرآة ما يجلبهم المسار (الرابط عبر SubContractItem.boqItemId) */
export interface SubMatchCertLineInput {
  /** YYYY-MM-DD — تاريخ الشهادة الحاملة للسطر */
  certDate: string;
  /** مسودة|مقدم|معتمد|مدفوع|ملغي — المستهلك: معتمد|مدفوع حصرًا (مرآة ز2 للباطن) */
  status: string;
  /** بند العقد المرتبط — null = سطر حر خارج المطابقة */
  boqItemId: number | null;
  qty: number;
  /** مبلغ السطر بأسعار الباطن — عرض مرجعي حصرًا */
  amount: number;
}

export interface SubMatchRow {
  boqItemId: number;
  itemNo: string;
  description: string;
  unit: string;
  /** Σ التنفيذ ≤ asOf — نفس اشتقاق م1 */
  fieldQty: number;
  /** Σ أسطر شهادات الباطن المعتمدة/المدفوعة بتاريخ شهادة ≤ asOf */
  subBilledQty: number;
  /** مبلغ الباطن المفوتر بأسعاره — مرجعي لا حاكم */
  subBilledAmount: number;
  /** الفجوة الباطنية = ميداني − فوتر الباطن — موجبة غير مفوتر بعد · سالبة استباق الباطن */
  gapQty: number;
  /** معنى الفجوة جاهزًا نصًا — فارغة عند التوازن */
  meaning: string;
}

/**
 * مطابقة الباطن بالميدان لكل بند (§10.1 — المرآة الزوجية للمصالحة الرئيسية):
 *  • الحصر ببنود العقد **الموكلة للباطن** حصرًا (`SubContractItem.boqItemId`) —
 *    بند بلا موكلة باطنية لا معنى لمطابقته (المقاول الرئيسي ينفذه بنفسه).
 *  • المستهلك من الشهادات: معتمد|مدفوع حصرًا بتاريخ الشهادة ≤ asOf — المسودة
 *    والمقدم لا يستهلكان (الاعتماد لحظة الحقيقة للباطن — مرآة ز2) والملغي خارج.
 *  • المقارنة الحاكمة بالكمية — عملة التشغيل (حد التصور §1)؛ أسعار الباطن ليست
 *    أسعار العقد فمبلغها مرجعي حصرًا.
 */
export function deriveSubMatch(input: {
  rows: ForecastRow[];
  /** بند العقد الموكلة للباطن — القائمة الفريدة لما يرد بالبنود المرتبطة */
  subLinkedItemIds: number[];
  certLines: SubMatchCertLineInput[];
  asOf: string | null;
}): SubMatchRow[] {
  const linked = new Set(input.subLinkedItemIds);
  if (linked.size === 0) return [];
  const billedByItem = new Map<number, { qty: number; amount: number }>();
  for (const cl of input.certLines) {
    if (cl.boqItemId == null || cl.boqItemId <= 0) continue;
    if (cl.status !== "معتمد" && cl.status !== "مدفوع") continue;
    const d = datePart10(cl.certDate);
    if (!d) continue;
    if (input.asOf !== null && d > input.asOf) continue;
    const cell = billedByItem.get(cl.boqItemId) || { qty: 0, amount: 0 };
    cell.qty = r3(cell.qty + Number(cl.qty) || 0);
    cell.amount = r3(cell.amount + Number(cl.amount) || 0);
    billedByItem.set(cl.boqItemId, cell);
  }
  return input.rows
    .filter((r) => linked.has(r.boqItemId))
    .map((r) => {
      const cell = billedByItem.get(r.boqItemId) || { qty: 0, amount: 0 };
      const gap = r3(r.fieldQty - cell.qty);
      const meaning =
        gap > 0
          ? "تنفيذ ميداني لم يفوتره الباطن بعد — مستحق في شهادة الباطن القادمة"
          : gap < 0
            ? "الباطن فوتر فوق الميدان — خطر اعتراض الاستشاري وخصم"
            : "";
      return {
        boqItemId: r.boqItemId,
        itemNo: r.itemNo,
        description: r.description,
        unit: r.unit,
        fieldQty: r.fieldQty,
        subBilledQty: cell.qty,
        subBilledAmount: cell.amount,
        gapQty: gap,
        meaning,
      };
    });
}
