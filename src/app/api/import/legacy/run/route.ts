// Task 86 — تنفيذ الاستيراد من ملف SQLite أو نص جدولي في الشركة المستهدفة (شركة الجلسة)
import { NextRequest } from "next/server";
import { ok, jsonError } from "@/lib/api-utils";
import { issueText, parseImportSheets } from "@/lib/import/parse-core";
import { releaseImportLock } from "@/lib/import/lock";
import { executeImport, ImportRunError } from "@/lib/import/execute";
import { syncLegacyReferenceData } from "@/lib/import/legacy-sync";
import type { LegacySyncReport } from "@/lib/import/legacy-sync";
import {
  buildSource,
  buildContextWithTypes,
  companyMismatchGuard,
  developerGuard,
  featureAndLock,
  parsePayload,
} from "../util";

/**
 * POST /api/import/legacy/run — نفس مدخلات preview + selected (أسماء الأوراق المنفَّذة).
 * الترتيب: حارس الشركة ← بناء الأوراق ← مزامنة المرجعيات (أنواع/حسابات/مشاريع
 * الناقصة في شركة الجلسة) ← فحص من المصدر ← تنفيذ بترتيب التبعية داخل معاملات.
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

    // الأوراق المنفَّذة — أسماء حرفية من أوراق القالب (الافتراضي: الكل)
    let selected: string[] | null = null;
    if (typeof payload.selected !== "undefined") {
      if (!Array.isArray(payload.selected)) return jsonError("قائمة الأوراق المختارة غير صالحة.", 400);
      selected = payload.selected.map((x) => String(x));
    }

    const built = await buildSource(form, payload);
    if ("error" in built) return jsonError(built.error, 400);

    // مزامنة المرجعيات قبل بناء السياق (الأنواع/الحسابات/المشاريع الناقصة)
    let sync: LegacySyncReport = { typesCreated: [], accountsCreated: [], projectsCreated: [] };
    if (built.reference) {
      sync = await syncLegacyReferenceData(built.reference);
    }

    const ctx = await buildContextWithTypes(built);
    const parsed = parseImportSheets(built.sheets, ctx);

    // أخطاء الأوراق المختارة تمنع التنفيذ (كمعالج Excel)
    const scopeErrors = parsed.errors.filter((e) => !selected || selected.includes(e.sheet));
    if (scopeErrors.length) {
      return jsonErrorWithErrors(scopeErrors.map((e) => ({ sheet: e.sheet, line: e.line, text: issueText(e), message: e.message })));
    }

    try {
      const stats = await executeImport(parsed, selected, {
        id: user.id,
        username: user.username,
        role: user.role,
      });
      return ok({ stats, sync, notes: built.notes });
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

/** استجابة أخطاء الفحص بنفس شكل معالج Excel (400 + errors) */
function jsonErrorWithErrors(errors: { sheet: string; line: number; text: string; message: string }[]) {
  return Response.json(
    { error: "لا يمكن الاستيراد · يوجد أخطاء لم تُصحح.", errors },
    { status: 400 }
  );
}
