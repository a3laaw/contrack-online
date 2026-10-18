import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { PERMISSIONS } from "@/lib/auth";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";

type P = { params: Promise<{ id: string }> };

const VALID_KEYS = new Set(PERMISSIONS.map((p) => p.key));

/** كتالوج الصلاحيات مع حالة المستخدم */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, username: true, role: true, fullName: true },
  });
  if (!user) return jsonError("المستخدم غير موجود", 404);

  const rows = await db.userPermission.findMany({ where: { userId: id } });
  const stateMap = new Map(rows.map((r) => [r.permKey, r.allowed]));
  const permissions = PERMISSIONS.map((p) => ({
    permKey: p.key,
    allowed: stateMap.get(p.key) ?? true,
  }));
  return ok({ user, catalog: PERMISSIONS, permissions });
}

/** حفظ مصفوفة الصلاحيات: {permissions: [{permKey, allowed}]} — للمدير فقط */
export async function PUT(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const user = await db.user.findUnique({ where: { id } });
  if (!user) return jsonError("المستخدم غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as {
    permissions?: { permKey?: string; allowed?: boolean }[];
    perms?: { permKey?: string; allowed?: boolean }[];
  };
  const list = Array.isArray(body.permissions) ? body.permissions : Array.isArray(body.perms) ? body.perms : [];
  const clean = list
    .filter((r) => r && VALID_KEYS.has(String(r.permKey)))
    .map((r) => ({ permKey: String(r.permKey), allowed: Boolean(r.allowed) }));

  await db.$transaction(async (tx) => {
    await tx.userPermission.deleteMany({ where: { userId: id } });
    if (clean.length > 0) {
      await tx.userPermission.createMany({
        data: clean.map((r) => ({ userId: id, permKey: r.permKey, allowed: r.allowed })),
      });
    }
  });
  await audit(db, {
    username: guard.user.username,
    action: "تعديل الصلاحيات",
    entityType: "user",
    entityId: id,
    entityName: user.username,
    reason: `${clean.filter((c) => c.allowed).length} مسموح / ${clean.filter((c) => !c.allowed).length} ممنوع`,
  });
  return ok({ message: "تم حفظ الصلاحيات", count: clean.length });
}
