// POST /api/maintenance/orders/[id]/status — انتقالات آلة الحالة المغلقة (د4): بدء/إنهاء/إلغاء بسبب
import { NextRequest } from "next/server";
import { authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { MaintenanceError, transitionWorkOrder } from "@/lib/maintenance-server";

type P = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_maintenance");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "maintenance", "الصيانة والتشغيل");
  if (mg) return mg;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const to = String(body.to ?? "");
  if (!to) return jsonError("الحالة الهدف مطلوبة");

  try {
    const result = await transitionWorkOrder(
      id,
      to,
      { reason: String(body.reason ?? ""), completedNote: String(body.completedNote ?? "") },
      guard.user.username
    );
    return ok(result);
  } catch (e) {
    if (e instanceof MaintenanceError) return jsonError(e.message, e.status);
    console.error("فشل تغيير حالة أمر العمل:", e);
    return jsonError("تعذر تغيير الحالة، حاول مجددًا", 500);
  }
}
