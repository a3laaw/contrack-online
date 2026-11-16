import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok, parseDay } from "@/lib/api-utils";
import { EPS, PLAN_TRIGGER_KINDS, r3 } from "@/lib/contrack-core";
import { loadContractCore, triggerStageStartPayments } from "@/lib/contrack-server";
import { resolveRefItemIds } from "@/lib/ref-lists-shared";

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

  // سيناريو المالك 2026-11 — مراحل العقد للمستوى الأول: تغذي محدد «المرحلة المحفزة»
  // في خطوط خطة الباطن ومنشئ الدفعات المرحلية (مرحلة ↔ دفعة تلقائيًا)
  const stages = await db.contractStage.findMany({
    where: { contractId, level: 1 },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, name: true, isSkipped: true },
  });

  return ok({
    contract: {
      id: c.id,
      contractNumber: c.contractNumber,
      contractName: c.contractName,
      status: c.status,
      customerId: c.customerId,
      customerName: c.customer.name,
    },
    stages,
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
  let stageRow: { id: number; startDate: string } | null = null;
  if (body.stageId !== undefined && body.stageId !== null && body.stageId !== "") {
    const sid = Number(body.stageId);
    const st = await db.contractStage.findUnique({ where: { id: sid }, select: { id: true, contractId: true, startDate: true } });
    if (!st || st.contractId !== contractId) return jsonError("المرحلة غير موجودة في هذا العقد");
    stageId = sid;
    stageRow = st;
  }

  // شرط استحقاق الدفعة — طلب المالك: «عند البدا، عند الانتهاء وهكذا»
  // بلا مرحلة ⇒ بتاريخ الاستحقاق فقط · مع مرحلة وبلا شرط ⇒ عند الإنجاز (توافق القديم)
  let triggerKind = String(body.triggerKind ?? "");
  if (!["", ...PLAN_TRIGGER_KINDS].includes(triggerKind)) return jsonError("شرط استحقاق غير معروف");
  if (!stageId) {
    if (triggerKind === "stage_start" || triggerKind === "stage_end") {
      return jsonError("شرط «عند البداية / عند الإنجاز» يتطلب ربط الدفعة بمرحلة أولًا");
    }
    triggerKind = triggerKind || "date";
  } else {
    triggerKind = triggerKind || "stage_end";
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

  // ربط القوائم المرجعية — بنود القوائم المرتبطة بهذه الدفعة (تحقق: موجودة ومفعلة بقوائم مفعلة)
  let refItemIds: number[] = [];
  if (body.refItemIds !== undefined) {
    const resolved = await resolveRefItemIds(body.refItemIds);
    if (typeof resolved === "string") return jsonError(resolved);
    refItemIds = resolved;
  }

  const line = await db.$transaction(async (tx) => {
    const created = await tx.paymentPlanItem.create({
      data: {
        contractId,
        title,
        dueDate,
        amount,
        sortOrder: (max._max.sortOrder ?? -1) + 1,
        stageId,
        triggerKind,
      },
    });
    // شرط «عند البداية» على مرحلة بدأت أصلًا ⇒ استحقاق فوري بتاريخ بدايتها
    if (triggerKind === "stage_start" && stageRow?.startDate) {
      await triggerStageStartPayments(contractId, stageRow.id, stageRow.startDate, tx);
    }
    if (refItemIds.length > 0) {
      await tx.refItemPayment.createMany({
        data: refItemIds.map((itemId) => ({ itemId, paymentId: created.id })),
      });
    }
    await tx.contractEvent.create({
      data: {
        contractId,
        eventType: "إضافة دفعة للخطة",
        description:
          `أُضيفت دفعة «${title}» بمبلغ ${amount} بتاريخ استحقاق ${dueDate}` +
          (stageId ? ` — مربوطة بمرحلة وشرطها ${triggerKind === "stage_start" ? "عند البداية" : "عند الإنجاز"}` : "") +
          (refItemIds.length > 0 ? ` — مربوطة بـ${refItemIds.length} بند مرجعي` : ""),
        username: guard.user.username,
      },
    });
    return created;
  });
  return ok({ line: { id: line.id, title: line.title, dueDate: line.dueDate, amount: Number(line.amount), sortOrder: line.sortOrder, stageId: line.stageId, triggerKind: line.triggerKind, refItemIds } }, 201);
}
