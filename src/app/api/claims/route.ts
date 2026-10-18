import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, nextClaimNumber, ok, parseDay, todayStr } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import {
  CLAIM_DIRECTION_LABEL,
  CLAIM_STATUS_DISPLAY,
  CLAIM_STATUS_LABEL,
  DIR_IN,
  DIR_OUT,
  claimIsOverdue,
} from "@/lib/claim-server";

/** سرد المطالبات بفلاتر direction/status/contractId/q + عدادات الحالات */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const sp = req.nextUrl.searchParams;

  const direction = sp.get("direction") || "";
  const status = sp.get("status") || "";
  const contractId = Number(sp.get("contractId") || 0);
  const q = (sp.get("q") || "").trim();

  const where: Prisma.ClaimWhereInput = {};
  if (direction === DIR_OUT || direction === DIR_IN) where.direction = direction;
  if (status) where.status = status;
  if (Number.isFinite(contractId) && contractId > 0) where.contractId = contractId;
  if (q) {
    where.OR = [
      { claimNumber: { contains: q } },
      { title: { contains: q } },
      { voucherRef: { contains: q } },
      { contract: { contractNumber: { contains: q } } },
      { contract: { contractName: { contains: q } } },
      { contract: { customer: { name: { contains: q } } } },
      { subContract: { subcontractor: { name: { contains: q } } } },
    ];
  }

  const rows = await db.claim.findMany({
    where,
    orderBy: { id: "desc" },
    include: {
      contract: {
        select: {
          id: true,
          contractNumber: true,
          contractName: true,
          customer: { select: { id: true, name: true } },
        },
      },
      subContract: { select: { id: true, subcontractor: { select: { id: true, name: true } } } },
      custLine: { select: { id: true, title: true, amount: true, dueDate: true } },
    },
  });

  const today = todayStr();
  const claims = rows.map((c) => ({
    id: c.id,
    claimNumber: c.claimNumber,
    direction: c.direction,
    directionLabel: CLAIM_DIRECTION_LABEL[c.direction] || c.direction,
    contractId: c.contractId,
    contract: {
      id: c.contract.id,
      contractNumber: c.contract.contractNumber,
      contractName: c.contract.contractName,
      customerName: c.contract.customer.name,
    },
    subContractId: c.subContractId,
    subcontractorName: c.subContract?.subcontractor.name || "",
    custLineId: c.custLineId,
    custLine: c.custLine
      ? { id: c.custLine.id, title: c.custLine.title, amount: Number(c.custLine.amount), dueDate: c.custLine.dueDate }
      : null,
    title: c.title,
    amount: Number(c.amount),
    dueDate: c.dueDate,
    voucherRef: c.voucherRef,
    status: c.status,
    statusLabel: CLAIM_STATUS_LABEL[c.status] || c.status,
    statusDisplay: CLAIM_STATUS_DISPLAY[c.status] || c.status,
    postponedUntil: c.postponedUntil,
    overdue: claimIsOverdue({ status: c.status, dueDate: c.dueDate }, today),
    notes: c.notes,
    createdAt: c.createdAt,
  }));

  // عدادات حسب الحالة + المجاميع (كالمصدر totals)
  const all = await db.claim.findMany({
    where: {
      ...(direction === DIR_OUT || direction === DIR_IN ? { direction } : {}),
      ...(Number.isFinite(contractId) && contractId > 0 ? { contractId } : {}),
    },
    select: { status: true, amount: true, dueDate: true },
  });
  const counters: Record<string, number> = {};
  let openAmount = 0;
  let doneAmount = 0;
  let overdueCount = 0;
  let overdueAmount = 0;
  for (const c of all) {
    counters[c.status] = (counters[c.status] || 0) + 1;
    const amt = Number(c.amount);
    if (c.status === "collected" || c.status === "paid") doneAmount = r3(doneAmount + amt);
    else if (c.status !== "refused" && c.status !== "cancelled") openAmount = r3(openAmount + amt);
    if (claimIsOverdue({ status: c.status, dueDate: c.dueDate }, today)) {
      overdueCount += 1;
      overdueAmount = r3(overdueAmount + amt);
    }
  }

  return ok({
    claims,
    counters,
    totals: { count: all.length, openAmount, doneAmount, overdueCount, overdueAmount },
  });
}

/**
 * تسجيل مطالبة جديدة (status=registered بترقيم CLM-#### عالمي):
 * out: مطالبتنا على العميل (custLineId اختياري بحد الدفعة) · in: مطالبة مقاول (عقد باطن إجباري).
 * voucherRef (سند قبض) اختياري — سقف المطالبة out بمبلغ السند.
 */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "action_claim_manage");
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const direction = String(body.direction || "").trim();
  if (direction !== DIR_OUT && direction !== DIR_IN) return jsonError("اتجاه المطالبة غير صحيح");
  const title = String(body.title || "").trim();
  if (!title) return jsonError("عنوان المطالبة مطلوب");
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return jsonError("مبلغ المطالبة يجب أن يكون أكبر من صفر");
  const contractId = Number(body.contractId || 0);
  if (!contractId) return jsonError("العقد مطلوب");
  const dueDate = body.dueDate ? parseDay(body.dueDate) : "";
  if (body.dueDate && !dueDate) return jsonError("تاريخ الاستحقاق غير صحيح");
  const notes = String(body.notes || "").trim();
  const voucherRef = String(body.voucherRef || "").trim();

  const contract = await db.contract.findUnique({ where: { id: contractId }, select: { id: true } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  let subContractId: number | null = null;
  let custLineId: number | null = null;

  if (direction === DIR_IN) {
    const sid = Number(body.subContractId || 0);
    if (!sid) return jsonError("مطالبة المقاول تتطلب عقد باطن");
    const sc = await db.subContract.findUnique({ where: { id: sid } });
    if (!sc) return jsonError("عقد الباطن غير موجود", 404);
    if (sc.contractId !== contractId) return jsonError("عقد الباطن لا يتبع هذا العقد");
    subContractId = sid;
  } else {
    const lid = Number(body.custLineId || 0);
    if (lid) {
      const line = await db.paymentPlanItem.findUnique({ where: { id: lid } });
      if (!line || line.contractId !== contractId) return jsonError("دفعة العميل لا تتبع هذا العقد");
      if (amount - Number(line.amount) > 0.001) return jsonError("مبلغ المطالبة يتجاوز مبلغ الدفعة المرتبطة");
      custLineId = lid;
    }
  }

  if (voucherRef) {
    const v = await db.voucher.findUnique({ where: { voucherNumber: voucherRef } });
    if (!v) return jsonError("السند المرتبط غير موجود", 404);
    if (direction === DIR_OUT && amount - Number(v.amount) > 0.001) {
      return jsonError("مبلغ المطالبة يتجاوز قيمة السند المرتبط");
    }
  }

  const created = await db.$transaction(async (tx) => {
    const claimNumber = await nextClaimNumber(tx);
    const row = await tx.claim.create({
      data: {
        claimNumber,
        direction,
        contractId,
        subContractId,
        custLineId,
        title,
        amount,
        dueDate,
        voucherRef,
        status: "registered",
        notes,
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "إنشاء",
      entityType: "claim",
      entityId: row.id,
      entityName: claimNumber,
      newStatus: "registered",
    });
    return row;
  });

  return ok(
    {
      claim: {
        id: created.id,
        claimNumber: created.claimNumber,
        direction: created.direction,
        directionLabel: CLAIM_DIRECTION_LABEL[created.direction],
        status: created.status,
        statusLabel: CLAIM_STATUS_LABEL[created.status],
        amount: Number(created.amount),
      },
    },
    201
  );
}
