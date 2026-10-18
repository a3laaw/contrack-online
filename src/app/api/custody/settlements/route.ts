import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, authGuard, jsonError, ok } from "@/lib/api-utils";
import { intOr } from "@/lib/contrack-server";
import { VoucherError } from "@/lib/voucher-server";
import { createCustodySettlement, listSettlements } from "@/lib/custody-server";

function err(e: unknown) {
  if (e instanceof VoucherError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return jsonError("حدث خطأ غير متوقع", 500);
}

/** GET: قائمة التصفيات مجمعة حسب expenseGroupRef (فلاتر accountId/from/to/q) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_custody");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const accountId = intOr(sp.get("accountId"), 0);
  const from = (sp.get("from") || "").trim();
  const to = (sp.get("to") || "").trim();
  const q = (sp.get("q") || "").trim();

  const settlements = await listSettlements({
    ...(accountId ? { accountId } : {}),
    from,
    to,
    q,
  });
  return ok({ settlements });
}

/** POST تصفية (مدير) — القاعدة 8: توزيع مبلغ سبق صرفه، سند PV لكل بند بنفس مرجع المجموعة، بلا صرف نقدي جديد */
export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await createCustodySettlement(
      {
        vdate: String(body.vdate || ""),
        custodyAccountId: intOr(body.custodyAccountId, 0),
        description: String(body.description || ""),
        lines: body.lines,
      },
      guard.user
    );
    return ok({ settlement: result }, 201);
  } catch (e) {
    return err(e);
  }
}
