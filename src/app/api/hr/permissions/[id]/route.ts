import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";

type P = { params: Promise<{ id: string }> };

/**
 * PATCH: قرار الإذن (نمط الإجازات — القرار موثق):
 * action=approve ⇒ معتمدة · action=reject ⇒ مرفوضة بnote إلزامي · action=edit ⇒ المعلقة فقط.
 */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");
  const actor = guard.user.username;

  const perm = await db.employeePermission.findUnique({ where: { id }, include: { employee: { select: { name: true } } } });
  if (!perm) return jsonError("الإذن غير موجود", 404);

  if (action === "approve") {
    if (perm.status !== "معلقة") return jsonError("الاعتماد للمعلقة حصرًا");
    const updated = await db.employeePermission.update({
      where: { id },
      data: { status: "معتمدة", decisionBy: actor, decisionAt: new Date().toISOString(), decisionNote: String(body.decisionNote || "").trim() },
    });
    await audit(db, {
      username: actor,
      action: "اعتماد إذن",
      entityType: "employee_permission",
      entityId: id,
      entityName: `${perm.employee.name} — ${perm.minutes} دقيقة (${perm.kind === "late" ? "تأخير" : "انصراف"})`,
      oldStatus: "معلقة",
      newStatus: "معتمدة",
      reason: String(body.decisionNote || "").trim(),
    });
    return ok({ permission: updated, status: "معتمدة" });
  }

  if (action === "reject") {
    if (perm.status !== "معلقة") return jsonError("الرفض من المعلقة حصرًا");
    const note = String(body.decisionNote || "").trim();
    if (!note) return jsonError("سبب الرفض إلزامي (قرار موثق)");
    const updated = await db.employeePermission.update({
      where: { id },
      data: { status: "مرفوضة", decisionBy: actor, decisionAt: new Date().toISOString(), decisionNote: note },
    });
    await audit(db, {
      username: actor,
      action: "رفض إذن",
      entityType: "employee_permission",
      entityId: id,
      entityName: `${perm.employee.name} — ${perm.minutes} دقيقة`,
      oldStatus: "معلقة",
      newStatus: "مرفوضة",
      reason: note,
    });
    return ok({ permission: updated, status: "مرفوضة" });
  }

  if (action === "edit") {
    if (perm.status !== "معلقة") return jsonError("التعديل للمعلقة حصرًا");
    const minutes = Math.round(Number(body.minutes ?? perm.minutes));
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 240) return jsonError("مدة الإذن بين 5 و240 دقيقة");
    const reason = String(body.reason ?? perm.reason).trim();
    if (!reason) return jsonError("علة الإذن إلزامية");
    const updated = await db.employeePermission.update({
      where: { id },
      data: { minutes, reason, permDate: String(body.permDate ?? perm.permDate) },
    });
    await audit(db, {
      username: actor,
      action: "تعديل إذن",
      entityType: "employee_permission",
      entityId: id,
      entityName: `${perm.employee.name} — ${minutes} دقيقة`,
    });
    return ok({ permission: updated });
  }

  return jsonError("إجراء غير معروف — approve | reject | edit");
}

/** DELETE: حذف إذن معلق فقط */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const perm = await db.employeePermission.findUnique({ where: { id }, include: { employee: { select: { name: true } } } });
  if (!perm) return jsonError("الإذن غير موجود", 404);
  if (perm.status !== "معلقة") return jsonError("الأذونات المقروءة توثيق — لا تُحذف");

  await db.employeePermission.delete({ where: { id } });
  await audit(db, {
    username: guard.user.username,
    action: "حذف إذن",
    entityType: "employee_permission",
    entityId: id,
    entityName: `${perm.employee.name} — ${perm.minutes} دقيقة`,
  });
  return ok({ deleted: true });
}
