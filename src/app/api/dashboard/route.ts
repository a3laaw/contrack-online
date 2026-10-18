import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, ok } from "@/lib/api-utils";
import {
  computeContractPaymentPlan,
  dueNowStrict,
  EPS,
  r3,
  supervisionExtension,
  daysBetween,
  todayStr,
  ReceiptLike,
  LinkRow,
  PlanLine,
} from "@/lib/contrack-core";
import { actualSupervisionEnd, getSettingsRow } from "@/lib/contrack-server";

/** لوحة القيادة: الإحصاءات + المستحق الآن حسب العقد/العميل + آخر الأحداث + تعريض التحصيل */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const settings = await getSettingsRow();
  const alertDays = Math.max(7, settings.collectionAlertDays);

  const contracts = await db.contract.findMany({
    select: {
      id: true,
      contractNumber: true,
      contractName: true,
      customerId: true,
      contractDate: true,
      status: true,
      amount: true,
      supStartDate: true,
      supMonths: true,
      supMonthly: true,
      supDiscount: true,
      supWaivedMonths: true,
      customer: { select: { id: true, name: true } },
      addendums: { select: { status: true, amountAdd: true, amountDeduct: true } },
      plan: {
        select: {
          id: true,
          title: true,
          dueDate: true,
          amount: true,
          sortOrder: true,
          stageId: true,
          triggeredAt: true,
          notes: true,
          stage: { select: { isSkipped: true, endDate: true } },
        },
      },
      vouchers: {
        where: { vtype: "receipt", cancelled: false },
        select: { id: true, voucherNumber: true, vdate: true, amount: true, allocation: true, advanceAmount: true },
      },
    },
  });

  const supIds = contracts
    .filter((c) => Boolean(c.supStartDate) && c.supMonths > 0 && Number(c.supMonthly) > 0)
    .map((c) => c.id);
  const stageRows =
    supIds.length > 0
      ? await db.contractStage.findMany({
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

  // روابط القبض الصريحة لكل سندات القبض السارية على العقود (يصفّيها computeContractPaymentPlan داخلًا)
  const allIds = contracts.map((c) => c.id);
  const linkRows =
    allIds.length > 0
      ? await db.voucherPaymentLink.findMany({
          where: { kind: "receipt", voucher: { contractId: { in: allIds }, vtype: "receipt", cancelled: false } },
          select: { voucherId: true, lineId: true, amount: true },
        })
      : [];
  const links: LinkRow[] = linkRows.map((l) => ({
    voucherId: l.voucherId,
    lineId: l.lineId,
    amount: Number(l.amount),
  }));

  const today = todayStr();
  let activeCount = 0;
  let notCancelled = 0;
  let contractsValue = 0;
  let totalDueNow = 0;
  const dueByCustomer = new Map<number, { customerId: number; customerName: string; dueNow: number }>();
  const overdueCollections: {
    contractId: number;
    contractNumber: string;
    contractName: string;
    customerId: number;
    customerName: string;
    remaining: number;
    baseDate: string;
    daysSince: number;
  }[] = [];

  for (const c of contracts) {
    const amount = Number(c.amount);
    const receipts: ReceiptLike[] = c.vouchers.map((v) => ({
      id: v.id,
      voucherNumber: v.voucherNumber,
      vdate: v.vdate,
      amount: Number(v.amount),
      allocation: v.allocation,
      advanceAmount: Number(v.advanceAmount),
      cancelled: false,
    }));
    const collectedAll = r3(receipts.reduce((s, v) => s + Number(v.amount), 0));

    const isSup = Boolean(c.supStartDate) && c.supMonths > 0 && Number(c.supMonthly) > 0;
    let supExt = 0;
    if (isSup) {
      const actualEnd = actualSupervisionEnd(stagesByContract.get(c.id) || []);
      supExt = supervisionExtension(
        {
          id: c.id,
          supStartDate: c.supStartDate,
          supMonths: c.supMonths,
          supMonthly: Number(c.supMonthly),
          supDiscount: Number(c.supDiscount),
          supWaivedMonths: Number(c.supWaivedMonths),
        },
        actualEnd
      );
    }
    const addNet = c.addendums
      .filter((a) => a.status === "معتمد")
      .reduce((s, a) => s + Number(a.amountAdd) - Number(a.amountDeduct), 0);
    const current = r3(amount + addNet + supExt);

    if (c.status !== "ملغى") {
      notCancelled += 1;
      contractsValue = r3(contractsValue + current);
    }
    if (c.status === "نشط") activeCount += 1;

    const excluded = c.status === "مغلق" || c.status === "ملغى";
    if (!excluded) {
      // المستحق الآن: له خطة ⇒ strict عبر computeContractPaymentPlan؛ بلا خطة ⇒ كامل المتبقي
      let due = 0;
      if (c.plan.length > 0) {
        const plan: PlanLine[] = c.plan.map((p) => ({
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
        const computed = computeContractPaymentPlan(plan, receipts, links);
        due = dueNowStrict(computed.lines);
      } else {
        due = Math.max(0, r3(current - collectedAll));
        if (due <= EPS) due = 0;
      }
      if (due > 0) {
        totalDueNow = r3(totalDueNow + due);
        const prev = dueByCustomer.get(c.customerId);
        if (prev) prev.dueNow = r3(prev.dueNow + due);
        else dueByCustomer.set(c.customerId, { customerId: c.customerId, customerName: c.customer.name, dueNow: due });
      }
    }

    // تعريض التحصيل: عقد عليه متبقٍ وdaysSince(آخر قبض أو contractDate) ≥ collectionAlertDays
    if (c.status !== "ملغى") {
      const remaining = r3(current - collectedAll);
      if (remaining > EPS) {
        let lastReceipt = "";
        for (const v of c.vouchers) if (v.vdate && (!lastReceipt || v.vdate > lastReceipt)) lastReceipt = v.vdate;
        const baseDate = lastReceipt || c.contractDate;
        if (baseDate) {
          const daysSince = daysBetween(baseDate, today);
          if (daysSince >= alertDays) {
            overdueCollections.push({
              contractId: c.id,
              contractNumber: c.contractNumber,
              contractName: c.contractName,
              customerId: c.customerId,
              customerName: c.customer.name,
              remaining,
              baseDate,
              daysSince,
            });
          }
        }
      }
    }
  }

  const [collectedAgg, paidAgg, subAgg, customersCount] = await Promise.all([
    db.voucher.aggregate({ where: { vtype: "receipt", cancelled: false }, _sum: { amount: true } }),
    db.voucher.aggregate({ where: { vtype: "payment", cancelled: false }, _sum: { amount: true } }),
    db.subContract.aggregate({ where: { status: { not: "ملغى" } }, _sum: { amount: true } }),
    db.customer.count(),
  ]);

  const recentEvents = await db.contractEvent.findMany({
    orderBy: { id: "desc" },
    take: 10,
    include: { contract: { select: { contractNumber: true } } },
  });

  overdueCollections.sort((a, b) => b.daysSince - a.daysSince);

  return ok({
    counts: {
      customers: customersCount,
      contractsActive: activeCount,
      contractsTotal: notCancelled,
    },
    totals: {
      contractsValue,
      collected: Number(collectedAgg._sum.amount || 0),
      paidOut: Number(paidAgg._sum.amount || 0),
      subAmount: Number(subAgg._sum.amount || 0),
    },
    dueNow: {
      total: totalDueNow,
      byCustomer: [...dueByCustomer.values()].sort((a, b) => b.dueNow - a.dueNow).slice(0, 10),
    },
    recentEvents: recentEvents.map((e) => ({
      id: e.id,
      contractId: e.contractId,
      contractNumber: e.contract.contractNumber,
      eventTime: e.eventTime.toISOString(),
      eventType: e.eventType,
      description: e.description,
      username: e.username,
    })),
    overdueCollections,
  });
}
