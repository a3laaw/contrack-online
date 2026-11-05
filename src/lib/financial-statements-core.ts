/**
 * financial-statements-core.ts — نواة القوائم المالية النقية (بلا React ولا server-only) — Task 110.
 * القوائم المالية الكويتية الموحدة (القرار الوزاري 44/2016):
 *   1) المركز المالي (قائمة المركز المالي)   — Balance Sheet
 *   2) قائمة الدخل الشامل                    — Income Statement
 *   3) التغيرات في حقوق الملكية              — Changes in Equity
 *   4) التدفقات النقدية (تشغيلية/استثمارية/تمويلية) — Cash Flows
 *
 * قرارات التصميم الموثقة (docs/roadmap-accounting.md — Task 110):
 *  • تُبنى حصرًا من الأستاذ: كل رقم = رصيد/حركة JournalLine بالقيود posted فقط
 *    + الرصيد الافتتاحي المخزَّن على الحساب — لا أرقام يدوية ولا حسابات موازية.
 *  • الإشارة الموحدة: الرصيد الموقَّع مدين موجب / دائن سالب (دلالة openingBalance — Task 103).
 *    العرض في القوائم بطرفيه الطبيعي: الأصول مدين موجب، الالتزامات وحقوق الملكية دائن موجب
 *    (تُقلب الإشارة عند البناء)، والحسابات المخالفة (مجمع الإهلاك أصل دائن) تظهر سالبة
 *    داخل قسمها — مجاميع القسم صحيحة بالبناء.
 *  • نتيجة السنة الجارية في المركز المالي = الرصيد التراكمي لحسابات الإيراد/المصروف حتى تاريخ
 *    القائمة (ما لم يُنفَّذ إقفال سنوي — إقفال T109 يحملها إلى 3300 محتجزات) — بهذا
 *    يتحقق توازن المركز المالي بالبناء لأن الأستاذ متوازن (فحص موثق قبل الطباعة).
 *  • التدفقات النقدية: النقد = حسابات قسم «النقد وما في حكمه» (111x). لكل قيد posted يلمس
 *    النقد، تُنسب حركة النقد إلى الأطراف المقابلة (سطور نفس القيد على حسابات غير نقدية)
 *    وتُصنَّف بـ cashFlowKind المُخزَّن على الحساب أو الاشتقاق الهيكلي الافتراضي:
 *    إيراد/مصروف/تزامن جارٍ/أصل جارٍ = تشغيلي · أصول غير متداولة 12xx = استثماري ·
 *    حقوق ملكية 3xxx وقروض 22xx = تمويلي · النقد نفسه يُستثنى (تحويلات نقد↔نقد لا تغير إجمالي النقد).
 *  • فحوص التوازن إلزامية قبل الطباعة: ميزان المراجعة متوازن، المركز متوازن، صافي التدفق
 *    المصنف = التغير الفعلي في النقد — أي انحراف > 0.001 فلس يظهر كفشل صريح.
 */

import { r3 } from "./accounting-journal";

// ==================== أنواع مشتركة ====================

export type CashFlowKind = "operating" | "investing" | "financing";

export const CASH_FLOW_KIND_LABEL: Record<CashFlowKind, string> = {
  operating: "الأنشطة التشغيلية",
  investing: "الأنشطة الاستثمارية",
  financing: "الأنشطة التمويلية",
};

/** أنواع القوائم — مفتاح الطباعة/التصدير (Fs بادئة لتمايزها عن StatementKind لكشف الحساب) */
export type FsStatementKind = "bs" | "is" | "eq" | "cf";

export const FS_STATEMENT_LABEL: Record<FsStatementKind, string> = {
  bs: "قائمة المركز المالي",
  is: "قائمة الدخل الشامل",
  eq: "قائمة التغيرات في حقوق الملكية",
  cf: "قائمة التدفقات النقدية",
};

/** صف حساب جاهز من الخادم — أرصدة موقَّعة (مدين موجب / دائن سالب) */
export interface FsAccountRow {
  accountId: number;
  code: string;
  name: string;
  type: string; // asset | liability | equity | revenue | expense
  nature: string; // debit | credit
  xbrlElement: string;
  cashFlowKind: string; // "" | operating | investing | financing (الفارغ يُشتق)
  /** الرصيد الموقَّع قبل بداية الفترة (يشمل الرصيد الافتتاحي المخزَّن + حركة القيود الأقدم) */
  opening: number;
  /** حركة الفترة [from..asOf] مدين/دائن */
  periodDr: number;
  periodCr: number;
  /** الرصيد الموقَّع حتى تاريخ القائمة = opening + periodDr − periodCr */
  closing: number;
  /** كود الأب المباشر واسمه (لعنوان المجموعة الفرعية في القائمة) — من الخادم */
  parentCode?: string;
  parentName?: string;
}

/** سطر عرض في القائمة — قيمة موجبة بطرفها الطبيعي (القسم يحدد الطرف) */
export interface FsLine {
  code: string;
  name: string;
  amount: number;
  /** عنصر XBRL الموصول به الحساب (للمصدّر الموسمي لاحقًا — Task 111) */
  xbrl?: string;
  /** سطر نتيجة محسوبة لا حساب فعلي (نتيجة السنة الجارية / صافي الربح) */
  computed?: boolean;
}

export interface FsSection {
  title: string;
  lines: FsLine[];
  total: number;
}

// ==================== الاشتقاق الهيكلي لتصنيف التدفق ====================

/**
 * التصنيف الافتراضي من بنية الدليل (يُستخدم عند ترك cashFlowKind فارغًا):
 *  • إيراد (4xxx) / مصروف (5xxx) → تشغيلي — دورة التشغيل
 *  • حقوق ملكية (3xxx) → تمويلي · قروض طويلة الأجل (22xx) → تمويلي
 *  • أصول غير متداولة (12xx) → استثماري (شراء/إهلاك الأصول الثابتة)
 *  • بقية الأصول والتزامات الجارية (ذمم/عهد/دفعات مقدمة/تسوية) → تشغيلي (رأس مال عامل)
 *  • النقد نفسه (111x) → "" — هو موضوع القائمة لا طرف مصنف
 */
export function defaultCashFlowKind(code: string, type: string): CashFlowKind | "" {
  if (code.startsWith("111")) return "";
  if (type === "revenue" || type === "expense") return "operating";
  if (type === "equity") return "financing";
  if (type === "asset" && code.startsWith("12")) return "investing";
  if (type === "liability" && code.startsWith("22")) return "financing";
  return "operating";
}

/** الحسم: القيمة المخزَّنة الصريحة أولًا ثم الاشتقاق الهيكلي */
export function resolveCashFlowKind(code: string, type: string, stored: string): CashFlowKind | "" {
  const s = (stored || "").trim();
  if (s === "operating" || s === "investing" || s === "financing") return s;
  return defaultCashFlowKind(code, type);
}

// ==================== قائمة الدخل الشامل ====================

export interface IncomeStatementResult {
  from: string;
  to: string;
  revenue: FsSection;
  expenses: FsSection[];
  expensesTotal: number;
  netResult: number; // موجب = ربح (إيرادات − مصروفات بطرفيهما الطبيعي)
}

/** تجميع إيرادات الفترة ومصروفاتها من حركة الفترة حصرًا (لا الأرصدة الافتتاحية) */
export function buildIncomeStatement(rows: FsAccountRow[], from: string, to: string): IncomeStatementResult {
  const revenueLines: FsLine[] = [];
  const expenseByBranch = new Map<string, FsLine[]>();

  for (const r of rows) {
    const movement = r3(r.periodDr - r.periodCr);
    if (movement === 0) continue;
    if (r.type === "revenue") {
      // الإيراد طبيعته دائن: حركة دائنة موجبة = إيراد، ومدينة (مرتجع/تسوية) تُخصم
      revenueLines.push({ code: r.code, name: r.name, amount: r3(-movement), xbrl: r.xbrlElement || undefined });
    } else if (r.type === "expense") {
      // المصروف طبيعته مدين: حركة مدينة موجبة = مصروف
      const line: FsLine = { code: r.code, name: r.name, amount: r3(movement), xbrl: r.xbrlElement || undefined };
      const branch = r.parentCode || r.code;
      const bucket = expenseByBranch.get(branch) || [];
      bucket.push(line);
      expenseByBranch.set(branch, bucket);
    }
  }

  revenueLines.sort((a, b) => a.code.localeCompare(b.code));
  const revenueTotal = r3(revenueLines.reduce((s, l) => s + l.amount, 0));

  const branches = Array.from(expenseByBranch.keys()).sort();
  const expenses: FsSection[] = branches.map((branch) => {
    const lines = (expenseByBranch.get(branch) || []).sort((a, b) => a.code.localeCompare(b.code));
    const sectionRow = rows.find((x) => (x.parentCode || x.code) === branch);
    return {
      title: sectionRow?.parentName || "مصروفات أخرى",
      lines,
      total: r3(lines.reduce((s, l) => s + l.amount, 0)),
    };
  });

  const expensesTotal = r3(expenses.reduce((s, sec) => s + sec.total, 0));

  return {
    from,
    to,
    revenue: { title: "الإيرادات", lines: revenueLines, total: revenueTotal },
    expenses,
    expensesTotal,
    netResult: r3(revenueTotal - expensesTotal),
  };
}

// ==================== قائمة المركز المالي ====================

export interface BalanceSheetResult {
  asOf: string;
  assets: FsSection;
  liabilities: FsSection;
  equity: FsSection;
  netResult: number; // نتيجة الفترة المالية حتى تاريخ القائمة (تُعرض داخل حقوق الملكية)
  equityWithResult: number;
  totalLiabilitiesEquity: number;
  totalAssets: number;
  balanced: boolean;
  diff: number; // الأصول − (الالتزامات + حقوق الملكية + النتيجة) — يجب أن يكون 0
}

/**
 * المركز المالي من الأرصدة الموقَّعة حتى asOf:
 *  • الأصول تعرض بإشارتها (مدين موجب، والمخالف الدائن — مجمع الإهلاك — سالب داخل القسم)
 *  • الالتزامات وحقوق الملكية تُقلب (دائن موجب)
 *  • نتيجة السنة الجارية تُحقن في حقوق الملكية (ما لم تُقفل سنويًا فتكون محمولة على 3300)
 * التوازن مضمون بالبناء لأن الأستاذ متوازن — والفحص الصريح يوثق ذلك قبل الطباعة.
 */
export function buildBalanceSheet(rows: FsAccountRow[], asOf: string, netResult: number): BalanceSheetResult {
  const assetLines: FsLine[] = [];
  const liabilityLines: FsLine[] = [];
  const equityLines: FsLine[] = [];

  for (const r of rows) {
    if (r.type === "revenue" || r.type === "expense") continue; // نتيجتها تُحقن سطرًا واحدًا
    const line: FsLine = { code: r.code, name: r.name, amount: 0, xbrl: r.xbrlElement || undefined };
    if (r.type === "asset") {
      line.amount = r3(r.closing); // مدين موجب — المخالف الدائن سالب
      assetLines.push(line);
    } else if (r.type === "liability") {
      line.amount = r3(-r.closing); // دائن موجب
      liabilityLines.push(line);
    } else if (r.type === "equity") {
      line.amount = r3(-r.closing);
      equityLines.push(line);
    }
  }

  const byCode = (a: FsLine, b: FsLine) => a.code.localeCompare(b.code);
  assetLines.sort(byCode);
  liabilityLines.sort(byCode);
  equityLines.sort(byCode);

  const assetsTotal = r3(assetLines.reduce((s, l) => s + l.amount, 0));
  const liabilitiesTotal = r3(liabilityLines.reduce((s, l) => s + l.amount, 0));
  const equityTotal = r3(equityLines.reduce((s, l) => s + l.amount, 0));
  const nr = r3(netResult);
  const equityWithResult = r3(equityTotal + nr);
  const totalLiabilitiesEquity = r3(liabilitiesTotal + equityWithResult);
  const diff = r3(assetsTotal - totalLiabilitiesEquity);

  // إدراج سطر النتيجة داخل حقوق الملكية عند العرض (محسوب لا حساب)
  const equityDisplay: FsSection = {
    title: "حقوق الملكية",
    lines: [
      ...equityLines,
      { code: "", name: "نتيجة السنة الجارية (غير مقفلة)", amount: nr, computed: true },
    ],
    total: equityWithResult,
  };

  return {
    asOf,
    assets: { title: "الأصول", lines: assetLines, total: assetsTotal },
    liabilities: { title: "الالتزامات", lines: liabilityLines, total: liabilitiesTotal },
    equity: equityDisplay,
    netResult: nr,
    equityWithResult,
    totalLiabilitiesEquity,
    totalAssets: assetsTotal,
    balanced: Math.abs(diff) <= 0.001,
    diff,
  };
}

// ==================== التغيرات في حقوق الملكية ====================

export interface EquityChangeRow {
  code: string;
  name: string;
  opening: number; // دائن موجب (مُقلب من الموقَّع)
  increase: number;
  decrease: number;
  closing: number; // دائن موجب
  computed?: boolean;
}

export interface EquityChangesResult {
  from: string;
  to: string;
  rows: EquityChangeRow[];
  openingTotal: number;
  movementNet: number; // صافي حركة الفترة على حسابات الملكية
  netResult: number; // نتيجة الفترة من قائمة الدخل
  closingTotal: number; // الإقفال المفترض = opening + movement + netResult
  closingActual: number; // مجموع الأرصدة الفعلية حتى asOf + النتيجة
  consistent: boolean;
}

/**
 * حركة حقوق الملكية بين تاريخين: افتتاحي (قبل from) → زيادة/نقصان الفترة → إقفال.
 * نتيجة الفترة تُضاف سطرًا محسوبًا — والاتساق: opening + movement + result = closing الفعلي.
 */
export function buildEquityChanges(rows: FsAccountRow[], from: string, to: string, netResult: number): EquityChangesResult {
  const out: EquityChangeRow[] = [];
  let openingTotal = 0;
  let movementNet = 0;
  let closingActual = 0;

  for (const r of rows) {
    if (r.type !== "equity") continue;
    const opening = r3(-r.opening); // دائن موجب
    const closing = r3(-r.closing);
    const change = r3(closing - opening);
    out.push({
      code: r.code,
      name: r.name,
      opening,
      increase: change > 0 ? change : 0,
      decrease: change < 0 ? -change : 0,
      closing,
    });
    openingTotal = r3(openingTotal + opening);
    movementNet = r3(movementNet + change);
    closingActual = r3(closingActual + closing);
  }

  const nr = r3(netResult);
  const closingTotal = r3(openingTotal + movementNet + nr);
  const closingFinal = r3(closingActual + nr); // الإقفال الفعلي شامل النتيجة — يحسم قبل البناء لتفادي خلط المتغير المراكم
  return {
    from,
    to,
    rows: out,
    openingTotal,
    movementNet,
    netResult: nr,
    closingTotal,
    closingActual: closingFinal,
    consistent: Math.abs(closingTotal - closingFinal) <= 0.001,
  };
}

// ==================== التدفقات النقدية ====================

export interface CashFlowRow {
  code: string;
  name: string;
  kind: CashFlowKind | "";
  inflow: number; // وارد نقد (الطرف المقابل دائن)
  outflow: number; // منصرف نقد (الطرف المقابل مدين)
  net: number;
}

export interface CashFlowResult {
  from: string;
  to: string;
  cashAccounts: string[]; // أكواد حسابات النقد المستخدمة (111x)
  openingCash: number; // موقَّع مدين موجب
  closingCash: number;
  cashDelta: number; // closing − opening
  operating: CashFlowRow[];
  investing: CashFlowRow[];
  financing: CashFlowRow[];
  unclassified: CashFlowRow[];
  totals: { operating: number; investing: number; financing: number; unclassified: number; net: number };
  reconciles: boolean;
  diff: number; // net المصنف − cashDelta — يجب أن يكون 0
}

/** صف طرف مقابل خام من الخادم: حركة الحساب داخل قيود لمست النقد حصرًا */
export interface CashCounterpartRaw {
  code: string;
  name: string;
  type: string;
  cashFlowKind: string;
  debit: number;
  credit: number;
}

/**
 * بناء التدفقات النقدية:
 *  • تأثير الحساب المقابل على النقد = دائنه − مدينه (عكس طرف النقد في نفس القيد)
 *  • التحويلات نقد↔نقد مستثناة أصلًا (الخادم يستبعد سطور 111x من الأطراف) فلا تضيف أي حركة
 *  • التحقق: صافي المصنف = التغير الفعلي في النقد (مضمون بالبناء لأن القيود متوازنة)
 */
export function buildCashFlow(
  cashRows: FsAccountRow[],
  counterparts: CashCounterpartRaw[],
  from: string,
  to: string
): CashFlowResult {
  const openingCash = r3(cashRows.reduce((s, r) => s + r.opening, 0));
  const closingCash = r3(cashRows.reduce((s, r) => s + r.closing, 0));
  const cashDelta = r3(closingCash - openingCash);

  const byKind = new Map<CashFlowKind | "", CashFlowRow[]>();
  for (const c of counterparts) {
    const net = r3(c.credit - c.debit); // موجب = وارد نقد، سالب = منصرف
    if (net === 0) continue;
    const kind = resolveCashFlowKind(c.code, c.type, c.cashFlowKind);
    const row: CashFlowRow = {
      code: c.code,
      name: c.name,
      kind,
      inflow: net > 0 ? net : 0,
      outflow: net < 0 ? -net : 0,
      net,
    };
    const bucket = byKind.get(kind) || [];
    bucket.push(row);
    byKind.set(kind, bucket);
  }

  const order = (a: CashFlowRow, b: CashFlowRow) => a.code.localeCompare(b.code);
  const sectionTotal = (rows: CashFlowRow[]) => r3(rows.reduce((s, r) => s + r.net, 0));
  const operating = (byKind.get("operating") || []).sort(order);
  const investing = (byKind.get("investing") || []).sort(order);
  const financing = (byKind.get("financing") || []).sort(order);
  const unclassified = (byKind.get("") || []).sort(order);

  const totals = {
    operating: sectionTotal(operating),
    investing: sectionTotal(investing),
    financing: sectionTotal(financing),
    unclassified: sectionTotal(unclassified),
    net: 0,
  };
  totals.net = r3(totals.operating + totals.investing + totals.financing + totals.unclassified);
  const diff = r3(totals.net - cashDelta);

  return {
    from,
    to,
    cashAccounts: cashRows.map((r) => r.code),
    openingCash,
    closingCash,
    cashDelta,
    operating,
    investing,
    financing,
    unclassified,
    totals,
    reconciles: Math.abs(diff) <= 0.001,
    diff,
  };
}

// ==================== فحوص التوازن الإجمالية ====================

export interface StatementsChecks {
  trialBalanced: boolean; // مجموع الأرصدة الموقَّعة لكل الحسابات حتى asOf = 0
  bsBalanced: boolean;
  cfReconciles: boolean;
  equityConsistent: boolean;
  allPassed: boolean;
  notes: string[];
}

export function validateStatements(input: {
  trialDiff: number;
  bs: BalanceSheetResult;
  cf: CashFlowResult;
  eq: EquityChangesResult;
}): StatementsChecks {
  const notes: string[] = [];
  const trialBalanced = Math.abs(input.trialDiff) <= 0.001;
  if (!trialBalanced) notes.push(`ميزان المراجعة حتى التاريخ غير متوازن بفرق ${input.trialDiff.toFixed(3)} د.ك — راجع القيود قبل الطباعة.`);
  if (!input.bs.balanced) notes.push(`المركز المالي غير متوازن بفرق ${input.bs.diff.toFixed(3)} د.ك.`);
  if (!input.cf.reconciles) notes.push(`التدفقات النقدية لا تطابق التغير الفعلي في النقد بفرق ${input.cf.diff.toFixed(3)} د.ك.`);
  if (!input.eq.consistent) notes.push("حركة حقوق الملكية غير متسقة مع الإقفال المحسوب.");
  if (!input.cf.cashAccounts.length) notes.push("لا توجد حسابات نقد (111x) في الدليل — قائمة التدفقات بلا أساس.");
  return {
    trialBalanced,
    bsBalanced: input.bs.balanced,
    cfReconciles: input.cf.reconciles,
    equityConsistent: input.eq.consistent,
    allPassed: trialBalanced && input.bs.balanced && input.cf.reconciles && input.eq.consistent && input.cf.cashAccounts.length > 0,
    notes,
  };
}

// ==================== محولات التصدير (ReportTable) ====================

/** صف نصي/رقمي للتصدير — الحقول تتبع رأس كل قائمة */
function num(v: number): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

/** قائمة الدخل → ReportTable */
export function isReportTable(r: IncomeStatementResult): import("./report-server").ReportTable {
  const rows: (string | number)[][] = [];
  rows.push(["الإيرادات", "", ""]);
  for (const l of r.revenue.lines) rows.push([`  ${l.code} — ${l.name}`, "", num(l.amount)]);
  rows.push(["إجمالي الإيرادات", "", num(r.revenue.total)]);
  for (const sec of r.expenses) {
    rows.push([sec.title, "", ""]);
    for (const l of sec.lines) rows.push([`  ${l.code} — ${l.name}`, "", num(l.amount)]);
    rows.push([`إجمالي ${sec.title}`, "", num(sec.total)]);
  }
  rows.push(["إجمالي المصروفات", "", num(r.expensesTotal)]);
  rows.push([r.netResult >= 0 ? "صافي الربح للفترة" : "صافي خسارة الفترة", "", num(Math.abs(r.netResult))]);
  return {
    title: `قائمة الدخل الشامل (${r.from} → ${r.to})`,
    heads: ["البند", "مدين", "دائن"],
    rows,
    numberCols: [],
    accentRows: [],
    note: "مبنية حصرًا من الأستاذ العام — القرار الوزاري 44/2016",
  };
}

/** المركز المالي → ReportTable */
export function bsReportTable(r: BalanceSheetResult): import("./report-server").ReportTable {
  const rows: (string | number)[][] = [];
  rows.push(["الأصول", "مدين", ""]);
  for (const l of r.assets.lines) rows.push([`  ${l.code} — ${l.name}`, num(l.amount), ""]);
  rows.push(["إجمالي الأصول", num(r.assets.total), ""]);
  rows.push(["الالتزامات", "", "دائن"]);
  for (const l of r.liabilities.lines) rows.push([`  ${l.code} — ${l.name}`, "", num(l.amount)]);
  rows.push(["إجمالي الالتزامات", "", num(r.liabilities.total)]);
  rows.push(["حقوق الملكية", "", "دائن"]);
  for (const l of r.equity.lines) rows.push([`  ${l.code ? l.code + " — " : ""}${l.name}`, "", num(l.amount)]);
  rows.push(["إجمالي حقوق الملكية (مع النتيجة)", "", num(r.equityWithResult)]);
  rows.push(["إجمالي الالتزامات وحقوق الملكية", "", num(r.totalLiabilitiesEquity)]);
  return {
    title: `قائمة المركز المالي حتى ${r.asOf}`,
    heads: ["البند", "مدين", "دائن"],
    rows,
    numberCols: [],
    accentRows: [],
    note: r.balanced
      ? "متوازن ✓ — الأصول = الالتزامات + حقوق الملكية (تشمل نتيجة السنة الجارية)"
      : `غير متوازن بفرق ${r.diff.toFixed(3)} د.ك`,
  };
}

/** التغيرات في حقوق الملكية → ReportTable */
export function eqReportTable(r: EquityChangesResult): import("./report-server").ReportTable {
  const rows: (string | number)[][] = r.rows.map((row) => [
    `${row.code} — ${row.name}`,
    num(row.opening),
    num(row.increase),
    num(row.decrease),
    num(row.closing),
  ]);
  rows.push(["نتيجة الفترة (من قائمة الدخل)", "", "", "", num(r.netResult)]);
  rows.push(["حقوق الملكية بعد النتيجة", num(r.openingTotal), num(r.movementNet), "", num(r.closingTotal)]);
  return {
    title: `قائمة التغيرات في حقوق الملكية (${r.from} → ${r.to})`,
    heads: ["الحساب", "افتتاحي", "زيادة", "نقصان", "إقفال"],
    rows,
    numberCols: [1, 2, 3, 4],
    accentRows: [],
    note: r.consistent ? "متسقة مع الأستاذ ✓" : "غير متسقة — راجع الحركة",
  };
}

/** التدفقات النقدية → ReportTable */
export function cfReportTable(r: CashFlowResult): import("./report-server").ReportTable {
  const rows: (string | number)[][] = [];
  const pushSection = (title: string, list: CashFlowRow[], total: number) => {
    rows.push([title, "", "", ""]);
    if (!list.length) rows.push(["  — لا حركة مصنفة —", "", "", ""]);
    for (const row of list) rows.push([`  ${row.code} — ${row.name}`, num(row.inflow), num(row.outflow), num(row.net)]);
    rows.push([`صافي ${title}`, "", "", num(total)]);
  };
  pushSection(CASH_FLOW_KIND_LABEL.operating, r.operating, r.totals.operating);
  pushSection(CASH_FLOW_KIND_LABEL.investing, r.investing, r.totals.investing);
  pushSection(CASH_FLOW_KIND_LABEL.financing, r.financing, r.totals.financing);
  if (r.unclassified.length) pushSection("غير مصنف (يتطلب ضبط cashFlowKind)", r.unclassified, r.totals.unclassified);
  rows.push(["صافي التغير في النقد", "", "", num(r.totals.net)]);
  rows.push(["النقد افتتاحي الفترة", "", "", num(r.openingCash)]);
  rows.push(["النقد إقفالي الفترة", "", "", num(r.closingCash)]);
  return {
    title: `قائمة التدفقات النقدية (${r.from} → ${r.to})`,
    heads: ["البند", "وارد", "منصرف", "الصافي"],
    rows,
    numberCols: [1, 2, 3],
    accentRows: [],
    note: r.reconciles
      ? `مطابقة ✓ — صافي المصنف = التغير الفعلي في النقد (${r.cashDelta.toFixed(3)} د.ك)`
      : `انحراف ${r.diff.toFixed(3)} د.ك عن التغير الفعلي`,
  };
}
