import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import {
  buildReversalLines,
  isDateInOpenPeriod,
  migrateLegacyJournalRows,
  resolveLegacyAccountName,
  r3,
  SUSPENSE_ACCOUNT,
  validateJournalEntry,
  type JournalEntryInput,
  type JournalLineDims,
  type JournalLineInput,
  type LegacyJournalRow,
} from "@/lib/accounting-journal";

/**
 * journal-server.ts — طبقة خادم نواة القيد المزدوج — Task 104.
 * نشر/إلغاء/عكس القيود عبر محرك واحد يُستخدم من كل المصادر (القيد اليدوي،
 * السندات، العُهد، الرسوم البنكية) — لا مسار كتابة آخر لجداول الأستاذ.
 * كل الكتابة داخل معاملات بمهلة مرتفعة (درس P2028 من Task 102).
 */

type Tx = Prisma.TransactionClient;
type DbClient = Prisma.TransactionClient | PrismaClient;

const TX_OPTS = { timeout: 30_000, maxWait: 10_000 } as const;

/** رقم القيد التالي — ماكس+1 داخل نطاق الشركة (الغلاف يحصر) */
export async function nextEntryNo(tx: DbClient): Promise<number> {
  const agg = await tx.journalEntry.aggregate({ _max: { entryNo: true } });
  return (agg._max.entryNo ?? 0) + 1;
}

// ==================== الفترات المالية ====================

/** بذر سنة مالية كاملة (12 فترة شهرية مفتوحة) إن لم توجد */
export async function ensureFiscalYear(tx: DbClient, year: number): Promise<void> {
  const existing = await tx.fiscalYear.findFirst({ where: { year }, select: { id: true } });
  if (existing) return;
  const fy = await tx.fiscalYear.create({ data: { year, status: "open" } });
  const periods = Array.from({ length: 12 }, (_, i) => ({
    fiscalYearId: fy.id,
    periodDate: `${year}-${String(i + 1).padStart(2, "0")}`,
    status: "open",
  }));
  await tx.fiscalPeriod.createMany({ data: periods });
}

/** ضمان وجود فترة التاريخ (وإلا تُبذر) وإعادة حالتها — يُستدعى قبل النشر */
export async function ensurePeriodForDate(
  tx: DbClient,
  entryDate: string
): Promise<{ open: boolean }> {
  const key = String(entryDate || "").slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) return { open: false };
  const year = Number(key.slice(0, 4));
  await ensureFiscalYear(tx, year);
  const period = await tx.fiscalPeriod.findFirst({
    where: { periodDate: key },
    select: { status: true },
  });
  return { open: (period?.status ?? "open") !== "closed" };
}

/** خريطة حالة الفترات الموجودة (للتحقق السريع في القراءات) */
export async function loadPeriodStatuses(): Promise<Map<string, string>> {
  const rows = await db.fiscalPeriod.findMany({ select: { periodDate: true, status: true } });
  return new Map(rows.map((r) => [r.periodDate, r.status]));
}

// ==================== حاسم الحسابات ====================

export interface AccountResolver {
  resolve: (name: string) => number | null;
  accountsById: Map<number, { allowPosting: boolean; isActive: boolean }>;
  suspenseId: number;
  unmatchedViaSuspense: (name: string) => number;
}

/** حساب التسوية المؤقت — يُبذر كسجل نظامي مرة واحدة لكل شركة */
export async function ensureSuspenseAccount(tx: DbClient): Promise<number> {
  const found = await tx.account.findFirst({
    where: { code: SUSPENSE_ACCOUNT.code },
    select: { id: true },
  });
  if (found) return found.id;
  const created = await tx.account.create({
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
  });
  return created.id;
}

/**
 * بناء حاسم أسماء القيود القديمة لسياق الشركة:
 *  1) جسر شجرة المصروفات (اسم ExpenseAccount → accountId المرتبط من Task 102)
 *  2) مطابقة اسم الدليل/الخريطة الثابتة عبر النواة النقية
 *  3) الشك ⇒ حساب التسوية المؤقت (يُعدّ في unmatchedViaSuspense للمراجعة)
 */
export async function buildAccountResolver(tx: DbClient): Promise<AccountResolver> {
  const accounts = await tx.account.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, allowPosting: true, isActive: true },
  });
  const suspenseId = await ensureSuspenseAccount(tx);
  if (!accounts.some((a) => a.id === suspenseId)) {
    accounts.push({
      id: suspenseId,
      code: SUSPENSE_ACCOUNT.code,
      name: SUSPENSE_ACCOUNT.name,
      allowPosting: true,
      isActive: true,
    });
  }

  // جسر شجرة المصروفات القديمة: اسم الشجرة → الحساب المرتبط (Task 102)
  const expenseRows = await tx.expenseAccount.findMany({
    where: { accountId: { not: null } },
    select: { name: true, accountId: true },
  });
  const bridgeNameToAccount = new Map<string, number>();
  for (const ea of expenseRows) {
    if (ea.accountId != null) bridgeNameToAccount.set(ea.name.trim(), ea.accountId);
  }

  const candidates = accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    allowPosting: a.allowPosting,
    isActive: a.isActive,
  }));
  const resolvedViaBridge = new Set<string>();
  const suspenseHits: string[] = [];

  const resolve = (name: string): number | null => {
    const raw = String(name || "").trim();
    if (!raw) return null;
    // 1) جسر المصروفات بالاسم (يدعم snapshot أسماء الشجرة القديمة)
    const bridged = bridgeNameToAccount.get(raw);
    if (bridged != null) {
      resolvedViaBridge.add(raw);
      return bridged;
    }
    // 2) مطابقة الدليل/الخريطة الثابتة
    return resolveLegacyAccountName(raw, candidates);
  };

  return {
    resolve,
    accountsById: new Map(
      accounts.map((a) => [a.id, { allowPosting: a.allowPosting, isActive: a.isActive }])
    ),
    suspenseId,
    unmatchedViaSuspense: (name: string) => {
      suspenseHits.push(name);
      return suspenseId;
    },
  };
}

// ==================== بوابة الأسماء القديمة → المحرك ====================

export interface NamedEntrySide {
  /** الاسم العربي الحر كما كتبه الكود القديم ("العملاء"، "بنك"، snapshot الشجرة…) */
  name: string;
  /** إن كان الطرف حساب شجرة المصروفات/العهد القديمة — يُحسم بجسره أولًا (Task 102) */
  expenseAccountId?: number | null;
}

export interface NamedEntryParams {
  entryDate: string;
  description: string;
  debit: NamedEntrySide;
  credit: NamedEntrySide;
  amount: number;
  dims?: JournalLineDims;
  sourceType: string;
  sourceId?: number | null;
  /** منشئ القيد الآلي — افتراضي «النظام (آلي)» */
  actor?: string;
}

async function resolveNamedSide(
  tx: DbClient,
  side: NamedEntrySide,
  resolver: AccountResolver
): Promise<number> {
  if (side.expenseAccountId != null) {
    const ea = await tx.expenseAccount.findFirst({
      where: { id: side.expenseAccountId },
      select: { accountId: true, name: true },
    });
    if (ea?.accountId != null) return ea.accountId; // الجسر المرتبط من شاشة دليل الحسابات
  }
  const resolved = resolver.resolve(side.name);
  return resolved ?? resolver.suspenseId;
}

/**
 * نشر قيد بطرفين معروفي الاسم نصيًا (آلية السندات القديمة) عبر المحرك الموحد —
 * الجسر الانتقالي فقط: يحسم كل طرف (جسر الشجرة → الدليل → الخريطة الثابتة → التسوية)
 * ويبنِ سطرين بأبعاد المستند. كل المواضع القديمة تستدعي هذا بدل journalEntry.create.
 */
export async function postNamedEntry(tx: Tx, params: NamedEntryParams): Promise<PostEntryResult> {
  const resolver = await buildAccountResolver(tx);
  const amount = r3(params.amount);
  const debitId = await resolveNamedSide(tx, params.debit, resolver);
  const creditId = await resolveNamedSide(tx, params.credit, resolver);
  return postJournalEntry(
    tx,
    {
      entryDate: params.entryDate,
      description: params.description,
      sourceType: params.sourceType,
      sourceId: params.sourceId ?? null,
      lines: [
        { accountId: debitId, debit: amount, credit: 0, description: params.debit.name, ...(params.dims || {}) },
        { accountId: creditId, debit: 0, credit: amount, description: params.credit.name, ...(params.dims || {}) },
      ],
    },
    params.actor || "النظام (آلي)"
  );
}

// ==================== المحرك — النشر/الإلغاء/العكس ====================

export interface PostEntryResult {
  id: number;
  entryNo: number;
  totalDebit: number;
  totalCredit: number;
}

/**
 * نشر قيد متوازن — المدخل الوحيد لجداول الأستاذ من كل المصادر.
 * يتحقق: فترة مفتوحة، توازن، حسابات أوراق مسموح نشرها — ثم يرقّم وينشر.
 */
export async function postJournalEntry(
  tx: Tx,
  input: JournalEntryInput,
  actor: string
): Promise<PostEntryResult> {
  const period = await ensurePeriodForDate(tx, input.entryDate);
  if (!period.open) {
    throw new Error(`فترة ${input.entryDate.slice(0, 7)} مقفلة — لا يمكن النشر عليها.`);
  }

  const resolver = await buildAccountResolver(tx);
  const check = validateJournalEntry(input, resolver.accountsById);
  if (!check.ok) throw new Error(check.error || "قيد غير صالح.");

  const entryNo = await nextEntryNo(tx);
  const entry = await tx.journalEntry.create({
    data: {
      entryNo,
      entryDate: input.entryDate,
      description: input.description.trim(),
      status: "posted",
      sourceType: input.sourceType || "manual",
      sourceId: input.sourceId ?? null,
      reversalOfId: input.reversalOfId ?? null,
      postedAt: new Date(),
      postedBy: actor,
      createdBy: actor,
    },
  });

  const lineRows = input.lines.map((l, i) => ({
    entryId: entry.id,
    accountId: l.accountId,
    debit: new Prisma.Decimal(r3(l.debit)),
    credit: new Prisma.Decimal(r3(l.credit)),
    description: (l.description || "").trim(),
    customerId: l.customerId ?? null,
    contractId: l.contractId ?? null,
    subContractId: l.subContractId ?? null,
    boqItemId: l.boqItemId ?? null,
    projectId: l.projectId ?? null,
    employeeId: l.employeeId ?? null,
    costCenter: (l.costCenter || "").trim(),
    sort: i,
  }));
  await tx.journalLine.createMany({ data: lineRows });

  return { id: entry.id, entryNo, totalDebit: check.totalDebit, totalCredit: check.totalCredit };
}

/** إلغاء قيد — يُستبعد من الأرصدة مع بيان السبب (للمسودات والمنشورة) */
export async function cancelJournalEntry(
  tx: Tx,
  entryId: number,
  reason: string
): Promise<void> {
  const entry = await tx.journalEntry.findFirst({
    where: { id: entryId },
    select: { id: true, status: true, reversalOfId: true },
  });
  if (!entry) throw new Error("القيد غير موجود.");
  if (entry.status === "cancelled") throw new Error("القيد ملغى من قبل.");
  await tx.journalEntry.update({
    where: { id: entry.id },
    data: { status: "cancelled", cancelReason: (reason || "").trim() },
  });
}

/** قيد عكسي مرتبط — تصحيح شفاف: الأصل يبقى منشورًا والعكس يصفِ أثره */
export async function reverseJournalEntry(
  tx: Tx,
  entryId: number,
  reason: string,
  actor: string
): Promise<PostEntryResult> {
  const entry = await tx.journalEntry.findFirst({
    where: { id: entryId },
    include: { lines: { orderBy: { sort: "asc" } } },
  });
  if (!entry) throw new Error("القيد غير موجود.");
  if (entry.status !== "posted") throw new Error("العكس يُبنى على قيد منشور فقط.");

  const today = new Date();
  const entryDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate()
  ).padStart(2, "0")}`;

  const lines: JournalLineInput[] = buildReversalLines(
    entry.lines.map((l) => ({
      accountId: l.accountId,
      debit: Number(l.debit),
      credit: Number(l.credit),
      description: l.description,
      customerId: l.customerId,
      contractId: l.contractId,
      subContractId: l.subContractId,
      boqItemId: l.boqItemId,
      projectId: l.projectId,
      employeeId: l.employeeId,
      costCenter: l.costCenter,
    }))
  );

  return postJournalEntry(
    tx,
    {
      entryDate,
      description: `قيد عكسي للقيد #${entry.entryNo} — ${reason || entry.description}`,
      sourceType: "reversal",
      sourceId: entry.id,
      reversalOfId: entry.id,
      lines,
    },
    actor
  );
}

// ==================== ترحيل القيود النصية القديمة ====================

export interface MigrateLegacyOutcome {
  migrated: number;
  suspenseCount: number;
  unmatchedNames: string[];
}

/**
 * ترحيل صفوف قديمة (من أرشيف JSON أو استعادة نسخة قديمة) داخل نطاق الشركة.
 * resolve من buildAccountResolver + الشك لحساب التسوية، بنشر مباشر عبر المحرك.
 */
export async function migrateLegacyRows(
  tx: Tx,
  rows: LegacyJournalRow[],
  actor: string
): Promise<MigrateLegacyOutcome> {
  if (!rows.length) return { migrated: 0, suspenseCount: 0, unmatchedNames: [] };
  const resolver = await buildAccountResolver(tx);
  const suspenseResolved = migrateLegacyJournalRows(
    rows,
    resolver.resolve,
    resolver.suspenseId
  );
  const outcome: MigrateLegacyOutcome = {
    migrated: 0,
    suspenseCount: suspenseResolved.suspenseUsed,
    unmatchedNames: Array.from(new Set(suspenseResolved.unmatched.map((u) => u.name))).filter(Boolean),
  };
  for (const e of suspenseResolved.entries) {
    await postJournalEntry(
      tx,
      {
        entryDate: e.entryDate,
        description: e.description,
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        lines: e.lines,
      },
      actor
    );
    outcome.migrated++;
  }
  return outcome;
}

export { TX_OPTS };
export type { JournalEntryInput, JournalLineInput, JournalLineDims } from "@/lib/accounting-journal";
