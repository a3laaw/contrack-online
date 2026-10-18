import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authGuard, jsonError, parseDay, todayStr } from "@/lib/api-utils";
import { reportLeads } from "@/lib/report-leads";
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
};

/** تصدير تقرير CSV — POST /api/reports/export {report, params} (UTF-8 مع BOM للعربية) */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { report?: string; params?: Record<string, string> } | null;
  const report = (body?.report || "").trim();
  const entry = REPORT_BUILDERS[report];
  if (!entry) return jsonError("تقرير غير معروف للاستيراد/التصدير", 404);

  const guard = await authGuard(req, entry.permKey);
  if ("response" in guard) return guard.response;

  const rawParams = body?.params || {};
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawParams)) params[k] = typeof v === "string" ? v : String(v ?? "");
  if (params.from) params.from = parseDay(params.from);
  if (params.to) params.to = parseDay(params.to);

  const table = await entry.build(params);
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
