import { NextRequest } from "next/server";
import { authGuard, ok, parseDay, featureGuard } from "@/lib/api-utils";
import { REPORT_FEATURE } from "@/lib/report-features";
import { reportJournal } from "@/lib/report-server";

/** دفتر اليومية — GET /api/reports/journal?from&to */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "report_journal");
  if ("response" in guard) return guard.response;

  // المرحلة 3/ب: بوابة الميزة rep_journal — تعطيلها يوقف التقرير خادميًا (كالمكتبي)
  const fGuard = await featureGuard(REPORT_FEATURE["journal"]!);
  if (fGuard) return fGuard;

  const sp = req.nextUrl.searchParams;
  const table = await reportJournal({
    from: parseDay(sp.get("from")),
    to: parseDay(sp.get("to")),
  });
  return ok(table);
}
