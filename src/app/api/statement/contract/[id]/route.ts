import { NextRequest } from "next/server";
import { authGuard, jsonError, ok, parseDay } from "@/lib/api-utils";
import { buildContractStatement } from "@/lib/report-server";

type P = { params: Promise<{ id: string }> };

/** كشف حساب العقد الواحد — GET /api/statement/contract/[id]?from=&to= */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف العقد غير صالح");

  const sp = req.nextUrl.searchParams;
  const from = parseDay(sp.get("from"));
  const to = parseDay(sp.get("to"));

  const result = await buildContractStatement(id, { from, to });
  if (!result) return jsonError("العقد غير موجود", 404);
  return ok(result);
}
