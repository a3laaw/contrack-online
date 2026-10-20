import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { featureOn, jsonError, ok } from "@/lib/api-utils";
import { getSessionUser } from "@/lib/auth";

import {
  IMPORT_LOCK_MESSAGE,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_BYTES_LABEL,
  acquireImportLock,
  releaseImportLock,
} from "@/lib/import/lock";
import { buildImportDbContext, hasAnyImportSheet, loadRawSheets } from "@/lib/import/db-context";
import { issueText, parseImportSheets } from "@/lib/import/parse-core";
import { executeImport, ImportRunError } from "@/lib/import/execute";
import { IMPORT_SHEETS } from "@/lib/import/sheets";

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
 * POST /api/import/run — تنفيذ ما اختاره المستخدم (multipart: file + sheets JSON).
 * يعيد الفحص من أول الملف (المصدر الحقيقي دائمًا) ثم ينفذ بترتيب التبعية داخل
 * معاملات — ويرفض التنفيذ ما دامت أخطاء الأوراق المختارة قائمة.
 */
export async function POST(req: NextRequest) {
  const guard = await developerGuard(req);
  if ("response" in guard) return guard.response;
  const user = guard.user;
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

    // الأوراق المختارة — أسماء حرفية من الأوراق الثماني (الافتراضي: الكل)
    let selected: string[] | null = null;
    const sheetsRaw = form?.get("sheets");
    if (typeof sheetsRaw === "string" && sheetsRaw.trim()) {
      try {
        const arr = JSON.parse(sheetsRaw) as unknown;
        if (Array.isArray(arr)) {
          const names = arr.map((x) => String(x)).filter((n) => IMPORT_SHEETS.some((s) => s.name === n));
          selected = names;
        }
      } catch {
        return jsonError("قائمة الأوراق المختارة غير صالحة.", 400);
      }
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

    // أخطاء الأوراق المختارة تمنع التنفيذ (المكتبي: parsed.errors يمنع كليًا)
    const scopeErrors = parsed.errors.filter((e) => !selected || selected.includes(e.sheet));
    if (scopeErrors.length) {
      return NextResponse.json(
        {
          error: "لا يمكن الاستيراد · يوجد أخطاء لم تُصحح.",
          errors: scopeErrors.map((e) => ({ sheet: e.sheet, line: e.line, text: issueText(e), message: e.message })),
        },
        { status: 400 }
      );
    }

    try {
      const stats = await executeImport(parsed, selected, {
        id: user.id,
        username: user.username,
        role: user.role,
      });
      return ok({ stats });
    } catch (e) {
      if (e instanceof ImportRunError) {
        return jsonError(`توقف الاستيراد: ${e.message}`, e.status >= 400 && e.status < 600 ? e.status : 500);
      }
      throw e;
    }
  } finally {
    releaseImportLock();
  }
}
