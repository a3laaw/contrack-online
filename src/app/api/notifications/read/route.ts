import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { markNotificationRead } from "@/lib/notification-server";

/** POST {id} — تعليم إشعار واحد كمقروء (لصاحبه فقط) */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = Number(body.id);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");
  const done = await markNotificationRead(id, guard.user.id);
  return ok({ marked: done });
}
