/**
 * بنّاء HTML لدفتر الأستاذ A4 RTL — Task 108 — يُحوَّل إلى PDF عبر Chromium خادميًا.
 * نفس لغة تصميم الكشوفات (pdf/statement-html.ts): الشريط الأساسي بألوان الشركة،
 * بطاقة الحساب والفترة، جدول الحركات بالرصيد الجاري، صندوق الإجماليات، والتذييل.
 * الوحدة نقية (بلا server-only) لتُستخدم في الاختبارات والمسارات معًا.
 */

import { ARABIC_FONT_B64 } from "./font-data";
import { DEFAULT_PRIMARY, DEFAULT_ACCENT, fmt3 } from "./statement-html";

const GREEN = "#1E7D4F";
const RED = "#B03A2E";
const BORDER_C = "#C9D6E3";
const STRIPE_C = "#D8E4EF";
const MUTED_C = "#3D5568";
const MUTED2_C = "#7A8A99";

export interface GlPdfRow {
  date: string;
  ref: string;
  desc: string;
  dims: string;
  debit: number;
  credit: number;
  balance: number;
  side: "debit" | "credit";
}

export interface GlPdfData {
  account: { code: string; name: string; nature: string; type: string };
  periodText: string;
  filtersText?: string;
  opening: number; // موقَّع
  rows: GlPdfRow[];
  totals: { debit: number; credit: number };
  closing: number; // موقَّع
}

export interface GlPdfOpts {
  company: { name: string; address: string; phone: string; email: string };
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

function moneyCell(v: number, cls: string): string {
  const shown = v ? fmt3(v) : "—";
  return `<td class="${cls}">${shown}</td>`;
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
.card-line3 { font-size: 10.5pt; font-weight: 700; color: ${primary}; margin: 0; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
thead { display: table-header-group; }
th { background: ${primary}; color: #fff; font-weight: 700; font-size: 10pt; padding: 2.2mm 1mm; border: 0.35mm solid ${BORDER_C}; text-align: center; }
td { border: 0.35mm solid ${BORDER_C}; padding: 1.6mm 1mm; font-size: 8.5pt; text-align: center; overflow: hidden; }
tr.stripe td { background: ${lightBg}; }
td.desc { text-align: right; padding-inline: 2mm; }
td.dims { text-align: right; padding-inline: 2mm; color: ${MUTED_C}; font-size: 7.8pt; }
td.money { font-size: 9pt; }
td.balance { font-weight: 700; font-size: 9pt; }
.side-debit { color: ${GREEN}; }
.side-credit { color: ${RED}; }
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
.footer { margin-top: 10mm; border-top: 0.35mm solid ${BORDER_C}; padding-top: 3mm; text-align: center; color: ${MUTED2_C}; font-size: 8.5pt; }
`.trim();
}

/** دفتر الأستاذ PDF — نفس هيكل الكشف: ترويسة الشركة + بطاقة الحساب + الجدول + الإجماليات */
export function buildGeneralLedgerHtml(data: GlPdfData, opts: GlPdfOpts): string {
  const primary = (opts.primary || DEFAULT_PRIMARY).toUpperCase();
  const accent = (opts.accent || DEFAULT_ACCENT).toUpperCase();
  const lightBg = lightTint(primary);
  const currency = opts.currency || "د.ك";

  const infoParts = [opts.company.address, opts.company.phone ? `هاتف: ${opts.company.phone}` : "", opts.company.email].filter(Boolean);
  const infoLine = infoParts.join(" | ");

  const filtersLine = data.filtersText ? `<p class="card-line2">${esc(data.filtersText)}</p>` : "";

  const rowsHtml =
    data.rows.length === 0
      ? `<tr><td colspan="7" class="desc" style="padding:5mm">لا حركات مطابقة في هذه الفترة.</td></tr>`
      : data.rows
          .map((r, i) => {
            const stripe = i % 2 === 1 ? " stripe" : "";
            const desc = (r.desc || "").slice(0, 90);
            const dims = (r.dims || "").slice(0, 70);
            const sideCls = r.side === "debit" ? "side-debit" : "side-credit";
            return `<tr class="${stripe.trim()}">
  <td>${esc(r.date)}</td>
  <td>${esc(r.ref)}</td>
  <td class="desc">${esc(desc)}</td>
  <td class="dims">${esc(dims)}</td>
  ${moneyCell(r.debit, "money")}
  ${moneyCell(r.credit, "money")}
  <td class="balance ${sideCls}">${fmt3(r.balance)} ${r.side === "debit" ? "مدين" : "دائن"}</td>
</tr>`;
          })
          .join("\n");

  const openingSideTxt = data.opening >= 0 ? "مدين" : "دائن";
  const closingSideTxt = data.closing >= 0 ? "مدين" : "دائن";

  const body = `
<div class="hdr" style="background:${primary}">
  <p class="hdr-company">${esc(opts.company.name || "اسم الشركة")}</p>
  ${infoLine ? `<p class="hdr-info">${esc(infoLine)}</p>` : ""}
  <p class="hdr-title">دفتر الأستاذ العام</p>
</div>
<div class="card">
  <p class="card-line1">الحساب: ${esc(data.account.code)} — ${esc(data.account.name)}</p>
  ${filtersLine}
  <p class="card-line3">الفترة: ${esc(data.periodText)}</p>
</div>
<table>
  <thead>
    <tr>
      <th style="width:16mm">التاريخ</th>
      <th style="width:13mm">المرجع</th>
      <th style="width:52mm">البيان</th>
      <th style="width:44mm">الأبعاد التحليلية</th>
      <th style="width:19mm">مدين</th>
      <th style="width:19mm">دائن</th>
      <th>الرصيد</th>
    </tr>
  </thead>
  <tbody>
  ${rowsHtml}
  </tbody>
</table>
<div class="totals">
  <div class="tot-row"><span class="tot-label">رصيد أول الفترة</span><span class="tot-value ${data.opening >= 0 ? "pos" : "neg"}">${fmt3(Math.abs(data.opening))} ${esc(currency)} ${openingSideTxt}</span></div>
  <div class="tot-row"><span class="tot-label">إجمالي المدين</span><span class="tot-value primary">${fmt3(data.totals.debit)} ${esc(currency)}</span></div>
  <div class="tot-row"><span class="tot-label">إجمالي الدائن</span><span class="tot-value accent">${fmt3(data.totals.credit)} ${esc(currency)}</span></div>
  <div class="tot-row"><span class="tot-label">رصيد آخر الفترة</span><span class="tot-value ${data.closing >= 0 ? "pos" : "neg"}">${fmt3(Math.abs(data.closing))} ${esc(currency)} ${closingSideTxt}</span></div>
</div>
<div class="footer">
  الحركات من القيود المنشورة حصرًا — الأستاذ العام مصدر الحقيقة · أُصدر ${esc(opts.issuedAt || nowStamp())}
</div>`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>دفتر الأستاذ ${esc(data.account.code)}</title>
<style>
${baseCss(primary, accent, lightBg)}
</style>
</head>
<body>
${body}
</body>
</html>`;
}
