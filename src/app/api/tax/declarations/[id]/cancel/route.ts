import { NextRequest } from "next/server";
import { adminGuard, jsonError, ok } from "@/lib/api-utils";
import { cancelTaxDeclaration } from "@/lib/tax-server";

export const runtime = "nodejs";

/**
 * إلغاء إقرار معتمد — Task 111 — POST /api/tax/declarations/[id]/cancel {reason}
 * للمدير حصرًا — قيد عكسي موثق عبر المحرك + تعليم الإقرار ملغى (بلا حذف فيزيائي).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return jsonError("معرّف غير صحيح.", 404);
  const body = (await req.json().catch(() => null)) as { reason?: string } | null;
  try {
    const dto = await cancelTaxDeclaration(id, body?.reason || "", guard.user.username);
    return ok({ declaration: dto });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "تعذر الإلغاء.", 400);
  }
}
