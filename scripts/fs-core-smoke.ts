import {
  buildIncomeStatement, buildBalanceSheet, buildEquityChanges, buildCashFlow,
  validateStatements, defaultCashFlowKind, resolveCashFlowKind,
  type FsAccountRow, type CashCounterpartRaw,
} from "/home/z/my-project/src/lib/financial-statements-core";

const row = (o: Partial<FsAccountRow> & { code: string; type: string }): FsAccountRow => ({
  accountId: 0, name: o.code, nature: "debit", xbrlElement: "", cashFlowKind: "",
  opening: 0, periodDr: 0, periodCr: 0, closing: 0, ...o,
});

// سيناريو متوازن: نقد 1000 (افتتاحي)، إيراد 500 عبر نقد، مصروف 200 نقد، شراء سيارة 300 نقد، رأس مال 1600
const rows: FsAccountRow[] = [
  row({ code: "1111", type: "asset", opening: 1000, periodDr: 1600, closing: 2600 }),
  row({ code: "1212", type: "asset", periodDr: 300, closing: 300 }),
  row({ code: "3100", type: "equity", periodCr: 2600, closing: -2600 }),
  row({ code: "4100", type: "revenue", periodCr: 500, closing: -500 }),
  row({ code: "5230", type: "expense", periodDr: 200, closing: 200 }),
];

const inc = buildIncomeStatement(rows, "2026-01-01", "2026-12-31");
console.log("IS: revenue", inc.revenue.total, "expenses", inc.expensesTotal, "net", inc.netResult, "sections", inc.expenses.map(e=>e.title));

const bs = buildBalanceSheet(rows, "2026-12-31", inc.netResult);
console.log("BS: assets", bs.totalAssets, "L+E", bs.totalLiabilitiesEquity, "balanced", bs.balanced, "diff", bs.diff);

const eq = buildEquityChanges(rows, "2026-01-01", "2026-12-31", inc.netResult);
console.log("EQ: closing", eq.closingTotal, "actual", eq.closingActual, "consistent", eq.consistent);

const cf = buildCashFlow(
  [rows[0]],
  [
    { code: "4100", name: "إيرادات العقود", type: "revenue", cashFlowKind: "", debit: 0, credit: 500 },
    { code: "5230", name: "كهرباء وماء", type: "expense", cashFlowKind: "", debit: 200, credit: 0 },
    { code: "1212", name: "سيارات", type: "asset", cashFlowKind: "", debit: 300, credit: 0 },
    { code: "3100", name: "رأس المال", type: "equity", cashFlowKind: "", debit: 0, credit: 2600 },
  ],
  "2026-01-01", "2026-12-31"
);
console.log("CF: op", cf.totals.operating, "inv", cf.totals.investing, "fin", cf.totals.financing, "net", cf.totals.net, "delta", cf.cashDelta, "reconciles", cf.reconciles);

const checks = validateStatements({ trialDiff: rows.reduce((s,r)=>s+r.closing,0), bs, cf, eq });
console.log("checks allPassed:", checks.allPassed, "notes:", checks.notes);

// الاشتقاق الهيكلي
console.log("kinds:", defaultCashFlowKind("1121","asset"), defaultCashFlowKind("1211","asset"), defaultCashFlowKind("3100","equity"), defaultCashFlowKind("2210","liability"), defaultCashFlowKind("5210","expense"), defaultCashFlowKind("1112","asset"), resolveCashFlowKind("1121","asset","financing"));

// تحويل نقد↔نقد يُستثنى
const cf2 = buildCashFlow([rows[0]], [
  { code: "1112", name: "البنك", type: "asset", cashFlowKind: "", debit: 100, credit: 0 },
  { code: "1111", name: "الصندوق", type: "asset", cashFlowKind: "", debit: 0, credit: 100 },
], "2026-01-01", "2026-12-31");
console.log("CF transfers: net", cf2.totals.net, "reconciles", cf2.reconciles, "(delta 0 expected)");
