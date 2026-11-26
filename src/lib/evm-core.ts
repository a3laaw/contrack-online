// ============================================================
// evm-core.ts — نواة ج2 النقية: مؤشرات القيمة المكتسبة EVM (بلا I/O)
// ------------------------------------------------------------
// docs/project-dashboard-design.md §3 + §8 — بطاقة التصميم §8 قبل الكود.
//  • «إجابة احترافية على متأخرين فين متقدمين فين» — كل المؤشرات مشتقة لحظيًا
//    (G9) فوق مخرجات م1 حصرًا: rows من deriveForecast هي الأرضية المشتركة
//    (قرار §8.2.3 — EV برؤيتيهما من م1 فلا مصدر ثانٍ ولا لقطة مخزنة).
//  • BAC أرضية BOQ لا contract.amount (§8.2.1) · PV من نوافذ ج1 (ب1/ج1) ·
//    AC ثلاثة مكوّنات معلنة: سندات صرف (العقد + شهادات الباطن) + رواتب محملة
//    (HR-3 معتمد|مدفوع بشهرها) + مواد صرف المخزن (قرار §7.2 — الخطر المعلن
//    للاحتساب المزدوج مرئي بالمكوّنات المنفصلة).
//  • القسمة على صفر = null لا صفر (§8.2.5): بلا PV ⇒ SPI null وبلا AC ⇒
//    CPI/EAC null — صفر لا يعني تأخرًا ولا كفاءة، وnull لا تشعل التحذيرات.
//  • الاسم: بطاقة §5 سمته dashboard-core قبل علم الاصطدام — والاسم مشغول
//    بنواة الرئيسية منذ المرحلة 9 — القرار موثق §8: evm-core.ts بلا مساس
//    بالنواة القائمة.
// حدود v1 معلنة: منحنى Late لاحقًا · المرتجعات المخزنية مستبعدة من AC ·
// عتبات الإعدادات المخزنة للشركة ج3 — النواة تُقبل باراميترًا.
// ============================================================

import { daysBetween, r3 } from "./contrack-core";
import { datePart10, pctOf } from "./boq-state-core";
import type { ForecastRow, SCurvePoint } from "./forecast-core";

// ==================== مدخلات — مرآة ما يجلبهم المسار ====================

/** نافذة البند المخططة (ب1/ج1) — للأرضية المشتركة ببنود م1 */
export interface EvmPlanInput {
  boqItemId: number;
  /** YYYY-MM-DD — الفارغ = غير مجدول (خارج PV) */
  plannedStart: string;
  plannedFinish: string;
}

/** سند على العقد — غير الملغاة حصرًا (المسار يفلتر cancelled) */
export interface EvmVoucherInput {
  /** YYYY-MM-DD */
  vdate: string;
  amount: number;
}

/** سطر توزيع عمالة HR-3 — بحالة دفعته وشهرها (دلالة شهرية) */
export interface EvmLaborInput {
  amount: number;
  /** YYYY-MM — شهر دفعة الرواتب الحاملة للتخصيص */
  batchMonth: string;
  /** draft|approved|paid|cancelled — المستهلك: approved|paid حصرًا */
  batchStatus: string;
}

/** سطر إذن صرف مخزني posted على العقد — قرار §7.2 (المواد في AC) */
export interface EvmMaterialInput {
  vdate: string;
  amount: number;
  boqItemId: number | null;
}

/** فاتورة معتمدة (state=معتمد، status≠void) — المفوتر والمحتجز */
export interface EvmInvoiceInput {
  total: number;
  retentionAmount: number;
  retentionReleased: boolean;
  /** YYYY-MM-DD — الاعتماد الفوري يُفك لتاريخ الفاتورة (قرار ز3 — المسار يفكه) */
  approveDate: string;
}

/** عتبات التحذيرات — افتراضيات §8.2.12 (الإعدادات المخزنة ج3) */
export interface EvmThresholds {
  spiMin: number;
  cpiMin: number;
  maxDelayDays: number;
}

export const EVM_DEFAULT_THRESHOLDS: EvmThresholds = { spiMin: 0.95, cpiMin: 0.95, maxDelayDays: 7 };

/**
 * ج3 — تدقيق العتبات القادمة من إعدادات الشركة المخزنة (§9.3):
 * نطاق spiMin/cpiMin ∈ (0,1] وmaxDelayDays ≥ 0 — خارج النطاق أو غير رقم
 * ⇒ سقوط للقيمة الافتراضية (لا قيمة فاسدة تصل النواة ولا 500 لحارس يقرأها).
 * نقية بلا I/O — المدخل مرآة صف الإعدادات كما يعيدها serialize (Decimal نص).
 */
export function parseEvmThresholds(raw?: {
  spiMin?: unknown;
  cpiMin?: unknown;
  maxDelayDays?: unknown;
}): EvmThresholds {
  const ratio = (v: unknown, d: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n <= 1 ? n : d;
  };
  const days = (v: unknown): number => {
    if (v == null || v === "") return EVM_DEFAULT_THRESHOLDS.maxDelayDays; // الغياب لا صفر (Number(null)=0 فخ معلن)
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : EVM_DEFAULT_THRESHOLDS.maxDelayDays;
  };
  return {
    spiMin: ratio(raw?.spiMin, EVM_DEFAULT_THRESHOLDS.spiMin),
    cpiMin: ratio(raw?.cpiMin, EVM_DEFAULT_THRESHOLDS.cpiMin),
    maxDelayDays: days(raw?.maxDelayDays),
  };
}

// ==================== مخرجات ====================

export interface EvmHeader {
  /** min(plannedStart) — null بلا نوافذ */
  projectStart: string | null;
  /** max(plannedFinish) — null بلا نوافذ */
  plannedFinishMax: string | null;
  /** شاملة الطرفين — null بلا نوافذ */
  durationDays: number | null;
  /** مقيدة [0, المدة] — null بلا بداية مخططة */
  elapsedDays: number | null;
  elapsedPct: number | null;
  /** الإتمام المتوقع للعقد = max(expectedFinish) من م1 — null بلا نشاط حديث */
  expectedFinish: string | null;
}

export interface EvmMoney {
  /** Σ فواتير معتمدة total — يشمل الأسطر الحرة (الواقع المالي بالفاتورة) */
  billed: number;
  /** Σ سندات قبض على العقد غير الملغاة */
  collected: number;
  /** Σ محتجز فواتير معتمدة غير مفرج عنه */
  retentionOutstanding: number;
  /** المُحصّل − AC — مقبض نقدي على العقد */
  cashRemaining: number;
  /** AC ÷ الأيام منذ أول حركة صرف (شاملة، حد أدنى 1) — صفر بلا صرف */
  burnPerDay: number;
  /** floor(النقد المتبقي ÷ الحرق) — null بنقد سالب أو حرق صفري */
  runwayDays: number | null;
}

export interface EvmDivisionRow {
  divisionCode: string;
  divisionName: string;
  /** قيمة القسم = Σ تعاقدي×سعر */
  value: number;
  /** وزن القسم = القسم ÷ BAC مشتقًا (§4.5 — الفطيرة) */
  weightPct: number;
  plannedPct: number;
  fieldPct: number;
  officialPct: number;
  delayedCount: number;
  /** أقصى تأخر بالأيام بالقسم — صفر بلا متأخرين */
  maxDelayDays: number;
}

export interface EvmDelayedItem {
  boqItemId: number;
  itemNo: string;
  description: string;
  unit: string;
  plannedFinish: string;
  /** المرجعي − plannedFinish — موجب حصرًا */
  delayDays: number;
  contractQty: number;
  fieldQty: number;
  /** اكتمال ميداني ×100 */
  fieldPct: number;
}

export type EvmWarningKind = "spi_official" | "spi_field" | "cpi_official" | "cpi_field" | "delayed_items";

export interface EvmWarning {
  kind: EvmWarningKind;
  title: string;
  /** رسالة الإدارة — الأرقام والمعنى كما تُعرض */
  message: string;
  /** القيمة الدالة: المؤشر نفسه أو أقصى تأخر */
  value: number;
}

/** نقطة المنحنى الثلاثي — اتحاد تواريخ المخطط (ج1) وحركات م1 (التنفيذ/الاعتماد) */
export interface EvmSCurvePoint {
  date: string;
  /** المخطط التراكمي — خطوة عند كل plannedFinish */
  plannedCum: number;
  officialCum: number;
  fieldCum: number;
}

export interface DeriveEvmResult {
  /** اليوم المرجعي — الحائم يوم الخادم · التاريخي asOf (المسار يحدده) */
  today: string;
  bac: number;
  pv: number;
  evOfficial: number;
  evField: number;
  ac: number;
  /** المكوّنات الثلاثة معلنة دائمًا (§8.1 — الخطر المعلن مرئي) */
  acBreakdown: { vouchers: number; labor: number; materials: number };
  pvPct: number;
  evOfficialPct: number;
  evFieldPct: number;
  spiOfficial: number | null;
  spiField: number | null;
  cpiOfficial: number | null;
  cpiField: number | null;
  /** تقدير الكلفة النهائية = BAC/CPI (§3) — null بلا CPI */
  eacOfficial: number | null;
  eacField: number | null;
  header: EvmHeader;
  sCurve: EvmSCurvePoint[];
  divisions: EvmDivisionRow[];
  delayedItems: EvmDelayedItem[];
  money: EvmMoney;
  warnings: EvmWarning[];
}

// ==================== أدوات نقية ====================

/** القسمة الآمنة: القسمة على صفر ⇒ null لا صفر (§8.2.5) — بدقة كاملة والتقريب للعرض */
export function safeDiv(a: number, b: number): number | null {
  if (!(b > 0)) return null;
  return Math.round((a / b) * 1000) / 1000;
}

// ==================== المحرك الرئيس ====================

/**
 * محرك ج2 الكامل (§8) — فوق مخرجات م1 حصرًا: كل شيء مشتق لحظيًا (G9) —
 * بلا حالة مخزنة ولا مسارات كتابة. بلا بنود ⇒ EVM أصفار/null والمال يشتغل
 * («ج2 يعمل تدريجيًا» §6).
 */
export function deriveEvm(input: {
  /** اليوم المرجعي — الحائم يوم الخادم · التاريخي asOf (§8.2.11) */
  today: string;
  /** ناتج deriveForecast (م1) — البنود الظاهرة بالأرضية المشتركة */
  rows: ForecastRow[];
  plans: EvmPlanInput[];
  /** سندات صرف غير ملغاة: العقد + شهادات الباطن (المسار يوحدهما) */
  paymentVouchers: EvmVoucherInput[];
  /** سندات قبض غير ملغاة على العقد */
  receiptVouchers: EvmVoucherInput[];
  laborAllocations: EvmLaborInput[];
  materialLines: EvmMaterialInput[];
  /** فواتير معتمدة (state=معتمد، status≠void) بتاريخ اعتماد مفكوك */
  approvedInvoices: EvmInvoiceInput[];
  /** منحنى م1 (رسمي/ميداني تراكميان) — المخطط يندمج عليهما */
  sCurve: SCurvePoint[];
  thresholds?: Partial<EvmThresholds>;
}): DeriveEvmResult {
  const today = input.today;
  const th: EvmThresholds = { ...EVM_DEFAULT_THRESHOLDS, ...(input.thresholds || {}) };

  // خريطة النوافذ — للبنود الظاهرة حصرًا (بنود خارج الميدان لا نافذة لها هنا)
  const planByItem = new Map(input.plans.map((p) => [p.boqItemId, p]));

  // ===== BAC وPV (§8.2.1/§8.2.2) — والمخطط التراكمي نقطة عند كل plannedFinish =====
  let bac = 0;
  let pv = 0;
  const plannedByDate = new Map<string, number>();
  for (const r of input.rows) {
    const value = r3(Math.max(0, r.contractQty) * Math.max(0, r.unitPrice));
    bac = r3(bac + value);
    const plan = planByItem.get(r.boqItemId);
    const finish = plan ? datePart10(plan.plannedFinish) : "";
    if (finish && finish <= today && value > 0) {
      pv = r3(pv + value);
      plannedByDate.set(finish, r3((plannedByDate.get(finish) || 0) + value));
    }
  }

  // ===== EV برؤيتين من م1 حصرًا (§8.2.3) =====
  let evOfficial = 0;
  let evField = 0;
  for (const r of input.rows) {
    evOfficial = r3(evOfficial + r.officialAmount);
    evField = r3(evField + r.fieldAmount);
  }

  // ===== AC — المكوّنات الثلاثة (§8.2.4) =====
  let acVouchers = 0;
  for (const v of input.paymentVouchers) {
    const d = datePart10(v.vdate);
    if (!d || d > today) continue;
    acVouchers = r3(acVouchers + Math.max(0, Number(v.amount) || 0));
  }
  let acLabor = 0;
  const laborMonth = today.slice(0, 7);
  for (const l of input.laborAllocations) {
    if (l.batchStatus !== "approved" && l.batchStatus !== "paid") continue;
    const m = String(l.batchMonth || "").slice(0, 7);
    if (!m || m > laborMonth) continue;
    acLabor = r3(acLabor + Math.max(0, Number(l.amount) || 0));
  }
  let acMaterials = 0;
  const materialDates: string[] = [];
  for (const m of input.materialLines) {
    const d = datePart10(m.vdate);
    const amount = Number(m.amount) || 0;
    if (!d || d > today) continue;
    if (amount > 0) {
      acMaterials = r3(acMaterials + amount);
      materialDates.push(d);
    }
  }
  const acBreakdown = { vouchers: acVouchers, labor: acLabor, materials: acMaterials };
  const ac = r3(acVouchers + acLabor + acMaterials);

  // ===== المؤشرات — القسمة على صفر null لا صفر (§8.2.5) =====
  // CPI/EAC من النسبة الخام حصرًا — سلسلة التقريب كانت تنحرف EAC حيًا (EAC = BAC×AC/EV جبريًا)
  const spiOfficial = safeDiv(evOfficial, pv);
  const spiField = safeDiv(evField, pv);
  const cpiOfficialRaw = ac > 0 ? evOfficial / ac : null;
  const cpiFieldRaw = ac > 0 ? evField / ac : null;
  const cpiOfficial = cpiOfficialRaw !== null ? Math.round(cpiOfficialRaw * 1000) / 1000 : null;
  const cpiField = cpiFieldRaw !== null ? Math.round(cpiFieldRaw * 1000) / 1000 : null;
  const eacOfficial = cpiOfficialRaw !== null ? Math.round((bac / cpiOfficialRaw) * 1000) / 1000 : null;
  const eacField = cpiFieldRaw !== null ? Math.round((bac / cpiFieldRaw) * 1000) / 1000 : null;

  // ===== البنود المتأخرة (§8.2.7) — الميداني هو الحقيقة الفيزيائية =====
  const delayedItems: EvmDelayedItem[] = [];
  for (const r of input.rows) {
    const plan = planByItem.get(r.boqItemId);
    const finish = plan ? datePart10(plan.plannedFinish) : "";
    if (!finish || finish >= today) continue; // لم يُستحق بعد — بلا تأخر
    if (!(r.fieldQty < r.contractQty)) continue; // مكتمل ميدانيًا — فجوة فوترة لا تأخر
    const delayDays = daysBetween(finish, today);
    if (!(delayDays > 0)) continue;
    delayedItems.push({
      boqItemId: r.boqItemId,
      itemNo: r.itemNo,
      description: r.description,
      unit: r.unit,
      plannedFinish: finish,
      delayDays,
      contractQty: r.contractQty,
      fieldQty: r.fieldQty,
      fieldPct: pctOf(r.fieldQty, r.contractQty),
    });
  }
  delayedItems.sort((a, b) => b.delayDays - a.delayDays || b.fieldPct - a.fieldPct);

  // ===== الأقسام — الأوزان والأداء مشتقًا (§8.2.8) =====
  const divKey = (code: string, name: string) => `${code}||${name}`;
  const divMap = new Map<
    string,
    { divisionCode: string; divisionName: string; value: number; plannedValue: number; fieldAmount: number; officialAmount: number; delayedCount: number; maxDelayDays: number }
  >();
  const delayByItem = new Map(delayedItems.map((d) => [d.boqItemId, d]));
  for (const r of input.rows) {
    const key = divKey(r.divisionCode, r.divisionName);
    const cell =
      divMap.get(key) ||
      { divisionCode: r.divisionCode, divisionName: r.divisionName, value: 0, plannedValue: 0, fieldAmount: 0, officialAmount: 0, delayedCount: 0, maxDelayDays: 0 };
    cell.value = r3(cell.value + Math.max(0, r.contractQty) * Math.max(0, r.unitPrice));
    cell.fieldAmount = r3(cell.fieldAmount + r.fieldAmount);
    cell.officialAmount = r3(cell.officialAmount + r.officialAmount);
    const plan = planByItem.get(r.boqItemId);
    const finish = plan ? datePart10(plan.plannedFinish) : "";
    if (finish && finish <= today && Math.max(0, r.contractQty) * Math.max(0, r.unitPrice) > 0) {
      cell.plannedValue = r3(cell.plannedValue + Math.max(0, r.contractQty) * Math.max(0, r.unitPrice));
    }
    const delay = delayByItem.get(r.boqItemId);
    if (delay) {
      cell.delayedCount += 1;
      cell.maxDelayDays = Math.max(cell.maxDelayDays, delay.delayDays);
    }
    divMap.set(key, cell);
  }
  const divisions: EvmDivisionRow[] = Array.from(divMap.values())
    .map((c) => ({
      divisionCode: c.divisionCode,
      divisionName: c.divisionName,
      value: c.value,
      weightPct: pctOf(c.value, bac),
      plannedPct: pctOf(c.plannedValue, c.value),
      fieldPct: pctOf(c.fieldAmount, c.value),
      officialPct: pctOf(c.officialAmount, c.value),
      delayedCount: c.delayedCount,
      maxDelayDays: c.maxDelayDays,
    }))
    .sort((a, b) => b.value - a.value || a.divisionCode.localeCompare(b.divisionCode));

  // ===== بطاقة الرأس (§8.2.9) =====
  const starts: string[] = [];
  const finishes: string[] = [];
  let expectedFinish: string | null = null;
  for (const r of input.rows) {
    const plan = planByItem.get(r.boqItemId);
    if (plan) {
      const s = datePart10(plan.plannedStart);
      const f = datePart10(plan.plannedFinish);
      if (s) starts.push(s);
      if (f) finishes.push(f);
    }
    if (r.expectedFinish && (!expectedFinish || r.expectedFinish > expectedFinish)) {
      expectedFinish = r.expectedFinish;
    }
  }
  const projectStart = starts.length ? starts.sort()[0] : null;
  const plannedFinishMax = finishes.length ? finishes.sort()[finishes.length - 1] : null;
  let durationDays: number | null = null;
  let elapsedDays: number | null = null;
  if (projectStart) {
    elapsedDays = Math.max(0, daysBetween(projectStart, today));
    if (plannedFinishMax) {
      durationDays = Math.max(1, daysBetween(projectStart, plannedFinishMax) + 1);
      elapsedDays = Math.min(elapsedDays, durationDays);
    }
  }
  const elapsedPct = durationDays !== null && elapsedDays !== null ? pctOf(elapsedDays, durationDays) : null;
  const header: EvmHeader = { projectStart, plannedFinishMax, durationDays, elapsedDays, elapsedPct, expectedFinish };

  // ===== المال (§8.2.10) =====
  let billed = 0;
  let retentionOutstanding = 0;
  for (const inv of input.approvedInvoices) {
    const d = datePart10(inv.approveDate);
    if (!d || d > today) continue;
    billed = r3(billed + Math.max(0, Number(inv.total) || 0));
    if (!inv.retentionReleased) {
      retentionOutstanding = r3(retentionOutstanding + Math.max(0, Number(inv.retentionAmount) || 0));
    }
  }
  let collected = 0;
  for (const v of input.receiptVouchers) {
    const d = datePart10(v.vdate);
    if (!d || d > today) continue;
    collected = r3(collected + Math.max(0, Number(v.amount) || 0));
  }
  const cashRemaining = r3(collected - ac);
  // أول حركة صرف: أقدم سند صرف/مادة/شهر رواتب محتسب — حد الأيام 1 على الأقل
  const costDates: string[] = [];
  for (const v of input.paymentVouchers) {
    const d = datePart10(v.vdate);
    if (d && d <= today && (Number(v.amount) || 0) > 0) costDates.push(d);
  }
  costDates.push(...materialDates);
  for (const l of input.laborAllocations) {
    if (l.batchStatus !== "approved" && l.batchStatus !== "paid") continue;
    const m = String(l.batchMonth || "").slice(0, 7);
    if (m && m <= laborMonth && (Number(l.amount) || 0) > 0) costDates.push(`${m}-01`);
  }
  const firstCostDate = costDates.length ? costDates.sort()[0] : null;
  const burnPerDay = ac > 0 && firstCostDate ? r3(ac / Math.max(1, daysBetween(firstCostDate, today) + 1)) : 0;
  const runwayDays = cashRemaining > 0 && burnPerDay > 0 ? Math.floor(cashRemaining / burnPerDay) : null;
  const money: EvmMoney = { billed, collected, retentionOutstanding, cashRemaining, burnPerDay, runwayDays };

  // ===== المنحنى الثلاثي (§8.2.6) — اتحاد التواريخ وترحيل آخر قيمة =====
  const sCurve = deriveEvmSCurve(input.sCurve, plannedByDate, today);

  // ===== تحذيرات EVM مشتقة لحظيًا (§8.2.12) — null لا تشعل =====
  const warnings: EvmWarning[] = [];
  if (spiOfficial !== null && spiOfficial < th.spiMin) {
    warnings.push({
      kind: "spi_official",
      title: "تأخر زمني — رسمي",
      message: `مؤشر التقدم الرسمي ${spiOfficial} أقل من العتبة ${th.spiMin} — الفوترة متأخرة عن المخطط`,
      value: spiOfficial,
    });
  }
  if (spiField !== null && spiField < th.spiMin) {
    warnings.push({
      kind: "spi_field",
      title: "تأخر زمني — ميداني",
      message: `مؤشر التقدم الميداني ${spiField} أقل من العتبة ${th.spiMin} — الموقع متأخر عن البرنامج`,
      value: spiField,
    });
  }
  if (cpiOfficial !== null && cpiOfficial < th.cpiMin) {
    warnings.push({
      kind: "cpi_official",
      title: "كلفة فوق المكتسب — رسمي",
      message: `مؤشر الكلفة الرسمي ${cpiOfficial} أقل من العتبة ${th.cpiMin} — المصروف يتقدم على المفوتر`,
      value: cpiOfficial,
    });
  }
  if (cpiField !== null && cpiField < th.cpiMin) {
    warnings.push({
      kind: "cpi_field",
      title: "كلفة فوق المكتسب — ميداني",
      message: `مؤشر الكلفة الميداني ${cpiField} أقل من العتبة ${th.cpiMin} — المصروف يتقدم على المنفذ`,
      value: cpiField,
    });
  }
  const lateItems = delayedItems.filter((d) => d.delayDays > th.maxDelayDays);
  if (lateItems.length > 0) {
    const top = lateItems[0];
    warnings.push({
      kind: "delayed_items",
      title: "بنود متأخرة",
      message: `${lateItems.length} بندًا متأخرًا فوق ${th.maxDelayDays} يومًا — أعلاها البند ${top.itemNo} بتأخر ${top.delayDays} يومًا (${top.fieldPct}٪ منفذًا)`,
      value: top.delayDays,
    });
  }

  return {
    today,
    bac,
    pv,
    evOfficial,
    evField,
    ac,
    acBreakdown,
    pvPct: pctOf(pv, bac),
    evOfficialPct: pctOf(evOfficial, bac),
    evFieldPct: pctOf(evField, bac),
    spiOfficial,
    spiField,
    cpiOfficial,
    cpiField,
    eacOfficial,
    eacField,
    header,
    sCurve,
    divisions,
    delayedItems,
    money,
    warnings,
  };
}

// ==================== المنحنى الثلاثي ====================

/**
 * المنحنى الثلاثي (§5.3 — طبقة رابعة عن نموذج المالك): المخطط خطوة عند كل
 * plannedFinish (قرار v1 §2 — مبكر حصرًا)، والرسمي/الميداني من منحنى م1 —
 * الاتحاد مرتب وآخر قيمة ترحل بين النقاط، ونقطة ختامية عند اليوم المرجعي
 * (PV «حتى اليوم» يجب أن تُرى حتى اليوم ولو سكنت الحركات).
 */
export function deriveEvmSCurve(
  m1Curve: SCurvePoint[],
  plannedByDate: Map<string, number>,
  today: string
): EvmSCurvePoint[] {
  const dates = new Set<string>();
  for (const p of m1Curve) dates.add(p.date);
  for (const d of plannedByDate.keys()) dates.add(d);
  if (dates.size === 0) return [];
  dates.add(today);
  const sorted = Array.from(dates).sort();
  const m1ByDate = new Map(m1Curve.map((p) => [p.date, p]));
  let plannedCum = 0;
  let officialCum = 0;
  let fieldCum = 0;
  return sorted.map((date) => {
    plannedCum = r3(plannedCum + (plannedByDate.get(date) || 0));
    const m1 = m1ByDate.get(date);
    if (m1) {
      officialCum = m1.officialCum;
      fieldCum = m1.fieldCum;
    }
    return { date, plannedCum, officialCum, fieldCum };
  });
}
