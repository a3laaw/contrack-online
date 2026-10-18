import { NextRequest } from "next/server";
import { adminGuard, jsonError, ok } from "@/lib/api-utils";
import { GatewayError, wipeGatewayData } from "@/lib/gateway-server";

function err(e: unknown) {
  if (e instanceof GatewayError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return jsonError("حدث خطأ غير متوقع", 500);
}

/** DELETE (مدير): مسح شامل — body.confirm = 'مسح البوابة' إلزامي حرفيًا */
export async function DELETE(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const confirm = String(body.confirm || "").trim();
    if (confirm !== "مسح البوابة")
      return jsonError("تأكيد خاطئ — اكتب عبارة «مسح البوابة» حرفيًا للتنفيذ.", 422);
    const counts = await wipeGatewayData(guard.user.username);
    return ok({ wiped: true, counts, note: "بقيت البروفايلات والافتتاحي والروابط المحفوظة كما هي" });
  } catch (e) {
    return err(e);
  }
}

export const dynamic = "force-dynamic";
