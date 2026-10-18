import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { GatewayError, distributeOps } from "@/lib/gateway-server";

function err(e: unknown) {
  if (e instanceof GatewayError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return jsonError("حدث خطأ غير متوقع", 500);
}

/**
 * POST توزيع قافل ◆ (الاعتماد المحاسبي): {ids:[..]} —
 * يعلّم distributed=true+distributedAt ويقفل التصنيف؛
 * المعلَّق/الموزَّع/المسدد/غير المصنّف/غير المحصَّل يُتخطى — لا مسار يتجاوز هذه الدالة.
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
    const result = await distributeOps(ids, guard.user.username);
    return ok(result);
  } catch (e) {
    return err(e);
  }
}

export const dynamic = "force-dynamic";
