import { NextRequest } from "next/server";
import { authGuard, jsonError, ok, parseDay } from "@/lib/api-utils";
import { buildSubcontractorStatement } from "@/lib/report-server";

type P = { params: Promise<{ id: string }> };

/** كشف حساب مقاول الباطن — GET /api/statement/subcontractor/[id]?from=&to= */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_subcontractors");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف المقاول غير صالح");

  const sp = req.nextUrl.searchParams;
  const from = parseDay(sp.get("from"));
  const to = parseDay(sp.get("to"));

  const result = await buildSubcontractorStatement(id, { from, to });
  if (!result) return jsonError("المقاول غير موجود", 404);
  return ok(result);
}
