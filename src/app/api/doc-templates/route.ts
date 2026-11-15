/**
 * /api/doc-templates — مصمم المستندات التعاقدية (docs/contract-template-design.md §7)
 * GET: قائمة القوالب (فلتر kind/contractTypeId) — قراءة للجميع (authGuard)
 * POST: إنشاء قالب (مع قالب ابتدائي جاهز D10 إن لم يُرسل جسم) — كتابة للمدير (adminGuard)
 */
import { NextRequest } from "next/server";

import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { DOC_KINDS, type DocTemplateKind } from "@/lib/doc-template-core";
import { validateDocTemplateInput } from "@/lib/doc-template-server";

export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const url = new URL(req.url);
  const kindParam = url.searchParams.get("kind") ?? "";
  const kindFilter = (DOC_KINDS as readonly string[]).includes(kindParam) ? kindParam : null;
  const typeIdParam = Number(url.searchParams.get("contractTypeId"));

  const templates = await db.docTemplate.findMany({
    where: {
      ...(kindFilter ? { kind: kindFilter } : {}),
      ...(Number.isFinite(typeIdParam) && typeIdParam > 0 ? { contractTypeId: typeIdParam } : {}),
    },
    include: { contractType: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
  });

  return ok({
    templates: templates.map((t) => ({
      id: t.id,
      kind: t.kind as DocTemplateKind,
      contractTypeId: t.contractTypeId,
      contractTypeName: t.contractType?.name ?? null,
      name: t.name,
      status: t.status,
      updatedAt: t.updatedAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const v = await validateDocTemplateInput(body);
  if ("error" in v) return jsonError(v.error);

  const created = await db.docTemplate.create({
    data: {
      kind: v.values.kind,
      contractTypeId: v.values.contractTypeId,
      name: v.values.name,
      status: v.values.status,
      contentJson: v.values.contentJson,
      createdBy: guard.user.id ?? null,
    },
    include: { contractType: { select: { name: true } } },
  });

  await audit(db, {
    username: guard.user.username,
    action: "إنشاء",
    entityType: "docTemplate",
    entityId: created.id,
    entityName: created.name,
  });

  return ok(
    {
      template: {
        id: created.id,
        kind: created.kind as DocTemplateKind,
        contractTypeId: created.contractTypeId,
        contractTypeName: created.contractType?.name ?? null,
        name: created.name,
        status: created.status,
        updatedAt: created.updatedAt.toISOString(),
      },
    },
    201
  );
}
