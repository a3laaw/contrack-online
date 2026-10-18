import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import { dueItems } from "@/lib/gateway-server";

/** GET ?gateway=&q= — عمليات الشركة الأخرى غير المسددة بالكامل (صافي = gross − fee) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_other_company");
  if ("response" in guard) return guard.response;
  const sp = req.nextUrl.searchParams;
  const items = await dueItems((sp.get("gateway") || "").trim(), (sp.get("q") || "").trim());
  const totals = {
    count: items.length,
    gross: r3(items.reduce((s, i) => s + Number(i.gross || 0), 0)),
    fees: r3(items.reduce((s, i) => s + Number(i.fee || 0), 0)),
    net: r3(items.reduce((s, i) => s + Number(i.net || 0), 0)),
    paid: r3(items.reduce((s, i) => s + Number(i.paidAllocated || 0), 0)),
    remaining: r3(items.reduce((s, i) => s + Number(i.remaining || 0), 0)),
  };
  return ok({ items, totals });
}

export const dynamic = "force-dynamic";
