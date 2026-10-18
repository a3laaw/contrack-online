import "server-only";
import fs from "fs";
import path from "path";

/** مسارات النسخ الاحتياطي — القاعدة والمرفقات كالمصدر داخل db/ */
export const DB_PATH = path.join(process.cwd(), "db", "custom.db");
export const BACKUPS_DIR = path.join(process.cwd(), "db", "backups");
export const ATTACH_DIR = path.join(process.cwd(), "db", "attachments");
export const MANIFEST_PATH = path.join(BACKUPS_DIR, "manifest.json");

export interface BackupManifestEntry {
  /** الملف الأساسي القابل للاستعادة (نسخة القاعدة أو قاعدة النسخة الكاملة) */
  fileName: string;
  kind: "db" | "full" | "safety";
  username: string;
  size: number;
  createdAt: string; // ISO
  /** ملف JSON الدليل للنسخة الكاملة */
  extra?: string;
  /** مجلد مرفقات النسخة الكاملة */
  attachmentsDir?: string;
}

export function ensureBackupsDir() {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

/** ختم زمني YYYYMMDD-HHmmss */
export function stampNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function readManifest(): BackupManifestEntry[] {
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BackupManifestEntry[]) : [];
  } catch {
    return [];
  }
}

export function writeManifest(list: BackupManifestEntry[]) {
  ensureBackupsDir();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(list, null, 2), "utf-8");
}

export function addManifestEntry(entry: BackupManifestEntry): BackupManifestEntry[] {
  const list = readManifest();
  list.unshift(entry);
  writeManifest(list);
  return list;
}

/** قائمة ملفات مجلد المرفقات (مسار مطلق + اسم نسبي + حجم) */
export function listAttachmentFiles(): { name: string; path: string; size: number }[] {
  const out: { name: string; path: string; size: number }[] = [];
  if (!fs.existsSync(ATTACH_DIR)) return out;
  const stack: string[] = [ATTACH_DIR];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        try {
          out.push({ name: path.relative(ATTACH_DIR, full), path: full, size: fs.statSync(full).size });
        } catch {
          /* تجاهل ملف غير قابل للقراءة */
        }
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * الاحتفاظ بآخر 30 نسخة (db/full فقط — ملفات الأمان مستثناة):
 * حذف الأقدم من القرص (القاعدة + دليل JSON + مجلد المرفقات) مع تحديث manifest.
 */
export function pruneBackups(keep = 30) {
  const list = readManifest();
  const mains = list.filter((e) => e.kind === "db" || e.kind === "full");
  const excess = mains.slice(keep);
  if (!excess.length) return;

  const removedFiles = new Set<string>();
  const removedExtras = new Set<string>();
  const removedDirs = new Set<string>();

  for (const e of excess) {
    removedFiles.add(e.fileName);
    if (e.extra) removedExtras.add(e.extra);
    if (e.attachmentsDir) removedDirs.add(e.attachmentsDir);
    try {
      fs.rmSync(path.join(BACKUPS_DIR, e.fileName), { force: true });
    } catch {
      /* مفقود أصلًا */
    }
    if (e.extra) {
      try {
        fs.rmSync(path.join(BACKUPS_DIR, e.extra), { force: true });
      } catch {
        /* مفقود أصلًا */
      }
    }
    if (e.attachmentsDir) {
      try {
        fs.rmSync(path.join(BACKUPS_DIR, e.attachmentsDir), { recursive: true, force: true });
      } catch {
        /* مفقود أصلًا */
      }
    }
  }

  writeManifest(
    list.filter(
      (e) =>
        !removedFiles.has(e.fileName) &&
        !(e.extra && removedExtras.has(e.extra)) &&
        !(e.attachmentsDir && removedDirs.has(e.attachmentsDir))
    )
  );
}
