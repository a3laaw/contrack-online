import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { EPS, r3 } from "@/lib/contrack-core";
import { loadContractCore } from "@/lib/contrack-server";
import {
  VoucherError,
  applyLinks,
  checkSelection,
  computePlanLines,
  computeSubPlan,
  distributePreview,
} from "@/lib/voucher-server";

/**
 * خطوط الخطة القابلة للربط:
 * GET ?contractId=&kind=receipt أو ?subContractId=&kind=payment
 * لكل خط: eligible/room/gated + الحالة الثمانية.
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_vouchers");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const kind = (sp.get("kind") || "receipt").trim();
  const contractId = Number(sp.get("contractId") || 0);
  const subContractId = Number(sp.get("subContractId") || 0);

  if (kind === "receipt") {
    if (!contractId) return jsonError("contractId مطلوب لخطة القبض");
    const core = await loadContractCore(contractId);
    if (!core) return jsonError("العقد غير موجود", 404);
    const lines = core.computed.lines.map((l) => ({
      id: l.id,
      title: l.title,
      dueDate: l.dueDate,
      amountN: l.amountN,
      covered: l.covered,
      explicit: l.explicit,
      remaining: l.remaining,
      state: l.state,
      stateLabel: l.stateLabel,
      daysDiff: l.daysDiff,
      triggeredAt: l.triggeredAt,
      eligible: l.remaining > EPS && (l.state === "overdue" || l.state === "partial" || l.state === "due" || (l.state === "upcoming" && Boolean(l.triggeredAt))),
      room: r3(Math.max(0, Math.min(r3(l.amountN - l.explicit), l.remaining))),
      gated: false,
    }));
    return ok({
      kind: "receipt",
      contractId,
      contractNumber: core.contract.contractNumber,
      customerName: core.contract.customer.name,
      current: core.current,
      collected: core.collected,
      supTotalDue: core.sup ? r3(Math.max(core.current, core.sup.totalDue)) : null,
      lines,
    });
  }

  if (kind === "payment") {
    if (!subContractId) return jsonError("subContractId مطلوب لخطة الصرف للباطن");
    const plan = await computeSubPlan(subContractId);
    if (!plan) return jsonError("عقد الباطن غير موجود", 404);
    const lines = plan.lines.map((l) => ({
      id: l.id,
      title: l.title,
      dueDate: l.dueDate,
      amountN: l.amountN,
      covered: l.covered,
      explicit: l.explicit,
      remaining: l.remaining,
      state: l.state,
      stateLabel: l.stateLabel,
      daysDiff: l.daysDiff,
      triggeredAt: l.triggeredAt,
      eligible:
        l.remaining > EPS &&
        !l.gated &&
        plan.subContract.status !== "ملغى" &&
        (l.state === "overdue" || l.state === "partial" || l.state === "due" || (l.state === "upcoming" && Boolean(l.triggeredAt))),
      room: r3(Math.max(0, Math.min(r3(l.amountN - l.explicit), l.remaining))),
      gated: l.gated,
      sourceIds: l.sourceIds,
    }));
    return ok({
      kind: "payment",
      subContractId,
      subContract: plan.subContract,
      paid: plan.paid,
      planTotal: plan.planTotal,
      capRemaining: plan.capRemaining,
      gateEnabled: plan.gateEnabled,
      lines,
    });
  }

  return jsonError("kind غير صالح (receipt|payment)");
}

/**
 * POST {action:'validate'|'distribute', voucherId?, contractId?|subContractId?, kind, amount, lineIds?}
 * validate: {valid, message, suggested} بالترتيب (توزيع تلقائي كامل)
 * distribute: ينفذ التوزيع على سند موجود مع spread والباقي advanceAmount
 */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_vouchers");
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");
  if (!["validate", "distribute"].includes(action)) return jsonError("action غير صالح (validate|distribute)");
  const kind = String(body.kind || "receipt") as "receipt" | "payment";
  if (!["receipt", "payment"].includes(kind)) return jsonError("kind غير صالح (receipt|payment)");
  const amount = Number(body.amount || 0);
  if (!Number.isFinite(amount) || !(amount > 0)) return jsonError("المبلغ الموزع يجب أن يكون أكبر من صفر");

  const voucherId = body.voucherId ? Number(body.voucherId) : 0;
  const excludeVoucherId = voucherId || undefined;

  // حساب الخطوط
  let lines: Awaited<ReturnType<typeof computePlanLines>> = [];
  let gatedIds = new Set<number>();
  if (kind === "receipt") {
    const contractId = Number(body.contractId || 0);
    if (!contractId) return jsonError("contractId مطلوب");
    lines = await computePlanLines(db, contractId, { excludeVoucherId });
  } else {
    const subContractId = Number(body.subContractId || 0);
    if (!subContractId) return jsonError("subContractId مطلوب");
    const plan = await computeSubPlan(subContractId, { excludeVoucherId });
    if (!plan) return jsonError("عقد الباطن غير موجود", 404);
    lines = plan.lines;
    gatedIds = new Set(plan.lines.filter((l) => l.gated).map((l) => l.id));
  }

  if (action === "validate") {
    const lineIds = Array.isArray(body.lineIds) ? (body.lineIds as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0) : [];
    let valid = true;
    let message = "";
    if (lineIds.length > 0) {
      const chk = checkSelection(lineIds, lines, gatedIds);
      valid = chk.valid;
      message = chk.message;
    }
    const preview = distributePreview(amount, lines, gatedIds);
    return ok({
      valid,
      message,
      suggested: preview.suggested,
      advance: preview.advance,
    });
  }

  // distribute — على سند موجود
  if (!voucherId) return jsonError("voucherId مطلوب للتوزيع");
  const voucher = await db.voucher.findUnique({ where: { id: voucherId } });
  if (!voucher) return jsonError("السند غير موجود", 404);
  if (voucher.cancelled) return jsonError("لا يمكن التوزيع على سند ملغى");
  const expectedVtype = kind === "receipt" ? "receipt" : "payment";
  if (voucher.vtype !== expectedVtype) return jsonError("نوع السند لا يطابق kind المطلوب");
  if (kind === "receipt") {
    const contractId = Number(body.contractId || 0);
    if (!voucher.contractId) return jsonError("السند غير مرتبط بعقد");
    if (contractId && contractId !== voucher.contractId) return jsonError("العقد المحدد لا يطابق عقد السند");
  } else {
    const subContractId = Number(body.subContractId || 0);
    if (!voucher.subContractId) return jsonError("السند غير مرتبط بعقد باطن");
    if (subContractId && subContractId !== voucher.subContractId) return jsonError("عقد الباطن المحدد لا يطابق عقد السند");
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const res = await applyLinks(tx, {
        voucherId: voucher.id,
        kind,
        amount: Number(voucher.amount),
        links: [],
        lines,
        gatedIds,
      });
      await tx.voucher.update({ where: { id: voucher.id }, data: { advanceAmount: res.advance } });
      return res;
    });
    return ok({ distributed: true, inserted: result.inserted, advance: result.advance });
  } catch (e) {
    if (e instanceof VoucherError) return jsonError(e.message, e.status);
    console.error(e);
    return jsonError("تعذر تنفيذ التوزيع", 500);
  }
}
