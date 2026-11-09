// GET /api/maintenance/contracts — قسم «عقود الصيانة»: العقود الموسومة بتجمعاتها (د2)
import { NextRequest } from "next/server";
import { authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { loadMaintenanceContracts } from "@/lib/maintenance-server";

export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_maintenance");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "maintenance", "الصيانة والتشغيل");
  if (mg) return mg;

  try {
    const data = await loadMaintenanceContracts();
    return ok(data);
  } catch (e) {
    console.error("فشل تحميل عقود الصيانة:", e);
    return jsonError("تعذر تحميل عقود الصيانة", 500);
  }
}
