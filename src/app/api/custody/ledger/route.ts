import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { intOr } from "@/lib/contrack-server";
import { custodyLedger } from "@/lib/custody-server";

/** كشف حركات العهدة: ?accountId=&from=&to=&kind=handover|settlement|return — برصيد تراكمي */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_custody");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const accountId = intOr(sp.get("accountId"), 0);
  if (!accountId) return jsonError("معرف حساب العهدة مطلوب");
  const from = (sp.get("from") || "").trim();
  const to = (sp.get("to") || "").trim();
  const kind = (sp.get("kind") || "").trim();

  const result = await custodyLedger(accountId, { from, to, kind });
  if (!result) return jsonError("حساب العهدة غير موجود", 404);
  return ok(result);
}
