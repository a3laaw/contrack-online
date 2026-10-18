import { NextRequest } from "next/server";
import { jsonError, ok } from "@/lib/api-utils";
import { authGuard } from "@/lib/api-utils";
import { GatewayError, classifyOps, GATEWAY_STATUSES } from "@/lib/gateway-server";

function err(e: unknown) {
  if (e instanceof GatewayError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return jsonError("حدث خطأ غير متوقع", 500);
}

/**
 * POST تصنيف يدوي (فردي أو جماعي عبر ids):
 * {ids:[..], status:'mine'|'other'|'unmarked', receiptNo?} —
 * mine يتطلب سند قبض سارٍ صحيحًا (ويحفظ رابط match_aliases)؛
 * الموزَّعة/المسددة مرفوضة (القفل يبدأ من التوزيع).
 */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_gateway");
  if ("response" in guard) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const status = String(body.status || "");
    if (!GATEWAY_STATUSES.includes(status as (typeof GATEWAY_STATUSES)[number]))
      return jsonError("تصنيف غير صالح — القيم المسموحة: mine/other/unmarked.");
    const ids = Array.isArray(body.ids)
      ? body.ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
      : Number(body.id) > 0
        ? [Number(body.id)]
        : [];
    if (!ids.length) return jsonError("حدد عملية واحدة على الأقل.");
    const result = await classifyOps({
      ids,
      status: status as "mine" | "other" | "unmarked",
      receiptNo: String(body.receiptNo || "").trim(),
      username: guard.user.username,
    });
    return ok(result);
  } catch (e) {
    return err(e);
  }
}

export const dynamic = "force-dynamic";
