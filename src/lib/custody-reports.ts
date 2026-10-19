import "server-only";
import { db } from "@/lib/db";

/**
 * جلب البيانات لتقارير العُهد السبعة — ترحيل أمين لمركز العُهد المكتبي (V9.15.18).
 * البناة الحسابية النقية في custody-reports-core.ts (مقفولة بالاختبارات ضد المكتبي).
 */

import {
  aggregateBalances,
  buildDetailedRows,
  buildLedgerItems,
  buildMonthlyRows,
  buildOpenItems,
  buildSettlementsSummary,
  filterSearchAndBalance,
  type CustodyBalanceRow,
  type CustodyDetailedRow,
  type CustodyLedgerItem,
  type CustodyLedgerReport,
  type CustodyMonthlyRow,
  type CustodyOpenItem,
  type HandoverStat,
  type LedgerDetailInput,
  type SettlementSummaryRow,
} from "@/lib/custody-reports-core";
import { r3 } from "@/lib/contrack-core";

export {
  aggregateBalances,
  buildDetailedRows,
  buildLedgerItems,
  buildMonthlyRows,
  buildOpenItems,
  buildSettlementsSummary,
  filterSearchAndBalance,
} from "@/lib/custody-reports-core";
export type {
  CustodyBalanceRow,
  CustodyDetailedRow,
  CustodyLedgerItem,
  CustodyLedgerReport,
  CustodyMonthlyRow,
  CustodyOpenItem,
  SettlementSummaryRow,
} from "@/lib/custody-reports-core";

const todayStr = () => new Date().toISOString().slice(0, 10);

const dateRange = (from: string, to: string) =>
  from || to
    ? { vdate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
    : {};

// ==================== أرصدة العهد (custody_balances 3425) ====================

export async function custodyBalancesReport(from: string, to: string): Promise<CustodyBalanceRow[]> {
  const rows = await db.voucher.findMany({
    where: {
      vtype: { in: ["payment", "custody_return"] },
      cancelled: false,
      custodyAccountId: { not: null },
      ...dateRange(from, to),
    },
    select: {
      custodyAccountId: true,
      custodyAccountSnapshot: true,
      vtype: true,
      amount: true,
      expenseGroupRef: true,
    },
    orderBy: { id: "asc" },
  });
  return aggregateBalances(rows);
}

/** مرآة custody_accounts (3528): الحسابات ذات الحركة، وإلا كل حسابات advance بالأصفار */
export async function custodyAccountsForReports(): Promise<CustodyBalanceRow[]> {
  const rows = await custodyBalancesReport("", "");
  if (rows.length) return rows;
  const accs = await db.expenseAccount.findMany({
    where: { accountKind: "advance" },
    orderBy: { id: "asc" },
    select: { id: true, name: true },
  });
  return accs.map((a) => ({
    accountId: a.id,
    account: a.name,
    handed: 0,
    spent: 0,
    returned: 0,
    balance: 0,
    handedCount: 0,
    spentCount: 0,
    returnedCount: 0,
    settlements: 0,
  }));
}

// ==================== العهد المعلقة (custody_open_items 3483) ====================

export async function custodyOpenItemsReport(asOf = ""): Promise<CustodyOpenItem[]> {
  const asOfDate = (asOf || "").trim() || todayStr();
  const bals = await custodyBalancesReport("", "");
  if (!bals.length) return [];
  const handoverStats = await db.voucher.groupBy({
    by: ["custodyAccountId"],
    where: {
      vtype: "payment",
      cancelled: false,
      custodyAccountId: { not: null },
      expenseGroupRef: "",
    },
    _min: { vdate: true },
    _count: { _all: true },
  });
  const stats: HandoverStat[] = handoverStats.map((g) => ({
    accountId: g.custodyAccountId as number,
    oldest: g._min.vdate || "",
    count: g._count._all,
  }));
  return buildOpenItems(bals, stats, asOfDate);
}

// ==================== التصفيات المجمع (settlements_summary 3913) ====================

export async function settlementsSummaryReport(
  from: string,
  to: string,
  accountId?: number | null
): Promise<{ rows: SettlementSummaryRow[]; count: number; total: number }> {
  const where = {
    cancelled: false,
    expenseGroupRef: { not: "" },
    custodyAccountId: { not: null },
    ...(accountId ? { custodyAccountId: accountId } : {}),
    ...dateRange(from, to),
  };
  const rows = await db.voucher.findMany({
    where,
    select: {
      expenseGroupRef: true,
      vdate: true,
      amount: true,
      custodyAccountId: true,
      custodyAccountSnapshot: true,
      voucherNumber: true,
    },
    orderBy: [{ vdate: "asc" }, { id: "asc" }],
  });
  const refs = [...new Set(rows.map((r) => r.expenseGroupRef))];
  const detailsRows = refs.length
    ? await db.voucher.findMany({
        where: { expenseGroupRef: { in: refs }, cancelled: false },
        select: {
          expenseGroupRef: true,
          voucherNumber: true,
          vdate: true,
          party: true,
          expenseAccountSnapshot: true,
          amount: true,
          description: true,
        },
        orderBy: [{ vdate: "asc" }, { id: "asc" }],
      })
    : [];
  return buildSettlementsSummary(rows, detailsRows);
}

// ==================== الكشف الموحد (custody_ledger 3544) ====================

export async function custodyLedgerReport(
  accountId: number | null,
  dateFrom: string,
  dateTo: string,
  search = ""
): Promise<CustodyLedgerReport> {
  const accounts = await custodyAccountsForReports();
  let accId = accountId;
  if (accId == null && accounts.length === 1) accId = accounts[0].accountId;

  const accWhere = accId ? { custodyAccountId: accId } : {};
  const baseWhere = {
    vtype: "payment",
    cancelled: false,
    custodyAccountId: { not: null },
    ...accWhere,
    ...dateRange(dateFrom, dateTo),
  };

  const [handoverRows, groupRows, returnRows] = await Promise.all([
    db.voucher.findMany({
      where: { ...baseWhere, expenseGroupRef: "" },
      select: {
        id: true, voucherNumber: true, vdate: true, party: true, description: true, amount: true,
        custodyAccountId: true, custodyAccountSnapshot: true,
      },
      orderBy: [{ vdate: "asc" }, { id: "asc" }],
    }),
    db.voucher.findMany({
      where: { ...baseWhere, expenseGroupRef: { not: "" } },
      select: {
        expenseGroupRef: true, vdate: true, id: true, description: true, amount: true,
        custodyAccountId: true, custodyAccountSnapshot: true,
      },
      orderBy: [{ vdate: "asc" }, { id: "asc" }],
    }),
    db.voucher.findMany({
      where: {
        vtype: "custody_return",
        cancelled: false,
        custodyAccountId: { not: null },
        ...accWhere,
        ...dateRange(dateFrom, dateTo),
      },
      select: {
        id: true, voucherNumber: true, vdate: true, party: true, description: true, amount: true,
        custodyAccountId: true, custodyAccountSnapshot: true,
      },
      orderBy: [{ vdate: "asc" }, { id: "asc" }],
    }),
  ]);

  // مرآة list_vouchers(vtype='payment') — بلا فلتر ملغى وvtype IN (payment, transfer)
  const refs = [...new Set(groupRows.map((g) => g.expenseGroupRef))];
  const detailRows = refs.length
    ? await db.voucher.findMany({
        where: { vtype: { in: ["payment", "transfer"] }, expenseGroupRef: { in: refs } },
        select: {
          id: true, voucherNumber: true, vdate: true, party: true, description: true, amount: true,
          expenseAccountSnapshot: true, expenseGroupRef: true,
          contract: { select: { contractNumber: true } },
        },
        orderBy: { id: "desc" },
      })
    : [];
  const detailInputs: LedgerDetailInput[] = detailRows.map((d) => ({
    id: d.id,
    voucherNumber: d.voucherNumber,
    vdate: d.vdate,
    party: d.party,
    description: d.description,
    amount: d.amount,
    expenseAccountSnapshot: d.expenseAccountSnapshot,
    expenseGroupRef: d.expenseGroupRef,
    contractNumber: d.contract?.contractNumber || "",
  }));

  const items = buildLedgerItems(handoverRows, returnRows, groupRows, detailInputs);
  const rows = filterSearchAndBalance(items, search);

  let totalIn = 0;
  let totalOut = 0;
  for (const item of rows) {
    totalIn += item.in;
    totalOut += item.out;
  }
  return {
    accounts,
    accountId: accId ?? null,
    rows,
    totals: { in: totalIn, out: totalOut, balance: r3(totalIn - totalOut) },
    dateFrom,
    dateTo,
    search,
  };
}

// ==================== تفصيلي بالحركة (custody_detailed_report 3681) ====================

export async function custodyDetailedReport(
  dateFrom: string,
  dateTo: string,
  accountId: number | null
): Promise<{ rows: CustodyDetailedRow[]; totals: { in: number; out: number; balance: number }; count: number; accounts: CustodyBalanceRow[] }> {
  const data = await custodyLedgerReport(accountId, dateFrom, dateTo, "");
  const built = buildDetailedRows(data.rows);
  return { ...built, count: built.rows.length, accounts: data.accounts };
}

// ==================== الملخص الشهري (custody_monthly_summary 3746) ====================

export async function custodyMonthlySummary(
  dateFrom: string,
  dateTo: string,
  accountId: number | null
): Promise<{ rows: CustodyMonthlyRow[]; totals: { handed: number; spent: number; returned: number }; dateFrom: string; dateTo: string }> {
  const data = await custodyLedgerReport(accountId, "", dateTo || "", "");
  const built = buildMonthlyRows(data.rows, dateFrom);
  return { ...built, dateFrom, dateTo };
}

// ==================== كشف العهد المسلّمة (custody_handover_list 3802) ====================

export interface CustodyHandoverRow {
  id: number;
  ref: string;
  vdate: string;
  party: string;
  description: string;
  amount: number;
  method: string;
  notes: string;
  custodyAccountId: number | null;
  custodyAccount: string;
}

export async function custodyHandoverListReport(
  dateFrom: string,
  dateTo: string,
  accountId: number | null
): Promise<CustodyHandoverRow[]> {
  const rows = await db.voucher.findMany({
    where: {
      vtype: "payment",
      cancelled: false,
      custodyAccountId: { not: null },
      expenseGroupRef: "",
      ...(accountId ? { custodyAccountId: accountId } : {}),
      ...dateRange(dateFrom, dateTo),
    },
    select: {
      id: true, voucherNumber: true, vdate: true, party: true, description: true,
      amount: true, method: true, notes: true,
      custodyAccountId: true, custodyAccountSnapshot: true,
    },
    orderBy: [{ vdate: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    ref: r.voucherNumber,
    vdate: r.vdate,
    party: r.party,
    description: r.description,
    amount: Number(r.amount),
    method: r.method,
    notes: r.notes,
    custodyAccountId: r.custodyAccountId,
    custodyAccount: r.custodyAccountSnapshot,
  }));
}
