// ============================================================
// POST /api/backups/upload-restore — استعادة نسخة مرفوعة من جهاز المستخدم — للمدير
// multipart/form-data بحقل file — الامتداد لا يهم (json/txt/md/نوت باد)
// بشرط أن المحتوى نسخة JSON صحيحة صادرة من النظام (manifest + data):
// 1) تحقق البنية قبل العبث بالقاعدة (parseSnapshotText — مشترك مع الواجهة)
// 2) تحقق أن كل جداول النسخة معروفة قبل أخذ نسخة الأمان (لا نسرق مساحة بلا داعٍ)
// 3) نسخة أمان (safety-…) من الوضع الحالي قبل أي تغيير
// 4) معاملة واحدة: حذف بالترتيب العكسي ثم إنشاء بالمعرّفات الأصلية ثم setval
// ============================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";
import {
  BACKUP_MODELS,
  buildBackupDump,
  restoreBackupData,
  saveSnapshotFile,
  snapshotFileName,
} from "@/lib/backup-dump";
import { parseSnapshotText, snapshotParseErrorMessage } from "@/lib/backup-parse";

/** الحد الأقصى لحجم ملف النسخة المرفوعة */
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const username = guard.user.username;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError("الطلب يجب أن يكون رفع ملف (multipart/form-data)");
  }
  const entry = form.get("file");
  if (!entry || typeof entry === "string") return jsonError("ملف النسخة مطلوب (حقل file)");
  const file = entry as File;

  const name = (file.name || "").trim();
  if (file.size <= 0) return jsonError("الملف فارغ");
  if (file.size > MAX_UPLOAD_BYTES) return jsonError("حجم الملف يتجاوز الحد المسموح (200MB)");

  let text: string;
  try {
    text = await file.text();
  } catch {
    return jsonError("تعذرت قراءة محتوى الملف");
  }

  // تحقق البنية قبل أي لمسة للقاعدة
  let dump;
  try {
    dump = parseSnapshotText(text);
  } catch (e) {
    return jsonError(snapshotParseErrorMessage(e), 400);
  }

  // تحقق أن كل جداول النسخة معروفة (نفس تحقق restoreBackupData لكن قبل نسخة الأمان)
  const known = new Set(BACKUP_MODELS.map((m) => m.table));
  const unknown = Object.keys(dump.data).filter((k) => !known.has(k));
  if (unknown.length) {
    return jsonError(
      `النسخة تحتوي جداول غير معروفة في هذا الإصدار: ${unknown.slice(0, 5).join("، ")} — قد تكون النسخة من إصدار أقدم أو أحدث`,
      400,
    );
  }

  try {
    // 1) نسخة أمان من الوضع الحالي (JSON) — يمكن استعادتها لاحقًا
    const safetyDump = await buildBackupDump(db, username);
    const safetyFile = snapshotFileName("safety");
    await saveSnapshotFile(safetyFile, safetyDump);

    // 2) الاستعادة في معاملة واحدة (مهلة واسعة لقاعدة كبيرة)
    const { inserted } = await db.$transaction(async (tx) => restoreBackupData(tx, dump.data), {
      timeout: 180_000,
      maxWait: 15_000,
    });

    const total = Object.values(inserted).reduce((a, b) => a + b, 0);
    const tablesCount = Object.keys(inserted).length;

    try {
      await audit(db, {
        username,
        action: "استعادة نسخة من ملف مرفوع",
        entityType: "backup",
        entityName: name || "ملف بلا اسم",
        reason: `نسخة الأمان: ${safetyFile} — الصفوف: ${total}`,
      });
    } catch {
      /* لا نُفشل الاستعادة إن تعذر التدقيق */
    }

    return ok({
      restored: true,
      safetyFile,
      counts: inserted,
      message: `تمت الاستعادة من الملف المرفوع بنجاح — ${total} صفًا عبر ${tablesCount} جدولًا، وأُعيد ضبط تسلسلات المعرّفات. أُخذت نسخة أمان (${safetyFile}) من الوضع السابق.`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير معروف";
    return jsonError(`تعذرت الاستعادة — لم يطرأ أي تغيير على القاعدة (كل العمليات داخل معاملة واحدة): ${msg}`, 500);
  }
}
