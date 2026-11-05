import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { r3 } from "@/lib/accounting-journal";
import {
  buildClosingLines,
  buildOpeningTrialRows,
  CLOSE_SOURCE_TYPE,
  closingEntryDescription,
  validateYearForClose,
  validatePeriodToggle,
  type OpeningSourceRow,
  type OpeningTrialResult,
  type PnlAccountBalance,
} from "@/lib/fiscal-close-core";
import { cancelJournalEntry, ensureFiscalYear, postJournalEntry, TX_OPTS } from "@/lib/journal-server";
import { audit } from "@/lib/api-utils";

/**
 * fiscal-close-server.ts — طبقة خادم الفترات والإقفال — Task 109.
 * كل الأرقام من الأستاذ (JournalLine posted حصرًا) داخل سياق الشركة (غلاف db)،
 * والإقفال السنوي ذري داخل معاملة واحدة: حساب النتيجة ⇒ نشر قيد الإغلاق عبر
 * المحرك الموحد ⇒ قفل فترات السنة ⇒ افتتاح السنة التالية ⇒ توثيق السجل + التدقيق.
 * الإعادة للفتح: إلغاء قيد الإغلاق عبر المحرك (موثق بالسبب) + فتح الفترات —
 * لأحدث سنة مقفلة حصرًا (لا يُقفل تراجعًا).
 */

type Tx = Prisma.TransactionClient;
type DbClient = Tx | PrismaClient;

/** حساب الأرباح المحتجزة: بالكود 3300 ثم بعنصر XBRL ثم خطأ صريح */
export async function resolveRetainedEarnings(client: DbClient): Promise<{ id: number; name: string }> {
  const byCode = await client.account.findFirst({
    where: { code: "3300", isActive: true },
    select: { id: true, name: true },
  });
  if (byCode) return byCode;
  const byXbrl = await client.account.findFirst({
    where: { xbrlElement: "ifrs-full:RetainedEarnings", isActive: true },
    select: { id: true, name: true },
  });
  if (byXbrl) return byXbrl;
  throw new Error("حساب الأرباح المحتجزة (3300) غير موجود في الدليل — لا يمكن الإقفال السنوي.");
}

// ==================== نتيجة السنة من الأستاذ ====================

export interface YearPnlResult {
  year: number;
  rows: PnlAccountBalance[];
  totalRevenue: number;
  totalExpense: number;
  net: number;
}

/**
 * نتيجة السنة (حركة الدخل داخل السنة حصرًا من القيود posted — قيود الإغلاق الملغاة
 * تُستبعد تلقائيًا بفلتر posted، وقيد الإغلاق الفعلي لسنة سابقة يقع خارج نطاق التاريخ).
 */
export async function computeYearPnl(client: DbClient, year: number): Promise<YearPnlResult> {
  const accounts = await client.account.findMany({
    where: { type: { in: ["revenue", "expense"] }, isActive: true },
    select: { id: true, code: true, name: true, type: true },
  });
  const ids = accounts.map((a) => a.id);

  const rows: PnlAccountBalance[] = accounts
    .map((a) => ({ accountId: a.id, code: a.code, name: a.name, type: a.type as "revenue" | "expense", signed: 0 }));

  if (ids.length) {
    const lines = await client.journalLine.findMany({
      where: {
        accountId: { in: ids },
        entry: { status: "posted", entryDate: { gte: `${year}-01-01`, lte: `${year}-12-31` } },
      },
      select: { accountId: true, debit: true, credit: true },
    });
    const byId = new Map(rows.map((r) => [r.accountId, r]));
    for (const l of lines) {
      const row = byId.get(l.accountId);
      if (row) row.signed = r3(row.signed + Number(l.debit) - Number(l.credit));
    }
  }

  const active = rows.filter((r) => r.signed !== 0);
  const totalRevenue = r3(-active.filter((r) => r.type === "revenue").reduce((s, r) => s + r.signed, 0));
  const totalExpense = r3(active.filter((r) => r.type === "expense").reduce((s, r) => s + r.signed, 0));
  return { year, rows: active, totalRevenue, totalExpense, net: r3(totalRevenue - totalExpense) };
}

// ==================== الإقفال السنوي الذري ====================

export interface CloseYearOutcome {
  year: number;
  recordId: number;
  entryNo: number | null;
  totalRevenue: number;
  totalExpense: number;
  net: number;
  linesCount: number;
}

export async function closeFiscalYearTx(
  tx: Tx,
  year: number,
  actor: string,
  notes: string
): Promise<CloseYearOutcome> {
  const badYear = validateYearForClose(year);
  if (badYear) throw new Error(badYear);

  const existing = await tx.fiscalClosing.findFirst({ where: { year }, select: { id: true, status: true } });
  if (existing && existing.status === "closed") {
    throw new Error(`سنة ${year} مقفلة من قبل — أعد فتحها أولًا إن أردت الإغلاق من جديد.`);
  }

  // لا إقفال تراجعي: السنة التالية مقفلة ⇒ أعد فتحها أولًا
  const nextClosed = await tx.fiscalClosing.findFirst({
    where: { year: year + 1, status: "closed" },
    select: { id: true },
  });
  if (nextClosed) {
    throw new Error(`سنة ${year + 1} التالية مقفلة — لا يُقفل تراجعًا؛ أعد فتح السنوات من الأحدث أولًا.`);
  }

  await ensureFiscalYear(tx, year);
  const fy = await tx.fiscalYear.findFirst({ where: { year }, select: { id: true } });
  if (!fy) throw new Error("تعذر تجهيز السنة المالية.");

  const pnl = await computeYearPnl(tx, year);

  // قيد الإغلاق — فقط عند وجود حركة دخل (سنة بلا حركة تُقفل بلا قيد — موثق في السجل)
  let closingEntryId: number | null = null;
  let entryNo: number | null = null;
  let linesCount = 0;

  if (pnl.rows.length) {
    const retained = await resolveRetainedEarnings(tx);
    const built = buildClosingLines(pnl.rows, retained);
    if (built) {
      // ديسمبر يجب أن يقبل قيد الإغلاق — يعاد فتحه مؤقتًا داخل المعاملة ثم تُقفل السنة كلها بعده
      const decKey = `${year}-12`;
      const dec = await tx.fiscalPeriod.findFirst({ where: { periodDate: decKey }, select: { id: true, status: true } });
      if (dec && dec.status === "closed") {
        await tx.fiscalPeriod.update({ where: { id: dec.id }, data: { status: "open" } });
      }
      const posted = await postJournalEntry(
        tx,
        {
          entryDate: `${year}-12-31`,
          description: closingEntryDescription(year),
          sourceType: CLOSE_SOURCE_TYPE,
          lines: built.lines,
        },
        actor
      );
      closingEntryId = posted.id;
      entryNo = posted.entryNo;
      linesCount = built.lines.length;
    }
  }

  // قفل فترات السنة كلها + السنة نفسها
  await tx.fiscalPeriod.updateMany({ where: { fiscalYearId: fy.id }, data: { status: "closed" } });
  await tx.fiscalYear.update({ where: { id: fy.id }, data: { status: "closed" } });

  // افتتاح السنة الجديدة: سنة + 12 فترة مفتوحة (الأرصدة تُحمل آليًا في الأستاذ المستمر)
  await ensureFiscalYear(tx, year + 1);

  // ميزان الافتتاحية الموثق — أرصدة نهاية السنة بعد الإغلاق (النتيجة صفر والنتج في المحتجزة)
  const openingSnapshot = await buildOpeningSnapshotTx(tx, `${year}-12-31`);

  const values = {
    year,
    status: "closed" as const,
    closingEntryId,
    totalRevenue: pnl.totalRevenue,
    totalExpense: pnl.totalExpense,
    netResult: pnl.net,
    linesCount,
    openingSnapshot: openingSnapshot as unknown as Prisma.InputJsonValue,
    notes: (notes || "").trim(),
    closedBy: actor,
    closedAt: new Date(),
    revertedAt: null,
    revertReason: "",
  };

  const record = existing
    ? await tx.fiscalClosing.update({ where: { id: existing.id }, data: values })
    : await tx.fiscalClosing.create({ data: values });

  await audit(tx, {
    username: actor,
    action: "fiscal_year_close",
    entityType: "fiscal_year",
    entityId: year,
    entityName: `إقفال سنة ${year}`,
    newStatus: "closed",
    reason: notes || "",
  });

  return {
    year,
    recordId: record.id,
    entryNo,
    totalRevenue: pnl.totalRevenue,
    totalExpense: pnl.totalExpense,
    net: pnl.net,
    linesCount,
  };
}

// ==================== الإعادة للفتح ====================

export interface ReopenYearOutcome {
  year: number;
  cancelledEntry: boolean;
}

export async function reopenFiscalYearTx(
  tx: Tx,
  year: number,
  actor: string,
  reason: string
): Promise<ReopenYearOutcome> {
  if (!String(reason || "").trim()) {
    throw new Error("سبب إعادة الفتح مطلوب (يُوثق في السجل).");
  }
  const record = await tx.fiscalClosing.findFirst({
    where: { year },
    select: { id: true, status: true, closingEntryId: true },
  });
  if (!record || record.status !== "closed") {
    throw new Error(`سنة ${year} ليست مقفلة — لا شيء لإعادته للفتح.`);
  }

  // أحدث سنة مقفلة حصرًا
  const later = await tx.fiscalClosing.findFirst({
    where: { year: { gt: year }, status: "closed" },
    select: { id: true },
  });
  if (later) {
    throw new Error("أعد فتح آخر سنة مقفلة فقط — قلّ الترتيب من الأحدث.");
  }

  let cancelledEntry = false;
  if (record.closingEntryId) {
    await cancelJournalEntry(tx, record.closingEntryId, `إعادة فتح سنة ${year}: ${reason.trim()}`);
    cancelledEntry = true;
  }

  const fy = await tx.fiscalYear.findFirst({ where: { year }, select: { id: true } });
  if (fy) {
    await tx.fiscalPeriod.updateMany({ where: { fiscalYearId: fy.id }, data: { status: "open" } });
    await tx.fiscalYear.update({ where: { id: fy.id }, data: { status: "open" } });
  }

  await tx.fiscalClosing.update({
    where: { id: record.id },
    data: { status: "reverted", revertedAt: new Date(), revertReason: reason.trim() },
  });

  await audit(tx, {
    username: actor,
    action: "fiscal_year_reopen",
    entityType: "fiscal_year",
    entityId: year,
    entityName: `إعادة فتح سنة ${year}`,
    oldStatus: "closed",
    newStatus: "open",
    reason: reason.trim(),
  });

  return { year, cancelledEntry };
}

// ==================== ميزان الافتتاحية ====================

/** أرصدة الحسابات حتى تاريخ (نهاية سنة مقفلة) — يُستخدم للسجل الموثق وللواجهة */
async function buildOpeningSnapshotTx(tx: DbClient, asOf: string): Promise<OpeningTrialResult> {
  const [accounts, agg] = await Promise.all([
    tx.account.findMany({
      select: { id: true, code: true, name: true, type: true, openingBalance: true },
      orderBy: { code: "asc" },
    }),
    tx.journalLine.groupBy({
      by: ["accountId"],
      where: { entry: { status: "posted", entryDate: { lte: asOf } } },
      _sum: { debit: true, credit: true },
    }),
  ]);
  const aggById = new Map(agg.map((a) => [a.accountId, a._sum]));
  const src: OpeningSourceRow[] = accounts.map((a) => ({
    accountId: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    opening: r3(Number(a.openingBalance)),
    movementDr: r3(Number(aggById.get(a.id)?.debit ?? 0)),
    movementCr: r3(Number(aggById.get(a.id)?.credit ?? 0)),
  }));
  return buildOpeningTrialRows(src);
}

/** افتتاحية سنة معينة = أرصدة نهاية السنة السابقة (بعد إغلاق نتيجتها إن أُقفلت) */
export async function buildOpeningTrialBalance(year: number): Promise<{
  year: number;
  asOf: string;
  priorYearClosed: boolean;
  result: OpeningTrialResult;
}> {
  const asOf = `${year - 1}-12-31`;
  const prior = await db.fiscalClosing.findFirst({
    where: { year: year - 1 },
    select: { status: true },
  });
  const result = await buildOpeningSnapshotTx(db, asOf);
  return { year, asOf, priorYearClosed: prior?.status === "closed", result };
}

// ==================== تبديل حالة فترة شهرية ====================

export async function toggleFiscalPeriod(
  tx: Tx,
  periodId: number,
  action: "open" | "close",
  actor: string,
  reason: string
): Promise<{ periodDate: string; status: string }> {
  const period = await tx.fiscalPeriod.findFirst({
    where: { id: periodId },
    select: { id: true, periodDate: true, status: true, fiscalYear: { select: { year: true, status: true } } },
  });
  if (!period) throw new Error("الفترة غير موجودة.");

  const blocked = validatePeriodToggle(action, period.fiscalYear.status);
  if (blocked) throw new Error(blocked);
  if (action === "open" && !String(reason || "").trim()) {
    throw new Error("سبب إعادة فتح الفترة مطلوب (يُوثق في التدقيق).");
  }

  // لا تغيير — سلوك idempotent (مقارنة بحالة النموذج الفعلية open|closed)
  const already = action === "close" ? period.status === "closed" : period.status === "open";
  if (already) {
    return { periodDate: period.periodDate, status: period.status };
  }

  // اتفاقية الحالة في النموذج: "open" | "closed" — إجراء الفتح/القفل "open"/"close" يترجم لها
  const targetStatus = action === "close" ? "closed" : "open";
  await tx.fiscalPeriod.update({ where: { id: period.id }, data: { status: targetStatus } });

  await audit(tx, {
    username: actor,
    action: "fiscal_period_toggle",
    entityType: "fiscal_period",
    entityId: period.id,
    entityName: `${period.fiscalYear.year} / ${period.periodDate}`,
    oldStatus: period.status,
    newStatus: targetStatus,
    reason: (reason || "").trim(),
  });

  return { periodDate: period.periodDate, status: targetStatus };
}

export { TX_OPTS };
