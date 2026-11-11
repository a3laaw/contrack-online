import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, ok } from "@/lib/api-utils";
import { EPS, r3, contractCurrentValue, supervisionExtension } from "@/lib/contrack-core";
import { actualSupervisionEnd } from "@/lib/contrack-server";

/**
 * لوحة المشاريع — كوكتيل عمليات الموقع لكل العقود غير الملغاة/المسودات.
 * كل العدادات مشتقة لحظيًا من الصفوف (G9: مشتق لا مخزّن):
 *  • القيمة الحالية = نفس محرك قائمة العقود (contractCurrentValue بالأوامر التغييرية وتمديد الإشراف)
 *  • الفعّال بالبنود = Σ (كمية البند + نصيبه من ملحقات «إضافة بند BOQ») × سعر الوحدة
 *  • المنفذ/الموثق = Σ سجلات FieldExecution × سعر الوحدة
 *  • مفوتر/محصّل = Σ مستخلصات العميل غير الملغاة (paidAmount للمحصّل)
 *  • النشاط = آخر تاريخ تنفيذ + عدد سجلات آخر 7 أيام
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;

  const contracts = await db.contract.findMany({
    where: { status: { notIn: ["ملغى", "مسودة"] } },
    select: {
      id: true,
      contractNumber: true,
      contractName: true,
      status: true,
      amount: true,
      supStartDate: true,
      supMonths: true,
      supMonthly: true,
      supDiscount: true,
      supWaivedMonths: true,
      customer: { select: { name: true } },
      addendums: { select: { status: true, amountAdd: true, amountDeduct: true } },
      boqItems: { where: { deleted: false }, select: { id: true } },
    },
    orderBy: { id: "desc" },
  });
  const ids = contracts.map((c) => c.id);

  const [boqItems, addParts, execAgg, docAgg, invAgg, lastAgg, recentAgg] = await Promise.all([
    ids.length
      ? db.boqItem.findMany({
          where: { contractId: { in: ids }, deleted: false },
          select: { id: true, contractId: true, qty: true, unitPrice: true },
        })
      : Promise.resolve([]),
    ids.length
      ? db.addendumItem.findMany({
          where: {
            addendum: { contractId: { in: ids }, status: "معتمد", side: "client" },
            action: "add",
            refKind: "boq",
          },
          select: { boqItemId: true, createdItemId: true, qty: true },
        })
      : Promise.resolve([]),
    ids.length
      ? db.fieldExecution.groupBy({
          by: ["contractId", "boqItemId"],
          where: { contractId: { in: ids } },
          _sum: { qty: true },
        })
      : Promise.resolve([]),
    ids.length
      ? db.fieldExecution.groupBy({
          by: ["contractId", "boqItemId"],
          where: { contractId: { in: ids }, documented: true },
          _sum: { qty: true },
        })
      : Promise.resolve([]),
    ids.length
      ? db.invoice.groupBy({
          by: ["contractId"],
          where: { contractId: { in: ids }, status: { not: "void" } },
          _sum: { total: true, paidAmount: true },
        })
      : Promise.resolve([]),
    ids.length
      ? db.fieldExecution.groupBy({
          by: ["contractId"],
          where: { contractId: { in: ids } },
          _max: { executionDate: true },
        })
      : Promise.resolve([]),
    ids.length
      ? db.fieldExecution.groupBy({
          by: ["contractId"],
          where: {
            contractId: { in: ids },
            executionDate: { gte: new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10) },
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  // أسعار البنود وخريطة بند→عقد، والقيمة الفعّالة لكل عقد (كمية + أجزاء الملحقات كما في مقايسة التنفيذ)
  const priceByItem = new Map<number, number>();
  const contractByItem = new Map<number, number>();
  const effectiveByContract = new Map<number, number>();
  for (const it of boqItems) {
    priceByItem.set(it.id, Number(it.unitPrice));
    contractByItem.set(it.id, it.contractId);
    effectiveByContract.set(
      it.contractId,
      (effectiveByContract.get(it.contractId) || 0) + Number(it.qty) * Number(it.unitPrice)
    );
  }
  const changeByItem = new Map<number, number>();
  for (const p of addParts) {
    const q = Number(p.qty);
    if (p.boqItemId) changeByItem.set(p.boqItemId, (changeByItem.get(p.boqItemId) || 0) + q);
    if (p.createdItemId && p.createdItemId !== p.boqItemId) {
      changeByItem.set(p.createdItemId, (changeByItem.get(p.createdItemId) || 0) + q);
    }
  }
  for (const [itemId, q] of changeByItem) {
    const contractId = contractByItem.get(itemId);
    const price = priceByItem.get(itemId);
    if (!contractId || price === undefined) continue;
    effectiveByContract.set(contractId, (effectiveByContract.get(contractId) || 0) + q * price);
  }

  const executedByContract = new Map<number, number>();
  for (const g of execAgg) {
    const price = priceByItem.get(g.boqItemId) || 0;
    executedByContract.set(g.contractId, (executedByContract.get(g.contractId) || 0) + Number(g._sum.qty || 0) * price);
  }
  const docByContract = new Map<number, number>();
  for (const g of docAgg) {
    const price = priceByItem.get(g.boqItemId) || 0;
    docByContract.set(g.contractId, (docByContract.get(g.contractId) || 0) + Number(g._sum.qty || 0) * price);
  }
  const invByContract = new Map<number, { total: number; paid: number }>();
  for (const g of invAgg) {
    if (g.contractId == null) continue; // فواتير بلا عقد (نقاط البيع) لا تعني المشاريع
    invByContract.set(g.contractId, { total: Number(g._sum.total || 0), paid: Number(g._sum.paidAmount || 0) });
  }
  const lastByContract = new Map<number, string>();
  for (const g of lastAgg) lastByContract.set(g.contractId, g._max.executionDate || "");
  const recentByContract = new Map<number, number>();
  for (const g of recentAgg) recentByContract.set(g.contractId, g._count._all);

  // تمديد الإشراف — نفس مصدر قائمة العقود لاتساق القيمة الحالية
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

  const rows = contracts.map((c) => {
    const isSup = Boolean(c.supStartDate) && c.supMonths > 0 && Number(c.supMonthly) > 0;
    let supExt = 0;
    if (isSup) {
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
    const current = r3(
      contractCurrentValue(
        Number(c.amount),
        c.addendums.map((a) => ({ status: a.status, amountAdd: Number(a.amountAdd), amountDeduct: Number(a.amountDeduct) })),
        supExt
      )
    );
    const effectiveAmount = r3(effectiveByContract.get(c.id) || 0);
    const executedAmount = r3(executedByContract.get(c.id) || 0);
    const inv = invByContract.get(c.id) || { total: 0, paid: 0 };
    const progressPct = effectiveAmount > EPS ? Math.min(100, r3((executedAmount / effectiveAmount) * 100)) : 0;
    return {
      id: c.id,
      contractNumber: c.contractNumber,
      contractName: c.contractName,
      customerName: c.customer.name,
      status: c.status,
      isSupervision: isSup,
      amount: r3(Number(c.amount)),
      current,
      effectiveAmount,
      executedAmount,
      documentedAmount: r3(docByContract.get(c.id) || 0),
      progressPct,
      invoicedAmount: r3(inv.total),
      collectedAmount: r3(inv.paid),
      boqItemCount: c.boqItems.length,
      lastExecutionDate: lastByContract.get(c.id) || "",
      recentExecCount: recentByContract.get(c.id) || 0,
    };
  });

  // الترتيب: النشط أولًا، ثم الأحدث نشاطًا ميدانيًا، ثم الأحدث رقمًا
  rows.sort((a, b) => {
    const aActive = a.status === "نشط" ? 0 : 1;
    const bActive = b.status === "نشط" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    if (a.lastExecutionDate !== b.lastExecutionDate) return a.lastExecutionDate < b.lastExecutionDate ? 1 : -1;
    return b.id - a.id;
  });

  const sumEffective = rows.reduce((s, r) => s + r.effectiveAmount, 0);
  const totals = {
    contracts: rows.length,
    active: rows.filter((r) => r.status === "نشط").length,
    amount: r3(rows.reduce((s, r) => s + r.current, 0)),
    executed: r3(rows.reduce((s, r) => s + r.executedAmount, 0)),
    invoiced: r3(rows.reduce((s, r) => s + r.invoicedAmount, 0)),
    collected: r3(rows.reduce((s, r) => s + r.collectedAmount, 0)),
    progressPct: sumEffective > EPS ? Math.min(100, r3((rows.reduce((s, r) => s + r.executedAmount, 0) / sumEffective) * 100)) : 0,
  };

  return ok({ rows, totals });
}
