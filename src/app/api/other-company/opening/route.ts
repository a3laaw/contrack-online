import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { GatewayError, getOtherOpening, setOtherOpening } from "@/lib/gateway-server";

function err(e: unknown) {
  if (e instanceof GatewayError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return jsonError("حدث خطأ غير متوقع", 500);
}

/** GET: الرصيد الافتتاحي (صف واحد id=1) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_other_company");
  if ("response" in guard) return guard.response;
  return ok({ opening: await getOtherOpening() });
}

/** PUT: ضبط الافتتاحي {amount, note?} — السالب مرفوض */
export async function PUT(req: NextRequest) {
  const guard = await authGuard(req, "screen_other_company");
  if ("response" in guard) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.amount === undefined) return jsonError("المبلغ إلزامي.");
    const amount = Number(body.amount);
    if (!Number.isFinite(amount)) return jsonError("المبلغ غير صالح.");
    const opening = await setOtherOpening(amount, String(body.note || ""), guard.user.username);
    return ok({ opening });
  } catch (e) {
    return err(e);
  }
}

export const dynamic = "force-dynamic";
