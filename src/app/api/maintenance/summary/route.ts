// GET /api/maintenance/summary — مؤشرات الشاشة (د12): مفتوحة · مجدولة الشهر · متأخرة · عقود نشطة
import { NextRequest } from "next/server";
import { authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { loadMaintenanceKpis } from "@/lib/maintenance-server";

export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_maintenance");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "maintenance", "الصيانة والتشغيل");
  if (mg) return mg;

  try {
    const kpis = await loadMaintenanceKpis();
    return ok(kpis);
  } catch (e) {
    console.error("فشل تحميل مؤشرات الصيانة:", e);
    return jsonError("تعذر تحميل المؤشرات", 500);
  }
}
