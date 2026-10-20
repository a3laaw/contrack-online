import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, featureGuard, jsonError, ok } from "@/lib/api-utils";
import {
  createTemplateFromUpload,
  listTemplates,
} from "@/lib/forms/forms-server";
import { scanTemplateFields } from "@/lib/forms/docx";
import {
  MSG_CHOOSE_DOCX,
  MSG_CORRUPT_DOCX,
  MSG_TEMPLATE_DUP_IMPORT,
  MSG_TEMPLATE_NAME_REQUIRED,
} from "@/lib/forms/forms-core";

/**
 * قوالب النماذج (بند 56):
 *   GET  — قائمة بفلاتر المكتبي (بحث/تصنيف/حالة) — الحرس screen_forms.
 *   POST — رفع قالب Word (multipart: file+name+description+categoryId) ⇒
 *          استخراج وسوم {{...}} من النص الظاهر + تخمين مصادرها (مرآة import_docx)
 *          وتخزين الملف base64 داخل wordPath — الحرس screen_forms + ميزة
 *          word_forms (زرا الرفع بالمكتبي مخفيان بمفتاحها V4.5.13).
 */

const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_forms");
  if ("response" in guard) return guard.response;
  const sp = req.nextUrl.searchParams;
  const categoryId = Number(sp.get("categoryId") || 0);
  const templates = await listTemplates({
    q: sp.get("q") || "",
    categoryId: Number.isFinite(categoryId) && categoryId > 0 ? categoryId : undefined,
    status: sp.get("status") || "",
  });
  return ok({ templates });
}

export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_forms");
  if ("response" in guard) return guard.response;
  const feature = await featureGuard("word_forms");
  if (feature) return feature;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const name = String(form?.get("name") || "").trim();
  const description = String(form?.get("description") || "").trim();
  const categoryIdRaw = Number(form?.get("categoryId") || 0);
  const categoryId =
    Number.isFinite(categoryIdRaw) && categoryIdRaw > 0 ? categoryIdRaw : null;

  if (!name) return jsonError(MSG_TEMPLATE_NAME_REQUIRED, 400);
  if (!file || !(file instanceof File)) return jsonError(MSG_CHOOSE_DOCX, 400);
  if (!file.name.toLowerCase().endsWith(".docx")) return jsonError(MSG_CHOOSE_DOCX, 400);
  if (file.size > MAX_TEMPLATE_BYTES) {
    return jsonError("حجم ملف القالب يتجاوز الحد المسموح (10MB).", 413);
  }
  if (categoryId) {
    const cat = await db.formCategory.findUnique({ where: { id: categoryId } });
    if (!cat) return jsonError("التصنيف غير موجود.", 400);
  }

  const dup = await db.formTemplate.findFirst({ where: { baseName: name } });
  if (dup) return jsonError(MSG_TEMPLATE_DUP_IMPORT, 400);

  const buffer = Buffer.from(await file.arrayBuffer());
  let fields;
  try {
    fields = scanTemplateFields(buffer);
  } catch {
    return jsonError(MSG_CORRUPT_DOCX, 400);
  }

  const created = await createTemplateFromUpload({
    baseName: name,
    description,
    categoryId,
    createdBy: guard.user.username,
    buffer,
    fields,
  });

  await audit(db, {
    username: guard.user.username,
    action: "رفع قالب نموذج",
    entityType: "form_template",
    entityId: created.id,
    entityName: created.baseName,
    reason: `الحقول: ${fields.length} · مطابق تلقائيًا: ${fields.filter((f) => f.known).length}`,
  });

  return ok(
    {
      template: created,
      fields: fields.map((f) => ({
        name: f.name,
        fieldType: f.fieldType,
        sourceType: f.sourceType,
        sourceEntity: f.sourceEntity,
        sourceKey: f.sourceKey,
        required: f.required,
        known: f.known,
      })),
      placeholdersCount: fields.length,
      knownCount: fields.filter((f) => f.known).length,
    },
    201
  );
}
