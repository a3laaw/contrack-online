import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok, audit } from "@/lib/api-utils";
import { intOr } from "@/lib/contrack-server";
import { GatewayError } from "@/lib/gateway-server";

type P = { params: Promise<{ id: string }> };

function err(e: unknown) {
  if (e instanceof GatewayError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return jsonError("حدث خطأ غير متوقع", 500);
}

/** PATCH: تعديل بروفايل بوابة (الاسم/الحساب/الطرق/التأخير/العمولة/التسامح/التأخر/التفعيل) */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_gateway");
  if ("response" in guard) return guard.response;
  try {
    const { id: idRaw } = await params;
    const id = intOr(idRaw, 0);
    const p = await db.gatewayProfile.findUnique({ where: { id } });
    if (!p) return jsonError("البروفايل غير موجود", 404);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = String(body.name || "").trim();
      if (!name) return jsonError("اسم البوابة إلزامي.");
      if (name !== p.name) {
        const dup = await db.gatewayProfile.findFirst({ where: { name } });
        if (dup) return jsonError(`يوجد بروفايل بنفس الاسم «${name}».`);
      }
      data.name = name;
    }
    if (body.bankAccount !== undefined) data.bankAccount = String(body.bankAccount || "").trim();
    if (body.methods !== undefined) data.methods = String(body.methods || "").trim() || "KNET";
    if (body.lagDays !== undefined) data.lagDays = intOr(body.lagDays, p.lagDays);
    if (body.feeFixed !== undefined) data.feeFixed = Number(body.feeFixed || 0) || 0;
    if (body.tolerance !== undefined) data.tolerance = Number(body.tolerance || 0) || 0;
    if (body.lateDays !== undefined) data.lateDays = intOr(body.lateDays, p.lateDays);
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    const updated = await db.gatewayProfile.update({ where: { id }, data });
    await audit(db, {
      username: guard.user.username,
      action: "gateway_profile_update",
      entityType: "gateway_profiles",
      entityId: id,
      entityName: updated.name,
      oldStatus: p.methods,
      newStatus: updated.methods,
    });
    return ok({ profile: updated });
  } catch (e) {
    return err(e);
  }
}

/** DELETE: حذف بروفايل — يُمنع إن كانت له عمليات مثبتة */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_gateway");
  if ("response" in guard) return guard.response;
  try {
    const { id: idRaw } = await params;
    const id = intOr(idRaw, 0);
    const p = await db.gatewayProfile.findUnique({ where: { id } });
    if (!p) return jsonError("البروفايل غير موجود", 404);
    const opsCount = await db.gatewayOp.count({ where: { gateway: p.name } });
    if (opsCount > 0)
      return jsonError(`لا يمكن حذف «${p.name}» — له ${opsCount} عملية مثبتة. عطّله بدلًا من الحذف.`);
    await db.gatewayProfile.delete({ where: { id } });
    await audit(db, {
      username: guard.user.username,
      action: "gateway_profile_delete",
      entityType: "gateway_profiles",
      entityId: id,
      entityName: p.name,
    });
    return ok({ deleted: true });
  } catch (e) {
    return err(e);
  }
}

export const dynamic = "force-dynamic";
