import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { intOr } from "@/lib/contrack-server";
import { transferDetail } from "@/lib/gateway-server";

type P = { params: Promise<{ id: string }> };

/** GET: تغطية تسديد — العمليات المخصصة مجموعة بتاريخ العملية + مجاميع الكل/المخصص/المتبقي */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_other_company");
  if ("response" in guard) return guard.response;
  const { id } = await params;
  const detail = await transferDetail(intOr(id, 0));
  if (!detail) return jsonError("التسديد غير موجود", 404);
  return ok({ transfer: detail.transfer, ops: detail.ops, groups: detail.groups, totals: detail.totals });
}

export const dynamic = "force-dynamic";
