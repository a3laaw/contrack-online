import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { EPS, r3 } from "@/lib/contrack-core";
import { loadContractCore, loadSubContractItemsMany } from "@/lib/contrack-server";
import { computeSubPlan } from "@/lib/voucher-server";

type P = { params: Promise<{ id: string }> };

/**
 * كشف المقاول الموحّد — GET /api/subcontractors/[id]/ledger (Task 63)
 * صفحة المقاول الكاملة: بياناته + لكل عقد باطن لديه كتلة موحّدة
 * (بنود + جدول دفعات العميل مقابل دفعاته على نفس السطر) — نفس المنطق الحسابي
 * الحرفي لـ /api/contracts/[id]/pay-view (كتلة لكل مقاول) لضمان تطابق الرقمين
 * في ملف العميل وصفحة المقاول:
 *   · المستحق = المبالغ المحركة فعليًا (triggered) من computeSubPlan
 *   · المسدَّد = plan.paid (تغطية سندات الصرف)
 *   · بانتظار تحصيل العميل = الخطوط المقفلة بالبوابة المتبقية
 * خطوط العميل المعروضة لكل كتلة = دفعات العميل المرتبطة بهذا الباطن فقط (مصادره).
 */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_subcontractors");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const subId = Number(idStr);
  if (!Number.isFinite(subId)) return jsonError("معرف غير صالح");

  const contractor = await db.subcontractor.findUnique({
    where: { id: subId },
    select: { id: true, name: true, subCode: true, phone: true, activity: true, email: true, notes: true },
  });
  if (!contractor) return jsonError("المقاول غير موجود", 404);

  const subs = await db.subContract.findMany({
    where: { subcontractorId: subId },
    include: {
      contract: {
        select: { id: true, contractNumber: true, customer: { select: { name: true } } },
      },
    },
    orderBy: [{ contractId: "asc" }, { id: "asc" }],
  });

  // نواة العقد الأب تُحسب مرة واحدة لكل عقد (خطوط العميل تغطيتها من المنطق الموحّد)
  const coreCache = new Map<number, Awaited<ReturnType<typeof loadContractCore>>>();
  const coreOf = async (contractId: number) => {
    if (!coreCache.has(contractId)) coreCache.set(contractId, await loadContractCore(contractId));
    return coreCache.get(contractId)!;
  };

  type Block = {
    id: number;
    contractId: number;
    contractNumber: string;
    customerName: string;
    amount: number;
    status: string;
    startDate: string;
    endDate: string;
    items: { id: number; boqItemId: number | null; description: string; unit: string; qty: number; unitPrice: number; amount: number }[];
    itemsTotal: number;
    clientLines: Record<string, unknown>[];
    plan: { lines: Record<string, unknown>[]; paid: number; planTotal: number; gateEnabled: boolean } | null;
    due: number;
    paid: number;
    remaining: number;
    waiting: number;
  };
  const blocks: Block[] = [];
  let totalAmount = 0;
  let totalPaid = 0;
  let totalDue = 0;
  let totalWaiting = 0;
  let activeCount = 0;

  const itemsBySub = await loadSubContractItemsMany(subs.map((s) => s.id));
  for (const s of subs) {
    const [plan, core] = await Promise.all([computeSubPlan(s.id, { coreCache }), coreOf(s.contractId)]);
    const items = itemsBySub.get(s.id) ?? [];

    const subLines = plan
      ? plan.lines.map((l) => ({
          id: l.id,
          title: l.title,
          dueDate: l.dueDate,
          amountN: l.amountN,
          covered: l.covered,
          remaining: l.remaining,
          state: l.state,
          stateLabel: l.stateLabel,
          gated: l.gated,
          triggeredAt: l.triggeredAt,
          sourceIds: l.sourceIds,
        }))
      : [];
    const sourceSet = new Set<number>();
    for (const l of subLines) for (const src of l.sourceIds) sourceSet.add(src);
    // دفعات العميل المرتبطة بهذا الباطن فقط (مصادره) — بترتيب خطط العقد
    const clientLines = (core?.computed.lines ?? [])
      .filter((l) => sourceSet.has(l.id))
      .map((l) => ({
        id: l.id,
        title: l.title,
        dueDate: l.dueDate,
        amountN: l.amountN,
        covered: l.covered,
        remaining: l.remaining,
        state: l.state,
        stateLabel: l.stateLabel,
        triggeredAt: l.triggeredAt,
        notes: l.notes,
        sortOrder: l.sortOrder,
      }));

    const due = r3(subLines.filter((l) => (l.triggeredAt || "").trim()).reduce((a, l) => a + l.amountN, 0));
    const paid = plan ? plan.paid : 0;
    const waiting = plan && plan.gateEnabled
      ? r3(subLines.filter((l) => l.gated && l.remaining > EPS).reduce((a, l) => a + l.amountN, 0))
      : 0;

    totalAmount = r3(totalAmount + Number(s.amount));
    totalPaid = r3(totalPaid + paid);
    totalDue = r3(totalDue + due);
    totalWaiting = r3(totalWaiting + waiting);
    if ((s.status || "").trim() !== "ملغى") activeCount += 1;

    blocks.push({
      id: s.id,
      contractId: s.contractId,
      contractNumber: s.contract?.contractNumber || "",
      customerName: s.contract?.customer?.name || "",
      amount: r3(Number(s.amount)),
      status: s.status,
      startDate: s.startDate,
      endDate: s.endDate,
      items,
      itemsTotal: r3(items.reduce((a, it) => a + it.amount, 0)),
      clientLines,
      plan: plan ? { lines: subLines, paid: plan.paid, planTotal: plan.planTotal, gateEnabled: plan.gateEnabled } : null,
      due,
      paid,
      remaining: r3(due - paid),
      waiting,
    });
  }

  return ok({
    item: {
      ...contractor,
      phone: contractor.phone || "",
      activity: contractor.activity || "",
      email: contractor.email || "",
      notes: contractor.notes || "",
    },
    blocks,
    totals: {
      contractsCount: subs.length,
      activeCount,
      totalAmount,
      totalPaid,
      totalRemaining: r3(totalDue - totalPaid),
      totalWaiting,
    },
  });
}
