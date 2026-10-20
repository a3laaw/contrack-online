import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { getProjectRow } from "@/lib/projects-server";
import {
  cleanProjectCustomerId,
  cleanProjectDate,
  cleanProjectName,
  cleanProjectStatus,
  cleanProjectText,
  PROJECT_DELETE_BLOCKED,
  PROJECT_NAME_REQUIRED,
} from "@/lib/projects-core";

type P = { params: Promise<{ id: string }> };

async function projectId(params: P["params"]): Promise<number | null> {
  const { id: idStr } = await params;
  const id = Number(idStr);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** تفاصيل مشروع + عداد سنداته */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_customers");
  if ("response" in guard) return guard.response;
  const id = await projectId(params);
  if (!id) return jsonError("معرف غير صالح");

  const project = await getProjectRow(id);
  if (!project) return jsonError("المشروع غير موجود", 404);
  return ok({ project });
}

/** تعديل مشروع — تحقق الاسم المكتبي الحرفي + تدقيق «تعديل مشروع» */
export async function PUT(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_customers");
  if ("response" in guard) return guard.response;
  const id = await projectId(params);
  if (!id) return jsonError("معرف غير صالح");

  const existing = await db.project.findUnique({ where: { id } });
  if (!existing) return jsonError("المشروع غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = cleanProjectName(body.name);
  if (!name) return jsonError(PROJECT_NAME_REQUIRED, 400);

  const customerId = cleanProjectCustomerId(body.customerId);
  if (customerId) {
    const customer = await db.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) return jsonError("العميل غير موجود.", 400);
  }

  const project = await db.project.update({
    where: { id },
    data: {
      name,
      customerId,
      description: cleanProjectText(body.description),
      location: cleanProjectText(body.location),
      startDate: cleanProjectDate(body.startDate),
      endDate: cleanProjectDate(body.endDate),
      status: cleanProjectStatus(body.status),
    },
  });

  await db.$transaction((tx) =>
    audit(tx, {
      username: guard.user.username,
      action: "تعديل مشروع",
      entityType: "project",
      entityId: project.id,
      entityName: project.name,
      oldStatus: existing.status,
      newStatus: project.status,
    })
  );

  return ok({ project });
}

/**
 * حذف مشروع — سلوك المكتبي delete_project: يُمنع عند الارتباط
 * («لا يمكن حذف المشروع لأنه مرتبط بعقود أو سندات.») — وفي الويب السندات فقط
 * (لا contracts.project_id في المخطط المرجعي). والمسار للمدير فقط مع تدقيق
 * (إضافة ويب أمانًا — المكتبي بلا واجهة حذف).
 */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const id = await projectId(params);
  if (!id) return jsonError("معرف غير صالح");

  const project = await db.project.findUnique({
    where: { id },
    select: { id: true, name: true, _count: { select: { vouchers: true } } },
  });
  if (!project) return jsonError("المشروع غير موجود", 404);

  const linked = project._count.vouchers;
  if (linked > 0) return jsonError(PROJECT_DELETE_BLOCKED, 400);

  await db.$transaction(async (tx) => {
    await tx.project.delete({ where: { id } });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف مشروع",
      entityType: "project",
      entityId: project.id,
      entityName: project.name,
    });
  });

  return ok({ ok: true, id });
}
