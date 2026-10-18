import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { EPS, r3 } from "@/lib/contrack-core";
import { intOr } from "@/lib/contrack-server";
import {
  VOUCHER_PREFIX,
  VOUCHER_TYPE_LABELS,
  VOUCHER_TYPES,
  insertVoucherJournal,
  cancelVoucherTx,
  employeeAdvanceRemaining,
  normalizeAccount,
  VoucherError,
  type DbClient,
  type Tx,
} from "@/lib/voucher-server";
import { audit, nextNumber, normalizeArabic, parseDay, todayStr } from "@/lib/api-utils";

/**
 * مكتبة العُهد والسلف (Task 12-a) — القواعد الحاكمة:
 * - العهدة = ExpenseAccount(accountKind='advance') والرصيد = مُسلَّم − مُنفَق − مرتجع (محسوب لحظيًا، لا تخزين).
 * - المُسلَّم (handed): سندات صرف على الحساب بلا مرجع مجموعة (expenseGroupRef='') وبلا حساب مصروف.
 * - المُنفَق (spent): سندات التصفية (بمرجع مجموعة PAY-GRP-…) + أي صرف مباشر عليه بحساب مصروف — تعريف اتحادي
 *   يوافق تعريف المهمة (بالمجموعة) وتعريف voucher-server.custodyRemaining (بحساب المصروف) معًا.
 * - المرتجع (returned): سندات custody_return (CV) على الحساب.
 * - التصفية (القاعدة 8) لا تصرف نقدًا جديدًا: سند PV لكل بند بنفس مرجع المجموعة، القيد مدين (المصروف/العملاء) دائن اسم العهدة،
 *   بلا method وبلا أثر على بركة النقدية.
 * - سلف الموظفين: PV (صرف) / CV (رد نقدي) / SD (خصم راتب) على advance_employee_id، الرصيد = ΣPV − ΣCV − ΣSD بسقف قاطع.
 */

export interface CustodyBreakdown {
  handed: number;
  spent: number;
  returned: number;
  balance: number;
}

/** تفكيك حركات عهدة واحدة: مُسلَّم − مُنفَق − مرتجع (يعمل داخل معاملة إن مُمرَّر tx) */
export async function custodyBreakdown(client: DbClient, custodyAccountId: number): Promise<CustodyBreakdown> {
  const [handedAgg, groupedSpentAgg, directSpentAgg, returnedAgg] = await Promise.all([
    client.voucher.aggregate({
      where: { vtype: "payment", cancelled: false, custodyAccountId, expenseGroupRef: "", expenseAccountId: null },
      _sum: { amount: true },
    }),
    client.voucher.aggregate({
      where: { vtype: "payment", cancelled: false, custodyAccountId, expenseGroupRef: { not: "" } },
      _sum: { amount: true },
    }),
    client.voucher.aggregate({
      where: { vtype: "payment", cancelled: false, custodyAccountId, expenseGroupRef: "", expenseAccountId: { not: null } },
      _sum: { amount: true },
    }),
    client.voucher.aggregate({
      where: { vtype: "custody_return", cancelled: false, custodyAccountId },
      _sum: { amount: true },
    }),
  ]);
  const handed = r3(Number(handedAgg._sum.amount || 0));
  const spent = r3(Number(groupedSpentAgg._sum.amount || 0) + Number(directSpentAgg._sum.amount || 0));
  const returned = r3(Number(returnedAgg._sum.amount || 0));
  return { handed, spent, returned, balance: r3(handed - spent - returned) };
}

/** مرجع مجموعة التصفية اليومي PAY-GRP-YYYYMMDD-NNN عبر عدّاد ذري (NNN لكل يوم) */
export async function nextSettlementGroupRef(tx: Tx, vdate: string): Promise<string> {
  const ymd = (vdate || todayStr()).replace(/-/g, "");
  return nextNumber(`PAY-GRP-${ymd}`, 3, tx);
}

/** إعادة محاولة عند تضارب الترقيم الفريد P2002 (كما في createVoucher — 5 مرات) */
export async function withNumberRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof VoucherError) throw e;
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 4) {
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  console.error("فشل الترقيم بعد 5 محاولات:", lastError);
  throw new VoucherError("تعذر إنشاء المستند، حاول مجددًا", 500);
}

// ==================== بنود التصفية ====================

export interface SettlementLineInput {
  expenseAccountId?: number | null;
  customerId?: number | null;
  contractId?: number | null;
  amount: number;
  description?: string;
  party?: string;
  vdate?: string;
}

export interface CleanSettlementLine {
  amount: number;
  expenseAccountId: number | null;
  expenseAccountSnapshot: string;
  customerId: number | null;
  customerName: string;
  contractId: number | null;
  contractNumber: string;
  description: string;
  party: string;
  vdate: string;
}

/** تحقق بنود التصفية: مبلغ>0 لكل بند + صلاحية الحسابات + تطابق العقد مع العميل (spec A.5) */
export async function validateSettlementLines(rawLines: unknown): Promise<{ lines: CleanSettlementLine[]; total: number }> {
  const lines = Array.isArray(rawLines) ? (rawLines as SettlementLineInput[]) : [];
  if (lines.length === 0) throw new VoucherError("بنود التصفية مطلوبة (بند واحد على الأقل)");
  const clean: CleanSettlementLine[] = [];
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const amount = r3(Number(raw?.amount));
    if (!Number.isFinite(amount) || !(amount > 0)) {
      throw new VoucherError(`مبلغ البند رقم ${i + 1} يجب أن يكون أكبر من صفر`);
    }
    let expenseAccountId: number | null = null;
    let expenseAccountSnapshot = "";
    if (raw.expenseAccountId) {
      const acc = await db.expenseAccount.findUnique({ where: { id: intOr(raw.expenseAccountId, 0) } });
      if (!acc || !acc.allowPosting || acc.accountKind !== "expense") {
        throw new VoucherError(`حساب المصروف في البند رقم ${i + 1} غير صالح للترحيل`);
      }
      expenseAccountId = acc.id;
      expenseAccountSnapshot = acc.name;
    }
    let customerId: number | null = null;
    let customerName = "";
    if (raw.customerId) {
      const c = await db.customer.findUnique({
        where: { id: intOr(raw.customerId, 0) },
        select: { id: true, name: true },
      });
      if (!c) throw new VoucherError(`العميل في البند رقم ${i + 1} غير موجود`, 404);
      customerId = c.id;
      customerName = c.name;
    }
    let contractId: number | null = null;
    let contractNumber = "";
    if (raw.contractId) {
      const ct = await db.contract.findUnique({
        where: { id: intOr(raw.contractId, 0) },
        select: { id: true, contractNumber: true, customerId: true },
      });
      if (!ct) throw new VoucherError(`العقد في البند رقم ${i + 1} غير موجود`, 404);
      if (customerId && ct.customerId !== customerId) {
        throw new VoucherError(`العقد في البند رقم ${i + 1} يجب أن يخص العميل المحدد`);
      }
      contractId = ct.id;
      contractNumber = ct.contractNumber;
    }
    const description =
      String(raw.description || "").trim() ||
      (customerName && expenseAccountSnapshot
        ? `${customerName} — ${expenseAccountSnapshot}`
        : expenseAccountSnapshot || customerName || "تصفية عهدة");
    clean.push({
      amount,
      expenseAccountId,
      expenseAccountSnapshot,
      customerId,
      customerName,
      contractId,
      contractNumber,
      description,
      party: String(raw.party || "").trim() || customerName,
      vdate: parseDay(raw.vdate) || "",
    });
    total = r3(total + amount);
  }
  if (!(total > 0)) throw new VoucherError("إجمالي التصفية يجب أن يكون أكبر من صفر");
  return { lines: clean, total };
}

/**
 * إنشاء سند بند تصفية داخل معاملة: PV بلا method/account (لا صرف نقدي جديد) —
 * القيد: مدين (حساب المصروف أو «العملاء» عند وجود عميل أو «مصروفات أخرى») دائن اسم العهدة.
 */
export async function createSettlementVoucherInTx(
  tx: Tx,
  params: {
    vdate: string;
    custodyAccount: { id: number; name: string };
    groupRef: string;
    lineIndex: number;
    line: CleanSettlementLine;
    groupDescription: string;
    username: string;
  }
): Promise<{ id: number; voucherNumber: string; amount: number }> {
  const { line } = params;
  const tag = `تصفية عهدة من حساب: ${params.custodyAccount.name}`;
  const notes = params.groupDescription ? `${tag} — ${params.groupDescription}` : tag;
  const voucherNumber = await nextNumber(VOUCHER_PREFIX.payment, 4, tx);
  const voucher = await tx.voucher.create({
    data: {
      voucherNumber,
      vtype: "payment",
      vdate: params.vdate,
      party: line.party,
      partyType: "",
      partyId: null,
      method: "",
      account: "",
      custodyAccountId: params.custodyAccount.id,
      custodyAccountSnapshot: params.custodyAccount.name,
      expenseAccountId: line.expenseAccountId,
      expenseAccountSnapshot: line.expenseAccountSnapshot,
      expenseGroupRef: params.groupRef,
      expenseGroupLine: params.lineIndex + 1,
      expenseCustomerId: line.customerId,
      contractId: line.contractId,
      amount: line.amount,
      description: line.description,
      notes,
    },
  });
  const debitAccount = line.expenseAccountSnapshot || (line.customerId ? "العملاء" : "مصروفات أخرى");
  await tx.journalEntry.create({
    data: {
      entryDate: params.vdate,
      description: `${VOUCHER_TYPE_LABELS.payment} ${voucherNumber} — ${params.groupRef}`,
      debitAccount,
      creditAccount: params.custodyAccount.name,
      amount: line.amount,
      contractId: line.contractId,
      sourceType: "voucher",
      sourceId: voucher.id,
    },
  });
  if (line.contractId) {
    await tx.contractEvent.create({
      data: {
        contractId: line.contractId,
        eventType: "تصفية عهدة",
        description: `تصفية عهدة ${params.groupRef} — بند ${voucherNumber} بمبلغ ${line.amount}`,
        username: params.username,
      },
    });
  }
  await audit(tx, {
    username: params.username,
    action: "إنشاء",
    entityType: "voucher",
    entityId: voucher.id,
    entityName: voucherNumber,
  });
  return { id: voucher.id, voucherNumber, amount: line.amount };
}

/** POST تصفية (القاعدة 8 حرفيًا): توزيع مبلغ سبق صرفه — Σ البنود ≤ غير المصفّى من العهدة */
export async function createCustodySettlement(
  input: { vdate: string; custodyAccountId: number; description?: string; lines: unknown },
  user: { username: string }
): Promise<{ groupRef: string; vouchers: { id: number; voucherNumber: string; amount: number }[]; total: number }> {
  const vdate = parseDay(input.vdate);
  if (!vdate) throw new VoucherError("تاريخ التصفية مطلوب بصيغة YYYY-MM-DD");
  const acc = await db.expenseAccount.findUnique({ where: { id: intOr(input.custodyAccountId, 0) } });
  if (!acc || acc.accountKind !== "advance") {
    throw new VoucherError("حساب العهدة غير صالح (يجب أن يكون من حسابات العُهد)", 404);
  }
  const { lines, total } = await validateSettlementLines(input.lines);
  const groupDescription = String(input.description || "").trim();
  return withNumberRetry(async () =>
    db.$transaction(async (tx) => {
      const unsettled = await custodyBreakdown(tx, acc.id);
      if (total > unsettled.balance + EPS) {
        throw new VoucherError(`مجموع التصفية يتجاوز غير المصفّى من العهدة (${unsettled.balance} د.ك فقط)`);
      }
      const groupRef = await nextSettlementGroupRef(tx, vdate);
      const vouchers: { id: number; voucherNumber: string; amount: number }[] = [];
      for (let i = 0; i < lines.length; i++) {
        vouchers.push(
          await createSettlementVoucherInTx(tx, {
            vdate: lines[i].vdate || vdate,
            custodyAccount: { id: acc.id, name: acc.name },
            groupRef,
            lineIndex: i,
            line: lines[i],
            groupDescription,
            username: user.username,
          })
        );
      }
      return { groupRef, vouchers, total };
    })
  );
}

// ==================== كشوف التصفيات ====================

export interface SettlementGroupInfo {
  ref: string;
  vdate: string;
  custodyAccountId: number | null;
  custodyAccountName: string;
  description: string;
  total: number;
  linesCount: number;
  cancelledCount: number;
  contracts: string[];
}

function groupDescriptionOf(notes: string, custodyName: string): string {
  const tag = `تصفية عهدة من حساب: ${custodyName}`;
  if (notes.startsWith(tag)) return notes.slice(tag.length).replace(/^ — /, "").trim();
  return "";
}

/** قائمة التصفيات: تجميع سندات الصرف حسب expenseGroupRef (فلاتر accountId/from/to/q) */
export async function listSettlements(
  opts: { accountId?: number; from?: string; to?: string; q?: string } = {}
): Promise<SettlementGroupInfo[]> {
  const rows = await db.voucher.findMany({
    where: {
      expenseGroupRef: { not: "" },
      custodyAccountId: { not: null },
      ...(opts.accountId ? { custodyAccountId: opts.accountId } : {}),
      ...(opts.from || opts.to
        ? { vdate: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
        : {}),
    },
    select: {
      id: true,
      voucherNumber: true,
      vdate: true,
      amount: true,
      expenseGroupRef: true,
      custodyAccountId: true,
      custodyAccountSnapshot: true,
      notes: true,
      cancelled: true,
      contract: { select: { contractNumber: true } },
    },
    orderBy: [{ vdate: "asc" }, { id: "asc" }],
  });
  const byRef = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byRef.get(r.expenseGroupRef) || [];
    arr.push(r);
    byRef.set(r.expenseGroupRef, arr);
  }
  let settlements: SettlementGroupInfo[] = [];
  for (const [ref, list] of byRef) {
    const active = list.filter((v) => !v.cancelled);
    const first = active[0] || list[0];
    const custodyName = first.custodyAccountSnapshot;
    settlements.push({
      ref,
      vdate: active.length ? active.reduce((m, v) => (v.vdate < m ? v.vdate : m), active[0].vdate) : first.vdate,
      custodyAccountId: first.custodyAccountId,
      custodyAccountName: custodyName,
      description: groupDescriptionOf(first.notes, custodyName),
      total: r3(active.reduce((s, v) => s + Number(v.amount), 0)),
      linesCount: active.length,
      cancelledCount: list.length - active.length,
      contracts: [...new Set(active.map((v) => v.contract?.contractNumber).filter((x): x is string => Boolean(x)))],
    });
  }
  if (opts.q) {
    const nq = normalizeArabic(opts.q);
    settlements = settlements.filter((s) => normalizeArabic(`${s.ref} ${s.custodyAccountName} ${s.description}`).includes(nq));
  }
  return settlements.sort((a, b) => (a.vdate < b.vdate ? 1 : a.vdate > b.vdate ? -1 : 0));
}

/** كشف تصفية واحدة: البنود كاملة + المُسلَّم حتى تاريخ التصفية والمُنفَق والرصيد (spec A.3 custody_settlement) */
export async function loadSettlementGroup(ref: string) {
  const rows = await db.voucher.findMany({
    where: { expenseGroupRef: ref },
    orderBy: [{ vdate: "asc" }, { id: "asc" }],
    include: { contract: { select: { id: true, contractNumber: true, contractName: true } } },
  });
  if (rows.length === 0) return null;
  const withCustody = rows.filter((r) => r.custodyAccountId);
  const custodyAccountId = withCustody[0]?.custodyAccountId ?? null;
  const custodyAccountName = withCustody[0]?.custodyAccountSnapshot ?? "";
  const active = rows.filter((r) => !r.cancelled);
  const settlementDate = active.length ? active.reduce((m, v) => (v.vdate < m ? v.vdate : m), active[0].vdate) : rows[0].vdate;

  let handedUntil = 0;
  if (custodyAccountId) {
    const agg = await db.voucher.aggregate({
      where: {
        vtype: "payment",
        cancelled: false,
        custodyAccountId,
        expenseGroupRef: "",
        expenseAccountId: null,
        vdate: { lte: settlementDate },
      },
      _sum: { amount: true },
    });
    handedUntil = r3(Number(agg._sum.amount || 0));
  }
  const spent = r3(active.reduce((s, v) => s + Number(v.amount), 0));

  const customerIds = [...new Set(rows.filter((r) => r.expenseCustomerId).map((r) => r.expenseCustomerId as number))];
  const customers = customerIds.length
    ? await db.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } })
    : [];
  const custNames = new Map(customers.map((c) => [c.id, c.name]));

  return {
    group: {
      ref,
      vdate: settlementDate,
      custodyAccountId,
      custodyAccountName,
      description: groupDescriptionOf((active[0] || rows[0]).notes, custodyAccountName),
      total: spent,
      linesCount: active.length,
      cancelledCount: rows.length - active.length,
    },
    lines: rows.map((r) => ({
      id: r.id,
      voucherNumber: r.voucherNumber,
      vdate: r.vdate,
      amount: Number(r.amount),
      description: r.description,
      party: r.party,
      expenseGroupLine: r.expenseGroupLine,
      expenseAccountId: r.expenseAccountId,
      expenseAccountName: r.expenseAccountSnapshot,
      customerId: r.expenseCustomerId,
      customerName: r.expenseCustomerId ? custNames.get(r.expenseCustomerId) || "" : "",
      contractId: r.contractId,
      contractNumber: r.contract?.contractNumber || "",
      contractName: r.contract?.contractName || "",
      cancelled: r.cancelled,
      cancelReason: r.cancelReason,
      cancelledAt: r.cancelledAt,
    })),
    handedUntil,
    spent,
    balance: r3(handedUntil - spent),
  };
}

// ==================== كشف حركات العهدة ====================

export interface LedgerLine {
  voucherId: number;
  voucherNumber: string;
  vdate: string;
  amount: number;
  description: string;
  expenseAccountName: string;
  customerName: string;
  contractNumber: string;
  expenseGroupLine: number | null;
}

export interface LedgerRow {
  voucherId: number;
  voucherNumber: string;
  vtype: string;
  vdate: string;
  amount: number;
  kind: "handover" | "settlement" | "return";
  groupRef?: string;
  description: string;
  party: string;
  runningBalance: number;
  lines?: LedgerLine[];
}

/** كشف حركات العهدة: تسليم/تصفية (مجمعة)/إرجاع برصيد تراكمي (spec A.3 custody_ledger) */
export async function custodyLedger(
  accountId: number,
  opts: { from?: string; to?: string; kind?: string } = {}
): Promise<{ rows: LedgerRow[]; balance: number; totals: CustodyBreakdown } | null> {
  const acc = await db.expenseAccount.findUnique({ where: { id: accountId } });
  if (!acc || acc.accountKind !== "advance") return null;
  const dateFilter = opts.from || opts.to
    ? { vdate: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
    : {};

  const [payRows, retRows] = await Promise.all([
    db.voucher.findMany({
      where: { vtype: "payment", cancelled: false, custodyAccountId: accountId, ...dateFilter },
      orderBy: [{ vdate: "asc" }, { id: "asc" }],
      select: {
        id: true, voucherNumber: true, vdate: true, amount: true, description: true, party: true,
        expenseGroupRef: true, expenseGroupLine: true, expenseAccountId: true, expenseAccountSnapshot: true,
        expenseCustomerId: true, contractId: true, contract: { select: { contractNumber: true } },
      },
    }),
    db.voucher.findMany({
      where: { vtype: "custody_return", cancelled: false, custodyAccountId: accountId, ...dateFilter },
      orderBy: [{ vdate: "asc" }, { id: "asc" }],
      select: { id: true, voucherNumber: true, vdate: true, amount: true, description: true, party: true },
    }),
  ]);

  const customerIds = [...new Set(payRows.filter((r) => r.expenseCustomerId).map((r) => r.expenseCustomerId as number))];
  const customers = customerIds.length
    ? await db.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } })
    : [];
  const custNames = new Map(customers.map((c) => [c.id, c.name]));

  interface Group {
    grouped: boolean;
    ref: string;
    date: string;
    seq: number;
    amount: number;
    lines: LedgerLine[];
  }
  const handovers: { date: string; seq: number; row: (typeof payRows)[number] }[] = [];
  const groups: Group[] = [];
  for (const r of payRows) {
    if (!r.expenseAccountId && !r.expenseGroupRef) {
      handovers.push({ date: r.vdate, seq: r.id, row: r });
      continue;
    }
    const grouped = Boolean(r.expenseGroupRef);
    const key = grouped ? r.expenseGroupRef : `v${r.id}`;
    let g = groups.find((x) => x.ref === key);
    if (!g) {
      g = { grouped, ref: key, date: r.vdate, seq: r.id, amount: 0, lines: [] };
      groups.push(g);
    }
    g.amount = r3(g.amount + Number(r.amount));
    if (r.vdate < g.date) g.date = r.vdate;
    if (r.id < g.seq) g.seq = r.id;
    g.lines.push({
      voucherId: r.id,
      voucherNumber: r.voucherNumber,
      vdate: r.vdate,
      amount: Number(r.amount),
      description: r.description,
      expenseAccountName: r.expenseAccountSnapshot,
      customerName: r.expenseCustomerId ? custNames.get(r.expenseCustomerId) || "" : "",
      contractNumber: r.contract?.contractNumber || "",
      expenseGroupLine: r.expenseGroupLine,
    });
  }

  const merged: { date: string; seq: number; row: LedgerRow }[] = [];
  for (const h of handovers) {
    merged.push({
      date: h.date,
      seq: h.seq,
      row: {
        voucherId: h.row.id,
        voucherNumber: h.row.voucherNumber,
        vtype: "payment",
        vdate: h.row.vdate,
        amount: Number(h.row.amount),
        kind: "handover",
        description: h.row.description,
        party: h.row.party,
        runningBalance: 0,
      },
    });
  }
  for (const g of groups) {
    const first = g.lines[0];
    merged.push({
      date: g.date,
      seq: g.seq,
      row: {
        voucherId: first.voucherId,
        voucherNumber: first.voucherNumber,
        vtype: "payment",
        vdate: g.date,
        amount: g.amount,
        kind: "settlement",
        ...(g.grouped ? { groupRef: g.ref } : {}),
        description: first.description,
        party: "",
        runningBalance: 0,
        lines: g.lines,
      },
    });
  }
  for (const r of retRows) {
    merged.push({
      date: r.vdate,
      seq: r.id,
      row: {
        voucherId: r.id,
        voucherNumber: r.voucherNumber,
        vtype: "custody_return",
        vdate: r.vdate,
        amount: Number(r.amount),
        kind: "return",
        description: r.description,
        party: r.party,
        runningBalance: 0,
      },
    });
  }

  const kindFilter = (opts.kind || "").trim();
  let running = 0;
  const rows = merged
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.seq - b.seq))
    .map(({ row }) => row)
    .filter((row) => !kindFilter || row.kind === kindFilter)
    .map((row) => {
      if (row.kind === "handover") running = r3(running + row.amount);
      else running = r3(running - row.amount);
      return { ...row, runningBalance: running };
    });

  return { rows, balance: r3(running), totals: await custodyBreakdown(db, accountId) };
}

// ==================== لوحة العُهد ====================

export interface CustodyOverviewAccount {
  id: number;
  name: string;
  fullPath: string;
  parentId: number | null;
  isActive: boolean;
  sortOrder: number;
  handed: number;
  spent: number;
  returned: number;
  balance: number;
  lastHandover: { voucherNumber: string; vdate: string; amount: number; party: string } | null;
  lastSettlement: { ref: string; vdate: string; total: number } | null;
  settlementsCount: number;
}

/** لوحة العُهد: لكل حساب advance الرصيد/آخر تسليم/آخر تصفية/عدد التصفيات + الإجمالي */
export async function custodyOverview(): Promise<{ accounts: CustodyOverviewAccount[]; totals: CustodyBreakdown }> {
  const accounts = await db.expenseAccount.findMany({
    where: { accountKind: "advance" },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  const out: CustodyOverviewAccount[] = [];
  for (const acc of accounts) {
    const [bd, lastHandover, groupRows] = await Promise.all([
      custodyBreakdown(db, acc.id),
      db.voucher.findFirst({
        where: { vtype: "payment", cancelled: false, custodyAccountId: acc.id, expenseGroupRef: "", expenseAccountId: null },
        orderBy: [{ vdate: "desc" }, { id: "desc" }],
        select: { voucherNumber: true, vdate: true, amount: true, party: true },
      }),
      db.voucher.findMany({
        where: { vtype: "payment", cancelled: false, custodyAccountId: acc.id, expenseGroupRef: { not: "" } },
        select: { expenseGroupRef: true, vdate: true, amount: true },
      }),
    ]);
    const groupMap = new Map<string, { ref: string; vdate: string; total: number }>();
    for (const g of groupRows) {
      const e = groupMap.get(g.expenseGroupRef);
      if (e) {
        e.total = r3(e.total + Number(g.amount));
        if (g.vdate < e.vdate) e.vdate = g.vdate;
      } else {
        groupMap.set(g.expenseGroupRef, { ref: g.expenseGroupRef, vdate: g.vdate, total: Number(g.amount) });
      }
    }
    const groups = [...groupMap.values()].sort((a, b) => (a.vdate < b.vdate ? 1 : -1));
    out.push({
      id: acc.id,
      name: acc.name,
      fullPath: acc.fullPath,
      parentId: acc.parentId,
      isActive: acc.isActive,
      sortOrder: acc.sortOrder,
      handed: bd.handed,
      spent: bd.spent,
      returned: bd.returned,
      balance: bd.balance,
      lastHandover: lastHandover
        ? {
            voucherNumber: lastHandover.voucherNumber,
            vdate: lastHandover.vdate,
            amount: Number(lastHandover.amount),
            party: lastHandover.party,
          }
        : null,
      lastSettlement: groups[0] ? { ref: groups[0].ref, vdate: groups[0].vdate, total: groups[0].total } : null,
      settlementsCount: groups.length,
    });
  }
  const totals: CustodyBreakdown = {
    handed: r3(out.reduce((s, a) => s + a.handed, 0)),
    spent: r3(out.reduce((s, a) => s + a.spent, 0)),
    returned: r3(out.reduce((s, a) => s + a.returned, 0)),
    balance: r3(out.reduce((s, a) => s + a.balance, 0)),
  };
  return { accounts: out, totals };
}

// ==================== سلف الموظفين ====================

/** حساب مصروف السلف «سلف موظفين / قرض راتب» — يُضمن بالاسم تحت «مصروفات إدارية» (spec B) */
export async function ensureEmployeeAdvanceAccount(tx: Tx): Promise<{ id: number; name: string }> {
  const found = await tx.expenseAccount.findFirst({
    where: { name: { in: ["سلف موظفين / قرض راتب", "سلف موظفين"] } },
    orderBy: { id: "asc" },
  });
  if (found) return { id: found.id, name: found.name };
  const parent = await tx.expenseAccount.findFirst({ where: { name: "مصروفات إدارية" } });
  const name = "سلف موظفين / قرض راتب";
  const created = await tx.expenseAccount.create({
    data: {
      name,
      fullPath: parent && parent.fullPath ? `${parent.fullPath} / ${name}` : name,
      parentId: parent?.id ?? null,
      accountKind: "expense",
      allowPosting: true,
      // السلفة أصل مسترد لا مصروف نهائي (تُخصم عند الرد/الخصم) — خارج الربحية الفعلية
      includeInProfitability: false,
    },
  });
  return { id: created.id, name: created.name };
}

export interface AdvanceVoucherResult {
  id: number;
  voucherNumber: string;
  kind: "grant" | "return" | "deduction";
  amount: number;
  vdate: string;
  employeeId: number;
  employeeName: string;
}

/**
 * إنشاء سند سلفة يدويًا داخل معاملة (PV/CV) — createVoucher لا يدعم advanceEmployeeId
 * في مساري الصرف والإرجاع (Task 8) فتُنشأ هنا بنفس الترقيم/القيد/التدقيق.
 * grant: PV مدين «سلف موظفين» دائن الصندوق — return: CV مدين الصندوق دائن «سلف موظفين» (بلا أثر إيرادي).
 */
async function createAdvanceVoucherInTx(
  tx: Tx,
  params: {
    kind: "grant" | "return";
    employee: { id: number; name: string };
    amount: number;
    vdate: string;
    method: string;
    account: string;
    advanceAccount: { id: number; name: string };
    description: string;
    username: string;
  }
): Promise<{ id: number; voucherNumber: string }> {
  const vtype = params.kind === "grant" ? "payment" : "custody_return";
  const voucherNumber = await nextNumber(VOUCHER_PREFIX[vtype], 4, tx);
  const voucher = await tx.voucher.create({
    data: {
      voucherNumber,
      vtype,
      vdate: params.vdate,
      party: params.employee.name,
      partyType: "",
      partyId: null,
      method: params.kind === "grant" ? params.method : "",
      account: params.account,
      expenseAccountId: params.kind === "grant" ? params.advanceAccount.id : null,
      expenseAccountSnapshot: params.kind === "grant" ? params.advanceAccount.name : "",
      advanceEmployeeId: params.employee.id,
      amount: params.amount,
      description: params.description,
    },
  });
  if (params.kind === "grant") {
    // مدين سلف موظفين دائن الصندوق (test_v453: قيد الصرف)
    await insertVoucherJournal(tx, {
      id: voucher.id,
      voucherNumber,
      vtype: "payment",
      vdate: params.vdate,
      amount: params.amount,
      account: params.account,
      method: params.method,
      contractId: null,
      subContractId: null,
      expenseAccountSnapshot: params.advanceAccount.name,
      custodyAccountSnapshot: "",
      partyType: "",
    });
  } else {
    // مدين الصندوق دائن سلف موظفين — يدخل الخزينة ويخفض المصروف بلا إيراد ولا رسوم (test_v453)
    await tx.journalEntry.create({
      data: {
        entryDate: params.vdate,
        description: `${VOUCHER_TYPE_LABELS.custody_return} ${voucherNumber}`,
        debitAccount: params.account || "صندوق",
        creditAccount: params.advanceAccount.name,
        amount: params.amount,
        sourceType: "voucher",
        sourceId: voucher.id,
      },
    });
  }
  await audit(tx, {
    username: params.username,
    action: "إنشاء",
    entityType: "voucher",
    entityId: voucher.id,
    entityName: voucherNumber,
  });
  return { id: voucher.id, voucherNumber };
}

/** صرف/رد سلفة موظف — الرد بسقف قاطع على الرصيد (الصرف بلا سقف كالمصدر) */
export async function createEmployeeAdvance(
  input: { kind: "grant" | "return"; employeeId: number; amount: number; vdate: string; method?: string; account?: string; description?: string },
  user: { username: string }
): Promise<AdvanceVoucherResult> {
  const kind = input.kind === "return" ? "return" : "grant";
  const emp = await db.employee.findUnique({ where: { id: intOr(input.employeeId, 0) } });
  if (!emp) throw new VoucherError("الموظف غير موجود", 404);
  const amount = r3(Number(input.amount));
  if (!Number.isFinite(amount) || !(amount > 0)) throw new VoucherError("مبلغ السلفة يجب أن يكون أكبر من صفر");
  const vdate = parseDay(input.vdate);
  if (!vdate) throw new VoucherError("تاريخ السند مطلوب بصيغة YYYY-MM-DD");
  const method = String(input.method || "");
  const account = normalizeAccount(input.account, method);

  if (kind === "return") {
    const bal = await employeeAdvanceRemaining(db, emp.id);
    if (amount > bal + EPS) {
      throw new VoucherError(`المبلغ يتجاوز رصيد سلفة الموظف (${bal} د.ك فقط)`);
    }
  }

  const created = await withNumberRetry(() =>
    db.$transaction(async (tx) => {
      const advanceAccount = await ensureEmployeeAdvanceAccount(tx);
      return createAdvanceVoucherInTx(tx, {
        kind,
        employee: { id: emp.id, name: emp.name },
        amount,
        vdate,
        method,
        account,
        advanceAccount,
        description:
          String(input.description || "").trim() ||
          (kind === "grant" ? `صرف سلفة للموظف ${emp.name}` : `رد نقدي من سلفة الموظف ${emp.name}`),
        username: user.username,
      });
    })
  );
  return { ...created, kind, amount, vdate, employeeId: emp.id, employeeName: emp.name };
}

/** إلغاء بنود تصفية (سندات المجموعة) داخل معاملة بعد اجتياز الحواجز — سبب موحد لكل بند */
export async function cancelSettlementLines(
  tx: Tx,
  voucherIds: number[],
  reason: string,
  username: string
): Promise<{ cancelled: number }> {
  for (const id of voucherIds) {
    await cancelVoucherTx(tx, id, reason, username);
  }
  return { cancelled: voucherIds.length };
}
