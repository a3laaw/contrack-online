// GET/POST /api/maintenance/plans — الجدول الوقائي: قائمة الخطط بأحداثها + إنشاء خطة تولّد أحداثها (د5)
import { NextRequest } from "next/server";
import { authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { MaintenanceError, createMaintenancePlan, loadMaintenanceSchedule } from "@/lib/maintenance-server";

export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_maintenance");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "maintenance", "الصيانة والتشغيل");
  if (mg) return mg;

  try {
    const plans = await loadMaintenanceSchedule();
    return ok({ plans });
  } catch (e) {
    console.error("فشل تحميل الجدول الوقائي:", e);
    return jsonError("تعذر تحميل الجدول الوقائي", 500);
  }
}

export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_maintenance");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "maintenance", "الصيانة والتشغيل");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const contractId = Number(body.contractId ?? 0);
  const intervalMonths = Number(body.intervalMonths ?? 0);
  const occurrencesCount = Number(body.occurrencesCount ?? 0);
  const startDate = String(body.startDate ?? "");
  if (!contractId) return jsonError("عقد الصيانة مطلوب");

  try {
    const plan = await createMaintenancePlan(
      {
        contractId,
        name: String(body.name ?? ""),
        intervalMonths,
        occurrencesCount,
        startDate,
        notes: String(body.notes ?? ""),
      },
      guard.user.username
    );
    return ok(plan, 201);
  } catch (e) {
    if (e instanceof MaintenanceError) return jsonError(e.message, e.status);
    console.error("فشل إنشاء خطة الصيانة:", e);
    return jsonError("تعذر إنشاء الخطة، حاول مجددًا", 500);
  }
}
