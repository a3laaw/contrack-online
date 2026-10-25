// ============================================================
// backup-parse.ts — تحليل ملف النسخة الاحتياطية والتحقق من بنيتها
// وحدة نقية بلا fs ولا server-only — تُستخدم من ثلاث جهات:
//   1) readSnapshotFile في backup-dump.ts (ملفات الخادم db/backups)
//   2) /api/backups/upload-restore (رفع ملف من جهاز المستخدم)
//   3) الواجهة (DataManagementView) للتحقق الفوري قبل الرفع + الاختبارات
// المبدأ: الامتداد لا يهم (json/txt/md/نوت باد) — المهم أن المحتوى
// كائن JSON فيه manifest (فهرس) وdata (جداول بمصفوفات صفوف).
// ============================================================

export interface ParsedSnapshot {
  manifest: {
    app?: unknown;
    version?: unknown;
    createdAt?: unknown;
    generatedBy?: unknown;
    tableCounts: Record<string, number>;
  };
  data: Record<string, unknown[]>;
}

/**
 * محاولة إخراج JSON من نص حر: إن فشل JSON.parse المباشر (نص نوت باد
 * يبدأ بملاحظة أو ملف MD بسوار كود ```json) نجرّب من أول { إلى آخر }.
 */
function jsonLoose(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("INVALID_JSON");
    return JSON.parse(trimmed.slice(start, end + 1)); // يرمي INVALID_JSON
  }
}

/**
 * تحليل نص النسخة والتحقق من بنيتها — يرمي:
 *   INVALID_JSON  — ليس نص JSON صالحًا (ولا يحتوي كائنًا قابلًا للاستخراج)
 *   NOT_A_BACKUP  — لا manifest أو لا data (ليس نسخة صادرة من النظام)
 *   BAD_DATA      — قيم الجداول ليست مصفوفات
 */
export function parseSnapshotText(text: string): ParsedSnapshot {
  let parsed: unknown;
  try {
    parsed = jsonLoose(text);
  } catch {
    throw new Error("INVALID_JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("NOT_A_BACKUP");
  }
  const obj = parsed as Record<string, unknown>;
  if (!obj.manifest || typeof obj.manifest !== "object" || Array.isArray(obj.manifest)) {
    throw new Error("NOT_A_BACKUP");
  }
  if (!obj.data || typeof obj.data !== "object" || Array.isArray(obj.data)) {
    throw new Error("NOT_A_BACKUP");
  }
  const data: Record<string, unknown[]> = {};
  for (const [key, value] of Object.entries(obj.data as Record<string, unknown>)) {
    if (!Array.isArray(value)) throw new Error("BAD_DATA");
    data[key] = value;
  }
  const m = obj.manifest as Record<string, unknown>;
  const tableCounts =
    m.tableCounts && typeof m.tableCounts === "object" && !Array.isArray(m.tableCounts)
      ? (m.tableCounts as Record<string, number>)
      : {};
  return {
    manifest: {
      app: m.app,
      version: m.version,
      createdAt: m.createdAt,
      generatedBy: m.generatedBy,
      tableCounts,
    },
    data,
  };
}

/** إجمالي الصفوف من بيانات النسخة (للعرض السريع في الواجهة والرسائل) */
export function snapshotRowsCount(dump: ParsedSnapshot): number {
  return Object.values(dump.data).reduce((acc, rows) => acc + rows.length, 0);
}

/** رسالة عربية واضحة لخطأ التحليل — للواجهة ورسائل الـAPI */
export function snapshotParseErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : "";
  if (msg === "INVALID_JSON") return "الملف ليس نص JSON صالحًا — تأكد أنه نسخة احتياطية صادرة من النظام (زر «تنزيل نسخة JSON»)";
  if (msg === "BAD_DATA") return "بنية البيانات غير صحيحة — قيم الجداول في النسخة يجب أن تكون مصفوفات صفوف";
  return "الملف ليس نسخة احتياطية صالحة — الفهرس المختصر (manifest) أو البيانات مفقودة";
}
