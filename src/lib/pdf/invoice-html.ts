/**
 * بنّاء HTML مستقل لطباعة الفاتورة A4 RTL برأس الشركة — يُحوَّل إلى PDF خادميًا (Task 107).
 * نفس نظام ألوان وأنماط كشوف الحساب (statement-html.ts) بتخطيط فاتورة:
 * بطاقة العميل/العقد → جدول البنود (وصف/كمية/سعر/خصم/الإجمالي) → صندوق الإجماليات
 * (الإجمالي/الخصم/الصافي/المسدد/المتبقي) → حركات السداد → التذييل.
 * الوحدة نقية (بلا server-only) لتُستخدم في الاختبارات والمسارات معًا.
 */

import { ARABIC_FONT_B64 } from "./font-data";

const GREEN = "#1E7D4F";
const RED = "#B03A2E";
const BORDER_C = "#C9D6E3";
const STRIPE_C = "#D8E4EF";
const MUTED_C = "#3D5568";
const MUTED2_C = "#7A8A99";

export function fmt3(n: number): string {
  return Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export interface InvoicePdfCompany {
  name: string;
  address: string;
  phone: string;
  email: string;
}

export interface InvoicePdfCustomer {
  name: string;
  customerCode: string;
  phone: string;
  address?: string;
}

export interface InvoicePdfItem {
  description: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  lineTotal: number;
}

export interface InvoicePdfPayment {
  voucherNumber: string;
  vdate: string;
  method: string;
  amount: number;
}

export interface InvoicePdfData {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  status: string; // unpaid | partial | paid | void
  statusLabel: string;
  customer: InvoicePdfCustomer;
  contractNumber?: string | null;
  contractName?: string | null;
  description?: string;
  items: InvoicePdfItem[];
  subtotal: number;
  discountTotal: number;
  total: number;
  paidAmount: number;
  remaining: number;
  payments: InvoicePdfPayment[];
  notes?: string;
  voidReason?: string;
  legacy?: boolean;
}

export interface InvoiceHtmlOpts {
  company: InvoicePdfCompany;
  currency: string;
  primary?: string;
  accent?: string;
  issuedAt?: string;
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

function money(v: number): string {
  return v ? fmt3(v) : "—";
}

function invoiceCss(primary: string, accent: string, lightBg: string): string {
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
body {
  direction: rtl;
  font-family: "NotoNaskhArabic", "Traditional Arabic", sans-serif;
  color: #000;
  font-size: 10pt;
}
.hdr { background: ${primary}; color: #fff; padding: 7mm 7mm 5.5mm; margin-bottom: 5mm; }
.hdr-company { font-size: 15pt; font-weight: 700; margin: 0 0 1.5mm; }
.hdr-info { font-size: 9pt; color: ${STRIPE_C}; margin: 0 0 3mm; }
.hdr-title { font-size: 13pt; font-weight: 700; margin: 0; display: flex; justify-content: space-between; align-items: baseline; }
.hdr-title .inv-no { font-size: 12pt; letter-spacing: 0.5px; }
.card { background: ${lightBg}; border-radius: 3mm; padding: 5mm 5mm 4.5mm; margin-bottom: 5mm; }
.card-line1 { font-size: 11pt; font-weight: 700; color: ${primary}; margin: 0 0 1.5mm; }
.card-line2 { font-size: 10pt; color: ${MUTED_C}; margin: 0 0 2mm; }
.card-line3 { font-size: 10.5pt; font-weight: 700; color: ${primary}; margin: 0 0 1.5mm; }
.card-desc { font-size: 9.2pt; color: ${MUTED_C}; margin: 0; }
.badge { display: inline-block; border: 0.4mm solid ${accent}; color: ${accent}; border-radius: 2mm; padding: 0.8mm 3mm; font-size: 9pt; font-weight: 700; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
thead { display: table-header-group; }
th { background: ${primary}; color: #fff; font-weight: 700; font-size: 9.5pt; padding: 2.2mm 1mm; border: 0.35mm solid ${BORDER_C}; text-align: center; }
td { border: 0.35mm solid ${BORDER_C}; padding: 1.6mm 1mm; font-size: 8.8pt; text-align: center; overflow: hidden; }
tr.stripe td { background: ${lightBg}; }
td.desc { text-align: right; padding-inline: 2mm; }
td.money { font-size: 9pt; }
.totals {
  width: 112mm;
  margin-right: auto;
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
.pay-title { font-size: 10.5pt; font-weight: 700; color: ${primary}; margin: 8mm 0 2.5mm; }
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

function headerBlock(company: InvoicePdfCompany, invoiceNumber: string, primary: string, statusLabel: string): string {
  const infoParts = [company.address, company.phone ? `هاتف: ${company.phone}` : "", company.email].filter(Boolean);
  const infoLine = infoParts.join(" | ");
  return `<div class="hdr" style="background:${primary}">
  <p class="hdr-company">${esc(company.name || "اسم الشركة")}</p>
  ${infoLine ? `<p class="hdr-info">${esc(infoLine)}</p>` : ""}
  <p class="hdr-title"><span>فاتورة</span><span class="inv-no" dir="ltr">${esc(invoiceNumber)} · ${esc(statusLabel)}</span></p>
</div>`;
}

/** بناء HTML فاتورة كاملة — نفس نظام الكشوف حرفيًا */
export function buildInvoiceHtml(data: InvoicePdfData, opts: InvoiceHtmlOpts): string {
  const primary = (opts.primary || "#1F3A5F").toUpperCase();
  const accent = (opts.accent || "#2E86AB").toUpperCase();
  const lightBg = lightTint(primary);
  const cur = opts.currency;
  const title = `فاتورة ${data.invoiceNumber}`;

  const infoParts = [data.customer.phone ? `هاتف: ${data.customer.phone}` : "", data.customer.address || ""].filter(Boolean);
  const customerCard = `<div class="card">
  <p class="card-line1">العميل: ${esc(data.customer.name)}${data.customer.customerCode ? `  (${esc(data.customer.customerCode)})` : ""}</p>
  ${infoParts.length ? `<p class="card-line2">${esc(infoParts.join("   "))}</p>` : ""}
  <p class="card-line3">تاريخ الفاتورة: ${esc(data.invoiceDate)}${data.dueDate ? `  |  الاستحقاق: ${esc(data.dueDate)}` : ""}${data.contractNumber ? `  |  العقد: ${esc(data.contractNumber)}` : ""}</p>
  ${data.contractName ? `<p class="card-desc">${esc(data.contractName)}</p>` : ""}
  ${data.description ? `<p class="card-desc">${esc(data.description)}</p>` : ""}
</div>`;

  const cols = [58, 20, 26, 18, 28]; // mm — البيان | الكمية | سعر الوحدة | الخصم% | الإجمالي
  const colgroup = cols.map((w) => `<col style="width:${w}mm">`).join("");
  const bodyRows = data.items
    .map((it, i) => {
      const stripe = i % 2 === 0 ? ' class="stripe"' : "";
      return (
        `<tr${stripe}>` +
        `<td class="desc">${esc(it.description)}</td>` +
        `<td class="money">${fmt3(it.quantity)}</td>` +
        `<td class="money">${fmt3(it.unitPrice)}</td>` +
        `<td class="money">${it.discountPct ? `${fmt3(it.discountPct)}%` : "—"}</td>` +
        `<td class="money">${fmt3(it.lineTotal)}</td>` +
        `</tr>`
      );
    })
    .join("\n      ");

  const statusLine =
    data.status === "void"
      ? `<p class="card-desc" style="color:${RED}; font-weight:700">ملغاة${data.voidReason ? ` — ${esc(data.voidReason)}` : ""}${data.legacy ? " · ترحيلية أرشيفية" : ""}</p>`
      : data.legacy
        ? `<p class="card-desc">فاتورة ترحيلية (ما قبل النواة المزدوجة) — بلا قيد محاسبي</p>`
        : "";

  const totalsRows: string[] = [];
  if (data.discountTotal) {
    totalsRows.push(`<div class="tot-row"><span class="tot-label">الإجمالي قبل الخصم</span><span class="tot-value" dir="ltr">${fmt3(data.subtotal)} ${esc(cur)}</span></div>`);
    totalsRows.push(`<div class="tot-row"><span class="tot-label">الخصم</span><span class="tot-value neg" dir="ltr">−${fmt3(data.discountTotal)} ${esc(cur)}</span></div>`);
  }
  totalsRows.push(`<div class="tot-row"><span class="tot-label">الصافي المفوتر</span><span class="tot-value primary" dir="ltr">${fmt3(data.total)} ${esc(cur)}</span></div>`);
  totalsRows.push(`<div class="tot-row"><span class="tot-label">المسدد</span><span class="tot-value pos" dir="ltr">${fmt3(data.paidAmount)} ${esc(cur)}</span></div>`);
  totalsRows.push(`<div class="tot-row"><span class="tot-label">المتبقي</span><span class="tot-value ${data.remaining > 0 ? "accent" : "pos"}" dir="ltr">${fmt3(data.remaining)} ${esc(cur)}</span></div>`);

  const paymentsSection =
    data.payments.length > 0
      ? `<p class="pay-title">سندات السداد المرتبطة</p>
<table>
  <colgroup><col style="width:34mm"><col style="width:30mm"><col style="width:44mm"><col style="width:42mm"></colgroup>
  <thead><tr><th>السند</th><th>التاريخ</th><th>الطريقة</th><th>المبلغ</th></tr></thead>
  <tbody>
    ${data.payments
      .map(
        (p, i) =>
          `<tr${i % 2 === 0 ? ' class="stripe"' : ""}><td dir="ltr">${esc(p.voucherNumber)}</td><td>${esc(p.vdate)}</td><td>${esc(p.method || "—")}</td><td class="money">${fmt3(p.amount)} ${esc(cur)}</td></tr>`
      )
      .join("\n    ")}
  </tbody>
</table>`
      : "";

  const body = `${headerBlock(opts.company, data.invoiceNumber, primary, data.statusLabel)}
${customerCard}
<table>
  <colgroup>${colgroup}</colgroup>
  <thead>
    <tr><th>البيان</th><th>الكمية</th><th>سعر الوحدة</th><th>الخصم</th><th>الإجمالي</th></tr>
  </thead>
  <tbody>
      ${bodyRows}
  </tbody>
</table>
${statusLine}
<div class="totals">
      ${totalsRows.join("\n      ")}
    </div>
${paymentsSection}
${data.notes ? `<p class="card-desc" style="margin-top:6mm">ملاحظات: ${esc(data.notes)}</p>` : ""}
<div class="footer">تاريخ الإصدار: ${esc(opts.issuedAt || nowStamp())} · ${esc(opts.company.name || "")}</div>`;

  return pageShell(title, invoiceCss(primary, accent, lightBg), body);
}
