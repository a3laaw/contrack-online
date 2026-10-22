// Task 85 — SaaS: تعديل شركة (اسم/اختصار/تفعيل/ملاحظات) — المدير/المطور
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";

type P = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    shortName?: string;
    notes?: string;
    isActive?: boolean;
  };

  if (id === 1 && body.isActive === false) return jsonError("لا يمكن تعطيل الشركة الرئيسية");

  const target = await db.company.findUnique({ where: { id } });
  if (!target) return jsonError("الشركة غير موجودة", 404);

  const data: { name?: string; shortName?: string; notes?: string; isActive?: boolean } = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return jsonError("اسم الشركة مطلوب");
    if (name !== target.name) {
      const dup = await db.company.findFirst({ where: { name } });
      if (dup) return jsonError("يوجد شركة بهذا الاسم مسبقًا");
    }
    data.name = name;
  }
  if (body.shortName !== undefined) data.shortName = String(body.shortName).trim();
  if (body.notes !== undefined) data.notes = String(body.notes).trim();
  if (body.isActive !== undefined) {
    if (id === 1 && !body.isActive) return jsonError("لا يمكن تعطيل الشركة الرئيسية");
    data.isActive = Boolean(body.isActive);
  }

  const company = await db.company.update({ where: { id }, data });
  await audit(db, {
    username: guard.user.username,
    action: "تعديل",
    entityType: "company",
    entityId: id,
    entityName: company.name,
    reason: Object.keys(data).join("، "),
  });
  return ok({ company });
}
