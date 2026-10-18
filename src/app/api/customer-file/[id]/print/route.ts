import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard } from "@/lib/api-utils";
import { EPS, r3, todayStr } from "@/lib/contrack-core";
import { loadContractCore } from "@/lib/contrack-server";

type P = { params: Promise<{ id: string }> };

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const money = (n: number) =>
  Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const VT_LABEL: Record<string, string> = {
  receipt: "سند قبض",
  payment: "سند صرف",
  transfer: "حوالة",
  custody_return: "مرتجع عهدة",
  salary_deduction: "خصم راتب",
};

/**
 * «طباعة كل المستندات» — المقابل الويبي للطباعة الدفعية المكتبية (batch_print_service):
 * مستند HTML للطباعة (RTL) يجمع بطاقة العميل + لكل عقد ملخصه + سنداته.
 * المصادقة عبر كوكي الجلسة (window.open) أو ترويسة Bearer.
 */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_customers");
  if ("response" in guard) return guard.response;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) {
    return new Response(esc("معرف غير صالح"), { status: 400 });
  }

  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) return new Response(esc("العميل غير موجود"), { status: 404 });

  const contractsRaw = await db.contract.findMany({
    where: { customerId: id },
    orderBy: { id: "desc" },
    select: {
      id: true,
      contractNumber: true,
      contractName: true,
      contractType: true,
      status: true,
      contractDate: true,
      startDate: true,
      endDate: true,
    },
  });

  const cores = await Promise.all(contractsRaw.map((c) => loadContractCore(c.id)));

  const paidRows = contractsRaw.length
    ? await db.voucher.groupBy({
        by: ["contractId"],
        where: { contractId: { in: contractsRaw.map((c) => c.id) }, vtype: "payment", cancelled: false },
        _sum: { amount: true },
      })
    : [];
  const paidByContract = new Map<number, number>();
  for (const g of paidRows) {
    if (g.contractId != null) paidByContract.set(g.contractId, r3(Number(g._sum.amount || 0)));
  }

  const voucherRows = contractsRaw.length
    ? await db.voucher.findMany({
        where: { contractId: { in: contractsRaw.map((c) => c.id) }, cancelled: false, vtype: { in: ["receipt", "payment"] } },
        orderBy: [{ vdate: "asc" }, { id: "asc" }],
        select: {
          contractId: true,
          voucherNumber: true,
          vdate: true,
          vtype: true,
          method: true,
          amount: true,
          description: true,
        },
      })
    : [];
  const vouchersByContract = new Map<number, typeof voucherRows>();
  for (const v of voucherRows) {
    const arr = vouchersByContract.get(v.contractId || 0) || [];
    arr.push(v);
    vouchersByContract.set(v.contractId || 0, arr);
  }

  // الإجماليات المالية (يُستثنى الملغى والمسودة كالمكتبي)
  let tCurrent = 0, tCollected = 0, tPaid = 0;
  const contractBlocks: string[] = [];
  contractsRaw.forEach((c, i) => {
    const core = cores[i];
    const current = core?.current ?? 0;
    const collected = core?.collected ?? 0;
    const paid = paidByContract.get(c.id) || 0;
    if (c.status !== "ملغى" && c.status !== "مسودة") {
      tCurrent += current;
      tCollected += collected;
      tPaid += paid;
    }
    const vs = vouchersByContract.get(c.id) || [];
    const voucherRowsHtml = vs.length
      ? vs
          .map(
            (v) => `<tr>
              <td class="num">${esc(v.voucherNumber)}</td>
              <td>${esc((v.vdate || "").slice(0, 10))}</td>
              <td>${esc(VT_LABEL[v.vtype] || v.vtype)}</td>
              <td>${esc(v.method || "—")}</td>
              <td class="num ${v.vtype === "receipt" ? "in" : "out"}">${money(Number(v.amount))}</td>
              <td>${esc(v.description || "—")}</td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="6" class="empty">لا توجد سندات على هذا العقد.</td></tr>`;

    contractBlocks.push(`
    <section class="contract">
      <h2>عقد ${esc(c.contractNumber)} — ${esc(c.contractName || c.contractNumber)}</h2>
      <div class="meta-grid">
        <div><span>النوع:</span> ${esc(c.contractType || "غير محدد")}</div>
        <div><span>الحالة:</span> ${esc(c.status)}</div>
        <div><span>تاريخ العقد:</span> ${esc((c.contractDate || "").slice(0, 10) || "—")}</div>
        <div><span>المدة:</span> ${esc((c.startDate || "").slice(0, 10) || "—")} ← ${esc((c.endDate || "").slice(0, 10) || "—")}</div>
        <div><span>القيمة:</span> ${money(current)} د.ك</div>
        <div><span>المحصّل:</span> ${money(collected)} د.ك</div>
        <div><span>المدفوع للمقاولين:</span> ${money(paid)} د.ك</div>
        <div><span>المتبقي:</span> ${money(r3(current - collected))} د.ك</div>
      </div>
      <h3>السندات (${vs.length})</h3>
      <table>
        <thead><tr><th>السند</th><th>التاريخ</th><th>النوع</th><th>الطريقة</th><th>المبلغ (د.ك)</th><th>البيان</th></tr></thead>
        <tbody>${voucherRowsHtml}</tbody>
      </table>
    </section>`);
  });

  const remaining = r3(tCurrent - tCollected);

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>مستندات العميل · ${esc(customer.name)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Cairo", "Segoe UI", Tahoma, sans-serif; margin: 24px; color: #0f172a; background: #fff; }
  header.doc { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; }
  header.doc h1 { font-size: 20px; margin: 0 0 4px; }
  header.doc .code { color: #475569; font-size: 12px; }
  .contact { font-size: 12.5px; color: #334155; margin-top: 4px; }
  .stamp { font-size: 11.5px; color: #64748b; text-align: left; }
  .summary { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
  .summary .tile { border: 1px solid #cbd5e1; border-radius: 10px; padding: 8px 14px; min-width: 130px; }
  .summary .tile .lbl { font-size: 11px; color: #64748b; }
  .summary .tile .val { font-size: 15px; font-weight: 800; }
  .summary .tile.red .val { color: #b91c1c; }
  .summary .tile.green .val { color: #15803d; }
  .summary .tile.amber .val { color: #b45309; }
  section.contract { border: 1px solid #cbd5e1; border-radius: 12px; padding: 14px; margin-bottom: 16px; page-break-inside: avoid; }
  section.contract h2 { font-size: 15px; margin: 0 0 8px; }
  section.contract h3 { font-size: 13px; margin: 12px 0 6px; color: #334155; }
  .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 18px; font-size: 12.5px; }
  .meta-grid span { color: #64748b; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #cbd5e1; padding: 5px 8px; text-align: right; }
  th { background: #f1f5f9; }
  td.num { text-align: left; direction: ltr; font-variant-numeric: tabular-nums; }
  td.in { color: #15803d; }
  td.out { color: #b91c1c; }
  td.empty { text-align: center; color: #94a3b8; }
  footer.print-bar { margin-top: 18px; text-align: center; }
  footer.print-bar button { font-family: inherit; font-size: 14px; padding: 10px 28px; border: 0; border-radius: 10px; background: #0f172a; color: #fff; cursor: pointer; }
  @media print {
    footer.print-bar { display: none; }
    body { margin: 12mm; }
  }
</style>
</head>
<body>
  <header class="doc">
    <div>
      <h1>مستندات العميل · ${esc(customer.name)}</h1>
      <div class="code">الكود: ${esc(customer.customerCode)}</div>
      <div class="contact">${[customer.phone ? `📞 ${esc(customer.phone)}` : "", customer.address ? `📍 ${esc(customer.address)}` : "", customer.email ? `✉ ${esc(customer.email)}` : ""].join(" &nbsp;&nbsp; ") || "لا توجد بيانات اتصال مسجلة"}</div>
    </div>
    <div class="stamp">تاريخ الطباعة<br /><b>${esc(todayStr())}</b></div>
  </header>

  <div class="summary">
    <div class="tile ${remaining > EPS ? "amber" : "green"}"><div class="lbl">إجمالي التعاملات</div><div class="val">${money(tCurrent)}</div></div>
    <div class="tile green"><div class="lbl">المسدد</div><div class="val">${money(tCollected)}</div></div>
    <div class="tile ${remaining > EPS ? "red" : "green"}"><div class="lbl">المتبقي</div><div class="val">${money(remaining)}</div></div>
    <div class="tile"><div class="lbl">المدفوع للمقاولين</div><div class="val">${money(tPaid)}</div></div>
    <div class="tile"><div class="lbl">عدد العقود</div><div class="val">${contractsRaw.length}</div></div>
  </div>

  ${contractBlocks.join("") || `<p class="empty">لا توجد عقود لهذا العميل.</p>`}

  <footer class="print-bar"><button onclick="window.print()">🖨 طباعة</button></footer>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
