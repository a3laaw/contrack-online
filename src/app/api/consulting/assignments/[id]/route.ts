import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay } from "@/lib/api-utils";
import { ASSIGNMENT_STATUSES } from "@/lib/consulting-constants";

type P = { params: Promise<{ id: string }> };

/** PATCH: تعديل إسناد — الحقول المرسلة فقط (الدور/النسبة/التواريخ/الحالة) */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const assignment = await db.engineerAssignment.findUnique({
    where: { id },
    include: { engineer: { select: { name: true } } },
  });
  if (!assignment) return jsonError("الإسناد غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Prisma.EngineerAssignmentUpdateInput = {};

  if (body.role !== undefined) data.role = String(body.role || "").trim();
  if (body.allocationPct !== undefined) {
    const n = Number(body.allocationPct);
    if (!Number.isFinite(n) || n < 0 || n > 100) return jsonError("نسبة الإخصاص بين 0 و 100");
    data.allocationPct = n;
  }
  if (body.startDate !== undefined) {
    const startDate = body.startDate ? parseDay(body.startDate) : "";
    if (body.startDate && !startDate) return jsonError("تاريخ البداية غير صالح");
    data.startDate = startDate;
  }
  if (body.endDate !== undefined) {
    const endDate = body.endDate ? parseDay(body.endDate) : "";
    if (body.endDate && !endDate) return jsonError("تاريخ النهاية غير صالح");
    data.endDate = endDate;
  }
  if (body.status !== undefined) {
    const status = String(body.status);
    if (!(ASSIGNMENT_STATUSES as readonly string[]).includes(status)) return jsonError("حالة الإسناد غير معروفة");
    data.status = status;
  }
  if (body.notes !== undefined) data.notes = String(body.notes || "").trim();

  const startDate = String(data.startDate ?? assignment.startDate);
  const endDate = String(data.endDate ?? assignment.endDate);
  if (startDate && endDate && endDate < startDate) return jsonError("نهاية الإسناد قبل بدايته");

  await db.engineerAssignment.update({ where: { id }, data });
  await audit(db, {
    username: guard.user.username,
    action: "تعديل إسناد",
    entityType: "engineer_assignment",
    entityId: id,
    entityName: assignment.engineer.name,
    oldStatus: assignment.status,
    newStatus: String(data.status || assignment.status),
  });
  return ok({ updated: true });
}

/** DELETE: حذف إسناد */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const assignment = await db.engineerAssignment.findUnique({
    where: { id },
    include: { engineer: { select: { name: true } } },
  });
  if (!assignment) return jsonError("الإسناد غير موجود", 404);

  await db.$transaction(async (tx) => {
    await tx.engineerAssignment.delete({ where: { id } });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف إسناد",
      entityType: "engineer_assignment",
      entityId: id,
      entityName: assignment.engineer.name,
      reason: "حذف من شاشة الإسنادات",
    });
  });
  return ok({ deleted: true });
}
