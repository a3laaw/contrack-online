// ============================================================
// backup-dump.ts — محرك النسخ الاحتياطي لقاعدة Postgres
// - يبني JSON كاملًا لكل جداول النظام بترتيب طوبولوجي (الآباء قبل الأبناء)
// - يستعيد النسخة داخل معاملة واحدة: حذف الأبناء قبل الآباء ثم إنشاء
//   بالمعرّفات الأصلية ثم إعادة ضبط تسلسلات id في Postgres
// - يستخدمه: /api/backup (تنزيل) و /api/backups (قائمة/إنشاء) و /api/backups/restore
// ملاحظة: قائمة الجداول أدناه مطابقة حرفيًا لـ prisma/schema.prisma
// (أي تغيير على المخطط يستوجب تحديث هذا الترتيب)
// ============================================================
import "server-only";
import fs from "fs";
import path from "path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { parseSnapshotText } from "@/lib/backup-parse";

export const BACKUP_APP = "ConTrack Online";
export const BACKUP_VERSION = "V9.15.18-web";

export const BACKUPS_DIR = path.join(process.cwd(), "db", "backups");
const INDEX_PATH = path.join(BACKUPS_DIR, "index.json");

type DbClient = Prisma.TransactionClient | PrismaClient;

export interface BackupManifest {
  app: string;
  version: string;
  createdAt: string; // ISO
  generatedBy: string;
  tableCounts: Record<string, number>;
}

export interface BackupDump {
  manifest: BackupManifest;
  data: Record<string, Record<string, unknown>[]>;
}

interface BackupModelSpec {
  /** اسم المندوب في Prisma Client (camelCase) */
  model: string;
  /** اسم الجدول الفعلي في Postgres (@@map) — مفتاح التخزين في JSON */
  table: string;
  /** هل له معرّف id تسلسلي (serial) يستوجب إعادة ضبط setval بعد الاستعادة */
  serial: boolean;
}

// FK ذاتي المرجع (شجرة/سند أب) — الاستعادة تعالجها بمرورات متتالية
const SELF_REF_FK: Record<string, string> = {
  workflow_stages: "parentId",
  expense_accounts: "parentId",
  vouchers: "parentVoucherId",
};

/** حد أقصى للصفوف في كل createMany (لتجنّب تجاوز حدود المعاملات) */
const CHUNK = 200;

// الترتيب الطوبولوجي الكامل — الآباء قبل الأبناء
export const BACKUP_MODELS: BackupModelSpec[] = [
  // ===== الحوكمة =====
  { model: "user", table: "users", serial: true },
  { model: "userPermission", table: "user_permissions", serial: false },
  { model: "setting", table: "settings", serial: false },
  { model: "featureFlag", table: "feature_flags", serial: false },
  { model: "numberSequence", table: "number_sequences", serial: false },
  // ===== العملاء والعقود =====
  { model: "customer", table: "customers", serial: true },
  { model: "contractType", table: "contract_types", serial: true },
  { model: "workflowStage", table: "workflow_stages", serial: true }, // FK ذاتي
  { model: "paymentMethod", table: "payment_methods", serial: true },
  { model: "expenseAccount", table: "expense_accounts", serial: true }, // FK ذاتي
  { model: "employee", table: "employees", serial: true },
  { model: "visitStaff", table: "visit_staff", serial: true },
  { model: "gatewayProfile", table: "gateway_profiles", serial: true },
  { model: "contract", table: "contracts", serial: true },
  { model: "contractScope", table: "contract_scope", serial: false },
  { model: "contractStage", table: "contract_stages", serial: true },
  { model: "boqItem", table: "boq_items", serial: true },
  { model: "paymentPlanItem", table: "payment_plan", serial: true },
  // ===== الباطن =====
  { model: "subcontractor", table: "subcontractors", serial: true },
  { model: "subContract", table: "sub_contracts", serial: true },
  { model: "subContractItem", table: "sub_contract_items", serial: true },
  { model: "subPaymentPlanItem", table: "sub_payment_plan", serial: true },
  { model: "subPaymentSource", table: "sub_payment_sources", serial: true },
  // ===== قوالب الأنواع =====
  { model: "typePaymentTemplate", table: "type_payment_tpl", serial: true },
  { model: "typePaymentStage", table: "type_payment_stages", serial: true },
  { model: "typeBundleComponent", table: "type_bundle_components", serial: true },
  // ===== السندات والملحقات والمطالبات =====
  { model: "voucher", table: "vouchers", serial: true }, // FK ذاتي
  { model: "voucherPaymentLink", table: "voucher_payment_links", serial: true },
  { model: "addendum", table: "addendums", serial: true },
  { model: "addendumItem", table: "addendum_items", serial: true },
  { model: "claim", table: "claims", serial: true },
  // ===== المجموعات والفواتير =====
  { model: "contractGroup", table: "contract_groups", serial: true },
  { model: "contractGroupItem", table: "contract_group_items", serial: true },
  { model: "invoice", table: "invoices", serial: true },
  // ===== الإنتاجية =====
  { model: "task", table: "tasks", serial: true },
  { model: "visit", table: "visits", serial: true },
  { model: "comment", table: "customer_comments", serial: true },
  { model: "contractAttachment", table: "contract_attachments", serial: true },
  // ===== البوابة المالية =====
  { model: "gatewayOp", table: "gateway_ops", serial: true },
  { model: "bankLine", table: "bank_lines", serial: true },
  { model: "otherCompanyTransfer", table: "other_company_transfers", serial: true },
  { model: "transferOpAlloc", table: "transfer_op_allocs", serial: true },
  { model: "otherCompanyOpening", table: "other_company_opening", serial: false },
  { model: "gatewayFeeVoucher", table: "gateway_fee_vouchers", serial: false },
  { model: "matchAlias", table: "match_aliases", serial: true },
  // ===== القيود والأحداث والقوالب =====
  { model: "journalEntry", table: "journal_entries", serial: true },
  { model: "contractEvent", table: "contract_events", serial: true },
  { model: "formCategory", table: "form_categories", serial: true },
  { model: "formTemplate", table: "form_templates", serial: true },
  { model: "formField", table: "form_fields", serial: true },
  { model: "formDocument", table: "form_documents", serial: true },
  // ===== سجلات النظام (آخرًا لكي تُحذف أولًا عند الاستعادة) =====
  { model: "auditLog", table: "audit_log", serial: true },
  { model: "purgeAudit", table: "purge_audit", serial: true },
];

interface DbDelegate {
  findMany(args?: unknown): Promise<Record<string, unknown>[]>;
  createMany(args: { data: Record<string, unknown>[] }): Promise<unknown>;
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  deleteMany(args?: unknown): Promise<{ count: number }>;
}

function delegate(client: DbClient, model: string): DbDelegate {
  const d = (client as unknown as Record<string, DbDelegate | undefined>)[model];
  if (!d) throw new Error(`النموذج غير معروف في Prisma Client: ${model}`);
  return d;
}

function chunked<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

// ==================== بناء النسخة (Dump) ====================

/**
 * نسخة JSON كاملة: findMany لكل جدول (بلا علاقات — كل الجداول تُنسخ)
 * بالترتيب الطوبولوجي مع manifest (الإصدار والوقت وعدّاد كل جدول).
 */
export async function buildBackupDump(client: DbClient, username = ""): Promise<BackupDump> {
  const data: Record<string, Record<string, unknown>[]> = {};
  const tableCounts: Record<string, number> = {};
  // تسلسلي (لا Promise.all) — ألطف على connection pool
  for (const m of BACKUP_MODELS) {
    const rows = await delegate(client, m.model).findMany();
    data[m.table] = rows;
    tableCounts[m.table] = rows.length;
  }
  const manifest: BackupManifest = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    generatedBy: username,
    tableCounts,
  };
  return { manifest, data };
}

// ==================== الاستعادة (Restore) ====================

/** إدراج صفوف بالحفاظ على المعرّفات — مع معالجة FK ذاتي المرجع بمرورات متتالية */
async function insertRows(
  tx: Prisma.TransactionClient,
  model: string,
  table: string,
  rows: Record<string, unknown>[],
): Promise<number> {
  if (!rows.length) return 0;
  const d = delegate(tx, model);
  const fk = SELF_REF_FK[table];

  if (!fk) {
    for (const chunk of chunked(rows, CHUNK)) {
      await d.createMany({ data: chunk });
    }
    return rows.length;
  }

  // جدول ذاتي المرجع: أدخل الأبَيْن قبل الابن عبر مرورات، واليتم المعلّق (مرجع مكسور) يُنشأ بلا رابط
  const inserted = new Set<number>();
  let pending = rows.slice();
  let count = 0;
  while (pending.length) {
    const batch = pending.filter((r) => r[fk] == null || inserted.has(Number(r[fk])));
    if (!batch.length) {
      // مراجع مكسورة لا يمكن حلّها — تُنشأ بدون الرابط حفاظًا على بقية البيانات
      for (const r of pending) {
        const { [fk]: _broken, ...rest } = r;
        await d.create({ data: rest });
        count += 1;
      }
      break;
    }
    for (const chunk of chunked(batch, CHUNK)) {
      await d.createMany({ data: chunk });
    }
    for (const r of batch) inserted.add(Number(r.id));
    const batchSet = new Set(batch);
    pending = pending.filter((r) => !batchSet.has(r));
    count += batch.length;
  }
  return count;
}

/**
 * استعادة كاملة داخل معاملة واحدة:
 * 1) تحقق أن كل مفاتيح الملف جداول معروفة
 * 2) حذف كل الجداول بالترتيب العكسي (الأبناء قبل الآباء)
 * 3) إنشاء بالترتيب الطوبولوجي مع الحفاظ على المعرّفات الأصلية
 * 4) إعادة ضبط تسلسلات id (setval) لكل جدول تسلسلي
 */
export async function restoreBackupData(
  tx: Prisma.TransactionClient,
  data: Record<string, unknown[]>,
): Promise<{ inserted: Record<string, number> }> {
  const known = new Map(BACKUP_MODELS.map((m) => [m.table, m]));
  for (const key of Object.keys(data)) {
    if (!known.has(key)) throw new Error(`جدول غير معروف في ملف النسخة: ${key}`);
  }

  // 2) حذف بالترتيب العكسي
  for (let i = BACKUP_MODELS.length - 1; i >= 0; i--) {
    await delegate(tx, BACKUP_MODELS[i].model).deleteMany();
  }

  // 3) إنشاء بالترتيب الطوبولوجي
  const inserted: Record<string, number> = {};
  for (const m of BACKUP_MODELS) {
    const rows = Array.isArray(data[m.table]) ? (data[m.table] as Record<string, unknown>[]) : [];
    inserted[m.table] = await insertRows(tx, m.model, m.table, rows);
  }

  // 4) إعادة ضبط التسلسلات — أسماء الجداول من قائمة بيضاء حرفية (لا مدخلات خارجية)
  for (const m of BACKUP_MODELS) {
    if (!m.serial) continue;
    await tx.$queryRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${m.table}"','id'), COALESCE((SELECT MAX("id") FROM "${m.table}"), 1), (SELECT MAX("id") FROM "${m.table}") IS NOT NULL)`,
    );
  }

  return { inserted };
}

// ==================== التخزين على الخادم (db/backups) ====================

export function ensureBackupsDir() {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

/** ختم زمني YYYYMMDD-HHmmss-mmm (يمنع تصادم الملفات) */
function stampNow(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

export function snapshotFileName(prefix: "backup" | "safety"): string {
  return `${prefix}-${stampNow()}.json`;
}

interface IndexEntry {
  fileName: string;
  kind: "db" | "safety";
  username: string;
  size: number;
  createdAt: string; // ISO
  tableCounts: Record<string, number>;
}

export interface BackupListItem {
  fileName: string;
  kind: "db" | "safety";
  username: string;
  sizeKB: number;
  createdAt: string;
  tableCounts: Record<string, number>;
  exists: boolean;
}

function readIndex(): IndexEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8")) as unknown;
    return Array.isArray(parsed) ? (parsed as IndexEntry[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(list: IndexEntry[]) {
  ensureBackupsDir();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(list, null, 2), "utf-8");
}

/** الاحتفاظ بآخر keep نسخة (ملفات الأمان مستثناة من التقليم) */
export function pruneBackupFiles(keep = 30) {
  const list = readIndex();
  const mains = list.filter((e) => e.kind !== "safety");
  const excess = mains.slice(keep);
  if (!excess.length) return;
  const removed = new Set(excess.map((e) => e.fileName));
  for (const name of removed) {
    try {
      fs.rmSync(path.join(BACKUPS_DIR, name), { force: true });
    } catch {
      /* مفقود أصلًا */
    }
  }
  writeIndex(list.filter((e) => !removed.has(e.fileName)));
}

function upsertIndex(entry: IndexEntry) {
  const list = readIndex().filter((e) => e.fileName !== entry.fileName);
  list.unshift(entry);
  writeIndex(list);
  pruneBackupFiles(30);
}

/** كتابة ملف نسخة على الخادم + تحديث الفهرس + التقليم */
export async function saveSnapshotFile(fileName: string, dump: BackupDump): Promise<IndexEntry> {
  ensureBackupsDir();
  const dest = path.join(BACKUPS_DIR, fileName);
  await fs.promises.writeFile(dest, JSON.stringify(dump), "utf-8");
  const size = (await fs.promises.stat(dest)).size;
  const entry: IndexEntry = {
    fileName,
    kind: fileName.startsWith("safety-") ? "safety" : "db",
    username: dump.manifest.generatedBy,
    size,
    createdAt: dump.manifest.createdAt,
    tableCounts: dump.manifest.tableCounts,
  };
  upsertIndex(entry);
  return entry;
}

/** قراءة ملف نسخة (للاستعادة) مع تحقق بنية manifest/data — عبر المدقق المشترك */
export function readSnapshotFile(fileName: string): BackupDump {
  const dest = path.join(BACKUPS_DIR, path.basename(fileName));
  const text = fs.readFileSync(dest, "utf-8");
  try {
    const parsed = parseSnapshotText(text);
    return {
      manifest: parsed.manifest as unknown as BackupManifest,
      data: parsed.data as Record<string, Record<string, unknown>[]>,
    };
  } catch {
    // عقد الأخطاء الحالي: أي ملف غير صالح ⇒ NOT_A_BACKUP (الرسائل التفصيلية في مسار الرفع)
    throw new Error("NOT_A_BACKUP");
  }
}

/** قائمة النسخ المحفوظة: من الفهرس + التقاط ملفات غير مفهرسة + تحقق الوجود */
export function listBackupFiles(): BackupListItem[] {
  ensureBackupsDir();
  let entries = readIndex();

  // التقاط ملفات JSON غير مفهرسة (نسخ منسوخة يدويًا أو من إصدار قديم)
  const known = new Set(entries.map((e) => e.fileName));
  let files: string[] = [];
  try {
    files = fs.readdirSync(BACKUPS_DIR).filter((f) => f.endsWith(".json") && f !== "index.json");
  } catch {
    /* مجلد غير متاح */
  }
  let indexDirty = false;
  for (const f of files) {
    if (known.has(f)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(BACKUPS_DIR, f), "utf-8")) as Partial<BackupDump>;
      if (parsed?.manifest?.createdAt) {
        entries.unshift({
          fileName: f,
          kind: f.startsWith("safety-") ? "safety" : "db",
          username: parsed.manifest.generatedBy ?? "",
          size: fs.statSync(path.join(BACKUPS_DIR, f)).size,
          createdAt: parsed.manifest.createdAt,
          tableCounts: parsed.manifest.tableCounts ?? {},
        });
        indexDirty = true;
      }
    } catch {
      /* ملف تالف — يُتجاهل */
    }
  }

  const items: BackupListItem[] = [];
  for (const e of entries) {
    let size = e.size;
    try {
      size = fs.statSync(path.join(BACKUPS_DIR, e.fileName)).size;
    } catch {
      continue; // مفقود من القرص — لا يُعرض
    }
    items.push({
      fileName: e.fileName,
      kind: e.kind,
      username: e.username,
      sizeKB: Math.round((size / 1024) * 10) / 10,
      createdAt: e.createdAt,
      tableCounts: e.tableCounts ?? {},
      exists: true,
    });
  }
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  if (indexDirty || readIndex().length !== items.length) {
    writeIndex(
      items.map((i) => ({
        fileName: i.fileName,
        kind: i.kind,
        username: i.username,
        size: Math.round(i.sizeKB * 1024),
        createdAt: i.createdAt,
        tableCounts: i.tableCounts,
      })),
    );
  }
  return items;
}
