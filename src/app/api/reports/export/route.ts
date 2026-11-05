import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authGuard, featureGuard, jsonError, parseDay, todayStr } from "@/lib/api-utils";
import { REPORT_FEATURE } from "@/lib/report-features";
import { reportLeads } from "@/lib/report-leads";
import { buildXlsxBuffer, reportTableToSheet, XLSX_MIME } from "@/lib/xlsx-core";
import {
  ReportTable,
  reportCashflow,
  reportContracts,
  reportCustomersBalances,
  reportExecution,
  reportExpenses,
  reportGatewaySummary,
  reportJournal,
  reportStageDues,
  reportSubcontractors,
  reportSupervisionDelays,
  reportTableToCsv,
  reportVouchers,
} from "@/lib/report-server";
import { buildGeneralLedger, buildTrialBalance, buildAging } from "@/lib/accounting-reports-server";
import {
  glReportTable,
  tbReportTable,
  agingReportTable,
  type AgingKind,
} from "@/lib/accounting-reports-core";

/** خريطة التقارير مع مفتاح الصلاحية المطابق من كتالوج PERMISSIONS */
const REPORT_BUILDERS: Record<
  string,
  { permKey: string; build: (params: Record<string, string>) => Promise<ReportTable> }
> = {
  "customers-balances": {
    permKey: "report_customers_balances",
    build: (p) =>
      reportCustomersBalances({ option: p.option || "all", from: p.from || "", to: p.to || "" }),
  },
  "stage-dues": { permKey: "report_stage_dues", build: (p) => reportStageDues({ option: p.option || "all" }) },
  "supervision-delays": {
    permKey: "report_supervision_delays",
    build: (p) => reportSupervisionDelays({ option: p.option || "unpaid" }),
  },
  subcontractors: { permKey: "report_subcontractors", build: async () => reportSubcontractors() },
  vouchers: {
    permKey: "report_vouchers",
    build: (p) => reportVouchers({ from: p.from || "", to: p.to || "", option: p.vtype || p.option || "all" }),
  },
  expenses: { permKey: "report_expenses", build: (p) => reportExpenses({ from: p.from || "", to: p.to || "" }) },
  cashflow: {
    permKey: "report_cashflow",
    build: (p) => reportCashflow({ from: p.from || "", to: p.to || "", mode: p.mode || "summary" }),
  },
  contracts: {
    permKey: "report_contracts",
    build: (p) => reportContracts({ option: p.option || "all", from: p.from || "", to: p.to || "" }),
  },
  execution: {
    permKey: "report_execution",
    build: (p) => reportExecution({ option: p.option || "stages", contractType: p.contractType || "", stage: p.stage || "" }),
  },
  leads: { permKey: "report_prospects", build: (p) => reportLeads({ from: p.from || "", to: p.to || "" }) },
  journal: { permKey: "report_journal", build: (p) => reportJournal({ from: p.from || "", to: p.to || "" }) },
  "gateway-summary": { permKey: "report_gateway_summary", build: async () => reportGatewaySummary() },
  // Task 108 — مخرجات المحاسبة من الأستاذ (بصلاحية الشاشة نفسها)
  "general-ledger": {
    permKey: "screen_ledger",
    build: async (p) => {
      const accountId = Number(p.accountId || 0);
      if (!accountId) throw new Error("اختيار الحساب مطلوب لتصدير دفتر الأستاذ.");
      const gl = await buildGeneralLedger({
        accountId,
        from: p.from || "",
        to: p.to || "",
        customerId: Number(p.customerId || 0) || undefined,
        contractId: Number(p.contractId || 0) || undefined,
        subContractId: Number(p.subContractId || 0) || undefined,
        costCenter: p.costCenter || undefined,
      });
      if (!gl) throw new Error("الحساب غير موجود في دليل الشركة.");
      return glReportTable({
        accountCode: gl.account.code,
        accountName: gl.account.name,
        from: p.from || "",
        to: p.to || "",
        rows: gl.rows,
        opening: gl.opening,
        totals: gl.totals,
      });
    },
  },
  "trial-balance": {
    permKey: "screen_ledger",
    build: async (p) => {
      const asOf = (p.asOf || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("تاريخ الميزان (حتى) مطلوب بصيغة YYYY-MM-DD.");
      const tb = await buildTrialBalance({ asOf });
      return tbReportTable({ asOf, rows: tb.rows, totals: tb.totals });
    },
  },
  aging: {
    permKey: "screen_ledger",
    build: async (p) => {
      const kindRaw = (p.kind || "customers").trim();
      if (kindRaw !== "customers" && kindRaw !== "subcontractors") throw new Error("نوع الأعمار: customers أو subcontractors.");
      const asOf = (p.asOf || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("تاريخ الأعمار (حتى) مطلوب بصيغة YYYY-MM-DD.");
      const ag = await buildAging({ kind: kindRaw as AgingKind, asOf });
      return agingReportTable({ kind: ag.kind, asOf, rows: ag.rows, totals: ag.totals });
    },
  },
};

/** تصدير تقرير CSV/Excel — POST /api/reports/export {report, params} [&format=xlsx|csv] (الافتراضي csv) */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { report?: string; params?: Record<string, string> } | null;
  const report = (body?.report || "").trim();
  const entry = REPORT_BUILDERS[report];
  if (!entry) return jsonError("تقرير غير معروف للاستيراد/التصدير", 404);

  const guard = await authGuard(req, entry.permKey);
  if ("response" in guard) return guard.response;

  // المرحلة 3/ب: بوابة الميزة rep_* — تعطيل التقرير يوقف تصديره أيضًا (كالمكتبي)
  // («expenses» و«gateway-summary» بلا مفتاح مكتبي — بلا بوابة ميزة، موثق في report-features.ts)
  if (REPORT_FEATURE[report]) {
    const fGuard = await featureGuard(REPORT_FEATURE[report]);
    if (fGuard) return fGuard;
  }

  const rawParams = body?.params || {};
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawParams)) params[k] = typeof v === "string" ? v : String(v ?? "");
  if (params.from) params.from = parseDay(params.from);
  if (params.to) params.to = parseDay(params.to);

  const table = await entry.build(params);
  const format = (req.nextUrl.searchParams.get("format") || "csv").trim().toLowerCase();

  // المرحلة 8: xlsx حقيقي (RTL وترويسة ملوّنة وأرقام بأرقام) — الافتراضي يبقى csv
  if (format === "xlsx") {
    const buf = await buildXlsxBuffer({ sheets: [reportTableToSheet(table)] });
    const filename = `report-${report}-${todayStr()}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": XLSX_MIME,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const csv = reportTableToCsv(table);
  const filename = `report-${report}-${todayStr()}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
