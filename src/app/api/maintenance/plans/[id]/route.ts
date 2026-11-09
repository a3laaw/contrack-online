// PATCH /api/maintenance/plans/[id] — تعديل الخطة: المنجز والمتخطى محفوظان والمعلق يُعاد توليده (د5)
import { NextRequest } from "next/server";
import { authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { MaintenanceError, updateMaintenancePlan } from "@/lib/maintenance-server";

type P = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_maintenance");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "maintenance", "الصيانة والتشغيل");
  if (mg) return mg;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const result = await updateMaintenancePlan(
      id,
      {
        name: body.name !== undefined ? String(body.name) : undefined,
        intervalMonths: Number(body.intervalMonths ?? 0),
        occurrencesCount: Number(body.occurrencesCount ?? 0),
        startDate: String(body.startDate ?? ""),
        ...(body.active !== undefined ? { active: Boolean(body.active) } : {}),
        ...(body.notes !== undefined ? { notes: String(body.notes) } : {}),
      },
      guard.user.username
    );
    return ok(result);
  } catch (e) {
    if (e instanceof MaintenanceError) return jsonError(e.message, e.status);
    console.error("فشل تعديل خطة الصيانة:", e);
    return jsonError("تعذر تعديل الخطة، حاول مجددًا", 500);
  }
}
