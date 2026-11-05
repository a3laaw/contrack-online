import { NextRequest } from "next/server";
import { adminGuard, jsonError, ok } from "@/lib/api-utils";
import { approveTaxDeclaration } from "@/lib/tax-server";

export const runtime = "nodejs";

/**
 * اعتماد إقرار الزكاة/الضريبة — Task 111 — POST /api/tax/declarations/[id]/approve
 * للمدير حصرًا — ذري: حراس ⇒ قيد المخصص عبر المحرك الموحد ⇒ تعليم معتمد ⇒ تدقيق.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return jsonError("معرّف غير صحيح.", 404);
  try {
    const dto = await approveTaxDeclaration(id, guard.user.username);
    return ok({ declaration: dto });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "تعذر الاعتماد.", 400);
  }
}
