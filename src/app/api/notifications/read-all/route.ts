import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { markAllNotificationsRead } from "@/lib/notification-server";

/** POST — تعليم كل إشعاراتي كمقروء */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;
  const count = await markAllNotificationsRead(guard.user.id);
  return ok({ marked: count });
}
