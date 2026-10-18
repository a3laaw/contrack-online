import { NextRequest } from "next/server";
import { authGuard, jsonError, ok, parseDay } from "@/lib/api-utils";
import { buildCustomerStatement } from "@/lib/report-server";

type P = { params: Promise<{ id: string }> };

/** الكشف الشامل للعميل — GET /api/statement/customer/[id]?contractId=&from=&to= */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_customers");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف العميل غير صالح");

  const sp = req.nextUrl.searchParams;
  const contractId = Number(sp.get("contractId") || 0);
  const from = parseDay(sp.get("from"));
  const to = parseDay(sp.get("to"));

  const result = await buildCustomerStatement(id, {
    contractId: Number.isFinite(contractId) && contractId > 0 ? contractId : undefined,
    from,
    to,
  });
  if (!result) {
    return jsonError(
      Number.isFinite(contractId) && contractId > 0
        ? "العميل أو العقد غير موجود (أو العقد تابع لعميل آخر/ملغى)"
        : "العميل غير موجود",
      404
    );
  }
  return ok(result);
}
