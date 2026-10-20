import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import {
  deleteTemplate,
  getTemplateDetail,
  templateDocumentsCount,
  updateTemplateMeta,
} from "@/lib/forms/forms-server";
import {
  MSG_DELETE_USED,
  MSG_TEMPLATE_BAD_STATUS,
  MSG_TEMPLATE_DUP_UPDATE,
  MSG_TEMPLATE_NAME_REQUIRED,
  MSG_TEMPLATE_NOT_FOUND,
  TEMPLATE_STATUSES,
} from "@/lib/forms/forms-core";

type P = { params: Promise<{ id: string }> };

async function templateId(params: P["params"]): Promise<number | null> {
  const { id: idStr } = await params;
  const id = Number(idStr);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** تفاصيل القالب بحقوله (نافذتا التعبئة وربط الحقول) */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_forms");
  if ("response" in guard) return guard.response;
  const id = await templateId(params);
  if (!id) return jsonError("معرف غير صالح");
  const template = await getTemplateDetail(id);
  if (!template) return jsonError(MSG_TEMPLATE_NOT_FOUND, 404);
  return ok({ template });
}

/**
 * تعديل بيانات النموذج الخارجية — مرآة update_template_meta/set_template_status
 * (الاسم/الوصف/الحالة فقط — لا يمس حقول Word الداخلية ولا ملف القالب).
 */
export async function PUT(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_forms");
  if ("response" in guard) return guard.response;
  const id = await templateId(params);
  if (!id) return jsonError("معرف غير صالح");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const existing = await db.formTemplate.findUnique({ where: { id } });
  if (!existing) return jsonError(MSG_TEMPLATE_NOT_FOUND, 404);

  let baseName: string | undefined;
  if (body.baseName !== undefined) {
    baseName = String(body.baseName || "").trim();
    if (!baseName) return jsonError(MSG_TEMPLATE_NAME_REQUIRED, 400);
    const dup = await db.formTemplate.findFirst({
      where: { baseName, id: { not: id } },
    });
    if (dup) return jsonError(MSG_TEMPLATE_DUP_UPDATE, 400);
  }

  let status: string | undefined;
  if (body.status !== undefined) {
    status = String(body.status || "");
    if (!TEMPLATE_STATUSES.includes(status as (typeof TEMPLATE_STATUSES)[number])) {
      return jsonError(MSG_TEMPLATE_BAD_STATUS, 400);
    }
  }

  const description =
    body.description !== undefined ? String(body.description || "") : undefined;

  await db.$transaction(async (tx) => {
    await tx.formTemplate.update({
      where: { id },
      data: {
        ...(baseName !== undefined ? { baseName } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(status !== undefined ? { status } : {}),
        updatedBy: guard.user.username,
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: status !== undefined && baseName === undefined && description === undefined
        ? "تغيير حالة النموذج"
        : "تعديل بيانات النموذج",
      entityType: "form_template",
      entityId: id,
      entityName: baseName ?? existing.baseName,
      oldStatus: status !== undefined ? existing.status : undefined,
      newStatus: status,
    });
  });

  const template = await getTemplateDetail(id);
  return ok({ template });
}

/** حذف قالب غير مستخدم — للمدير (نمط المشروع) + حراسة الأرشيف الحرفية */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const id = await templateId(params);
  if (!id) return jsonError("معرف غير صالح");
  const existing = await db.formTemplate.findUnique({ where: { id } });
  if (!existing) return jsonError(MSG_TEMPLATE_NOT_FOUND, 404);
  const used = await templateDocumentsCount(id);
  if (used > 0) return jsonError(MSG_DELETE_USED, 400);
  await db.$transaction(async (tx) => {
    await deleteTemplate(id);
    await audit(tx, {
      username: guard.user.username,
      action: "حذف نموذج",
      entityType: "form_template",
      entityId: id,
      entityName: existing.baseName,
      reason: `مستندات: 0`,
    });
  });
  return ok({ deleted: true });
}
