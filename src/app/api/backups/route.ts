import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import {
  ATTACH_DIR,
  BACKUPS_DIR,
  DB_PATH,
  addManifestEntry,
  ensureBackupsDir,
  listAttachmentFiles,
  pruneBackups,
  readManifest,
  stampNow,
} from "@/lib/backups";

/** قائمة النسخ الاحتياطية — للمدير (أو من يملك صلاحية action_backups) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "action_backups");
  if ("response" in guard) return guard.response;

  ensureBackupsDir();
  const manifest = readManifest();

  const items: {
    fileName: string;
    kind: "db" | "full" | "safety";
    username: string;
    sizeKB: number;
    createdAt: string;
    exists: boolean;
  }[] = [];

  for (const e of manifest) {
    let sizeKB = Math.round((e.size / 1024) * 10) / 10;
    let exists = true;
    try {
      const st = fs.statSync(path.join(BACKUPS_DIR, e.fileName));
      sizeKB = Math.round((st.size / 1024) * 10) / 10;
    } catch {
      exists = false;
    }
    items.push({
      fileName: e.fileName,
      kind: e.kind,
      username: e.username,
      sizeKB,
      createdAt: e.createdAt,
      exists,
    });
  }

  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return ok({ items });
}

/** إنشاء نسخة احتياطية: {kind:'db'|'full'} */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "action_backups");
  if ("response" in guard) return guard.response;
  const username = guard.user.username;

  const body = (await req.json().catch(() => ({}))) as { kind?: string };
  const kind = body.kind === "full" ? "full" : body.kind === "db" ? "db" : "";
  if (!kind) return jsonError("نوع النسخة غير صحيح — المطلوب kind: 'db' أو 'full'");

  ensureBackupsDir();
  if (!fs.existsSync(DB_PATH)) return jsonError("ملف قاعدة البيانات غير موجود", 500);

  const stamp = stampNow();
  const createdAt = new Date().toISOString();

  try {
    if (kind === "db") {
      // نسخة قاعدة البيانات: نسخ الملف فقط
      const fileName = `backup-${stamp}.db`;
      const dest = path.join(BACKUPS_DIR, fileName);
      await fs.promises.copyFile(DB_PATH, dest);
      const size = fs.statSync(dest).size;
      addManifestEntry({ fileName, kind: "db", username, size, createdAt });
      pruneBackups(30);
      await audit(db, {
        username,
        action: "إنشاء نسخة احتياطية",
        entityType: "backup",
        entityName: fileName,
        newStatus: "db",
        reason: `الحجم: ${Math.round((size / 1024) * 10) / 10} كيلوبايت`,
      });
      return ok({ created: true, fileName, message: "تم إنشاء نسخة قاعدة البيانات بنجاح" });
    }

    // نسخة كاملة: القاعدة + دليل المرفقات + نسخ ملفات المرفقات
    const fileName = `backup-full-${stamp}.db`;
    const jsonName = `backup-full-${stamp}.json`;
    const attachmentsDirName = `attachments-${stamp}`;

    const destDb = path.join(BACKUPS_DIR, fileName);
    await fs.promises.copyFile(DB_PATH, destDb);
    const dbSize = fs.statSync(destDb).size;

    // نسخ ملفات المرفقات إلى مجلد فرعي
    const destAttachDir = path.join(BACKUPS_DIR, attachmentsDirName);
    fs.mkdirSync(destAttachDir, { recursive: true });
    const files = listAttachmentFiles();
    let copied = 0;
    let totalAttachSize = 0;
    for (const f of files) {
      try {
        await fs.promises.copyFile(f.path, path.join(destAttachDir, path.basename(f.name)));
        copied += 1;
        totalAttachSize += f.size;
      } catch {
        /* تجاهل ملف يفشل نسخه */
      }
    }
    const totalSize = totalAttachSize;

    // ملف الدليل JSON: بيانات القاعدة + قائمة المرفقات (المسارات والأحجام)
    const guide = {
      kind: "full",
      createdAt,
      username,
      dbFile: fileName,
      dbSize,
      attachments: {
        sourceDir: ATTACH_DIR,
        copiedDir: attachmentsDirName,
        count: copied,
        totalSize,
        files: files.map((f) => ({ name: f.name, path: f.path, size: f.size })),
      },
    };
    fs.writeFileSync(path.join(BACKUPS_DIR, jsonName), JSON.stringify(guide, null, 2), "utf-8");

    addManifestEntry({
      fileName,
      kind: "full",
      username,
      size: dbSize,
      createdAt,
      extra: jsonName,
      attachmentsDir: attachmentsDirName,
    });
    pruneBackups(30);

    await audit(db, {
      username,
      action: "إنشاء نسخة احتياطية كاملة",
      entityType: "backup",
      entityName: fileName,
      newStatus: "full",
      reason: `المرفقات: ${copied} ملفًا`,
    });

    return ok({
      created: true,
      fileName,
      message: `تم إنشاء نسخة كاملة بنجاح (قاعدة + ${copied} ملف مرفقات)`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير معروف";
    return jsonError(`تعذر إنشاء النسخة الاحتياطية: ${msg}`, 500);
  }
}
