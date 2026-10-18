import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok, parseDay, todayStr } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import {
  CLAIM_BLOCK_STATUSES,
  cancelVoucherTx,
  subPaymentCap,
  computeSubPlan,
} from "@/lib/voucher-server";

type P = { params: Promise<{ id: string }> };

/** تفاصيل عقد باطن: البنود + الخطة المحسوبة + paid + cap */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_subcontractors");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const sc = await db.subContract.findUnique({
    where: { id },
    include: {
      subcontractor: { select: { id: true, name: true, subCode: true } },
      contract: {
        select: {
          id: true,
          contractNumber: true,
          contractName: true,
          status: true,
          customer: { select: { id: true, name: true } },
        },
      },
      items: { include: { boqItem: { select: { id: true, description: true, unit: true } } }, orderBy: { id: "asc" } },
    },
  });
  if (!sc) return jsonError("عقد الباطن غير موجود", 404);

  const paidAgg = await db.voucher.aggregate({
    where: { subContractId: sc.id, vtype: "payment", cancelled: false, allocation: "" },
    _sum: { amount: true },
  });
  const paid = r3(Number(paidAgg._sum.amount || 0));
  const cap = await subPaymentCap(db, { contractId: sc.contractId, subcontractorId: sc.subcontractorId });
  const plan = await computeSubPlan(sc.id);

  return ok({
    subContract: {
      id: sc.id,
      subcontractorId: sc.subcontractorId,
      subcontractorName: sc.subcontractor.name,
      subCode: sc.subcontractor.subCode,
      contractId: sc.contractId,
      contractNumber: sc.contract.contractNumber,
      contractName: sc.contract.contractName,
      customerName: sc.contract.customer.name,
      amount: Number(sc.amount),
      startDate: sc.startDate,
      endDate: sc.endDate,
      status: sc.status,
      description: sc.description,
      cancelReason: sc.cancelReason,
      cancelledAt: sc.cancelledAt,
    },
    items: sc.items.map((it) => ({
      id: it.id,
      boqItemId: it.boqItemId,
      description: it.boqItem?.description || "",
      unit: it.boqItem?.unit || "",
      qty: Number(it.qty),
      unitPrice: Number(it.unitPrice),
      amount: Number(it.amount),
      sourceKind: it.sourceKind,
    })),
    paid,
    remaining: r3(Number(sc.amount) - paid),
    cap,
    plan: plan
      ? { lines: plan.lines, paid: plan.paid, planTotal: plan.planTotal, capRemaining: plan.capRemaining, gateEnabled: plan.gateEnabled }
      : null,
  });
}

/** تعديل عقد باطن: amount/startDate/endDate/description/status */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_subcontractors");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const sc = await db.subContract.findUnique({ where: { id } });
  if (!sc) return jsonError("عقد الباطن غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Prisma.SubContractUpdateInput = {};
  if (body.amount !== undefined) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || !(amount > 0)) return jsonError("قيمة عقد الباطن يجب أن تكون أكبر من صفر");
    data.amount = amount;
  }
  if (body.startDate !== undefined) data.startDate = parseDay(body.startDate);
  if (body.endDate !== undefined) data.endDate = parseDay(body.endDate);
  if (body.description !== undefined) data.description = String(body.description || "");
  if (body.status !== undefined) {
    const status = String(body.status || "");
    if (!["نشط", "متوقف", "منتهي", "ملغى"].includes(status)) return jsonError("حالة عقد الباطن غير صالحة (نشط/متوقف/منتهي/ملغى)");
    if (status === "ملغى") {
      const reason = String(body.cancelReason || body.reason || "").trim();
      if (!reason) return jsonError("سبب الإلغاء مطلوب — استخدم الحذف الموثق بوضع contract");
      data.status = status;
      data.cancelReason = reason;
      data.cancelledAt = todayStr();
    } else {
      data.status = status;
      if (sc.status === "ملغى") {
        data.cancelReason = "";
        data.cancelledAt = "";
      }
    }
  }
  if (body.cancelCloseAmount !== undefined) {
    const close = Number(body.cancelCloseAmount);
    if (!Number.isFinite(close) || close < 0) return jsonError("مبلغ إقفال الإلغاء يجب أن يكون صفرًا أو موجبًا");
    data.cancelCloseAmount = close;
  }

  await db.$transaction(async (tx) => {
    await tx.subContract.update({ where: { id }, data });
    if (Object.keys(data).length > 0) {
      await tx.contractEvent.create({
        data: {
          contractId: sc.contractId,
          eventType: "تعديل عقد باطن",
          description: `تعديل عقد الباطن رقم ${id} للمقاول — ${Object.keys(data).join("، ")}`,
          username: guard.user.username,
        },
      });
      await audit(tx, {
        username: guard.user.username,
        action: "تعديل",
        entityType: "sub_contract",
        entityId: id,
        entityName: `باطن ${id}`,
      });
    }
  });
  return ok({ updated: true });
}

/**
 * حذف موثق لعقد الباطن (الإلغاء):
 * body {mode: 'contract' (افتراضي) | 'vouchers', reason, cancelCloseAmount?}
 * contract: إلغاء عقد الباطن — يُرفض مع سندات صرف سارية أو مطالبات سارية.
 * vouchers: إلغاء سنداته فقط.
 * الحذف الفعلي حكر على المطور (purge لاحقًا).
 */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_cancel_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const sc = await db.subContract.findUnique({
    where: { id },
    include: { contract: { select: { id: true, contractNumber: true } } },
  });
  if (!sc) return jsonError("عقد الباطن غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const mode = String(body.mode || "contract");
  const reason = String(body.reason || "").trim();

  if (mode === "vouchers") {
    // إلغاء سندات الصرف السارية لهذا عقد الباطن فقط
    if (!reason) return jsonError("سبب الإلغاء مطلوب");
    const activeVouchers = await db.voucher.findMany({
      where: { subContractId: id, vtype: "payment", cancelled: false },
      select: { id: true, voucherNumber: true },
      orderBy: { id: "asc" },
    });
    // حاجز المطالبات السارية على عقد العميل الأب
    const claims = await db.claim.findMany({
      where: { contractId: sc.contractId, status: { notIn: CLAIM_BLOCK_STATUSES } },
      select: { claimNumber: true },
      take: 6,
    });
    if (claims.length > 0) {
      return jsonError(`توجد مطالبات مالية سارية (${claims.map((c) => c.claimNumber).join("، ")}) — لا يمكن إلغاء السندات`);
    }
    const cancelled: string[] = [];
    for (const v of activeVouchers) {
      await db.$transaction(async (tx) => {
        await cancelVoucherTx(tx, v.id, reason, guard.user.username, { childReason: "إلغاء مع عقد الباطن" });
      });
      cancelled.push(v.voucherNumber);
    }
    return ok({ mode, cancelledVouchers: cancelled, count: cancelled.length });
  }

  if (mode === "contract") {
    // حاجز: سندات صرف سارية
    const activeVouchers = await db.voucher.count({
      where: { subContractId: id, vtype: "payment", cancelled: false },
    });
    if (activeVouchers > 0) return jsonError("لا يمكن إلغاء عقد باطن عليه سندات صرف سارية — ألغِ السندات أولًا (mode=vouchers)");
    // حاجز: مطالبات سارية
    const claims = await db.claim.findMany({
      where: { subContractId: id, status: { notIn: CLAIM_BLOCK_STATUSES } },
      select: { claimNumber: true },
      take: 6,
    });
    if (claims.length > 0) {
      return jsonError(`لا يمكن إلغاء عقد باطن عليه مطالبات مالية سارية (${claims.map((c) => c.claimNumber).join("، ")})`);
    }
    if (!reason) return jsonError("سبب إلغاء عقد الباطن مطلوب");
    let cancelCloseAmount: number | null = null;
    if (body.cancelCloseAmount !== undefined && body.cancelCloseAmount !== null && body.cancelCloseAmount !== "") {
      const close = Number(body.cancelCloseAmount);
      if (!Number.isFinite(close) || close < 0) return jsonError("مبلغ إقفال الإلغاء يجب أن يكون صفرًا أو موجبًا");
      cancelCloseAmount = close;
    }

    await db.$transaction(async (tx) => {
      await tx.subContract.update({
        where: { id },
        data: {
          status: "ملغى",
          cancelReason: reason,
          cancelledAt: todayStr(),
          ...(cancelCloseAmount !== null ? { cancelCloseAmount } : {}),
        },
      });
      await tx.contractEvent.create({
        data: {
          contractId: sc.contractId,
          eventType: "إلغاء عقد باطن",
          description: `أُلغي عقد الباطن رقم ${id} — السبب: ${reason}`,
          username: guard.user.username,
        },
      });
      await audit(tx, {
        username: guard.user.username,
        action: "إلغاء",
        entityType: "sub_contract",
        entityId: id,
        entityName: `باطن ${id} — ${sc.contract.contractNumber}`,
        reason,
      });
    });
    return ok({ mode, cancelled: true, subContractId: id });
  }

  return jsonError("mode غير صالح (contract|vouchers)");
}
