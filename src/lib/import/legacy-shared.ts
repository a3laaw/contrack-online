/**
 * النواة المشتركة لمستورد الملفات القديمة (SQLite / نص جدولي) — Task 86.
 * نقية تمامًا (بلا خادم ولا React) لتُستخدم في واجهة المعالج (إعادة الربط
 * عند تغيير الجداول) وفي مسارات الخادم معًا.
 *
 * الفكرة العامة: تحويل المصدر (جداول SQLite أو نص ملصوق) إلى «أوراق خام»
 * بنفس أوراق قالب Excel الثماني حرفيًا، ثم يعمل خط الأنابيب القائم كما هو:
 * parseImportSheets (فحص ومعاينة) → executeImport (تنفيذ بترتيب التبعية).
 *
 * تنفيذ الاستيراد يجري في «شركة الجلسة الحالية» (حارس المسار يتحقق من
 * تطابق الشركة المستهدفة مع الجلسة) — فيبقى الترقيم والسندات والتدقيق
 * محصورة بشركة الهدف تلقائيًا دون أي تعديل في خط الأنابيب.
 */

import { sheetSpec } from "./sheets";
import { nameKey } from "./normalize";
import type { RawSheet } from "./parse-core";

export type { RawSheet };

// ===== الأنواع =====

/** معلومات جدول من ملف SQLite كما فُحص */
export interface LegacyTableInfo {
  name: string;
  rows: number;
  columns: string[];
}

/** خريطة كيان: الجدول المصدر + عمود كل ترويسة ("" = اكتشاف تلقائي) */
export interface LegacyEntityMap {
  table: string | null;
  columns: Record<string, string>;
}

export type LegacyEntityKey =
  | "customers"
  | "contracts"
  | "sup_contracts"
  | "subs"
  | "receipts"
  | "sub_contracts"
  | "expenses";

export type LegacyMapping = Record<LegacyEntityKey, LegacyEntityMap>;

/** الكيانات السبعة وأوراقها — الترتيب هو ترتيب التبعية في التنفيذ */
export const LEGACY_ENTITIES: { key: LegacyEntityKey; sheet: string; label: string }[] = [
  { key: "customers", sheet: "العملاء", label: "العملاء" },
  { key: "contracts", sheet: "العقود", label: "العقود (غير الإشرافية)" },
  { key: "sup_contracts", sheet: "عقود الإشراف", label: "عقود الإشراف الهندسي" },
  { key: "subs", sheet: "مقاولو الباطن", label: "مقاولو الباطن" },
  { key: "receipts", sheet: "سندات القبض", label: "سندات القبض" },
  { key: "sub_contracts", sheet: "عقود الباطن", label: "عقود الباطن" },
  { key: "expenses", sheet: "سندات الصرف", label: "سندات الصرف" },
];

export function entitySheet(key: LegacyEntityKey): string {
  return LEGACY_ENTITIES.find((e) => e.key === key)?.sheet ?? "";
}

/** ترويسات ورقة الكيان الحرفية (كما في القالب — تُكتب صفًا أول في الورقة المولدة) */
export function entityHeaders(key: LegacyEntityKey): string[] {
  const spec = sheetSpec(entitySheet(key));
  return spec ? spec.columns.map(([h]) => h) : [];
}

// ===== مرشّحات اكتشاف الأعمدة (المصدر الإنجليزي للمكتبية + مرادفات) =====

/** لكل كيان: لكل ترويسة ورقة ← أسماء أعمدة مصدر مرشحة (بالأولوية) */
export const LEGACY_COLUMN_CANDIDATES: Record<LegacyEntityKey, Record<string, string[]>> = {
  customers: {
    "اسم العميل *": ["name", "customer_name", "customer"],
    "رقم الهاتف *": ["phone", "mobile", "tel", "telephone"],
    "العنوان": ["address", "addr"],
    "البريد الإلكتروني": ["email", "mail"],
    "ملاحظات": ["notes", "note", "remarks"],
  },
  contracts: {
    "اسم العميل *": ["customer_name", "customer"],
    "اسم العقد / وصفه": ["contract_name", "title", "name", "description"],
    "قيمة العقد *": ["amount", "value", "total", "contract_amount"],
    "تاريخ العقد *": ["contract_date", "date"],
    "تاريخ البداية": ["start_date", "from_date"],
    "تاريخ النهاية": ["end_date", "to_date"],
    "الحالة": ["status", "state"],
    "نوع العقد *": ["contract_type", "type"],
  },
  sup_contracts: {
    "اسم العميل *": ["customer_name", "customer"],
    "اسم العقد / وصفه": ["contract_name", "title", "name", "description"],
    "تاريخ تعهد الإشراف *": ["sup_start_date", "sup_start"],
    "المدة بالأشهر *": ["sup_months", "months"],
    "قيمة الشهر *": ["sup_monthly", "monthly"],
    "تاريخ العقد": ["contract_date", "date"],
    "الحالة": ["status", "state"],
  },
  subs: {
    "اسم المقاول *": ["name", "sub_name"],
    "رقم الهاتف": ["phone", "mobile", "tel"],
    "نوع النشاط": ["activity", "type"],
    "ملاحظات": ["notes", "note"],
  },
  receipts: {
    "رقم السند القديم": ["voucher_number", "number", "code"],
    "اسم العميل *": ["party", "party_name", "customer_name"],
    "اسم العقد / وصفه": ["contract_name", "contract_title", "description"],
    "المبلغ *": ["amount", "value"],
    "التاريخ *": ["vdate", "date"],
    "البيان": ["description", "descr", "statement"],
    "طريقة الدفع": ["method", "pay_method", "payment_method"],
    "ملاحظات": ["notes", "note"],
  },
  sub_contracts: {
    "اسم المقاول *": ["sub_name", "subcontractor_name"],
    "اسم العميل *": ["customer_name", "customer"],
    "اسم العقد الرئيسي *": ["contract_name", "contract_title"],
    "قيمة عقد الباطن *": ["amount", "value"],
    "تاريخ البداية": ["start_date", "from_date"],
    "تاريخ النهاية": ["end_date", "to_date"],
    "الوصف": ["description", "descr"],
  },
  expenses: {
    "رقم السند القديم": ["voucher_number", "number", "code"],
    "حساب المصروف *": ["expense_account_snapshot", "account", "expense_account"],
    "اسم المستفيد (مقاول/مورد) *": ["party", "party_name", "beneficiary"],
    "اسم العميل": ["customer_name", "customer", "expense_customer"],
    "اسم المشروع": ["project_name", "project"],
    "اسم العقد الرئيسي": ["contract_name", "contract_title"],
    "المبلغ *": ["amount", "value"],
    "التاريخ *": ["vdate", "date"],
    "البيان": ["description", "descr"],
    "طريقة الدفع": ["method", "pay_method"],
    "ملاحظات": ["notes", "note"],
  },
};

/** أول عمود مصدر يطابق أحد المرشحين (تطابق تام ثم احتواء — مع استبعاد أعمدة المعرّفات) */
export function pickCol(columns: string[], candidates: string[]): string {
  const lower = columns.map((c) => c.toLowerCase());
  for (const cand of candidates) {
    const i = lower.indexOf(cand.toLowerCase());
    if (i >= 0) return columns[i];
  }
  for (const cand of candidates) {
    const ci = cand.toLowerCase();
    const i = lower.findIndex((c) => c.includes(ci) && !(c.endsWith("_id") || c === "id" || c.endsWith("_at")));
    if (i >= 0) return columns[i];
  }
  return "";
}

/** اكتشاف أعمدة كيان من جدول معين (بلا تحديد جدول) */
export function autoColumnsForTable(table: LegacyTableInfo | null, key: LegacyEntityKey): Record<string, string> {
  const out: Record<string, string> = {};
  const headers = entityHeaders(key);
  for (const h of headers) out[h] = "";
  if (!table) return out;
  const candidates = LEGACY_COLUMN_CANDIDATES[key];
  for (const h of headers) {
    out[h] = pickCol(table.columns, candidates[h] ?? [h]);
  }
  return out;
}

/** ترويسات تأتي من روابط المعرفات تلقائيًا (لا تحتاج عمود مصدر — تُستبعد من ملاحظات النقص) */
export const JOIN_DERIVED_HEADERS: Record<LegacyEntityKey, string[]> = {
  customers: [],
  contracts: ["اسم العميل *"],
  sup_contracts: ["اسم العميل *"],
  subs: [],
  receipts: ["اسم العميل *", "اسم العقد / وصفه"],
  sub_contracts: ["اسم المقاول *", "اسم العميل *", "اسم العقد الرئيسي *"],
  expenses: ["اسم العميل", "اسم المشروع", "اسم العقد الرئيسي"],
};

function findTable(
  tables: LegacyTableInfo[],
  exact: string[],
  contains: string[],
  exclude?: RegExp
): LegacyTableInfo | null {
  for (const e of exact) {
    const t = tables.find((x) => x.name.toLowerCase() === e);
    if (t) return t;
  }
  let best: LegacyTableInfo | null = null;
  for (const t of tables) {
    const n = t.name.toLowerCase();
    if (exclude && exclude.test(n)) continue;
    if (contains.some((c) => n.includes(c))) {
      if (!best || t.rows > best.rows) best = t;
    }
  }
  return best;
}

/** الاكتشاف التلقائي الكامل: جدول كل كيان + أعمدته */
export function autoDetectMapping(tables: LegacyTableInfo[]): LegacyMapping {
  const contractsTable = findTable(
    tables,
    ["contracts", "contract"],
    ["contract"],
    /(type|stage|component|group|template|event|attachment|scope|log|items|sub)/
  );
  const customersTable = findTable(tables, ["customers", "customer"], ["customer"], /(voucher|contract|type|user)/);
  const subsTable = findTable(tables, ["subcontractors", "subcontractor"], ["subcontractor"]);
  const subContractsTable = findTable(tables, ["sub_contracts", "subcontracts"], ["sub_contract"], /item/);
  const vouchersTable = findTable(tables, ["vouchers", "voucher"], ["voucher"], /(link|alloc)/);

  const build = (key: LegacyEntityKey, table: LegacyTableInfo | null): LegacyEntityMap => ({
    table: table?.name ?? null,
    columns: autoColumnsForTable(table, key),
  });

  return {
    customers: build("customers", customersTable),
    contracts: build("contracts", contractsTable),
    // الإشراف يُقسم من جدول العقود نفسه (is_supervision / sup_months)
    sup_contracts: build("sup_contracts", contractsTable),
    subs: build("subs", subsTable),
    receipts: build("receipts", vouchersTable),
    sub_contracts: build("sub_contracts", subContractsTable),
    expenses: build("expenses", vouchersTable),
  };
}

// ===== النص الجدولي الملصوق =====

export interface TextSheetResult {
  sheet: RawSheet;
  info: {
    delimiter: string;
    matched: number; // ترويسات طُوبقت بالاسم
    positional: boolean; // هل اللجوء للمواقع؟
    unmatched: string[]; // ترويسات المصدر غير المطوبة
    rows: number;
  };
}

function normalizeHeader(h: string): string {
  return nameKey(String(h).replace(/\*/g, "").replace(/[«»"]/g, ""));
}

/**
 * تحويل نص جدولي (TSV/CSV بصف ترويسة) إلى ورقة خام بأوراق القالب:
 * تطابق الترويسات بالاسم (مرن للهمزات والنجوم)؛ فإن لم يطابق شيء والعدد
 * مساوٍ لعدد أعمدة الورقة جُوزئ بالموقع. يُعاد دائمًا بصف ترويسة الورقة
 * الحرفي حتى يعمل المحلل القائم بلا تغيير.
 */
export function buildTextSheet(text: string, sheetName: string): TextSheetResult | { error: string } {
  const spec = sheetSpec(sheetName);
  if (!spec) return { error: "ورقة غير معروفة." };
  const targetHeaders = spec.columns.map(([h]) => h);

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) {
    return { error: "النص أقصر من صفّين (ترويسة + بيانات على الأقل)." };
  }

  // كشف الفاصل: الأكثر حضورًا في سطر الترويسة — تاب ثم | ثم ؛ ثم ,
  const header = lines[0];
  const delimiters = ["\t", "|", ";", ","];
  let delimiter = "\t";
  let bestCount = -1;
  for (const d of delimiters) {
    const c = header.split(d).length - 1;
    if (c > bestCount) {
      bestCount = c;
      delimiter = d;
    }
  }
  if (bestCount === 0) return { error: "لم يُكتشف فاصل أعمدة — الصق الجدول من Excel/Notepad بأعمدة منفصلة (Tab أو فاصلة)." };

  const splitLine = (line: string): string[] => {
    // استهلال الفاصلة المحاطة باقتباس لملفات CSV
    if (delimiter === ",") {
      const cells: string[] = [];
      let cur = "";
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQ && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else inQ = !inQ;
        } else if (ch === delimiter && !inQ) {
          cells.push(cur);
          cur = "";
        } else cur += ch;
      }
      cells.push(cur);
      return cells.map((c) => c.trim());
    }
    return line.split(delimiter).map((c) => c.trim());
  };

  const srcHeaders = splitLine(header);
  const targetNorm = targetHeaders.map(normalizeHeader);
  const srcNorm = srcHeaders.map(normalizeHeader);

  // مطابقة بالاسم
  const colIndex: (number | -1)[] = targetNorm.map((t) => {
    const i = srcNorm.indexOf(t);
    return i >= 0 ? i : -1;
  });
  let matched = colIndex.filter((i) => i >= 0).length;
  let positional = false;

  // لم يطابق شيء والعدد مساوٍ ⇒ توزيع بالموقع (الأشيع من نسخ Excel)
  if (matched === 0 && srcHeaders.length === targetHeaders.length) {
    for (let i = 0; i < targetHeaders.length; i++) colIndex[i] = i;
    matched = targetHeaders.length;
    positional = true;
  }

  const unmatched = srcHeaders.filter((h, i) => !targetNorm.includes(srcNorm[i]) && h.trim() !== "");
  if (matched === 0) {
    return {
      error:
        `لم تُطابق أي ترويسة بترويسات ورقة «${sheetName}» — الترويسات المطلوبة: ` +
        targetHeaders.join(" · "),
    };
  }

  const rows: unknown[][] = [[...targetHeaders]];
  let count = 0;
  for (let li = 1; li < lines.length; li++) {
    const cells = splitLine(lines[li]);
    if (!cells.some((c) => c !== "")) continue;
    const row: unknown[] = targetHeaders.map((_, ti) => {
      const si = colIndex[ti];
      return si >= 0 ? (cells[si] ?? "") : "";
    });
    rows.push(row);
    count++;
  }

  return {
    sheet: { name: sheetName, rows },
    info: {
      delimiter: delimiter === "\t" ? "Tab" : delimiter,
      matched,
      positional,
      unmatched,
      rows: count,
    },
  };
}
