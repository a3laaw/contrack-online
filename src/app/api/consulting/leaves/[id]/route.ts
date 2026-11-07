import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay } from "@/lib/api-utils";
import { LEAVE_TYPES, leaveDaysBetween } from "@/lib/consulting-constants";

type P = { params: Promise<{ id: string }> };

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * PATCH: قرار الإجازة أو تعديلها:
 * - {action:'approve'} ⇒ معتمدة + قرار موثق باسم المعتمد ووقته
 * - {action:'reject', decisionNote} ⇒ مرفوضة — سبب الرفض إلزامي (توثيق)
 * - تعديل الحقول (leaveType/startDate/endDate/reason) — للطلبات المعلقة فقط
 */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const leave = await db.engineerLeave.findUnique({
    where: { id },
    include: { engineer: { select: { name: true } } },
  });
  if (!leave) return jsonError("طلب الإجازة غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "").trim();

  // ===== اعتماد =====
  if (action === "approve") {
    if (leave.status !== "معلقة") return jsonError("القرار اتخذ مسبقًا في هذا الطلب");
    await db.engineerLeave.update({
      where: { id },
      data: {
        status: "معتمدة",
        decisionBy: guard.user.fullName || guard.user.username,
        decisionAt: nowStamp(),
        decisionNote: String(body.decisionNote || "").trim(),
      },
    });
    await audit(db, {
      username: guard.user.username,
      action: "اعتماد إجازة",
      entityType: "engineer_leave",
      entityId: id,
      entityName: leave.engineer.name,
      oldStatus: "معلقة",
      newStatus: "معتمدة",
    });
    return ok({ updated: true, status: "معتمدة" });
  }

  // ===== رفض — السبب إلزامي =====
  if (action === "reject") {
    if (leave.status !== "معلقة") return jsonError("القرار اتخذ مسبقًا في هذا الطلب");
    const decisionNote = String(body.decisionNote || "").trim();
    if (!decisionNote) return jsonError("سبب الرفض إلزامي");
    await db.engineerLeave.update({
      where: { id },
      data: {
        status: "مرفوضة",
        decisionBy: guard.user.fullName || guard.user.username,
        decisionAt: nowStamp(),
        decisionNote,
      },
    });
    await audit(db, {
      username: guard.user.username,
      action: "رفض إجازة",
      entityType: "engineer_leave",
      entityId: id,
      entityName: leave.engineer.name,
      oldStatus: "معلقة",
      newStatus: "مرفوضة",
      reason: decisionNote,
    });
    return ok({ updated: true, status: "مرفوضة" });
  }

  // ===== تعديل طلب معلق =====
  if (leave.status !== "معلقة") return jsonError("لا يُعدَّل الطلب بعد اتخاذ القرار");

  let leaveType = leave.leaveType;
  let startDate = leave.startDate;
  let endDate = leave.endDate;

  if (body.leaveType !== undefined) {
    leaveType = String(body.leaveType);
    if (!(LEAVE_TYPES as readonly string[]).includes(leaveType)) return jsonError("نوع الإجازة غير معروف");
  }
  if (body.startDate !== undefined) {
    startDate = parseDay(body.startDate);
    if (!startDate) return jsonError("تاريخ البداية غير صالح");
  }
  if (body.endDate !== undefined) {
    endDate = parseDay(body.endDate);
    if (!endDate) return jsonError("تاريخ النهاية غير صالح");
  }
  if (endDate < startDate) return jsonError("نهاية الإجازة قبل بدايتها");
  const days = leaveDaysBetween(startDate, endDate);
  if (days <= 0) return jsonError("أيام الإجازة غير صالحة");

  await db.engineerLeave.update({
    where: { id },
    data: { leaveType, startDate, endDate, days, reason: body.reason !== undefined ? String(body.reason || "").trim() : leave.reason },
  });
  await audit(db, {
    username: guard.user.username,
    action: "تعديل إجازة",
    entityType: "engineer_leave",
    entityId: id,
    entityName: leave.engineer.name,
  });
  return ok({ updated: true });
}

/** DELETE: حذف طلب إجازة */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const leave = await db.engineerLeave.findUnique({
    where: { id },
    include: { engineer: { select: { name: true } } },
  });
  if (!leave) return jsonError("طلب الإجازة غير موجود", 404);

  await db.$transaction(async (tx) => {
    await tx.engineerLeave.delete({ where: { id } });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف إجازة",
      entityType: "engineer_leave",
      entityId: id,
      entityName: leave.engineer.name,
      reason: "حذف من شاشة الإجازات",
    });
  });
  return ok({ deleted: true });
}
