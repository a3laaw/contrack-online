// ============================================================
// POST /api/backups/restore — استعادة نسخة JSON على Postgres — للمدير
// { fileName } ⇒ ملف من db/backups:
// 1) نسخة أمان (safety-…) من الوضع الحالي قبل أي تغيير
// 2) معاملة واحدة: حذف بالترتيب العكسي ثم إنشاء بالمعرّفات الأصلية ثم setval للتسلسلات
// ============================================================
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";
import {
  BACKUPS_DIR,
  buildBackupDump,
  readSnapshotFile,
  restoreBackupData,
  saveSnapshotFile,
  snapshotFileName,
} from "@/lib/backup-dump";

export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const username = guard.user.username;

  const body = (await req.json().catch(() => ({}))) as { fileName?: string };
  const fileName = path.basename(String(body.fileName || "").trim());
  if (!fileName) return jsonError("اسم ملف النسخة مطلوب");
  if (!fileName.endsWith(".json")) return jsonError("الملف المحدد ليس نسخة JSON صحيحة");

  const srcPath = path.join(BACKUPS_DIR, fileName);
  if (!srcPath.startsWith(BACKUPS_DIR + path.sep) || !fs.existsSync(srcPath)) {
    return jsonError("ملف النسخة الاحتياطية غير موجود", 404);
  }

  // قراءة النسخة والتحقق من بنيتها قبل العبث بالقاعدة
  let dump;
  try {
    dump = readSnapshotFile(fileName);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_A_BACKUP") {
      return jsonError("الملف ليس نسخة احتياطية صالحة — الفهرس المختصر (manifest) أو البيانات مفقودة", 400);
    }
    return jsonError("الملف تالف — تعذرت قراءته بصيغة JSON", 400);
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
        action: "استعادة نسخة احتياطية",
        entityType: "backup",
        entityName: fileName,
        reason: `نسخة الأمان: ${safetyFile} — الصفوف: ${total}`,
      });
    } catch {
      /* لا نُفشل الاستعادة إن تعذر التدقيق */
    }

    return ok({
      restored: true,
      safetyFile,
      counts: inserted,
      message: `تمت الاستعادة بنجاح — ${total} صفًا عبر ${tablesCount} جدولًا، وأُعيد ضبط تسلسلات المعرّفات. أُخذت نسخة أمان (${safetyFile}) من الوضع السابق.`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير معروف";
    return jsonError(`تعذرت الاستعادة — لم يطرأ أي تغيير على القاعدة (كل العمليات داخل معاملة واحدة): ${msg}`, 500);
  }
}
