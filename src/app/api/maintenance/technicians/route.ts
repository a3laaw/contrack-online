// GET /api/maintenance/technicians — الفنيون من قائمة فريق الزيارات القائمة (د7 — عرض وتقويم فقط)
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_maintenance");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "maintenance", "الصيانة والتشغيل");
  if (mg) return mg;

  try {
    const staff = await db.visitStaff.findMany({
      where: { active: true },
      orderBy: [{ sort: "asc" as const }, { id: "asc" as const }],
      select: { id: true, name: true, phone: true },
    });
    return ok({ technicians: staff });
  } catch (e) {
    console.error("فشل تحميل الفنيين:", e);
    return jsonError("تعذر تحميل قائمة الفنيين", 500);
  }
}
