import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { minutesOfTime, workHoursOfSchedule } from "@/lib/hr-constants";

/** GET: جدول الدوام الحالي (الافتراضيات مضمونة بحقول Setting) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const s = await db.setting.findUnique({
    where: { companyId: guard.user.companyId },
    select: { hrWorkStart: true, hrWorkEnd: true, hrGraceMinutes: true },
  });
  const schedule = {
    start: s?.hrWorkStart || "08:00",
    end: s?.hrWorkEnd || "17:00",
    graceMinutes: s?.hrGraceMinutes ?? 15,
  };
  return ok({ schedule, workHoursPerDay: workHoursOfSchedule(schedule) });
}

/** PUT: تحديث جدول الدوام — بداية قبل نهاية · سماحية 0..120 دقيقة */
export async function PUT(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const start = String(body.start || "").trim();
  const end = String(body.end || "").trim();
  const graceMinutes = Math.round(Number(body.graceMinutes));

  const sMin = minutesOfTime(start);
  const eMin = minutesOfTime(end);
  if (sMin == null || eMin == null) return jsonError("صيغة الوقت غير صالحة — المطلوب HH:MM");
  if (eMin <= sMin) return jsonError("نهاية الدوام يجب أن تكون بعد بدايته");
  if (!Number.isFinite(graceMinutes) || graceMinutes < 0 || graceMinutes > 120) {
    return jsonError("السماحية بين 0 و120 دقيقة");
  }

  // ملاحظة بنائية: الغلاف المحمي يفشل مع upsert بمفتاح companyId (injectCompound يلف الرقم بكائن) —
  // النمط الآمن المجرّب (نمط /api/settings): updateMany ثم create إن لم يتأثر صف (الغلاف يحقن companyId آليًا)
  const updated = await db.setting.updateMany({
    where: { companyId: guard.user.companyId },
    data: { hrWorkStart: start, hrWorkEnd: end, hrGraceMinutes: graceMinutes },
  });
  if (updated.count === 0) {
    await db.setting.create({ data: { hrWorkStart: start, hrWorkEnd: end, hrGraceMinutes: graceMinutes } });
  }
  await audit(db, {
    username: guard.user.username,
    action: "تعديل",
    entityType: "hr_schedule",
    entityId: guard.user.companyId,
    entityName: `جدول الدوام: ${start} → ${end} · سماحية ${graceMinutes} دقيقة`,
  });
  return ok({ schedule: { start, end, graceMinutes }, workHoursPerDay: workHoursOfSchedule({ start, end, graceMinutes }) });
}
