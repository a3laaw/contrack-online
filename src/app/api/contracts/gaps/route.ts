import { NextRequest, NextResponse } from "next/server";

import { authGuard, jsonError } from "@/lib/api-utils";
import { contractGapsReport, fixGapsAll } from "@/lib/contracts-gaps-server";

/** تقرير الفروقات (V3.2 ج) — GET: العقود التي تختلف قيمتها عن خطتها/بنودها */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  try {
    const rep = await contractGapsReport();
    return NextResponse.json(rep);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "تعذر حساب تقرير الفروقات", 500);
  }
}

/** إصلاح الكل — الوضعان: "amounts" توحيد المبالغ، "plan" توزيع الخطط */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const body = (await req.json().catch(() => ({}))) as {
    mode?: string;
    contractIds?: number[];
  };
  if (body.mode !== "amounts" && body.mode !== "plan") {
    return jsonError("وضع الإصلاح غير صحيح — المطلوب mode: 'amounts' أو 'plan'");
  }
  const ids = Array.isArray(body.contractIds)
    ? body.contractIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  if (!ids.length) return jsonError("حدد العقود المراد إصلاحها أولًا.");
  try {
    const result = await fixGapsAll(body.mode, ids, guard.user.username);
    return NextResponse.json(result);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "تعذر تنفيذ الإصلاح", 500);
  }
}
