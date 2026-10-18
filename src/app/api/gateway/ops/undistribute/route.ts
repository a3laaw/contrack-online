import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { GatewayError, undistributeOps } from "@/lib/gateway-server";

function err(e: unknown) {
  if (e instanceof GatewayError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return jsonError("حدث خطأ غير متوقع", 500);
}

/**
 * POST إرجاع ↩ (undo): {ids:[..]} — موزَّعة ← مرحلة التصنيف،
 * مع عكس أثره على transfer_op_allocs: حذف تخصيصات العملية،
 * وإن كانت مرتبطة بتسديد أُرجع (undo_other حرفيًا): سحب المبلغ من تسديد الشركة الأخرى
 * (يصير ضمن «دفعات على الحساب») وإعادة paid_transfer_id للصفر.
 */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_gateway");
  if ("response" in guard) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const ids = Array.isArray(body.ids)
      ? body.ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
      : Number(body.id) > 0
        ? [Number(body.id)]
        : [];
    if (!ids.length) return jsonError("حدد عملية واحدة على الأقل.");
    const result = await undistributeOps(ids, guard.user.username);
    return ok(result);
  } catch (e) {
    return err(e);
  }
}

export const dynamic = "force-dynamic";
