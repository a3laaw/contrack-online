import "server-only";
/**
 * قارئ ملفات SQLite القديمة وباني أوراق القالب — Task 86.
 * يفتح الملف المرفوع بـ better-sqlite3 (قراءة فقط، ملف مؤقت يُمسح فورًا)،
 * ويحوّل الجداول إلى «أوراق خام» بأوراق القالب الثماني حرفيًا ليعمل
 * parseImportSheets/executeImport القائمان بلا أي تعديل.
 *
 * قواعد التحويل الموثقة (من فحص قاعدة المكتبية الفعلية):
 *  - الإشراف: عقد نوعه is_supervision=1 (ربط بجدول contract_types) أو sup_months>0.
 *  - السندات: vtype=receipt ← سندات القبض · vtype=payment ← سندات الصرف ·
 *    غيرهما (transfer…) يُتخطى بتنبيه · الملغاة (cancelled) تُتخطى بتنبيه.
 *  - سند صرف بلا حساب مصروف (رسوم بنكية غالبًا) لا يمكن تمثيله بورقة الصرف
 *    ذات الحساب الإجباري — يُتخطى بتنبيه صريح.
 *  - عقد ملغى يُتخطى بتنبيه (أوراق الاستيراد لا تمثل الإلغاء) · نوع فارغ أو
 *    «غير محدد» يُستبدل بـ«بيانات قديمة» (يُنشأ نوعًا وقت التنفيذ) — منع
 *    الإدخال تحت «غير محدد» قاعدة المرحلة 6.
 *  - الروابط تُحلّ بالمعرفات: customer_id/contract_id/project_id/
 *    expense_account_id/expense_customer_id/subcontractor_id — وتُترك
 *    فارغة إن تعذر الجمع فيظهر السبب في الفحص.
 */

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";

import { cellStr, nameKey } from "./normalize";
import { entityHeaders, entitySheet, pickCol, LEGACY_COLUMN_CANDIDATES, JOIN_DERIVED_HEADERS } from "./legacy-shared";
import type { LegacyEntityKey, LegacyMapping } from "./legacy-shared";
import type { RawSheet } from "./parse-core";

const UNSPECIFIED = "غير محدد";
export const LEGACY_TYPE_FALLBACK = "بيانات قديمة";

type Row = Record<string, unknown>;

export interface LegacyReference {
  /** أنواع العقود من الملف (بلا «غير محدد») — تُنشأ الناقصة وقت التنفيذ */
  types: { name: string; isSupervision: boolean }[];
  /** شجرة حسابات المصروفات من الملف — تُنشأ الناقصة وقت التنفيذ (الآباء أولًا) */
  accounts: { name: string; fullPath: string; parentFullPath: string }[];
  /** أسماء المشاريع (لربط سندات الصرف) — تُنشأ الناقصة وقت التنفيذ */
  projects: string[];
}

export interface LegacyBuildResult {
  sheets: RawSheet[];
  notes: string[];
  reference: LegacyReference;
}

/** تشغيل دالة على قاعدة SQLite من بايتات ملف — ملف مؤقت في tmp يُمسح دائمًا */
async function withSqlite<T>(buffer: Buffer, fn: (db: Database.Database) => T): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctrk-legacy-"));
  const file = path.join(dir, "source.sqlite");
  await fs.writeFile(file, buffer);
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return fn(db);
  } finally {
    db.close();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function listTables(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

function readTable(db: Database.Database, table: string): Row[] {
  // أسماء الجداول تأتي من sqlite_master نفسها — لا إدخال خارجي
  return db.prepare(`SELECT * FROM "${table.replace(/"/g, "''")}"`).all() as Row[];
}

function columnsOf(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info("${table.replace(/"/g, "''")}")`).all() as { name: string }[];
  return rows.map((r) => r.name);
}

// ===== الفحص: قائمة الجداول + الأعمدة + عينات =====

export interface LegacyInspectResult {
  tables: { name: string; rows: number; columns: string[]; sample: string[][] }[];
}

export async function inspectLegacyDb(buffer: Buffer): Promise<LegacyInspectResult> {
  return withSqlite(buffer, (db) => {
    const tables: LegacyInspectResult["tables"] = [];
    for (const name of listTables(db)) {
      let rows = 0;
      let columns: string[] = [];
      try {
        const cnt = db.prepare(`SELECT COUNT(*) AS c FROM "${name.replace(/"/g, "''")}"`).get() as { c: number };
        rows = Number(cnt.c) || 0;
        columns = columnsOf(db, name);
      } catch {
        continue; // جدول افتراضي/تالف — تجاهل
      }
      let sample: string[][] = [];
      if (rows > 0) {
        const raw = db.prepare(`SELECT * FROM "${name.replace(/"/g, "''")}" LIMIT 2`).all() as Row[];
        sample = raw.map((r) => columns.slice(0, 8).map((c) => cellStr(r[c]).slice(0, 40)));
      }
      tables.push({ name, rows, columns, sample });
    }
    return { tables };
  });
}

// ===== البناء: أوراق القالب من الملف حسب الخريطة =====

interface JoinMaps {
  customersById: Map<number, string>;
  contractsById: Map<number, { customerId: number | null; title: string; customerName: string }>;
  projectsById: Map<number, string>;
  accountsById: Map<number, string>;
  subsById: Map<number, string>;
  finalTitles: Map<number, string>; // تعريق (عميل، تسمية) المكررة برقم العقد
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const truthy = (v: unknown): boolean => v === 1 || v === true || v === "1" || v === "true";
const intOrNull = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Math.trunc(num(v));

/** vtype المكتبية: receipt/payment (وتبقى transfer وغيرها تُتخطى) */
const isReceiptVtype = (v: string): boolean => nameKey(v).includes("rec") || nameKey(v).includes("قبض");
const isPaymentVtype = (v: string): boolean => nameKey(v).includes("pay") || nameKey(v).includes("صرف");

function buildJoinMaps(mapping: LegacyMapping, data: Map<string, Row[]>): JoinMaps {
  const customersById = new Map<number, string>();
  for (const r of data.get(mapping.customers.table || "") ?? []) {
    const id = intOrNull(r.id);
    const nm = cellStr(r.name);
    if (id && nm) customersById.set(id, nm);
  }
  // تعريق الأسماء المكررة: (عميل، تسمية) نفسها أكثر من مرة ⇒ لاحق برقم العقد
  // — التسمية النهائية تُستخدم في ورقة العقود وفي كل السندات/الباطن المرتبطة
  // عبر contract_id فيبقى الربط متطابقًا في الفحص والتنفيذ.
  const dupCounter = new Map<string, number>();
  const finalTitles = new Map<number, string>();
  for (const r of data.get(mapping.contracts.table || "") ?? []) {
    const id = intOrNull(r.id);
    if (!id) continue;
    if (cellStr(r.status) === "ملغى") continue;
    const customerId = intOrNull(r.customer_id);
    const customerName = (customerId && customersById.get(customerId)) || "";
    const base =
      cellStr(r.contract_name) || cellStr(r.description) || cellStr(r.contract_number) || "";
    const key = `${nameKey(customerName)}\u0000${nameKey(base)}`;
    const n = (dupCounter.get(key) ?? 0) + 1;
    dupCounter.set(key, n);
    const number = cellStr(r.contract_number);
    finalTitles.set(
      id,
      n > 1 ? (number ? `${base} · ${number}` : `${base} · ${n}`) : base
    );
  }
  const contractsById = new Map<number, { customerId: number | null; title: string; customerName: string }>();
  for (const r of data.get(mapping.contracts.table || "") ?? []) {
    const id = intOrNull(r.id);
    if (!id) continue;
    const customerId = intOrNull(r.customer_id);
    const title =
      finalTitles.get(id) ??
      (cellStr(r.contract_name) || cellStr(r.description) || cellStr(r.contract_number) || "");
    contractsById.set(id, { customerId, title, customerName: (customerId && customersById.get(customerId)) || "" });
  }
  const projectsById = new Map<number, string>();
  for (const r of data.get("projects") ?? []) {
    const id = intOrNull(r.id);
    const nm = cellStr(r.name);
    if (id && nm) projectsById.set(id, nm);
  }
  const accountsById = new Map<number, string>();
  for (const r of data.get("expense_accounts") ?? []) {
    const id = intOrNull(r.id);
    const nm = cellStr(r.full_path) || cellStr(r.name);
    if (id && nm) accountsById.set(id, nm);
  }
  const subsById = new Map<number, string>();
  for (const r of data.get("subcontractors") ?? []) {
    const id = intOrNull(r.id);
    const nm = cellStr(r.name);
    if (id && nm) subsById.set(id, nm);
  }
  return { customersById, contractsById, projectsById, accountsById, subsById, finalTitles };
}

/** قراءة عمود مصدر لصف — بالاسم من الخريطة أو اكتشاف تلقائي إن فُضي */
function colValue(row: Row, columns: Record<string, string>, header: string, key: LegacyEntityKey): unknown {
  const chosen = columns[header] || pickCol(Object.keys(row), LEGACY_COLUMN_CANDIDATES[key][header] ?? [header]);
  if (!chosen) return "";
  return row[chosen];
}

export async function buildLegacySheets(buffer: Buffer, mapping: LegacyMapping): Promise<LegacyBuildResult> {
  return withSqlite(buffer, (db) => {
    const notes: string[] = [];
    const allTables = listTables(db);

    // الجداول المطلوبة: المخططة + المرجعية
    const wanted = new Set<string>();
    for (const key of Object.keys(mapping) as LegacyEntityKey[]) {
      const t = mapping[key]?.table;
      if (t) wanted.add(t);
    }
    for (const ref of ["contract_types", "expense_accounts", "projects", "subcontractors"]) {
      if (allTables.includes(ref)) wanted.add(ref);
    }
    const data = new Map<string, Row[]>();
    for (const t of wanted) {
      try {
        data.set(t, readTable(db, t));
      } catch {
        data.set(t, []);
      }
    }

    const joins = buildJoinMaps(mapping, data);
    const sheetFor = (key: LegacyEntityKey, rows: unknown[][]): RawSheet => ({
      name: entitySheet(key),
      rows: [entityHeaders(key), ...rows],
    });
    const sheets: RawSheet[] = [];

    // ===== 1) العملاء =====
    const customersRows: unknown[][] = [];
    let skippedEmptyCustomers = 0;
    for (const r of data.get(mapping.customers.table || "") ?? []) {
      const name = cellStr(colValue(r, mapping.customers.columns, "اسم العميل *", "customers"));
      if (!name) {
        skippedEmptyCustomers++;
        continue;
      }
      customersRows.push([
        name,
        cellStr(colValue(r, mapping.customers.columns, "رقم الهاتف *", "customers")),
        cellStr(colValue(r, mapping.customers.columns, "العنوان", "customers")),
        cellStr(colValue(r, mapping.customers.columns, "البريد الإلكتروني", "customers")),
        cellStr(colValue(r, mapping.customers.columns, "ملاحظات", "customers")),
      ]);
    }
    if (skippedEmptyCustomers) notes.push(`صفوف عملاء بلا اسم تُمتيت: ${skippedEmptyCustomers}.`);
    if (mapping.customers.table) sheets.push(sheetFor("customers", customersRows));

    // ===== 2+3) العقود وعقود الإشراف من الجدول نفسه =====
    const contractsRows: unknown[][] = [];
    const supRows: unknown[][] = [];
    let skippedCancelledContracts = 0;
    let fallbackTyped = 0;
    for (const r of data.get(mapping.contracts.table || "") ?? []) {
      const statusRaw = cellStr(colValue(r, mapping.contracts.columns, "الحالة", "contracts")) || cellStr(r.status);
      if (statusRaw === "ملغى") {
        skippedCancelledContracts++;
        continue;
      }
      const customerId = intOrNull(r.customer_id);
      const customerName = (customerId && joins.customersById.get(customerId)) || cellStr(r.customer_name);
      const rowId = intOrNull(r.id);
      const title =
        (rowId && joins.finalTitles.get(rowId)) ||
        cellStr(colValue(r, mapping.contracts.columns, "اسم العقد / وصفه", "contracts")) ||
        cellStr(r.description) ||
        cellStr(r.contract_number);
      const typeRaw = cellStr(colValue(r, mapping.contracts.columns, "نوع العقد *", "contracts"));
      const supMonths = Math.trunc(num(r.sup_months));
      const supMonthly = num(r.sup_monthly);
      // الإشراف = وجود شروط إشراف فعلية (مدة/قيمة شهر) — عقد بنوع إشراف بلا
      // شروط (مقطوع كاملًا في المكتبية) يُستورد عقدًا عاديًا بقيمته.
      const isSup = supMonths > 0 || supMonthly > 0;

      if (isSup) {
        // تاريخ التعهد: المصدر الصريح ← تاريخ البداية ← تاريخ العقد (المكتبية بها فراغات)
        const supStart =
          cellStr(r.sup_start_date) ||
          cellStr(r.start_date) ||
          cellStr(colValue(r, mapping.sup_contracts.columns, "تاريخ تعهد الإشراف *", "sup_contracts")) ||
          cellStr(colValue(r, mapping.contracts.columns, "تاريخ العقد *", "contracts"));
        supRows.push([
          customerName,
          title,
          supStart,
          supMonths,
          supMonthly || num(colValue(r, mapping.sup_contracts.columns, "قيمة الشهر *", "sup_contracts")),
          cellStr(colValue(r, mapping.contracts.columns, "تاريخ العقد *", "contracts")),
          statusRaw,
        ]);
      } else {
        let type = typeRaw;
        if (!type || type === UNSPECIFIED) {
          type = LEGACY_TYPE_FALLBACK; // يُنشأ وقت التنفيذ — منع الإدخال تحت «غير محدد»
          fallbackTyped++;
        }
        contractsRows.push([
          customerName,
          title,
          colValue(r, mapping.contracts.columns, "قيمة العقد *", "contracts"),
          colValue(r, mapping.contracts.columns, "تاريخ العقد *", "contracts"),
          cellStr(colValue(r, mapping.contracts.columns, "تاريخ البداية", "contracts")) || cellStr(r.start_date),
          cellStr(colValue(r, mapping.contracts.columns, "تاريخ النهاية", "contracts")) || cellStr(r.end_date),
          statusRaw,
          type,
        ]);
      }
    }
    if (skippedCancelledContracts)
      notes.push(`عقود ملغاة تُمتيت (أوراق الاستيراد لا تمثل الإلغاء): ${skippedCancelledContracts}.`);
    if (fallbackTyped)
      notes.push(`عقود بنوع فارغ أو «غير محدد» ستُسجّل بنوع «${LEGACY_TYPE_FALLBACK}»: ${fallbackTyped}.`);
    if (mapping.contracts.table) sheets.push(sheetFor("contracts", contractsRows));
    if (mapping.sup_contracts.table) sheets.push(sheetFor("sup_contracts", supRows));

    // ===== 4) مقاولو الباطن =====
    const subsRows: unknown[][] = [];
    for (const r of data.get(mapping.subs.table || "") ?? []) {
      const name = cellStr(colValue(r, mapping.subs.columns, "اسم المقاول *", "subs"));
      if (!name) continue;
      subsRows.push([
        name,
        cellStr(colValue(r, mapping.subs.columns, "رقم الهاتف", "subs")),
        cellStr(colValue(r, mapping.subs.columns, "نوع النشاط", "subs")),
        cellStr(colValue(r, mapping.subs.columns, "ملاحظات", "subs")),
      ]);
    }
    if (mapping.subs.table) sheets.push(sheetFor("subs", subsRows));

    // ===== فحص مسبق لجدول السندات: الملغاة والأنواع الأخرى تُعدّ مرة واحدة =====
    const voucherRows = data.get(mapping.receipts.table || "") ?? [];
    let skippedCancelledVouchers = 0;
    let skippedOtherVtype = 0;
    for (const r of voucherRows) {
      if (truthy(r.cancelled)) {
        skippedCancelledVouchers++;
        continue;
      }
      const vtype = cellStr(r.vtype);
      if (!isReceiptVtype(vtype) && !isPaymentVtype(vtype)) skippedOtherVtype++;
    }

    // ===== 5) سندات القبض =====
    const receiptsRows: unknown[][] = [];
    for (const r of voucherRows) {
      if (truthy(r.cancelled)) continue;
      if (!isReceiptVtype(cellStr(r.vtype))) continue;
      const partyId = intOrNull(r.party_id);
      const customerName =
        (partyId && joins.customersById.get(partyId)) ||
        cellStr(colValue(r, mapping.receipts.columns, "اسم العميل *", "receipts"));
      const contractId = intOrNull(r.contract_id);
      const contractTitle = (contractId && joins.contractsById.get(contractId)?.title) || "";
      receiptsRows.push([
        cellStr(colValue(r, mapping.receipts.columns, "رقم السند القديم", "receipts")) || cellStr(r.voucher_number),
        customerName,
        contractTitle,
        colValue(r, mapping.receipts.columns, "المبلغ *", "receipts"),
        colValue(r, mapping.receipts.columns, "التاريخ *", "receipts"),
        cellStr(colValue(r, mapping.receipts.columns, "البيان", "receipts")) || cellStr(r.description),
        cellStr(colValue(r, mapping.receipts.columns, "طريقة الدفع", "receipts")) || cellStr(r.method),
        cellStr(colValue(r, mapping.receipts.columns, "ملاحظات", "receipts")) || cellStr(r.notes),
      ]);
    }
    if (mapping.receipts.table) sheets.push(sheetFor("receipts", receiptsRows));

    // ===== 6) عقود الباطن =====
    const subContractsRows: unknown[][] = [];
    let skippedCancelledSubContracts = 0;
    for (const r of data.get(mapping.sub_contracts.table || "") ?? []) {
      if (truthy(r.cancelled)) {
        skippedCancelledSubContracts++;
        continue;
      }
      const subId = intOrNull(r.subcontractor_id);
      const contractId = intOrNull(r.contract_id);
      const con = (contractId && joins.contractsById.get(contractId)) || undefined;
      subContractsRows.push([
        (subId && joins.subsById.get(subId)) || "",
        con?.customerName ?? "",
        con?.title ?? "",
        colValue(r, mapping.sub_contracts.columns, "قيمة عقد الباطن *", "sub_contracts"),
        cellStr(colValue(r, mapping.sub_contracts.columns, "تاريخ البداية", "sub_contracts")) || cellStr(r.start_date),
        cellStr(colValue(r, mapping.sub_contracts.columns, "تاريخ النهاية", "sub_contracts")) || cellStr(r.end_date),
        cellStr(colValue(r, mapping.sub_contracts.columns, "الوصف", "sub_contracts")) || cellStr(r.description),
      ]);
    }
    if (skippedCancelledSubContracts) notes.push(`عقود باطن ملغاة تُمتيت: ${skippedCancelledSubContracts}.`);
    if (mapping.sub_contracts.table) sheets.push(sheetFor("sub_contracts", subContractsRows));

    // ===== 7) سندات الصرف =====
    const expensesRows: unknown[][] = [];
    let skippedNoAccount = 0;
    for (const r of voucherRows) {
      if (truthy(r.cancelled)) continue;
      if (!isPaymentVtype(cellStr(r.vtype))) continue;
      const accountId = intOrNull(r.expense_account_id);
      const account = (accountId && joins.accountsById.get(accountId)) || "";
      if (!account) {
        skippedNoAccount++; // رسوم بنكية/عهد — بلا تمثيل في ورقة الصرف الإجبارية
        continue;
      }
      const contractId = intOrNull(r.contract_id);
      const con = (contractId && joins.contractsById.get(contractId)) || undefined;
      const expenseCustomerId = intOrNull(r.expense_customer_id);
      const projectId = intOrNull(r.project_id);
      expensesRows.push([
        cellStr(colValue(r, mapping.expenses.columns, "رقم السند القديم", "expenses")) || cellStr(r.voucher_number),
        account,
        cellStr(colValue(r, mapping.expenses.columns, "اسم المستفيد (مقاول/مورد) *", "expenses")) || cellStr(r.party),
        (expenseCustomerId && joins.customersById.get(expenseCustomerId)) || con?.customerName || "",
        (projectId && joins.projectsById.get(projectId)) || "",
        con?.title ?? "",
        colValue(r, mapping.expenses.columns, "المبلغ *", "expenses"),
        colValue(r, mapping.expenses.columns, "التاريخ *", "expenses"),
        cellStr(colValue(r, mapping.expenses.columns, "البيان", "expenses")) || cellStr(r.description),
        cellStr(colValue(r, mapping.expenses.columns, "طريقة الدفع", "expenses")) || cellStr(r.method),
        cellStr(colValue(r, mapping.expenses.columns, "ملاحظات", "expenses")) || cellStr(r.notes),
      ]);
    }
    if (skippedNoAccount)
      notes.push(`سندات صرف بلا حساب مصروف (رسوم بنكية غالبًا) تُمتيت: ${skippedNoAccount}.`);
    if (mapping.expenses.table) sheets.push(sheetFor("expenses", expensesRows));

    if (skippedCancelledVouchers) notes.push(`سندات ملغاة تُمتيت: ${skippedCancelledVouchers}.`);
    if (skippedOtherVtype)
      notes.push(`سندات بنوع غير قبض/صرف (مثل التحويل بين الحسابات) تُمتيت: ${skippedOtherVtype}.`);

    // ===== المرجعيات (تُنشأ الناقصة منها في الشركة المستهدفة وقت التنفيذ) =====
    const types: { name: string; isSupervision: boolean }[] = [];
    const seenTypes = new Set<string>();
    for (const r of data.get("contract_types") ?? []) {
      const name = cellStr(r.name).trim();
      if (!name || name === UNSPECIFIED || seenTypes.has(nameKey(name))) continue;
      seenTypes.add(nameKey(name));
      types.push({ name, isSupervision: truthy(r.is_supervision) });
    }
    if (fallbackTyped && !seenTypes.has(nameKey(LEGACY_TYPE_FALLBACK))) {
      types.push({ name: LEGACY_TYPE_FALLBACK, isSupervision: false });
    }
    const accounts: { name: string; fullPath: string; parentFullPath: string }[] = [];
    const seenAccounts = new Set<string>();
    // خريطة id ← المسار الكامل لإعادة بناء الأب من parent_id (أسماء قد تحوي «/»)
    const srcAccountPathById = new Map<number, string>();
    for (const r of data.get("expense_accounts") ?? []) {
      const id = intOrNull(r.id);
      const fp = cellStr(r.full_path).trim() || cellStr(r.name).trim();
      if (id && fp) srcAccountPathById.set(id, fp);
    }
    for (const r of data.get("expense_accounts") ?? []) {
      const name = cellStr(r.name).trim();
      const fullPath = cellStr(r.full_path).trim() || name;
      if (!name || seenAccounts.has(nameKey(fullPath))) continue;
      seenAccounts.add(nameKey(fullPath));
      const parentId = intOrNull(r.parent_id);
      const parentFullPath = (parentId && srcAccountPathById.get(parentId)) || "";
      accounts.push({ name, fullPath, parentFullPath });
    }
    const projects: string[] = [];
    const seenProjects = new Set<string>();
    for (const r of data.get("projects") ?? []) {
      const name = cellStr(r.name).trim();
      if (!name || seenProjects.has(nameKey(name))) continue;
      seenProjects.add(nameKey(name));
      projects.push(name);
    }

    // أعمدة بلا مصدر — ملاحظة تشخيصية (ترويسات الروابط المشتقة مستثناة)
    for (const key of Object.keys(mapping) as LegacyEntityKey[]) {
      const t = mapping[key]?.table;
      if (!t) continue;
      const cols = columnsOf(db, t);
      const derived = new Set(JOIN_DERIVED_HEADERS[key]);
      const missing = entityHeaders(key).filter((h) => {
        if (derived.has(h)) return false;
        const chosen = mapping[key].columns[h];
        return !(chosen && cols.includes(chosen)) && !pickCol(cols, LEGACY_COLUMN_CANDIDATES[key][h] ?? [h]);
      });
      if (missing.length) {
        notes.push(`ورقة «${entitySheet(key)}»: أعمدة بلا مصدر (${missing.join("، ")}) — ستُترك فارغة.`);
      }
    }

    return { sheets, notes, reference: { types, accounts, projects } };
  });
}
