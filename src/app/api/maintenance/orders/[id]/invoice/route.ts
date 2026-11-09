// POST /api/maintenance/orders/[id]/invoice — فاتورة الزيارة بعد الإنهاء حصرًا (د9 — بمحرك الفواتير وسقفه)
import { NextRequest } from "next/server";
import { authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { MaintenanceError, invoiceWorkOrder } from "@/lib/maintenance-server";

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
  try {
    const result = await invoiceWorkOrder(
      id,
      {
        invoiceDate: String(body.invoiceDate ?? ""),
        ...(body.linePrice !== undefined && body.linePrice !== null
          ? { linePrice: Number(body.linePrice) }
          : {}),
        description: String(body.description ?? ""),
        notes: String(body.notes ?? ""),
      },
      guard.user.username
    );
    return ok(result, 201);
  } catch (e) {
    if (e instanceof MaintenanceError) return jsonError(e.message, e.status);
    console.error("فشل فوترة أمر العمل:", e);
    return jsonError("تعذر إصدار الفاتورة، حاول مجددًا", 500);
  }
}
