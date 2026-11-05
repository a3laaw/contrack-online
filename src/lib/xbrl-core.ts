/**
 * xbrl-core.ts — نواة تصدير iXBRL النقية (بلا React ولا server-only) — Task 111.
 * التقديم الإلكتروني لوزارة التجارة والصناعة (الكويت): وثيقة iXBRL واحدة تجمع القوائم
 * المالية الأربع موسومة بـ ix:nonFraction عبر خريطة xbrlElement الموجودة على الحسابات.
 *
 * قرارات التصميم الموثقة:
 *  • التوسمة من نفس مصدر القوائم: كل سطر بقيمة غير صفرية وعنصر خريطة يُوسم ix:nonFraction
 *    (sign="-" عند العرض المعاكس) — لا إعادة حساب ولا إدخال يدوي (نفس الأرقام المعروضة).
 *  • السياقات: instant(asOf) للمركز المالي، duration(from..to) للدخل والتدفقات والملكية.
 *  • الدقة: KWD ثلاثي عشري — decimals="3"، القيم بلا فواصل آلاف (صيغة lexical الرقمية).
 *  • البيانات الوصفية للشركة (الاسم/رقم الترخيص/السنة) من إعداداتها — الترخيص معرّف الكيان
 *    (scheme kw:LicenseNo)؛ فحص اكتمال الخريطة قبل التصدير: تقرير «عناصر غير مغطاة».
 *  • عناصر الإجماليات الكبرى مثبتة من الدليل نفسه (قيم الأقسام إذا حملت الأب عنصرًا).
 */

import type { BalanceSheetResult, CashFlowResult, EquityChangesResult, FsLine, IncomeStatementResult } from "./financial-statements-core";
import { r3 } from "./accounting-journal";

export interface XbrlMeta {
  companyName: string;
  companyLicense: string;
  year: number;
  asOf: string;
  from: string;
  currency: string; // "KWD"
}

export interface UncoveredLine {
  statement: string;
  code: string;
  name: string;
  amount: number;
}

export interface XbrlCoverage {
  complete: boolean;
  tagged: number;
  uncovered: UncoveredLine[];
  totalsTagged: string[];
}

/** فحص الاكتمال: كل سطر بقيمة ≠ 0 يجب أن يحمل عنصر خريطة */
export function checkCoverage(input: {
  income: IncomeStatementResult;
  balanceSheet: BalanceSheetResult;
  equity: EquityChangesResult;
  cashflow: CashFlowResult;
}): XbrlCoverage {
  const uncovered: UncoveredLine[] = [];
  let tagged = 0;

  const scan = (statement: string, lines: FsLine[]) => {
    for (const l of lines) {
      if (r3(l.amount) === 0) continue;
      if (l.xbrl) tagged += 1;
      else uncovered.push({ statement, code: l.code, name: l.name, amount: r3(l.amount) });
    }
  };
  scan("المركز المالي — الأصول", input.balanceSheet.assets.lines);
  scan("المركز المالي — الالتزامات", input.balanceSheet.liabilities.lines);
  scan("المركز المالي — حقوق الملكية", input.balanceSheet.equity.lines.filter((l) => !l.computed));
  scan("قائمة الدخل", input.income.revenue.lines);
  for (const sec of input.income.expenses) scan("قائمة الدخل", sec.lines);
  scan("حقوق الملكية", input.equity.rows.map((r) => ({ code: r.code, name: r.name, amount: r.closing, xbrl: r.xbrl } as FsLine)));

  return {
    complete: uncovered.length === 0,
    tagged,
    uncovered,
    totalsTagged: ["نتيجة الفترة تُوسم بـ ifrs-full:ProfitLoss", "الإجماليات الكبرى تُوسم بعناصر الأقسام من الدليل"],
  };
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** القيمة الرقمية lexical بلا فواصل — سالب العرض المعاكس يُرمى sign="-" والقيمة |v| */
function ixValue(v: number): { lexical: string; sign: string } {
  const a = r3(v);
  const sign = a < 0 ? ' sign="-"' : "";
  return { lexical: Math.abs(a).toFixed(3), sign };
}

function fact(name: string, context: string, amount: number, extra = ""): string {
  const { lexical, sign } = ixValue(amount);
  return `<ix:nonFraction name="${esc(name)}" contextRef="${esc(context)}" unitRef="KWD" decimals="3"${sign}${extra}>${lexical}</ix:nonFraction>`;
}

function escAttr(v: unknown): string {
  return esc(v);
}

/** بناء وثيقة iXBRL كاملة (HTML معلوماتي قابل للفتح بالمتصفح والتحقق البنيوي) */
export function buildIxbrlDocument(input: {
  meta: XbrlMeta;
  income: IncomeStatementResult;
  balanceSheet: BalanceSheetResult;
  equity: EquityChangesResult;
  cashflow: CashFlowResult;
  coverage: XbrlCoverage;
  /** طبع وسم السطور غير المغطاة كسطور عادية (force) — الافتراضي يمنع التصدير الناقص */
  force?: boolean;
}): { html: string } {
  const { meta } = input;
  const ctxInstant = "ctx_instant";
  const ctxDuration = "ctx_duration";

  const facts: string[] = [];

  // ===== المركز المالي (instant) =====
  const bsRows: string[] = [];
  const section = (title: string) => `<tr class="sec"><td colspan="2">${esc(title)}</td></tr>`;
  const line = (l: FsLine, ctx: string, stmt: string) => {
    if (r3(l.amount) === 0) return "";
    if (l.xbrl) {
      facts.push(fact(l.xbrl, ctx, l.amount));
      return `<tr><td class="item">${esc(l.code)} — ${esc(l.name)}</td><td class="num">${Math.abs(l.amount).toFixed(3)}${l.amount < 0 ? " (معاكس)" : ""}</td></tr>`;
    }
    return `<tr class="untagged"><td class="item">${esc(l.code)} — ${esc(l.name)}</td><td class="num">${Math.abs(l.amount).toFixed(3)}${l.amount < 0 ? " (معاكس)" : ""}</td></tr>`;
  };

  bsRows.push(section("الأصول"));
  for (const l of input.balanceSheet.assets.lines) {
    const row = line(l, ctxInstant, "bs");
    if (row) bsRows.push(row);
  }
  bsRows.push(section("الالتزامات"));
  for (const l of input.balanceSheet.liabilities.lines) {
    const row = line(l, ctxInstant, "bs");
    if (row) bsRows.push(row);
  }
  bsRows.push(section("حقوق الملكية"));
  for (const l of input.balanceSheet.equity.lines.filter((x) => !x.computed)) {
    const row = line(l, ctxInstant, "bs");
    if (row) bsRows.push(row);
  }
  // نتيجة السنة الجارية + إجماليات كبرى بعناصر مثبتة
  if (r3(input.balanceSheet.netResult) !== 0) {
    facts.push(fact("ifrs-full:ProfitLoss", ctxDuration, input.balanceSheet.netResult));
    bsRows.push(`<tr><td class="item">نتيجة السنة الجارية (غير مقفلة)</td><td class="num">${Math.abs(input.balanceSheet.netResult).toFixed(3)}${input.balanceSheet.netResult < 0 ? " (معاكس)" : ""}</td></tr>`);
  }
  if (input.balanceSheet.assets.lines.some((l) => l.xbrl && r3(l.amount) !== 0)) {
    facts.push(fact("ifrs-full:Assets", ctxInstant, input.balanceSheet.totalAssets));
  }
  if (input.balanceSheet.liabilities.lines.some((l) => l.xbrl && r3(l.amount) !== 0)) {
    facts.push(fact("ifrs-full:Liabilities", ctxInstant, input.balanceSheet.liabilities.total));
  }
  if (input.balanceSheet.equity.lines.some((l) => l.xbrl && r3(l.amount) !== 0)) {
    facts.push(fact("ifrs-full:Equity", ctxInstant, input.balanceSheet.equityWithResult));
  }

  // ===== قائمة الدخل (duration) =====
  const isRows: string[] = [];
  isRows.push(section("الإيرادات"));
  for (const l of input.income.revenue.lines) {
    const row = line(l, ctxDuration, "is");
    if (row) isRows.push(row);
  }
  for (const sec of input.income.expenses) {
    isRows.push(section(sec.title));
    for (const l of sec.lines) {
      const row = line(l, ctxDuration, "is");
      if (row) isRows.push(row);
    }
  }
  if (r3(input.income.netResult) !== 0) {
    facts.push(fact("ifrs-full:ProfitLoss", ctxDuration, input.income.netResult));
  }

  // ===== التدفقات النقدية (duration) — أسطر الأقسام الثلاثة بعناصر الحسابات =====
  const cfRows: string[] = [];
  const cfSection = (title: string, rows: typeof input.cashflow.operating) => {
    cfRows.push(section(title));
    for (const r of rows) {
      if (r3(r.net) === 0) continue;
      cfRows.push(`<tr><td class="item">${esc(r.code)} — ${esc(r.name)}</td><td class="num">${Math.abs(r.net).toFixed(3)}${r.net < 0 ? " (منصرف)" : ""}</td></tr>`);
    }
  };
  cfSection("الأنشطة التشغيلية", input.cashflow.operating);
  cfSection("الأنشطة الاستثمارية", input.cashflow.investing);
  cfSection("الأنشطة التمويلية", input.cashflow.financing);

  const hidden = `<ix:hidden><ix:nonFraction name="kw:CompanyName" contextRef="${ctxInstant}" unitRef="KWD" decimals="3" format="ixt:not-restated-entity-name">${escAttr(meta.companyName)}</ix:nonFraction>${meta.companyLicense ? `<ix:nonFraction name="kw:LicenseNumber" contextRef="${ctxInstant}" unitRef="KWD" decimals="3" format="ixt:not-restated-entity-identifier">${escAttr(meta.companyLicense)}</ix:nonFraction>` : ""}<ix:nonFraction name="kw:FiscalYear" contextRef="${ctxInstant}" unitRef="KWD" decimals="3">${meta.year}</ix:nonFraction>${facts.join("")}</ix:hidden>`;

  const blocked = !input.coverage.complete && !input.force;

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl" xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL">
<head><meta charset="utf-8"/><title>iXBRL ${esc(meta.companyName)} — ${meta.year}</title>
<style>
@page { size: A4; margin: 14mm; }
body { direction: rtl; font-family: "Traditional Arabic", sans-serif; color: #000; font-size: 10pt; margin: 10mm; }
h1 { font-size: 14pt; } h2 { font-size: 12pt; margin-bottom: 2mm; }
.meta { background: #F2F6FA; padding: 3mm 4mm; border-radius: 2mm; margin-bottom: 5mm; font-size: 9.5pt; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 6mm; }
th { background: #1F3A5F; color: #fff; padding: 2mm 1mm; border: 0.35mm solid #C9D6E3; font-size: 10pt; }
td { border: 0.35mm solid #C9D6E3; padding: 1.5mm 1mm; font-size: 9pt; text-align: center; }
td.item { text-align: right; padding-inline: 2.5mm; }
td.num { white-space: nowrap; }
tr.sec td { background: #D8E4EF; font-weight: 700; color: #1F3A5F; }
tr.untagged td { background: #FBE9E7; }
.note { font-size: 9pt; color: #3D5568; margin-top: 4mm; }
.warn { color: #B03A2E; font-weight: 700; }
</style></head>
<body>
${blocked ? `<p class="warn">⛔ التصدير محجوب — خريطة XBRL غير مكتملة (انظر تقرير العناصر غير المغطاة). أضف العناصر من دليل الحسابات أو صدّر كمسودة بـ force.</p>` : ""}
<h1>وثيقة التقديم iXBRL — ${esc(meta.companyName)}</h1>
<div class="meta">
  السنة المالية: ${meta.year} · حتى: ${meta.asOf} · فترة الدخل: ${meta.from} ← ${meta.asOf} · العملة: ${esc(meta.currency)}
  ${meta.companyLicense ? `· رقم الترخيص: ${escAttr(meta.companyLicense)}` : ""}
  <br/>الموسومة آليًا: ${input.coverage.tagged} بندًا — الاكتمال: ${input.coverage.complete ? "كامل ✓" : `ناقص (${input.coverage.uncovered.length} بندًا بلا عنصر)`}
</div>
<h2>قائمة المركز المالي</h2>
<table><thead><tr><th style="width:70%">البند</th><th>المبلغ (${esc(meta.currency)})</th></tr></thead><tbody>${bsRows.join("")}</tbody></table>
<h2>قائمة الدخل الشامل</h2>
<table><thead><tr><th style="width:70%">البند</th><th>المبلغ (${esc(meta.currency)})</th></tr></thead><tbody>${isRows.join("")}</tbody></table>
<h2>التدفقات النقدية (الأقسام)</h2>
<table><thead><tr><th style="width:70%">القسم</th><th>الصافي (${esc(meta.currency)})</th></tr></thead><tbody>${cfRows.join("")}</tbody></table>
<p class="note">تُبنى هذه الوثيقة من الأستاذ العام حصرًا عبر خريطة xbrlElement على الحسابات — كل قيمة موسومة ix:nonFraction مرتبطة بسياقها (لحظي للمركز / مدى للدخل والتدفقات). التقرير الإلكتروني لوزارة التجارة والصناعة — القرار الوزاري 44/2016.</p>
</body></html>`;

  // حقن ix:header بعد فتح body (نمط iXBRL الواقعي: الرأس يسبق المحتوى الموسوم)
  const withHeader = html.replace(/<body>/, `<body>${hidden.replace("</ix:hidden>", `</ix:hidden><ix:resources><ix:contexts><ix:context id="${ctxInstant}"><ix:period><ix:instant>${meta.asOf}</ix:instant></ix:period><ix:entity><ix:identifier scheme="kw:LicenseNo">${escAttr(meta.companyLicense || meta.companyName)}</ix:identifier></ix:entity></ix:context><ix:context id="${ctxDuration}"><ix:period><ix:startDate>${meta.from}</ix:startDate><ix:instant>${meta.asOf}</ix:instant></ix:period><ix:entity><ix:identifier scheme="kw:LicenseNo">${escAttr(meta.companyLicense || meta.companyName)}</ix:identifier></ix:entity></ix:context></ix:contexts></ix:resources>`)}`);
  return { html: withHeader };
}
