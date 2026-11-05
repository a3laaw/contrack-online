/**
 * accounting-journal.ts — نواة القيد المزدوج النقية (بلا React ولا server-only) — Task 104.
 * قرار هيكلي صريح (docs/roadmap-accounting.md): الأستاذ العام مصدر الحقيقة الوحيد —
 * كل قيد متوازن إلزاميًا (مجموع المدين = مجموع الدائن)، سطر = طرف واحد (مدين XOR دائن)،
 * والإلغاء/التصحيح بقيد عكسي مرتبط. تُحسب الأرقام بفلس كامل (3 خانات عشرية) وتُقرب r3.
 *
 * يحتوي أيضًا:
 *  • حاسم أسماء القيود النصية القديمة (LEGACY_ACCOUNT_MAP) — الجسر الانتقالي من عصور
 *    القيود بنصوص عربية حرة ("العملاء"، "بنك"، "العهد"…) إلى الدليل الموحد حسب كوده.
 *  • مُرحِّل القيود النصية القديمة (migrateLegacyJournalRows) — يُستخدم في سكربت الترحيل
 *    وفي مسار استعادة النسخ القديمة (backup-dump) بنفس المنطق المُختبَر.
 */

// ==================== الأنواع ====================

export type EntryStatus = "posted" | "draft" | "cancelled";

/** الأبعاد التحليلية لسطر القيد — بلا FK على الجداول التشغيلية (قاعدة SaaS) */
export interface JournalLineDims {
  customerId?: number | null;
  contractId?: number | null;
  subContractId?: number | null;
  boqItemId?: number | null;
  projectId?: number | null;
  employeeId?: number | null;
  costCenter?: string;
}

export interface JournalLineInput extends JournalLineDims {
  accountId: number;
  debit: number;
  credit: number;
  description?: string;
}

export interface JournalEntryInput {
  entryDate: string;
  description: string;
  sourceType?: string;
  sourceId?: number | null;
  reversalOfId?: number | null;
  lines: JournalLineInput[];
}

export interface EntryCheck {
  ok: boolean;
  error?: string;
  totalDebit: number;
  totalCredit: number;
  diff: number;
}

// ==================== مساعدات المبالغ ====================

/** تقريب لثلاث خانات عشرية (فلس) — يمنع انحراف الفاصلة العائمة في التوازن */
export function r3(n: number): number {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

// ==================== التحقق من القيد ====================

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * تحقق موحد قبل نشر أي قيد:
 *  • تاريخ صحيح الشكل YYYY-MM-DD وبيان غير فارغ وسطران فأكثر
 *  • كل سطر طرف واحد فقط: مدين > 0 XOR دائن > 0 (لا صفري ولا مزدوج ولا سالب)
 *  • التوازن الإلزامي: مجموع المدين = مجموع الدائن (ضمن 0.001)
 *  • كل حساب ورقة مسموح النشر عليها ونشطة — عبر خريطة الحسابات المُمرَّرة
 */
export function validateJournalEntry(
  input: JournalEntryInput,
  accountsById: Map<number, { allowPosting: boolean; isActive: boolean }>
): EntryCheck {
  const empty: EntryCheck = { ok: false, totalDebit: 0, totalCredit: 0, diff: 0 };
  if (!DATE_RE.test(String(input.entryDate || ""))) {
    return { ...empty, error: "تاريخ القيد مطلوب بصيغة YYYY-MM-DD." };
  }
  if (!String(input.description || "").trim()) {
    return { ...empty, error: "بيان القيد مطلوب." };
  }
  if (!Array.isArray(input.lines) || input.lines.length < 2) {
    return { ...empty, error: "القيد يحتاج سطرين فأكثر (طرفين على الأقل)." };
  }

  let totalDebit = 0;
  let totalCredit = 0;
  for (let i = 0; i < input.lines.length; i++) {
    const l = input.lines[i];
    const debit = r3(Number(l?.debit) || 0);
    const credit = r3(Number(l?.credit) || 0);
    if (!Number.isInteger(l?.accountId) || (l?.accountId ?? 0) <= 0) {
      return { ...empty, error: `سطر ${i + 1}: اختر حسابًا من الدليل.` };
    }
    if (debit < 0 || credit < 0) {
      return { ...empty, error: `سطر ${i + 1}: لا تقبل مبالغ سالبة.` };
    }
    if (debit > 0 && credit > 0) {
      return { ...empty, error: `سطر ${i + 1}: لا يجوز أن يكون الطرف مدينًا ودائنًا معًا.` };
    }
    if (debit === 0 && credit === 0) {
      return { ...empty, error: `سطر ${i + 1}: اكتب مبلغًا مدينًا أو دائنًا.` };
    }
    const acc = accountsById.get(l.accountId);
    if (!acc) return { ...empty, error: `سطر ${i + 1}: الحساب غير موجود في دليل الشركة.` };
    if (!acc.isActive) return { ...empty, error: `سطر ${i + 1}: الحساب معطّل — فعّله أو اختر غيره.` };
    if (!acc.allowPosting) return { ...empty, error: `سطر ${i + 1}: هذا الحساب إجمالي ولا يقبل نشر قيود مباشرة.` };
    totalDebit = r3(totalDebit + debit);
    totalCredit = r3(totalCredit + credit);
  }
  const diff = r3(totalDebit - totalCredit);
  if (Math.abs(diff) >= 0.001) {
    return {
      ok: false,
      error: `القيد غير متوازن — المدين ${totalDebit.toFixed(3)} مقابل الدائن ${totalCredit.toFixed(3)}.`,
      totalDebit,
      totalCredit,
      diff,
    };
  }
  return { ok: true, totalDebit, totalCredit, diff: 0 };
}

// ==================== القيد العكسي ====================

/** أسطر القيد العكسي: تبديل المدين والدائن سطرًا بسطر (التصحيح الشفاف — الأصل يبقى منشورًا) */
export function buildReversalLines(lines: JournalLineInput[]): JournalLineInput[] {
  return lines.map((l) => ({
    ...l,
    debit: l.credit,
    credit: l.debit,
  }));
}

// ==================== الفترات المالية ====================

/** مفتاح الفترة الشهرية من تاريخ النظام النصي — "2025-03-14" → "2025-03" */
export function periodKeyOf(date: string): string {
  return String(date || "").slice(0, 7);
}

export const PERIOD_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** حالة فترات الشركة (periodDate → status) — الفترة المفقودة تعامل مفتوحة (تُبذر آليًا) */
export function isDateInOpenPeriod(periodStatuses: Map<string, string>, date: string): boolean {
  const key = periodKeyOf(date);
  if (!PERIOD_KEY_RE.test(key)) return false;
  return periodStatuses.get(key) !== "closed";
}

// ==================== تطبيع أسماء الحسابات ====================

/** تطبيع المطابقة العربية — أخف من normalizeArabic الرسمي ويكفي لحسم الأسماء */
export function normalizeMatchAr(s: string): string {
  return (s || "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

// ==================== حاسم أسماء القيود النصية القديمة ====================

/**
 * خريطة الأسماء العربية الحرة التي كتبت بها القيود القديمة → كود الحساب القياسي.
 * المفاتيح مطبَّعة (normalizeMatchAr). الأسماء غير الموجودة هنا تُحل بمطابقة
 * اسم الدليل ثم تضمين الاسم، وأخيرًا حساب التسوية المؤقت (الشك).
 */
export const LEGACY_ACCOUNT_MAP: Record<string, string> = {
  "العملاء": "1121",
  "ذمم العملاء": "1121",
  "ايرادات العقود": "4100",
  "بنك": "1112",
  "البنك": "1112",
  "حساب بنكي": "1112",
  "صندوق": "1111",
  "الصندوق": "1111",
  "نقدية": "1111",
  "نقد": "1111",
  "كاش": "1111",
  "العهد": "1140",
  "عهد": "1140",
  "سلف موظفين": "1140",
  "سلفه": "1140",
  "رواتب": "5210",
  "رواتب واجور": "5210",
  "مصروفات اخري": "5300",
  "مصروفات متنوعه": "5300",
  "جاري الشريك": "3400",
  "جاري الشركاء": "3400",
  "شيكات": "1130",
  "اوراق القبض": "1130",
  "شيكات مستحقه": "2130",
  "اوراق الدفع": "2130",
  "عمولات بنكيه": "5260",
  "رسوم بنكيه": "5260",
  "ايجارات": "5220",
  "كهرباء": "5230",
  "مستحقات الباطن": "2121",
  "محتجزات الباطن": "2122",
};

export interface AccountResolveCandidate {
  id: number;
  code: string;
  name: string;
  allowPosting: boolean;
  isActive: boolean;
}

/**
 * حسم اسم قيد قديم إلى حساب الدليل الموحد. الأسماء المسارية القديمة
 * ("مصروفات مشاريع / مواد بناء") تُحل بالمحاولة التسلسلية: المسار كاملًا ثم
 * مقاطعه من الأعمق للأقصر — كل مقطع يمر بالتسلسل: مطابقة تامة → الخريطة الثابتة →
 * تضمين فريد. يعيد null إن تعذر الحسم — والمستدعي يوجه لحساب التسوية.
 */
export function resolveLegacyAccountName(
  rawName: string,
  accounts: AccountResolveCandidate[]
): number | null {
  const norm = normalizeMatchAr(rawName);
  if (!norm) return null;
  const pool = accounts.filter((a) => a.isActive && a.allowPosting);

  const tryOne = (term: string): number | null => {
    if (!term) return null;
    const exact = pool.find((a) => normalizeMatchAr(a.name) === term);
    if (exact) return exact.id;
    const byMap = LEGACY_ACCOUNT_MAP[term];
    if (byMap) {
      const byCode = pool.find((a) => a.code === byMap);
      if (byCode) return byCode.id;
    }
    const partials = pool.filter((a) => {
      const an = normalizeMatchAr(a.name);
      return an.length >= 3 && (an.includes(term) || term.includes(an));
    });
    return partials.length === 1 ? partials[0].id : null;
  };

  const direct = tryOne(norm);
  if (direct != null) return direct;

  // مقاطع المسار من الأعمق للأقصر (الورقة أولاً)
  const segs = norm.split("/").map((s) => s.trim()).filter(Boolean);
  for (let i = segs.length - 1; i >= 1; i -= 1) {
    const hit = tryOne(segs[i]);
    if (hit != null) return hit;
  }
  return null;
}

/**
 * أصناف قيود السندات في الأستاذ — تضم قيم استيراد المكتبي التاريخية:
 * الكود الحالي ينشئ "voucher" فقط، بينما المكتبي القديم كتب voucher_receipt/
 * voucher_payment/voucher_transfer حسب نوع السند — كلها تُعامل كمصدر سند
 * (عكس/إلغاء/حذف/عرض بالسند).
 */
export const VOUCHER_JOURNAL_SOURCES: string[] = [
  "voucher",
  "voucher_receipt",
  "voucher_payment",
  "voucher_transfer",
];

/** مواصفة حساب التسوية المؤقت — يُبذر لكل شركة كسجل نظامي يقبل النشر (للمرحَّل غير المحسوم) */
export const SUSPENSE_ACCOUNT = {
  code: "2999",
  name: "حساب تسوية مؤقت",
  type: "liability",
  nature: "credit",
  notes: "يستقبل القيود المرحَّلة التي تعذر حسم حسابها آليًا — يُراجع ويُقفل بتحويلات لاحقة",
} as const;

// ==================== ترحيل القيود النصية القديمة ====================

export interface LegacyJournalRow {
  id: number;
  companyId: number;
  entryDate: string;
  description: string;
  debitAccount: string;
  creditAccount: string;
  amount: string | number;
  contractId?: number | null;
  subContractId?: number | null;
  boqItemId?: number | null;
  projectId?: number | null;
  costCenter?: string;
  sourceType?: string;
  sourceId?: number | null;
}

export interface MigratedEntry {
  entryNo: number;
  entryDate: string;
  description: string;
  status: "posted";
  sourceType: string;
  sourceId: number | null;
  createdBy: string;
  lines: JournalLineInput[];
}

export interface LegacyMigrationResult {
  entries: MigratedEntry[];
  /** أسماء نصية تعذر حسمها — أُرسلت لحساب التسوية (للمراجعة) */
  unmatched: { rowId: number; side: "debit" | "credit"; name: string }[];
  suspenseUsed: number;
}

/**
 * تحويل صفوف journal_entries القديمة (نصوص طرفين + مبلغ) إلى قيود النموذج الجديد.
 * دالة نقية — تُستخدم في سكربت الترحيل ومسار استعادة النسخ القديمة بنفس المنطق.
 * resolveName: حاسم الاسم → accountId أو null (يُمرَّر من الخادم بعد بناء خريطة الدليل + جسر شجرة المصروفات).
 * كل صف قديم = قيد منشور من طرفين بنفس التاريخ والمصدر، والترقيم تعاقبي من البداية.
 */
export function migrateLegacyJournalRows(
  rows: LegacyJournalRow[],
  resolveName: (name: string) => number | null,
  suspenseId: number,
  startEntryNo = 1
): LegacyMigrationResult {
  const entries: MigratedEntry[] = [];
  const unmatched: LegacyMigrationResult["unmatched"] = [];
  let suspenseUsed = 0;

  for (const row of rows) {
    const amount = r3(Number(row.amount) || 0);
    if (amount === 0) continue; // قيد صريح صفر — لا معنى له في النموذج الجديد

    const dims: JournalLineDims = {
      contractId: row.contractId ?? null,
      subContractId: row.subContractId ?? null,
      boqItemId: row.boqItemId ?? null,
      projectId: row.projectId ?? null,
      costCenter: row.costCenter || "",
    };

    const sides: { side: "debit" | "credit"; name: string }[] = [
      { side: "debit", name: row.debitAccount || "" },
      { side: "credit", name: row.creditAccount || "" },
    ];
    const lines: JournalLineInput[] = [];
    for (const s of sides) {
      let accId = resolveName(s.name);
      if (accId == null) {
        accId = suspenseId;
        unmatched.push({ rowId: row.id, side: s.side, name: s.name });
        suspenseUsed++;
      }
      lines.push({
        accountId: accId,
        debit: s.side === "debit" ? amount : 0,
        credit: s.side === "credit" ? amount : 0,
        description: s.name,
        ...dims,
      });
    }

    entries.push({
      entryNo: startEntryNo + entries.length,
      entryDate: row.entryDate,
      description: row.description || "قيد مرحَّل",
      status: "posted",
      sourceType: row.sourceType || "migration",
      sourceId: row.sourceId ?? null,
      createdBy: "migration-104",
      lines,
    });
  }

  return { entries, unmatched, suspenseUsed };
}
