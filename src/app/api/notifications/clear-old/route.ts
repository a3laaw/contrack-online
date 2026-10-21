import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { clearOldNotifications } from "@/lib/notification-server";

/** POST {days?} — مسح المقروءة كلها + غير المقروءة الأقدم من المدة (افتراضي 30 يومًا) */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const days = Number.isFinite(Number(body.days)) ? Math.trunc(Number(body.days)) : 30;
  const count = await clearOldNotifications(guard.user.id, days);
  return ok({ cleared: count });
}
