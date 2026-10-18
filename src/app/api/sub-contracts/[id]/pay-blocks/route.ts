import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import { loadContractCore } from "@/lib/contrack-server";
import { computeSubPlan } from "@/lib/voucher-server";

type P = { params: Promise<{ id: string }> };

/**
 * الجدول الموحد «العميل ⇄ المقاول» (sub_pay_blocks):
 * لكل خط عميل مغطى بعقد الباطن: صف يحوي حالة دفعة العميل وخطوط المقاول التابعة لها،
 * محسوب لحظيًا بلا جداول. خطوط المقاول بلا مصادر تُلحق في unlinked.
 */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_subcontractors");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const subContractId = Number(idStr);
  if (!Number.isFinite(subContractId)) return jsonError("معرف غير صالح");

  const plan = await computeSubPlan(subContractId);
  if (!plan) return jsonError("عقد الباطن غير موجود", 404);

  const core = await loadContractCore(plan.subContract.contractId);
  if (!core) return jsonError("عقد العميل غير موجود", 404);

  const clientById = new Map(core.computed.lines.map((l) => [l.id, l]));
  const subByFirstSource = new Map<number, typeof plan.lines>();
  const unlinked: typeof plan.lines = [];
  for (const sl of plan.lines) {
    const firstSource = sl.sourceIds.length > 0 ? Math.min(...sl.sourceIds) : null;
    if (firstSource === null || !clientById.has(firstSource)) {
      unlinked.push(sl);
      continue;
    }
    const arr = subByFirstSource.get(firstSource) || [];
    arr.push(sl);
    subByFirstSource.set(firstSource, arr);
  }

  const rows = [...subByFirstSource.entries()]
    .filter(([custLineId]) => clientById.has(custLineId))
    .sort((a, b) => {
      const la = clientById.get(a[0])!;
      const lb = clientById.get(b[0])!;
      if (la.dueDate !== lb.dueDate) return la.dueDate < lb.dueDate ? -1 : 1;
      return la.sortOrder - lb.sortOrder;
    })
    .map(([custLineId, subLines]) => {
      const c = clientById.get(custLineId)!;
      return {
        custLineId,
        custTitle: c.title,
        custAmount: c.amountN,
        custCovered: c.covered,
        custRemaining: c.remaining,
        custState: c.state,
        custStateLabel: c.stateLabel,
        subLines: subLines.map((sl) => ({
          id: sl.id,
          title: sl.title,
          amountN: sl.amountN,
          covered: sl.covered,
          remaining: sl.remaining,
          state: sl.state,
          stateLabel: sl.stateLabel,
          gated: sl.gated,
          sourceIds: sl.sourceIds,
        })),
      };
    });

  return ok({
    subContract: plan.subContract,
    gateEnabled: plan.gateEnabled,
    paid: plan.paid,
    capRemaining: plan.capRemaining,
    contractCollected: core.collected,
    rows,
    unlinked: unlinked.map((sl) => ({
      id: sl.id,
      title: sl.title,
      amountN: sl.amountN,
      covered: sl.covered,
      remaining: sl.remaining,
      state: sl.state,
      stateLabel: sl.stateLabel,
      gated: sl.gated,
      sourceIds: sl.sourceIds,
    })),
    totals: {
      clientCovered: r3(rows.reduce((s, r) => s + r.custCovered, 0)),
      subTotal: plan.planTotal,
      subPaid: plan.paid,
    },
  });
}
