import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, todayStr } from "@/lib/api-utils";
import { parseAttendanceCsv } from "@/lib/hr-import-core";
import { scheduleMinutesFromPunches, type WorkSchedule } from "@/lib/hr-constants";

/**
 * POST: استيراد بصمة الحضور — مرحلتان (د6/د7):
 * • mode=preview: تحليل وربط بلا أي كتابة — تقرير كامل (صالح/محدث/مخطوف-يدوي/مخطوف-إجازة/مرفوض)
 * • mode=commit: تثبيت الصالح — يضيف للأيام الخالية ويحدث ما مصدره استيراد فقط، ولا يلمس اليدوي.
 * دقائق التأخير/الانصراف تُحسب آليًا من جدول الدوام — بلا جدول صالح = صفر (أمان د3-4).
 */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const mode = body.mode === "commit" ? "commit" : "preview";
  const text = String(body.text ?? "");

  const parsed = parseAttendanceCsv(text);
  if (parsed.rows.length === 0 && parsed.rejected.length === 0) {
    return jsonError("الملف فارغ — الصق محتوى CSV/TXT أو اختر ملفًا");
  }

  // جدول الدوام + موظفو الشركة بالأرقام الوظيفية
  const setting = await db.setting.findUnique({
    where: { companyId: guard.user.companyId },
    select: { hrWorkStart: true, hrWorkEnd: true, hrGraceMinutes: true },
  });
  const schedule: WorkSchedule | null = setting
    ? { start: setting.hrWorkStart, end: setting.hrWorkEnd, graceMinutes: setting.hrGraceMinutes }
    : null;

  const employees = await db.employee.findMany({
    select: { id: true, name: true, jobNumber: true, active: true },
  });
  const byJob = new Map<string, { id: number; name: string; active: boolean }>();
  for (const e of employees) if (e.jobNumber) byJob.set(e.jobNumber, { id: e.id, name: e.name, active: e.active });

  const dates = parsed.rows.map((r) => r.workDate).sort();
  const minDate = dates.length ? dates[0] : "";
  const maxDate = dates.length ? dates[dates.length - 1] : "";
  const existing = minDate
    ? await db.employeeAttendance.findMany({
        where: { employeeId: { in: employees.map((e) => e.id) }, workDate: { gte: minDate, lte: maxDate } },
        select: { employeeId: true, workDate: true, source: true },
      })
    : [];
  const existingKey = new Set(existing.map((x) => `${x.employeeId}|${x.workDate}`));
  const existingSource = new Map(existing.map((x) => [`${x.employeeId}|${x.workDate}`, x.source]));

  // إجازات مغطاة (معتمدة/بدأت/منتهية) — الإجازة تسبق البصمة
  const leaveRanges = minDate
    ? await db.employeeLeave.findMany({
        where: { status: { in: ["معتمدة", "بدأت", "منتهية"] }, startDate: { lte: maxDate }, endDate: { gte: minDate } },
        select: { employeeId: true, startDate: true, endDate: true },
      })
    : [];

  const today = todayStr();
  const unknownJobs = new Set<string>();
  let skippedManual = 0;
  let skippedLeave = 0;

  type ImportRowAction = "create" | "update" | "skip_manual" | "skip_leave" | "rejected";
  interface ImportReportRow {
    line: number;
    jobNumber: string;
    workDate: string;
    employeeName: string;
    checkIn: string;
    checkOut: string;
    lateMinutes: number;
    earlyLeaveMinutes: number;
    note: string;
    action: ImportRowAction;
    reason: string;
  }

  const rows: ImportReportRow[] = parsed.rows.map((r): ImportReportRow => {
    const emp = byJob.get(r.jobNumber);
    if (!emp) {
      unknownJobs.add(r.jobNumber);
      return { line: r.line, jobNumber: r.jobNumber, workDate: r.workDate, employeeName: "", checkIn: r.checkIn, checkOut: r.checkOut, lateMinutes: 0, earlyLeaveMinutes: 0, note: "", action: "rejected", reason: "رقم وظيفي غير معروف" };
    }
    if (r.workDate > today) {
      return { line: r.line, jobNumber: r.jobNumber, workDate: r.workDate, employeeName: emp.name, checkIn: r.checkIn, checkOut: r.checkOut, lateMinutes: 0, earlyLeaveMinutes: 0, note: "", action: "rejected", reason: "تاريخ مستقبلي" };
    }
    const key = `${emp.id}|${r.workDate}`;
    if (existingKey.has(key) && existingSource.get(key) === "manual") {
      skippedManual++;
      return { line: r.line, jobNumber: r.jobNumber, workDate: r.workDate, employeeName: emp.name, checkIn: r.checkIn, checkOut: r.checkOut, lateMinutes: 0, earlyLeaveMinutes: 0, note: "", action: "skip_manual", reason: "يوم له سجل يدوي — الاستيراد لا يلمسه (د7)" };
    }
    const onLeave = leaveRanges.some((l) => l.employeeId === emp.id && l.startDate <= r.workDate && l.endDate >= r.workDate);
    if (onLeave) {
      skippedLeave++;
      return { line: r.line, jobNumber: r.jobNumber, workDate: r.workDate, employeeName: emp.name, checkIn: r.checkIn, checkOut: r.checkOut, lateMinutes: 0, earlyLeaveMinutes: 0, note: "", action: "skip_leave", reason: "اليوم مغطى بإجازة — الإجازة تسبق البصمة" };
    }
    const mins = schedule && r.checkIn && r.checkOut ? scheduleMinutesFromPunches(r.checkIn, r.checkOut, schedule) : { late: 0, early: 0 };
    const missing = !r.checkIn || !r.checkOut ? "بصمة ناقصة — يُصحح يدويًا" : "";
    return { line: r.line, jobNumber: r.jobNumber, workDate: r.workDate, employeeName: emp.name, checkIn: r.checkIn, checkOut: r.checkOut, lateMinutes: mins.late, earlyLeaveMinutes: mins.early, note: missing, action: existingKey.has(key) ? "update" : "create", reason: "" };
  });

  const valid = rows.filter((r) => r.action === "create" || r.action === "update");

  if (mode === "preview") {
    return ok({
      preview: true,
      totals: {
        parsedRows: parsed.rows.length,
        rejectedLines: parsed.rejected.length,
        create: valid.filter((r) => r.action === "create").length,
        update: valid.filter((r) => r.action === "update").length,
        skippedManual,
        skippedLeave,
        unknownJobs: unknownJobs.size,
      },
      rows,
      rejected: parsed.rejected,
    });
  }

  // ===== commit =====
  if (valid.length === 0) {
    return jsonError("لا توجد أسطر صالحة للتثبيت — راجع تقرير المعاينة");
  }
  const upserts = await db.$transaction(async (tx) => {
    let created = 0;
    let updated = 0;
    for (const r of valid) {
      const emp = byJob.get(r.jobNumber);
      if (!emp) continue;
      const mins = scheduleMinutesFromPunches(r.checkIn, r.checkOut, schedule ?? { start: "00:00", end: "00:00", graceMinutes: 0 });
      const data = {
        status: "present" as const,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        lateMinutes: mins.late,
        earlyLeaveMinutes: mins.early,
        source: "import" as const,
        note: r.note,
      };
      await tx.employeeAttendance.upsert({
        where: { companyId_employeeId_workDate: { companyId: guard.user.companyId, employeeId: emp.id, workDate: r.workDate } },
        create: { employeeId: emp.id, workDate: r.workDate, ...data },
        update: data,
      });
      if (r.action === "create") created++;
      else updated++;
    }
    await audit(tx, {
      username: guard.user.username,
      action: "استيراد بصمة",
      entityType: "employee_attendance",
      entityId: 0,
      entityName: `استيراد بصمة: ${created} جديد · ${updated} تحديث · ${skippedManual} يوم يدوي محمي`,
    });
    return { created, updated };
  });

  return ok({
    committed: true,
    created: upserts.created,
    updated: upserts.updated,
    skippedManual,
    skippedLeave,
    rejectedLines: parsed.rejected.length,
  });
}
