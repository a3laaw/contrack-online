import { NextRequest } from "next/server";
import { authGuard, ok, parseDay, featureGuard } from "@/lib/api-utils";
import { REPORT_FEATURE } from "@/lib/report-features";
import { reportVouchers } from "@/lib/report-server";

/** إيرادات ومصروفات — GET /api/reports/vouchers?from&to&vtype=income|expenses|all (يُقبل option بدلًا من vtype) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "report_vouchers");
  if ("response" in guard) return guard.response;

  // المرحلة 3/ب: بوابة الميزة rep_vouchers — تعطيلها يوقف التقرير خادميًا (كالمكتبي)
  const fGuard = await featureGuard(REPORT_FEATURE["vouchers"]!);
  if (fGuard) return fGuard;

  const sp = req.nextUrl.searchParams;
  const table = await reportVouchers({
    from: parseDay(sp.get("from")),
    to: parseDay(sp.get("to")),
    option: (sp.get("vtype") || sp.get("option") || "all").trim(),
  });
  return ok(table);
}
