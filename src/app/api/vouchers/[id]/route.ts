import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, ok, parseDay } from "@/lib/api-utils";
import { forbidden, hasPermission, isSuperRole } from "@/lib/auth";
import { r3 } from "@/lib/contrack-core";
import {
  VoucherError,
  VOUCHER_TYPE_LABELS,
  updateVoucher,
  cancelVoucherTx,
  voucherCancelBarrier,
} from "@/lib/voucher-server";

type P = { params: Promise<{ id: string }> };

/** سند مفصل بروابطه وأبنائه وقيوده */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_vouchers");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return Response.json({ error: "معرف غير صالح" }, { status: 400 });

  const v = await db.voucher.findUnique({
    where: { id },
    include: {
      contract: { select: { id: true, contractNumber: true, contractName: true, customerId: true, customer: { select: { name: true } } } },
      subContract: { select: { id: true, amount: true, subcontractor: { select: { id: true, name: true } } } },
      employee: { select: { id: true, name: true } },
      parentVoucher: { select: { id: true, voucherNumber: true, vtype: true } },
      feeChildren: { select: { id: true, voucherNumber: true, vtype: true, amount: true, cancelled: true, cancelReason: true } },
    },
  });
  if (!v) return Response.json({ error: "السند غير موجود" }, { status: 404 });

  // أسماء الأطراف
  let partyName = v.party;
  if (v.partyType === "customer" && v.partyId) {
    const c = await db.customer.findUnique({ where: { id: v.partyId }, select: { name: true } });
    partyName = c?.name || v.party;
  } else if (v.partyType === "subcontractor" && v.partyId) {
    const s = await db.subcontractor.findUnique({ where: { id: v.partyId }, select: { name: true } });
    partyName = s?.name || v.party;
  }

  // الروابط مع عناوين الخطوط
  const linkRows = await db.voucherPaymentLink.findMany({ where: { voucherId: v.id }, orderBy: { id: "asc" } });
  const receiptLineIds = linkRows.filter((l) => l.kind === "receipt").map((l) => l.lineId);
  const paymentLineIds = linkRows.filter((l) => l.kind === "payment").map((l) => l.lineId);
  const [custLines, subLines] = await Promise.all([
    db.paymentPlanItem.findMany({
      where: { id: { in: receiptLineIds.length ? receiptLineIds : [0] } },
      select: { id: true, title: true, dueDate: true },
    }),
    db.subPaymentPlanItem.findMany({
      where: { id: { in: paymentLineIds.length ? paymentLineIds : [0] } },
      select: { id: true, title: true, dueDate: true },
    }),
  ]);
  const custTitle = new Map(custLines.map((l) => [l.id, `${l.title} (${l.dueDate})`]));
  const subTitle = new Map(subLines.map((l) => [l.id, `${l.title} (${l.dueDate})`]));

  const feeChildIds = v.feeChildren.map((c) => c.id);
  const journals = await db.journalEntry.findMany({
    where: {
      OR: [
        { sourceType: "voucher", sourceId: v.id },
        { sourceType: "voucher_cancel", sourceId: v.id },
        ...(feeChildIds.length ? [{ sourceType: "bank_fee_alloc", sourceId: { in: feeChildIds } }] : []),
      ],
    },
    orderBy: { id: "asc" },
  });

  return ok({
    voucher: {
      id: v.id,
      voucherNumber: v.voucherNumber,
      vtype: v.vtype,
      vtypeLabel: VOUCHER_TYPE_LABELS[v.vtype] || v.vtype,
      vdate: v.vdate,
      party: v.party,
      partyType: v.partyType,
      partyId: v.partyId,
      partyName,
      method: v.method,
      account: v.account,
      amount: Number(v.amount),
      advanceAmount: Number(v.advanceAmount),
      description: v.description,
      notes: v.notes,
      contractId: v.contractId,
      contract: v.contract
        ? { id: v.contract.id, contractNumber: v.contract.contractNumber, contractName: v.contract.contractName, customerName: v.contract.customer.name }
        : null,
      subContractId: v.subContractId,
      subContract: v.subContract
        ? { id: v.subContract.id, amount: Number(v.subContract.amount), subcontractorName: v.subContract.subcontractor.name }
        : null,
      allocation: v.allocation,
      expenseAccountId: v.expenseAccountId,
      expenseAccountSnapshot: v.expenseAccountSnapshot,
      custodyAccountId: v.custodyAccountId,
      custodyAccountSnapshot: v.custodyAccountSnapshot,
      advanceEmployeeId: v.advanceEmployeeId,
      employeeName: v.employee?.name || "",
      parentVoucher: v.parentVoucher ? { id: v.parentVoucher.id, voucherNumber: v.parentVoucher.voucherNumber } : null,
      receiptGroupRef: v.receiptGroupRef,
      receiptGroupLine: v.receiptGroupLine,
      chequeDueDate: v.chequeDueDate,
      costCenter: v.costCenter,
      cancelled: v.cancelled,
      cancelReason: v.cancelReason,
      cancelledAt: v.cancelledAt,
      createdAt: v.createdAt,
      links: linkRows.map((l) => ({
        id: l.id,
        kind: l.kind,
        lineId: l.lineId,
        amount: Number(l.amount),
        lineTitle: l.kind === "receipt" ? custTitle.get(l.lineId) || "" : subTitle.get(l.lineId) || "",
      })),
      feeChildren: v.feeChildren.map((c) => ({
        id: c.id,
        voucherNumber: c.voucherNumber,
        vtype: c.vtype,
        amount: Number(c.amount),
        cancelled: c.cancelled,
        cancelReason: c.cancelReason,
      })),
      journals: journals.map((j) => ({
        id: j.id,
        entryDate: j.entryDate,
        description: j.description,
        debitAccount: j.debitAccount,
        creditAccount: j.creditAccount,
        amount: Number(j.amount),
        sourceType: j.sourceType,
      })),
    },
  });
}

/** تعديل السند — للمدير كاملًا، وللسكرتير وصفًا فقط (action_edit_voucher_desc) */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return Response.json({ error: "معرف غير صالح" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isSuperRole(guard.user.role)) {
    const keys = Object.keys(body);
    const descOnly = keys.length > 0 && keys.every((k) => k === "description");
    if (!descOnly) return forbidden("السكرتير يمكنه تعديل وصف السند فقط");
    const allowed = await hasPermission(guard.user.id, guard.user.role, "action_edit_voucher_desc");
    if (!allowed) return forbidden("لا تملك صلاحية تعديل وصف السند");
  }

  try {
    const updated = await updateVoucher(
      id,
      {
        amount: body.amount !== undefined ? Number(body.amount) : undefined,
        method: body.method !== undefined ? String(body.method) : undefined,
        account: body.account !== undefined ? String(body.account) : undefined,
        vdate: body.vdate !== undefined ? parseDay(body.vdate) || String(body.vdate) : undefined,
        party: body.party !== undefined ? String(body.party) : undefined,
        description: body.description !== undefined ? String(body.description) : undefined,
        links: Array.isArray(body.links)
          ? (body.links as Record<string, unknown>[]).map((l) => ({ lineId: Number(l.lineId), amount: Number(l.amount) }))
          : undefined,
        allowOverpay: Boolean(body.allowOverpay),
        chequeDueDate: body.chequeDueDate !== undefined ? String(body.chequeDueDate) : undefined,
      },
      guard.user
    );
    return ok({ voucher: updated });
  } catch (e) {
    if (e instanceof VoucherError) return Response.json({ error: e.message, ...e.extra }, { status: e.status });
    console.error(e);
    return Response.json({ error: "تعذر تعديل السند" }, { status: 500 });
  }
}

/** إلغاء موثق: {reason} إلزامي — حواجز (مطالبات/عهدة مصفّاة/سلفة) ثم إلغاء الأبناء وعكس القيود وإعادة الفتح */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_cancel_voucher");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return Response.json({ error: "معرف غير صالح" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = String(body.reason || "").trim();
  if (!reason) return Response.json({ error: "سبب الإلغاء مطلوب" }, { status: 400 });

  try {
    const barrier = await voucherCancelBarrier(id);
    if (barrier) return Response.json({ error: barrier }, { status: 400 });

    const result = await db.$transaction(async (tx) => {
      return cancelVoucherTx(tx, id, reason, guard.user.username);
    });
    return ok({ cancelled: true, voucherNumber: result.voucherNumber, reopened: r3(result.reopened) });
  } catch (e) {
    if (e instanceof VoucherError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "تعذر إلغاء السند" }, { status: 500 });
  }
}
