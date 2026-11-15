/**
 * /api/doc-templates/[id] — تحميل/استبدال/حذف قالب المستند (التصميم §7)
 * GET: القالب الكامل مع contentJson — authGuard
 * PUT/DELETE: adminGuard — الكتابة للمدير فقط (مرآة المرجعيات)
 */
import { NextRequest } from "next/server";

import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { isDocLike, type DocTemplateKind } from "@/lib/doc-template-core";
import { validateDocTemplateInput } from "@/lib/doc-template-server";

type P = { params: Promise<{ id: string }> };

function parseContent(raw: string): unknown {
  try {
    const parsed = JSON.parse(raw);
    return isDocLike(parsed) ? parsed : { type: "doc", content: [] };
  } catch {
    return { type: "doc", content: [] };
  }
}

export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const t = await db.docTemplate.findUnique({
    where: { id },
    include: { contractType: { select: { name: true } } },
  });
  if (!t) return jsonError("القالب غير موجود", 404);

  return ok({
    template: {
      id: t.id,
      kind: t.kind as DocTemplateKind,
      contractTypeId: t.contractTypeId,
      contractTypeName: t.contractType?.name ?? null,
      name: t.name,
      status: t.status,
      updatedAt: t.updatedAt.toISOString(),
      contentJson: parseContent(t.contentJson),
    },
  });
}

export async function PUT(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const existing = await db.docTemplate.findUnique({ where: { id } });
  if (!existing) return jsonError("القالب غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // على التعديل: الجسم غير المرسل يُبقي القائم (المحرر يرسله دائمًا عند الحفظ)
  const merged: Record<string, unknown> = { ...body };
  if (merged.contentJson === undefined) merged.contentJson = existing.contentJson;
  if (merged.kind === undefined) merged.kind = existing.kind;
  if (merged.contractTypeId === undefined) merged.contractTypeId = existing.contractTypeId;

  const v = await validateDocTemplateInput(merged);
  if ("error" in v) return jsonError(v.error);

  const updated = await db.docTemplate.update({
    where: { id },
    data: {
      kind: v.values.kind,
      contractTypeId: v.values.contractTypeId,
      name: v.values.name,
      status: v.values.status,
      contentJson: v.values.contentJson,
    },
    include: { contractType: { select: { name: true } } },
  });

  await audit(db, {
    username: guard.user.username,
    action: "تعديل",
    entityType: "docTemplate",
    entityId: id,
    entityName: updated.name,
  });

  return ok({
    template: {
      id: updated.id,
      kind: updated.kind as DocTemplateKind,
      contractTypeId: updated.contractTypeId,
      contractTypeName: updated.contractType?.name ?? null,
      name: updated.name,
      status: updated.status,
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
}

export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const existing = await db.docTemplate.findUnique({ where: { id } });
  if (!existing) return jsonError("القالب غير موجود", 404);

  await db.docTemplate.delete({ where: { id } });
  await audit(db, {
    username: guard.user.username,
    action: "حذف",
    entityType: "docTemplate",
    entityId: id,
    entityName: existing.name,
  });

  return ok({ message: "تم حذف القالب" });
}
