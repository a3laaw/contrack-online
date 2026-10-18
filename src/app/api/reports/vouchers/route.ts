import { NextRequest } from "next/server";
import { authGuard, ok, parseDay } from "@/lib/api-utils";
import { reportVouchers } from "@/lib/report-server";

/** إيرادات ومصروفات — GET /api/reports/vouchers?from&to&vtype=income|expenses|all (يُقبل option بدلًا من vtype) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "report_vouchers");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const table = await reportVouchers({
    from: parseDay(sp.get("from")),
    to: parseDay(sp.get("to")),
    option: (sp.get("vtype") || sp.get("option") || "all").trim(),
  });
  return ok(table);
}
