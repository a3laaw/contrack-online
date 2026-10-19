import { NextRequest, NextResponse } from "next/server";
import { authGuard, jsonError, ok, parseDay, todayStr } from "@/lib/api-utils";
import { intOr } from "@/lib/contrack-server";
import { buildXlsxBuffer, XLSX_MIME, type XlsxSheet } from "@/lib/xlsx-core";
import {
  custodyBalancesReport,
  custodyDetailedReport,
  custodyHandoverListReport,
  custodyLedgerReport,
  custodyMonthlySummary,
  custodyOpenItemsReport,
  settlementsSummaryReport,
} from "@/lib/custody-reports";

/**
 * تقارير العُهد السبعة — GET /api/custody/reports
 * ?kind=summary|balances|employee|detailed|monthly|handovers|open
 *   &from=&to=&accountId=&asOf=&q= [&format=csv]
 * أعمدة وصفوف CSV مطابقة لمصادير التصدير المكتبية (custody_center.py):
 * التصفييات ببنودها (↳) ومجاميعها الفرعية عند تعدد العهد + صف الإجمالي.
 */

const r3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;

const csvCell = (v: string | number) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function toCsv(title: string, heads: string[], rows: (string | number)[][], totalsRow?: (string | number)[]): string {
  const lines: string[] = [csvCell(title), "", heads.map(csvCell).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  if (totalsRow) lines.push(totalsRow.map(csvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

const SUMMARY_HEADS = ["المرجع", "التاريخ", "العهدة", "البنود", "الإجمالي", "البيان"];
const BAL_HEADS = ["العهدة", "المُسلَّم", "المُنفَق", "الرصيد", "تسليمات", "بنود منصرف"];
const EMP_HEADS = ["التاريخ", "المرجع", "البيان", "وارد", "منصرف", "الرصيد"];
const DET_HEADS = ["التاريخ", "المرجع", "العهدة", "نوع الحركة", "البيان", "المستلم / المورد", "حساب المصروف", "العميل / العقد", "وارد", "منصرف", "الرصيد"];
const MON_HEADS = ["الشهر", "العهدة", "رصيد أول المدة", "تسليم", "صرف (تصفية)", "مرتجع", "رصيد آخر المدة"];
const HO_HEADS = ["التاريخ", "رقم العهدة", "العهدة (الحساب)", "المستلم", "المبلغ", "البيان", "طريقة الدفع"];
const OPEN_HEADS = ["العهدة", "الرصيد المفتوح", "المُسلَّم", "المُنفَق", "أقدم تسليم", "الأيام", "تسليمات"];

export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_custody");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const kind = (sp.get("kind") || "").trim();
  const from = parseDay(sp.get("from") || "") || "";
  const to = parseDay(sp.get("to") || "") || "";
  const accountId = sp.get("accountId") ? intOr(sp.get("accountId"), 0) || null : null;
  const asOf = parseDay(sp.get("asOf") || "") || "";
  const q = (sp.get("q") || "").trim();
  const csv = (sp.get("format") || "").trim().toLowerCase() === "csv";
  const xlsx = (sp.get("format") || "").trim().toLowerCase() === "xlsx";

  let title = "";
  let heads: string[] = [];
  let rows: (string | number)[][] = [];
  let totalsRow: (string | number)[] | undefined;
  let payload: unknown;

  try {
    switch (kind) {
      case "summary": {
        const data = await settlementsSummaryReport(from, to, accountId);
        title = `تقرير تصفيات مجمع · من ${from} إلى ${to}`;
        const accNames = new Set(data.rows.map((g) => g.custodyAccount || "—"));
        const subtotals: (string | number)[][] = [];
        if (accNames.size >= 2) {
          const byAcc = new Map<string, { lines: number; total: number }>();
          for (const g of data.rows) {
            const k = g.custodyAccount || "—";
            const e = byAcc.get(k) || { lines: 0, total: 0 };
            e.lines += g.lines;
            e.total = r3(e.total + g.total);
            byAcc.set(k, e);
          }
          for (const acc of [...byAcc.keys()].sort()) {
            const e = byAcc.get(acc)!;
            subtotals.push([`إجمالي: ${acc}`, "", "", e.lines, e.total, ""]);
          }
        }
        const tableRows: (string | number)[][] = [];
        for (const g of data.rows) {
          const acc = g.custodyAccount || "—";
          tableRows.push([g.ref, g.vdate, acc, g.lines, g.total, g.description || ""]);
          for (const d of g.details) {
            tableRows.push([
              `  ↳ ${d.voucherNumber}`,
              d.vdate,
              acc,
              `${d.expenseAccount || ""} · ${d.party || ""}`,
              d.amount,
              d.description || "",
            ]);
          }
        }
        rows = [...tableRows, ...subtotals];
        heads = SUMMARY_HEADS;
        totalsRow = ["الإجمالي", "", `${accNames.size} عهد`, data.count, data.total, ""];
        payload = data;
        break;
      }
      case "balances": {
        const data = await custodyBalancesReport(from, to);
        title = `أرصدة العهد · من ${from} إلى ${to}`;
        const th = r3(data.reduce((s, r) => s + r.handed, 0));
        const ts = r3(data.reduce((s, r) => s + r.spent, 0));
        rows = data.map((r) => [r.account, r.handed, r.spent, r.balance, r.handedCount, r.spentCount]);
        heads = BAL_HEADS;
        totalsRow = ["الإجمالي", th, ts, r3(th - ts), "", ""];
        payload = data;
        break;
      }
      case "employee": {
        if (!accountId) return jsonError("اختيار العهدة مطلوب لكشف الموظف");
        const data = await custodyLedgerReport(accountId, from, to, "");
        const accName = data.accounts.find((a) => a.accountId === accountId)?.account || "—";
        title = `كشف عهدة ${accName}`;
        rows = data.rows.map((r) => [r.vdate, r.ref, r.description, r.in || "", r.out || "", r.balance]);
        heads = EMP_HEADS;
        totalsRow = ["الإجمالي", "", "", data.totals.in, data.totals.out, data.totals.balance];
        payload = { ...data, accountName: accName };
        break;
      }
      case "detailed": {
        const data = await custodyDetailedReport(from, to, accountId);
        title = `التقرير التفصيلي للعهد · من ${from} إلى ${to}`;
        rows = data.rows.map((r) => [
          r.vdate, r.ref, r.account, r.type, r.description, r.party, r.expense, r.customer,
          r.in || "", r.out || "", r.balance,
        ]);
        heads = DET_HEADS;
        totalsRow = ["الإجمالي", "", "", "", "", "", "", "", data.totals.in, data.totals.out, data.totals.balance];
        payload = data;
        break;
      }
      case "monthly": {
        const data = await custodyMonthlySummary(from, to, accountId);
        title = `الملخص الشهري للعهد · من ${from} إلى ${to}`;
        rows = data.rows.map((r) => [r.month, r.account, r.opening, r.handed, r.spent, r.returned, r.closing]);
        heads = MON_HEADS;
        totalsRow = ["الإجمالي", "", "", data.totals.handed, data.totals.spent, data.totals.returned, ""];
        payload = data;
        break;
      }
      case "handovers": {
        const data = await custodyHandoverListReport(from, to, accountId);
        title = `العهد المسلّمة · من ${from} إلى ${to}`;
        const total = r3(data.reduce((s, h) => s + h.amount, 0));
        rows = data.map((h) => [h.vdate, h.ref, h.custodyAccount || "", h.party || "", h.amount, h.description || "", h.method || ""]);
        heads = HO_HEADS;
        totalsRow = ["الإجمالي", "", "", "", total, "", ""];
        payload = data;
        break;
      }
      case "open": {
        const data = await custodyOpenItemsReport(asOf);
        title = `العهد المعلقة · حتى ${asOf || todayStr()}`;
        const tot = r3(data.reduce((s, r) => s + r.balance, 0));
        rows = data.map((r) => [r.account, r.balance, r.handed, r.spent, r.oldest || "—", r.days, r.handovers]);
        heads = OPEN_HEADS;
        totalsRow = ["الإجمالي", tot, "", "", "", "", ""];
        payload = data;
        break;
      }
      default:
        return jsonError("نوع تقرير العهد غير معروف", 400);
    }
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "تعذر بناء تقرير العهد", 500);
  }

  if (csv) {
    const csvText = toCsv(title, heads, rows, totalsRow);
    const filename = `custody-report-${kind}-${todayStr()}.csv`;
    return new NextResponse(csvText, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // المرحلة 8: xlsx حقيقي — أرقام بأرقام بتنسيق المكتبي #,##0.000 في أعمدة القيم
  if (xlsx) {
    const numberCols = heads
      .map((_, i) => (rows.some((r) => typeof r[i] === "number") ? i : -1))
      .filter((i) => i >= 0);
    const sheet: XlsxSheet = {
      name: title.slice(0, 28) || "تقرير العهد",
      columns: heads.map((h) => ({ header: h })),
      rows,
      numberCols,
      totalsRow: totalsRow ?? null,
    };
    const buf = await buildXlsxBuffer({ sheets: [sheet] });
    const filename = `custody-report-${kind}-${todayStr()}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": XLSX_MIME,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return ok({ kind, title, heads, rowsCount: rows.length, totalsRow, data: payload });
}
