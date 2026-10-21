import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { otherRunningStatement } from "@/lib/gateway-server";

/** GET ?from&to — كشف يومي بالرصيد الجاري للشركة الأخرى (سابق · داخل · دفعنا · جارٍ · نهاية) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_other_company");
  if ("response" in guard) return guard.response;
  const sp = req.nextUrl.searchParams;
  const result = await otherRunningStatement((sp.get("from") || "").trim(), (sp.get("to") || "").trim());
  return ok(result);
}

export const dynamic = "force-dynamic";
