/**
 * بنّاء HTML مستقل لكشف الحساب A4 RTL — يُحوَّل إلى PDF عبر Chromium خادميًا (المرحلة 8).
 * المرجع الحرفي المكتبي: contrack_v9.15.18/app/reports/statement_pdf.py
 *   الألوان: pdf_utils.py (PRIMARY #1e3a5f · ACCENT #2e86ab · BORDER #c9d6e3 · STRIPE #d8e4ef · GREEN/RED)
 *   _header: شريط أساسي باسم الشركة + «العنوان | هاتف: … | البريد» + العنوان
 *   بطاقة العميل/العقد ثم الجدول ثم صندوق الإجماليات 112مم ثم التذييل
 * الوحدة نقية (بلا server-only) لتُستخدم في الاختبارات والمسارات معًا.
 */

import { ARABIC_FONT_B64 } from "./font-data";

// ===== الألوان الافتراضية (pdf_utils.py — والأساسي الافتراضي #1F3A5F حسب المواصفة) =====
export const DEFAULT_PRIMARY = "#1F3A5F";
export const DEFAULT_ACCENT = "#2E86AB";
const GREEN = "#1E7D4F";
const RED = "#B03A2E";
const BORDER_C = "#C9D6E3";
const STRIPE_C = "#D8E4EF";
const MUTED_C = "#3D5568";
const MUTED2_C = "#7A8A99";

// ===== التنسيق المالي المطابق للمكتبي {v:,.3f} =====
export function fmt3(n: number): string {
  return Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export interface StatementPdfRow {
  date: string;
  ref: string;
  desc: string;
  debit: number;
  credit: number;
  balance: number;
  kind: string; // opening | move | invoice_info | subtotal | total
  contractNumber?: string;
}

export interface StatementPdfCustomer {
  name: string;
  customerCode: string;
  phone: string;
  address?: string;
}

export interface StatementPdfCompany {
  name: string;
  address: string;
  phone: string;
  email: string;
}

export interface StatementHtmlOpts {
  company: StatementPdfCompany;
  currency: string;
  /** لون الشريط والترويسة — settings.invoice_primary عند توفره وإلا الافتراضي */
  primary?: string;
  accent?: string;
  /** «YYYY-MM-DD HH:MM» — الافتراضي الآن */
  issuedAt?: string;
}

export interface ContractStatementHtmlData {
  customer: StatementPdfCustomer;
  contract: {
    contractNumber: string;
    contractDate: string;
    /** القيمة الحالية (amount + ملاحق معتمدة + تمديد إشراف) كما المكتبي contract_amount */
    amount: number;
    description?: string;
  };
  rows: StatementPdfRow[];
  totals: { debit: number; credit: number; remaining: number };
}

export interface CustomerStatementHtmlData {
  customer: StatementPdfCustomer;
  contractsCount: number;
  /** عند التصفية بعقد محدد */
  contractNumber?: string | null;
  rows: StatementPdfRow[];
  totals: { debit: number; credit: number; remaining: number; opening: number };
  dateFrom?: string;
  dateTo?: string;
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** تفتيح اللون الأساسي إلى خلفية فاتحة (مرآة light_tint) */
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

/** خلية مبلغ: صفر ⇒ «—» وإلا {v:,.3f} */
function moneyCell(v: number, cls: string): string {
  const shown = v ? fmt3(v) : "—";
  return `<td class="${cls}">${shown}</td>`;
}

interface TotLine {
  label: string;
  value: number;
  cls: string;
}

function totalsBoxHtml(lines: TotLine[], currency: string, lightBg: string): string {
  const rows = lines
    .map(
      (l) =>
        `<div class="tot-row"><span class="tot-label">${esc(l.label)}</span>` +
        `<span class="tot-value ${l.cls}">${fmt3(l.value)} ${esc(currency)}</span></div>`
    )
    .join("\n      ");
  return `<div class="totals" style="background:${lightBg}">
      ${rows}
    </div>`;
}

function baseCss(primary: string, accent: string, lightBg: string): string {
  const fontUrl = `data:font/ttf;base64,${ARABIC_FONT_B64}`;
  return `
@page { size: A4; margin: 15mm; }
@font-face {
  font-family: "NotoNaskhArabic";
  src: url("${fontUrl}") format("truetype");
  font-weight: 400 700;
  font-style: normal;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  direction: rtl;
  font-family: "NotoNaskhArabic", "Traditional Arabic", sans-serif;
  color: #000;
  font-size: 10pt;
}
.hdr { background: ${primary}; color: #fff; padding: 7mm 7mm 5.5mm; margin-bottom: 5mm; }
.hdr-company { font-size: 15pt; font-weight: 700; margin: 0 0 1.5mm; }
.hdr-info { font-size: 9pt; color: ${STRIPE_C}; margin: 0 0 3mm; }
.hdr-title { font-size: 13pt; font-weight: 700; margin: 0; }
.card { background: ${lightBg}; border-radius: 3mm; padding: 5mm 5mm 4.5mm; margin-bottom: 5mm; }
.card-line1 { font-size: 11pt; font-weight: 700; color: ${primary}; margin: 0 0 1.5mm; }
.card-line2 { font-size: 10pt; color: ${MUTED_C}; margin: 0 0 2mm; }
.card-line3 { font-size: 10.5pt; font-weight: 700; color: ${primary}; margin: 0 0 1.5mm; }
.card-desc { font-size: 9.2pt; color: ${MUTED_C}; margin: 0; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
thead { display: table-header-group; }
th { background: ${primary}; color: #fff; font-weight: 700; font-size: 10pt; padding: 2.2mm 1mm; border: 0.35mm solid ${BORDER_C}; text-align: center; }
td { border: 0.35mm solid ${BORDER_C}; padding: 1.6mm 1mm; font-size: 8.5pt; text-align: center; overflow: hidden; }
tr.stripe td { background: ${lightBg}; }
tr.shade td { background: ${STRIPE_C}; }
td.desc { text-align: right; padding-inline: 2mm; }
td.bold { font-weight: 700; }
td.money { font-size: 9pt; }
td.balance { font-weight: 700; font-size: 9pt; }
.totals {
  width: 112mm;
  margin-right: auto;   /* RTL: يُدفع الصندوق إلى يسار الصفحة كالمكتبي */
  margin-left: 0;
  margin-top: 8mm;
  border: 0.35mm solid ${BORDER_C};
  border-radius: 3mm;
  padding: 4mm 5mm;
  page-break-inside: avoid;
}
.tot-row { display: flex; justify-content: space-between; align-items: baseline; padding: 1.6mm 0; }
.tot-row + .tot-row { border-top: 0.2mm solid ${BORDER_C}; }
.tot-label { font-size: 10pt; }
.tot-value { font-size: 10.5pt; font-weight: 700; white-space: nowrap; }
.tot-value.primary { color: ${primary}; }
.tot-value.accent { color: ${accent}; }
.tot-value.pos { color: ${GREEN}; }
.tot-value.neg { color: ${RED}; }
.footer { margin-top: 10mm; border-top: 0.35mm solid ${BORDER_C}; padding-top: 3mm; text-align: center; color: ${MUTED2_C}; font-size: 8.5pt; }
`.trim();
}

function pageShell(title: string, css: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
${css}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function headerBlock(company: StatementPdfCompany, title: string, primary: string): string {
  const infoParts = [company.address, company.phone ? `هاتف: ${company.phone}` : "", company.email].filter(Boolean);
  const infoLine = infoParts.join(" | ");
  return `<div class="hdr" style="background:${primary}">
  <p class="hdr-company">${esc(company.name || "اسم الشركة")}</p>
  ${infoLine ? `<p class="hdr-info">${esc(infoLine)}</p>` : ""}
  <p class="hdr-title">${esc(title)}</p>
</div>`;
}

function customerCard(data: { customer: StatementPdfCustomer }, extraLines: string[]): string {
  const c = data.customer;
  const infoParts = [c.phone ? `هاتف: ${c.phone}` : "", c.address || ""].filter(Boolean);
  return `<div class="card">
  <p class="card-line1">العميل: ${esc(c.name)}${c.customerCode ? `  (${esc(c.customerCode)})` : ""}</p>
  ${infoParts.length ? `<p class="card-line2">${esc(infoParts.join("   "))}</p>` : ""}
  ${extraLines.join("\n  ")}
</div>`;
}

/** كشف حساب العقد الواحد — مرآة generate_statement_pdf */
export function buildStatementHtml(data: ContractStatementHtmlData, opts: StatementHtmlOpts): string {
  const primary = (opts.primary || DEFAULT_PRIMARY).toUpperCase();
  const accent = (opts.accent || DEFAULT_ACCENT).toUpperCase();
  const lightBg = lightTint(primary);
  const cur = opts.currency;
  const title = "كشف حساب عميل";

  const contractLine =
    `<p class="card-line3">العقد: ${esc(data.contract.contractNumber)}` +
    `  |  التاريخ: ${esc(data.contract.contractDate)}` +
    `  |  القيمة: ${fmt3(data.contract.amount)} ${esc(cur)}</p>`;
  const descLine = data.contract.description ? `<p class="card-desc">${esc(data.contract.description)}</p>` : "";

  const cols = [26, 46, 28, 27, 27, 26]; // mm — التاريخ | البيان | المرجع | مدين | دائن | الرصيد
  const colgroup = cols.map((w) => `<col style="width:${w}mm">`).join("");

  const bodyRows = data.rows
    .map((r, i) => {
      const stripe = i % 2 === 0 ? ' class="stripe"' : "";
      return (
        `<tr${stripe}>` +
        `<td>${esc(r.date)}</td>` +
        `<td class="desc">${esc(r.desc)}</td>` +
        `<td>${esc(r.ref)}</td>` +
        moneyCell(r.debit, "money") +
        moneyCell(r.credit, "money") +
        `<td class="balance">${fmt3(r.balance)}</td>` +
        `</tr>`
      );
    })
    .join("\n      ");

  const totals = totalsBoxHtml(
    [
      { label: "إجمالي المدين (العقد والإضافات)", value: data.totals.debit, cls: "primary" },
      { label: "إجمالي الدائن (المحصّل والخصومات)", value: data.totals.credit, cls: "accent" },
      { label: "الرصيد المتبقي", value: data.totals.remaining, cls: data.totals.remaining >= 0 ? "pos" : "neg" },
    ],
    cur,
    lightBg
  );

  const body = `${headerBlock(opts.company, title, primary)}
${customerCard(data, [contractLine, descLine].filter(Boolean))}
<table>
  <colgroup>${colgroup}</colgroup>
  <thead>
    <tr><th>التاريخ</th><th>البيان</th><th>المرجع</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr>
  </thead>
  <tbody>
      ${bodyRows}
  </tbody>
</table>
${totals}
<div class="footer">تاريخ الإصدار: ${esc(opts.issuedAt || nowStamp())} · ${esc(opts.company.name || "")}</div>`;

  return pageShell(title, baseCss(primary, accent, lightBg), body);
}

/** كشف العميل الشامل — مرآة generate_customer_statement_pdf (عمود العقد + النطاق/الفترة) */
export function buildCustomerStatementHtml(data: CustomerStatementHtmlData, opts: StatementHtmlOpts): string {
  const primary = (opts.primary || DEFAULT_PRIMARY).toUpperCase();
  const accent = (opts.accent || DEFAULT_ACCENT).toUpperCase();
  const lightBg = lightTint(primary);
  const cur = opts.currency;
  const title = "كشف حساب عميل — شامل";

  const scope = data.contractNumber
    ? `العقد: ${data.contractNumber}`
    : `كل العقود (${data.contractsCount})`;
  const period = data.dateFrom || data.dateTo
    ? `الفترة: ${data.dateFrom || "…"} ← ${data.dateTo || "…"}`
    : "الفترة: الكل";

  const scopeLine = `<p class="card-line3">النطاق: ${esc(scope)}  |  ${esc(period)}</p>`;

  const cols = [20, 24, 38, 24, 24, 24, 22]; // mm — التاريخ | العقد | البيان | المرجع | مدين | دائن | الرصيد
  const colgroup = cols.map((w) => `<col style="width:${w}mm">`).join("");

  const bodyRows = data.rows
    .map((r) => {
      const shade = r.kind !== "move";
      const cls = shade ? ' class="shade"' : "";
      // عمود العقد: رقم العقد، و«—» للحركة بلا رقم، وفارغ لغير الحركات (statement_pdf.py:123)
      const contractCell = r.contractNumber || (r.kind === "move" ? "—" : "");
      return (
        `<tr${cls}>` +
        `<td>${esc(r.date)}</td>` +
        `<td>${esc(contractCell)}</td>` +
        `<td class="desc${shade ? " bold" : ""}">${esc(r.desc)}</td>` +
        `<td>${esc(r.ref)}</td>` +
        moneyCell(r.debit, "money") +
        moneyCell(r.credit, "money") +
        `<td class="balance">${fmt3(r.balance)}</td>` +
        `</tr>`
      );
    })
    .join("\n      ");

  const lines: TotLine[] = [];
  if (data.dateFrom || data.totals.opening) {
    lines.push({ label: "رصيد أول الفترة", value: data.totals.opening, cls: "primary" });
  }
  lines.push(
    { label: "إجمالي المدين", value: data.totals.debit, cls: "primary" },
    { label: "إجمالي الدائن", value: data.totals.credit, cls: "accent" },
    { label: "الرصيد المتبقي", value: data.totals.remaining, cls: data.totals.remaining >= 0 ? "pos" : "neg" }
  );
  const totals = totalsBoxHtml(lines, cur, lightBg);

  const body = `${headerBlock(opts.company, title, primary)}
${customerCard(data, [scopeLine])}
<table>
  <colgroup>${colgroup}</colgroup>
  <thead>
    <tr><th>التاريخ</th><th>العقد</th><th>البيان</th><th>المرجع</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr>
  </thead>
  <tbody>
      ${bodyRows}
  </tbody>
</table>
${totals}
<div class="footer">تاريخ الإصدار: ${esc(opts.issuedAt || nowStamp())} · ${esc(opts.company.name || "")}</div>`;

  return pageShell(title, baseCss(primary, accent, lightBg), body);
}
