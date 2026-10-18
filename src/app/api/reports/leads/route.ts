import { NextRequest } from "next/server";
import { authGuard, ok, parseDay } from "@/lib/api-utils";
import { reportLeads } from "@/lib/report-leads";

/**
 * تقرير الفرص البيعية (rep_leads) — GET /api/reports/leads?from&to
 * العملاء المسجلون بلا أي عقد بعد · الفترة تحصر بتاريخ تسجيل العميل.
 * الصلاحية: report_prospects (الفرص البيعية في كتالوج الصلاحيات).
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "report_prospects");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const table = await reportLeads({ from: parseDay(sp.get("from")), to: parseDay(sp.get("to")) });
  return ok(table);
}
