import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { nextClaimNumber, normalizeArabic } from "@/lib/api-utils";
import {
  isSupervision,
  supervisionStatus,
  supervisionExtension,
  contractCurrentValue,
  computeContractPaymentPlan,
  PlanLine,
  ReceiptLike,
  LinkRow,
  EPS,
  r3,
} from "@/lib/contrack-core";

export type Tx = Prisma.TransactionClient;

/** قيم سارية/غير منتهية للمطالبات — تمنع حذف السند والعقد (spec G) */
export const ACTIVE_CLAIM_STATUSES = ["registered", "sent", "in_review", "approved", "postponed"];

/** تحويل رقمي آمن */
export function numOr(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
export function intOr(v: unknown, d = 0): number {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : d;
}

/** ترقيم ذري بمفتاح حر عبر عدّاد number_sequences */
export async function nextNumberByKey(
  key: string,
  prefix: string,
  width: number,
  tx?: Tx
): Promise<string> {
  const client = tx || db;
  const row = await client.numberSequence.upsert({
    where: { name: key },
    update: { lastNo: { increment: 1 } },
    create: { name: key, lastNo: 1 },
  });
  return `${prefix}-${String(row.lastNo).padStart(width, "0")}`;
}

/** إعدادات النظام — ينشئ الصف الافتراضي (id=1) إن لم يوجد */
export async function getSettingsRow(tx?: Tx) {
  const client = tx || db;
  const found = await client.setting.findUnique({ where: { id: 1 } });
  if (found) return found;
  return client.setting.create({ data: { id: 1 } });
}

/** تاريخ إنهاء الإشراف الفعلي من مرحلة اسمها يحوي «انهاء اشراف» (تطبيع أ/إ/آ) */
export function actualSupervisionEnd(
  stages: { name: string; endDate: string; supActualEnd: string }[]
): string {
  let best = "";
  for (const s of stages) {
    const n = normalizeArabic(s.name || "");
    if (n.includes("انهاء") && n.includes("اشراف")) {
      const d = s.supActualEnd || s.endDate;
      if (d && (!best || d > best)) best = d;
    }
  }
  return best;
}

export type ContractCore = Awaited<ReturnType<typeof loadContractCore>>;

/**
 * تحميل العقد بكل مكوّناته المالية محسوبًا:
 * القيمة الحالية (amount + ملاحق معتمدة + تمديد إشراف)، القبض، الخطة المحسوبة بحالاتها الثمانية.
 * opts.excludeVoucherId: لحساب الخطة كما لو أن السند غير موجود (تعديل/معاينة).
 */
export async function loadContractCore(
  contractId: number,
  opts: { excludeVoucherId?: number } = {}
) {
  const contract = await db.contract.findUnique({
    where: { id: contractId },
    include: { customer: { select: { id: true, name: true, phone: true, customerCode: true } } },
  });
  if (!contract) return null;

  const [addendumRows, receiptRows, stages, planRows, linkRows] = await Promise.all([
    db.addendum.findMany({
      where: { contractId },
      select: { status: true, amountAdd: true, amountDeduct: true },
    }),
    db.voucher.findMany({
      where: { contractId, vtype: "receipt", cancelled: false },
      select: { id: true, voucherNumber: true, vdate: true, amount: true, allocation: true, advanceAmount: true },
    }),
    db.contractStage.findMany({
      where: { contractId },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    db.paymentPlanItem.findMany({
      where: { contractId },
      orderBy: [{ dueDate: "asc" }, { sortOrder: "asc" }],
      include: { stage: { select: { isSkipped: true, endDate: true } } },
    }),
    db.voucherPaymentLink.findMany({
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
  const links: LinkRow[] = linkRows.map((l) => ({
    voucherId: l.voucherId,
    lineId: l.lineId,
    amount: Number(l.amount),
  }));
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

  const actualEnd = actualSupervisionEnd(stages);
  const supContract = {
    id: contract.id,
    supStartDate: contract.supStartDate,
    supMonths: contract.supMonths,
    supMonthly: Number(contract.supMonthly),
    supDiscount: Number(contract.supDiscount),
    supWaivedMonths: Number(contract.supWaivedMonths),
  };
  const sup = isSupervision(supContract)
    ? supervisionStatus(supContract, receipts, actualEnd)
    : null;
  const supExt = sup ? sup.extensionValue : 0;
  const current = contractCurrentValue(
    Number(contract.amount),
    addendumRows.map((a) => ({
      status: a.status,
      amountAdd: Number(a.amountAdd),
      amountDeduct: Number(a.amountDeduct),
    })),
    supExt
  );
  const computed = computeContractPaymentPlan(plan, receipts, links);
  // إجمالي القبض السارٍ (كل القبض بلا استثناء التخصيص — كتقرير المستحقات)
  const collected = r3(receipts.reduce((s, v) => s + Number(v.amount || 0), 0));

  return {
    contract,
    addendums: addendumRows,
    receipts,
    links,
    stages,
    planRaw: planRows,
    actualEnd,
    sup,
    supExt,
    current,
    collected,
    computed,
  };
}

/**
 * تفعيل استحقاق دفعات مرحلة (workflow_service.trigger_due_payments):
 * سطور الخطة stage_id=? AND triggered_at='' مع remaining>0.001 (بعد حساب FIFO)
 * ⇒ dueDate=finishDate, triggeredAt=finishDate, notes='مستحقة لانتهاء مرحلة «X» بتاريخ Y'.
 *
 * إصلاح موثق (Task 11-a): بعد التفعيل تُنشأ مطالبة out تلقائية لكل سطر مُثير
 * (السطر المُغطى بالكامل state=paid لا مطالبة — والتفعيل أصلًا لا يلمس المغطى)
 * بلا تكرار: يُفحص وجود مطالبة سارية بنفس custLineId (ليست cancelled/refused/archived)
 * فلا تُنشأ، وتُلحق رسالة «أُنشئت مطالبة تلقائية CLM-xxxx» بملاحظات السطر
 * (مطابق لـclaims_service.auto_claim_for_customer_line + workflow_service._fire_auto_claims).
 */
const AUTO_CLAIM_SKIP_STATUSES = ["cancelled", "refused", "archived"];

export async function triggerDuePayments(
  contractId: number,
  stageId: number,
  finishDate: string,
  tx?: Tx
): Promise<number> {
  const client = tx || db;
  const stage = await client.contractStage.findUnique({ where: { id: stageId } });
  if (!stage || stage.contractId !== contractId) return 0;

  const [receiptRows, planRows, linkRows] = await Promise.all([
    client.voucher.findMany({
      where: { contractId, vtype: "receipt", cancelled: false },
      select: { id: true, voucherNumber: true, vdate: true, amount: true, allocation: true, advanceAmount: true },
    }),
    client.paymentPlanItem.findMany({
      where: { contractId },
      include: { stage: { select: { isSkipped: true, endDate: true } } },
    }),
    client.voucherPaymentLink.findMany({
      where: { kind: "receipt", voucher: { contractId, vtype: "receipt", cancelled: false } },
      select: { voucherId: true, lineId: true, amount: true },
    }),
  ]);
  const computed = computeContractPaymentPlan(
    planRows.map((p) => ({
      id: p.id,
      title: p.title,
      dueDate: p.dueDate,
      amount: Number(p.amount),
      sortOrder: p.sortOrder,
      stageId: p.stageId,
      triggeredAt: p.triggeredAt,
      notes: p.notes,
      stage: p.stage ? { isSkipped: p.stage.isSkipped, endDate: p.stage.endDate } : null,
    })),
    receiptRows.map((v) => ({
      id: v.id,
      voucherNumber: v.voucherNumber,
      vdate: v.vdate,
      amount: Number(v.amount),
      allocation: v.allocation,
      advanceAmount: Number(v.advanceAmount),
      cancelled: false,
    })),
    linkRows.map((l) => ({ voucherId: l.voucherId, lineId: l.lineId, amount: Number(l.amount) }))
  );
  const byId = new Map(computed.lines.map((l) => [l.id, l]));
  const targets = await client.paymentPlanItem.findMany({
    where: { contractId, stageId, triggeredAt: "" },
    select: { id: true },
  });
  let count = 0;
  for (const t of targets) {
    const line = byId.get(t.id);
    if (line && line.remaining > EPS) {
      const lineNotes = `مستحقة لانتهاء مرحلة «${stage.name}» بتاريخ ${finishDate}`;
      await client.paymentPlanItem.update({
        where: { id: t.id },
        data: {
          dueDate: finishDate,
          triggeredAt: finishDate,
          notes: lineNotes,
        },
      });
      count += 1;
      // ===== المطالبة التلقائية (Task 11-a): السطر المُثير غير المُغطى بالكامل =====
      if (line.state !== "paid") {
        const existing = await client.claim.findFirst({
          where: { custLineId: line.id, status: { notIn: AUTO_CLAIM_SKIP_STATUSES } },
          select: { id: true },
        });
        if (!existing) {
          const claimNumber = await nextClaimNumber(client);
          await client.claim.create({
            data: {
              claimNumber,
              direction: "out",
              contractId,
              custLineId: line.id,
              title: `مطالبة تلقائية: ${line.title || "دفعة"}`,
              amount: line.amountN,
              dueDate: finishDate,
              status: "registered",
              notes: `تلقائية من استحقاق دفعة بتاريخ ${finishDate}`,
            },
          });
          await client.paymentPlanItem.update({
            where: { id: line.id },
            data: { notes: `${lineNotes}\nأُنشئت مطالبة تلقائية ${claimNumber}` },
          });
        }
      }
    }
  }
  return count;
}
