import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import { GatewayError, addOtherTransfer, listTransfers } from "@/lib/gateway-server";

function err(e: unknown) {
  if (e instanceof GatewayError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return jsonError("حدث خطأ غير متوقع", 500);
}

/** GET ?from=&to= — قائمة التسديدات مع تخصيصاتها وحالتها (open/partial/full) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_other_company");
  if ("response" in guard) return guard.response;
  const sp = req.nextUrl.searchParams;
  const transfers = await listTransfers((sp.get("from") || "").trim(), (sp.get("to") || "").trim());
  const totals = {
    count: transfers.length,
    amount: r3(transfers.reduce((s, t) => s + t.amount, 0)),
    alloc: r3(transfers.reduce((s, t) => s + t.alloc, 0)),
    unalloc: r3(transfers.reduce((s, t) => s + t.unalloc, 0)),
  };
  return ok({ transfers, totals });
}

/**
 * POST تسديد للشركة الأخرى — لا ينشئ أي سند نهائيًا (تسوية حسابية لا إيراد ولا مصروف):
 * {tdate, amount, method?, ref?, notes?, opIds?: [{opId, amount}] | [opId,...]} —
 * التخصيص جزئي على الصافي (gross−fee)؛ الدفع فوق الصافي مسموح «فروقات عمولة» بلا حاجز؛
 * دون opIds: توزيع تلقائي FIFO على المستحق (الأقدم أولًا).
 */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_other_company");
  if ("response" in guard) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.amount === undefined || body.tdate === undefined)
      return jsonError("التاريخ والمبلغ إلزاميان.");
    const result = await addOtherTransfer({
      tdate: String(body.tdate || ""),
      amount: Number(body.amount),
      method: String(body.method || ""),
      ref: String(body.ref || ""),
      notes: String(body.notes || ""),
      opIds: Array.isArray(body.opIds)
        ? (body.opIds as (Record<string, unknown> | number)[]).map((x) =>
            typeof x === "object" && x !== null
              ? { opId: Number((x as Record<string, unknown>).opId || 0), amount: Number((x as Record<string, unknown>).amount || 0) }
              : Number(x)
          )
        : undefined,
      username: guard.user.username,
    });
    return ok(result, 201);
  } catch (e) {
    return err(e);
  }
}

export const dynamic = "force-dynamic";
