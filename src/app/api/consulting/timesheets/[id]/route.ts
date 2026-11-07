import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay } from "@/lib/api-utils";
import { MAX_DAY_HOURS, TIMESHEET_ACTIVITIES } from "@/lib/consulting-constants";

type P = { params: Promise<{ id: string }> };

/** PATCH: تعديل سجل ساعات — الحقول المرسلة فقط */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const entry = await db.engineerTimesheet.findUnique({ where: { id } });
  if (!entry) return jsonError("سجل الساعات غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Prisma.EngineerTimesheetUpdateInput = {};

  if (body.workDate !== undefined) {
    const workDate = parseDay(body.workDate);
    if (!workDate) return jsonError("تاريخ العمل غير صالح");
    data.workDate = workDate;
  }
  if (body.hours !== undefined) {
    const hours = Number(body.hours);
    if (!Number.isFinite(hours) || hours <= 0) return jsonError("الساعات يجب أن تكون رقمًا أكبر من صفر");
    if (hours > MAX_DAY_HOURS) return jsonError(`الساعات لا تتجاوز ${MAX_DAY_HOURS} في اليوم`);
    data.hours = hours;
  }
  if (body.activity !== undefined) {
    const activity = String(body.activity);
    if (!(TIMESHEET_ACTIVITIES as readonly string[]).includes(activity)) return jsonError("نوع النشاط غير معروف");
    data.activity = activity;
  }
  if (body.notes !== undefined) data.notes = String(body.notes || "").trim();
  if (body.contractId !== undefined) {
    const cid = Number(body.contractId) || 0;
    if (cid) {
      const contract = await db.contract.findUnique({ where: { id: cid }, select: { id: true } });
      if (!contract) return jsonError("العقد غير موجود", 404);
      data.contract = { connect: { id: cid } };
    } else {
      data.contract = { disconnect: true };
    }
  }
  if (body.engineerId !== undefined) {
    const eid = Number(body.engineerId) || 0;
    if (!eid) return jsonError("اختيار المهندس إلزامي");
    const engineer = await db.engineer.findUnique({ where: { id: eid }, select: { id: true } });
    if (!engineer) return jsonError("المهندس غير موجود", 404);
    data.engineer = { connect: { id: eid } };
  }

  await db.engineerTimesheet.update({ where: { id }, data });
  await audit(db, {
    username: guard.user.username,
    action: "تعديل ساعات",
    entityType: "engineer_timesheet",
    entityId: id,
    entityName: entry.workDate,
  });
  return ok({ updated: true });
}

/** DELETE: حذف سجل ساعات */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const entry = await db.engineerTimesheet.findUnique({ where: { id } });
  if (!entry) return jsonError("سجل الساعات غير موجود", 404);

  await db.$transaction(async (tx) => {
    await tx.engineerTimesheet.delete({ where: { id } });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف ساعات",
      entityType: "engineer_timesheet",
      entityId: id,
      entityName: entry.workDate,
      reason: "حذف من شاشة الساعات",
    });
  });
  return ok({ deleted: true });
}
