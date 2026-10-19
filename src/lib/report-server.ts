import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  EPS,
  r3,
  todayStr,
  daysBetween,
  isSupervision,
  supervisionStatus,
  computeContractPaymentPlan,
  dueNowStrict,
  ComputedPlanLine,
  PlanLine,
  ReceiptLike,
  LinkRow,
} from "@/lib/contrack-core";
import { actualSupervisionEnd, getSettingsRow } from "@/lib/contrack-server";
import {
  cashflowPaymentsOnly,
  cashflowReceiptsOnly,
  cashflowRecoveriesOnly,
  cashflowTransfersOnly,
  type CashItem,
  type TransferItem,
} from "@/lib/cashflow-modes-core";

// ===================================================================
// المكتبة الخلفية المشتركة للتقارير وكشوف الحساب (Task 10-a)
// المرجع الحرفي: research/spec-reports.md — كل الأرصدة تُحسب لحظيًا من الحركات.
// ===================================================================

// ===== حالات العقود كما وردت حرفيًا في الاستعلامات المصدرية =====
export const STATUS_CANCELLED = ["ملغى", "ملغي"];
export const STATUS_DRAFT = ["مسودة"];
export const STATUS_CLOSED = ["مغلق"];
export const STATUS_HIDE_STATEMENT = [...STATUS_CANCELLED, ...STATUS_DRAFT];

// ===== أشهر عربية للتجمع الشهري =====
export const AR_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const idx = Number(m) - 1;
  return `${AR_MONTHS[idx] || m} ${y}`;
}

/** تنسيق مبلغ بثلاث خانات وفواصل آلاف (كصيغة {amount:,.3f} في المصدر) */
export function fmt3(n: number): string {
  return Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

// ===== شكل التقرير الموحد (spec-reports: اقتراح مسارات API) =====
export interface ReportTable {
  title: string;
  heads: string[];
  widths?: number[];
  rows: (string | number)[][];
  numberCols: number[];
  accentRows: number[];
  /** مصفوفة = صف إجماليات مطابق للمكتبي (أنماط *_only) · كائن = مفاتيح مسماة (الأنماط القديمة) */
  totals?: Record<string, number | string> | (string | number)[];
  note?: string;
}

// ===== أنواع صفوف كشف الحساب =====
export type StatementKind = "opening" | "move" | "invoice_info" | "subtotal" | "total";

export interface StatementRow {
  date: string;
  ref: string;
  desc: string;
  debit: number;
  credit: number;
  balance: number;
  kind: StatementKind;
  contractId?: number;
  contractNumber?: string;
}

interface RawStatement {
  rows: StatementRow[]; // الصفوف كاملة (قبل فلتر الفترة) بأرصدة تراكمية
  originalAmount: number;
  netAddendums: number;
  supExtension: number;
  collected: number;
  totalInvoiced: number;
}

const byDateRef = (a: { date: string; ref: string }, b: { date: string; ref: string }) => {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0;
};

/**
 * بناء حركات كشف عقد واحد (statement_service.build_statement — A.1 حرفيًا):
 * صف افتتاحي «قيمة العقد» مدين + ملاحق معتمدة (زيادة مدين/خصم دائن ADD-xxx) +
 * فواتير محايدة (للعلم) + سندات قبض دائن + تمديد الإشراف مدين بتاريخ base_end.
 */
export async function buildContractStatementRaw(contractId: number): Promise<RawStatement | null> {
  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return null;

  const [addendums, invoices, receiptRows, stages] = await Promise.all([
    db.addendum.findMany({
      where: { contractId },
      select: { addendumNumber: true, addendumType: true, reason: true, adate: true, approvedDate: true, amountAdd: true, amountDeduct: true, status: true },
      orderBy: [{ adate: "asc" }, { id: "asc" }],
    }),
    db.invoice.findMany({
      where: { contractId },
      select: { invoiceNumber: true, invoiceDate: true, description: true, amount: true },
      orderBy: [{ invoiceDate: "asc" }, { id: "asc" }],
    }),
    db.voucher.findMany({
      where: { contractId, vtype: "receipt", cancelled: false },
      select: { id: true, voucherNumber: true, vdate: true, amount: true, description: true },
      orderBy: [{ vdate: "asc" }, { id: "asc" }],
    }),
    db.contractStage.findMany({
      where: { contractId },
      select: { name: true, endDate: true, supActualEnd: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
  ]);

  const amount = Number(contract.amount);
  const actualEnd = actualSupervisionEnd(stages);
  const supContract = {
    id: contract.id,
    supStartDate: contract.supStartDate,
    supMonths: contract.supMonths,
    supMonthly: Number(contract.supMonthly),
    supDiscount: Number(contract.supDiscount),
    supWaivedMonths: Number(contract.supWaivedMonths),
  };
  const sup = isSupervision(supContract) ? supervisionStatus(supContract, [], actualEnd) : null;
  const supExt = sup ? sup.extensionValue : 0;

  const moves: StatementRow[] = [];

  // الملحقات المعتمدة: net = amountAdd − amountDeduct؛ زيادة ⇒ مدين، خصم ⇒ دائن
  for (const a of addendums) {
    if (a.status !== "معتمد") continue;
    const net = r3(Number(a.amountAdd) - Number(a.amountDeduct));
    if (Math.abs(net) < EPS) continue;
    const date = a.adate || a.approvedDate || contract.contractDate || "";
    const desc = `${a.addendumType}: ${a.reason || ""}`.trim().replace(/:\s*$/, "");
    moves.push({
      date, ref: a.addendumNumber, desc,
      debit: net > 0 ? net : 0,
      credit: net < 0 ? r3(-net) : 0,
      balance: 0, kind: "move",
    });
  }

  // الفواتير: صفوف محايدة «للعلم» — لا تخفض المديونية (قاعدة 5)
  for (const inv of invoices) {
    moves.push({
      date: inv.invoiceDate || "",
      ref: inv.invoiceNumber,
      desc: `فاتورة (للعلم): ${inv.description || ""} · ${fmt3(Number(inv.amount))}`.trim(),
      debit: 0, credit: 0, balance: 0, kind: "invoice_info",
    });
  }

  // سندات القبض السارية: دائن كامل المبلغ
  for (const v of receiptRows) {
    moves.push({
      date: v.vdate, ref: v.voucherNumber,
      desc: v.description || "سند قبض",
      debit: 0, credit: r3(Number(v.amount)), balance: 0, kind: "move",
    });
  }

  // تمديد الإشراف: صف مدين واحد بتاريخ base_end (إن إشرافي وبقيمة > 0.001)
  if (sup && sup.extensionValue > EPS && sup.baseEnd) {
    let desc = `تمديد إشراف · ${sup.billableExtMonths} شهر (${fmt3(Number(contract.supMonthly))} للشهر)`;
    if (Number(contract.supWaivedMonths) > 0) desc += ` · بعد إلغاء ${Number(contract.supWaivedMonths)} شهر`;
    moves.push({
      date: sup.baseEnd, ref: "تمديد", desc,
      debit: sup.extensionValue, credit: 0, balance: 0, kind: "move",
    });
  }

  moves.sort(byDateRef);

  // الرصيد التراكمي يبدأ بالصف الافتتاحي
  const rows: StatementRow[] = [
    {
      date: contract.contractDate || "", ref: contract.contractNumber, desc: "قيمة العقد",
      debit: r3(amount), credit: 0, balance: 0, kind: "opening",
    },
    ...moves,
  ];
  let balance = 0;
  for (const row of rows) {
    balance = r3(balance + row.debit - row.credit);
    row.balance = balance;
  }

  const collected = r3(receiptRows.reduce((s, v) => s + Number(v.amount), 0));
  const netAddendums = r3(
    addendums.filter((a) => a.status === "معتمد").reduce((s, a) => s + Number(a.amountAdd) - Number(a.amountDeduct), 0)
  );
  return {
    rows,
    originalAmount: r3(amount),
    netAddendums,
    supExtension: supExt,
    collected,
    totalInvoiced: r3(invoices.reduce((s, i) => s + Number(i.amount), 0)),
  };
}

export interface ContractStatementResult {
  contract: {
    id: number; contractNumber: string; contractName: string; status: string;
    contractDate: string; customerId: number; currency: string;
  };
  customer: { id: number; name: string; customerCode: string; phone: string };
  rows: StatementRow[];
  totals: { debit: number; credit: number; remaining: number; current: number; collected: number };
  meta: {
    originalAmount: number; netAddendums: number; supExtension: number;
    totalInvoiced: number; totalDeducts: number; opening: number;
    dateFrom: string; dateTo: string;
  };
}

/** كشف حساب العقد الواحد مع فلاتر فترة اختيارية (from/to) */
export async function buildContractStatement(contractId: number, opts: { from?: string; to?: string } = {}): Promise<ContractStatementResult | null> {
  const raw = await buildContractStatementRaw(contractId);
  if (!raw) return null;
  const contract = await db.contract.findUnique({
    where: { id: contractId },
    select: { id: true, contractNumber: true, contractName: true, status: true, contractDate: true, customerId: true, currency: true, customer: { select: { id: true, name: true, customerCode: true, phone: true } } },
  });
  if (!contract) return null;

  const from = opts.from || "";
  const to = opts.to || "";
  let rows = raw.rows;
  let opening = 0;

  if (from) {
    // الصفوف الأقدم من from تتحول إلى «رصيد أول الفترة» = رصيد آخر صف قبلها
    const before = rows.filter((r) => r.date && r.date < from);
    const lastBefore = before.length ? before[before.length - 1] : null;
    opening = lastBefore ? lastBefore.balance : 0;
    const inRange = rows.filter((r) => (!r.date || r.date >= from) && (!to || r.date <= to));
    const openingRow: StatementRow = {
      date: from, ref: "", desc: "رصيد أول الفترة",
      debit: opening > 0 ? opening : 0,
      credit: opening < 0 ? r3(-opening) : 0,
      balance: opening, kind: "opening",
    };
    rows = [openingRow, ...inRange];
    let bal = opening;
    for (const row of rows.slice(1)) {
      bal = r3(bal + row.debit - row.credit);
      row.balance = bal;
    }
  } else if (to) {
    rows = rows.filter((r) => !r.date || r.date <= to);
    let bal = 0;
    for (const row of rows) {
      bal = r3(bal + row.debit - row.credit);
      row.balance = bal;
    }
  }

  // الإجماليات (statement_service.py:109-130)
  const displayed = rows.filter((r) => r.kind === "move" || r.kind === "invoice_info");
  const addDebit = r3(displayed.filter((m) => m.ref.startsWith("ADD-")).reduce((s, m) => s + m.debit, 0));
  const totalDeducts = r3(displayed.filter((m) => m.ref.startsWith("ADD-")).reduce((s, m) => s + m.credit, 0));
  const recTotal = raw.collected;
  const totalDebit = r3(raw.originalAmount + raw.supExtension + addDebit);
  const totalCredit = r3(recTotal + totalDeducts);
  const currentValue = r3(raw.originalAmount + raw.netAddendums + raw.supExtension);
  const remaining = r3(currentValue - recTotal);

  return {
    contract: {
      id: contract.id, contractNumber: contract.contractNumber, contractName: contract.contractName,
      status: contract.status, contractDate: contract.contractDate, customerId: contract.customerId,
      currency: contract.currency,
    },
    customer: contract.customer,
    rows,
    totals: { debit: totalDebit, credit: totalCredit, remaining, current: currentValue, collected: recTotal },
    meta: {
      originalAmount: raw.originalAmount, netAddendums: raw.netAddendums, supExtension: raw.supExtension,
      totalInvoiced: raw.totalInvoiced, totalDeducts, opening,
      dateFrom: from, dateTo: to,
    },
  };
}

export interface CustomerStatementResult {
  customer: { id: number; name: string; customerCode: string; phone: string };
  contracts: { id: number; contractNumber: string; contractName: string; contractDate: string }[];
  contract: number | null;
  rows: StatementRow[];
  totals: { debit: number; credit: number; remaining: number; current: number; collected: number };
  opening: number;
  contractsCount: number;
  dateFrom: string;
  dateTo: string;
  perContract: {
    contractId: number; contractNumber: string;
    opening: number; debit: number; credit: number; balance: number; remaining: number;
  }[];
}

/** كشف العميل الشامل (statement_service.build_customer_statement — A.2) */
export async function buildCustomerStatement(
  customerId: number,
  opts: { contractId?: number; from?: string; to?: string } = {}
): Promise<CustomerStatementResult | null> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, customerCode: true, phone: true },
  });
  if (!customer) return null;
  const from = opts.from || "";
  const to = opts.to || "";

  // النطاق: عقد محدد (مع تحقق ملكية) أو كل العقود بغير ملغى/مسودة مرتبة (contractDate, id)
  const contracts = await db.contract.findMany({
    where: { customerId, id: opts.contractId || undefined, status: { notIn: STATUS_HIDE_STATEMENT } },
    select: { id: true, contractNumber: true, contractName: true, contractDate: true },
    orderBy: [{ contractDate: "asc" }, { id: "asc" }],
  });
  if (opts.contractId && !contracts.some((c) => c.id === opts.contractId)) return null;

  let totalOpening = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  let totalCurrent = 0;
  let totalCollected = 0;
  const moves: StatementRow[] = [];
  const perContract: CustomerStatementResult["perContract"] = [];

  for (const c of contracts) {
    const raw = await buildContractStatementRaw(c.id);
    if (!raw) continue;
    // فلتر الفترة لكل عقد: الصفوف الأقدم من from ⇒ رصيد أول فترة لهذا العقد
    let contractOpening = 0;
    let visible = raw.rows;
    if (from) {
      const before = raw.rows.filter((r) => r.date && r.date < from);
      contractOpening = before.length ? before[before.length - 1].balance : 0;
      visible = raw.rows.filter((r) => (!r.date || r.date >= from) && (!to || r.date <= to));
    } else if (to) {
      visible = raw.rows.filter((r) => !r.date || r.date <= to);
    }
    const cDebit = r3(visible.reduce((s, r) => s + r.debit, 0));
    const cCredit = r3(visible.reduce((s, r) => s + r.credit, 0));
    totalOpening = r3(totalOpening + contractOpening);
    totalDebit = r3(totalDebit + cDebit);
    totalCredit = r3(totalCredit + cCredit);
    totalCurrent = r3(totalCurrent + raw.originalAmount + raw.netAddendums + raw.supExtension);
    totalCollected = r3(totalCollected + raw.collected);
    for (const r of visible) {
      if (r.kind === "opening" && !r.ref) continue; // صف «قيمة العقد» فقط يُنقل
      moves.push({ ...r, contractId: c.id, contractNumber: c.contractNumber });
    }
    perContract.push({
      contractId: c.id, contractNumber: c.contractNumber,
      opening: contractOpening, debit: cDebit, credit: cCredit, balance: 0, remaining: 0,
    });
  }

  // صف افتتاحي إجمالي واحد حسب إشارة total_opening
  const openingRow: StatementRow = {
    date: from || "", ref: "", desc: "رصيد أول الفترة",
    debit: totalOpening > 0 ? totalOpening : 0,
    credit: totalOpening < 0 ? r3(-totalOpening) : 0,
    balance: totalOpening, kind: "opening",
  };

  // الدمج الزمني (date, contract_number, ref) ثم رصيد جارٍ واحد
  moves.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if ((a.contractNumber || "") !== (b.contractNumber || "")) return (a.contractNumber || "") < (b.contractNumber || "") ? -1 : 1;
    return byDateRef(a, b);
  });

  const rows: StatementRow[] = [];
  if (totalOpening !== 0 || from) rows.push(openingRow);
  let balance = totalOpening;
  for (const m of moves) {
    balance = r3(balance + m.debit - m.credit);
    m.balance = balance;
    rows.push(m);
  }

  // إجمالي لكل عقد (subtotal) ثم إجمالي عام (total)
  for (const pc of perContract) {
    const contractMoves = moves.filter((m) => m.contractId === pc.contractId);
    pc.balance = contractMoves.length ? contractMoves[contractMoves.length - 1].balance : pc.opening;
    pc.remaining = r3(pc.balance);
    rows.push({
      date: "", ref: pc.contractNumber, desc: `إجمالي العقد ${pc.contractNumber}`,
      debit: pc.debit, credit: pc.credit, balance: pc.balance, kind: "subtotal",
      contractId: pc.contractId, contractNumber: pc.contractNumber,
    });
  }
  rows.push({
    date: "", ref: "", desc: "الإجمالي العام",
    debit: totalDebit, credit: totalCredit, balance, kind: "total",
  });

  return {
    customer,
    contracts,
    contract: opts.contractId || null,
    rows,
    totals: {
      debit: totalDebit, credit: totalCredit, remaining: balance,
      current: totalCurrent, collected: totalCollected,
    },
    opening: totalOpening,
    contractsCount: contracts.length,
    dateFrom: from,
    dateTo: to,
    perContract,
  };
}

export interface SubcontractorStatementResult {
  subcontractor: { id: number; subCode: string; name: string; phone: string };
  rows: StatementRow[];
  totals: { debit: number; credit: number; remaining: number; opening: number };
  dateFrom: string;
  dateTo: string;
}

/** كشف مقاول الباطن (statement_service.build_subcontractor_statement — A.3) */
export async function buildSubcontractorStatement(
  subId: number,
  opts: { from?: string; to?: string } = {}
): Promise<SubcontractorStatementResult | null> {
  const sub = await db.subcontractor.findUnique({
    where: { id: subId },
    select: { id: true, subCode: true, name: true, phone: true },
  });
  if (!sub) return null;
  const from = opts.from || "";
  const to = opts.to || "";

  const [subContracts, pays] = await Promise.all([
    db.subContract.findMany({
      where: { subcontractorId: subId, status: { not: "ملغى" } },
      select: { id: true, amount: true, startDate: true, description: true, contract: { select: { contractNumber: true, contractDate: true } } },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
    }),
    db.voucher.findMany({
      where: { vtype: "payment", partyType: "subcontractor", partyId: subId, cancelled: false },
      select: { voucherNumber: true, vdate: true, amount: true, description: true },
      orderBy: [{ vdate: "asc" }, { id: "asc" }],
    }),
  ]);

  const moves: StatementRow[] = [];
  // مدين: كل عقود باطنه بغير الملغى
  for (const sc of subContracts) {
    moves.push({
      date: sc.startDate || sc.contract.contractDate || "",
      ref: `SB-${sc.id}`,
      desc: `عقد باطن ${sc.id} · ${sc.description || sc.contract.contractNumber}`.trim(),
      debit: r3(Number(sc.amount)), credit: 0, balance: 0, kind: "move",
    });
  }
  // دائن: سندات الصرف له
  for (const v of pays) {
    moves.push({
      date: v.vdate, ref: v.voucherNumber,
      desc: `سند صرف ${v.voucherNumber}${v.description ? ` · ${v.description}` : ""}`,
      debit: 0, credit: r3(Number(v.amount)), balance: 0, kind: "move",
    });
  }
  moves.sort(byDateRef);

  let rows = moves;
  let opening = 0;
  if (from) {
    const before = moves.filter((m) => m.date && m.date < from);
    const debitBefore = r3(before.reduce((s, m) => s + m.debit, 0));
    const creditBefore = r3(before.reduce((s, m) => s + m.credit, 0));
    opening = r3(debitBefore - creditBefore);
    rows = moves.filter((m) => (!m.date || m.date >= from) && (!to || m.date <= to));
    const openingRow: StatementRow = {
      date: from, ref: "", desc: "رصيد أول الفترة",
      debit: opening > 0 ? opening : 0,
      credit: opening < 0 ? r3(-opening) : 0,
      balance: opening, kind: "opening",
    };
    rows = [openingRow, ...rows];
  } else if (to) {
    rows = moves.filter((m) => !m.date || m.date <= to);
  }

  let balance = opening;
  let debit = 0;
  let credit = 0;
  for (const r of rows) {
    balance = r3(balance + r.debit - r.credit);
    r.balance = balance;
    debit = r3(debit + r.debit);
    credit = r3(credit + r.credit);
  }

  return {
    subcontractor: sub,
    rows,
    totals: { debit, credit, remaining: balance, opening },
    dateFrom: from,
    dateTo: to,
  };
}

// ===================================================================
// محمّل مالي موحد لعقود متعددة (يغذي تقارير العملاء/المراحل/الإشراف/المتابعة)
// ===================================================================

export interface StageInfo { name: string; endDate: string; isSkipped: boolean }

export interface ContractFinance {
  id: number;
  contractNumber: string;
  contractName: string;
  description: string;
  customerId: number;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  contractDate: string;
  startDate: string;
  endDate: string;
  status: string;
  contractType: string;
  amount: number;
  addNet: number;
  supExt: number;
  current: number;
  collected: number;
  remaining: number;
  isSup: boolean;
  sup: ReturnType<typeof supervisionStatus> | null;
  actualEnd: string;
  supStartDate: string;
  supMonths: number;
  supMonthly: number;
  supWaivedMonths: number;
  supWaiveReason: string;
  hasPlan: boolean;
  dueNow: number;
  planLines: ComputedPlanLine[];
  stageInfoByLine: Map<number, StageInfo>;
  lastReceiptDate: string;
}

export async function loadContractsFinance(
  opts: { excludeStatuses?: string[]; includeStatuses?: string[]; onlyIds?: number[] } = {}
): Promise<ContractFinance[]> {
  const where: Prisma.ContractWhereInput = {};
  if (opts.onlyIds && opts.onlyIds.length > 0) where.id = { in: opts.onlyIds };
  if (opts.includeStatuses && opts.includeStatuses.length > 0) where.status = { in: opts.includeStatuses };
  else if (opts.excludeStatuses && opts.excludeStatuses.length > 0) where.status = { notIn: opts.excludeStatuses };

  const contracts = await db.contract.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true, phone: true, address: true, governorate: true, area: true } },
      addendums: { select: { status: true, amountAdd: true, amountDeduct: true } },
      plan: {
        orderBy: [{ dueDate: "asc" }, { sortOrder: "asc" }],
        include: { stage: { select: { name: true, endDate: true, isSkipped: true } } },
      },
      vouchers: {
        where: { vtype: "receipt", cancelled: false },
        select: { id: true, voucherNumber: true, vdate: true, amount: true, allocation: true, advanceAmount: true },
      },
    },
    orderBy: [{ contractDate: "asc" }, { id: "asc" }],
  });
  if (contracts.length === 0) return [];

  const allIds = contracts.map((c) => c.id);
  const supIds = contracts
    .filter((c) => Boolean(c.supStartDate) && c.supMonths > 0 && Number(c.supMonthly) > 0)
    .map((c) => c.id);
  const [linkRows, stageRows] = await Promise.all([
    db.voucherPaymentLink.findMany({
      where: { kind: "receipt", voucher: { contractId: { in: allIds }, vtype: "receipt", cancelled: false } },
      select: { voucherId: true, lineId: true, amount: true },
    }),
    supIds.length > 0
      ? db.contractStage.findMany({
          where: { contractId: { in: supIds } },
          select: { contractId: true, name: true, endDate: true, supActualEnd: true },
        })
      : Promise.resolve([] as { contractId: number; name: string; endDate: string; supActualEnd: string }[]),
  ]);
  const links: LinkRow[] = linkRows.map((l) => ({ voucherId: l.voucherId, lineId: l.lineId, amount: Number(l.amount) }));
  const stagesByContract = new Map<number, { name: string; endDate: string; supActualEnd: string }[]>();
  for (const s of stageRows) {
    const arr = stagesByContract.get(s.contractId) || [];
    arr.push({ name: s.name, endDate: s.endDate, supActualEnd: s.supActualEnd });
    stagesByContract.set(s.contractId, arr);
  }

  const today = todayStr();
  const out: ContractFinance[] = [];
  for (const c of contracts) {
    const receipts: ReceiptLike[] = c.vouchers.map((v) => ({
      id: v.id, voucherNumber: v.voucherNumber, vdate: v.vdate,
      amount: Number(v.amount), allocation: v.allocation,
      advanceAmount: Number(v.advanceAmount), cancelled: false,
    }));
    const collected = r3(receipts.reduce((s, v) => s + Number(v.amount), 0));
    const addNet = r3(
      c.addendums.filter((a) => a.status === "معتمد").reduce((s, a) => s + Number(a.amountAdd) - Number(a.amountDeduct), 0)
    );
    const isSup = Boolean(c.supStartDate) && c.supMonths > 0 && Number(c.supMonthly) > 0;
    const actualEnd = isSup ? actualSupervisionEnd(stagesByContract.get(c.id) || []) : "";
    const sup = isSup
      ? supervisionStatus(
          {
            id: c.id, supStartDate: c.supStartDate, supMonths: c.supMonths,
            supMonthly: Number(c.supMonthly), supDiscount: Number(c.supDiscount),
            supWaivedMonths: Number(c.supWaivedMonths),
          },
          receipts,
          actualEnd
        )
      : null;
    const supExt = sup ? sup.extensionValue : 0;
    const current = r3(Number(c.amount) + addNet + supExt);

    const stageInfoByLine = new Map<number, StageInfo>();
    const plan: PlanLine[] = c.plan.map((p) => {
      stageInfoByLine.set(p.id, { name: p.stage?.name || "", endDate: p.stage?.endDate || "", isSkipped: Boolean(p.stage?.isSkipped) });
      return {
        id: p.id, title: p.title, dueDate: p.dueDate, amount: Number(p.amount),
        sortOrder: p.sortOrder, stageId: p.stageId, triggeredAt: p.triggeredAt, notes: p.notes,
        stage: p.stage ? { isSkipped: p.stage.isSkipped, endDate: p.stage.endDate } : null,
      };
    });
    const computed = computeContractPaymentPlan(plan, receipts, links);
    const hasPlan = c.plan.length > 0;
    // المستحق الآن: له خطة ⇒ strict؛ بلا خطة ⇒ كامل المتبقي (مطابق dashboard)
    const dueNow = hasPlan
      ? dueNowStrict(computed.lines)
      : Math.max(0, r3(current - collected)) > EPS
        ? r3(current - collected)
        : 0;

    let lastReceiptDate = "";
    for (const v of c.vouchers) if (v.vdate && (!lastReceiptDate || v.vdate > lastReceiptDate)) lastReceiptDate = v.vdate;

    out.push({
      id: c.id, contractNumber: c.contractNumber, contractName: c.contractName, description: c.description,
      customerId: c.customer.id, customerName: c.customer.name, customerPhone: c.customer.phone,
      customerAddress: c.customer.address || [c.customer.governorate, c.customer.area].filter(Boolean).join(" "),
      contractDate: c.contractDate, startDate: c.startDate, endDate: c.endDate, status: c.status,
      contractType: c.contractType,
      amount: r3(Number(c.amount)), addNet, supExt, current,
      collected, remaining: r3(current - collected),
      isSup, sup, actualEnd,
      supStartDate: c.supStartDate, supMonths: c.supMonths,
      supMonthly: Number(c.supMonthly), supWaivedMonths: Number(c.supWaivedMonths),
      supWaiveReason: c.supWaiveReason,
      hasPlan, dueNow,
      planLines: computed.lines, stageInfoByLine, lastReceiptDate,
    });
  }
  return out;
}

// ===================================================================
// بناة التقارير (spec-reports B) — كل واحد يعيد ReportTable موحدًا
// ===================================================================

/** 4) تقرير العملاء والأرصدة (B.2 + reports_page 1112-1208) */
export async function reportCustomersBalances(opts: { option?: string; from?: string; to?: string }): Promise<ReportTable> {
  const option = opts.option || "all";
  if (option === "by_stages") {
    const table = await reportStageDues({ option: "all" });
    return { ...table, title: "تقرير العملاء والأرصدة — عرض بالمراحل" };
  }

  const finances = await loadContractsFinance({ excludeStatuses: STATUS_CANCELLED });
  const extraReceipts = await db.voucher.findMany({
    where: { vtype: "receipt", cancelled: false, contractId: null, partyType: "customer" },
    select: { partyId: true, amount: true },
  });
  const extraByCustomer = new Map<number, number>();
  for (const v of extraReceipts) {
    if (!v.partyId) continue;
    extraByCustomer.set(v.partyId, r3((extraByCustomer.get(v.partyId) || 0) + Number(v.amount)));
  }

  const byCustomer = new Map<number, { name: string; phone: string; count: number; value: number; collected: number; due: number; remaining: number }>();
  for (const f of finances) {
    const closed = STATUS_CLOSED.includes(f.status);
    let row = byCustomer.get(f.customerId);
    if (!row) {
      row = { name: f.customerName, phone: f.customerPhone, count: 0, value: 0, collected: 0, due: 0, remaining: 0 };
      byCustomer.set(f.customerId, row);
    }
    row.count += 1;
    row.value = r3(row.value + f.current);
    row.collected = r3(row.collected + f.collected);
    row.remaining = r3(row.remaining + f.remaining);
    if (!closed) row.due = r3(row.due + f.dueNow);
  }
  for (const [cid, extra] of extraByCustomer) {
    const row = byCustomer.get(cid);
    if (row) row.collected = r3(row.collected + extra);
  }

  const heads = ["#", "العميل", "البيان", "العقود", "قيمة العقود", "المحصّل", "المستحق الآن", "المتبقي", "الحالة"];
  const rows: (string | number)[][] = [];
  const accentRows: number[] = [];
  let idx = 1;
  let tValue = 0;
  let tCollected = 0;
  let tDue = 0;
  let tRemaining = 0;
  const sorted = [...byCustomer.entries()].sort((a, b) => b[1].remaining - a[1].remaining || a[1].name.localeCompare(b[1].name, "ar"));
  for (const [, r] of sorted) {
    if (option === "with_balance" && r.remaining <= EPS) continue;
    if (option === "no_balance" && r.remaining > EPS) continue;
    if (option === "due_only" && r.due <= EPS) continue;
    const state = r.due > EPS ? "مستحق الآن" : r.remaining > EPS ? "عليه رصيد" : "مسدّد بالكامل";
    if (state === "مستحق الآن") accentRows.push(rows.length);
    rows.push([idx++, r.name, r.phone, r.count, r.value, r.collected, r.due, r.remaining, state]);
    tValue = r3(tValue + r.value);
    tCollected = r3(tCollected + r.collected);
    tDue = r3(tDue + r.due);
    tRemaining = r3(tRemaining + r.remaining);
  }
  return {
    title: "تقرير العملاء والأرصدة",
    heads,
    rows,
    numberCols: [3, 4, 5, 6, 7],
    accentRows,
    totals: { count: rows.length, value: tValue, collected: tCollected, due: tDue, remaining: tRemaining },
    note: option === "due_only" ? "يعرض العملاء ذوي مستحق صارم (متأخر أو مستحق اليوم) فقط" : undefined,
  };
}

/** 5) مستحقات العملاء بالمراحل (B.3 stage_dues) */
export async function reportStageDues(opts: { option?: string }): Promise<ReportTable> {
  const option = opts.option || "all";
  const today = todayStr();
  const finances = await loadContractsFinance({ excludeStatuses: [...STATUS_CANCELLED, ...STATUS_DRAFT, ...STATUS_CLOSED] });

  const heads = ["العميل", "العقد", "المرحلة", "انتهت بتاريخ", "الدفعات", "المستحق الآن", "المتبقي", "الحالة"];
  const rows: (string | number)[][] = [];
  const accentRows: number[] = [];
  interface Grp { customer: string; contract: string; stage: string; stageEnd: string; amount: number; due: number; overdue: number; rem: number; status: string; sortKey: number }
  const groups: Grp[] = [];

  for (const f of finances) {
    if (!f.hasPlan) {
      if (f.remaining > EPS) {
        groups.push({
          customer: f.customerName, contract: `${f.contractNumber}${f.contractName ? ` — ${f.contractName}` : ""}`,
          stage: "—", stageEnd: "", amount: 0, due: f.remaining, overdue: daysBetween(f.contractDate || today, today) >= 0 ? f.remaining : 0,
          rem: f.remaining, status: "مستحقة", sortKey: 1,
        });
      }
      continue;
    }
    const byStage = new Map<number, ComputedPlanLine[]>();
    for (const line of f.planLines) {
      const key = line.stageId ?? 0;
      const arr = byStage.get(key) || [];
      arr.push(line);
      byStage.set(key, arr);
    }
    for (const [stageId, lines] of byStage) {
      const info = lines.map((l) => f.stageInfoByLine.get(l.id)).find(Boolean) || { name: "", endDate: "", isSkipped: false };
      const skippedG = lines.every((l) => l.state === "skipped") || (stageId !== 0 && info.isSkipped);
      const due = r3(lines.filter((l) => l.remaining > EPS && l.state !== "skipped" && l.state !== "awaiting_stage" && l.daysDiff <= 0).reduce((s, l) => s + l.remaining, 0));
      const overdue = r3(lines.filter((l) => l.remaining > EPS && l.state !== "skipped" && l.state !== "awaiting_stage" && l.daysDiff <= 0 && l.dueDate && l.dueDate < today).reduce((s, l) => s + l.remaining, 0));
      const rem = r3(lines.filter((l) => l.state !== "skipped").reduce((s, l) => s + l.remaining, 0));
      const amount = r3(lines.reduce((s, l) => s + l.amountN, 0));
      let status: string;
      if (skippedG) status = "غير مستحقة";
      else if (due > EPS || ((stageId === 0 ? info.endDate : info.endDate) && rem > EPS)) status = "مستحقة";
      else if (rem <= EPS) status = "مسددة";
      else status = "لم تستحق بعد";
      let sortKey = 3;
      if (status === "مستحقة") sortKey = overdue > EPS ? 0 : 1;
      else if (status === "لم تستحق بعد") sortKey = 2;
      groups.push({
        customer: f.customerName,
        contract: `${f.contractNumber}${f.contractName ? ` — ${f.contractName}` : ""}`,
        stage: info.name || "—", stageEnd: info.endDate || "",
        amount, due, overdue, rem, status, sortKey,
      });
    }
  }

  // فلتر العرض
  const filtered = groups.filter((g) => {
    if (option === "overdue") return g.overdue > EPS;
    if (option === "due") return g.status === "مستحقة";
    if (option === "upcoming") return g.status === "لم تستحق بعد";
    return true;
  });
  // ترتيب: متأخر أولًا ثم «مستحقة» ثم الكبر due
  filtered.sort((a, b) => a.sortKey - b.sortKey || b.due - a.due);

  let tDue = 0;
  let tRem = 0;
  for (const g of filtered) {
    if (g.overdue > EPS) accentRows.push(rows.length);
    rows.push([g.customer, g.contract, g.stage, g.stageEnd, g.amount, g.due, g.rem, g.status]);
    tDue = r3(tDue + g.due);
    tRem = r3(tRem + g.rem);
  }
  return {
    title: "مستحقات العملاء بالمراحل",
    heads,
    rows,
    numberCols: [4, 5, 6],
    accentRows,
    totals: { due: tDue, remaining: tRem },
    note: option === "overdue" ? "المستحق الصارم المتأخر فقط (استحقاق بتاريخ سابق لليوم)" : "المستحق الآن صارم: متأخر أو مستحق اليوم بلا مرحلة معلقة",
  };
}

/** أشهر التمديد المدفوعة (منطق supervisionStatus الداخلي: أدنى(قيمة التمديد، المحصّل − الأساس)) */
function supPaidExtMonths(sup: NonNullable<ContractFinance["sup"]>, monthly: number): number {
  const paidExt = Math.max(0, Math.min(sup.extensionValue, sup.collected - sup.baseValue));
  return monthly > 0 ? Math.floor(paidExt / monthly + EPS) : 0;
}

/** 6) تقرير تأخير الإشراف (B.12 supervision_delays_report) */
export async function reportSupervisionDelays(opts: { option?: string } = {}): Promise<ReportTable> {
  const option = opts.option || "unpaid";
  const finances = await loadContractsFinance({ excludeStatuses: [...STATUS_CANCELLED, ...STATUS_CLOSED] });
  const heads = ["العميل", "العقد", "العنوان", "بداية الإشراف", "مدة العقد الأساسي", "نهاية الأساس", "التمديد المدفوع", "المدة الملغاة", "سبب الإلغاء", "نهاية المدة كاملة", "التأخير (شهور)", "التأخير (مبالغ)"];
  const rows: (string | number)[][] = [];
  const accentRows: number[] = [];
  const data: { f: ContractFinance; delayValue: number }[] = [];
  for (const f of finances) {
    if (!f.isSup || !f.sup) continue;
    const s = f.sup;
    if (option === "unpaid" && s.delayMonths <= 0 && s.unpaidExtMonths <= 0) continue;
    data.push({ f, delayValue: s.delayValue });
  }
  // ترتيب: الأكبر تأخيرًا بالمبالغ ثم بالشهور
  data.sort((a, b) => b.delayValue - a.delayValue || (b.f.sup?.delayMonths || 0) - (a.f.sup?.delayMonths || 0));
  let tDelay = 0;
  for (const { f } of data) {
    const s = f.sup!;
    if (s.delayMonths > 0) accentRows.push(rows.length);
    rows.push([
      f.customerName,
      `${f.contractNumber}${f.contractName ? ` — ${f.contractName}` : ""}`,
      f.customerAddress || "",
      f.supStartDate || "",
      `${f.supMonths} شهر`,
      s.baseEnd || "",
      `${supPaidExtMonths(s, f.supMonthly)} شهر`,
      f.supWaivedMonths > 0 ? `${f.supWaivedMonths} شهر` : "—",
      f.supWaiveReason || "",
      s.fullEnd || "",
      s.delayMonths,
      s.delayValue,
    ]);
    tDelay = r3(tDelay + s.delayValue);
  }
  return {
    title: "تقرير تأخير الإشراف الهندسي",
    heads,
    rows,
    numberCols: [10, 11],
    accentRows,
    totals: { delayValue: tDelay },
    note: "كل شهر يبدأ من نهاية المدة كاملة يُحسب شهر تأخير كاملًا",
  };
}

/** 7) تقرير مقاولي الباطن الشامل (B.11) */
export async function reportSubcontractors(): Promise<ReportTable> {
  const subs = await db.subcontractor.findMany({
    include: { subContracts: { where: { status: { not: "ملغى" } }, include: { contract: { select: { contractNumber: true } } } } },
    orderBy: { name: "asc" },
  });
  const heads = ["#", "المقاول", "عقد العميل", "الوصف", "القيمة", "المدفوع", "المتبقي", "الحالة"];
  const rows: (string | number)[][] = [];
  const accentRows: number[] = [];
  const subIds = subs.map((s) => s.id);
  const payRows = subIds.length
    ? await db.voucher.findMany({
        where: { vtype: "payment", partyType: "subcontractor", partyId: { in: subIds }, cancelled: false, OR: [{ contractId: null }, { contract: { status: { not: "ملغى" } } }] },
        select: { partyId: true, subContractId: true, amount: true },
      })
    : [];
  let tAmount = 0;
  let tPaid = 0;
  let tRem = 0;
  for (const sub of subs) {
    let sumAmount = 0;
    for (const sc of sub.subContracts) {
      const amount = Number(sc.amount);
      const paid = r3(payRows.filter((p) => p.subContractId === sc.id).reduce((s, p) => s + Number(p.amount), 0));
      const remaining = r3(amount - paid);
      rows.push([
        rows.length + 1, sub.name, sc.contract ? sc.contract.contractNumber : "", sc.description || "",
        r3(amount), paid, remaining, sc.status,
      ]);
      sumAmount = r3(sumAmount + amount);
    }
    // السندات بلا عقد باطن مرتبط
    const orphanPaid = r3(payRows.filter((p) => p.partyId === sub.id && !p.subContractId).reduce((s, p) => s + Number(p.amount), 0));
    const paidTotal = r3(payRows.filter((p) => p.partyId === sub.id).reduce((s, p) => s + Number(p.amount), 0));
    const remainingTotal = r3(sumAmount - paidTotal);
    accentRows.push(rows.length);
    rows.push(["", sub.name, "", orphanPaid > EPS ? "منها صرف بلا عقد باطن مرتبط" : "الإجمالي", sumAmount, paidTotal, remainingTotal, ""]);
    tAmount = r3(tAmount + sumAmount);
    tPaid = r3(tPaid + paidTotal);
    tRem = r3(tRem + remainingTotal);
  }
  return {
    title: "تقرير مقاولي الباطن الشامل",
    heads,
    rows,
    numberCols: [4, 5, 6],
    accentRows,
    totals: { amount: tAmount, paid: tPaid, remaining: tRem },
    note: subs.length === 0 ? "لا يوجد مقاولون مسجلون" : undefined,
  };
}

/** 8) إيرادات ومصروفات (B.10 vouchers_period + أعمدة reports_page 970-1026) */
export async function reportVouchers(opts: { from?: string; to?: string; option?: string }): Promise<ReportTable> {
  const from = opts.from || "";
  const to = opts.to || "";
  const option = opts.option || "all";
  const where: Prisma.VoucherWhereInput = {
    cancelled: false,
    vtype: { in: ["receipt", "payment", "custody_return", "salary_deduction"] },
  };
  if (from || to) where.vdate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  const rows0 = await db.voucher.findMany({
    where,
    include: {
      contract: { select: { contractNumber: true } },
      expenseAccount: { select: { fullPath: true } },
    },
    orderBy: [{ vdate: "asc" }, { id: "asc" }],
  });

  const accountLabel = (v: (typeof rows0)[number]): string => {
    const path = v.expenseAccountSnapshot || v.expenseAccount?.fullPath || "";
    if (path) {
      const parts = path.split("/").map((p) => p.trim()).filter(Boolean);
      if (parts.length > 1) return `${parts[0]} / ${parts[parts.length - 1]}`;
      return parts[0] || "";
    }
    return v.account || "";
  };

  const heads = ["م", "التاريخ", "السند", "النوع", "الجهة", "الحساب", "العقد", "طريقة الدفع", "المبلغ", "البيان"];
  const rows: (string | number)[][] = [];
  const typeLabel: Record<string, string> = {
    receipt: "قبض", payment: "صرف", custody_return: "إرجاع عهدة", salary_deduction: "خصم راتب",
  };
  let tIn = 0;
  let tOut = 0;
  let tRec = 0;
  let idx = 1;
  for (const v of rows0) {
    const isPartner = v.partyType === "partner";
    const isSettlement = Boolean(v.custodyAccountId) && Boolean(v.expenseGroupRef);
    const amount = Number(v.amount);
    if (option === "income" && v.vtype !== "receipt") continue;
    if (option === "expenses" && !(v.vtype === "payment" || v.vtype === "custody_return" || v.vtype === "salary_deduction")) continue;
    rows.push([
      idx++, v.vdate, v.voucherNumber, typeLabel[v.vtype] || v.vtype,
      v.party || (v.partyType === "customer" ? "عميل" : "") || "",
      accountLabel(v),
      v.contract?.contractNumber || "",
      v.method || "",
      r3(amount),
      v.description || "",
    ]);
    if (v.vtype === "receipt" && !isPartner) tIn = r3(tIn + amount);
    else if (v.vtype === "payment" && !isPartner && !isSettlement) tOut = r3(tOut + amount);
    else if (v.vtype === "custody_return") tRec = r3(tRec + amount);
  }
  return {
    title: "تقرير الإيرادات والمصروفات",
    heads,
    rows,
    numberCols: [8],
    accentRows: [],
    totals: { totalIn: tIn, totalOut: tOut, recoveries: tRec, net: r3(tIn - tOut + tRec) },
    note: "سندات تصفية العهدة المجمعة تُستبعد من إجمالي المنصرف، وسندات الشريك تُستبعد من الإجماليات",
  };
}

/** 9) تفصيل المصروفات بشجرة الحسابات (B.9 expenses_report) */
export async function reportExpenses(opts: { from?: string; to?: string }): Promise<ReportTable> {
  const from = opts.from || "";
  const to = opts.to || "";
  const where: Prisma.VoucherWhereInput = {
    cancelled: false,
    vtype: { in: ["payment", "custody_return", "salary_deduction"] },
  };
  if (from || to) where.vdate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  const rows0 = await db.voucher.findMany({
    where,
    include: { expenseAccount: { select: { id: true, fullPath: true, includeInProfitability: true, accountKind: true } } },
    orderBy: [{ vdate: "asc" }, { id: "asc" }],
  });

  interface Acc { label: string; count: number; total: number; profitability: boolean | null }
  const byAccount = new Map<string, Acc>();
  const ensureAcc = (label: string, profitability: boolean | null): Acc => {
    let a = byAccount.get(label);
    if (!a) {
      a = { label, count: 0, total: 0, profitability };
      byAccount.set(label, a);
    }
    return a;
  };

  for (const v of rows0) {
    const amount = Number(v.amount);
    if (v.vtype === "payment") {
      // استبعاد صرف العهد المجمّع (تصفية العهدة لا تصرف نقدًا جديدًا)
      if (v.custodyAccountId && v.expenseGroupRef) continue;
      if (v.partyType === "partner") continue;
      const path = v.expenseAccountSnapshot || v.expenseAccount?.fullPath || v.account || "غير محدد";
      const acc = ensureAcc(path, v.expenseAccount ? v.expenseAccount.includeInProfitability : true);
      acc.count += 1;
      acc.total = r3(acc.total + amount);
    } else if (v.vtype === "custody_return" && v.advanceEmployeeId) {
      const acc = ensureAcc("سلف الموظفين", false);
      acc.count += 1;
      acc.total = r3(acc.total - amount);
    } else if (v.vtype === "salary_deduction") {
      const acc = ensureAcc("سلف الموظفين", false);
      acc.count += 1;
      acc.total = r3(acc.total + (v.advanceEmployeeId ? amount : -amount));
    }
  }

  const heads = ["الحساب", "عدد السندات", "الإجمالي", "ضمن الربحية"];
  const rows: (string | number)[][] = [];
  const sorted = [...byAccount.values()].sort((a, b) => b.total - a.total);
  let tTotal = 0;
  let tCount = 0;
  for (const a of sorted) {
    rows.push([a.label, a.count, a.total, a.profitability === false ? "لا" : "نعم"]);
    tTotal = r3(tTotal + a.total);
    tCount += a.count;
  }
  return {
    title: "تفصيل المصروفات بشجرة الحسابات",
    heads,
    rows,
    numberCols: [1, 2],
    accentRows: [],
    totals: { count: tCount, total: tTotal },
    note: "المبالغ السالبة تخفيض للسلفة (رد/خصم)، وحسابات العُهد غير محتسبة في الربحية الفعلية",
  };
}

/** 10) التدفق النقدي (E — cash_flow_report/detail) */
export async function reportCashflow(opts: { from?: string; to?: string; mode?: string }): Promise<ReportTable> {
  const from = opts.from || "";
  const to = opts.to || "";
  const mode = opts.mode || "summary";
  const settings = await getSettingsRow();
  const floor = settings.cashStartDate || settings.openingBalanceDate || "";
  const opening = r3(Number(settings.openingBalanceBank) + Number(settings.openingBalanceCash));

  const where: Prisma.VoucherWhereInput = { cancelled: false };
  const rangeFrom = floor && (!from || from < floor) ? floor : from;
  if (rangeFrom || to) where.vdate = { ...(rangeFrom ? { gte: rangeFrom } : {}), ...(to ? { lte: to } : {}) };
  const rows0 = await db.voucher.findMany({
    where,
    include: {
      contract: { select: { contractNumber: true } },
      employee: { select: { name: true } },
    },
    orderBy: [{ vdate: "asc" }, { id: "asc" }],
  });

  // ===== المرحلة 5: أنماط *_only الأربعة — مرآة _data_cash_flow المكتبي (reports_page.py:474+) =====
  // نفس تصنيفات الوضع التفصيلي القائم: بلا الشريك · بلا تصفيات العهد المجمّع · بلا ردّ السلف
  if (mode === "receipts_only" || mode === "payments_only" || mode === "recoveries_only" || mode === "transfers_only") {
    const receipts: CashItem[] = [];
    const payments: CashItem[] = [];
    const recoveries: CashItem[] = [];
    const transfers: TransferItem[] = [];
    for (const v of rows0) {
      const amount = Number(v.amount);
      const party = v.party || v.employee?.name || "";
      const contract = v.contract?.contractNumber || "";
      const desc = v.description || "";
      if (v.vtype === "receipt") {
        if (v.advanceEmployeeId || desc.startsWith("رد سلفة")) continue;
        if (v.partyType === "partner") continue;
        receipts.push({ vdate: v.vdate, party, contract, amount, desc });
      } else if (v.vtype === "payment") {
        if (v.custodyAccountId && v.expenseGroupRef) continue;
        if (v.partyType === "partner") continue;
        payments.push({ vdate: v.vdate, party, contract, amount, desc });
      } else if (v.vtype === "custody_return") {
        recoveries.push({ vdate: v.vdate, party, contract, amount, desc });
      } else if (v.vtype === "transfer") {
        transfers.push({ vdate: v.vdate, from: v.method, to: v.account, amount, desc });
      }
    }
    const built =
      mode === "receipts_only" ? cashflowReceiptsOnly(receipts)
      : mode === "payments_only" ? cashflowPaymentsOnly(payments)
      : mode === "recoveries_only" ? cashflowRecoveriesOnly(recoveries)
      : cashflowTransfersOnly(transfers);
    return {
      title: built.title,
      heads: built.heads,
      rows: built.rows,
      numberCols: [4],
      accentRows: [],
      totals: built.totalsRow,
      note: built.note,
    };
  }

  interface Bucket { inflow: number; outflow: number; bankFees: number; recoveries: number; partnerNet: number; net: number; rows: { date: string; kind: string; party: string; contract: string; amount: number; desc: string }[] }
  const isFee = (v: (typeof rows0)[number]) => v.parentVoucherId !== null || (v.notes || "").startsWith("BANK_FEE");
  const blank = (): Bucket => ({ inflow: 0, outflow: 0, bankFees: 0, recoveries: 0, partnerNet: 0, net: 0, rows: [] });
  const buckets = new Map<string, Bucket>();
  const bucketFor = (vdate: string): Bucket => {
    let key = "الكل";
    if (mode === "daily") key = vdate;
    else if (mode === "monthly") key = vdate.slice(0, 7);
    else if (mode === "yearly") key = vdate.slice(0, 4);
    let b = buckets.get(key);
    if (!b) {
      b = blank();
      buckets.set(key, b);
    }
    return b;
  };

  for (const v of rows0) {
    const amount = Number(v.amount);
    const b = bucketFor(v.vdate);
    const party = v.party || v.employee?.name || "";
    const contract = v.contract?.contractNumber || "";
    const desc = v.description || "";
    if (v.vtype === "transfer") continue; // تحويل داخلي: مستبعد
    if (v.vtype === "salary_deduction") continue; // بلا حركة نقدية
    if (v.vtype === "receipt") {
      if (v.advanceEmployeeId || desc.startsWith("رد سلفة")) continue; // رد سلفة: لا يغير الرصيد
      if (v.partyType === "partner") {
        b.partnerNet = r3(b.partnerNet + amount);
      } else {
        b.inflow = r3(b.inflow + amount);
      }
      b.rows.push({ date: v.vdate, kind: "قبض", party, contract, amount, desc });
    } else if (v.vtype === "payment") {
      if (v.custodyAccountId && v.expenseGroupRef) continue; // تصفية عهدة مجمعة
      b.outflow = r3(b.outflow + amount);
      if (isFee(v)) b.bankFees = r3(b.bankFees + amount);
      if (v.partyType === "partner") b.partnerNet = r3(b.partnerNet - amount);
      b.rows.push({ date: v.vdate, kind: isFee(v) ? "رسوم بنكية" : "صرف", party, contract, amount: -amount, desc });
    } else if (v.vtype === "custody_return") {
      b.recoveries = r3(b.recoveries + amount);
      b.rows.push({ date: v.vdate, kind: "إرجاع عهدة", party, contract, amount, desc });
    }
  }
  for (const b of buckets.values()) b.net = r3(b.inflow - b.outflow + b.recoveries + b.partnerNet);

  const keys = [...buckets.keys()].sort();
  let tInflow = 0;
  let tOutflow = 0;
  let tFees = 0;
  let tRec = 0;
  let tPartner = 0;
  for (const k of keys) {
    const b = buckets.get(k)!;
    tInflow = r3(tInflow + b.inflow);
    tOutflow = r3(tOutflow + b.outflow);
    tFees = r3(tFees + b.bankFees);
    tRec = r3(tRec + b.recoveries);
    tPartner = r3(tPartner + b.partnerNet);
  }
  const net = r3(tInflow - tOutflow + tRec + tPartner);
  const closing = r3(opening + net);

  if (mode === "detail") {
    const heads = ["م", "التاريخ", "النوع", "الجهة", "العقد", "المبلغ", "البيان"];
    const rows: (string | number)[][] = [];
    let idx = 1;
    let balance = opening;
    for (const k of keys) {
      const b = buckets.get(k)!;
      for (const r of b.rows) {
        balance = r3(balance + r.amount);
        rows.push([idx++, r.date, r.kind, r.party, r.contract, r.amount, r.desc]);
      }
    }
    return {
      title: "التقرير المالي — تفصيل الحركات",
      heads,
      rows,
      numberCols: [5],
      accentRows: [],
      totals: { opening, inflow: tInflow, outflow: tOutflow, bankFees: tFees, recoveries: tRec, partnerNet: tPartner, net, closing, balance },
      note: floor ? `الحركات الأقدم من ${floor} مستبعدة (تاريخ بدء التدفق النقدي)` : "التحويلات الداخلية وخصم الرواتب لا تحرك النقد فتُستبعد",
    };
  }

  if (mode === "summary") {
    const heads = ["البيان", "المبلغ"];
    const rows: (string | number)[][] = [
      ["الرصيد الافتتاحي", opening],
      ["الوارد", tInflow],
      ["المنصرف", tOutflow],
      ["منها رسوم بنكية", tFees],
      ["المسترد (إرجاع عهد)", tRec],
      ["حركات الشريك", tPartner],
      ["صافي الحركة", net],
      ["الرصيد الختامي", closing],
    ];
    return {
      title: "التقرير المالي — ملخص",
      heads,
      rows,
      numberCols: [1],
      accentRows: [0, 6, 7],
      totals: { opening, inflow: tInflow, outflow: tOutflow, bankFees: tFees, recoveries: tRec, partnerNet: tPartner, net, closing },
      note: floor ? `الحركات الأقدم من ${floor} مستبعدة (تاريخ بدء التدفق النقدي)` : undefined,
    };
  }

  // daily / monthly / yearly
  const heads = ["الفترة", "الوارد", "المنصرف", "منها رسوم بنك", "المسترد", "الشريك", "صافي الفترة", "الرصيد"];
  const rows: (string | number)[][] = [];
  let balance = opening;
  const accentRows: number[] = [];
  for (const k of keys) {
    const b = buckets.get(k)!;
    balance = r3(balance + b.net);
    const label = mode === "monthly" ? monthLabel(k) : k;
    rows.push([label, b.inflow, b.outflow, b.bankFees, b.recoveries, b.partnerNet, b.net, balance]);
  }
  accentRows.push(rows.length - 1);
  return {
    title: mode === "daily" ? "التقرير المالي — يومي" : mode === "yearly" ? "التقرير المالي — سنوي" : "التقرير المالي — شهري",
    heads,
    rows,
    numberCols: [1, 2, 3, 4, 5, 6, 7],
    accentRows,
    totals: { opening, inflow: tInflow, outflow: tOutflow, bankFees: tFees, recoveries: tRec, partnerNet: tPartner, net, closing },
    note: floor ? `الحركات الأقدم من ${floor} مستبعدة (تاريخ بدء التدفق النقدي)` : undefined,
  };
}

/** 11) تقارير العقود (B.7 + contracts_overview + expiring) */
export async function reportContracts(opts: { option?: string; from?: string; to?: string }): Promise<ReportTable> {
  const option = opts.option || "all";
  const from = opts.from || "";
  const to = opts.to || "";
  const today = todayStr();

  if (option === "profitability") {
    const finances = await loadContractsFinance({ excludeStatuses: [...STATUS_CANCELLED, ...STATUS_DRAFT] });
    const ids = finances.map((f) => f.id);
    const payRows = ids.length
      ? await db.voucher.findMany({
          where: {
            vtype: "payment", cancelled: false,
            OR: [{ contractId: { in: ids } }, { subContract: { contractId: { in: ids } } }],
          },
          select: { contractId: true, subContractId: true, partyType: true, amount: true, expenseAccountId: true, expenseAccount: { select: { includeInProfitability: true } } },
        })
      : [];
    const subRows = ids.length
      ? await db.subContract.findMany({ where: { contractId: { in: ids }, status: { not: "ملغى" } }, select: { id: true, contractId: true, amount: true } })
      : [];
    const paidFor = (contractId: number): number => {
      const directIds = subRows.filter((s) => s.contractId === contractId).map((s) => s.id);
      return r3(
        payRows
          .filter((p) => {
            const belongs = p.contractId === contractId || (p.subContractId !== null && directIds.includes(p.subContractId));
            if (!belongs) return false;
            if (p.expenseAccountId && p.expenseAccount && !p.expenseAccount.includeInProfitability) return false;
            return true;
          })
          .reduce((s, p) => s + Number(p.amount), 0)
      );
    };
    const otherFor = (contractId: number): number => {
      const directIds = subRows.filter((s) => s.contractId === contractId).map((s) => s.id);
      return r3(
        payRows
          .filter((p) => {
            const belongs = p.contractId === contractId || (p.subContractId !== null && directIds.includes(p.subContractId));
            if (!belongs) return false;
            if (p.expenseAccountId && p.expenseAccount && !p.expenseAccount.includeInProfitability) return false;
            if (p.subContractId !== null || p.partyType === "subcontractor") return false;
            return true;
          })
          .reduce((s, p) => s + Number(p.amount), 0)
      );
    };
    const heads = ["العميل", "العقد", "نوع العقد", "قيمة العقد", "المحصّل", "المنصرف الفعلي", "الربح الفعلي", "تكلفة متوقعة", "ربح متوقع", "الهامش %"];
    const rows: (string | number)[][] = [];
    const accentRows: number[] = [];
    let tActualProfit = 0;
    let tExpectedProfit = 0;
    for (const f of finances) {
      // قيمة الربحية = amount + ملاحق معتمدة فقط (بلا تمديد إشراف) — B.7 حرفيًا
      const value = r3(f.amount + f.addNet);
      const paid = paidFor(f.id);
      const otherPaid = otherFor(f.id);
      const subsTotal = r3(subRows.filter((s) => s.contractId === f.id).reduce((s2, x) => s2 + Number(x.amount), 0));
      const expectedCost = r3(subsTotal + otherPaid);
      const expectedProfit = r3(value - expectedCost);
      const actualProfit = r3(f.collected - paid);
      const margin = f.collected > EPS ? r3((actualProfit / f.collected) * 100) : 0;
      if (actualProfit < -EPS) accentRows.push(rows.length);
      rows.push([
        f.customerName,
        `${f.contractNumber}${f.contractName ? ` — ${f.contractName}` : ""}`,
        f.contractType, value, f.collected, paid, actualProfit, expectedCost, expectedProfit, margin,
      ]);
      tActualProfit = r3(tActualProfit + actualProfit);
      tExpectedProfit = r3(tExpectedProfit + expectedProfit);
    }
    return {
      title: "تقرير ربحية العقود",
      heads,
      rows,
      numberCols: [3, 4, 5, 6, 7, 8, 9],
      accentRows,
      totals: { actualProfit: tActualProfit, expectedProfit: tExpectedProfit },
      note: "الربح الفعلي = المحصّل − المنصرف (بحسابات ضمن الربحية فقط)؛ المتوقعة = القيمة − (الباطن + منصرف آخر)",
    };
  }

  if (option === "by_type") {
    const finances = await loadContractsFinance({ excludeStatuses: [...STATUS_CANCELLED, ...STATUS_DRAFT] });
    const byType = new Map<string, { count: number; value: number; collected: number; remaining: number }>();
    for (const f of finances) {
      const t = byType.get(f.contractType) || { count: 0, value: 0, collected: 0, remaining: 0 };
      t.count += 1;
      t.value = r3(t.value + f.current);
      t.collected = r3(t.collected + f.collected);
      t.remaining = r3(t.remaining + f.remaining);
      byType.set(f.contractType, t);
    }
    const heads = ["نوع العقد", "عدد العقود", "القيمة الحالية", "المحصّل", "المتبقي"];
    const rows: (string | number)[][] = [...byType.entries()].sort((a, b) => b[1].value - a[1].value)
      .map(([type, t]) => [type, t.count, t.value, t.collected, t.remaining]);
    return {
      title: "تقرير العقود حسب النوع",
      heads,
      rows,
      numberCols: [1, 2, 3, 4],
      accentRows: [],
      totals: {
        count: [...byType.values()].reduce((s, t) => s + t.count, 0),
        value: r3([...byType.values()].reduce((s, t) => s + t.value, 0)),
        collected: r3([...byType.values()].reduce((s, t) => s + t.collected, 0)),
        remaining: r3([...byType.values()].reduce((s, t) => s + t.remaining, 0)),
      },
    };
  }

  if (option === "expiring") {
    const settings = await getSettingsRow();
    const window = Number((settings.expiryAlerts || "90,60,30,7").split(",")[0]) || 90;
    const finances = await loadContractsFinance({ excludeStatuses: [...STATUS_CANCELLED, ...STATUS_CLOSED] });
    const heads = ["العميل", "العقد", "تاريخ الانتهاء", "الأيام المتبقية", "القيمة الحالية", "المتبقي", "الحالة"];
    const rows: (string | number)[][] = [];
    const accentRows: number[] = [];
    const data = finances
      .filter((f) => f.endDate && daysBetween(today, f.endDate) >= 0 && daysBetween(today, f.endDate) <= window)
      .sort((a, b) => (a.endDate < b.endDate ? -1 : 1));
    for (const f of data) {
      const daysLeft = daysBetween(today, f.endDate);
      if (daysLeft <= 7) accentRows.push(rows.length);
      rows.push([
        f.customerName,
        `${f.contractNumber}${f.contractName ? ` — ${f.contractName}` : ""}`,
        f.endDate, daysLeft, f.current, f.remaining, f.status,
      ]);
    }
    return {
      title: `عقود تنتهي خلال ${window} يومًا`,
      heads,
      rows,
      numberCols: [3, 4, 5],
      accentRows,
      totals: { count: rows.length, remaining: r3(data.reduce((s, f) => s + f.remaining, 0)) },
      note: `نافذة التنبيه من إعدادات النظام: ${settings.expiryAlerts}`,
    };
  }

  // option = all
  const whereDate: Prisma.ContractWhereInput = {};
  if (from || to) whereDate.contractDate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  const finances = await loadContractsFinance({ excludeStatuses: [...STATUS_CANCELLED, ...STATUS_DRAFT] });
  const filtered = finances.filter((f) => {
    if (!from && !to) return true;
    if (from && f.contractDate < from) return false;
    if (to && f.contractDate > to) return false;
    return true;
  });
  void whereDate;
  const heads = ["العميل", "العقد", "تاريخ العقد", "تاريخ الانتهاء", "الحالة", "القيمة الأصلية", "الإضافات", "تمديد الإشراف", "القيمة الحالية", "المحصّل", "المتبقي"];
  const rows: (string | number)[][] = [];
  const accentRows: number[] = [];
  let tOriginal = 0;
  let tAdd = 0;
  let tSup = 0;
  let tCurrent = 0;
  let tCollected = 0;
  let tRemaining = 0;
  for (const f of filtered) {
    if (f.remaining > EPS) accentRows.push(rows.length);
    rows.push([
      f.customerName,
      `${f.contractNumber}${f.contractName ? ` — ${f.contractName}` : ""}`,
      f.contractDate, f.endDate || "", f.status,
      f.amount, f.addNet, f.supExt, f.current, f.collected, f.remaining,
    ]);
    tOriginal = r3(tOriginal + f.amount);
    tAdd = r3(tAdd + f.addNet);
    tSup = r3(tSup + f.supExt);
    tCurrent = r3(tCurrent + f.current);
    tCollected = r3(tCollected + f.collected);
    tRemaining = r3(tRemaining + f.remaining);
  }
  return {
    title: "تقرير العقود",
    heads,
    rows,
    numberCols: [5, 6, 7, 8, 9, 10],
    accentRows,
    totals: { original: tOriginal, addendums: tAdd, supervision: tSup, current: tCurrent, collected: tCollected, remaining: tRemaining },
  };
}

/** 12) مراحل التنفيذ (D — execution / occupancy) */
export async function reportExecution(opts: { option?: string; contractType?: string; stage?: string } = {}): Promise<ReportTable> {
  const option = opts.option || "stages";
  const today = todayStr();
  const contracts = await db.contract.findMany({
    where: { status: { notIn: [...STATUS_CANCELLED, ...STATUS_DRAFT] } },
    select: {
      id: true, contractNumber: true, contractName: true, contractType: true, customer: { select: { name: true } },
      stages: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { name: true, sortOrder: true, startDate: true, endDate: true, isSkipped: true, expectedDays: true, closedBy: true } },
    },
    orderBy: [{ contractDate: "asc" }, { id: "asc" }],
  });

  if (option === "occupancy") {
    const byStage = new Map<string, { total: number; over: number; near: number }>();
    for (const c of contracts) {
      if (opts.contractType && c.contractType !== opts.contractType) continue;
      const current = c.stages.find((s) => s.startDate && !s.endDate && !s.isSkipped);
      if (!current) continue;
      if (opts.stage && current.name !== opts.stage) continue;
      const expected = current.expectedDays;
      const daysIn = current.startDate ? Math.max(0, daysBetween(current.startDate, today)) : 0;
      const state = expected > 0 ? (daysIn > expected ? "over" : daysIn >= expected - 3 ? "near" : "ok") : "ok";
      const t = byStage.get(current.name) || { total: 0, over: 0, near: 0 };
      t.total += 1;
      if (state === "over") t.over += 1;
      else if (state === "near") t.near += 1;
      byStage.set(current.name, t);
    }
    const heads = ["المرحلة", "عدد العقود الجارية", "متأخرة", "قاربت"];
    const rows: (string | number)[][] = [...byStage.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([name, t]) => [name, t.total, t.over, t.near]);
    return {
      title: "إشغال مراحل التنفيذ",
      heads,
      rows,
      numberCols: [1, 2, 3],
      accentRows: [],
      totals: { contracts: rows.reduce((s, r) => s + Number(r[1]), 0), over: rows.reduce((s, r) => s + Number(r[2]), 0), near: rows.reduce((s, r) => s + Number(r[3]), 0) },
    };
  }

  // option = stages — صف لكل عقد بمرحلته الجارية
  interface Row { customer: string; contract: string; stage: string; next: string; start: string; daysIn: number; expected: number; label: string; sortKey: number; overBy: number }
  const data: Row[] = [];
  for (const c of contracts) {
    if (opts.contractType && c.contractType !== opts.contractType) continue;
    const stages = c.stages;
    if (stages.length === 0) {
      data.push({ customer: c.customer.name, contract: `${c.contractNumber}${c.contractName ? ` — ${c.contractName}` : ""}`, stage: "—", next: "—", start: "", daysIn: 0, expected: 0, label: "بلا مراحل", sortKey: 3, overBy: 0 });
      continue;
    }
    const current = stages.find((s) => s.startDate && !s.endDate && !s.isSkipped);
    const doneAll = stages.every((s) => s.endDate || s.isSkipped);
    if (!current) {
      data.push({ customer: c.customer.name, contract: `${c.contractNumber}${c.contractName ? ` — ${c.contractName}` : ""}`, stage: doneAll ? "مكتمل المسار" : "—", next: "—", start: "", daysIn: 0, expected: 0, label: doneAll ? "مكتمل" : "جارٍ", sortKey: 4, overBy: 0 });
      continue;
    }
    if (opts.stage && current.name !== opts.stage) continue;
    const idx = stages.indexOf(current);
    const nextStage = stages.slice(idx + 1).find((s) => !s.startDate && !s.isSkipped);
    const expected = current.expectedDays;
    const daysIn = current.startDate ? Math.max(0, daysBetween(current.startDate, today)) : 0;
    let label = "جارٍ";
    let sortKey = 3;
    let overBy = 0;
    if (expected > 0) {
      if (daysIn > expected) {
        overBy = daysIn - expected;
        label = `متأخر ${overBy} يوم`;
        sortKey = 0;
      } else if (daysIn >= expected - 3) {
        label = `قارب · بقي ${expected - daysIn} يوم`;
        sortKey = 1;
      } else {
        label = `ضمن الوقت · بقي ${expected - daysIn} يوم`;
      }
    }
    data.push({
      customer: c.customer.name,
      contract: `${c.contractNumber}${c.contractName ? ` — ${c.contractName}` : ""}`,
      stage: current.name, next: nextStage?.name || "—", start: current.startDate, daysIn, expected, label, sortKey, overBy,
    });
  }
  data.sort((a, b) => a.sortKey - b.sortKey || b.overBy - a.overBy || b.daysIn - a.daysIn || a.customer.localeCompare(b.customer, "ar"));

  const heads = ["العميل", "العقد", "المرحلة الحالية", "المرحلة التالية", "بدأت", "أيام مرت", "المتوقع", "الحالة"];
  const rows: (string | number)[][] = data.map((r) => [r.customer, r.contract, r.stage, r.next, r.start, r.daysIn, r.expected, r.label]);
  const accentRows = data.map((r, i) => (r.sortKey === 0 ? i : -1)).filter((i) => i >= 0);
  return {
    title: "تقرير مراحل التنفيذ",
    heads,
    rows,
    numberCols: [5, 6],
    accentRows,
    totals: { contracts: rows.length, delayed: accentRows.length },
    note: "المعيار زمني: over إذا تجاوزت الأيام المتوقع، near إذا اقتربت (≥ المتوقع − 3)",
  };
}

/** 13) دفتر اليومية (B.15 journal_report) */
export async function reportJournal(opts: { from?: string; to?: string }): Promise<ReportTable> {
  const from = opts.from || "";
  const to = opts.to || "";
  const where: Prisma.JournalEntryWhereInput = {};
  if (from || to) where.entryDate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  const entries = await db.journalEntry.findMany({
    where,
    orderBy: [{ entryDate: "asc" }, { id: "asc" }],
    take: 5000,
  });
  const heads = ["التاريخ", "البيان", "الحساب المدين", "الحساب الدائن", "المبلغ"];
  const rows: (string | number)[][] = entries.map((e) => [
    e.entryDate,
    e.sourceType === "voucher_cancel" ? `${e.description} · (قيد عكسي)` : e.description,
    e.debitAccount, e.creditAccount, Number(e.amount),
  ]);
  const total = r3(entries.reduce((s, e) => s + Number(e.amount), 0));
  return {
    title: "دفتر اليومية",
    heads,
    rows,
    numberCols: [4],
    accentRows: [],
    totals: { debit: total, credit: total, balanced: "نعم" },
  };
}

/** 14) ملخص البوابة T+1 (B.15 gateway_summary) — أعمدة جاهزة حتى امتلاء بيانات البوابة */
export async function reportGatewaySummary(): Promise<ReportTable> {
  const today = todayStr();
  const ops = await db.gatewayOp.findMany({ where: { status: "mine" } });
  const heads = ["البوابة", "عدد العمليات", "إجمالي المبلغ", "المحصلة (T+1)", "المعلقة", "الصافي"];
  const rows: (string | number)[][] = [];
  const byGw = new Map<string, { count: number; total: number; collected: number; pending: number }>();
  for (const op of ops) {
    const g = byGw.get(op.gateway) || { count: 0, total: 0, collected: 0, pending: 0 };
    g.count += 1;
    g.total = r3(g.total + Number(op.amount));
    if (op.effectiveDate && op.effectiveDate <= today) g.collected = r3(g.collected + Number(op.amount));
    else g.pending = r3(g.pending + Number(op.amount));
    byGw.set(op.gateway, g);
  }
  for (const [gw, g] of [...byGw.entries()].sort((a, b) => b[1].total - a[1].total)) {
    rows.push([gw, g.count, g.total, g.collected, g.pending, g.collected]);
  }
  return {
    title: "ملخص البوابة المالية (T+1)",
    heads,
    rows,
    numberCols: [1, 2, 3, 4, 5],
    accentRows: [],
    totals: {
      ops: rows.reduce((s, r) => s + Number(r[1]), 0),
      total: r3(rows.reduce((s, r) => s + Number(r[2]), 0)),
      collected: r3(rows.reduce((s, r) => s + Number(r[3]), 0)),
      pending: r3(rows.reduce((s, r) => s + Number(r[4]), 0)),
    },
    note: ops.length === 0 ? "لا توجد عمليات بوابة مسجلة بعد — تُملأ البيانات تلقائيًا بعد تفعيل مرحلة البوابة" : "المحصلة = عمليات بتاريخ سريان خلال T+1 حتى اليوم",
  };
}

// ===================================================================
// تحويل شكل التقرير الموحد إلى CSV (بترميز UTF-8 مع BOM للعربية)
// ===================================================================
function csvField(v: string | number): string {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    return Number.isInteger(v) ? String(v) : String(r3(v));
  }
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportTableToCsv(table: ReportTable): string {
  const lines: string[] = [];
  lines.push(csvField(table.title));
  lines.push("");
  lines.push(table.heads.map(csvField).join(","));
  for (const row of table.rows) lines.push(row.map(csvField).join(","));
  if (Array.isArray(table.totals)) {
    // صف الإجماليات المصفوفي (أنماط *_only) — صف واحد كالمكتبي حرفيًا
    if (table.totals.length > 0) lines.push(table.totals.map(csvField).join(","));
  } else if (table.totals && Object.keys(table.totals).length > 0) {
    lines.push("");
    lines.push(table.heads.map(() => "").join(","));
    lines.push(["الإجماليات", ...Object.entries(table.totals).map(([k, v]) => `${k}: ${csvField(v)}`)].filter(Boolean).join(","));
  }
  if (table.note) lines.push(`ملاحظة: ${table.note}`);
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
