// ============================================================
// /api/backups — النسخ المحفوظة على الخادم (db/backups) — للمدير
// GET  : قائمة ملفات JSON مع manifest كل نسخة (الاسم/الحجم/التاريخ/عدّاد الجداول)
// POST : إنشاء نسخة خادم = dump كامل → db/backups/backup-<ختم>.json + فهرس + تقليم
// ملاحظة: مع Postgres لا تُنسخ ملفات قاعدة — النسخة JSON كاملة قابلة للاستعادة
// ============================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";
import { buildBackupDump, listBackupFiles, saveSnapshotFile, snapshotFileName } from "@/lib/backup-dump";

/** قائمة النسخ المحفوظة على الخادم */
export async function GET(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  try {
    return ok({ items: listBackupFiles() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير معروف";
    return jsonError(`تعذر عرض النسخ المحفوظة: ${msg}`, 500);
  }
}

/** إنشاء نسخة خادم (JSON كامل في db/backups مع فهرس index.json) */
export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const username = guard.user.username;

  try {
    const dump = await buildBackupDump(db, username);
    const fileName = snapshotFileName("backup");
    const entry = await saveSnapshotFile(fileName, dump);

    const totalRows = Object.values(dump.manifest.tableCounts).reduce((a, b) => a + b, 0);
    const sizeKB = Math.round((entry.size / 1024) * 10) / 10;

    // سجل تدقيق — لا يُفشل إنشاء النسخة إن تعذرت الكتابة
    try {
      await audit(db, {
        username,
        action: "إنشاء نسخة احتياطية",
        entityType: "backup",
        entityName: fileName,
        newStatus: "db",
        reason: `الصفوف: ${totalRows} — الحجم: ${sizeKB} كيلوبايت`,
      });
    } catch {
      /* تجاهل */
    }

    return ok({
      created: true,
      fileName,
      tableCounts: dump.manifest.tableCounts,
      totalRows,
      message: `تم إنشاء النسخة ${fileName} (${totalRows} صفًا)`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير معروف";
    return jsonError(`تعذر إنشاء النسخة الاحتياطية: ${msg}`, 500);
  }
}
