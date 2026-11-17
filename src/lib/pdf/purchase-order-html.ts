/**
 * purchase-order-html.ts — بنّاء HTML أمر الشراء A4 RTL (ر4 — docs/purchase-design.md د8):
 * يُحوَّل إلى PDF عبر Chromium خادميًا (renderHtmlToPdf) — نمط statement-html حرفيًا
 * (خط عربي مضمّن + شريط ترويسة + جدول البنود بلقطاتها + صندوق الإجماليات + التذييل).
 * الوحدة نقية (بلا server-only) لتُستخدم في الاختبارات والمسارات معًا.
 */

import { ARABIC_FONT_B64 } from "./font-data";

const PRIMARY = "#1F3A5F";
const ACCENT = "#2E86AB";
const BORDER_C = "#C9D6E3";
const STRIPE_C = "#D8E4EF";
const MUTED_C = "#3D5568";

/** التنسيق المالي المطابق للمكتبي {v:,.3f} */
function fmt3(n: number): string {
  return Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function baseCss(): string {
  return `
@page { size: A4; margin: 12mm; }
@font-face { font-family: "NotoNaskhArabic"; src: url(data:font/ttf;base64,${ARABIC_FONT_B64}) format("truetype"); }
* { box-sizing: border-box; }
body { direction: rtl; font-family: "NotoNaskhArabic", "Segoe UI", Tahoma, sans-serif; color: #1E293B; margin: 0; font-size: 12px; }
.hdr { background: ${PRIMARY}; color: #fff; border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; }
.hdr-company { font-size: 17px; font-weight: 700; margin: 0 0 2px; }
.hdr-info { font-size: 10px; opacity: .85; margin: 0 0 4px; }
.hdr-title { font-size: 13px; font-weight: 700; margin: 0; background: ${ACCENT}; display: inline-block; padding: 2px 10px; border-radius: 4px; }
.meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 14px; border: 1px solid ${BORDER_C}; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; background: #FBFDFE; }
.meta .row { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; }
.meta .k { color: ${MUTED_C}; }
.meta .v { font-weight: 700; }
table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
th { background: ${STRIPE_C}; border: 1px solid ${BORDER_C}; padding: 6px 6px; font-size: 10.5px; color: ${MUTED_C}; }
td { border: 1px solid ${BORDER_C}; padding: 6px 6px; font-size: 11px; text-align: center; }
td.r { text-align: right; }
td.num { font-family: ui-monospace, monospace; direction: ltr; }
tr:nth-child(even) td { background: ${STRIPE_C}33; }
.tot { border: 1px solid ${BORDER_C}; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; background: #FBFDFE; }
.tot .line { display: flex; justify-content: space-between; font-size: 12px; padding: 3px 0; }
.tot .line.grand { border-top: 1px dashed ${BORDER_C}; margin-top: 5px; padding-top: 7px; font-size: 14px; font-weight: 700; color: ${PRIMARY}; }
.sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 26px; text-align: center; font-size: 11px; color: ${MUTED_C}; }
.sign .box { border-top: 1px solid ${MUTED_C}; padding-top: 4px; }
.foot { margin-top: 14px; font-size: 9.5px; color: ${MUTED_C}; text-align: center; }
`.trim();
}

export interface PurchaseOrderPdfItem {
  itemName: string;
  unit: string;
  qty: number;
  receivedQty: number;
  unitPrice: number;
  amount: number;
}

export interface PurchaseOrderPdfData {
  company: { name?: string; address?: string; phone?: string; email?: string };
  poNumber: string;
  supplierName: string;
  supplierPhone?: string;
  supplierCr?: string;
  orderDate: string;
  expectedDate?: string;
  status: string;
  contractNumber?: string;
  notes?: string;
  currency?: string;
  items: PurchaseOrderPdfItem[];
  totalAmount: number;
  receivedAmount: number;
}

/** بناء HTML أمر الشراء — صفحة واحدة متوقعة (بنود حتى ~25 على A4) */
export function buildPurchaseOrderHtml(data: PurchaseOrderPdfData): string {
  const c = data.company || {};
  const currency = data.currency || "د.ك";
  const infoParts = [c.address, c.phone ? `هاتف: ${c.phone}` : "", c.email].filter(Boolean);
  const infoLine = infoParts.join(" | ");
  const remaining = Math.max(0, data.totalAmount - data.receivedAmount);

  const rows = data.items
    .map(
      (it, i) => `<tr>
  <td>${i + 1}</td>
  <td class="r">${esc(it.itemName)}</td>
  <td>${esc(it.unit || "—")}</td>
  <td class="num">${fmt3(it.qty)}</td>
  <td class="num">${fmt3(it.receivedQty)}</td>
  <td class="num">${fmt3(it.unitPrice)}</td>
  <td class="num">${fmt3(it.amount)}</td>
</tr>`
    )
    .join("\n");

  const body = `
<div class="hdr">
  <p class="hdr-company">${esc(c.name || "اسم الشركة")}</p>
  ${infoLine ? `<p class="hdr-info">${esc(infoLine)}</p>` : ""}
  <p class="hdr-title">أمر شراء ${esc(data.poNumber)}</p>
</div>
<div class="meta">
  <div class="row"><span class="k">المورد</span><span class="v">${esc(data.supplierName)}</span></div>
  <div class="row"><span class="k">حالة الأمر</span><span class="v">${esc(data.status)}</span></div>
  <div class="row"><span class="k">تاريخ الأمر</span><span class="v num">${esc(data.orderDate)}</span></div>
  <div class="row"><span class="k">التسليم المتوقع</span><span class="v num">${esc(data.expectedDate || "—")}</span></div>
  ${data.supplierPhone ? `<div class="row"><span class="k">هاتف المورد</span><span class="v num">${esc(data.supplierPhone)}</span></div>` : ""}
  ${data.supplierCr ? `<div class="row"><span class="k">السجل التجاري</span><span class="v num">${esc(data.supplierCr)}</span></div>` : ""}
  ${data.contractNumber ? `<div class="row"><span class="k">العقد المرتبط (عرض)</span><span class="v">${esc(data.contractNumber)}</span></div>` : ""}
</div>
<table>
  <thead>
    <tr>
      <th style="width:28px">#</th>
      <th>الصنف</th>
      <th style="width:60px">الوحدة</th>
      <th style="width:70px">المطلوب</th>
      <th style="width:70px">المستلم</th>
      <th style="width:80px">سعر الوحدة</th>
      <th style="width:90px">القيمة (${esc(currency)})</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>
<div class="tot">
  <div class="line"><span>إجمالي الأمر</span><span class="num">${fmt3(data.totalAmount)} ${esc(currency)}</span></div>
  <div class="line"><span>قيمة المستلم</span><span class="num">${fmt3(data.receivedAmount)} ${esc(currency)}</span></div>
  <div class="line grand"><span>المتبقي على الأمر</span><span class="num">${fmt3(remaining)} ${esc(currency)}</span></div>
</div>
${data.notes ? `<div class="meta"><div class="row"><span class="k">ملاحظات</span><span class="v">${esc(data.notes)}</span></div></div>` : ""}
<div class="sign">
  <div class="box">إعداد</div>
  <div class="box">اعتماد</div>
  <div class="box">توقيع المورد</div>
</div>
<div class="foot">مطبوعة آليًا من ConTrack Online — أمر شراء ${esc(data.poNumber)}</div>
`.trim();

  return pageShell(`أمر شراء ${data.poNumber}`, baseCss(), body);
}
