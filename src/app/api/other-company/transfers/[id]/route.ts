import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { intOr } from "@/lib/contrack-server";
import { GatewayError, deleteOtherTransfer, transferDetail } from "@/lib/gateway-server";

type P = { params: Promise<{ id: string }> };

function err(e: unknown) {
  if (e instanceof GatewayError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return jsonError("حدث خطأ غير متوقع", 500);
}

/** GET: تفاصيل تسديد + ما غطاه (العمليات المخصصة والمجموعات) */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_other_company");
  if ("response" in guard) return guard.response;
  const { id } = await params;
  const detail = await transferDetail(intOr(id, 0));
  if (!detail) return jsonError("التسديد غير موجود", 404);
  return ok(detail);
}

/** DELETE (إلغاء تسديد): يحذف تخصيصاته ويعيد العمليات لغير المسدد — بلا أي أثر على سندات العملاء */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_other_company");
  if ("response" in guard) return guard.response;
  try {
    const { id } = await params;
    const result = await deleteOtherTransfer(intOr(id, 0), guard.user.username);
    return ok(result);
  } catch (e) {
    return err(e);
  }
}

export const dynamic = "force-dynamic";
