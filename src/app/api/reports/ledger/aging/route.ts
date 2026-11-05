import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { buildAging } from "@/lib/accounting-reports-server";
import type { AgingKind } from "@/lib/accounting-reports-core";

/**
 * أعمار الذمم 30/60/90+ — Task 108.
 * GET /api/reports/ledger/aging?kind=customers|subcontractors&asOf=YYYY-MM-DD
 * من الجانب التحليلي لسطور القيد: بُعد العميل على حسابات 112x وبُعد عقد الباطن على 212x،
 * والتسوية FIFO (السداد يستهلك أقدم بند أولًا) والشيخوخة بتاريخ البنود المفتوحة.
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_ledger");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const kindRaw = (sp.get("kind") || "customers").trim();
  if (kindRaw !== "customers" && kindRaw !== "subcontractors") {
    return jsonError("نوع الأعمار: customers أو subcontractors.", 400);
  }
  const kind = kindRaw as AgingKind;

  const asOf = (sp.get("asOf") || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return jsonError("تاريخ الأعمار (حتى) مطلوب بصيغة YYYY-MM-DD.", 400);
  }

  const result = await buildAging({ kind, asOf });
  return ok(result);
}
