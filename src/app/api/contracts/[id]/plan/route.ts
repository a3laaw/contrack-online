import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok, parseDay } from "@/lib/api-utils";
import { EPS, r3 } from "@/lib/contrack-core";
import { loadContractCore } from "@/lib/contrack-server";

type P = { params: Promise<{ id: string }> };

/** الخطة المحسوبة عبر computeContractPaymentPlan بحالاتها الثمانية + supTotalDue للسقف */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const core = await loadContractCore(contractId);
  if (!core) return jsonError("العقد غير موجود", 404);
  const c = core.contract;

  return ok({
    contract: {
      id: c.id,
      contractNumber: c.contractNumber,
      contractName: c.contractName,
      status: c.status,
      customerId: c.customerId,
      customerName: c.customer.name,
    },
    current: core.current,
    collected: core.computed.collected,
    totalCollected: core.collected,
    currentCoverage: core.computed.currentCoverage,
    supTotalDue: core.sup ? r3(Math.max(core.current, core.sup.totalDue)) : null,
    lines: core.computed.lines,
  });
}

/** إضافة دفعة — سقف: Σ الدفعات ≤ القيمة الحالية + 0.001 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_add_payment");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const core = await loadContractCore(contractId);
  if (!core) return jsonError("العقد غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const title = String(body.title || "").trim();
  if (!title) return jsonError("عنوان الدفعة مطلوب");
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || !(amount > 0)) return jsonError("قيمة الدفعة يجب أن تكون أكبر من صفر");
  const dueDate = parseDay(body.dueDate);
  if (!dueDate) return jsonError("تاريخ استحقاق الدفعة مطلوب بصيغة YYYY-MM-DD");

  let stageId: number | null = null;
  if (body.stageId !== undefined && body.stageId !== null && body.stageId !== "") {
    const sid = Number(body.stageId);
    const st = await db.contractStage.findUnique({ where: { id: sid } });
    if (!st || st.contractId !== contractId) return jsonError("المرحلة غير موجودة في هذا العقد");
    stageId = sid;
  }

  const agg = await db.paymentPlanItem.aggregate({
    where: { contractId },
    _sum: { amount: true },
  });
  const planSum = Number(agg._sum.amount || 0);
  if (r3(planSum + amount) > r3(core.current + EPS)) {
    return jsonError("مجموع الدفعات يتجاوز القيمة الحالية");
  }

  const max = await db.paymentPlanItem.aggregate({
    where: { contractId },
    _max: { sortOrder: true },
  });
  const line = await db.$transaction(async (tx) => {
    const created = await tx.paymentPlanItem.create({
      data: {
        contractId,
        title,
        dueDate,
        amount,
        sortOrder: (max._max.sortOrder ?? -1) + 1,
        stageId,
      },
    });
    await tx.contractEvent.create({
      data: {
        contractId,
        eventType: "إضافة دفعة للخطة",
        description: `أُضيفت دفعة «${title}» بمبلغ ${amount} بتاريخ استحقاق ${dueDate}`,
        username: guard.user.username,
      },
    });
    return created;
  });
  return ok({ line: { id: line.id, title: line.title, dueDate: line.dueDate, amount: Number(line.amount), sortOrder: line.sortOrder, stageId: line.stageId } }, 201);
}
