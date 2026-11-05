import "server-only";
import { db, currentCompanyId } from "@/lib/db";
import { r3 } from "@/lib/accounting-journal";
import {
  buildBalanceSheet,
  buildCashFlow,
  buildEquityChanges,
  buildIncomeStatement,
  validateStatements,
  type BalanceSheetResult,
  type CashCounterpartRaw,
  type CashFlowResult,
  type EquityChangesResult,
  type FsAccountRow,
  type IncomeStatementResult,
  type StatementsChecks,
} from "@/lib/financial-statements-core";

/**
 * financial-statements-server.ts — بناة القوائم المالية من الأستاذ — Task 110.
 * كل الأرقام من JournalLine بالقيود posted حصرًا + الرصيد الافتتاحي المخزَّن على الحساب،
 * والتجميع الثقيل بالـSQL (groupBy) داخل سياق الشركة. التدفقات النقدية تُشتق من الأطراف
 * المقابلة لقيود لمست حسابات النقد (111x ورقة) — التحويلات نقد↔نقد مستثناة تلقائيًا.
 *
 * مدخلات القوائم:
 *  • asOf — تاريخ المركز المالي وإقفال كل القوائم
 *  • from — بداية فترة الدخل/الحركة (الافتراضي: أول يوم في سنة asOf المالية)
 *    (أول يوم سنة مالية من جدول السنوات إن وُجد وإلا 1 يناير التقويمية)
 */

const CASH_CODE_LIKE = "111%";

export interface FinancialStatementsResult {
  asOf: string;
  from: string;
  income: IncomeStatementResult;
  balanceSheet: BalanceSheetResult;
  equity: EquityChangesResult;
  cashflow: CashFlowResult;
  checks: StatementsChecks;
}

/** أول يوم في السنة المالية لـ asOf — السنوات هنا تقويمية (فترات T109 شهريًا على سنوات كاملة) */
function fiscalYearStart(asOf: string): string {
  return `${asOf.slice(0, 4)}-01-01`;
}

export async function buildFinancialStatements(opts: { asOf: string; from?: string }): Promise<FinancialStatementsResult> {
  const asOf = opts.asOf;
  const from = opts.from && /^\d{4}-\d{2}-\d{2}$/.test(opts.from) ? opts.from : fiscalYearStart(asOf);

  const [accounts, openingAgg, periodAgg] = await Promise.all([
    db.account.findMany({
      select: {
        id: true, code: true, name: true, type: true, nature: true,
        xbrlElement: true, cashFlowKind: true, openingBalance: true,
        parentId: true, isLeaf: true,
      },
      orderBy: { code: "asc" },
    }),
    db.journalLine.groupBy({
      by: ["accountId"],
      where: { entry: { status: "posted", entryDate: { lt: from } } },
      _sum: { debit: true, credit: true },
    }),
    db.journalLine.groupBy({
      by: ["accountId"],
      where: { entry: { status: "posted", entryDate: { gte: from, lte: asOf } } },
      _sum: { debit: true, credit: true },
    }),
  ]);

  const openingBy = new Map(openingAgg.map((a) => [a.accountId, a._sum]));
  const periodBy = new Map(periodAgg.map((a) => [a.accountId, a._sum]));
  const nameById = new Map(accounts.map((a) => [a.id, a.name]));
  const codeById = new Map(accounts.map((a) => [a.id, a.code]));

  const rows: FsAccountRow[] = [];
  let trialDiff = 0;

  for (const acc of accounts) {
    const o = openingBy.get(acc.id);
    const p = periodBy.get(acc.id);
    const preDr = r3(Number(o?.debit ?? 0));
    const preCr = r3(Number(o?.credit ?? 0));
    const periodDr = r3(Number(p?.debit ?? 0));
    const periodCr = r3(Number(p?.credit ?? 0));
    const opening = r3(Number(acc.openingBalance) + preDr - preCr);
    const closing = r3(opening + periodDr - periodCr);
    if (opening === 0 && periodDr === 0 && periodCr === 0) continue;
    trialDiff = r3(trialDiff + closing);
    rows.push({
      accountId: acc.id,
      code: acc.code,
      name: acc.name,
      type: acc.type,
      nature: acc.nature,
      xbrlElement: acc.xbrlElement || "",
      cashFlowKind: acc.cashFlowKind || "",
      opening,
      periodDr,
      periodCr,
      closing,
      parentCode: acc.parentId ? codeById.get(acc.parentId) : undefined,
      parentName: acc.parentId ? nameById.get(acc.parentId) : undefined,
    });
  }

  // قائمة الدخل للفترة + نتيجة السنة الجارية التراكمية للمركز المالي
  const income = buildIncomeStatement(rows, from, asOf);
  const cumulativeResult = r3(
    rows.filter((r) => r.type === "revenue").reduce((s, r) => s - r.closing, 0) -
      rows.filter((r) => r.type === "expense").reduce((s, r) => s + r.closing, 0)
  );

  const balanceSheet = buildBalanceSheet(rows, asOf, cumulativeResult);
  const equity = buildEquityChanges(rows, from, asOf, income.netResult);

  // التدفقات النقدية: أرصدة النقد + الأطراف المقابلة لقيود لمست النقد
  const cashRows = rows.filter((r) => r.code.startsWith("111") && r.code !== "1110");
  // $queryRaw لا يمر بغلاف سياق الشركة — الحجب يُضاف صراحةً (درس موثق: بلا company_id
  // تسرّبت أرقام الشركات الأخرى إلى التدفقات — ظهر بفرق مطابق لحركة نقد الشركة الثانية)
  const companyId = await currentCompanyId();
  if (companyId == null) throw new Error("سياق الشركة مفقود لبناء القوائم المالية.");
  const counterpartAgg = await db.$queryRaw<CashCounterpartRaw[]>`
    SELECT a.code, a.name, a.type, a.cash_flow_kind AS cashFlowKind,
           COALESCE(SUM(jl.debit), 0)::float AS debit, COALESCE(SUM(jl.credit), 0)::float AS credit
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id AND je.status = 'posted'
      AND je.entry_date >= ${from} AND je.entry_date <= ${asOf}
    JOIN accounts a ON a.id = jl.account_id
    WHERE jl.company_id = ${companyId} AND je.company_id = ${companyId} AND a.company_id = ${companyId}
      AND jl.entry_id IN (
        SELECT jl2.entry_id FROM journal_lines jl2
        JOIN accounts a2 ON a2.id = jl2.account_id
        WHERE a2.code LIKE ${CASH_CODE_LIKE} AND a2.is_leaf = true AND a2.company_id = ${companyId}
      )
    AND NOT (a.code LIKE ${CASH_CODE_LIKE} AND a.is_leaf = true)
    GROUP BY a.code, a.name, a.type, a.cash_flow_kind
    ORDER BY a.code`;

  const counterparts: CashCounterpartRaw[] = counterpartAgg.map((c) => ({
    code: c.code,
    name: c.name,
    type: c.type,
    cashFlowKind: c.cashFlowKind || "",
    debit: r3(Number(c.debit)),
    credit: r3(Number(c.credit)),
  }));

  const cashflow = buildCashFlow(cashRows, counterparts, from, asOf);

  const checks = validateStatements({ trialDiff, bs: balanceSheet, cf: cashflow, eq: equity });

  return { asOf, from, income, balanceSheet, equity, cashflow, checks };
}
