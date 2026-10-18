import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;
  return ok({ user: guard.user });
}
