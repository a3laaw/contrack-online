import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";
import {
  BACKUPS_DIR,
  DB_PATH,
  addManifestEntry,
  ensureBackupsDir,
  stampNow,
} from "@/lib/backups";

/** استعادة نسخة احتياطية: {fileName} — للمدير، مع نسخة أمان تلقائية أولًا */
export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const username = guard.user.username;

  const body = (await req.json().catch(() => ({}))) as { fileName?: string };
  const fileName = path.basename(String(body.fileName || "").trim());
  if (!fileName) return jsonError("اسم ملف النسخة مطلوب");
  if (!fileName.endsWith(".db")) return jsonError("الملف المحدد ليس نسخة قاعدة بيانات صحيحة");

  const srcPath = path.join(BACKUPS_DIR, fileName);
  if (!srcPath.startsWith(BACKUPS_DIR) || !fs.existsSync(srcPath)) {
    return jsonError("ملف النسخة الاحتياطية غير موجود", 404);
  }
  if (!fs.existsSync(DB_PATH)) return jsonError("ملف قاعدة البيانات الحالي غير موجود", 500);

  ensureBackupsDir();
  const stamp = stampNow();

  try {
    // 1) نسخة أمان من القاعدة الحالية قبل أي استبدال
    const safetyFile = `safety-${stamp}.db`;
    const safetyPath = path.join(BACKUPS_DIR, safetyFile);
    await fs.promises.copyFile(DB_PATH, safetyPath);
    const safetySize = fs.statSync(safetyPath).size;
    addManifestEntry({
      fileName: safetyFile,
      kind: "safety",
      username,
      size: safetySize,
      createdAt: new Date().toISOString(),
    });

    // 2) استبدال القاعدة بالنسخة المطلوبة (Prisma يعيد الاتصال بالملف تلقائيًا)
    await fs.promises.copyFile(srcPath, DB_PATH);

    await audit(db, {
      username,
      action: "استعادة نسخة احتياطية",
      entityType: "backup",
      entityName: fileName,
      reason: `نسخة الأمان: ${safetyFile}`,
    });

    return ok({
      restored: true,
      safetyFile,
      message:
        "تمت الاستعادة بنجاح — أخذنا نسخة أمان من القاعدة الحالية قبل الاستبدال. إن لزم يتفعل الأمر عند إعادة تشغيل الخدمة، ويعيد Prisma الاتصال تلقائيًا بملف القاعدة.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير معروف";
    return jsonError(`تعذرت الاستعادة: ${msg}`, 500);
  }
}
