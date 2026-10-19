import { r3 } from "@/lib/contrack-core";

/**
 * النواة الحسابية النقية لتقارير العُهد السبعة — ترحيل أمين لمركز العُهد المكتبي (V9.15.18):
 * - ui/custody_center.py CustodyReportsWidget (7 تبويبات: 797-807)
 * - lifecycle_service.custody_balances (3425) · custody_open_items (3483)
 *   · custody_ledger (3544) · custody_detailed_report (3681)
 *   · custody_monthly_summary (3746) · settlements_summary (3913)
 * بلا server-only ولا Prisma — تُقفل بالاختبارات ضد سلوك المكتبي حرفيًا.
 * نقطة مطابقة مهمة: تفاصيل التصفيات في الكشف المكتبي تأتي من list_vouchers
 * التي **لا تُفلتر الملغى** (lifecycle_service.py:4297 بلا شرط cancelled)
 * وتشمل vtype IN (payment, transfer) — تُطابق هنا نفس السلوك موثقًا.
 */

const DAY_MS = 86_400_000;

/** مبلغ مرن: رقم أو نص أو Decimal الخاص بـ Prisma (له toNumber) */
export type AmountLike = number | string | { toNumber(): number };

/** تحويل آمن لأي شكل مبلغ إلى number (مرآة float(...) المكتبي) */
export function toNum(v: AmountLike): number {
  if (typeof v === "object") return Number(v.toNumber());
  return Number(v);
}

/** مرآة normalizeArabic (api-utils / search_utils.py) — نسخة نقية للاختبار */
function normalizeArabic(s: string): string {
  return (s || "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .trim()
    .toLowerCase();
}

/** مرآة search_contains المكتبي: احتواء بتطبيع عربي */
function contains(hay: string, q: string): boolean {
  return normalizeArabic(hay).includes(normalizeArabic(q));
}

// ==================== أرصدة العهد (custody_balances) ====================

export interface CustodyBalanceRow {
  accountId: number;
  account: string;
  handed: number;
  spent: number;
  returned: number;
  balance: number;
  handedCount: number;
  spentCount: number;
  returnedCount: number;
  settlements: number;
}

/** صف سند مُقلَّم لأرصدة العهد */
export interface BalanceInputRow {
  custodyAccountId: number | null;
  custodyAccountSnapshot: string;
  vtype: string;
  amount: AmountLike;
  expenseGroupRef: string;
}

/** مرآة تجميع custody_balances — نقية */
export function aggregateBalances(rows: BalanceInputRow[]): CustodyBalanceRow[] {
  interface Acc {
    name: string;
    handed: number;
    spent: number;
    returned: number;
    handedCount: number;
    spentCount: number;
    returnedCount: number;
    refs: Set<string>;
  }
  const accs = new Map<number, Acc>();
  for (const r of rows) {
    const id = r.custodyAccountId as number;
    let a = accs.get(id);
    if (!a) {
      a = { name: "", handed: 0, spent: 0, returned: 0, handedCount: 0, spentCount: 0, returnedCount: 0, refs: new Set() };
      accs.set(id, a);
    }
    // مرآة MAX(custody_account_snapshot) — أعلى قيمة نصية
    if ((r.custodyAccountSnapshot || "") > a.name) a.name = r.custodyAccountSnapshot || "";
    const amt = toNum(r.amount);
    if (r.vtype === "custody_return") {
      a.returned = r3(a.returned + amt);
      a.returnedCount += 1;
    } else if ((r.expenseGroupRef || "") === "") {
      a.handed = r3(a.handed + amt);
      a.handedCount += 1;
    } else {
      a.spent = r3(a.spent + amt);
      a.spentCount += 1;
      a.refs.add(r.expenseGroupRef);
    }
  }
  return [...accs.entries()]
    .map(([accountId, a]) => ({
      accountId,
      account: a.name,
      handed: a.handed,
      spent: a.spent,
      returned: a.returned,
      balance: r3(a.handed - a.spent - a.returned),
      handedCount: a.handedCount,
      spentCount: a.spentCount,
      returnedCount: a.returnedCount,
      settlements: a.refs.size,
    }))
    .sort((x, y) => (x.account < y.account ? -1 : x.account > y.account ? 1 : 0));
}

// ==================== العهد المعلقة (custody_open_items) ====================

export interface CustodyOpenItem {
  accountId: number;
  account: string;
  balance: number;
  handed: number;
  spent: number;
  returned: number;
  oldest: string;
  days: number;
  handovers: number;
}

export interface HandoverStat {
  accountId: number;
  oldest: string;
  count: number;
}

/** مرآة بناء custody_open_items — نقية (bals من balances وstats من تجميع التسليمات) */
export function buildOpenItems(bals: CustodyBalanceRow[], stats: HandoverStat[], asOf: string): CustodyOpenItem[] {
  const out: CustodyOpenItem[] = [];
  const statMap = new Map(stats.map((s) => [s.accountId, s]));
  for (const b of bals) {
    const st = statMap.get(b.accountId);
    if (!st || b.balance <= 0.005) continue;
    const oldest = (st.oldest || "").slice(0, 10);
    let days = 0;
    if (oldest) {
      const diff = Math.round((Date.parse(asOf) - Date.parse(oldest)) / DAY_MS);
      days = Number.isFinite(diff) ? diff : 0;
    }
    out.push({
      accountId: b.accountId,
      account: b.account,
      balance: b.balance,
      handed: b.handed,
      spent: b.spent,
      returned: b.returned,
      oldest,
      days: Math.max(days, 0),
      handovers: st.count,
    });
  }
  out.sort((x, y) => (y.days !== x.days ? y.days - x.days : x.account < y.account ? -1 : 1));
  return out;
}

// ==================== التصفيات المجمع (settlements_summary) ====================

export interface SettlementDetailLine {
  voucherNumber: string;
  vdate: string;
  party: string;
  expenseAccount: string;
  amount: number;
  description: string;
}

export interface SettlementSummaryRow {
  ref: string;
  vdate: string;
  custodyAccountId: number | null;
  custodyAccount: string;
  lines: number;
  total: number;
  description: string;
  details: SettlementDetailLine[];
}

export interface SettlementGroupInput {
  expenseGroupRef: string;
  vdate: string;
  amount: AmountLike;
  custodyAccountId: number | null;
  custodyAccountSnapshot: string;
}

export interface SettlementDetailInput {
  expenseGroupRef: string;
  voucherNumber: string;
  vdate: string;
  party: string;
  expenseAccountSnapshot: string;
  amount: AmountLike;
  description: string;
}

/** مرآة settlements_summary — نقية: ترويسة المجموعات + بنودها + البيان بلا تكرار */
export function buildSettlementsSummary(
  rows: SettlementGroupInput[],
  detailsRows: SettlementDetailInput[]
): { rows: SettlementSummaryRow[]; count: number; total: number } {
  interface G {
    vdate: string;
    lines: number;
    total: number;
    custodyAccountId: number | null;
    custodyAccount: string;
  }
  const groups = new Map<string, G>();
  for (const r of rows) {
    const ref = r.expenseGroupRef;
    let g = groups.get(ref);
    if (!g) {
      g = { vdate: r.vdate, lines: 0, total: 0, custodyAccountId: r.custodyAccountId, custodyAccount: "" };
      groups.set(ref, g);
    }
    if (r.vdate < g.vdate) g.vdate = r.vdate;
    g.lines += 1;
    g.total = r3(g.total + toNum(r.amount));
    if ((r.custodyAccountSnapshot || "") > g.custodyAccount) g.custodyAccount = r.custodyAccountSnapshot || "";
  }
  const details = new Map<string, SettlementDetailLine[]>();
  for (const d of detailsRows) {
    const arr = details.get(d.expenseGroupRef) || [];
    arr.push({
      voucherNumber: d.voucherNumber,
      vdate: d.vdate,
      party: d.party,
      expenseAccount: d.expenseAccountSnapshot,
      amount: toNum(d.amount),
      description: d.description,
    });
    details.set(d.expenseGroupRef, arr);
  }
  const out: SettlementSummaryRow[] = [];
  for (const [ref, g] of groups) {
    const dl = details.get(ref) || [];
    const seen: string[] = [];
    for (const d of dl) {
      const t = (d.description || "").trim();
      if (t && !seen.includes(t)) seen.push(t);
    }
    out.push({
      ref,
      vdate: g.vdate,
      custodyAccountId: g.custodyAccountId,
      custodyAccount: g.custodyAccount,
      lines: g.lines,
      total: g.total,
      description: seen.join("، ") || "تصفية عهدة",
      details: dl,
    });
  }
  out.sort((a, b) => (a.vdate !== b.vdate ? (a.vdate < b.vdate ? -1 : 1) : a.ref < b.ref ? -1 : 1));
  return { rows: out, count: out.length, total: r3(out.reduce((s, g) => s + g.total, 0)) };
}

// ==================== الكشف الموحد (custody_ledger) ====================

export interface LedgerDetailLine {
  id: number;
  voucherNumber: string;
  vdate: string;
  description: string;
  party: string;
  expenseAccountSnapshot: string;
  contractNumber: string;
  amount: number;
}

export interface CustodyLedgerItem {
  kind: "handover" | "return" | "settlement";
  ref: string;
  voucherId: number | null;
  vdate: string;
  description: string;
  in: number;
  out: number;
  balance: number;
  details: LedgerDetailLine[];
  detailsCount: number;
  custodyAccountId: number | null;
  custodyAccount: string;
}

export interface CustodyLedgerReport {
  accounts: CustodyBalanceRow[];
  accountId: number | null;
  rows: CustodyLedgerItem[];
  totals: { in: number; out: number; balance: number };
  dateFrom: string;
  dateTo: string;
  search: string;
}

export interface LedgerHandoverInput {
  id: number;
  voucherNumber: string;
  vdate: string;
  party: string;
  description: string;
  amount: AmountLike;
  custodyAccountId: number | null;
  custodyAccountSnapshot: string;
}

export interface LedgerGroupInput {
  expenseGroupRef: string;
  vdate: string;
  id: number;
  description: string;
  amount: AmountLike;
  custodyAccountId: number | null;
  custodyAccountSnapshot: string;
}

export interface LedgerDetailInput {
  id: number;
  voucherNumber: string;
  vdate: string;
  party: string;
  description: string;
  amount: AmountLike;
  expenseAccountSnapshot: string;
  expenseGroupRef: string;
  contractNumber?: string;
}

/** مرآة بناء عناصر custody_ledger — نقية (ترتيب التفاصيل كما في list_vouchers: id تنازليًا) */
export function buildLedgerItems(
  handoverRows: LedgerHandoverInput[],
  returnRows: LedgerHandoverInput[],
  groupRows: LedgerGroupInput[],
  detailRows: LedgerDetailInput[]
): CustodyLedgerItem[] {
  const items: CustodyLedgerItem[] = [];
  const withParty = (desc: string, party: string) => {
    const d = (desc || "").trim() || "";
    const p = (party || "").trim();
    return p && !d.includes(p) ? `${d} - ${p}` : d;
  };
  for (const h of handoverRows) {
    items.push({
      kind: "handover",
      ref: h.voucherNumber || "",
      voucherId: h.id,
      vdate: h.vdate,
      description: withParty(h.description || "تسليم عهدة", h.party),
      in: toNum(h.amount),
      out: 0,
      balance: 0,
      details: [],
      detailsCount: 0,
      custodyAccountId: h.custodyAccountId,
      custodyAccount: h.custodyAccountSnapshot || "",
    });
  }
  for (const t of returnRows) {
    items.push({
      kind: "return",
      ref: t.voucherNumber || "",
      voucherId: t.id,
      vdate: t.vdate,
      description: withParty(t.description || "إرجاع عهدة", t.party),
      in: 0,
      out: toNum(t.amount),
      balance: 0,
      details: [],
      detailsCount: 0,
      custodyAccountId: t.custodyAccountId,
      custodyAccount: t.custodyAccountSnapshot || "",
    });
  }
  interface Group {
    ref: string;
    vdate: string;
    custodyAccountId: number | null;
    custodyAccount: string;
    description: string;
    linesCount: number;
    amount: number;
    sortId: number;
  }
  const gmap = new Map<string, Group>();
  for (const g of groupRows) {
    const ref = g.expenseGroupRef;
    let e = gmap.get(ref);
    if (!e) {
      e = { ref, vdate: g.vdate, custodyAccountId: g.custodyAccountId, custodyAccount: "", description: g.description, linesCount: 0, amount: 0, sortId: g.id };
      gmap.set(ref, e);
    }
    if (g.vdate < e.vdate) e.vdate = g.vdate;
    if ((g.custodyAccountSnapshot || "") > e.custodyAccount) e.custodyAccount = g.custodyAccountSnapshot || "";
    if ((g.description || "") < e.description) e.description = g.description;
    e.linesCount += 1;
    e.amount = r3(e.amount + toNum(g.amount));
    if (g.id > e.sortId) e.sortId = g.id;
  }
  const detailsMap = new Map<string, LedgerDetailLine[]>();
  for (const d of detailRows) {
    const ref = d.expenseGroupRef;
    const arr = detailsMap.get(ref) || [];
    arr.push({
      id: d.id,
      voucherNumber: d.voucherNumber,
      vdate: d.vdate,
      description: d.description,
      party: d.party,
      expenseAccountSnapshot: d.expenseAccountSnapshot,
      contractNumber: d.contractNumber || "",
      amount: toNum(d.amount),
    });
    detailsMap.set(ref, arr);
  }
  for (const g of gmap.values()) {
    const dl = detailsMap.get(g.ref) || [];
    const seen: string[] = [];
    for (const d of [...dl].sort((a, b) => (a.vdate !== b.vdate ? (a.vdate < b.vdate ? -1 : 1) : a.voucherNumber < b.voucherNumber ? -1 : 1))) {
      const t = (d.description || "").trim();
      if (t && !seen.includes(t)) seen.push(t);
    }
    items.push({
      kind: "settlement",
      ref: g.ref,
      voucherId: null,
      vdate: g.vdate,
      description: seen.join("، ") || (g.description || "تصفية عهدة").trim(),
      in: 0,
      out: g.amount,
      balance: 0,
      details: dl,
      detailsCount: g.linesCount || dl.length,
      custodyAccountId: g.custodyAccountId,
      custodyAccount: g.custodyAccount,
    });
  }
  return items;
}

/** مرآة بحث custody_ledger + الترتيب والرصيد التراكمي — نقية */
export function filterSearchAndBalance(
  items: CustodyLedgerItem[],
  search: string
): CustodyLedgerItem[] {
  let filtered = items;
  const q = (search || "").trim();
  if (q) {
    filtered = items.filter((item) => {
      const hay = ["ref", "description", "vdate", "custodyAccount"].map((k) => String((item as unknown as Record<string, unknown>)[k] ?? "")).join(" ");
      if (contains(hay, q)) return true;
      return (item.details || []).some((d) =>
        contains(
          ["voucherNumber", "description", "party", "expenseAccountSnapshot", "contractNumber"]
            .map((k) => String((d as unknown as Record<string, unknown>)[k] ?? ""))
            .join(" "),
          q
        )
      );
    });
  }
  filtered.sort((a, b) => {
    if (a.vdate !== b.vdate) return a.vdate < b.vdate ? -1 : 1;
    const ra = a.ref || "";
    const rb = b.ref || "";
    if (ra !== rb) return ra < rb ? -1 : 1;
    return (a.voucherId || 0) - (b.voucherId || 0);
  });
  let bal = 0;
  for (const item of filtered) {
    bal = r3(bal + item.in - item.out);
    item.balance = bal;
  }
  return filtered;
}

// ==================== تفصيلي بالحركة (custody_detailed_report) ====================

export interface CustodyDetailedRow {
  vdate: string;
  ref: string;
  account: string;
  custodyAccountId: number | null;
  type: string;
  description: string;
  party: string;
  expense: string;
  customer: string;
  in: number;
  out: number;
  balance: number;
}

/** مرآة custody_detailed_report — نقية (فك التصفيات لبنودها ورصيد لكل حساب) */
export function buildDetailedRows(ledgerRows: CustodyLedgerItem[]): {
  rows: CustodyDetailedRow[];
  totals: { in: number; out: number; balance: number };
} {
  const rows: CustodyDetailedRow[] = [];
  for (const item of ledgerRows) {
    const base = {
      vdate: item.vdate || "",
      ref: item.ref || "",
      account: item.custodyAccount || "",
      custodyAccountId: item.custodyAccountId,
      description: item.description || "",
      party: "",
      expense: "",
      customer: "",
    };
    if (item.kind === "settlement" && item.details.length) {
      const groupRef = base.ref;
      const lines = [...item.details].sort((a, b) =>
        a.vdate !== b.vdate ? (a.vdate < b.vdate ? -1 : 1) : a.voucherNumber < b.voucherNumber ? -1 : 1
      );
      for (const d of lines) {
        rows.push({
          ...base,
          vdate: d.vdate || base.vdate,
          ref: d.voucherNumber || groupRef,
          type: `تصفية ${groupRef}`.trim(),
          description: (d.description || "").trim() || base.description,
          party: d.party || "",
          expense: d.expenseAccountSnapshot || "",
          customer: d.contractNumber || "",
          in: 0,
          out: r3(d.amount),
          balance: 0,
        });
      }
      continue;
    }
    const type = item.kind === "settlement" ? "تصفية (مجمّعة)" : item.kind === "return" ? "إرجاع عهدة" : "تسليم عهدة";
    rows.push({
      ...base,
      type,
      in: r3(item.in),
      out: r3(item.out),
      balance: 0,
    });
  }
  const running = new Map<string, number>();
  for (const r of rows) {
    const k = String(r.custodyAccountId ?? r.account);
    const v = r3((running.get(k) || 0) + r.in - r.out);
    running.set(k, v);
    r.balance = v;
  }
  return {
    rows,
    totals: {
      in: r3(rows.reduce((s, r) => s + r.in, 0)),
      out: r3(rows.reduce((s, r) => s + r.out, 0)),
      balance: r3([...running.values()].reduce((s, v) => s + v, 0)),
    },
  };
}

// ==================== الملخص الشهري (custody_monthly_summary) ====================

export interface CustodyMonthlyRow {
  month: string;
  account: string;
  opening: number;
  handed: number;
  spent: number;
  returned: number;
  closing: number;
}

/** مرآة custody_monthly_summary — نقية (افتتاحي ما قبل الفترة ثم تتابع شهري) */
export function buildMonthlyRows(
  ledgerRows: CustodyLedgerItem[],
  dateFrom: string
): { rows: CustodyMonthlyRow[]; totals: { handed: number; spent: number; returned: number } } {
  const opening = new Map<string, number>();
  const months = new Map<string, { handed: number; spent: number; returned: number }>();
  const names = new Map<string, string>();
  for (const item of ledgerRows) {
    const vd = item.vdate || "";
    const key = String(item.custodyAccountId ?? item.custodyAccount ?? "");
    if (!names.has(key)) names.set(key, item.custodyAccount || "—");
    const amtIn = item.in;
    const amtOut = item.out;
    if (dateFrom && vd < dateFrom) {
      opening.set(key, r3((opening.get(key) || 0) + amtIn - amtOut));
      continue;
    }
    const mk = `${key}|${vd.slice(0, 7)}`;
    let b = months.get(mk);
    if (!b) {
      b = { handed: 0, spent: 0, returned: 0 };
      months.set(mk, b);
    }
    if (item.kind === "handover") b.handed += amtIn;
    else if (item.kind === "return") b.returned += amtOut;
    else b.spent += amtOut;
  }
  const rows: CustodyMonthlyRow[] = [];
  const keys = new Set<string>([
    ...[...months.keys()].map((mk) => mk.split("|")[0]),
    ...opening.keys(),
  ]);
  const sortedKeys = [...keys].sort((a, b) => {
    const na = names.get(a) || "";
    const nb = names.get(b) || "";
    return na < nb ? -1 : na > nb ? 1 : 0;
  });
  for (const key of sortedKeys) {
    let bal = r3(opening.get(key) || 0);
    const mons = [...months.keys()]
      .filter((mk) => mk.split("|")[0] === key)
      .map((mk) => mk.split("|")[1])
      .sort();
    for (const m of mons) {
      const b = months.get(`${key}|${m}`)!;
      const close = r3(bal + b.handed - b.spent - b.returned);
      rows.push({
        month: m,
        account: names.get(key) || "—",
        opening: bal,
        handed: r3(b.handed),
        spent: r3(b.spent),
        returned: r3(b.returned),
        closing: close,
      });
      bal = close;
    }
  }
  return {
    rows,
    totals: {
      handed: r3(rows.reduce((s, r) => s + r.handed, 0)),
      spent: r3(rows.reduce((s, r) => s + r.spent, 0)),
      returned: r3(rows.reduce((s, r) => s + r.returned, 0)),
    },
  };
}
