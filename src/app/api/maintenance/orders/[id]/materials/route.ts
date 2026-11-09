// POST /api/maintenance/orders/[id]/materials — صرف المواد بمحرك المخازن حرفًا (د8 — مسار كتابة واحد)
import { NextRequest } from "next/server";
import { authGuard, jsonError, moduleGuard, ok, parseDay } from "@/lib/api-utils";
import { MaintenanceError, issueMaterialsForOrder } from "@/lib/maintenance-server";

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
  const warehouseId = Number(body.warehouseId ?? 0);
  if (!warehouseId) return jsonError("المستودع مطلوب");
  const rawLines = Array.isArray(body.lines) ? body.lines : [];

  try {
    const result = await issueMaterialsForOrder(
      id,
      {
        vdate: parseDay(body.vdate),
        warehouseId,
        notes: String(body.notes ?? ""),
        lines: rawLines.map((rl) => {
          const l = (rl ?? {}) as Record<string, unknown>;
          return { itemId: Number(l.itemId ?? 0), qty: Number(l.qty ?? 0), note: String(l.note ?? "") };
        }),
      },
      guard.user.username
    );
    return ok(result, 201);
  } catch (e) {
    if (e instanceof MaintenanceError) return jsonError(e.message, e.status);
    console.error("فشل صرف مواد أمر العمل:", e);
    return jsonError("تعذر صرف المواد، حاول مجددًا", 500);
  }
}
