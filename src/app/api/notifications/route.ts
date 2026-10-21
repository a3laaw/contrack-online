import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { unreadCount, unreadNotifications } from "@/lib/notification-server";

/** GET — إشعاراتي غير المقروءة (آخر 100) + العدد */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;
  const uid = guard.user.id;
  const [items, count] = await Promise.all([unreadNotifications(uid), unreadCount(uid)]);
  return ok({
    items: items.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
    count,
  });
}

export const dynamic = "force-dynamic";
