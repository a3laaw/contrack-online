import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";

/** GET: الأطقم مع الأعضاء — الأحدث أولًا */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const teams = await db.workTeam.findMany({
    orderBy: { id: "desc" },
    include: {
      members: { include: { employee: { select: { id: true, name: true, jobNumber: true, jobTitle: true, active: true } } } },
    },
  });

  return ok({
    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      active: t.active,
      notes: t.notes,
      members: t.members.map((m) => ({
        employeeId: m.employeeId,
        name: m.employee.name,
        jobNumber: m.employee.jobNumber,
        jobTitle: m.employee.jobTitle,
        active: m.employee.active,
      })),
    })),
  });
}

/** POST: فريق جديد باسم فريد + أعضاء (معرفات موظفين) */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name || "").trim();
  if (!name) return jsonError("اسم الفريق مطلوب");
  const notes = String(body.notes || "").trim();
  const employeeIds = Array.from(new Set((Array.isArray(body.employeeIds) ? body.employeeIds : []).map(Number).filter(Number.isFinite)));

  const exists = await db.workTeam.findUnique({ where: { companyId_name: { companyId: guard.user.companyId, name } }, select: { id: true } });
  if (exists) return jsonError("يوجد فريق بهذا الاسم بالفعل");

  if (employeeIds.length > 0) {
    const found = await db.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true } });
    if (found.length !== employeeIds.length) return jsonError("أحد الموظفين المختارين غير موجود", 404);
  }

  const team = await db.$transaction(async (tx) => {
    const t = await tx.workTeam.create({ data: { name, notes } });
    if (employeeIds.length > 0) {
      await tx.workTeamMember.createMany({ data: employeeIds.map((employeeId) => ({ teamId: t.id, employeeId })) });
    }
    return t;
  });
  await audit(db, {
    username: guard.user.username,
    action: "إنشاء",
    entityType: "work_team",
    entityId: team.id,
    entityName: `${name} (${employeeIds.length} عضوًا)`,
  });
  return ok({ team }, 201);
}
