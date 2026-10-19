import { db } from "@/lib/db";
import { computeContractPaymentPlan, isSupervision, supervisionStatus, contractCurrentValue, type ReceiptLike, type PlanLine } from "@/lib/contrack-core";
import { smartReceiptDescription, smartReceiptStageNote, contractDisplayName } from "@/lib/voucher-describe";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

const main = async () => {
  const c = await db.contract.findFirst({ select: { id: true, contractNumber: true } });
  if (!c) return console.log("لا عقد");
  const contract = await db.contract.findUniqueOrThrow({ where: { id: c.id } });
  const addendumRows = await db.addendum.findMany({ where: { contractId: c.id }, select: { status: true, amountAdd: true, amountDeduct: true } });
  const receiptRows = await db.voucher.findMany({ where: { contractId: c.id, vtype: "receipt", cancelled: false }, select: { id: true, voucherNumber: true, vdate: true, amount: true, allocation: true, advanceAmount: true } });
  const stages = await db.contractStage.findMany({ where: { contractId: c.id }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
  const planRows = await db.paymentPlanItem.findMany({ where: { contractId: c.id }, orderBy: [{ dueDate: "asc" }, { sortOrder: "asc" }], include: { stage: { select: { isSkipped: true, endDate: true } } } });
  const linkRows = await db.voucherPaymentLink.findMany({ where: { kind: "receipt", voucher: { contractId: c.id, vtype: "receipt", cancelled: false } }, select: { voucherId: true, lineId: true, amount: true } });

  const receipts: ReceiptLike[] = receiptRows.map((v) => ({ id: v.id, voucherNumber: v.voucherNumber, vdate: v.vdate, amount: Number(v.amount), allocation: v.allocation, advanceAmount: Number(v.advanceAmount), cancelled: false }));
  const plan: PlanLine[] = planRows.map((p) => ({ id: p.id, title: p.title, dueDate: p.dueDate, amount: Number(p.amount), sortOrder: p.sortOrder, stageId: p.stageId, triggeredAt: p.triggeredAt, notes: p.notes, stage: p.stage ? { isSkipped: p.stage.isSkipped, endDate: p.stage.endDate } : null }));
  const supC = { id: contract.id, supStartDate: contract.supStartDate, supMonths: contract.supMonths, supMonthly: Number(contract.supMonthly), supDiscount: Number(contract.supDiscount), supWaivedMonths: Number(contract.supWaivedMonths) };
  const actualEnd = (() => { let best = ""; for (const s of stages) { const n = (s.name || ""); if (n.includes("انهاء") && n.includes("اشراف")) { const d = s.supActualEnd || s.endDate; if (d && (!best || d > best)) best = d; } } return best; })();
  const sup = isSupervision(supC) ? supervisionStatus(supC, receipts, actualEnd) : null;
  const current = contractCurrentValue(Number(contract.amount), addendumRows.map((a) => ({ status: a.status, amountAdd: Number(a.amountAdd), amountDeduct: Number(a.amountDeduct) })), sup ? sup.extensionValue : 0);
  const computed = computeContractPaymentPlan(plan, receipts, linkRows.map((l) => ({ voucherId: l.voucherId, lineId: l.lineId, amount: Number(l.amount) })));

  const core = { contract, addendums: addendumRows, receipts, links: [], stages, planRaw: planRows, actualEnd, sup, supExt: sup ? sup.extensionValue : 0, current, collected: r3(receipts.reduce((s, v) => s + Number(v.amount || 0), 0)), computed } as const;

  console.log("العقد:", contract.contractNumber, "| الاسم:", contractDisplayName(contract));
  console.log("القيمة الحالية:", current, "| المحصل:", core.collected);
  console.log("المراحل:", stages.map((s) => s.name).join(" / "));
  for (const l of computed.lines) console.log(`  سطر#${l.id} ${l.title} | مبلغ=${l.amountN} مغطى=${l.covered} متبقي=${l.remaining} state=${l.state}`);
  for (const amt of [3000, 17500, 20000, 400, 18000]) {
    const desc = await smartReceiptDescription(db as never, core, amt);
    const note = await smartReceiptStageNote(db as never, core, amt);
    console.log(`\n— قبض ${amt}:`);
    console.log("  البيان:", desc);
    console.log("  الملاحظة:", note || "(فارغة)");
  }
  await db.$disconnect();
};
main();
