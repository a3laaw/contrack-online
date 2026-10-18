import "server-only";
import { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import {
  EPS,
  r3,
  daysBetween,
  todayStr,
  computeContractPaymentPlan,
  reachableLines,
  receiptBankFee,
  contractCurrentValue,
  supervisionExtension,
  ComputedPlanLine,
  PlanLine,
  ReceiptLike,
  LinkRow,
} from "@/lib/contrack-core";
import {
  loadContractCore,
  getSettingsRow,
  actualSupervisionEnd,
  numOr,
  intOr,
} from "@/lib/contrack-server";
import { nextNumber, parseDay, audit } from "@/lib/api-utils";

export type Tx = Prisma.TransactionClient;
export type DbClient = Prisma.TransactionClient | PrismaClient;

/** خطأ أعمال بحالة HTTP وبيانات إضافية (نمط OverpayWarning 422) */
export class VoucherError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(message: string, status = 400, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const VOUCHER_TYPES = ["receipt", "payment", "transfer", "custody_return", "salary_deduction"] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];

export const VOUCHER_TYPE_LABELS: Record<string, string> = {
  receipt: "سند قبض",
  payment: "سند صرف",
  transfer: "سند تحويل",
  custody_return: "إرجاع عهدة",
  salary_deduction: "خصم من راتب",
};

export const VOUCHER_PREFIX: Record<string, string> = {
  receipt: "RV",
  payment: "PV",
  transfer: "TV",
  custody_return: "CV",
  salary_deduction: "SD",
};

/** المطالبات التي تمنع إلغاء السند (statuses ليس منها cancelled/refused/archived — حرفيًا من المهمة) */
export const CLAIM_BLOCK_STATUSES = ["cancelled", "refused", "archived"];

// ==================== الأطراف ====================

export async function resolvePartyName(client: DbClient, partyType: string, partyId: number | null): Promise<string> {
  if (!partyId) return "";
  if (partyType === "customer") {
    const c = await client.customer.findUnique({ where: { id: partyId }, select: { name: true } });
    return c?.name || "";
  }
  if (partyType === "subcontractor") {
    const s = await client.subcontractor.findUnique({ where: { id: partyId }, select: { name: true } });
    return s?.name || "";
  }
  return "";
}

// ==================== الحسابات النقدية والتحويل ====================

/** الحساب الافتراضي من طريقة الدفع (بنك≠صندوق نصيًا) */
export function defaultAccountForMethod(method: string): string {
  const m = (method || "").toLowerCase();
  if ((method || "").includes("بنك") || (method || "").includes("حوالة") || (method || "").includes("تحويل") || m.includes("knet") || m.includes("bank")) return "بنك";
  return "صندوق";
}

export function normalizeAccount(account: string | undefined, method: string): string {
  const a = (account || "").trim();
  return a || defaultAccountForMethod(method);
}

/** الرصيد الافتتاحي من الإعدادات حسب اسم الحساب نصيًا */
export function openingForAccount(account: string, settings: { openingBalanceBank: unknown; openingBalanceCash: unknown }): number {
  const a = account || "";
  if (a.includes("بنك")) return Number(settings.openingBalanceBank || 0);
  if (a.includes("صندوق") || a.includes("نقد")) return Number(settings.openingBalanceCash || 0);
  return 0;
}

/** رصيد الحساب = افتتاحي + Σ قبض بطريقة الحساب − Σ صرف بطريقة الحساب + Σ تحويل إلى − تحويل منه */
export async function computeAccountBalance(client: DbClient, account: string, settings: { openingBalanceBank: unknown; openingBalanceCash: unknown }): Promise<number> {
  const [rec, pay, tin, tout] = await Promise.all([
    client.voucher.aggregate({ where: { vtype: "receipt", cancelled: false, account }, _sum: { amount: true } }),
    client.voucher.aggregate({ where: { vtype: "payment", cancelled: false, account }, _sum: { amount: true } }),
    client.voucher.aggregate({ where: { vtype: "transfer", cancelled: false, account }, _sum: { amount: true } }),
    client.voucher.aggregate({ where: { vtype: "transfer", cancelled: false, method: account }, _sum: { amount: true } }),
  ]);
  return r3(
    openingForAccount(account, settings) +
      Number(rec._sum.amount || 0) -
      Number(pay._sum.amount || 0) +
      Number(tin._sum.amount || 0) -
      Number(tout._sum.amount || 0)
  );
}

// ==================== الروابط الصريحة (apply_links / check_selection) ====================

/** قاعدة التتابع V9.15.17: المحدد بادئة من الدفعات المفتوحة بالترتيب، والموقوفة لا تمنع ما بعدها */
export function checkSelection(
  selectedIdsIn: number[],
  lines: ComputedPlanLine[],
  gatedIds: Set<number> = new Set()
): { valid: boolean; message: string } {
  const selectedIds = [...new Set(selectedIdsIn)];
  if (selectedIds.length === 0) return { valid: true, message: "" };
  const byId = new Map(lines.map((l) => [l.id, l]));
  for (const id of selectedIds) {
    const line = byId.get(id);
    if (!line) return { valid: false, message: "إحدى الدفعات المحددة غير موجودة في الخطة" };
    if (line.remaining <= EPS) return { valid: false, message: `الدفعة «${line.title}» مسددة بالكامل` };
    if (line.state === "skipped") return { valid: false, message: `الدفعة «${line.title}» غير مستحقة (مرحلة متخطاة)` };
    if (line.state === "awaiting_stage") return { valid: false, message: `الدفعة «${line.title}» بانتظار إنجاز المرحلة المرتبطة` };
    if (gatedIds.has(id)) return { valid: false, message: `الدفعة «${line.title}» موقوفة ببوابة تحصيل العميل — لا يمكن ربطها` };
  }
  const order = lines
    .filter((l) => l.remaining > EPS && l.state !== "skipped" && l.state !== "awaiting_stage" && !gatedIds.has(l.id))
    .map((l) => l.id);
  const selectedSet = new Set(selectedIds);
  const indexes = selectedIds.map((id) => order.indexOf(id));
  if (indexes.some((i) => i < 0)) return { valid: false, message: "الدفعات المحددة غير صالحة للربط" };
  const lastIndex = Math.max(...indexes);
  for (let i = 0; i < lastIndex; i++) {
    if (!selectedSet.has(order[i])) {
      const blockLine = byId.get(order[i]);
      return { valid: false, message: `لا يمكن تحديد دفعة قبل تسديد الدفعة السابقة المفتوحة «${blockLine?.title || ""}»` };
    }
  }
  return { valid: true, message: "" };
}

/**
 * apply_links حرفيًا: يمسح روابط السند (idempotent)، يُدخل المحدد بما لا يتجاوز room_for،
 * ثم يوزع الفائض spread على الدفعات المستحقة التالية (reachableLines) متخطيًا الموقوفة بالبوابة،
 * والباقي ⇒ advanceAmount.
 */
export async function applyLinks(
  tx: Tx,
  params: {
    voucherId: number;
    kind: "receipt" | "payment";
    amount: number;
    links: { lineId: number; amount: number }[];
    lines: ComputedPlanLine[];
    gatedIds?: Set<number>;
  }
): Promise<{ advance: number; inserted: { lineId: number; amount: number }[] }> {
  const gatedIds = params.gatedIds || new Set<number>();
  // امسح روابط السند أولًا (idempotent)
  await tx.voucherPaymentLink.deleteMany({ where: { voucherId: params.voucherId } });

  const room = new Map<number, number>();
  for (const l of params.lines) {
    room.set(l.id, Math.max(0, Math.min(r3(l.amountN - l.explicit), l.remaining)));
  }
  const inserted = new Map<number, number>();
  let left = r3(params.amount);
  const take = (lineId: number, want: number) => {
    const rm = room.get(lineId) ?? 0;
    const t = r3(Math.min(want, rm));
    if (t > EPS) {
      room.set(lineId, r3(rm - t));
      inserted.set(lineId, r3((inserted.get(lineId) || 0) + t));
      left = r3(left - t);
    }
  };
  // 1) المحدد صراحة
  for (const req of params.links || []) take(intOr(req.lineId, 0), numOr(req.amount, 0));
  // 2) الفائض spread على المستحقة التالية متخطيًا الموقوفة بالبوابة
  if (left > EPS) {
    for (const line of reachableLines(params.lines)) {
      if (left <= EPS) break;
      if (gatedIds.has(line.id)) continue;
      take(line.id, left);
    }
  }
  // 3) إدراج صفوف الروابط
  for (const [lineId, amount] of inserted) {
    await tx.voucherPaymentLink.create({
      data: { voucherId: params.voucherId, kind: params.kind, lineId, amount },
    });
  }
  return { advance: Math.max(0, left), inserted: [...inserted].map(([lineId, amount]) => ({ lineId, amount })) };
}

/** معاينة التوزيع الآلي الكامل (بدون كتابة) — للـvalidate والاقتراح */
export function distributePreview(
  amount: number,
  lines: ComputedPlanLine[],
  gatedIds: Set<number> = new Set()
): { suggested: { lineId: number; amount: number }[]; advance: number } {
  let left = r3(amount);
  const suggested: { lineId: number; amount: number }[] = [];
  for (const line of reachableLines(lines)) {
    if (left <= EPS) break;
    if (gatedIds.has(line.id)) continue;
    const room = Math.max(0, Math.min(r3(line.amountN - line.explicit), line.remaining));
    const t = r3(Math.min(left, room));
    if (t > EPS) {
      suggested.push({ lineId: line.id, amount: t });
      left = r3(left - t);
    }
  }
  return { suggested, advance: Math.max(0, left) };
}

// ==================== خطة العميل (tx-aware) ====================

/** حساب خطوط خطة دفعات العقد عبر عميل محدد (يدعم المعاملة) — مرآة loadContractCore للخطة */
export async function computePlanLines(
  client: DbClient,
  contractId: number,
  opts: { excludeVoucherId?: number } = {}
): Promise<ComputedPlanLine[]> {
  const [receiptRows, planRows, linkRows] = await Promise.all([
    client.voucher.findMany({
      where: { contractId, vtype: "receipt", cancelled: false },
      select: { id: true, voucherNumber: true, vdate: true, amount: true, allocation: true, advanceAmount: true },
    }),
    client.paymentPlanItem.findMany({
      where: { contractId },
      orderBy: [{ dueDate: "asc" }, { sortOrder: "asc" }],
      include: { stage: { select: { isSkipped: true, endDate: true } } },
    }),
    client.voucherPaymentLink.findMany({
      where: { kind: "receipt", voucher: { contractId, vtype: "receipt", cancelled: false } },
      select: { voucherId: true, lineId: true, amount: true },
    }),
  ]);
  const receipts: ReceiptLike[] = receiptRows
    .filter((v) => opts.excludeVoucherId !== v.id)
    .map((v) => ({
      id: v.id,
      voucherNumber: v.voucherNumber,
      vdate: v.vdate,
      amount: Number(v.amount),
      allocation: v.allocation,
      advanceAmount: Number(v.advanceAmount),
      cancelled: false,
    }));
  const links: LinkRow[] = linkRows.map((l) => ({ voucherId: l.voucherId, lineId: l.lineId, amount: Number(l.amount) }));
  const plan: PlanLine[] = planRows.map((p) => ({
    id: p.id,
    title: p.title,
    dueDate: p.dueDate,
    amount: Number(p.amount),
    sortOrder: p.sortOrder,
    stageId: p.stageId,
    triggeredAt: p.triggeredAt,
    notes: p.notes,
    stage: p.stage ? { isSkipped: p.stage.isSkipped, endDate: p.stage.endDate } : null,
  }));
  return computeContractPaymentPlan(plan, receipts, links).lines;
}

// ==================== خطة الباطن (مرآة _sub_payment_plan_impl) ====================

export interface ComputedSubLine extends ComputedPlanLine {
  gated: boolean;
  sourceIds: number[];
}

export interface SubPlanComputed {
  subContract: {
    id: number;
    amount: number;
    status: string;
    contractId: number;
    subcontractorId: number;
    subcontractorName: string;
    subCode: string;
    contractNumber: string;
  };
  lines: ComputedSubLine[];
  paid: number;
  planTotal: number;
  capRemaining: number;
  gateEnabled: boolean;
}

/** خطة دفعات الباطن: FIFO بsortOrder + روابط kind=payment + البوابة + الحالات الثمانية */
export async function computeSubPlan(
  subContractId: number,
  opts: { excludeVoucherId?: number } = {}
): Promise<SubPlanComputed | null> {
  const sc = await db.subContract.findUnique({
    where: { id: subContractId },
    include: {
      subcontractor: { select: { id: true, name: true, subCode: true } },
      contract: { select: { id: true, contractNumber: true } },
    },
  });
  if (!sc) return null;
  const settings = await getSettingsRow();
  const gateEnabled = Boolean(settings.subPayClientGate);

  const [planRows, voucherRows, linkRows] = await Promise.all([
    db.subPaymentPlanItem.findMany({
      where: { subContractId },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      include: {
        stage: { select: { isSkipped: true, endDate: true } },
        sources: { select: { custLineId: true } },
      },
    }),
    db.voucher.findMany({
      where: { subContractId, vtype: "payment", cancelled: false },
      select: { id: true, voucherNumber: true, vdate: true, amount: true, allocation: true, advanceAmount: true },
    }),
    db.voucherPaymentLink.findMany({
      where: { kind: "payment", voucher: { subContractId, vtype: "payment", cancelled: false } },
      select: { voucherId: true, lineId: true, amount: true },
    }),
  ]);

  // متبقي دفعات العميل (للبوابة)
  const core = await loadContractCore(sc.contractId);
  const clientRemainingById = new Map<number, number>();
  if (core) for (const l of core.computed.lines) clientRemainingById.set(l.id, l.remaining);

  const paidRows = voucherRows.filter((v) => opts.excludeVoucherId !== v.id && !(v.allocation || "").trim());
  const paid = r3(paidRows.reduce((s, v) => s + Number(v.amount || 0), 0));
  const validIds = new Set(paidRows.map((v) => v.id));
  const linksByLine = new Map<number, number>();
  for (const l of linkRows) {
    if (!validIds.has(l.voucherId)) continue;
    linksByLine.set(l.lineId, r3((linksByLine.get(l.lineId) || 0) + Number(l.amount || 0)));
  }
  const totalLinks = r3([...linksByLine.values()].reduce((s, v) => s + v, 0));
  let pool = Math.max(0, r3(paid - totalLinks));

  const today = todayStr();
  const baseLines = planRows.map((p) => {
    const amountN = Number(p.amount);
    let covered = Math.min(pool, amountN);
    pool = r3(pool - covered);
    const link = linksByLine.get(p.id) || 0;
    const explicit = Math.min(link, r3(amountN - covered));
    covered = r3(covered + explicit);
    const remaining = r3(amountN - covered);
    return { p, amountN, covered: r3(covered), explicit: r3(explicit), remaining };
  });

  const lines: ComputedSubLine[] = baseLines.map(({ p, amountN, covered, explicit, remaining }) => {
    let state: ComputedPlanLine["state"];
    let daysDiff = p.dueDate ? daysBetween(today, p.dueDate) : 999999;
    const hasStage = p.stageId != null;
    if (hasStage && p.stage?.isSkipped) {
      state = "skipped";
    } else if (hasStage && !p.triggeredAt && remaining > EPS) {
      state = "awaiting_stage";
      daysDiff = 999999;
    } else if (remaining <= EPS) {
      state = "paid";
    } else if (covered > EPS) {
      state = daysDiff >= 0 ? "partial" : "overdue";
    } else if (daysDiff < 0) {
      state = "overdue";
    } else if (p.triggeredAt) {
      state = "due";
    } else {
      state = "upcoming";
    }
    const stateLabelMap: Record<string, string> = {
      skipped: "مرحلة متخطاة",
      awaiting_stage: "بانتظار إنجاز المرحلة",
      paid: "مدفوع",
      partial: daysDiff >= 0 ? "جزئي" : "متأخر",
      overdue: "متأخر",
      due: "مستحقة",
      upcoming: daysDiff <= 7 ? "مستحق قريبًا" : "لم يحل أجله",
    };
    const sourceIds = p.sources.map((s) => s.custLineId);
    const clientNotCollected = sourceIds.some((id) => (clientRemainingById.get(id) ?? 0) > EPS);
    const gated = gateEnabled && sourceIds.length > 0 && clientNotCollected;
    return {
      id: p.id,
      title: p.title,
      dueDate: p.dueDate,
      amountN,
      sortOrder: p.sortOrder,
      stageId: p.stageId,
      triggeredAt: p.triggeredAt,
      notes: p.notes,
      stage: p.stage ? { isSkipped: p.stage.isSkipped, endDate: p.stage.endDate } : null,
      covered,
      explicit,
      remaining,
      state,
      daysDiff,
      stateLabel: stateLabelMap[state],
      gated,
      sourceIds,
    } as ComputedSubLine;
  });

  // سقف الصرف على مستوى المقاول/العقد الأب
  const cap = await subPaymentCap(db, { contractId: sc.contractId, subcontractorId: sc.subcontractorId });

  return {
    subContract: {
      id: sc.id,
      amount: Number(sc.amount),
      status: sc.status,
      contractId: sc.contractId,
      subcontractorId: sc.subcontractorId,
      subcontractorName: sc.subcontractor.name,
      subCode: sc.subcontractor.subCode,
      contractNumber: sc.contract.contractNumber,
    },
    lines,
    paid,
    planTotal: r3(planRows.reduce((s, p) => s + Number(p.amount), 0)),
    capRemaining: cap.remaining,
    gateEnabled,
  };
}

// ==================== السقوف القاطعة ====================

/** سقف الصرف للمقاول على عقد العميل (lifecycle:1919-1944) */
export async function subPaymentCap(
  client: DbClient,
  params: { contractId: number; subcontractorId: number; excludeVoucherId?: number }
): Promise<{ total: number; paid: number; remaining: number }> {
  const totalAgg = await client.subContract.aggregate({
    where: { subcontractorId: params.subcontractorId, contractId: params.contractId, status: { not: "ملغى" } },
    _sum: { amount: true },
  });
  const paidAgg = await client.voucher.aggregate({
    where: {
      vtype: "payment",
      cancelled: false,
      contractId: params.contractId,
      partyType: "subcontractor",
      partyId: params.subcontractorId,
      ...(params.excludeVoucherId ? { id: { not: params.excludeVoucherId } } : {}),
    },
    _sum: { amount: true },
  });
  const total = r3(Number(totalAgg._sum.amount || 0));
  const paid = r3(Number(paidAgg._sum.amount || 0));
  return { total, paid, remaining: r3(total - paid) };
}

/** متبقي العهدة = مُسلَّم − مُنفَق − مرتجع */
export async function custodyRemaining(client: DbClient, custodyAccountId: number): Promise<number> {
  const [handed, spent, returned] = await Promise.all([
    client.voucher.aggregate({
      where: { vtype: "payment", cancelled: false, custodyAccountId, expenseAccountId: null },
      _sum: { amount: true },
    }),
    client.voucher.aggregate({
      where: { vtype: "payment", cancelled: false, custodyAccountId, expenseAccountId: { not: null } },
      _sum: { amount: true },
    }),
    client.voucher.aggregate({
      where: { vtype: "custody_return", cancelled: false, custodyAccountId },
      _sum: { amount: true },
    }),
  ]);
  return r3(
    Number(handed._sum.amount || 0) - Number(spent._sum.amount || 0) - Number(returned._sum.amount || 0)
  );
}

/** رصيد سلفة الموظف = ΣPV − ΣCV − ΣSD (سارية) */
export async function employeeAdvanceRemaining(client: DbClient, employeeId: number): Promise<number> {
  const sumOf = async (vtype: string) => {
    const agg = await client.voucher.aggregate({
      where: { vtype, cancelled: false, advanceEmployeeId: employeeId },
      _sum: { amount: true },
    });
    return Number(agg._sum.amount || 0);
  };
  const pv = await sumOf("payment");
  const cv = await sumOf("custody_return");
  const sd = await sumOf("salary_deduction");
  return r3(pv - cv - sd);
}

// ==================== القيود المحاسبية ====================

/** القيد التلقائي عند إنشاء السند (_insert_voucher_journal) */
export async function insertVoucherJournal(
  tx: Tx,
  v: {
    id: number;
    voucherNumber: string;
    vtype: string;
    vdate: string;
    amount: number;
    account: string;
    method: string;
    contractId: number | null;
    subContractId: number | null;
    expenseAccountSnapshot: string;
    custodyAccountSnapshot: string;
    partyType: string;
  }
): Promise<void> {
  let debit = "";
  let credit = "";
  switch (v.vtype) {
    case "receipt":
      debit = v.account || defaultAccountForMethod(v.method);
      credit = v.contractId ? "إيرادات العقود" : "العملاء";
      break;
    case "payment":
      debit = v.expenseAccountSnapshot || v.custodyAccountSnapshot || (v.partyType === "partner" ? "جاري الشريك" : "مصروفات أخرى");
      credit = v.account || defaultAccountForMethod(v.method);
      break;
    case "transfer":
      debit = v.account || "بنك";
      credit = v.method || "صندوق";
      break;
    case "custody_return":
      debit = v.account || defaultAccountForMethod(v.method);
      credit = v.custodyAccountSnapshot || "العهد";
      break;
    case "salary_deduction":
      debit = "رواتب";
      credit = "سلف موظفين";
      break;
  }
  await tx.journalEntry.create({
    data: {
      entryDate: v.vdate,
      description: `${VOUCHER_TYPE_LABELS[v.vtype] || v.vtype} ${v.voucherNumber}`,
      debitAccount: debit,
      creditAccount: credit,
      amount: v.amount,
      contractId: v.contractId,
      subContractId: v.subContractId,
      sourceType: "voucher",
      sourceId: v.id,
    },
  });
}

/** عكس قيود السند بصنم voucher_cancel */
export async function reverseVoucherJournals(tx: Tx, voucherId: number, reason: string): Promise<void> {
  const rows = await tx.journalEntry.findMany({ where: { sourceType: "voucher", sourceId: voucherId } });
  for (const r of rows) {
    await tx.journalEntry.create({
      data: {
        entryDate: todayStr(),
        description: `عكس قيد ${r.description} — ${reason}`,
        debitAccount: r.creditAccount,
        creditAccount: r.debitAccount,
        amount: r.amount,
        contractId: r.contractId,
        subContractId: r.subContractId,
        sourceType: "voucher_cancel",
        sourceId: voucherId,
      },
    });
  }
}

// ==================== الرسوم البنكية ====================

export async function ensureBankCommissionAccount(tx: Tx): Promise<{ id: number; name: string }> {
  const found = await tx.expenseAccount.findFirst({ where: { name: "عمولات بنكية" } });
  if (found) return { id: found.id, name: found.name };
  const created = await tx.expenseAccount.create({
    data: { name: "عمولات بنكية", fullPath: "عمولات بنكية", accountKind: "expense" },
  });
  return { id: created.id, name: created.name };
}

/** سند صرف ابن للرسوم البنكية — party=البنك وnotes تحمل BANK_FEE */
export async function createFeeChildVoucher(
  tx: Tx,
  params: {
    parent: { id: number; voucherNumber: string; vdate: string; method: string; account: string; contractId: number | null };
    fee: number;
    allocationRows?: { contractId: number; amount: number }[];
  }
): Promise<{ id: number; voucherNumber: string; amount: number }> {
  const acc = await ensureBankCommissionAccount(tx);
  const voucherNumber = await nextNumber("PV", 4, tx);
  const child = await tx.voucher.create({
    data: {
      voucherNumber,
      vtype: "payment",
      vdate: params.parent.vdate,
      party: "البنك",
      partyType: "",
      method: params.parent.method,
      account: params.parent.account,
      amount: params.fee,
      description: `رسوم بنكية عن سند القبض ${params.parent.voucherNumber}`,
      notes: `BANK_FEE:${params.parent.voucherNumber}`,
      expenseAccountId: acc.id,
      expenseAccountSnapshot: acc.name,
      parentVoucherId: params.parent.id,
      contractId: params.parent.contractId,
    },
  });
  if (params.allocationRows && params.allocationRows.length > 0) {
    // توزيع بالقيمة/بالتساوي في القيود — سطر لكل عقد
    for (const row of params.allocationRows) {
      if (!(row.amount > 0)) continue;
      await tx.journalEntry.create({
        data: {
          entryDate: params.parent.vdate,
          description: `توزيع رسوم بنكية سند ${params.parent.voucherNumber}`,
          debitAccount: acc.name,
          creditAccount: params.parent.account || "البنك",
          amount: row.amount,
          contractId: row.contractId,
          sourceType: "bank_fee_alloc",
          sourceId: child.id,
        },
      });
    }
  } else {
    await tx.journalEntry.create({
      data: {
        entryDate: params.parent.vdate,
        description: `رسوم بنكية عن سند القبض ${params.parent.voucherNumber}`,
        debitAccount: acc.name,
        creditAccount: params.parent.account || "البنك",
        amount: params.fee,
        contractId: params.parent.contractId,
        sourceType: "voucher",
        sourceId: child.id,
      },
    });
  }
  return { id: child.id, voucherNumber: child.voucherNumber, amount: params.fee };
}

export interface AllocContract {
  id: number;
  value: number;
}

/** العقود النشطة ذات الحركة بقيمها الحالية (لتوزيع الرسوم بالقيمة) */
export async function activeContractsForAllocation(client: DbClient): Promise<AllocContract[]> {
  const contracts = await client.contract.findMany({
    where: { status: { notIn: ["ملغى", "مسودة"] } },
    select: {
      id: true,
      amount: true,
      supStartDate: true,
      supMonths: true,
      supMonthly: true,
      supDiscount: true,
      supWaivedMonths: true,
      addendums: { select: { status: true, amountAdd: true, amountDeduct: true } },
    },
  });
  const supIds = contracts
    .filter((c) => Boolean(c.supStartDate) && c.supMonths > 0 && Number(c.supMonthly) > 0)
    .map((c) => c.id);
  const stageRows =
    supIds.length > 0
      ? await client.contractStage.findMany({
          where: { contractId: { in: supIds } },
          select: { contractId: true, name: true, endDate: true, supActualEnd: true },
        })
      : [];
  const stagesByContract = new Map<number, { name: string; endDate: string; supActualEnd: string }[]>();
  for (const s of stageRows) {
    const arr = stagesByContract.get(s.contractId) || [];
    arr.push({ name: s.name, endDate: s.endDate, supActualEnd: s.supActualEnd });
    stagesByContract.set(s.contractId, arr);
  }
  return contracts
    .map((c) => {
      let supExt = 0;
      if (supIds.includes(c.id)) {
        supExt = supervisionExtension(
          {
            id: c.id,
            supStartDate: c.supStartDate,
            supMonths: c.supMonths,
            supMonthly: Number(c.supMonthly),
            supDiscount: Number(c.supDiscount),
            supWaivedMonths: Number(c.supWaivedMonths),
          },
          actualSupervisionEnd(stagesByContract.get(c.id) || [])
        );
      }
      return {
        id: c.id,
        value: contractCurrentValue(
          Number(c.amount),
          c.addendums.map((a) => ({ status: a.status, amountAdd: Number(a.amountAdd), amountDeduct: Number(a.amountDeduct) })),
          supExt
        ),
      };
    })
    .filter((c) => c.value > EPS);
}

/** توزيع بالقيمة: نصيب = fee×value/Σvalue مع تصحيح الكسر على الأكبر */
export function allocateByValue(fee: number, contracts: AllocContract[]): { contractId: number; amount: number }[] {
  const rows = contracts
    .filter((c) => c.value > EPS)
    .map((c) => ({ contractId: c.id, amount: r3((fee * c.value) / contracts.reduce((s, c2) => s + c2.value, 0)) }))
    .filter((r) => r.amount > 0);
  if (rows.length === 0) return [];
  const sum = r3(rows.reduce((s, r) => s + r.amount, 0));
  const diff = r3(fee - sum);
  if (diff !== 0) {
    const largest = rows.reduce((a, b) => (b.amount > a.amount ? b : a), rows[0]);
    largest.amount = r3(largest.amount + diff);
  }
  return rows.filter((r) => r.amount > 0);
}

/** تقسيم بالتساوي مع الكسر على الأخير (للمجمع BT) */
export function splitEven(fee: number, contractIds: number[]): { contractId: number; amount: number }[] {
  const n = contractIds.length;
  if (n === 0 || !(fee > 0)) return [];
  const per = r3(fee / n);
  const rows = contractIds.map((contractId, i) => ({
    contractId,
    amount: i === n - 1 ? r3(fee - per * (n - 1)) : per,
  }));
  return rows.filter((r) => r.amount > 0);
}

// ==================== إنشاء السند ====================

export interface CreateVoucherInput {
  vtype: string;
  amount: number;
  vdate: string;
  method?: string;
  account?: string;
  party?: string;
  partyType?: string;
  partyId?: number;
  contractId?: number;
  subContractId?: number;
  expenseAccountId?: number;
  custodyAccountId?: number;
  advanceEmployeeId?: number;
  description?: string;
  notes?: string;
  links?: { lineId: number; amount: number }[];
  allowOverpay?: boolean;
  chequeDueDate?: string;
  allocation?: string;
  fromAccount?: string;
  toAccount?: string;
  boqItemId?: number;
  costCenter?: string;
  expenseCustomerId?: number;
}

interface PreparedVoucher {
  vtype: VoucherType;
  amount: number;
  vdate: string;
  method: string;
  account: string;
  party: string;
  partyType: string;
  partyId: number | null;
  contractId: number | null;
  subContractId: number | null;
  expenseAccountId: number | null;
  expenseAccountSnapshot: string;
  custodyAccountId: number | null;
  custodyAccountSnapshot: string;
  advanceEmployeeId: number | null;
  chequeDueDate: string;
  allocation: string;
  description: string;
  notes: string;
  lines: ComputedPlanLine[] | null;
  gatedIds: Set<number>;
  newCollected?: number;
  current?: number;
  costCenter: string;
  expenseCustomerId: number | null;
  boqItemId: number | null;
}

/** تجهيز بيانات السند والتحققات قبل المعاملة (فحوص السقوف برسائلها الحرفية) */
export async function prepareVoucher(input: CreateVoucherInput, user: { id: number; username: string; role: string }): Promise<PreparedVoucher> {
  const vtype = String(input.vtype || "");
  if (!VOUCHER_TYPES.includes(vtype as VoucherType)) {
    throw new VoucherError("نوع السند غير صالح (المسموح: قبض/صرف/تحويل/إرجاع عهدة/خصم من راتب)");
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || !(amount > 0)) throw new VoucherError("قيمة السند يجب أن تكون أكبر من صفر");
  const vdate = parseDay(input.vdate);
  if (!vdate) throw new VoucherError("تاريخ السند مطلوب بصيغة YYYY-MM-DD");

  const base: PreparedVoucher = {
    vtype: vtype as VoucherType,
    amount,
    vdate,
    method: String(input.method || ""),
    account: "",
    party: String(input.party || ""),
    partyType: String(input.partyType || ""),
    partyId: input.partyId ? intOr(input.partyId, 0) || null : null,
    contractId: input.contractId ? intOr(input.contractId, 0) || null : null,
    subContractId: null,
    expenseAccountId: null,
    expenseAccountSnapshot: "",
    custodyAccountId: null,
    custodyAccountSnapshot: "",
    advanceEmployeeId: null,
    chequeDueDate: "",
    allocation: String(input.allocation || ""),
    description: String(input.description || ""),
    notes: String(input.notes || ""),
    lines: null,
    gatedIds: new Set<number>(),
    costCenter: String(input.costCenter || ""),
    expenseCustomerId: input.expenseCustomerId ? intOr(input.expenseCustomerId, 0) || null : null,
    boqItemId: input.boqItemId ? intOr(input.boqItemId, 0) || null : null,
  };

  if (base.vtype === "receipt") {
    base.method = base.method;
    base.account = normalizeAccount(input.account, base.method);
    if (base.method.includes("شيك")) base.chequeDueDate = parseDay(input.chequeDueDate);
    if (base.contractId) {
      const core = await loadContractCore(base.contractId);
      if (!core) throw new VoucherError("العقد غير موجود", 404);
      if (["مغلق", "ملغى"].includes(core.contract.status)) {
        throw new VoucherError(`العقد بحالة «${core.contract.status}» — لا يقبل حركات مالية`);
      }
      const dueValue = r3(Math.max(core.current, core.sup ? core.sup.totalDue : 0));
      const remaining = r3(dueValue - core.collected);
      if (amount > remaining + 1e-9 && !input.allowOverpay) {
        throw new VoucherError(
          `قيمة السند تتجاوز المبلغ المتبقي من العقد (${remaining} د.ك فقط). سيتم تسجيل الزيادة كـ (دفعة مقدمة) على العقد.`,
          422,
          { overpay: true, remaining }
        );
      }
      base.party = core.contract.customer.name;
      base.partyType = "customer";
      base.partyId = core.contract.customerId;
      base.lines = core.computed.lines;
      base.newCollected = r3(core.collected + amount);
      base.current = core.current;
    } else {
      // قبض بلا عقد: partyType='' فقط — يخضع لرسوم بنكية موزعة بالقيمة
      base.partyType = "";
      base.partyId = null;
    }
    return base;
  }

  if (base.vtype === "payment") {
    base.account = normalizeAccount(input.account, base.method);
    if (base.method.includes("شيك")) base.chequeDueDate = parseDay(input.chequeDueDate);
    if (input.subContractId) {
      const sc = await db.subContract.findUnique({
        where: { id: intOr(input.subContractId, 0) },
        include: {
          subcontractor: { select: { id: true, name: true } },
          contract: { select: { id: true, status: true } },
        },
      });
      if (!sc) throw new VoucherError("عقد الباطن غير موجود", 404);
      if (sc.status === "ملغى") throw new VoucherError("لا يمكن الصرف على عقد باطن ملغى");
      if (["مغلق", "ملغى"].includes(sc.contract.status)) {
        throw new VoucherError(`العقد الأب بحالة «${sc.contract.status}» — لا يقبل حركات مالية`);
      }
      base.subContractId = sc.id;
      base.contractId = sc.contractId;
      base.party = sc.subcontractor.name;
      base.partyType = "subcontractor";
      base.partyId = sc.subcontractorId;
      const cap = await subPaymentCap(db, { contractId: sc.contractId, subcontractorId: sc.subcontractorId });
      if (amount > cap.remaining + 1e-9 && !input.allowOverpay) {
        throw new VoucherError(
          `قيمة السند تتجاوز المتبقي لمقاول الباطن (${cap.remaining} د.ك فقط). سيتم تسجيل الزيادة كـ (دفعة مقدمة) للمقاول.`,
          422,
          { overpay: true, remaining: cap.remaining }
        );
      }
      if (input.expenseAccountId) {
        const acc = await db.expenseAccount.findUnique({ where: { id: intOr(input.expenseAccountId, 0) } });
        if (!acc || !acc.allowPosting || acc.accountKind !== "expense") {
          throw new VoucherError("حساب المصروف المحدد غير صالح للترحيل");
        }
        base.expenseAccountId = acc.id;
        base.expenseAccountSnapshot = acc.name;
      }
      const subPlan = await computeSubPlan(sc.id);
      if (subPlan) {
        base.lines = subPlan.lines;
        base.gatedIds = new Set(subPlan.lines.filter((l) => l.gated).map((l) => l.id));
      }
      return base;
    }
    // صرف غير باطن: مصروف أو عهدة أو شريك
    if (base.partyType === "partner") {
      if (user.role !== "admin" && user.role !== "developer") {
        throw new VoucherError("جاري الشريك للمدير فقط", 403);
      }
      if (!base.party.trim()) throw new VoucherError("اسم الشريك مطلوب");
      return base;
    }
    if (input.custodyAccountId) {
      const acc = await db.expenseAccount.findUnique({ where: { id: intOr(input.custodyAccountId, 0) } });
      if (!acc || acc.accountKind !== "advance") {
        throw new VoucherError("حساب العهدة غير صالح (يجب أن يكون من حسابات العُهد)");
      }
      base.custodyAccountId = acc.id;
      base.custodyAccountSnapshot = acc.name;
      if (input.expenseAccountId) {
        const exp = await db.expenseAccount.findUnique({ where: { id: intOr(input.expenseAccountId, 0) } });
        if (exp && exp.allowPosting && exp.accountKind === "expense") {
          base.expenseAccountId = exp.id;
          base.expenseAccountSnapshot = exp.name;
        }
      }
      return base;
    }
    if (!input.expenseAccountId) {
      throw new VoucherError("حساب المصروف مطلوب لسند الصرف (أو حساب عهدة للتسليم، أو طرف شريك للمدير)");
    }
    const acc = await db.expenseAccount.findUnique({ where: { id: intOr(input.expenseAccountId, 0) } });
    if (!acc || !acc.allowPosting || acc.accountKind !== "expense") {
      throw new VoucherError("حساب المصروف غير موجود أو غير مسموح بالترحيل عليه");
    }
    base.expenseAccountId = acc.id;
    base.expenseAccountSnapshot = acc.name;
    if (base.partyType === "subcontractor" && base.partyId) {
      if (!base.contractId) throw new VoucherError("العقد مطلوب للصرف لمقاول باطن");
      const linked = await db.subContract.findFirst({
        where: { subcontractorId: base.partyId, contractId: base.contractId, status: { not: "ملغى" } },
      });
      if (!linked) throw new VoucherError("المقاول غير مرتبط بعقد باطن على هذا العقد");
      const cap = await subPaymentCap(db, { contractId: base.contractId, subcontractorId: base.partyId });
      if (amount > cap.remaining + 1e-9 && !input.allowOverpay) {
        throw new VoucherError(
          `قيمة السند تتجاوز المتبقي لمقاول الباطن (${cap.remaining} د.ك فقط). سيتم تسجيل الزيادة كـ (دفعة مقدمة) للمقاول.`,
          422,
          { overpay: true, remaining: cap.remaining }
        );
      }
    }
    return base;
  }

  if (base.vtype === "transfer") {
    const from = String(input.fromAccount || input.method || "").trim();
    const to = String(input.toAccount || input.account || "").trim();
    if (!from || !to) throw new VoucherError("حدد حساب المصدر وحساب الوجهة للتحويل");
    if (from === to) throw new VoucherError("حسابا التحويل يجب أن يختلفا (بنك ≠ صندوق)");
    const settings = await getSettingsRow();
    const bal = await computeAccountBalance(db, from, settings);
    if (amount > bal + 1e-9) {
      throw new VoucherError(`رصيد الحساب لا يكفي (المتاح في «${from}» هو ${bal} د.ك)`);
    }
    base.method = from;
    base.account = to;
    base.party = "تحويل داخلي";
    base.partyType = "transfer";
    base.partyId = null;
    return base;
  }

  if (base.vtype === "custody_return") {
    if (!input.custodyAccountId) throw new VoucherError("حساب العهدة مطلوب لسند إرجاع العهدة");
    const acc = await db.expenseAccount.findUnique({ where: { id: intOr(input.custodyAccountId, 0) } });
    if (!acc || acc.accountKind !== "advance") throw new VoucherError("حساب العهدة غير صالح");
    const rem = await custodyRemaining(db, acc.id);
    if (amount > rem + 1e-9) {
      throw new VoucherError(`المبلغ يتجاوز متبقي العهدة (${rem} د.ك فقط)`);
    }
    base.custodyAccountId = acc.id;
    base.custodyAccountSnapshot = acc.name;
    base.account = normalizeAccount(input.account, base.method);
    base.party = base.party || acc.name;
    return base;
  }

  // salary_deduction
  if (!input.advanceEmployeeId) throw new VoucherError("الموظف مطلوب لسند خصم الراتب");
  const emp = await db.employee.findUnique({ where: { id: intOr(input.advanceEmployeeId, 0) } });
  if (!emp) throw new VoucherError("الموظف غير موجود", 404);
  const bal = await employeeAdvanceRemaining(db, emp.id);
  if (amount > bal + 1e-9) {
    throw new VoucherError(`المبلغ يتجاوز رصيد سلفة الموظف (${bal} د.ك فقط)`);
  }
  base.advanceEmployeeId = emp.id;
  base.party = base.party || emp.name;
  base.account = normalizeAccount(input.account, base.method);
  return base;
}

/** إنشاء السند داخل معاملة مع إعادة المحاولة عند تضارب الترقيم (5×) */
export async function createVoucher(
  input: CreateVoucherInput,
  user: { id: number; username: string; role: string }
): Promise<{ id: number; voucherNumber: string }> {
  const prep = await prepareVoucher(input, user);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const created = await db.$transaction(async (tx) => {
        const voucherNumber = await nextNumber(VOUCHER_PREFIX[prep.vtype], 4, tx);
        const voucher = await tx.voucher.create({
          data: {
            voucherNumber,
            vtype: prep.vtype,
            vdate: prep.vdate,
            party: prep.party,
            partyType: prep.partyType,
            partyId: prep.partyId,
            method: prep.method,
            account: prep.account,
            expenseAccountId: prep.expenseAccountId,
            expenseAccountSnapshot: prep.expenseAccountSnapshot,
            custodyAccountId: prep.custodyAccountId,
            custodyAccountSnapshot: prep.custodyAccountSnapshot,
            advanceEmployeeId: prep.advanceEmployeeId,
            amount: prep.amount,
            description: prep.description,
            notes: prep.notes,
            contractId: prep.contractId,
            subContractId: prep.subContractId,
            boqItemId: prep.boqItemId,
            costCenter: prep.costCenter,
            expenseCustomerId: prep.expenseCustomerId,
            chequeDueDate: prep.chequeDueDate,
            allocation: prep.allocation,
          },
        });

        // الروابط الصريحة (قبض على payment_plan / صرف على sub_payment_plan)
        if ((prep.vtype === "receipt" || prep.vtype === "payment") && prep.lines) {
          if ((input.links || []).length > 0) {
            const chk = checkSelection((input.links || []).map((l) => intOr(l.lineId, 0)), prep.lines, prep.gatedIds);
            if (!chk.valid) throw new VoucherError(chk.message);
          }
          const res = await applyLinks(tx, {
            voucherId: voucher.id,
            kind: prep.vtype === "receipt" ? "receipt" : "payment",
            amount: prep.amount,
            links: input.links || [],
            lines: prep.lines,
            gatedIds: prep.gatedIds,
          });
          if (res.advance > 0) {
            await tx.voucher.update({ where: { id: voucher.id }, data: { advanceAmount: res.advance } });
          }
        }

        // القيد المحاسبي التلقائي
        await insertVoucherJournal(tx, {
          id: voucher.id,
          voucherNumber: voucher.voucherNumber,
          vtype: prep.vtype,
          vdate: prep.vdate,
          amount: prep.amount,
          account: prep.account,
          method: prep.method,
          contractId: prep.contractId,
          subContractId: prep.subContractId,
          expenseAccountSnapshot: prep.expenseAccountSnapshot,
          custodyAccountSnapshot: prep.custodyAccountSnapshot,
          partyType: prep.partyType,
        });

        // الرسوم البنكية للقبض
        if (prep.vtype === "receipt") {
          const settings = await getSettingsRow(tx);
          const methods = await tx.paymentMethod.findMany();
          const fee = receiptBankFee(
            prep.method,
            prep.amount,
            methods.map((m) => ({ name: m.name, feeType: m.feeType, feeValue: Number(m.feeValue), isActive: m.isActive })),
            {
              bankFeeAmount: Number(settings.bankFeeAmount),
              bankFeeMethod: settings.bankFeeMethod,
              bankFeeEnabled: settings.bankFeeEnabled,
            }
          );
          if (fee > EPS) {
            if (prep.contractId) {
              await createFeeChildVoucher(tx, {
                parent: {
                  id: voucher.id,
                  voucherNumber: voucher.voucherNumber,
                  vdate: prep.vdate,
                  method: prep.method,
                  account: prep.account,
                  contractId: prep.contractId,
                },
                fee,
              });
            } else {
              // قبض بلا عقد: سند ابن واحد + توزيع بالقيمة في القيود
              const child = await createFeeChildVoucher(tx, {
                parent: {
                  id: voucher.id,
                  voucherNumber: voucher.voucherNumber,
                  vdate: prep.vdate,
                  method: prep.method,
                  account: prep.account,
                  contractId: null,
                },
                fee,
                allocationRows: [],
              });
              const allocContracts = await activeContractsForAllocation(tx);
              const rows = allocateByValue(fee, allocContracts);
              for (const row of rows) {
                await tx.journalEntry.create({
                  data: {
                    entryDate: prep.vdate,
                    description: `توزيع رسوم بنكية بالقيمة عن ${voucher.voucherNumber}`,
                    debitAccount: "عمولات بنكية",
                    creditAccount: prep.account || "البنك",
                    amount: row.amount,
                    contractId: row.contractId,
                    sourceType: "bank_fee_alloc",
                    sourceId: child.id,
                  },
                });
              }
            }
          }
        }

        // الأحداث والتعليق التلقائي
        if (prep.contractId) {
          await tx.contractEvent.create({
            data: {
              contractId: prep.contractId,
              eventType: VOUCHER_TYPE_LABELS[prep.vtype],
              description: `${VOUCHER_TYPE_LABELS[prep.vtype]} ${voucher.voucherNumber} بمبلغ ${prep.amount}${prep.party ? ` — ${prep.party}` : ""}`,
              username: user.username,
            },
          });
          if (prep.vtype === "receipt" && prep.newCollected !== undefined && prep.current !== undefined && prep.newCollected > prep.current + EPS) {
            await tx.contractEvent.create({
              data: {
                contractId: prep.contractId,
                eventType: "تعليق تلقائي",
                description: `يوجد دفع مقدم/زيادة: ${r3(prep.newCollected - prep.current)}`,
                username: user.username,
              },
            });
          }
        }
        await audit(tx, {
          username: user.username,
          action: "إنشاء",
          entityType: "voucher",
          entityId: voucher.id,
          entityName: voucher.voucherNumber,
        });
        return voucher;
      });
      return { id: created.id, voucherNumber: created.voucherNumber };
    } catch (e) {
      if (e instanceof VoucherError) throw e;
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 4) {
        lastError = e; // تضارب رقم السند — أعِد المحاولة برقم جديد
        continue;
      }
      lastError = e;
      break;
    }
  }
  console.error("فشل إنشاء السند:", lastError);
  throw new VoucherError("تعذر إنشاء السند، حاول مجددًا", 500);
}

// ==================== تعديل السند ====================

export interface UpdateVoucherBody {
  amount?: number;
  method?: string;
  account?: string;
  vdate?: string;
  party?: string;
  description?: string;
  links?: { lineId: number; amount: number }[];
  allowOverpay?: boolean;
  chequeDueDate?: string;
}

export async function updateVoucher(
  id: number,
  body: UpdateVoucherBody,
  user: { id: number; username: string; role: string }
): Promise<{ id: number; voucherNumber: string }> {
  const v = await db.voucher.findUnique({ where: { id }, include: { contract: { select: { status: true } } } });
  if (!v) throw new VoucherError("السند غير موجود", 404);
  if (v.cancelled) throw new VoucherError("لا يمكن تعديل سند ملغى");
  if (v.vtype === "custody_return" || v.vtype === "salary_deduction") {
    throw new VoucherError("ممنوع تعديل سندات إرجاع العهدة وخصم الراتب — ألغِ السند وأنشئ بديلًا");
  }

  const keys = Object.keys(body);
  const descOnly = keys.length > 0 && keys.every((k) => k === "description");
  if (user.role !== "admin" && user.role !== "developer") {
    if (!descOnly) throw new VoucherError("السكرتير يمكنه تعديل وصف السند فقط", 403);
  }

  const newAmount = body.amount !== undefined ? Number(body.amount) : Number(v.amount);
  if (!Number.isFinite(newAmount) || !(newAmount > 0)) throw new VoucherError("قيمة السند يجب أن تكون أكبر من صفر");
  const newMethod = body.method !== undefined ? String(body.method).trim() : v.method;
  const newAccount = body.account !== undefined ? normalizeAccount(String(body.account), newMethod) : v.account;
  const newVdate = body.vdate !== undefined ? parseDay(body.vdate) : v.vdate;
  if (!newVdate) throw new VoucherError("تاريخ السند غير صالح");
  const newParty = body.party !== undefined ? String(body.party).trim() : v.party;
  const newDescription = body.description !== undefined ? String(body.description) : v.description;
  const newLinks = Array.isArray(body.links) ? (body.links as { lineId: number; amount: number }[]) : null;
  const newCheque = newMethod.includes("شيك")
    ? body.chequeDueDate !== undefined
      ? parseDay(body.chequeDueDate)
      : v.chequeDueDate
    : "";

  // فحوص السقوف مع استثناء السند نفسه
  if (v.vtype === "receipt" && v.contractId) {
    const core = await loadContractCore(v.contractId, { excludeVoucherId: v.id });
    if (core) {
      const dueValue = r3(Math.max(core.current, core.sup ? core.sup.totalDue : 0));
      const remaining = r3(dueValue - core.collected);
      if (newAmount > remaining + 1e-9 && !body.allowOverpay) {
        throw new VoucherError(
          `قيمة السند تتجاوز المبلغ المتبقي من العقد (${remaining} د.ك فقط). سيتم تسجيل الزيادة كـ (دفعة مقدمة) على العقد.`,
          422,
          { overpay: true, remaining }
        );
      }
    }
  }
  if (v.vtype === "payment" && v.partyType === "subcontractor" && v.partyId && v.contractId) {
    const cap = await subPaymentCap(db, {
      contractId: v.contractId,
      subcontractorId: v.partyId,
      excludeVoucherId: v.id,
    });
    if (newAmount > cap.remaining + 1e-9 && !body.allowOverpay) {
      throw new VoucherError(
        `قيمة السند تتجاوز المتبقي لمقاول الباطن (${cap.remaining} د.ك فقط). سيتم تسجيل الزيادة كـ (دفعة مقدمة) للمقاول.`,
        422,
        { overpay: true, remaining: cap.remaining }
      );
    }
  }
  if (v.vtype === "transfer") {
    const from = newMethod;
    const to = newAccount;
    if (!from || !to) throw new VoucherError("حدد حساب المصدر وحساب الوجهة للتحويل");
    if (from === to) throw new VoucherError("حسابا التحويل يجب أن يختلفان");
    const settings = await getSettingsRow();
    let bal = await computeAccountBalance(db, from, settings);
    if (v.method === from) bal = r3(bal + Number(v.amount)); // أعد مبلغ السند نفسه للمصدر
    if (newAmount > bal + 1e-9) throw new VoucherError(`رصيد الحساب لا يكفي (المتاح في «${from}» هو ${bal} د.ك)`);
  }

  const methodChanged = newMethod !== v.method;
  const amountChanged = r3(newAmount) !== r3(Number(v.amount));

  // الخطة لروابط التعديل (باستثناء السند نفسه)
  let lines: ComputedPlanLine[] | null = null;
  let gatedIds = new Set<number>();
  if (newLinks && v.vtype === "receipt" && v.contractId) {
    lines = await computePlanLines(db, v.contractId, { excludeVoucherId: v.id });
  }
  if (newLinks && v.vtype === "payment" && v.subContractId) {
    const subPlan = await computeSubPlan(v.subContractId, { excludeVoucherId: v.id });
    if (subPlan) {
      lines = subPlan.lines;
      gatedIds = new Set(subPlan.lines.filter((l) => l.gated).map((l) => l.id));
    }
  }
  if (newLinks && !lines) throw new VoucherError("لا توجد خطة دفعات مرتبطة بهذا السند لربطها");

  await db.$transaction(async (tx) => {
    await tx.voucher.update({
      where: { id: v.id },
      data: {
        amount: newAmount,
        method: newMethod,
        account: newAccount,
        vdate: newVdate,
        party: newParty,
        description: newDescription,
        chequeDueDate: newCheque,
      },
    });

    if (newLinks && lines) {
      if (newLinks.length > 0) {
        const chk = checkSelection(newLinks.map((l) => intOr(l.lineId, 0)), lines, gatedIds);
        if (!chk.valid) throw new VoucherError(chk.message);
      }
      const res = await applyLinks(tx, {
        voucherId: v.id,
        kind: v.vtype === "receipt" ? "receipt" : "payment",
        amount: newAmount,
        links: newLinks,
        lines,
        gatedIds,
      });
      await tx.voucher.update({ where: { id: v.id }, data: { advanceAmount: res.advance } });
    }

    // عكس القيد القديم وإعادة إنشاء القيد
    await reverseVoucherJournals(tx, v.id, "تعديل السند");
    await insertVoucherJournal(tx, {
      id: v.id,
      voucherNumber: v.voucherNumber,
      vtype: v.vtype,
      vdate: newVdate,
      amount: newAmount,
      account: newAccount,
      method: newMethod,
      contractId: v.contractId,
      subContractId: v.subContractId,
      expenseAccountSnapshot: v.expenseAccountSnapshot,
      custodyAccountSnapshot: v.custodyAccountSnapshot,
      partyType: v.partyType,
    });

    // إعادة موازنة رسوم الأبناء عند تغيّر method/amount
    if (v.vtype === "receipt" && (methodChanged || amountChanged)) {
      const children = await tx.voucher.findMany({ where: { parentVoucherId: v.id, cancelled: false } });
      for (const ch of children) {
        await tx.voucher.update({
          where: { id: ch.id },
          data: { cancelled: true, cancelReason: "إلغاء تلقائي بعد تعديل الأب", cancelledAt: todayStr() },
        });
        await reverseVoucherJournals(tx, ch.id, "إلغاء تلقائي بعد تعديل الأب");
      }
      const settings = await getSettingsRow(tx);
      const methods = await tx.paymentMethod.findMany();
      const fee = receiptBankFee(
        newMethod,
        newAmount,
        methods.map((m) => ({ name: m.name, feeType: m.feeType, feeValue: Number(m.feeValue), isActive: m.isActive })),
        {
          bankFeeAmount: Number(settings.bankFeeAmount),
          bankFeeMethod: settings.bankFeeMethod,
          bankFeeEnabled: settings.bankFeeEnabled,
        }
      );
      if (fee > EPS) {
        if (v.contractId) {
          await createFeeChildVoucher(tx, {
            parent: { id: v.id, voucherNumber: v.voucherNumber, vdate: newVdate, method: newMethod, account: newAccount, contractId: v.contractId },
            fee,
          });
        } else {
          const child = await createFeeChildVoucher(tx, {
            parent: { id: v.id, voucherNumber: v.voucherNumber, vdate: newVdate, method: newMethod, account: newAccount, contractId: null },
            fee,
            allocationRows: [],
          });
          const allocContracts = await activeContractsForAllocation(tx);
          const rows = allocateByValue(fee, allocContracts);
          for (const row of rows) {
            await tx.journalEntry.create({
              data: {
                entryDate: newVdate,
                description: `توزيع رسوم بنكية بالقيمة عن ${v.voucherNumber}`,
                debitAccount: "عمولات بنكية",
                creditAccount: newAccount || "البنك",
                amount: row.amount,
                contractId: row.contractId,
                sourceType: "bank_fee_alloc",
                sourceId: child.id,
              },
            });
          }
        }
      }
    }

    if (v.contractId) {
      await tx.contractEvent.create({
        data: {
          contractId: v.contractId,
          eventType: "تعديل سند",
          description: `تعديل ${VOUCHER_TYPE_LABELS[v.vtype]} ${v.voucherNumber} — المبلغ ${newAmount}`,
          username: user.username,
        },
      });
    }
    await audit(tx, {
      username: user.username,
      action: "تعديل",
      entityType: "voucher",
      entityId: v.id,
      entityName: v.voucherNumber,
    });
  });

  return { id: v.id, voucherNumber: v.voucherNumber };
}

// ==================== إلغاء السند ====================

/** حواجز الإلغاء بالترتيب — تعيد رسالة الخطأ أو null */
export async function voucherCancelBarrier(voucherId: number): Promise<string | null> {
  const v = await db.voucher.findUnique({ where: { id: voucherId } });
  if (!v) return "السند غير موجود";
  if (v.cancelled) return "السند ملغى مسبقًا";
  // (أ) مطالبات سارية على العقد
  if (v.contractId) {
    const claims = await db.claim.findMany({
      where: { contractId: v.contractId, status: { notIn: CLAIM_BLOCK_STATUSES } },
      select: { claimNumber: true },
      take: 6,
      orderBy: { id: "asc" },
    });
    if (claims.length > 0) {
      return `توجد مطالبات مالية سارية (${claims.map((c) => c.claimNumber).join("، ")}) — لا يمكن إلغاء السند`;
    }
  }
  // (ب) سند تسليم عهدة له تصفية سارية
  if (v.vtype === "payment" && v.custodyAccountId && !v.expenseAccountId) {
    const settlements = await db.voucher.count({
      where: { custodyAccountId: v.custodyAccountId, expenseGroupRef: { not: "" }, cancelled: false, id: { not: v.id } },
    });
    if (settlements > 0) return "لا يمكن إلغاء تسليم عهدة مصفّاة";
  }
  // (ج) سند سلفة عليه ردود/خصومات سارية تتجاوز
  if (v.vtype === "payment" && v.advanceEmployeeId) {
    const bal = await employeeAdvanceRemaining(db, v.advanceEmployeeId);
    if (r3(bal - Number(v.amount)) < -EPS) {
      return "لا يمكن إلغاء سلفة عليها ردود/خصومات سارية تتجاوز رصيدها";
    }
  }
  return null;
}

/**
 * إلغاء موثق داخل معاملة: إلغاء ناعم + أبناء تلقائيًا + عكس القيود + إعادة فتح الدفعات المغطاة.
 * تُستدعى بعد اجتياز الحواجز.
 */
export async function cancelVoucherTx(
  tx: Tx,
  voucherId: number,
  reason: string,
  username: string,
  opts: { childReason?: string } = {}
): Promise<{ voucherNumber: string; reopened: number }> {
  const v = await tx.voucher.findUnique({ where: { id: voucherId } });
  if (!v) throw new VoucherError("السند غير موجود", 404);
  if (v.cancelled) throw new VoucherError("السند ملغى مسبقًا");

  // الخطة قبل الإلغاء (السند ما يزال ساريًا داخل المعاملة)
  let beforeRem = new Map<number, number>();
  if (v.contractId) {
    const before = await computePlanLines(tx, v.contractId);
    beforeRem = new Map(before.map((l) => [l.id, l.remaining]));
  }

  const today = todayStr();
  await tx.voucher.update({
    where: { id: v.id },
    data: { cancelled: true, cancelReason: reason, cancelledAt: today },
  });

  // إلغاء تلقائي للأبناء (سندات الرسوم)
  const children = await tx.voucher.findMany({ where: { parentVoucherId: v.id, cancelled: false } });
  const childReason = opts.childReason || "إلغاء تلقائي مع الأب";
  for (const ch of children) {
    await tx.voucher.update({
      where: { id: ch.id },
      data: { cancelled: true, cancelReason: childReason, cancelledAt: today },
    });
    await reverseVoucherJournals(tx, ch.id, childReason);
  }

  // عكس قيود الأب
  await reverseVoucherJournals(tx, v.id, reason);

  // إعادة فتح الدفعات المغطاة
  let reopened = 0;
  if (v.contractId) {
    const after = await computePlanLines(tx, v.contractId);
    for (const l of after) {
      const b = beforeRem.get(l.id) ?? 0;
      if (b <= EPS && l.remaining > EPS) {
        await tx.paymentPlanItem.update({
          where: { id: l.id },
          data: { notes: `أعيد فتحه بإلغاء السند ${v.voucherNumber}` },
        });
        reopened += 1;
      }
    }
    await tx.contractEvent.create({
      data: {
        contractId: v.contractId,
        eventType: "إلغاء سند",
        description: `إلغاء ${VOUCHER_TYPE_LABELS[v.vtype] || v.vtype} ${v.voucherNumber} بمبلغ ${Number(v.amount)} — السبب: ${reason}`,
        username,
      },
    });
    if (reopened > 0) {
      await tx.contractEvent.create({
        data: {
          contractId: v.contractId,
          eventType: "إعادة فتح دفعات",
          description: `أُعيد فتح ${reopened} دفعة بإلغاء السند ${v.voucherNumber}`,
          username,
        },
      });
    }
  }
  await audit(tx, {
    username,
    action: "إلغاء",
    entityType: "voucher",
    entityId: v.id,
    entityName: v.voucherNumber,
    reason,
  });
  return { voucherNumber: v.voucherNumber, reopened };
}
