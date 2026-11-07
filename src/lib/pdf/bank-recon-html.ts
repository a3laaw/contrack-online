/**
 * Task 113 — تقرير التسوية البنكية وتقرير الفوارق — PDF
 * نفس لغة تصميم القوائم المالية (شريط الشركة، شارات، صندوق إجماليات، تذييل) — قائم بذاته.
 */

export interface BankReconPdfData {
  account: { code: string; name: string };
  asOf: string;
  bankOnly: { cdate: string; amount: number; descr: string }[];
  glOnly: { entryNo: number; entryDate: string; description: string; amount: number }[];
  pairs: { cdate: string; descr: string; entryNo: number; dayGap: number; amount: number }[];
  totals: {
    bankLinesCount: number;
    glLinesCount: number;
    matchedCount: number;
    bankOnlyCount: number;
    bankOnlySum: number;
    glOnlyCount: number;
    glOnlySum: number;
    statementBalance: number;
    bookBalance: number;
    gap: number;
    explained: number;
    unexplained: number;
  };
}

export interface BankReconPdfOpts {
  company: { name: string; address: string; phone: string; email: string };
  currency: string;
  primary?: string;
  accent?: string;
  issuedAt?: string;
}

const DEFAULT_PRIMARY = "#1F3A5F";
const DEFAULT_ACCENT = "#8A6D1D";
const GREEN = "#1B7A3D";
const RED = "#B3261E";
const STRIPE_C = "#D7E1EE";
const BORDER_C = "#C9D4E0";
const MUTED_C = "#4A5A6A";
const MUTED2_C = "#7A8A9A";

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

function fmt3(n: number): string {
  return (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function baseCss(primary: string, accent: string, lightBg: string): string {
  return `
@page { size: A4; margin: 12mm 10mm; }
* { box-sizing: border-box; }
body { font-family: "Cairo", "Noto Naskh Arabic", "Segoe UI", Tahoma, sans-serif; color: #1A2430; font-size: 10pt; margin: 0; }
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
td.money { font-size: 9.5pt; white-space: nowrap; }
.pos { color: ${GREEN}; }
.neg { color: ${RED}; }
.totals {
  width: 118mm; margin-right: auto; margin-left: 0; margin-top: 2mm;
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
.footer { margin-top: 10mm; border-top: 0.35mm solid ${BORDER_C}; padding-top: 3mm; text-align: center; color: ${MUTED2_C}; font-size: 8.5pt; }
`.trim();
}

function sectionRow(title: string, cols: number): string {
  return `<tr class="section"><td class="item" colspan="${cols}">${esc(title)}</td></tr>`;
}

function money(v: number, cls = "money"): string {
  const c = v < 0 ? " neg" : "";
  return `<td class="${cls}${c}">${fmt3(v)}</td>`;
}

/** جدول الفوارق — ثلاثة أقسام: بنود كشف غير مسجلة / بنود دفتر عالقة / الأزواج المطابقة */
function reconTable(d: BankReconPdfData): { heads: string[]; colgroup: string; body: string } {
  const body: string[] = [];

  body.push(sectionRow(`أولًا: بنود في كشف البنك غير مسجلة في الدفتر (${d.totals.bankOnlyCount})`, 4));
  if (!d.bankOnly.length) body.push(`<tr><td class="item" colspan="4">&nbsp;&nbsp;— لا بنود — كل بنود الكشف مسجلة</td></tr>`);
  for (const l of d.bankOnly) {
    body.push(`<tr><td class="item">&nbsp;&nbsp;${esc(l.descr || "بند كشف")}</td><td>${esc(l.cdate)}</td><td>${l.amount > 0 ? "إيداع" : "سحب"}</td>${money(l.amount)}</tr>`);
  }
  body.push(`<tr class="total"><td class="item">إجمالي بنود الكشف غير المسجلة</td><td></td><td></td>${money(d.totals.bankOnlySum)}</tr>`);

  body.push(sectionRow(`ثانيًا: بنود في الدفتر لم تظهر في كشف البنك — عالقة (${d.totals.glOnlyCount})`, 4));
  if (!d.glOnly.length) body.push(`<tr><td class="item" colspan="4">&nbsp;&nbsp;— لا بنود — كل حركات الدفتر ظهرت بالكشف</td></tr>`);
  for (const l of d.glOnly) {
    body.push(`<tr><td class="item">&nbsp;&nbsp;قيد #${l.entryNo} — ${esc(l.description)}</td><td>${esc(l.entryDate)}</td><td>${l.amount > 0 ? "مدين" : "دائن"}</td>${money(l.amount)}</tr>`);
  }
  body.push(`<tr class="total"><td class="item">إجمالي بنود الدفتر العالقة</td><td></td><td></td>${money(d.totals.glOnlySum)}</tr>`);

  body.push(sectionRow(`ثالثًا: الأزواج المطابقة (${d.totals.matchedCount} من ${d.totals.bankLinesCount} بند كشف و${d.totals.glLinesCount} حركة دفتر)`, 4));
  if (!d.pairs.length) body.push(`<tr><td class="item" colspan="4">&nbsp;&nbsp;— لا أزواج مطابقة</td></tr>`);
  for (const p of d.pairs.slice(0, 150)) {
    body.push(`<tr><td class="item">&nbsp;&nbsp;${esc(p.descr || "بند كشف")} ↔ قيد #${p.entryNo}</td><td>${esc(p.cdate)}</td><td>${p.dayGap === 0 ? "بنفس اليوم" : `فرق ${p.dayGap} يوم`}</td>${money(p.amount)}</tr>`);
  }
  if (d.pairs.length > 150) body.push(`<tr><td class="item" colspan="4">&nbsp;&nbsp;… وباقي الأزواج ${d.pairs.length - 150} (العرض مقتطف)</td></tr>`);

  return {
    heads: ["البيان", "التاريخ", "الحالة", "المبلغ (د.ك)"],
    colgroup: '<col style="width:46%"/><col style="width:16%"/><col style="width:18%"/><col style="width:20%"/>',
    body: body.join(""),
  };
}

function totBox(rows: [string, string, string][]): string {
  return rows
    .map(([label, value, cls]) => `<div class="tot-row"><span class="tot-label">${esc(label)}</span><span class="tot-value ${cls}">${esc(value)}</span></div>`)
    .join("");
}

export function buildBankReconHtml(d: BankReconPdfData, opts: BankReconPdfOpts): string {
  const primary = opts.primary || DEFAULT_PRIMARY;
  const accent = opts.accent || DEFAULT_ACCENT;
  const lightBg = lightTint(primary);
  const t = d.totals;
  const table = reconTable(d);

  const totalsBox = totBox([
    ["رصيد كشف البنك", `${fmt3(t.statementBalance)} ${opts.currency}`, "primary"],
    ["رصيد الدفتر (من الأستاذ)", `${fmt3(t.bookBalance)} ${opts.currency}`, "primary"],
    ["الفرق (كشف − دفتر)", fmt3(t.gap), "primary"],
    ["بنود كشف غير مسجلة", fmt3(t.bankOnlySum), "primary"],
    ["بنود دفتر عالقة", fmt3(t.glOnlySum), "primary"],
    ["المُفسَّر من الفوارق", fmt3(t.explained), "accent"],
    [
      "الفرق غير المفسَّر",
      t.unexplained === 0 ? "صفر ✓" : fmt3(t.unexplained),
      t.unexplained === 0 ? "pos" : "neg",
    ],
  ]);

  const badges = [
    { label: t.unexplained === 0 ? "لا فرق غير مفسَّر ✓" : `فرق غير مفسَّر ${fmt3(t.unexplained)}`, passed: t.unexplained === 0 },
  ]
    .map((b) => `<span class="badge ${b.passed ? "pass" : "fail"}">${esc(b.label)}</span>`)
    .join("");

  const notes =
    t.unexplained !== 0
      ? `<div class="notes"><div>⚠ الفرق غير المفسَّر يعني أن الأرصدة الافتتاحية قبل أول تسوية غير متطابقة — سوِّ بنود الفترات السابقة أو صحّح رصيد الكشف قبل الإقفال الموثق.</div></div>`
      : "";

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"/><title>تسوية بنكية ${esc(d.account.code)}</title>
<style>${baseCss(primary, accent, lightBg)}</style></head>
<body>
  <div class="hdr">
    <p class="hdr-company">${esc(opts.company.name)}</p>
    <p class="hdr-info">${esc(opts.company.address)}${opts.company.phone ? " · " + esc(opts.company.phone) : ""}${opts.company.email ? " · " + esc(opts.company.email) : ""}</p>
    <h1 class="hdr-title">تقرير التسوية البنكية والفوارق — ${esc(d.account.code)} ${esc(d.account.name)}</h1>
    <div class="badges">${badges}</div>
  </div>
  <div class="card">حتى تاريخ: ${esc(d.asOf)} · صدر: ${opts.issuedAt !== undefined ? esc(opts.issuedAt || nowStamp()) : nowStamp()} · ربط الكشف: عبر مفاتيح bank_lines</div>
  <table><thead><tr>${table.heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><colgroup>${table.colgroup}</colgroup><tbody>${table.body}</tbody></table>
  <div class="totals">${totalsBox}</div>
  ${notes}
  <div class="footer">المعادلة: رصيد الكشف − رصيد الدفتر = بنود الكشف غير المسجلة − بنود الدفتر العالقة — مبنية حصرًا من كشوف البنك المستوردة والأستاذ العام — ConTrack</div>
</body></html>`;
}
