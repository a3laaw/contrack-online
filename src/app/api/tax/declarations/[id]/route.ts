import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { deleteTaxDraft } from "@/lib/tax-server";

export const runtime = "nodejs";

/** حذف مسودة إقرار (بلا أثر مالي) — DELETE /api/tax/declarations/[id] */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await authGuard(req, "screen_zakat_xbrl");
  if ("response" in guard) return guard.response;
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return jsonError("معرّف غير صحيح.", 404);
  try {
    await deleteTaxDraft(id);
    return ok({ deleted: true });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "تعذر الحذف.", 400);
  }
}
