/**
 * أنماط التقرير المالي الأربعة + بيانات الرسم الشهري — مرآة أمينة للمكتبي V9.15.18:
 *   reports_page.py:474  _data_cash_flow (receipts_only / payments_only / recoveries_only / transfers_only)
 *   reports_page.py:455  _transfer_buckets (V4.33: بنك→صندوق · صندوق→بنك · نفس المحفظة — الصافي طرح لا جمع)
 *   cashflow_chart.py    أعمدة شهرية: أخضر وارد (#16A34A) / أحمر منصرف (#DC2626) — RTL أول شهر يمين
 * بناة نقية بلا وصول قاعدة — تُقفل بالاختبارات (tests/phase5-cashflow-modes.test.ts).
 */

import { r3 } from "@/lib/contrack-core";
import { formatKWD } from "@/lib/format";

// ==================== تصنيف المحافظ (نصيًا كـ openingForAccount) ====================

export type WalletKind = "bank" | "cash" | "other";

/** تصنيف المحفظة من الاسم نصيًا — نفس قواعد openingForAccount (voucher-server.ts) */
export function classifyWallet(account: string): WalletKind {
  const a = account || "";
  if (a.includes("بنك")) return "bank";
  if (a.includes("صندوق") || a.includes("نقد")) return "cash";
  return "other";
}

// ==================== تحويلات فقط (V4.33) ====================

export interface TransferItem {
  vdate: string;
  from: string;
  to: string;
  amount: number;
  desc: string;
}

export interface TransferBuckets {
  bankToCash: number;
  cashToBank: number;
  sameWallet: number;
  /** الصافي داخل الصندوق = بنك→صندوق − صندوق→بنك (طرح لا جمع) */
  net: number;
}

/** مرآة _transfer_buckets: تقسيم التحويلات حسب الاتجاه */
export function transferBuckets(items: TransferItem[]): TransferBuckets {
  let a = 0;
  let b = 0;
  let s = 0;
  for (const it of items) {
    const fw = classifyWallet(it.from);
    const tw = classifyWallet(it.to);
    if (fw === "bank" && tw === "cash") a += it.amount;
    else if (fw === "cash" && tw === "bank") b += it.amount;
    else s += it.amount;
  }
  a = r3(a);
  b = r3(b);
  s = r3(s);
  return { bankToCash: a, cashToBank: b, sameWallet: s, net: r3(a - b) };
}

// ==================== الأنماط الأربعة (_data_cash_flow) ====================

export interface CashItem {
  vdate: string;
  party: string;
  contract: string;
  amount: number;
  desc: string;
}

export interface CashflowModeTable {
  title: string;
  heads: string[];
  rows: (string | number)[][];
  /** صف الإجماليات مصفوفيًا — يُعرض في ذيل الجدول ويُصدَّر CSV صفًا كالمكتبي */
  totalsRow: (string | number)[];
  note: string;
}

const NORMAL_HEADS = ["م", "التاريخ", "العميل", "العقد", "المبلغ", "البيان"];
const TRANSFER_HEADS = ["م", "التاريخ", "من حساب", "إلى حساب", "المبلغ", "البيان"];

const normalRows = (items: CashItem[]): (string | number)[][] =>
  items.map((it, i) => [i + 1, it.vdate, it.party, it.contract, it.amount, it.desc]);

const sumOf = (items: CashItem[]): number => r3(items.reduce((s, i) => s + i.amount, 0));

/** وارد فقط — مرآة reports_page.py:495 */
export function cashflowReceiptsOnly(items: CashItem[]): CashflowModeTable {
  return {
    title: "التقرير المالي — وارد فقط",
    heads: NORMAL_HEADS,
    rows: normalRows(items),
    totalsRow: ["الإجمالي", "", "", "", sumOf(items), ""],
    note: `تقرير وارد فقط · إجمالي الوارد: ${formatKWD(sumOf(items))} د.ك · العدد: ${items.length}`,
  };
}

/** منصرف فقط — مرآة reports_page.py:507 */
export function cashflowPaymentsOnly(items: CashItem[]): CashflowModeTable {
  return {
    title: "التقرير المالي — منصرف فقط",
    heads: NORMAL_HEADS,
    rows: normalRows(items),
    totalsRow: ["الإجمالي", "", "", "", sumOf(items), ""],
    note: `تقرير منصرف فقط · إجمالي المنصرف: ${formatKWD(sumOf(items))} د.ك · العدد: ${items.length}`,
  };
}

/** مسترد فقط — مرآة reports_page.py:519 */
export function cashflowRecoveriesOnly(items: CashItem[]): CashflowModeTable {
  return {
    title: "التقرير المالي — مسترد فقط",
    heads: NORMAL_HEADS,
    rows: normalRows(items),
    totalsRow: ["الإجمالي", "", "", "", sumOf(items), ""],
    note: `تقرير مسترد فقط · إجمالي المسترد: ${formatKWD(sumOf(items))} د.ك · العدد: ${items.length}`,
  };
}

/** تحويلات فقط — مرآة reports_page.py:531 (رؤوس من/إلى + الصافي + التنبيه الحرفي) */
export function cashflowTransfersOnly(items: TransferItem[]): CashflowModeTable {
  const { bankToCash: a, cashToBank: b, sameWallet: s, net } = transferBuckets(items);
  let note =
    `تقرير تحويلات داخلية فقط · من البنك إلى الصندوق: ${formatKWD(a)} · ` +
    `من الصندوق إلى البنك: ${formatKWD(b)} · الصافي (داخل الصندوق): ${formatKWD(net)} د.ك`;
  if (s) note += ` · داخل نفس المحفظة: ${formatKWD(s)}`;
  note += ` · العدد: ${items.length} · هذه الحركات لا تُحسب ضمن المنصرف ولا الوارد`;
  return {
    title: "التقرير المالي — تحويلات فقط",
    heads: TRANSFER_HEADS,
    rows: items.map((it, i) => [i + 1, it.vdate, it.from, it.to, it.amount, it.desc]),
    totalsRow: ["الصافي", "", "", "", net, ""],
    note,
  };
}

// ==================== الرسم الشهري (cashflow_chart.py) ====================

export interface ChartDatum {
  label: string;
  in: number;
  out: number;
}

/** استخراج بيانات الرسم من صفوف الوضع الشهري: [الفترة، الوارد، المنصرف، …] */
export function monthlyChartData(rows: (string | number)[][]): ChartDatum[] {
  return rows.map((r) => ({
    label: String(r[0] ?? ""),
    in: Number(r[1]) || 0,
    out: Number(r[2]) || 0,
  }));
}

/** تنسيق القيمة فوق العمود: آلاف مختصرة k، وفارغ للصفر — مرآة fmt المكتبي */
export function chartValueLabel(v: number): string {
  if (v >= 1000) return `${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: 0 })}k`;
  return v ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "";
}
