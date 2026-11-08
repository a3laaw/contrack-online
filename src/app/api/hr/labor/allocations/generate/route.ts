import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { generateBatchAllocations, writeBatchAllocations } from "@/lib/hr-server";

/**
 * POST {batchId} — توليد التخصيصات آليًا من التكليفات السارية المتقاطعة مع شهر الدفعة (د3):
 * مخالفات السقف ⇒ 400 برسائل عربية بالأسماء وبلا أي كتابة (د7).
 * النجاح ⇒ استبدال كامل لأسطر الدفعة بلقطات جديدة + قائمة المتخطيين (بلا تكليفات).
 */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const batchId = Number(body.batchId);
  if (!Number.isFinite(batchId)) return jsonError("معرف الدفعة غير صالح");

  try {
    const { plan, employeeNames } = await db.$transaction(async (tx) => generateBatchAllocations(tx, batchId));
    if (plan.errors.length > 0) {
      const details = plan.errors
        .map((e) => `«${employeeNames.get(e.employeeId) ?? e.employeeId}» مجموع تكليفاته السارية ${e.sum}% — السقف 100% (د7)`)
        .join(" · ");
      return jsonError(`تعذر التوليد: ${details}`, 400);
    }

    const res = await db.$transaction(async (tx) =>
      writeBatchAllocations(
        tx,
        batchId,
        plan.rows.map((r) => ({ employeeId: r.employeeId, contractId: r.contractId, sharePercent: r.sharePercent })),
        guard.user.username
      )
    );
    await audit(db, {
      username: guard.user.username,
      action: "توليد توزيع",
      entityType: "labor_allocation",
      entityId: batchId,
      entityName: `دفعة #${batchId} — ${res.created} سطرًا من التكليفات`,
      reason: plan.skipped.length ? `غير موزعين: ${plan.skipped.map((id) => employeeNames.get(id) ?? id).join("، ")}` : "",
    });
    return ok({ created: res.created, skipped: plan.skipped.map((id) => ({ employeeId: id, name: employeeNames.get(id) ?? "" })) });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "تعذر توليد التوزيع", 400);
  }
}
