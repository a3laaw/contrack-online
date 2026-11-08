import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { ATTENDANCE_STATUSES, attendanceLabel } from "@/lib/hr-constants";
import { minutesForCompanyPunches } from "@/lib/hr-server";

type P = { params: Promise<{ id: string }> };

const STATUS_VALUES = ATTENDANCE_STATUSES.map((s) => s.value) as readonly string[];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** PATCH: تعديل سجل حضور — الحقول المرسلة فقط */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const rec = await db.employeeAttendance.findUnique({ where: { id }, include: { employee: { select: { name: true } } } });
  if (!rec) return jsonError("سجل الحضور غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};

  if (body.status !== undefined) {
    const status = String(body.status);
    if (!STATUS_VALUES.includes(status)) return jsonError("حالة حضور غير معروفة");
    data.status = status;
  }
  if (body.checkIn !== undefined) {
    const v = String(body.checkIn || "").trim();
    if (v && !HHMM.test(v)) return jsonError("صيغة الوقت يجب أن تكون HH:MM");
    data.checkIn = v;
  }
  if (body.checkOut !== undefined) {
    const v = String(body.checkOut || "").trim();
    if (v && !HHMM.test(v)) return jsonError("صيغة الوقت يجب أن تكون HH:MM");
    data.checkOut = v;
  }
  if (body.note !== undefined) data.note = String(body.note || "").trim();

  // HR-2 — إعادة حساب الدقائق إذا تغيرت البصمات أو الحالة (الحالات غير الحاضرة = صفر)
  const finalCheckIn = data.checkIn !== undefined ? String(data.checkIn) : rec.checkIn;
  const finalCheckOut = data.checkOut !== undefined ? String(data.checkOut) : rec.checkOut;
  const finalStatus = data.status !== undefined ? String(data.status) : rec.status;
  if (finalStatus === "present" && (data.checkIn !== undefined || data.checkOut !== undefined || data.status !== undefined)) {
    const mins = await minutesForCompanyPunches(db, guard.user.companyId, finalCheckIn, finalCheckOut);
    data.lateMinutes = mins.lateMinutes;
    data.earlyLeaveMinutes = mins.earlyLeaveMinutes;
    data.source = "manual";
  }

  await db.employeeAttendance.update({ where: { id }, data });
  await audit(db, {
    username: guard.user.username,
    action: "تعديل حضور",
    entityType: "employee_attendance",
    entityId: id,
    entityName: `${rec.employee.name} — ${rec.workDate}`,
    oldStatus: attendanceLabel(rec.status),
    newStatus: data.status ? attendanceLabel(String(data.status)) : attendanceLabel(rec.status),
  });
  return ok({ updated: true });
}

/** DELETE: حذف سجل حضور */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const rec = await db.employeeAttendance.findUnique({ where: { id }, include: { employee: { select: { name: true } } } });
  if (!rec) return jsonError("سجل الحضور غير موجود", 404);

  const reason = (req.nextUrl.searchParams.get("reason") || "").trim() || "حذف سجل حضور";
  await db.employeeAttendance.delete({ where: { id } });
  await audit(db, {
    username: guard.user.username,
    action: "حذف حضور",
    entityType: "employee_attendance",
    entityId: id,
    entityName: `${rec.employee.name} — ${rec.workDate}`,
    reason,
  });
  return ok({ deleted: true });
}
