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
import {
  migrateLegacyJournalRows,
  resolveLegacyAccountName,
  SUSPENSE_ACCOUNT,
  type LegacyJournalRow,
} from "@/lib/accounting-journal";

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
  vouchers: "parentVoucherId",
  accounts: "parentId", // Task 102 — دليل الحسابات: شجرة ذاتية المرجع
  journal_entries: "reversalOfId", // Task 104 — قيد عكسي يرتبط بالقيد الأصلي
};

/**
 * Task 105 — مفتاح الجدول القديم المُسقط: نسخ JSON القديمة (قبل Task 105) تحمل
 * expense_accounts — تُقرأ لبناء خريطة حسم الحساب ثم تُهمل من الإدراج.
 */
const DROPPED_LEGACY_TABLES = new Set(["expense_accounts"]);

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
  // Task 102 — دليل الحسابات الكامل (FK ذاتي: شجرة) — قبل السندات لترابط الحسابات (Task 105: الدليل الوحيد)
  { model: "account", table: "accounts", serial: true },
  // Task 106 — قواعد ترحيل السندات (أكواد نصية بلا FK — منطقيًا بعد الدليل وقبل السندات)
  { model: "postingRule", table: "posting_rules", serial: false },
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
  // ===== النواة المحاسبية (Task 104) — الفترات ثم القيود ثم أسطرها =====
  { model: "fiscalYear", table: "fiscal_years", serial: true },
  { model: "fiscalPeriod", table: "fiscal_periods", serial: true },
  { model: "journalEntry", table: "journal_entries", serial: true }, // FK ذاتي (reversalOfId)
  { model: "journalLine", table: "journal_lines", serial: true },
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

/**
 * Task 104 — إدراج قيود قديمة الشكل (نصوص أطراف) محوّلة للنموذج الجديد:
 * حسم كل طرف (جسر شجرة المصروفات/الدليل/الخريطة الثابتة) والتسوية المؤقت للشك،
 * ثم رؤوس مرقّمة تعاقبيًا + أسطرها. تُستدعى داخل معاملة الاستعادة بعد استعادة الحسابات.
 */
async function insertLegacyJournalRows(
  tx: Prisma.TransactionClient,
  rows: LegacyJournalRow[]
): Promise<number> {
  const accounts = (await delegate(tx, "account").findMany({
    select: { id: true, code: true, name: true, allowPosting: true, isActive: true },
  })) as unknown as { id: number; code: string; name: string; allowPosting: boolean; isActive: boolean }[];
  let suspenseId = accounts.find((a) => a.code === SUSPENSE_ACCOUNT.code)?.id ?? null;
  if (suspenseId == null) {
    const created = (await delegate(tx, "account").create({
      data: {
        code: SUSPENSE_ACCOUNT.code,
        name: SUSPENSE_ACCOUNT.name,
        type: SUSPENSE_ACCOUNT.type,
        nature: SUSPENSE_ACCOUNT.nature,
        isLeaf: true,
        allowPosting: true,
        isActive: true,
        isSystem: true,
        notes: SUSPENSE_ACCOUNT.notes,
        xbrlElement: "kw:SuspenseAccount",
      },
    })) as { id: number; code: string; name: string };
    suspenseId = created.id;
    accounts.push({
      id: created.id,
      code: created.code,
      name: created.name,
      allowPosting: true,
      isActive: true,
    });
  }
  const candidates = accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    allowPosting: a.allowPosting,
    isActive: a.isActive,
  }));
  const resolve = (name: string): number | null => {
    const raw = String(name || "").trim();
    if (!raw) return null;
    return resolveLegacyAccountName(raw, candidates);
  };

  const mig = migrateLegacyJournalRows(rows, resolve, suspenseId);
  let entryNo = 1;
  const heads = mig.entries.map((e) => ({
    entryNo: entryNo++,
    entryDate: e.entryDate,
    description: e.description,
    status: "posted" as const,
    sourceType: e.sourceType,
    sourceId: e.sourceId,
    postedAt: new Date(),
    postedBy: "restore-legacy",
    createdBy: "restore-legacy",
  }));
  const createdEntries: { id: number; entryNo: number }[] = [];
  const entryDelegate = delegate(tx, "journalEntry");
  for (const chunk of chunked(heads, CHUNK)) {
    const made = await entryDelegate.createMany({ data: chunk });
    void made;
  }
  // استرجاع المعرفات المولدة بالترتيب (رقم القيد تسلسلي بدأ من 1)
  const created = (await delegate(tx, "journalEntry").findMany({
    where: { entryNo: { gte: 1 } },
    select: { id: true, entryNo: true },
  })) as unknown as { id: number; entryNo: number }[];
  createdEntries.push(...created);
  const idByNo = new Map(createdEntries.map((c) => [c.entryNo, c.id]));

  const lineRows: Record<string, unknown>[] = [];
  mig.entries.forEach((e, idx) => {
    const entryId = idByNo.get(heads[idx].entryNo);
    if (!entryId) return;
    e.lines.forEach((l, i) => {
      lineRows.push({
        entryId,
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        description: l.description || "",
        customerId: l.customerId ?? null,
        contractId: l.contractId ?? null,
        subContractId: l.subContractId ?? null,
        boqItemId: l.boqItemId ?? null,
        projectId: l.projectId ?? null,
        employeeId: l.employeeId ?? null,
        costCenter: l.costCenter || "",
        sort: i,
      });
    });
  });
  const lineDelegate = delegate(tx, "journalLine");
  for (const chunk of chunked(lineRows, CHUNK)) {
    await lineDelegate.createMany({ data: chunk });
  }
  return mig.entries.length;
}

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
 * Task 105 — محوّل حقول السندات القديمة للشكل الجديد (نسخة JSON قبل الترقية):
 *  expense_account_id + custody_account_id + snapshotين  →  account_id + custody_account_id + account_snapshot
 * الحسم عبر أسماء الشجرة القديمة (خريطة expense_accounts من نفس الملف إن وُجدت) ثم الدليل المستعاد؛
 * الشك ⇒ حساب التسوية المؤقت (نفس دقة ترحيل Task 104 النصي). الدالة نقية (لا DB).
 */
export function transformLegacyVoucherRows(
  rows: Record<string, unknown>[],
  legacyTree: Record<string, unknown>[],
  resolve: (name: string) => number | null,
  suspenseId: number,
): Record<string, unknown>[] {
  const eaById = new Map<number, { name: string; fullPath: string; kind: string }>();
  for (const ea of legacyTree) {
    if (ea?.id != null) {
      eaById.set(Number(ea.id), {
        name: String(ea.name ?? ""),
        fullPath: String(ea.full_path ?? ea.fullPath ?? ea.name ?? ""),
        kind: String(ea.account_kind ?? ea.accountKind ?? "expense"),
      });
    }
  }
  const resolveLegacy = (eaId: unknown, snapshot: unknown): number | null => {
    const ea = eaId != null && eaById.has(Number(eaId)) ? eaById.get(Number(eaId)) : null;
    const candidates = [ea?.name || "", ea?.fullPath || "", String(snapshot ?? "")].map((s) => s.trim()).filter(Boolean);
    for (const c of candidates) {
      const id = resolve(c);
      if (id != null) return id;
    }
    return null;
  };
  return rows.map((v) => {
    const hasOld = "expense_account_id" in v || "custody_account_id" in v || "expense_account_snapshot" in v || "custody_account_snapshot" in v;
    if (!hasOld) return v;
    const expId = resolveLegacy(v["expense_account_id"], v["expense_account_snapshot"]);
    const cusId = resolveLegacy(v["custody_account_id"], v["custody_account_snapshot"]);
    const main = expId ?? cusId;
    const snapshot = String(v["expense_account_snapshot"] ?? "") || String(v["custody_account_snapshot"] ?? "") || null;
    const out: Record<string, unknown> = { ...v };
    delete out["expense_account_id"];
    delete out["expense_account_snapshot"];
    delete out["custody_account_snapshot"];
    // حقول snake_case تُحول إلى camelCase عند استعمال Prisma مباشرة — الملفات الجديدة أصلاً camelCase:
    out["accountId"] = main ?? null;
    out["custodyAccountId"] = cusId ?? suspenseId;
    out["accountSnapshot"] = snapshot;
    if ("account_id" in out) delete out["account_id"];
    if ("account_snapshot" in out) delete out["account_snapshot"];
    if ("custody_account_id" in out) delete out["custody_account_id"];
    return out;
  });
}

/**
 * استعادة كاملة داخل معاملة واحدة:
 * 1) تحقق أن كل مفاتيح الملف جداول معروفة (مفاتيح الجداول المُسقطة تُقبل وتُهمل — Task 105)
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
    if (!known.has(key) && !DROPPED_LEGACY_TABLES.has(key)) {
      throw new Error(`جدول غير معروف في ملف النسخة: ${key}`);
    }
  }

  // Task 105 — خريطة الشجرة القديمة من نفس الملف (إن وُجدت) لتحويل حقول السندات
  const legacyTree = Array.isArray(data["expense_accounts"]) ? (data["expense_accounts"] as Record<string, unknown>[]) : [];
  const needLegacyVoucherTransform =
    legacyTree.length > 0 || (Array.isArray(data["vouchers"]) && (data["vouchers"] as Record<string, unknown>[]).some((r) => "expense_account_id" in r));
  let resolveForLegacy: ((name: string) => number | null) | null = null;
  let suspenseId = 0;
  if (needLegacyVoucherTransform) {
    const accounts = (await delegate(tx, "account").findMany({
      select: { id: true, code: true, name: true, allowPosting: true, isActive: true },
    })) as unknown as { id: number; code: string; name: string; allowPosting: boolean; isActive: boolean }[];
    suspenseId = accounts.find((a) => a.code === SUSPENSE_ACCOUNT.code)?.id ?? 0;
    if (suspenseId === 0) {
      const created = (await delegate(tx, "account").create({
        data: {
          code: SUSPENSE_ACCOUNT.code,
          name: SUSPENSE_ACCOUNT.name,
          type: SUSPENSE_ACCOUNT.type,
          nature: SUSPENSE_ACCOUNT.nature,
          isLeaf: true,
          allowPosting: true,
          isActive: true,
          isSystem: true,
          notes: SUSPENSE_ACCOUNT.notes,
          xbrlElement: "kw:SuspenseAccount",
        },
      })) as { id: number };
      suspenseId = created.id;
    }
    const candidates = accounts.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      allowPosting: a.allowPosting,
      isActive: a.isActive,
    }));
    resolveForLegacy = (name: string): number | null => {
      const raw = String(name || "").trim();
      if (!raw) return null;
      return resolveLegacyAccountName(raw, candidates);
    };
  }

  // 2) حذف بالترتيب العكسي
  for (let i = BACKUP_MODELS.length - 1; i >= 0; i--) {
    await delegate(tx, BACKUP_MODELS[i].model).deleteMany();
  }

  // 3) إنشاء بالترتيب الطوبولوجي
  const inserted: Record<string, number> = {};
  for (const m of BACKUP_MODELS) {
    let rows = Array.isArray(data[m.table]) ? (data[m.table] as Record<string, unknown>[]) : [];
    // Task 104: نسخ قديمة تحمل القيود بنصوص أطراف — تُحوّل لحالة النموذج الجديد بأسطره
    if (m.table === "journal_entries" && rows.some((r) => "debitAccount" in r)) {
      inserted[m.table] = await insertLegacyJournalRows(tx, rows as unknown as LegacyJournalRow[]);
      continue;
    }
    // Task 105: نسخ قديمة تحمل السندات بحقول الشجرة القديمة — تُحوّل للحقول الموحدة
    if (m.table === "vouchers" && needLegacyVoucherTransform && resolveForLegacy) {
      rows = transformLegacyVoucherRows(rows, legacyTree, resolveForLegacy, suspenseId);
    }
    inserted[m.table] = await insertRows(tx, m.model, m.table, rows);
  }
  for (const key of Object.keys(data)) {
    if (DROPPED_LEGACY_TABLES.has(key)) inserted[key] = 0; // الجدول المُسقط — أُهمل بعد استخدامه للحسم
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
