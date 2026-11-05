/**
 * بنّاء HTML للقوائم المالية A4 RTL — Task 110 — يُحوَّل إلى PDF عبر Chromium خادميًا.
 * نفس لغة تصميم الكشوفات (pdf/gl-html.ts + pdf/statement-html.ts): الشريط الأساسي بألوان الشركة،
 * بطاقة الفترة مع شارات فحوص التوازن، جدول القائمة بأقسامها وإجمالياتها، وصندوق الخلاصة.
 * الوحدة نقية (بلا server-only) لتُستخدم في الاختبارات والمسارات معًا.
 * الطباعة تُمنع عند فشل فحص التوازن إلا بصيغة مسودة (خيار force).
 */

import { ARABIC_FONT_B64 } from "./font-data";
import { DEFAULT_PRIMARY, DEFAULT_ACCENT, fmt3 } from "./statement-html";
import {
  buildBalanceSheet,
  buildCashFlow,
  buildEquityChanges,
  buildIncomeStatement,
  type BalanceSheetResult,
  type CashFlowResult,
  type EquityChangesResult,
  type FsAccountRow,
  type FsStatementKind,
  type IncomeStatementResult,
} from "../financial-statements-core";

const GREEN = "#1E7D4F";
const RED = "#B03A2E";
const BORDER_C = "#C9D6E3";
const STRIPE_C = "#D8E4EF";
const MUTED_C = "#3D5568";
const MUTED2_C = "#7A8A99";

export interface FsPdfOpts {
  company: { name: string; address: string; phone: string; email: string };
  currency: string;
  primary?: string;
  accent?: string;
  issuedAt?: string;
  /** اسم القائمة كما يظهر في الترويسة */
  title: string;
  /** نص الفترة (من → إلى أو حتى تاريخ) */
  periodText: string;
  /** شارات الفحوص: متوازن ✓ / قائمة مفاحيس */
  checksBadges: { label: string; passed: boolean }[];
  /** ملاحظات الفحص عند الفشل */
  checkNotes?: string[];
  /** طبع رغم فشل الفحوص (مسودة موقعة بذلك) */
  force?: boolean;
}

export interface FsPdfInput {
  kind: FsStatementKind;
  rows: FsAccountRow[];
  income: IncomeStatementResult;
  balanceSheet: BalanceSheetResult;
  equity: EquityChangesResult;
  cashflow: CashFlowResult;
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function lightTint(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#F2F6FA";
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * 0.12 + 255 * 0.88);
  const g = Math.round(((n >> 8) & 255) * 0.12 + 255 * 0.88);
  const b = Math.round((n & 255) * 0.12 + 255 * 0.88);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0").toUpperCase()}`;
}

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function baseCss(primary: string, accent: string, lightBg: string): string {
  const fontUrl = `data:font/ttf;base64,${ARABIC_FONT_B64}`;
  return `
@page { size: A4; margin: 14mm; }
@font-face {
  font-family: "NotoNaskhArabic";
  src: url("${fontUrl}") format("truetype");
  font-weight: 400 700;
  font-style: normal;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { direction: rtl; font-family: "NotoNaskhArabic", "Traditional Arabic", sans-serif; color: #000; font-size: 10pt; }
.hdr { background: ${primary}; color: #fff; padding: 7mm 7mm 5.5mm; margin-bottom: 5mm; }
.hdr-company { font-size: 15pt; font-weight: 700; margin: 0 0 1.5mm; }
.hdr-info { font-size: 9pt; color: ${STRIPE_C}; margin: 0 0 3mm; }
.hdr-title { font-size: 13pt; font-weight: 700; margin: 0; }
.badges { display: flex; gap: 3mm; margin: 3mm 0 0; flex-wrap: wrap; }
.badge { font-size: 8.5pt; padding: 1mm 3mm; border-radius: 2mm; font-weight: 700; }
.badge.pass { background: ${GREEN}; color: #fff; }
.badge.fail { background: ${RED}; color: #fff; }
.card { background: ${lightBg}; border-radius: 3mm; padding: 4mm 5mm; margin-bottom: 5mm; font-size: 10pt; color: ${MUTED_C}; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 6mm; }
thead { display: table-header-group; }
th { background: ${primary}; color: #fff; font-weight: 700; font-size: 10pt; padding: 2.2mm 1mm; border: 0.35mm solid ${BORDER_C}; text-align: center; }
td { border: 0.35mm solid ${BORDER_C}; padding: 1.6mm 1mm; font-size: 9pt; text-align: center; overflow: hidden; }
td.item { text-align: right; padding-inline: 2.5mm; }
tr.section td { background: ${lightBg}; font-weight: 700; color: ${primary}; font-size: 10pt; }
tr.total td { font-weight: 700; font-size: 9.5pt; border-top: 0.6mm solid ${primary}; }
tr.grand td { background: ${primary}; color: #fff; font-weight: 700; font-size: 10.5pt; }
td.money { font-size: 9.5pt; white-space: nowrap; }
.pos { color: ${GREEN}; }
.neg { color: ${RED}; }
.totals {
  width: 112mm; margin-right: auto; margin-left: 0; margin-top: 2mm;
  border: 0.35mm solid ${BORDER_C}; border-radius: 3mm; padding: 4mm 5mm; page-break-inside: avoid;
}
.tot-row { display: flex; justify-content: space-between; align-items: baseline; padding: 1.6mm 0; }
.tot-row + .tot-row { border-top: 0.2mm solid ${BORDER_C}; }
.tot-label { font-size: 10pt; }
.tot-value { font-size: 10.5pt; font-weight: 700; white-space: nowrap; }
.tot-value.primary { color: ${primary}; }
.tot-value.accent { color: ${accent}; }
.tot-value.pos { color: ${GREEN}; }
.tot-value.neg { color: ${RED}; }
.notes { margin-top: 4mm; font-size: 9pt; color: ${RED}; }
.notes div { padding: 1mm 0; }
.draft-mark { display: none; }
body.draft .draft-mark { display: block; text-align: center; color: ${RED}; font-weight: 700; font-size: 12pt; margin: 4mm 0; }
.footer { margin-top: 10mm; border-top: 0.35mm solid ${BORDER_C}; padding-top: 3mm; text-align: center; color: ${MUTED2_C}; font-size: 8.5pt; }
`.trim();
}

interface TblSpec {
  heads: string[];
  colgroup: string;
  body: string;
}

function sectionRow(title: string, cols: number): string {
  return `<tr class="section"><td class="item" colspan="${cols}">${esc(title)}</td></tr>`;
}

function itemRow(name: string, code: string, cells: string[]): string {
  const label = code ? `${esc(code)} — ${esc(name)}` : esc(name);
  return `<tr><td class="item">&nbsp;&nbsp;${label}</td>${cells.join("")}</tr>`;
}

function totalRow(label: string, cells: string[], grand = false): string {
  return `<tr class="${grand ? "grand" : "total"}"><td class="item">${esc(label)}</td>${cells.join("")}</tr>`;
}

function money(v: number, cls = "money"): string {
  return `<td class="${cls}">${v ? fmt3(v) : "—"}</td>`;
}

/** جدول قائمة الدخل */
function isTable(inc: IncomeStatementResult): TblSpec {
  const body: string[] = [];
  body.push(sectionRow("الإيرادات", 2));
  for (const l of inc.revenue.lines) body.push(itemRow(l.name, l.code, [money(-l.amount)]));
  body.push(totalRow("إجمالي الإيرادات", [money(inc.revenue.total)]));
  for (const sec of inc.expenses) {
    body.push(sectionRow(sec.title, 2));
    for (const l of sec.lines) body.push(itemRow(l.name, l.code, [money(l.amount)]));
    body.push(totalRow(`إجمالي ${sec.title}`, [money(sec.total)]));
  }
  body.push(totalRow("إجمالي المصروفات", [money(inc.expensesTotal)]));
  const netLabel = inc.netResult >= 0 ? "صافي الربح للفترة" : "صافي الخسارة للفترة";
  body.push(totalRow(netLabel, [`<td class="money ${inc.netResult >= 0 ? "pos" : "neg"}">${fmt3(Math.abs(inc.netResult))}</td>`], true));
  return { heads: ["البند", "المبلغ (د.ك)"], colgroup: '<col style="width:70%"/><col style="width:30%"/>', body: body.join("") };
}

/** جدول المركز المالي — جانبان متجاوران (أصول | التزامات وحقوق ملكية) */
function bsTable(bs: BalanceSheetResult): TblSpec {
  const n = Math.max(bs.assets.lines.length, bs.liabilities.lines.length + bs.equity.lines.length + 2);
  const body: string[] = [];
  body.push(sectionRow("الأصول", 4));
  for (const l of bs.assets.lines) body.push(itemRow(l.name, l.code, [money(l.amount), "<td></td>", "<td></td>"]));
  body.push(totalRow("إجمالي الأصول", [money(bs.totalAssets), "<td></td>", "<td></td>"]));
  body.push(sectionRow("الالتزامات", 4));
  for (const l of bs.liabilities.lines) body.push(itemRow(l.name, l.code, ["<td></td>", "<td></td>", money(l.amount)]));
  body.push(totalRow("إجمالي الالتزامات", ["<td></td>", "<td></td>", money(bs.liabilities.total)]));
  body.push(sectionRow("حقوق الملكية", 4));
  for (const l of bs.equity.lines) {
    body.push(itemRow(l.name, l.code, ["<td></td>", "<td></td>", money(l.amount)]));
  }
  body.push(totalRow("إجمالي حقوق الملكية (مع النتيجة)", ["<td></td>", "<td></td>", money(bs.equityWithResult)]));
  body.push(totalRow("إجمالي الالتزامات وحقوق الملكية", ["<td></td>", "<td></td>", money(bs.totalLiabilitiesEquity)], true));
  void n;
  return { heads: ["البند", "الأصول (مدين)", "حقوق (دائن)", "الالتزامات (دائن)"], colgroup: '<col style="width:46%"/><col style="width:18%"/><col style="width:18%"/><col style="width:18%"/>', body: body.join("") };
}

/** جدول التغيرات في حقوق الملكية */
function eqTable(eq: EquityChangesResult): TblSpec {
  const body: string[] = [];
  for (const r of eq.rows) {
    body.push(`<tr><td class="item">&nbsp;&nbsp;${esc(r.code)} — ${esc(r.name)}</td>${money(r.opening)}${money(r.increase)}${money(r.decrease)}${money(r.closing)}</tr>`);
  }
  if (!eq.rows.length) body.push(`<tr><td class="item" colspan="5">لا توجد حسابات حقوق ملكية بأرصدة</td></tr>`);
  body.push(totalRow("نتيجة الفترة (من قائمة الدخل)", ["<td></td>", "<td></td>", "<td></td>", `<td class="money ${eq.netResult >= 0 ? "pos" : "neg"}">${fmt3(Math.abs(eq.netResult))}${eq.netResult >= 0 ? "" : " (خسارة)"}</td>`]));
  body.push(totalRow("حقوق الملكية بعد النتيجة", [money(eq.openingTotal), money(eq.movementNet), "<td></td>", money(eq.closingTotal)], true));
  return { heads: ["الحساب", "افتتاحي", "زيادة", "نقصان", "إقفال"], colgroup: '<col style="width:36%"/><col style="width:16%"/><col style="width:16%"/><col style="width:16%"/><col style="width:16%"/>', body: body.join("") };
}

/** جدول التدفقات النقدية */
function cfTable(cf: CashFlowResult): TblSpec {
  const body: string[] = [];
  const push = (title: string, rows: CashFlowResult["operating"], total: number, kindKey: string) => {
    body.push(sectionRow(title, 4));
    if (!rows.length) body.push(`<tr><td class="item" colspan="4">&nbsp;&nbsp;— لا حركة مصنفة —</td></tr>`);
    for (const r of rows) {
      body.push(`<tr><td class="item">&nbsp;&nbsp;${esc(r.code)} — ${esc(r.name)}${kindKey === "unclassified" ? " (يتطلب ضبط التصنيف)" : ""}</td>${money(r.inflow, "money pos")}${money(r.outflow, "money neg")}${money(r.net)}</tr>`);
    }
    body.push(totalRow(`صافي ${title}`, ["<td></td>", "<td></td>", money(total)], false));
  };
  push("الأنشطة التشغيلية", cf.operating, cf.totals.operating, "operating");
  push("الأنشطة الاستثمارية", cf.investing, cf.totals.investing, "investing");
  push("الأنشطة التمويلية", cf.financing, cf.totals.financing, "financing");
  if (cf.unclassified.length) push("غير مصنف", cf.unclassified, cf.totals.unclassified, "unclassified");
  body.push(totalRow("صافي التغير في النقد", ["<td></td>", "<td></td>", money(cf.totals.net)], true));
  return { heads: ["البند", "وارد", "منصرف", "الصافي"], colgroup: '<col style="width:46%"/><col style="width:18%"/><col style="width:18%"/><col style="width:18%"/>', body: body.join("") };
}

/** القائمة المالية PDF — ترويسة الشركة + شارات الفحوص + الجدول + صندوق الخلاصة */
export function buildFinancialStatementHtml(input: FsPdfInput, opts: FsPdfOpts): string {
  const primary = opts.primary || DEFAULT_PRIMARY;
  const accent = opts.accent || DEFAULT_ACCENT;
  const lightBg = lightTint(primary);
  const draft = !allChecksPass(input) && !!opts.force;

  let table: TblSpec;
  let totalsBox = "";
  if (input.kind === "is") {
    table = isTable(input.income);
    totalsBox = totBox([
      ["إجمالي الإيرادات", fmt3(input.income.revenue.total), "primary"],
      ["إجمالي المصروفات", fmt3(input.income.expensesTotal), "primary"],
      [input.income.netResult >= 0 ? "صافي الربح" : "صافي الخسارة", `${fmt3(Math.abs(input.income.netResult))} ${opts.currency}`, input.income.netResult >= 0 ? "pos" : "neg"],
    ]);
  } else if (input.kind === "bs") {
    table = bsTable(input.balanceSheet);
    totalsBox = totBox([
      ["إجمالي الأصول", `${fmt3(input.balanceSheet.totalAssets)} ${opts.currency}`, "primary"],
      ["إجمالي الالتزامات", `${fmt3(input.balanceSheet.liabilities.total)} ${opts.currency}`, "primary"],
      ["حقوق الملكية مع النتيجة", `${fmt3(input.balanceSheet.equityWithResult)} ${opts.currency}`, "accent"],
      ["الالتزامات + حقوق الملكية", `${fmt3(input.balanceSheet.totalLiabilitiesEquity)} ${opts.currency}`, "accent"],
      [input.balanceSheet.balanced ? "التوازن" : "الفرق", input.balanceSheet.balanced ? "متوازن ✓" : fmt3(input.balanceSheet.diff), input.balanceSheet.balanced ? "pos" : "neg"],
    ]);
  } else if (input.kind === "eq") {
    table = eqTable(input.equity);
    totalsBox = totBox([
      ["افتتاحي حقوق الملكية", fmt3(input.equity.openingTotal), "primary"],
      ["صافي حركة الفترة", fmt3(input.equity.movementNet), "primary"],
      ["نتيجة الفترة", fmt3(input.equity.netResult), "accent"],
      ["الإقفال بعد النتيجة", `${fmt3(input.equity.closingTotal)} ${opts.currency}`, input.equity.consistent ? "pos" : "neg"],
    ]);
  } else {
    table = cfTable(input.cashflow);
    totalsBox = totBox([
      ["صافي التشغيلية", fmt3(input.cashflow.totals.operating), "primary"],
      ["صافي الاستثمارية", fmt3(input.cashflow.totals.investing), "primary"],
      ["صافي التمويلية", fmt3(input.cashflow.totals.financing), "primary"],
      ["صافي التغير في النقد", fmt3(input.cashflow.totals.net), "accent"],
      ["النقد افتتاحي → إقفالي", `${fmt3(input.cashflow.openingCash)} → ${fmt3(input.cashflow.closingCash)} ${opts.currency}`, "primary"],
      [input.cashflow.reconciles ? "المطابقة" : "الانحراف", input.cashflow.reconciles ? "مطابق ✓" : fmt3(input.cashflow.diff), input.cashflow.reconciles ? "pos" : "neg"],
    ]);
  }

  const badges = opts.checksBadges
    .map((b) => `<span class="badge ${b.passed ? "pass" : "fail"}">${esc(b.label)}</span>`)
    .join("");
  const notes = opts.checkNotes?.length
    ? `<div class="notes">${opts.checkNotes.map((n) => `<div>⚠ ${esc(n)}</div>`).join("")}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"/><title>${esc(opts.title)}</title>
<style>${baseCss(primary, accent, lightBg)}</style></head>
<body${draft ? ' class="draft"' : ""}>
  <div class="hdr">
    <p class="hdr-company">${esc(opts.company.name)}</p>
    <p class="hdr-info">${esc(opts.company.address)}${opts.company.phone ? " · " + esc(opts.company.phone) : ""}${opts.company.email ? " · " + esc(opts.company.email) : ""}</p>
    <h1 class="hdr-title">${esc(opts.title)}</h1>
    <div class="badges">${badges}</div>
  </div>
  <div class="draft-mark">مسودة — الفحوص غير مكتملة</div>
  <div class="card">الفترة: ${esc(opts.periodText)}${opts.issuedAt !== undefined ? ` · صدر: ${esc(opts.issuedAt || nowStamp())}` : ` · صدر: ${nowStamp()}`}</div>
  <table><thead><tr>${table.heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><colgroup>${table.colgroup}</colgroup><tbody>${table.body}</tbody></table>
  <div class="totals">${totalsBox}</div>
  ${notes}
  <div class="footer">مبنية حصرًا من الأستاذ العام بالقيود المرحّلة — الصيغة الكويتية الموحدة (القرار الوزاري 44/2016) — ConTrack</div>
</body></html>`;
}

function totBox(rows: [string, string, string][]): string {
  return rows
    .map(([label, value, cls]) => `<div class="tot-row"><span class="tot-label">${esc(label)}</span><span class="tot-value ${cls}">${esc(value)}</span></div>`)
    .join("");
}

/** هل فحوص القائمة المطلوبة كلها ناجحة؟ (تُقفل الطباعة النهائية عند الفشل) */
export function allChecksPass(input: FsPdfInput): boolean {
  if (input.kind === "is") return true; // الدخل لا يحمل فحص توازن مستقلًا — توازن الأستاذ يغطيه
  if (input.kind === "bs") return input.balanceSheet.balanced;
  if (input.kind === "eq") return input.equity.consistent;
  return input.cashflow.reconciles;
}
