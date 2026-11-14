/**
 * توليد نموذج iXBRL تجريبي بأرقام افتراضية — لمعاينة شكل مخرجات التقديم الإلكتروني
 * خارج قاعدة البيانات (النواة نقية — src/lib/xbrl-core.ts).
 * التشغيل: bun scripts/generate-xbrl-sample.ts → docs/xbrl-sample.html
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { buildIxbrlDocument } from "../src/lib/xbrl-core";
import type {
  BalanceSheetResult,
  CashFlowResult,
  CashFlowRow,
  EquityChangeRow,
  EquityChangesResult,
  FsLine,
  FsSection,
  IncomeStatementResult,
} from "../src/lib/financial-statements-core";

const sec = (title: string, lines: FsLine[]): FsSection => ({
  title,
  lines,
  total: lines.reduce((s, l) => s + l.amount, 0),
});

// ==================== المركز المالي (instant 2026-12-31) ====================
const assetsLines: FsLine[] = [
  { code: "1111", name: "الصندوق", amount: 18_500, xbrl: "ifrs-full:CashAndCashEquivalents" },
  { code: "1112", name: "البنك الأهلي الكويتي — جاري", amount: 142_750, xbrl: "ifrs-full:CashAndCashEquivalents" },
  { code: "1201", name: "عملاء (مدينون)", amount: 285_400, xbrl: "ifrs-full:TradeAndOtherCurrentReceivables" },
  { code: "1300", name: "عقود تحت التنفيذ (أصول)", amount: 96_800, xbrl: "kw:ContractWorkInProgressAssets" },
  { code: "1500", name: "معدات وآليات", amount: 210_000, xbrl: "ifrs-full:PropertyPlantAndEquipment" },
  { code: "1590", name: "مجمع إهلاك المعدات", amount: -85_000, xbrl: "kw:AccumulatedDepreciationEquipment" },
];
const liabilitiesLines: FsLine[] = [
  { code: "2101", name: "موردون (دائنون)", amount: 152_300, xbrl: "ifrs-full:TradeAndOtherCurrentPayables" },
  { code: "2201", name: "مصروفات مستحقة", amount: 24_600, xbrl: "kw:AccruedExpensesPayable" },
  { code: "2300", name: "عقود تحت التنفيذ (التزامات)", amount: 41_250, xbrl: "kw:ContractWorkInProgressLiabilities" },
  { code: "2600", name: "دفعات مقدمة من العملاء", amount: 68_000, xbrl: "ifrs-full:ContractLiabilities" },
];
const equityLines: FsLine[] = [
  { code: "3100", name: "رأس المال المدفوع", amount: 250_000, xbrl: "ifrs-full:IssuedCapital" },
  { code: "3300", name: "احتياطي قانوني", amount: 25_000, xbrl: "ifrs-full:StatutoryReserve" },
  { code: "3400", name: "أرباح مرحلة", amount: 122_400, xbrl: "ifrs-full:RetainedEarnings" },
];
const netResult = 21_100;

const balanceSheet: BalanceSheetResult = {
  asOf: "2026-12-31",
  assets: sec("الأصول", assetsLines),
  liabilities: sec("الالتزامات", liabilitiesLines),
  equity: sec("حقوق الملكية", equityLines),
  netResult,
  equityWithResult: equityLines.reduce((s, l) => s + l.amount, 0) + netResult,
  totalLiabilitiesEquity:
    liabilitiesLines.reduce((s, l) => s + l.amount, 0) + equityLines.reduce((s, l) => s + l.amount, 0) + netResult,
  totalAssets: assetsLines.reduce((s, l) => s + l.amount, 0),
  balanced: true,
  diff: 0,
};

// ==================== قائمة الدخل (duration 2026-01-01..2026-12-31) ====================
const income: IncomeStatementResult = {
  from: "2026-01-01",
  to: "2026-12-31",
  revenue: sec("الإيرادات", [
    { code: "4100", name: "إيرادات عقود المقاولات", amount: 512_400, xbrl: "kw:ConstructionContractRevenue" },
    { code: "4300", name: "إيرادات عقود الصيانة", amount: 18_600, xbrl: "kw:MaintenanceContractRevenue" },
  ]),
  expenses: [
    sec("التكلفة المباشرة للعقود", [
      { code: "5100", name: "تكلفة تنفيذ العقود", amount: 356_800, xbrl: "kw:ContractExecutionCost" },
      { code: "5200", name: "مقاولو الباطن", amount: 61_200, xbrl: "kw:SubcontractorCost" },
    ]),
    sec("المصروفات الإدارية والعمومية", [
      { code: "6100", name: "رواتب وأجور إدارية", amount: 54_300, xbrl: "kw:AdministrativeStaffCost" },
      { code: "6300", name: "إيجارات", amount: 13_500, xbrl: "kw:RentExpense" },
      { code: "6400", name: "إهلاك المعدات", amount: 21_000, xbrl: "ifrs-full:DepreciationPropertyPlantAndEquipment" },
    ]),
    sec("مصروفات تمويلية", [
      { code: "7100", name: "مصاريف بنكية", amount: 3_100, xbrl: "kw:BankChargesExpense" },
    ]),
  ],
  expensesTotal: 509_900,
  netResult,
};

// ==================== حركة حقوق الملكية ====================
const equityRows: EquityChangeRow[] = [
  { code: "3100", name: "رأس المال المدفوع", xbrl: "ifrs-full:IssuedCapital", opening: 250_000, increase: 0, decrease: 0, closing: 250_000 },
  { code: "3300", name: "احتياطي قانوني", xbrl: "ifrs-full:StatutoryReserve", opening: 22_600, increase: 2_400, decrease: 0, closing: 25_000 },
  { code: "3400", name: "أرباح مرحلة", xbrl: "ifrs-full:RetainedEarnings", opening: 122_400, increase: 0, decrease: 0, closing: 122_400 },
];
const equity: EquityChangesResult = {
  from: "2026-01-01",
  to: "2026-12-31",
  rows: equityRows,
  openingTotal: equityRows.reduce((s, r) => s + r.opening, 0),
  movementNet: equityRows.reduce((s, r) => s + r.increase - r.decrease, 0),
  netResult,
  closingTotal: equityRows.reduce((s, r) => s + r.closing, 0) + netResult,
  closingActual: equityRows.reduce((s, r) => s + r.closing, 0) + netResult,
  consistent: true,
};

// ==================== التدفقات النقدية ====================
const cf = (code: string, name: string, inflow: number, outflow: number): CashFlowRow => ({
  code,
  name,
  kind: "",
  inflow,
  outflow,
  net: inflow - outflow,
});
const operating = [
  cf("1201", "تحصيلات عملاء", 398_500, 0),
  cf("2101", "سداد موردون", 0, 371_650),
  cf("6100", "رواتب وأجور", 0, 54_300),
  cf("6300", "إيجارات", 0, 13_500),
  cf("7100", "مصاريف بنكية", 0, 3_100),
];
const investing = [cf("1500", "شراء معدات وآليات", 0, 45_000)];
const financing = [cf("2700", "قروض قصيرة الأجل", 117_900, 0)];
const cashflow: CashFlowResult = {
  from: "2026-01-01",
  to: "2026-12-31",
  cashAccounts: ["1111", "1112"],
  openingCash: 132_400,
  closingCash: 161_250,
  cashDelta: 28_850,
  operating,
  investing,
  financing,
  unclassified: [],
  totals: {
    operating: operating.reduce((s, r) => s + r.net, 0),
    investing: investing.reduce((s, r) => s + r.net, 0),
    financing: financing.reduce((s, r) => s + r.net, 0),
    unclassified: 0,
    net: 28_850,
  },
  reconciles: true,
  diff: 0,
};

// ==================== البناء ====================
const input = { meta: {
  companyName: "شركة الخليج للمقاولات العامة ذ.م.م",
  companyLicense: "123456",
  year: 2026,
  asOf: "2026-12-31",
  from: "2026-01-01",
  currency: "KWD",
}, income, balanceSheet, equity, cashflow };

// فحص الاكتمال عبر النواة نفسها ثم البناء
const { checkCoverage } = await import("../src/lib/xbrl-core");
const coverage = checkCoverage(input);
console.log(
  `الاكتمال: ${coverage.complete ? "كامل" : "ناقص"} · موسومة: ${coverage.tagged} · غير مغطاة: ${coverage.uncovered.length}`
);
if (coverage.uncovered.length > 0) console.table(coverage.uncovered);

const { html } = buildIxbrlDocument({ ...input, coverage });
const out = path.join(process.cwd(), "docs", "xbrl-sample.html");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html, "utf-8");
console.log(`تم حفظ النموذج: ${out} (${(html.length / 1024).toFixed(1)} KB)`);
