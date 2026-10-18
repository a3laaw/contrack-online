import { NextRequest } from "next/server";
import { authGuard, ok, parseDay } from "@/lib/api-utils";
import { reportJournal } from "@/lib/report-server";

/** دفتر اليومية — GET /api/reports/journal?from&to */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "report_journal");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const table = await reportJournal({
    from: parseDay(sp.get("from")),
    to: parseDay(sp.get("to")),
  });
  return ok(table);
}
