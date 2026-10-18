import { NextRequest } from "next/server";
import { authGuard, jsonError, ok, todayStr } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import { dailyClearing } from "@/lib/gateway-server";

/** GET ?from=&to=&gateway= — التصفية اليومية الثلاثية sys×gw×bank لكل (بوابة، يوم):
 *  سيستم (سندات القبض بطرق البوابة) × البوابة (الموزَّعة mine/other) × البنك (D+N±1 يوم عمل ± tolerance) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_clearing");
  if ("response" in guard) return guard.response;
  const sp = req.nextUrl.searchParams;
  const today = todayStr();
  const to = (sp.get("to") || "").trim() || today;
  const from = (sp.get("from") || "").trim() || `${today.slice(0, 4)}-${today.slice(5, 7)}-01`;
  if (from > to) return jsonError("نطاق التواريخ معكوس.");
  const rows = await dailyClearing(from, to, (sp.get("gateway") || "").trim());
  const totals = {
    sys: r3(rows.reduce((s, r) => s + r.sys, 0)),
    gMine: r3(rows.reduce((s, r) => s + r.g_mine, 0)),
    gOther: r3(rows.reduce((s, r) => s + r.g_other, 0)),
    expect: r3(rows.reduce((s, r) => s + r.expect, 0)),
    bank: r3(rows.reduce((s, r) => s + r.bank_amount, 0)),
    late: rows.filter((r) => r.status === "late").length,
    diff: rows.filter((r) => r.status === "diff").length,
    done: rows.filter((r) => r.status === "done").length,
    pending: rows.filter((r) => r.status === "pending").length,
  };
  return ok({ rows, totals, from, to });
}

export const dynamic = "force-dynamic";
