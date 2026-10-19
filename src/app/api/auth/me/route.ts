import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { permsForUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;
  const perms = await permsForUser(guard.user.id, guard.user.role);
  return ok({ user: guard.user, perms });
}
