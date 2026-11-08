import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";

type P = { params: Promise<{ id: string }> };

/** PATCH: تعديل الفريق — الاسم/الحالة/الملاحظة/الأعضاء (استبدال كامل للمجموعة عند إرسال employeeIds) */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;
  const id = Number((await params).id);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const team = await db.workTeam.findUnique({ where: { id }, include: { _count: { select: { members: true } } } });
  if (!team) return jsonError("الفريق غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: { name?: string; active?: boolean; notes?: string } = {};
  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) return jsonError("اسم الفريق مطلوب");
    const clash = await db.workTeam.findUnique({ where: { companyId_name: { companyId: guard.user.companyId, name } }, select: { id: true } });
    if (clash && clash.id !== id) return jsonError("يوجد فريق آخر بهذا الاسم");
    data.name = name;
  }
  if (body.active !== undefined) data.active = Boolean(body.active);
  if (body.notes !== undefined) data.notes = String(body.notes || "").trim();

  const replaceMembers = Array.isArray(body.employeeIds);
  const employeeIds = replaceMembers
    ? Array.from(new Set((body.employeeIds as unknown[]).map(Number).filter(Number.isFinite)))
    : [];
  if (replaceMembers && employeeIds.length > 0) {
    const found = await db.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true } });
    if (found.length !== employeeIds.length) return jsonError("أحد الموظفين المختارين غير موجود", 404);
  }

  await db.$transaction(async (tx) => {
    await tx.workTeam.update({ where: { id }, data });
    if (replaceMembers) {
      await tx.workTeamMember.deleteMany({ where: { teamId: id } });
      if (employeeIds.length > 0) {
        await tx.workTeamMember.createMany({ data: employeeIds.map((employeeId) => ({ teamId: id, employeeId })) });
      }
    }
  });
  await audit(db, {
    username: guard.user.username,
    action: "تعديل",
    entityType: "work_team",
    entityId: id,
    entityName: String(data.name || team.name),
    oldStatus: team.active ? "نشط" : "موقوف",
    newStatus: data.active === undefined ? (team.active ? "نشط" : "موقوف") : data.active ? "نشط" : "موقوف",
    reason: replaceMembers ? `الأعضاء ${team._count.members} → ${employeeIds.length}` : "",
  });
  return ok({ updated: true });
}

/** DELETE: حذف الفريق — يجرف العضويات (Cascade) — بلا ربط مالي يمنعه (د6) */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;
  const id = Number((await params).id);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const team = await db.workTeam.findUnique({ where: { id }, select: { name: true } });
  if (!team) return jsonError("الفريق غير موجود", 404);

  const reason = (req.nextUrl.searchParams.get("reason") || "").trim() || "حذف فريق";
  await db.$transaction(async (tx) => {
    await tx.workTeam.delete({ where: { id } });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف",
      entityType: "work_team",
      entityId: id,
      entityName: team.name,
      reason,
    });
  });
  return ok({ deleted: true });
}
