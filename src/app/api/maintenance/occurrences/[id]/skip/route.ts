// POST /api/maintenance/occurrences/[id]/skip — تخطي/إلغاء تخطي حدث وقائي (د6)
import { NextRequest } from "next/server";
import { authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { MaintenanceError, toggleOccurrenceSkip } from "@/lib/maintenance-server";

type P = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_maintenance");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "maintenance", "الصيانة والتشغيل");
  if (mg) return mg;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  try {
    const result = await toggleOccurrenceSkip(id, guard.user.username);
    return ok(result);
  } catch (e) {
    if (e instanceof MaintenanceError) return jsonError(e.message, e.status);
    console.error("فشل تخطي الحدث:", e);
    return jsonError("تعذر تخطي الحدث، حاول مجددًا", 500);
  }
}
