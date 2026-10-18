import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { custodyOverview } from "@/lib/custody-server";

/** لوحة العُهد: لكل عهدة الرصيد الحالي/آخر تسليم/آخر تصفية/عدد التصفيات + الإجمالي */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_custody");
  if ("response" in guard) return guard.response;
  const data = await custodyOverview();
  return ok(data);
}
