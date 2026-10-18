import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import {
  SubDeleteError,
  deleteSubContracts,
  deleteSubRecord,
  deleteSubVouchers,
  subDeleteOverview,
} from "@/lib/sub-delete-server";

/**
 * V5.8 — نقطة نهاية واحدة لخيارات حذف بيانات المقاول (نظير SubDeleteDialog).
 *
 * GET  ?subcontractorId=N  ⇒ معاينة الخيارات: عقود المقاول وسنداته وملخصها
 *                              وحالة سجل المقاول (قراءة فقط).
 * POST { action: "contracts" | "vouchers" | "record", subcontractorId, ... }
 *   - contracts: { subContractIds: number[], reason? } — حذف عقود باطن محددة.
 *   - vouchers:  { voucherIds: number[], reason } — حذف نهائي للمطور /
 *                  إلغاء موثّق لغيره (يُحدَّد الوضع بحسب الحساب).
 *   - record:    { reason } — حذف سجل المقاول بعد إفراغه (مطور فقط).
 */

export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_subcontractors");
  if ("response" in guard) return guard.response;
  const subId = Number(req.nextUrl.searchParams.get("subcontractorId") || 0);
  if (!subId) return jsonError("حدد المقاول.");
  const ov = await subDeleteOverview(subId);
  return ok({ ...ov, isDeveloper: guard.user.role === "developer" });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");
  const subcontractorId = Number(body.subcontractorId || 0);

  // ① حذف عقود الباطن المحددة
  if (action === "contracts") {
    const guard = await authGuard(req, "action_cancel_contract");
    if ("response" in guard) return guard.response;
    if (!subcontractorId) return jsonError("حدد المقاول.");
    const ids = Array.isArray(body.subContractIds) ? (body.subContractIds as unknown[]).map((x) => Number(x)).filter(Boolean) : [];
    try {
      const res = await deleteSubContracts(ids, guard.user.username, String(body.reason || ""));
      return ok(res);
    } catch (e) {
      return subDeleteError(e);
    }
  }

  // ② حذف/إلغاء السندات المحددة (المطور حذف نهائي — غيره إلغاء موثّق)
  if (action === "vouchers") {
    const guard = await authGuard(req, "action_cancel_contract");
    if ("response" in guard) return guard.response;
    if (!subcontractorId) return jsonError("حدد المقاول.");
    const ids = Array.isArray(body.voucherIds) ? (body.voucherIds as unknown[]).map((x) => Number(x)).filter(Boolean) : [];
    try {
      const res = await deleteSubVouchers(ids, String(body.reason || ""), {
        username: guard.user.username,
        role: guard.user.role,
      });
      return ok(res);
    } catch (e) {
      return subDeleteError(e);
    }
  }

  // ③ حذف سجل المقاول نفسه (حساب المطور فقط — بعد إفراغه)
  if (action === "record") {
    const guard = await authGuard(req);
    if ("response" in guard) return guard.response;
    if (!subcontractorId) return jsonError("حدد المقاول.");
    try {
      const res = await deleteSubRecord(subcontractorId, String(body.reason || ""), {
        username: guard.user.username,
        role: guard.user.role,
      });
      return ok(res);
    } catch (e) {
      return subDeleteError(e);
    }
  }

  return jsonError("action غير صالح (contracts|vouchers|record)");
}

function subDeleteError(e: unknown) {
  if (e instanceof SubDeleteError) return jsonError(e.message, e.status);
  console.error(e);
  return jsonError("تعذّر تنفيذ عملية الحذف", 500);
}
