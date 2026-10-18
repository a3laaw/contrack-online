import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, jsonError, ok } from "@/lib/api-utils";
import { EPS, r3 } from "@/lib/contrack-core";
import { intOr } from "@/lib/contrack-server";
import { createVoucher, VoucherError } from "@/lib/voucher-server";
import { custodyBreakdown } from "@/lib/custody-server";

/** POST (مدير): إرجاع متبقٍ عهدة للخزينة — سند CV بسقف قاطع على المتبقي، بلا أثر إيرادي ولا رسوم */
export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const custodyAccountId = intOr(body.custodyAccountId, 0);
    if (!custodyAccountId) return jsonError("حساب العهدة مطلوب");
    const acc = await db.expenseAccount.findUnique({ where: { id: custodyAccountId } });
    if (!acc || acc.accountKind !== "advance") return jsonError("حساب العهدة غير صالح (يجب أن يكون من حسابات العُهد)", 404);

    const amount = r3(Number(body.amount));
    if (!Number.isFinite(amount) || !(amount > 0)) return jsonError("مبلغ الإرجاع يجب أن يكون أكبر من صفر");

    // سقف قاطع على المتبقي (handed − spent − returned)
    const bd = await custodyBreakdown(db, acc.id);
    if (amount > bd.balance + EPS) {
      return Response.json({ error: `المبلغ يتجاوز متبقي العهدة (${bd.balance} د.ك فقط)` }, { status: 400 });
    }

    const created = await createVoucher(
      {
        vtype: "custody_return",
        amount,
        vdate: String(body.vdate || ""),
        custodyAccountId: acc.id,
        method: String(body.method || ""),
        account: body.account !== undefined && body.account !== null ? String(body.account) : undefined,
        description: String(body.description || ""),
      },
      guard.user
    );
    return ok({ voucher: { ...created, custodyAccountId: acc.id, custodyAccountName: acc.name, amount } }, 201);
  } catch (e) {
    if (e instanceof VoucherError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return jsonError("تعذر إنشاء سند الإرجاع", 500);
  }
}
