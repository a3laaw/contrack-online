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
// م3 (§11 — الجلسة 31): التشغيل الكامل — deriveMaterialsDemand (الطلب على
// المواد من المتبقي × الاستهلاك المعياري المشتق من سجل الصرف الفعلي:
// StockDocLine.boqItemId وStockDoc.contractId إلزامي — G9 لا خريطة مخزنة) +
// deriveLaborNeed (أفق الأطقم من أقصى إتمام متوقع × تكلفة توزيعات العمالة
// المعتمدة) + deriveCashForecast (صيغة المالك: المستخلص المتوقع − محتجزات −
// استرداد دفعة — والأرصدة الثلاثة من المعتمد حصرًا) — صفر تغييرات مخطط.
// حدود معلنة: لا تجميع محفظة — المصالحة والتشغيل على مستوى العقد حصرًا ·
// الخريطة من سجل الصرف الفعلي (بلا سجل ⇒ بلا صف) · مقترحات لا أفعال.
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

// ==================== م3 — التشغيل الكامل (§11): المواد + العمالة + النقد ====================

/**
 * سطر إذن مخزني مرتبط ببند — مرآة ما يجلبهم المسار من StockDocLine عبر رأسها:
 * الصرف kind=issue والمرتجع entry بـentrySource="return" (د7 — G8: العقد إلزامي
 * بهما) — والإدخال/التحويل/الجرد خارج الاستهلاك، والسطر الحر بلا بند خارج الاشتقاق.
 */
export interface MaterialsIssueLineInput {
  /** YYYY-MM-DD — تاريخ الإذن الحامل للسطر */
  docDate: string;
  /** issue | entry — المرتجع entry بـentrySource="return" */
  kind: string;
  /** "return" لإذن الإدخال المرتجع — فارغ لغيره */
  entrySource: string;
  /** بند العقد المرتبط — null = سطر حر خارج الاشتقاق (حد §11.4) */
  boqItemId: number | null;
  itemId: number;
  itemName: string;
  itemUnit: string;
  qty: number;
  /** لقطة التكلفة المجمّدة على السطر (د2) — أساس القيمة المتوقعة */
  amount: number;
}

/** سطر الطلب — بند جاري × صنف معدله المشتق من سجل الصرف الفعلي (G9 — لا خريطة مخزنة) */
export interface MaterialsDemandLine {
  boqItemId: number;
  itemNo: string;
  description: string;
  unit: string;
  itemId: number;
  itemName: string;
  itemUnit: string;
  /** Σ الاستهلاك الصافي (صرف − مرتجع) ≤ asOf على هذا البند */
  consumedQty: number;
  /** الميداني المنفذ للبند ≤ asOf — قاسم المعدل */
  fieldQty: number;
  /** الاستهلاك المعياري المشتق = الصافي ÷ الميداني */
  ratePerFieldUnit: number;
  /** المتبقي على البند (مخرج م1) */
  remainingQty: number;
  /** الطلب المتوقع = المتبقي × المعدل */
  demandQty: number;
  /** متوسط تكلفة اللقطات المجمّدة = Σ amount ÷ Σ qty الصافية */
  unitCostAvg: number;
  /** قيمة الطلب = الطلب × متوسط التكلفة */
  demandValue: number;
}

/** الطلب المجمّع بالصنف — ما يحتاجه المخزن فعليًا (Σ الأسطر حرفيًا — تناسق مضمون) */
export interface MaterialsDemandByItem {
  itemId: number;
  itemName: string;
  itemUnit: string;
  consumedQty: number;
  demandQty: number;
  demandValue: number;
  /** أرقام بنود العقد المشتركة في الطلب */
  sources: string;
}

export interface MaterialsDemandResult {
  lines: MaterialsDemandLine[];
  byStockItem: MaterialsDemandByItem[];
}

/**
 * الطلب على المواد (تصور §1: «المتبقي بالبنود القادمة × استهلاكها المعياري»):
 *  • الاستهلاك الصافي لكل (بند × صنف) = Σ صرف − Σ مرتجع، بتاريخ الإذن ≤ asOf —
 *    الصافي هو الاستهلاك الحقيقي؛ معدل سالب أو صفر ⇒ بلا صف (بلا افتراض).
 *  • المعدل المعياري = الصافي ÷ الميداني للبند (بميداني > 0 حصرًا) — والطلب =
 *    المتبقي × المعدل للبنود الجارية (متبقي > 0) — بلا سجل صرف ⇒ بلا صف
 *    (حد §6.1 يتحقق ذاته: القاعدة العامة هي معدل السجل الفعلي).
 *  • القيمة بالمتوسط الموزون لتكلفة اللقطات المجمّدة (Σ amount ÷ Σ qty) × الطلب.
 *  • byStockItem = Σ الأسطر حرفيًا — التجميع لا يضيف مصدرًا ثانيًا للحقيقة.
 */
export function deriveMaterialsDemand(input: {
  rows: ForecastRow[];
  issueLines: MaterialsIssueLineInput[];
  asOf: string | null;
}): MaterialsDemandResult {
  // الصافي لكل (بند × صنف): صرف موجب ومرتجع سالب — بإشارة واحدة
  const netQty = new Map<string, number>();
  const netAmount = new Map<string, number>();
  for (const l of input.issueLines) {
    if (l.boqItemId == null || l.boqItemId <= 0) continue; // سطر حر — خارج الاشتقاق
    const isIssue = l.kind === "issue";
    const isReturn = l.kind === "entry" && l.entrySource === "return";
    if (!isIssue && !isReturn) continue; // الإدخال/التحويل/الجرد خارج الاستهلاك
    const d = datePart10(l.docDate);
    if (!d) continue;
    if (input.asOf !== null && d > input.asOf) continue;
    const sign = isIssue ? 1 : -1;
    const key = `${l.boqItemId}:${l.itemId}`;
    netQty.set(key, (netQty.get(key) || 0) + sign * (Number(l.qty) || 0));
    netAmount.set(key, (netAmount.get(key) || 0) + sign * (Number(l.amount) || 0));
  }

  const meta = new Map<number, { name: string; unit: string }>();
  const lines: MaterialsDemandLine[] = [];
  for (const r of input.rows) {
    if (!(r.remainingQty > 0) || !(r.fieldQty > 0)) continue; // الجاري بميدان فقط
    for (const [key, qty] of netQty) {
      if (!key.startsWith(`${r.boqItemId}:`)) continue;
      if (!(qty > 0)) continue; // معدل سالب/صفر ⇒ بلا صف
      const itemId = Number(key.slice(key.indexOf(":") + 1));
      if (!Number.isFinite(itemId) || itemId <= 0) continue;
      if (!meta.has(itemId)) {
        const anyLine = input.issueLines.find(
          (l) => l.itemId === itemId && l.itemName != null
        );
        meta.set(itemId, { name: anyLine?.itemName || `صنف #${itemId}`, unit: anyLine?.itemUnit || "" });
      }
      const rate = qty / r.fieldQty;
      const demand = r3(r.remainingQty * rate);
      if (!(demand > 0)) continue;
      const costBasis = netAmount.get(key) || 0;
      const unitCostAvg = costBasis > 0 ? r3(costBasis / qty) : 0;
      lines.push({
        boqItemId: r.boqItemId,
        itemNo: r.itemNo,
        description: r.description,
        unit: r.unit,
        itemId,
        itemName: meta.get(itemId)!.name,
        itemUnit: meta.get(itemId)!.unit,
        consumedQty: r3(qty),
        fieldQty: r.fieldQty,
        ratePerFieldUnit: r3(rate),
        remainingQty: r.remainingQty,
        demandQty: demand,
        unitCostAvg,
        demandValue: r3(demand * unitCostAvg),
      });
    }
  }

  // التجميع بالصنف — Σ الأسطر حرفيًا + أرقام البنود المصدر
  const byId = new Map<number, MaterialsDemandByItem>();
  for (const l of lines) {
    const cell = byId.get(l.itemId);
    if (cell) {
      cell.consumedQty = r3(cell.consumedQty + l.consumedQty);
      cell.demandQty = r3(cell.demandQty + l.demandQty);
      cell.demandValue = r3(cell.demandValue + l.demandValue);
      if (!cell.sources.includes(l.itemNo)) cell.sources = cell.sources ? `${cell.sources}، ${l.itemNo}` : l.itemNo;
    } else {
      byId.set(l.itemId, {
        itemId: l.itemId,
        itemName: l.itemName,
        itemUnit: l.itemUnit,
        consumedQty: l.consumedQty,
        demandQty: l.demandQty,
        demandValue: l.demandValue,
        sources: l.itemNo,
      });
    }
  }
  return { lines, byStockItem: Array.from(byId.values()) };
}

// ==================== م3 — احتياج العمالة والأطقم ====================

/** سطر توزيع عمالة شهري — مرآة LaborAllocation عبر مسيرها (HR-3 القائم) */
export interface LaborAllocInput {
  /** YYYY-MM شهر المسير الحامل للسطر */
  month: string;
  /** draft|approved|paid|cancelled — المحتسب: approved|paid حصرًا (الاعتماد لحظة الحقيقة) */
  batchStatus: string;
  employeeId: number;
  employeeName: string;
  amount: number;
}

export interface LaborNeedResult {
  /** أقصى تاريخ إتمام متوقع بين البنود النشطة (مخرج م1) — null بلا أفق */
  expectedFinishDate: string | null;
  /** ceil(الأيام ÷ 30) بحد أدنى 1 — null بلا أفق */
  monthsRemaining: number | null;
  /** متوسط Σ أسطر آخر 3 شهور بها توزيع — null بلا توزيعات معتمدة */
  monthlyCostAvg: number | null;
  /** التكلفة المتوقعة للإتمام = الشهرية × الشهور — null بلا أفق أو بلا توزيعات */
  expectedLaborCost: number | null;
  /** عدد الشهور المستخدمة في المتوسط (≤ 3) */
  monthsUsed: number;
}

/**
 * احتياج العمالة والأطقم (تصور §1: «سرعة مستهدفة × المتبقي»):
 *  • الأفق = أقصى تاريخ إتمام متوقع بين البنود النشطة — deriveCompletion م1 لا يُعاد.
 *  • الشهور المتبقية = ceil(الأيام ÷ 30) — بحد أدنى 1 (أفق قائم ⇒ شهر على الأقل).
 *  • التكلفة الشهرية = متوسط Σ أسطر آخر 3 شهور **بها توزيع** (شهر بلا توزيع لا
 *    يُخفف المتوسط) من مسيرات معتمد|مدفوع حصرًا وبتاريخ شهرها ≤ asOf.
 *  • بلا توزيعات ⇒ null «—» — بلا بنود نشطة بأفق ⇒ null — التقدير لا يختلق.
 */
export function deriveLaborNeed(input: {
  today: string;
  rows: ForecastRow[];
  allocations: LaborAllocInput[];
  asOf: string | null;
}): LaborNeedResult {
  // الأفق: أقصى تاريخ إتمام متوقع (البنود النشطة حصرًا — expectedFinish من م1)
  let maxFinish: string | null = null;
  for (const r of input.rows) {
    if (r.expectedFinish && (!maxFinish || r.expectedFinish > maxFinish)) maxFinish = r.expectedFinish;
  }
  let monthsRemaining: number | null = null;
  if (maxFinish && input.today && maxFinish > input.today) {
    const days = Math.ceil((Date.parse(maxFinish) - Date.parse(input.today)) / 86400000);
    monthsRemaining = Math.max(1, Math.ceil(days / 30));
  }

  // التكلفة الشهرية: أسطر المسيرات المعتمدة/المدفوعة بتاريخ شهرها ≤ asOf
  const byMonth = new Map<string, number>();
  for (const a of input.allocations) {
    if (a.batchStatus !== "approved" && a.batchStatus !== "paid") continue;
    if (!/^\d{4}-\d{2}$/.test(a.month || "")) continue;
    if (input.asOf !== null && a.month > input.asOf.slice(0, 7)) continue;
    byMonth.set(a.month, r3((byMonth.get(a.month) || 0) + (Number(a.amount) || 0)));
  }
  const latest = Array.from(byMonth.keys()).sort().reverse().slice(0, 3);
  const sumLatest = r3(latest.reduce((s, m) => s + (byMonth.get(m) || 0), 0));
  const monthlyCostAvg = latest.length > 0 ? r3(sumLatest / latest.length) : null;

  const expectedLaborCost =
    monthlyCostAvg !== null && monthsRemaining !== null ? r3(monthlyCostAvg * monthsRemaining) : null;

  return {
    expectedFinishDate: maxFinish,
    monthsRemaining,
    monthlyCostAvg,
    expectedLaborCost,
    monthsUsed: latest.length,
  };
}

// ==================== م3 — النقد المتوقع ====================

/** فاتورة (المسار يجلبها غير الملغاة — النواة تحصر بالمعتمد بتاريخ اعتماده ≤ asOf) */
export interface CashInvoiceInput {
  id: number;
  /** تاريخ الاعتماد المفكوك (approveAt أو invoiceDate — قرار ز3 الموثق) */
  approveDate: string;
  state: string;
  retentionRate: number;
  retentionAmount: number;
  retentionReleased: boolean;
  /** YYYY-MM-DD فارغ إن لم يُفرج — مرآة retentionReleasedAt */
  retentionReleasedAt: string;
  total: number;
  paidAmount: number;
  advanceRecovered: number;
}

export interface CashForecastResult {
  /** الإجمالي = المستخلص القادم المتوقع (م1) */
  gross: number;
  /** المحتجز المتوقع = الإجمالي × نسبة آخر معتمد (مرآة الإدخال) */
  retentionNext: number;
  /** استرداد الدفعة المتوقع = الإجمالي × نسبة العقد (المرحلة أ) */
  advanceRecoveryNext: number;
  /** النقد الصافي المتوقع = الإجمالي − المحتجز − الاسترداد */
  netExpected: number;
  /** النسبة المستخدمة للعرض (مرآة آخر معتمد — 0 بلا معتمد) */
  retentionRateUsedPct: number;
  /** المحتجزات المتراكمة المحتفظ بها (معتمد غير مفرج عند asOf) */
  retentionHeld: number;
  /** الذمم المفتوحة = Σ max(0, total − paidAmount) للمعتمد */
  openReceivables: number;
  /** المسترد من الدفعة المقدمة حتى asOf */
  advanceRecoveredToDate: number;
  /** المتبقي من الدفعة المقدمة للسداد — أرضية صفر */
  advanceRemaining: number;
}

/**
 * النقد المتوقع (صيغة المالك حرفيًا — تصور §1: «المستخلص المتوقع − (محتجزات +
 * استرداد دفعة + سداد سابق)»): المكوِّنان القائمان بConTrack هما المحتجزات
 * (نسبة آخر معتمد — مرآة الإدخال) واسترداد الدفعة (نسبة العقد). «سداد سابق»
 * قراؤه المباشر استردادُ الدفعة السابقة السداد ذاته فلا يُحسب مرتين (قراءة
 * موثقة §11.1) — وأي خصم إضافي مستقبلي يدخل من حوار المسودة عند تحريره.
 * الأرصدة الثلاثة من المعتمد حصرًا بتاريخ اعتماده ≤ asOf (الاعتماد لحظة
 * الحقيقة — المسودة والمقدم لا يملكان مالًا)، والإفراج عن محتجز لاحق لـasOf
 * يبقى محتفظًا به عند التاريخ (الوضع التاريخي يقرأ ما كان).
 */
export function deriveCashForecast(input: {
  grossExpected: number;
  advanceAmount: number;
  advanceRecoveryPct: number;
  invoices: CashInvoiceInput[];
  asOf: string | null;
}): CashForecastResult {
  const gross = r3(Math.max(0, Number(input.grossExpected) || 0));

  // المعتمد حصرًا بتاريخ اعتماده ≤ asOf — مرتب تصاعديًا (التعادل برقم الفاتورة الأعلى)
  const approved = input.invoices
    .filter(
      (inv) =>
        inv.state === INV_STATE_APPROVED &&
        (input.asOf === null || (inv.approveDate && inv.approveDate <= input.asOf))
    )
    .sort((a, b) => (a.approveDate === b.approveDate ? a.id - b.id : a.approveDate < b.approveDate ? -1 : 1));
  const last = approved.length ? approved[approved.length - 1] : null;
  const retentionRateUsedPct = last ? Math.max(0, Number(last.retentionRate) || 0) : 0;

  const retentionNext = r3((gross * retentionRateUsedPct) / 100);
  const advanceRecoveryNext = r3((gross * Math.max(0, Number(input.advanceRecoveryPct) || 0)) / 100);
  const netExpected = r3(gross - retentionNext - advanceRecoveryNext);

  let retentionHeld = 0;
  let openReceivables = 0;
  let advanceRecoveredToDate = 0;
  for (const inv of approved) {
    const releasedAt = (inv.retentionReleasedAt || "").slice(0, 10);
    const heldAtAsOf =
      !inv.retentionReleased || (input.asOf !== null && !!releasedAt && releasedAt > input.asOf);
    if (heldAtAsOf) retentionHeld = r3(retentionHeld + Math.max(0, Number(inv.retentionAmount) || 0));
    openReceivables = r3(openReceivables + Math.max(0, (Number(inv.total) || 0) - (Number(inv.paidAmount) || 0)));
    advanceRecoveredToDate = r3(advanceRecoveredToDate + Math.max(0, Number(inv.advanceRecovered) || 0));
  }
  const advanceRemaining = r3(Math.max(0, Math.max(0, Number(input.advanceAmount) || 0) - advanceRecoveredToDate));

  return {
    gross,
    retentionNext,
    advanceRecoveryNext,
    netExpected,
    retentionRateUsedPct,
    retentionHeld,
    openReceivables,
    advanceRecoveredToDate,
    advanceRemaining,
  };
}
