/**
 * المحلل النقي لملف الاستيراد — مرآة حرفية لـ import_service.parse_excel (:417-927).
 * التحقق صف بصف مع تجميع الأخطاء برقم الصف والسبب، والمعاينة قبل التنفيذ،
 * والأوراق الغائبة تُتخطى بتنبيه لا بخطأ. نقية (بلا db) — سياق القاعدة يُحقن
 * عبر ImportDbContext لتُختبر على حافظة صفوف صالحة/فاسدة دون لمس قاعدة.
 *
 * بنية الصف: RawSheet.rows[0] = صف العناوين (سطر 1 في إكسل)، وصف المثال هو
 * أول صف بيانات (سطر 2) ويُتجاهل إن طابق المثال أو حمل علامة «مثال».
 */

import {
  cellAmount,
  cellDate,
  cellStr,
  floatRepr,
  fmt3,
  isValidDate,
  nameKey,
  normalizePayMethod,
  normalizeStatus,
  typeKey,
} from "./normalize";
import { IMPORT_EXAMPLE_MARKER, sheetSpec } from "./sheets";

/** ورقة خام كما قُرئت من الملف (ExcelJS): الصف الأول عناوين */
export interface RawSheet {
  name: string;
  rows: unknown[][];
}

/** خطأ/تنبيه منظم — النص الحرفي يُركب بنمط المكتبي «الورقة سطر n: الرسالة»
 *  (raw = النص مركّب حرفيًا في الرسالة نفسها كما في المكتبي — لا بادئة) */
export interface ImportIssue {
  sheet: string;
  line: number; // 0 = رسالة ورقة عامة (بلا سطر)
  message: string;
  raw?: boolean;
}

export type ContractKey = [string, string]; // (اسم العميل، اسم/وصف العقد)

export interface ParsedCustomer {
  line: number;
  name: string;
  phone: string;
  address: string;
  email: string;
  notes: string;
}

export interface ParsedContract {
  line: number;
  customer_name: string;
  title: string;
  amount: number;
  contract_date: string;
  start_date: string;
  end_date: string;
  status: string;
  contract_type: string;
}

export interface ParsedSupContract {
  line: number;
  customer_name: string;
  title: string;
  sup_start: string;
  months: number;
  monthly: number;
  amount: number;
  contract_date: string;
  status: string;
}

export interface ParsedSub {
  line: number;
  name: string;
  phone: string;
  activity: string;
  notes: string;
}

export interface ParsedPayment {
  line: number;
  sheet: string;
  customer_name: string;
  contract_key: ContractKey;
  amount: number;
  date: string;
  description: string;
  method: string;
  notes: string;
  old_number: string;
}

export interface ParsedSubContract {
  line: number;
  sub_name: string;
  contract_key: ContractKey;
  amount: number;
  start_date: string;
  end_date: string;
  description: string;
}

export interface ParsedExpense {
  line: number;
  skipExisting?: boolean;
  old_number: string;
  party_name: string;
  is_sub: boolean;
  contract_key: ContractKey | null;
  expense_customer_name: string;
  project_id: number | null;
  expense_account_id: number;
  amount: number;
  date: string;
  description: string;
  method: string;
  notes: string;
}

export interface ImportData {
  customers: ParsedCustomer[];
  contracts: ParsedContract[];
  sup_contracts: ParsedSupContract[];
  subs: ParsedSub[];
  payments: ParsedPayment[];
  sub_contracts: ParsedSubContract[];
  expenses: ParsedExpense[];
}

export interface ImportDbContext {
  /** العملاء الموجودون مسبقًا: nameKey ← الاسم الرسمي (يسمح بربط عقود بعملاء قائمين) */
  existingCustomerAliases: Record<string, string>;
  /** عقود قائمة: (اسم العميل، التسمية) ← القيمة — التسميات: الاسم/الوصف/الرقم، بلا «ملغى» */
  existingContracts: { customerName: string; label: string; amount: number }[];
  /** أنواع العقود المعتمدة: typeKey ← الاسم الرسمي (بلا «غير محدد») */
  knownContractTypes: Record<string, string>;
  /** حسابات المصروفات: nameKey(fullPath أو name) ← المعرف */
  expenseAccounts: Record<string, number>;
  /** أرقام السندات الموجودة بالقاعدة — القبض: كل الأنواع (:666-669) والصرف: payment فقط (:802-807) */
  existingReceiptNumbers: string[];
  existingPaymentNumbers: string[];
  /** المشاريع: nameKey ← المعرف */
  projects: Record<string, number>;
  /** أسماء مقاولي الباطن الموجودين (نص خام) */
  existingSubNames: string[];
}

export interface ImportPreviewRow {
  line: number;
  cells: Record<string, string>;
}

export interface ParseResult {
  data: ImportData;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  counts: {
    customers: number;
    contracts: number;
    subs: number;
    payments: number;
    sup_contracts: number;
    sub_contracts: number;
    expenses: number;
  };
  /** الأوراق الحاضرة في الملف من الأوراق الثماني */
  sheetsPresent: string[];
  /** معاينة أول 5 صفوف محلولة لكل ورقة حاضرة */
  preview: Record<string, ImportPreviewRow[]>;
}

/** النص الحرفي كما يعرضه المكتبي: «الورقة سطر n: الرسالة» — والحروف المركّبة مسبقًا كما هي */
export function issueText(issue: ImportIssue): string {
  if (issue.raw) return issue.message;
  return issue.line > 0
    ? `${issue.sheet} سطر ${issue.line}: ${issue.message}`
    : `${issue.sheet}: ${issue.message}`;
}

const CONTRACT_FALLBACK = (amount: number) => `عقد بقيمة ${floatRepr(amount)}`;
const SUP_FALLBACK = (monthly: number, months: number) => `إشراف ${floatRepr(monthly)}x${months}`;

export function parseImportSheets(rawSheets: RawSheet[], ctx: ImportDbContext): ParseResult {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const data: ImportData = {
    customers: [],
    contracts: [],
    sup_contracts: [],
    subs: [],
    payments: [],
    sub_contracts: [],
    expenses: [],
  };
  const sheetsPresent: string[] = [];
  const preview: Record<string, ImportPreviewRow[]> = {};

  const sheetMap = new Map<string, unknown[][]>();
  for (const s of rawSheets) sheetMap.set(s.name, s.rows);

  /** قراءة صفوف ورقة من الثماني — تجاهل صف المثال والفارغ (sheet_rows :432-456) */
  function sheetRows(name: string, nCols: number): { line: number; vals: string[]; raw: unknown[] }[] {
    const rows = sheetMap.get(name);
    if (!rows) {
      warnings.push({ sheet: name, line: 0, raw: true, message: `ورقة «${name}» غير موجودة، سيتم تخطيها.` });
      return [];
    }
    if (!sheetsPresent.includes(name)) sheetsPresent.push(name);
    const spec = sheetSpec(name);
    const example = spec?.example ?? [];
    const out: { line: number; vals: string[]; raw: unknown[] }[] = [];
    for (let idx = 1; idx < rows.length; idx++) {
      const row = rows[idx] ?? [];
      const line = idx + 1; // سطر إكسل (العناوين سطر 1)
      const vals: string[] = [];
      for (let c = 0; c < nCols; c++) vals.push(cellStr(row[c]));
      const marker = cellStr(row[nCols]);
      const raw: unknown[] = [...row];
      while (raw.length < nCols) raw.push(undefined);
      // تجاهل صف المثال في القالب حتى لو مسح المستخدم أول خانة وبقيت
      // باقي بيانات المثال أو علامة «مثال، سيتم تجاهله».
      if (line === 2) {
        const sameExample = example.every((ex, c) => !vals[c] || vals[c] === cellStr(ex));
        if (marker.includes("مثال") || sameExample) continue;
      }
      if (!vals.some((v) => v !== "")) continue;
      out.push({ line, vals, raw });
    }
    // معاينة أول 5 صفوف (الصفوف المقبولة قبل فحص القواعد — كما وردت بالخلايا)
    preview[name] = out.slice(0, 5).map((r) => {
      const cells: Record<string, string> = {};
      (spec?.columns ?? []).forEach(([head], i) => {
        cells[head] = r.vals[i] ?? "";
      });
      return { line: r.line, cells };
    });
    return out;
  }

  // ===== العملاء (:458-482) =====
  // يسمح الاستيراد بأن تكون العقود/السندات مرتبطة بعميل موجود مسبقًا في قاعدة
  // البيانات حتى لو لم يكرر المستخدم اسمه في ورقة العملاء.
  const customerAliases: Record<string, string> = { ...ctx.existingCustomerAliases };
  const seenNameKeys = new Set<string>();
  for (const { line, vals } of sheetRows("العملاء", 5)) {
    const [name, phone, address, email, notes] = vals;
    if (!name) {
      errors.push({ sheet: "العملاء", line, message: "اسم العميل فارغ." });
      continue;
    }
    if (!phone) {
      errors.push({ sheet: "العملاء", line, message: "رقم الهاتف مطلوب." });
      continue;
    }
    const nkey = nameKey(name);
    if (seenNameKeys.has(nkey)) {
      errors.push({ sheet: "العملاء", line, message: `الاسم «${name}» مكرر في الملف.` });
      continue;
    }
    seenNameKeys.add(nkey);
    customerAliases[nkey] = ctx.existingCustomerAliases[nkey] ?? name;
    data.customers.push({ line, name, phone, address, email, notes });
  }

  const canonicalCustomer = (cname: string): string | null => customerAliases[nameKey(cname)] ?? null;

  // ===== العقود (:484-564) =====
  // المرحلة 6 — منع الإدخال الصامت تحت «غير محدد»: نوع العقد عمود إجباري،
  // ويجب أن يكون نوعًا معتمدًا موجودًا فعلًا.
  const knownTypeNames = ctx.knownContractTypes;
  const unknownTypes: Record<string, number[]> = {};
  const contractsRows = sheetMap.has("العقود") ? (sheetMap.get("العقود") ?? []) : null;
  const headerRow = contractsRows && contractsRows.length ? contractsRows[0] : [];
  const contractsSheetHasType = String(cellStr(headerRow[7])).includes("نوع العقد");
  if (contractsRows && !contractsSheetHasType) {
    errors.push({
      sheet: "العقود",
      line: 0,
      raw: true,
      message:
        "ورقة «العقود»: عمود «نوع العقد» غير موجود في الملف · نزّل القالب الجديد وانقل بياناتك إليه، أو أضف العمود وحدّد نوع كل عقد · لن تُدخل العقود تحت «غير محدد».",
    });
  }

  const contractKeys = new Set<string>();
  for (const { line, vals, raw } of sheetRows("العقود", 8)) {
    const [cname0, title, amountS, cdate, sdate, edate, status0, ctype0] = vals;
    const amount = cellAmount(raw[2]);
    const cdateN = cellDate(raw[3]);
    const sdateN = cellDate(raw[4]);
    const edateN = cellDate(raw[5]);
    if (!cname0) {
      errors.push({ sheet: "العقود", line, message: "اسم العميل فارغ." });
      continue;
    }
    const cnameCanonical = canonicalCustomer(cname0);
    if (!cnameCanonical) {
      errors.push({
        sheet: "العقود",
        line,
        message: `العميل «${cname0}» غير موجود في ورقة العملاء أو قائمة العملاء الحالية.`,
      });
      continue;
    }
    const cname = cnameCanonical;
    if (amount === null || amount <= 0) {
      errors.push({ sheet: "العقود", line, message: `قيمة العقد غير صالحة (${amountS}).` });
      continue;
    }
    if (!isValidDate(cdateN)) {
      errors.push({ sheet: "العقود", line, message: `تاريخ العقد غير صالح (${cdate}).` });
      continue;
    }
    for (const [label, d] of [["البداية", sdateN], ["النهاية", edateN]] as const) {
      if (d && !isValidDate(d)) {
        errors.push({ sheet: "العقود", line, message: `تاريخ ${label} غير صالح.` });
      }
    }
    const st0 = normalizeStatus(status0);
    if (st0.unknown) {
      warnings.push({
        sheet: "العقود",
        line,
        message: `الحالة «${status0}» غير معروفة · ستُسجل «نشط».`,
      });
    }
    const key = `${cname}\u0000${title || CONTRACT_FALLBACK(amount)}`;
    if (contractKeys.has(key)) {
      errors.push({
        sheet: "العقود",
        line,
        message: "عقد مكرر لنفس العميل بنفس الاسم · ميّز الاسمين.",
      });
      continue;
    }
    contractKeys.add(key);
    // --- التحقق الصريح من نوع العقد (المرحلة 6) ---
    const ctypeIn = (ctype0 || "").trim();
    let ctype = ctypeIn;
    if (contractsSheetHasType) {
      if (!ctypeIn) {
        errors.push({
          sheet: "العقود",
          line,
          message: "«نوع العقد» فارغ · حدّد النوع صراحةً · لن يُدخل العقد تحت «غير محدد».",
        });
        continue;
      }
      const real = knownTypeNames[typeKey(ctypeIn)];
      if (!real) {
        (unknownTypes[ctypeIn] ??= []).push(line);
        continue;
      }
      ctype = real;
    }
    data.contracts.push({
      line,
      customer_name: cname,
      title,
      amount,
      contract_date: cdateN,
      start_date: sdateN || "",
      end_date: edateN || "",
      status: st0.status,
      contract_type: ctype,
    });
  }

  // تقرير الأنواع المجهولة بصيغة قرار صريح (المرحلة 6) (:552-564)
  const knownValues = Object.values(knownTypeNames);
  for (const [bad, lines] of Object.entries(unknownTypes)) {
    const shown = lines.slice(0, 8).join("، ");
    const more = lines.length > 8 ? " وغيرها" : "";
    const available = [...knownValues].sort().join("، ") || "لا يوجد أي نوع معتمد بعد";
    errors.push({
      sheet: "العقود",
      line: 0,
      raw: true,
      message:
        `العقود: نوع العقد «${bad}» غير معتمد (أسطر: ${shown}${more}) · اختر أحد الحلول: ` +
        `(١) صحّح الاسم لأحد الأنواع الموجودة: ${available} · أو (٢) أنشئ النوع أولًا من زر «رفع أنواع ` +
        `العقود والمراحل والدفعات من Excel» · أو (٣) أوقف الاستيراد وعدّل الملف · لن يُدخل العقد تحت «غير محدد».`,
    });
  }

  // ===== مقاولو الباطن (:566-587) =====
  const seenSubs = new Set<string>(ctx.existingSubNames);
  const fileSubs = new Set<string>();
  for (const { line, vals } of sheetRows("مقاولو الباطن", 4)) {
    const [name, phone, activity, notes] = vals;
    if (!name) {
      errors.push({ sheet: "مقاولو الباطن", line, message: "الاسم فارغ." });
      continue;
    }
    if (fileSubs.has(name)) {
      errors.push({ sheet: "مقاولو الباطن", line, message: `«${name}» مكرر.` });
      continue;
    }
    fileSubs.add(name);
    seenSubs.add(name);
    data.subs.push({ line, name, phone, activity, notes });
  }

  // ===== عقود الإشراف (:589-634) =====
  for (const { line, vals, raw } of sheetRows("عقود الإشراف", 7)) {
    const [cname0, title, sdate, monthsS, monthlyS, cdate, status0] = vals;
    const sdateN = cellDate(raw[2]);
    const monthly = cellAmount(raw[4]);
    const cdateN = cellDate(raw[5]);
    let months = 0;
    {
      const m = Number(String(cellStr(raw[3])).trim() || 0);
      months = Number.isFinite(m) ? Math.trunc(m) : 0;
    }
    if (!cname0) {
      errors.push({ sheet: "عقود الإشراف", line, message: "اسم العميل فارغ." });
      continue;
    }
    const cnameCanonical = canonicalCustomer(cname0);
    if (!cnameCanonical) {
      errors.push({
        sheet: "عقود الإشراف",
        line,
        message: `العميل «${cname0}» غير موجود في ورقة العملاء أو قائمة العملاء الحالية.`,
      });
      continue;
    }
    const cname = cnameCanonical;
    if (!isValidDate(sdateN)) {
      errors.push({
        sheet: "عقود الإشراف",
        line,
        message: `تاريخ تعهد الإشراف غير صالح (${sdate}).`,
      });
      continue;
    }
    if (months <= 0) {
      errors.push({
        sheet: "عقود الإشراف",
        line,
        message: `المدة بالأشهر غير صالحة (${monthsS}).`,
      });
      continue;
    }
    if (monthly === null || monthly <= 0) {
      errors.push({
        sheet: "عقود الإشراف",
        line,
        message: `قيمة الشهر غير صالحة (${monthlyS}).`,
      });
      continue;
    }
    const st0 = normalizeStatus(status0);
    if (st0.unknown) {
      warnings.push({
        sheet: "عقود الإشراف",
        line,
        message: `الحالة «${status0}» غير معروفة · ستُسجل «نشط».`,
      });
    }
    const key = `${cname}\u0000${title || SUP_FALLBACK(monthly, months)}`;
    if (contractKeys.has(key)) {
      errors.push({
        sheet: "عقود الإشراف",
        line,
        message: "عقد بنفس الاسم موجود لنفس العميل · ميّز الاسمين.",
      });
      continue;
    }
    contractKeys.add(key);
    data.sup_contracts.push({
      line,
      customer_name: cname,
      title,
      sup_start: sdateN,
      months,
      monthly,
      amount: months * monthly,
      contract_date: cdateN || sdateN,
      status: st0.status,
    });
  }

  // ===== سندات القبض / الدفعات القديمة (:636-748) =====
  const contractTotals: { key: ContractKey; amount: number }[] = [];
  const contractTotalsMap = new Map<string, number>();
  const addTotal = (key: ContractKey, amount: number) => {
    const k = `${key[0]}\u0000${key[1]}`;
    if (!contractTotalsMap.has(k)) {
      contractTotals.push({ key, amount });
      contractTotalsMap.set(k, amount);
    }
  };
  for (const c of data.contracts) addTotal([c.customer_name, c.title || CONTRACT_FALLBACK(c.amount)], c.amount);
  for (const c of data.sup_contracts)
    addTotal([c.customer_name, c.title || SUP_FALLBACK(c.monthly, c.months)], c.amount);
  // اسم العميل/العقد الموجود فعليًا في النظام مقبول أيضًا (:645-661)
  for (const r of ctx.existingContracts) {
    if (r.customerName.trim() && r.label.trim()) addTotal([r.customerName, r.label], r.amount);
  }
  const totalOf = (key: ContractKey): number => contractTotalsMap.get(`${key[0]}\u0000${key[1]}`) ?? 0;

  const collected = new Map<string, number>();
  const seenReceiptNumbers = new Set<string>(ctx.existingReceiptNumbers);
  const seenReceiptNumbersFile = new Set<string>();

  function parseReceiptRow(sheetName: string, line: number, vals: string[], raw: unknown[], hasOldNumber: boolean): void {
    let oldNo: string;
    let cname0: string, ctitle: string, amountS: string, pdate: string, descr: string, method: string, notes: string;
    let amount: number | null, pdateN: string;
    if (hasOldNumber) {
      [oldNo, cname0, ctitle, amountS, pdate, descr, method, notes] = vals;
      amount = cellAmount(raw[3]);
      pdateN = cellDate(raw[4]);
    } else {
      oldNo = "";
      [cname0, ctitle, amountS, pdate, descr, method] = vals;
      notes = "";
      amount = cellAmount(raw[2]);
      pdateN = cellDate(raw[3]);
    }
    const issue = (message: string) => errors.push({ sheet: sheetName, line, message });
    const warn = (message: string) => warnings.push({ sheet: sheetName, line, message });
    if (oldNo) {
      if (seenReceiptNumbersFile.has(oldNo)) {
        issue(`رقم السند القديم «${oldNo}» مكرر داخل الملف.`);
        return;
      }
      if (seenReceiptNumbers.has(oldNo)) {
        warn(`رقم السند القديم «${oldNo}» موجود مسبقًا في النظام · تم تخطيه.`);
        return;
      }
      seenReceiptNumbers.add(oldNo);
      seenReceiptNumbersFile.add(oldNo);
    }
    if (!cname0) {
      issue("اسم العميل فارغ.");
      return;
    }
    const cnameCanonical = canonicalCustomer(cname0);
    if (!cnameCanonical) {
      issue(`العميل «${cname0}» غير موجود في ورقة العملاء أو قائمة العملاء الحالية.`);
      return;
    }
    const cname = cnameCanonical;
    if (amount === null || amount <= 0) {
      issue(`المبلغ غير صالح (${amountS}).`);
      return;
    }
    if (!isValidDate(pdateN)) {
      issue(`التاريخ غير صالح (${pdate}).`);
      return;
    }
    // مطابقة العقد
    let matches = contractTotals
      .filter(
        (t) =>
          nameKey(t.key[0]) === nameKey(cname) &&
          (!ctitle || nameKey(t.key[1]) === nameKey(ctitle))
      )
      .map((t) => t.key);
    if (ctitle && !matches.length) {
      issue(`العقد «${ctitle}» غير موجود للعميل «${cname}» في ورقة العقود.`);
      return;
    }
    if (!ctitle) {
      const clientContracts = contractTotals
        .filter((t) => nameKey(t.key[0]) === nameKey(cname))
        .map((t) => t.key);
      if (clientContracts.length > 1) {
        issue("للعميل أكثر من عقد · حدد اسم العقد.");
        return;
      }
      if (!clientContracts.length) {
        issue(`لا يوجد عقد للعميل «${cname}».`);
        return;
      }
      matches = clientContracts;
    }
    const key = matches[0];
    const ck = `${key[0]}\u0000${key[1]}`;
    collected.set(ck, (collected.get(ck) ?? 0) + (amount ?? 0));
    // تجاوز قيمة العقد تنبيه لا خطأ: النظام يسجل الزيادة كدفعة مقدمة (:724-732)
    if ((collected.get(ck) ?? 0) > totalOf(key) + 0.001) {
      warn(
        `مجموع سندات قبض عقد «${key[1]}» (${fmt3(collected.get(ck) ?? 0)}) يتجاوز قيمته ` +
          `(${fmt3(totalOf(key))}) · ستُسجَّل الزيادة كدفعة مقدمة على العقد · راجع قيمة العقد أو تكرار السندات.`
      );
    }
    const m0 = normalizePayMethod(method);
    if (m0.unknown) {
      warn(`طريقة الدفع «${method}» ستُسجل «أخرى».`);
    }
    data.payments.push({
      line,
      sheet: sheetName,
      customer_name: cname,
      contract_key: key,
      amount: amount ?? 0,
      date: pdateN,
      description: descr || "سند قبض (مستورد)",
      method: m0.method,
      notes: notes || "",
      old_number: oldNo || "",
    });
  }

  // الورقة القديمة باقية للتوافق (:742-748)
  for (const { line, vals, raw } of sheetRows("الدفعات", 6)) {
    parseReceiptRow("الدفعات", line, vals, raw, false);
  }
  // الورقة الجديدة أوضح لأنها سندات قبض فعلية ويمكن حفظ رقم السند القديم
  for (const { line, vals, raw } of sheetRows("سندات القبض", 8)) {
    parseReceiptRow("سندات القبض", line, vals, raw, true);
  }

  // ===== عقود الباطن (:750-787) =====
  const subTotals = new Map<string, number>(); // (مقاول، عقد) -> قيمة
  for (const { line, vals, raw } of sheetRows("عقود الباطن", 7)) {
    const [sname, cname0, ctitle, amountS, sdate, edate, descr] = vals;
    const amount = cellAmount(raw[3]);
    const sdateN = cellDate(raw[4]);
    const edateN = cellDate(raw[5]);
    if (!sname) {
      errors.push({ sheet: "عقود الباطن", line, message: "اسم المقاول فارغ." });
      continue;
    }
    if (!seenSubs.has(sname)) {
      errors.push({
        sheet: "عقود الباطن",
        line,
        message: `المقاول «${sname}» غير موجود في ورقة مقاولي الباطن.`,
      });
      continue;
    }
    const cnameCanonical = cname0 ? canonicalCustomer(cname0) : null;
    if (!cname0 || !cnameCanonical) {
      errors.push({
        sheet: "عقود الباطن",
        line,
        message: `العميل «${cname0}» غير موجود في ورقة العملاء أو قائمة العملاء الحالية.`,
      });
      continue;
    }
    const cname = cnameCanonical;
    // مطابقة العقد الرئيسي (عادي أو إشراف)
    const matches = contractTotals
      .filter(
        (t) =>
          nameKey(t.key[0]) === nameKey(cname) &&
          (!ctitle || nameKey(t.key[1]) === nameKey(ctitle))
      )
      .map((t) => t.key);
    if (!matches.length) {
      errors.push({
        sheet: "عقود الباطن",
        line,
        message: `العقد «${ctitle}» غير موجود للعميل «${cname}».`,
      });
      continue;
    }
    if (amount === null || amount <= 0) {
      errors.push({
        sheet: "عقود الباطن",
        line,
        message: `قيمة عقد الباطن غير صالحة (${amountS}).`,
      });
      continue;
    }
    const key = matches[0];
    const subKey = `${sname}\u0000${key[0]}\u0000${key[1]}`;
    subTotals.set(subKey, (subTotals.get(subKey) ?? 0) + (amount ?? 0));
    data.sub_contracts.push({
      line,
      sub_name: sname,
      contract_key: key,
      amount: amount ?? 0,
      start_date: sdateN || "",
      end_date: edateN || "",
      description: descr || "",
    });
  }

  // ===== سندات الصرف (:789-892) =====
  const subPaid = new Map<string, number>();
  const seenPaymentNumbers = new Set<string>(ctx.existingPaymentNumbers);
  const seenPaymentNumbersFile = new Set<string>();
  for (const { line, vals, raw } of sheetRows("سندات الصرف", 11)) {
    const [oldNo, accName, pname, cname0, projectName, ctitle, amountS, pdate, descr, method, notes] = vals;
    const amount = cellAmount(raw[6]);
    const pdateN = cellDate(raw[7]);
    const issue = (message: string) => errors.push({ sheet: "سندات الصرف", line, message });
    const warn = (message: string) => warnings.push({ sheet: "سندات الصرف", line, message });
    if (oldNo) {
      if (seenPaymentNumbersFile.has(oldNo)) {
        issue(`رقم السند القديم «${oldNo}» مكرر داخل الملف.`);
        continue;
      }
      if (seenPaymentNumbers.has(oldNo)) {
        warn(`رقم السند القديم «${oldNo}» موجود مسبقًا في النظام · سيتم تخطيه.`);
        data.expenses.push({
          line,
          skipExisting: true,
          old_number: oldNo,
          party_name: "",
          is_sub: false,
          contract_key: null,
          expense_customer_name: "",
          project_id: null,
          expense_account_id: 0,
          amount: 0,
          date: "",
          description: "",
          method: "",
          notes: "",
        });
        seenPaymentNumbers.add(oldNo);
        seenPaymentNumbersFile.add(oldNo);
        continue;
      }
      seenPaymentNumbers.add(oldNo);
      seenPaymentNumbersFile.add(oldNo);
    }
    if (!pname) {
      issue("اسم المستفيد فارغ.");
      continue;
    }
    const expenseAccountId = ctx.expenseAccounts[nameKey(accName)] ?? 0;
    if (!expenseAccountId) {
      issue(`حساب المصروف «${accName}» غير موجود في إعدادات حسابات المصروفات.`);
      continue;
    }
    if (amount === null || amount <= 0) {
      issue(`المبلغ غير صالح (${amountS}).`);
      continue;
    }
    if (!isValidDate(pdateN)) {
      issue(`التاريخ غير صالح (${pdate}).`);
      continue;
    }
    const m0 = normalizePayMethod(method);
    if (m0.unknown) {
      warn(`طريقة الدفع «${method}» ستُسجل «أخرى».`);
    }
    const isSub = seenSubs.has(pname);
    let key: ContractKey | null = null;
    let expenseCustomerName = "";
    if (cname0) {
      const cnameCanonical = canonicalCustomer(cname0);
      if (!cnameCanonical) {
        issue(`العميل «${cname0}» غير موجود في العملاء أو قاعدة البيانات.`);
        continue;
      }
      expenseCustomerName = cnameCanonical;
    }
    let projectId: number | null = null;
    if (projectName) {
      projectId = ctx.projects[nameKey(projectName)] ?? null;
      if (!projectId) {
        issue(`المشروع «${projectName}» غير موجود.`);
        continue;
      }
    }
    if (cname0 && ctitle) {
      const matches = contractTotals
        .filter(
          (t) => nameKey(t.key[0]) === nameKey(expenseCustomerName) && nameKey(t.key[1]) === nameKey(ctitle)
        )
        .map((t) => t.key);
      if (!matches.length) {
        issue(`العقد «${ctitle}» غير موجود للعميل «${expenseCustomerName}».`);
        continue;
      }
      key = matches[0];
      if (isSub) {
        const subKey = `${pname}\u0000${key[0]}\u0000${key[1]}`;
        if (!subTotals.has(subKey)) {
          warn(`المقاول «${pname}» غير مربوط بعقد باطن في ملف الرفع؛ سيُسجل الصرف كمنصرف لمورد مرتبط بالعقد.`);
        } else {
          const paid = (subPaid.get(subKey) ?? 0) + (amount ?? 0);
          if (paid > (subTotals.get(subKey) ?? 0) + 0.001) {
            issue(
              `مجموع الصرف للمقاول «${pname}» (${fmt3(paid)}) يتجاوز قيمة عقد باطنه (${fmt3(subTotals.get(subKey) ?? 0)}).`
            );
            continue;
          }
          subPaid.set(subKey, paid);
        }
      }
    } else if (ctitle && !cname0) {
      issue("عند كتابة اسم العقد يجب كتابة اسم العميل أيضًا.");
      continue;
    }
    data.expenses.push({
      line,
      old_number: oldNo || "",
      party_name: pname,
      is_sub: isSub,
      contract_key: key,
      expense_customer_name: expenseCustomerName,
      project_id: projectId,
      expense_account_id: expenseAccountId,
      amount: amount ?? 0,
      date: pdateN,
      description: descr || (isSub ? "دفعة مقاول (مستورد)" : "مصروف عام (مستورد)"),
      method: m0.method,
      notes: notes || "",
    });
  }

  // ---- تنبيه مسبق: سندات قبض تتجاوز قيمة عقدها (:894-924) ----
  {
    const conValue = new Map<string, number>();
    for (const crow of data.contracts) {
      const ck = `${crow.customer_name}\u0000${crow.title || CONTRACT_FALLBACK(crow.amount)}`;
      conValue.set(ck, (conValue.get(ck) ?? 0) + crow.amount);
    }
    for (const srow of data.sup_contracts) {
      const ck = `${srow.customer_name}\u0000${srow.title || SUP_FALLBACK(srow.monthly, srow.months)}`;
      conValue.set(ck, (conValue.get(ck) ?? 0) + srow.amount);
    }
    const paidSum = new Map<string, number>();
    for (const prow of data.payments) {
      const ck = `${prow.contract_key[0]}\u0000${prow.contract_key[1]}`;
      paidSum.set(ck, (paidSum.get(ck) ?? 0) + prow.amount);
    }
    for (const [ck, paid] of paidSum) {
      const value = conValue.get(ck);
      if (value === undefined) continue; // عقد موجود مسبقًا — يُفحص وقت الإدخال
      if (paid > value + 0.001) {
        const [custName, conLabel] = ck.split("\u0000");
        warnings.push({
          sheet: "سندات القبض",
          line: 0,
          raw: true,
          message:
            `سندات القبض على عقد «${conLabel}» للعميل «${custName}» مجموعها ${fmt3(paid)} ` +
            `وقيمة العقد ${fmt3(value)} (زيادة ${fmt3(paid - value)}) · ستُسجَّل الزيادة كدفعة مقدمة ` +
            "ولن يتوقف الاستيراد · راجع قيمة العقد أو تكرار السندات.",
        });
      }
    }
  }

  return {
    data,
    errors,
    warnings,
    counts: {
      customers: data.customers.length,
      contracts: data.contracts.length,
      subs: data.subs.length,
      payments: data.payments.length,
      sup_contracts: data.sup_contracts.length,
      sub_contracts: data.sub_contracts.length,
      expenses: data.expenses.length,
    },
    sheetsPresent,
    preview,
  };
}
