import { NextRequest, NextResponse } from "next/server";
import { featureOn, jsonError, ok } from "@/lib/api-utils";
import { getSessionUser } from "@/lib/auth";

import { IMPORT_LOCK_MESSAGE, IMPORT_MAX_BYTES, IMPORT_MAX_BYTES_LABEL, acquireImportLock, releaseImportLock } from "@/lib/import/lock";
import { buildImportDbContext, hasAnyImportSheet, loadRawSheets } from "@/lib/import/db-context";
import { parseImportSheets, issueText } from "@/lib/import/parse-core";

/** حارس المطور — المعالج أداة مطور (تاب «الترحيل والاستيراد» developerOnly) */
async function developerGuard(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return { response: NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 }) };
  if (user.role !== "developer") {
    return { response: NextResponse.json({ error: "معالج الاستيراد للمطور فقط" }, { status: 403 }) };
  }
  return { user };
}

/**
 * POST /api/import/parse — رفع ملف (multipart «file») ⇒ فحص مسبق كامل:
 * معاينة أول صفوف لكل ورقة + جدول الأخطاء/التنبيهات برقم الصف (لم يُدخل أي شيء).
 */
export async function POST(req: NextRequest) {
  const guard = await developerGuard(req);
  if ("response" in guard) return guard.response;
  if (!(await featureOn("import_old"))) {
    return jsonError("ميزة «استيراد البيانات القديمة» معطّلة", 403);
  }
  if (!acquireImportLock()) return jsonError(IMPORT_LOCK_MESSAGE, 429);
  try {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || !(file instanceof File)) {
      return jsonError("اختر ملف Excel (.xlsx) أولًا.", 400);
    }
    if (file.size > IMPORT_MAX_BYTES) {
      return jsonError(`حجم الملف يتجاوز الحد المسموح (${IMPORT_MAX_BYTES_LABEL}).`, 413);
    }
    if (file.size === 0) {
      return jsonError("الملف فارغ.", 400);
    }

    let rawSheets;
    try {
      rawSheets = await loadRawSheets(Buffer.from(await file.arrayBuffer()));
    } catch {
      return jsonError("تعذر قراءة الملف، تأكد أنه بنفس بنية القالب.", 400);
    }
    if (!hasAnyImportSheet(rawSheets)) {
      return jsonError("تعذر قراءة الملف، تأكد أنه بنفس بنية القالب.", 400);
    }

    const ctx = await buildImportDbContext();
    const parsed = parseImportSheets(rawSheets, ctx);

    return ok({
      counts: parsed.counts,
      sheetsPresent: parsed.sheetsPresent,
      errors: parsed.errors.map((e) => ({ sheet: e.sheet, line: e.line, text: issueText(e), message: e.message })),
      warnings: parsed.warnings.map((w) => ({ sheet: w.sheet, line: w.line, text: issueText(w), message: w.message })),
      preview: parsed.preview,
    });
  } finally {
    releaseImportLock();
  }
}
