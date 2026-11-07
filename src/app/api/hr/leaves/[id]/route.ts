import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay } from "@/lib/api-utils";
import {
  canTransitionLeave,
  HR_LEAVE_TYPES,
  leaveDaysBetween,
  recountAnnualBalance,
  sickTierFor,
} from "@/lib/hr-constants";

type P = { params: Promise<{ id: string }> };

function nowStamp(): string {
  return new Date().toISOString();
}

/** ∑ أيام نوع إجازة مستهلكة لسنة معينة (معتمدة/بدأت/منتهية) لموظف */
async function consumedDays(employeeId: number, leaveType: string, year: number, beforeId?: number): Promise<number> {
  const rows = await db.employeeLeave.findMany({
    where: {
      employeeId,
      leaveType,
      status: { in: ["معتمدة", "بدأت", "منتهية"] },
      startDate: { gte: `${year}-01-01`, lte: `${year}-12-31` },
    },
    select: { id: true, days: true },
  });
  return rows.filter((r) => r.id !== beforeId).reduce((s, r) => s + Number(r.days), 0);
}

/** PATCH: قرارات الإجازة — approve / reject / commence / return / edit (للمعلقة) — آلة الحالات حاكمة */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const leave = await db.employeeLeave.findUnique({ where: { id }, include: { employee: { select: { name: true, hireDate: true } } } });
  if (!leave) return jsonError("طلب الإجازة غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");
  const decisionBy = guard.user.fullName || guard.user.username;

  // ===== اعتماد — من معلقة، والسنوية تشترط كفاية الرصيد =====
  if (action === "approve") {
    if (!canTransitionLeave(leave.status, "معتمدة")) return jsonError("القرار اتخذ مسبقًا في هذا الطلب");
    if (leave.leaveType === "سنوية") {
      const year = Number(leave.startDate.slice(0, 4));
      const consumed = await consumedDays(leave.employeeId, "سنوية", year, leave.id);
      const b = recountAnnualBalance({ hireDate: leave.employee.hireDate, year, consumedApprovedDays: consumed });
      if (Number(leave.days) > b.balance) {
        return jsonError(`الرصيد السنوي لا يكفي — المتاح ${b.balance} يوم والمطلوب ${Number(leave.days)} يوم`);
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    const status = leave.startDate <= today ? "بدأت" : "معتمدة";
    await db.employeeLeave.update({
      where: { id },
      data: { status, decisionBy, decisionAt: nowStamp(), decisionNote: String(body.decisionNote || "").trim() },
    });
    await audit(db, {
      username: guard.user.username,
      action: "اعتماد إجازة",
      entityType: "employee_leave",
      entityId: id,
      entityName: `${leave.employee.name} — ${leave.leaveType} ${Number(leave.days)} يوم`,
      oldStatus: leave.status,
      newStatus: status,
    });
    return ok({ updated: true, status });
  }

  // ===== رفض — السبب إلزامي =====
  if (action === "reject") {
    if (!canTransitionLeave(leave.status, "مرفوضة")) return jsonError("القرار اتخذ مسبقًا في هذا الطلب");
    const decisionNote = String(body.decisionNote || "").trim();
    if (!decisionNote) return jsonError("سبب الرفض إلزامي");
    await db.employeeLeave.update({
      where: { id },
      data: { status: "مرفوضة", decisionBy, decisionAt: nowStamp(), decisionNote },
    });
    await audit(db, {
      username: guard.user.username,
      action: "رفض إجازة",
      entityType: "employee_leave",
      entityId: id,
      entityName: `${leave.employee.name} — ${leave.leaveType}`,
      oldStatus: leave.status,
      newStatus: "مرفوضة",
      reason: decisionNote,
    });
    return ok({ updated: true, status: "مرفوضة" });
  }

  // ===== بدء (معتمدة → بدأت) ومنتهية (بدأت → منتهية) =====
  if (action === "commence" || action === "return") {
    const target = action === "commence" ? "بدأت" : "منتهية";
    if (!canTransitionLeave(leave.status, target)) {
      return jsonError(action === "commence" ? "البدء من الإجازات المعتمدة فقط" : "الانتهاء من الإجازات البادئة فقط");
    }
    await db.employeeLeave.update({ where: { id }, data: { status: target, decisionBy, decisionAt: nowStamp() } });
    await audit(db, {
      username: guard.user.username,
      action: action === "commence" ? "بدء إجازة" : "عودة من إجازة",
      entityType: "employee_leave",
      entityId: id,
      entityName: `${leave.employee.name} — ${leave.leaveType}`,
      oldStatus: leave.status,
      newStatus: target,
    });
    return ok({ updated: true, status: target });
  }

  // ===== تعديل الطلب المعلق فقط =====
  if (action === "edit") {
    if (leave.status !== "معلقة") return jsonError("تعديل الطلبات المعلقة فقط");
    const data: Record<string, unknown> = {};
    if (body.leaveType !== undefined) {
      const lt = String(body.leaveType);
      if (!(HR_LEAVE_TYPES as readonly string[]).includes(lt)) return jsonError("نوع الإجازة غير معروف");
      data.leaveType = lt;
    }
    const leaveType = String(data.leaveType || leave.leaveType);
    let startDate = leave.startDate;
    let endDate = leave.endDate;
    if (body.startDate !== undefined) {
      startDate = parseDay(body.startDate);
      if (!startDate) return jsonError("تاريخ البداية غير صالح");
    }
    if (body.endDate !== undefined) {
      endDate = parseDay(body.endDate);
      if (!endDate) return jsonError("تاريخ النهاية غير صالح");
    }
    const days = leaveDaysBetween(startDate, endDate);
    if (days <= 0) return jsonError("تاريخ النهاية يجب أن يكون بعد البداية أو مساويًا له");
    data.startDate = startDate;
    data.endDate = endDate;
    data.days = days;
    if (leaveType === "مرضية" && (data.leaveType || leave.leaveType !== "مرضية" || data.startDate)) {
      const year = Number(startDate.slice(0, 4));
      const used = await consumedDays(leave.employeeId, "مرضية", year, leave.id);
      data.sickTier = sickTierFor(used).tier;
    } else if (leaveType !== "مرضية") {
      data.sickTier = null;
    }
    await db.employeeLeave.update({ where: { id }, data });
    await audit(db, {
      username: guard.user.username,
      action: "تعديل إجازة",
      entityType: "employee_leave",
      entityId: id,
      entityName: `${leave.employee.name} — ${leaveType} ${days} يوم`,
    });
    return ok({ updated: true });
  }

  return jsonError("إجراء غير معروف");
}

/** DELETE: حذف طلب معلق فقط (القرارات الموثقة لا تُحذف) */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const leave = await db.employeeLeave.findUnique({ where: { id }, include: { employee: { select: { name: true } } } });
  if (!leave) return jsonError("طلب الإجازة غير موجود", 404);
  if (leave.status !== "معلقة") return jsonError("يُحذف الطلب المعلق فقط — القرارات الموثقة تبقى");

  const reason = (req.nextUrl.searchParams.get("reason") || "").trim() || "حذف طلب إجازة معلق";
  await db.$transaction(async (tx) => {
    await tx.employeeLeave.delete({ where: { id } });
    await tx.purgeAudit.create({
      data: {
        purgedBy: guard.user.username,
        entity: "employee_leave",
        entityId: id,
        label: `${leave.employee.name} — ${leave.leaveType} ${Number(leave.days)} يوم`,
        reason,
        snapshot: JSON.stringify({ leave, deletedAt: new Date().toISOString() }),
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف إجازة",
      entityType: "employee_leave",
      entityId: id,
      entityName: `${leave.employee.name} — ${leave.leaveType}`,
      reason,
    });
  });
  return ok({ deleted: true });
}
