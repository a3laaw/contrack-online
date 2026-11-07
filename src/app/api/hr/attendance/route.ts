import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay, todayStr } from "@/lib/api-utils";
import { ATTENDANCE_STATUSES, attendanceLabel, monthKeyOf } from "@/lib/hr-constants";

const STATUS_VALUES = ATTENDANCE_STATUSES.map((s) => s.value) as readonly string[];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** GET: سجلات الحضور — فلاتر month / employeeId / status (الأحدث أولًا، سقف 2000) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const month = req.nextUrl.searchParams.get("month") || "";
  const employeeId = Number(req.nextUrl.searchParams.get("employeeId")) || 0;
  const status = req.nextUrl.searchParams.get("status") || "";

  const where: Record<string, unknown> = {};
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) return jsonError("صيغة الشهر غير صالحة (YYYY-MM)");
    where.workDate = { gte: `${month}-01`, lte: `${month}-31` };
  }
  if (employeeId) where.employeeId = employeeId;
  if (status) {
    if (!STATUS_VALUES.includes(status)) return jsonError("حالة حضور غير معروفة");
    where.status = status;
  }

  const rows = await db.employeeAttendance.findMany({
    where,
    orderBy: [{ workDate: "desc" }, { employeeId: "asc" }],
    take: 2000,
    include: { employee: { select: { name: true, jobTitle: true } } },
  });

  return ok({
    records: rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: r.employee.name,
      jobTitle: r.employee.jobTitle,
      workDate: r.workDate,
      month: monthKeyOf(r.workDate),
      status: r.status,
      statusLabel: attendanceLabel(r.status),
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      note: r.note,
    })),
  });
}

/** POST: تسجيل حضور يوم — سجل واحد لكل موظف/يوم */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const employeeId = Number(body.employeeId);
  if (!Number.isFinite(employeeId)) return jsonError("اختر الموظف أولًا");
  const employee = await db.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return jsonError("الموظف غير موجود", 404);

  const workDate = parseDay(body.workDate);
  if (!workDate) return jsonError("تاريخ الحضور غير صالح");
  if (workDate > todayStr()) return jsonError("لا يمكن تسجيل حضور بتاريخ مستقبلي");

  const status = String(body.status || "present");
  if (!STATUS_VALUES.includes(status)) return jsonError("حالة حضور غير معروفة");

  const checkIn = String(body.checkIn || "").trim();
  const checkOut = String(body.checkOut || "").trim();
  if ((checkIn && !HHMM.test(checkIn)) || (checkOut && !HHMM.test(checkOut))) {
    return jsonError("صيغة الوقت يجب أن تكون HH:MM");
  }

  try {
    const created = await db.employeeAttendance.create({
      data: { employeeId, workDate, status, checkIn, checkOut, note: String(body.note || "").trim() },
    });
    await audit(db, {
      username: guard.user.username,
      action: "تسجيل حضور",
      entityType: "employee_attendance",
      entityId: created.id,
      entityName: `${employee.name} — ${workDate} (${attendanceLabel(status)})`,
    });
    return ok({ record: created }, 201);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique")) {
      return jsonError("مسجل مسبقًا لهذا الموظف في هذا اليوم — عدّل السجل بدلًا من تكراره");
    }
    console.error(e);
    return jsonError("تعذر تسجيل الحضور", 500);
  }
}
