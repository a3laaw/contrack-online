// Task 86 — فحص ومعاينة الاستيراد من ملف SQLite أو نص جدولي (بلا أي كتابة)
import { NextRequest } from "next/server";
import { ok, jsonError } from "@/lib/api-utils";
import { issueText, parseImportSheets } from "@/lib/import/parse-core";
import { releaseImportLock } from "@/lib/import/lock";
import { buildContextWithTypes, buildSource, developerGuard, featureAndLock, parsePayload, companyMismatchGuard } from "../util";

/**
 * POST /api/import/legacy/preview — multipart: file (sqlite) أو payload {mode:"text",text,sheet}
 * + payload {mode, targetCompanyId, mapping?} — يعيد نفس شكل /api/import/parse
 * (counts/sheetsPresent/errors/warnings/preview) + ملاحظات التحويل notes.
 */
export async function POST(req: NextRequest) {
  const guard = await developerGuard(req);
  if ("response" in guard) return guard.response;
  const user = guard.user;

  const lockOr = await featureAndLock();
  if (lockOr) return lockOr;
  try {
    const form = await req.formData().catch(() => null);
    if (!form) return jsonError("طلب غير صالح.", 400);
    const payload = parsePayload(form);
    if ("error" in payload) return jsonError(payload.error, 400);

    const mismatch = await companyMismatchGuard(user, payload.targetCompanyId);
    if (mismatch) return mismatch;

    const built = await buildSource(form, payload);
    if ("error" in built) return jsonError(built.error, 400);

    const ctx = await buildContextWithTypes(built, { placeholderRefs: true });
    const parsed = parseImportSheets(built.sheets, ctx);

    return ok({
      counts: parsed.counts,
      sheetsPresent: parsed.sheetsPresent,
      errors: parsed.errors.map((e) => ({ sheet: e.sheet, line: e.line, text: issueText(e), message: e.message })),
      warnings: parsed.warnings.map((w) => ({ sheet: w.sheet, line: w.line, text: issueText(w), message: w.message })),
      preview: parsed.preview,
      notes: built.notes,
    });
  } finally {
    releaseImportLock();
  }
}
