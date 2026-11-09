// GET/POST /api/maintenance/orders — أوامر العمل: القائمة بفلاترها + الإنشاء (د3/د4 — بلا أي قيد)
import { NextRequest } from "next/server";
import { authGuard, jsonError, moduleGuard, ok, parseDay } from "@/lib/api-utils";
import { MaintenanceError, createWorkOrder, loadWorkOrders } from "@/lib/maintenance-server";

export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_maintenance");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "maintenance", "الصيانة والتشغيل");
  if (mg) return mg;

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? "";
  const contractId = Number(sp.get("contractId") ?? "");
  const technicianId = Number(sp.get("technicianId") ?? "");
  try {
    const orders = await loadWorkOrders({
      ...(status ? { status } : {}),
      ...(Number.isFinite(contractId) && contractId > 0 ? { contractId } : {}),
      ...(Number.isFinite(technicianId) && technicianId > 0 ? { technicianId } : {}),
      ...(parseDay(sp.get("from") ?? "") ? { from: parseDay(sp.get("from") ?? "") } : {}),
      ...(parseDay(sp.get("to") ?? "") ? { to: parseDay(sp.get("to") ?? "") } : {}),
    });
    return ok({ orders });
  } catch (e) {
    console.error("فشل تحميل أوامر العمل:", e);
    return jsonError("تعذر تحميل أوامر العمل", 500);
  }
}

export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_maintenance");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "maintenance", "الصيانة والتشغيل");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const contractId = Number(body.contractId ?? 0);
  if (!contractId) return jsonError("أمر العمل يتطلب تحديد عقد الصيانة (G8)");

  try {
    const order = await createWorkOrder(
      {
        title: String(body.title ?? ""),
        description: String(body.description ?? ""),
        contractId,
        occurrenceId: Number(body.occurrenceId ?? 0) || null,
        technicianId: Number(body.technicianId ?? 0) || null,
        scheduledDate: String(body.scheduledDate ?? ""),
        notes: String(body.notes ?? ""),
      },
      guard.user.username
    );
    return ok(order, 201);
  } catch (e) {
    if (e instanceof MaintenanceError) return jsonError(e.message, e.status);
    console.error("فشل إنشاء أمر العمل:", e);
    return jsonError("تعذر إنشاء الأمر، حاول مجددًا", 500);
  }
}
