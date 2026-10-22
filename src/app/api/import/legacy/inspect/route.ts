// Task 86 — فحص ملف SQLite القديم: قائمة الجداول (صفوف/أعمدة/عينات) + الاكتشاف التلقائي
import { NextRequest, NextResponse } from "next/server";
import { ok, jsonError } from "@/lib/api-utils";
import { inspectLegacyDb } from "@/lib/import/legacy-core";
import { autoDetectMapping } from "@/lib/import/legacy-shared";
import { IMPORT_MAX_BYTES, IMPORT_MAX_BYTES_LABEL } from "@/lib/import/lock";
import { developerGuard } from "../util";

/**
 * POST /api/import/legacy/inspect — multipart «file» (.sqlite/.db)
 * بلا حالة خادم: الجداول تُقرأ من بايتات الملف مباشرة (ملف مؤقت يُمسح فورًا)،
 * والملف يُعاد إرساله في preview/run — آمن على Vercel serverless.
 */
export async function POST(req: NextRequest) {
  const guard = await developerGuard(req);
  if ("response" in guard) return guard.response;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof File)) {
    return jsonError("اختر ملف قاعدة البيانات (.sqlite / .db) أولًا.", 400);
  }
  if (file.size > IMPORT_MAX_BYTES) {
    return jsonError(`حجم الملف يتجاوز الحد المسموح (${IMPORT_MAX_BYTES_LABEL}).`, 413);
  }
  if (file.size === 0) return jsonError("الملف فارغ.", 400);

  let inspected;
  try {
    inspected = await inspectLegacyDb(Buffer.from(await file.arrayBuffer()));
  } catch {
    return jsonError("تعذر فتح الملف كقاعدة SQLite — تأكد أنه ملف قاعدة بيانات سليم.", 400);
  }
  if (inspected.tables.length === 0) {
    return jsonError("الملف لا يحتوي أي جداول قابلة للقراءة.", 400);
  }

  return ok({
    fileName: file.name,
    sizeKB: Math.round(file.size / 1024),
    tables: inspected.tables,
    mapping: autoDetectMapping(inspected.tables),
  });
}
