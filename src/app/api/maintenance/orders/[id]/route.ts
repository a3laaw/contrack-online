// GET/PATCH /api/maintenance/orders/[id] — تفاصيل الأمر + تعديله وهو «مفتوحة» حصرًا (د4)
import { NextRequest } from "next/server";
import { authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { MaintenanceError, loadWorkOrders, updateWorkOrder } from "@/lib/maintenance-server";

type P = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_maintenance");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "maintenance", "الصيانة والتشغيل");
  if (mg) return mg;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");
  try {
    const orders = await loadWorkOrders({});
    const order = orders.find((o) => o.id === id);
    if (!order) return jsonError("أمر العمل غير موجود", 404);
    return ok({ order });
  } catch (e) {
    console.error("فشل تحميل أمر العمل:", e);
    return jsonError("تعذر تحميل الأمر", 500);
  }
}

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
    const result = await updateWorkOrder(
      id,
      {
        ...(body.title !== undefined ? { title: String(body.title) } : {}),
        ...(body.description !== undefined ? { description: String(body.description) } : {}),
        ...(body.technicianId !== undefined
          ? { technicianId: Number(body.technicianId ?? 0) || null }
          : {}),
        ...(body.scheduledDate !== undefined ? { scheduledDate: String(body.scheduledDate) } : {}),
        ...(body.notes !== undefined ? { notes: String(body.notes) } : {}),
      },
      guard.user.username
    );
    return ok(result);
  } catch (e) {
    if (e instanceof MaintenanceError) return jsonError(e.message, e.status);
    console.error("فشل تعديل أمر العمل:", e);
    return jsonError("تعذر تعديل الأمر، حاول مجددًا", 500);
  }
}
