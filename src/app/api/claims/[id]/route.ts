import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok, parseDay, todayStr } from "@/lib/api-utils";
import {
  CLAIM_DIRECTION_LABEL,
  CLAIM_FINAL_STATUSES,
  CLAIM_NEXT,
  CLAIM_STATUS_DISPLAY,
  CLAIM_STATUS_LABEL,
  claimIsOverdue,
} from "@/lib/claim-server";

type P = { params: Promise<{ id: string }> };

/** تفاصيل المطالبة بمصادرها (العقد/العميل/المقاول/الدفعة) والانتقالات المسموحة */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const c = await db.claim.findUnique({
    where: { id },
    include: {
      contract: {
        select: {
          id: true,
          contractNumber: true,
          contractName: true,
          status: true,
          customer: { select: { id: true, name: true, phone: true } },
        },
      },
      subContract: {
        select: { id: true, amount: true, status: true, subcontractor: { select: { id: true, name: true } } },
      },
      custLine: { select: { id: true, title: true, amount: true, dueDate: true, triggeredAt: true } },
    },
  });
  if (!c) return jsonError("المطالبة غير موجودة", 404);

  const today = todayStr();
  return ok({
    claim: {
      id: c.id,
      claimNumber: c.claimNumber,
      direction: c.direction,
      directionLabel: CLAIM_DIRECTION_LABEL[c.direction] || c.direction,
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
      contract: {
        id: c.contract.id,
        contractNumber: c.contract.contractNumber,
        contractName: c.contract.contractName,
        status: c.contract.status,
        customer: c.contract.customer,
      },
      subContract: c.subContract
        ? {
            id: c.subContract.id,
            amount: Number(c.subContract.amount),
            status: c.subContract.status,
            subcontractorName: c.subContract.subcontractor.name,
          }
        : null,
      custLine: c.custLine
        ? {
            id: c.custLine.id,
            title: c.custLine.title,
            amount: Number(c.custLine.amount),
            dueDate: c.custLine.dueDate,
            triggeredAt: c.custLine.triggeredAt,
          }
        : null,
      nextStatuses: (CLAIM_NEXT[c.direction]?.[c.status] || []).map((s) => ({
        value: s,
        label: CLAIM_STATUS_LABEL[s] || s,
      })),
    },
  });
}

/** تعديل المطالبة غير النهائية: title/amount/dueDate/notes (النهائية لا تُعدَّل — كالمصدر) */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_claim_manage");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const c = await db.claim.findUnique({ where: { id } });
  if (!c) return jsonError("المطالبة غير موجودة", 404);
  if (CLAIM_FINAL_STATUSES.includes(c.status)) {
    return jsonError("المطالبة النهائية لا تُعدَّل — سجّل مطالبة جديدة");
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};

  if (body.title !== undefined) {
    const title = String(body.title).trim();
    if (!title) return jsonError("عنوان المطالبة مطلوب");
    data.title = title;
  }
  if (body.amount !== undefined) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return jsonError("مبلغ المطالبة يجب أن يكون أكبر من صفر");
    // سقف المبلغ بسطر الدفعة المرتبطة (كالمصدر)
    let cap: number | null = null;
    if (c.custLineId) {
      const line = await db.paymentPlanItem.findUnique({ where: { id: c.custLineId } });
      cap = line ? Number(line.amount) : null;
    } else if (c.subLineId) {
      const line = await db.subPaymentPlanItem.findUnique({ where: { id: c.subLineId } });
      cap = line ? Number(line.amount) : null;
    }
    if (cap !== null && amount - cap > 0.001) return jsonError("مبلغ المطالبة يتجاوز مبلغ الدفعة المرتبطة");
    data.amount = amount;
  }
  if (body.dueDate !== undefined) {
    if (!body.dueDate) {
      data.dueDate = "";
    } else {
      const d = parseDay(body.dueDate);
      if (!d) return jsonError("تاريخ الاستحقاق غير صحيح");
      data.dueDate = d;
    }
  }
  if (body.voucherRef !== undefined) {
    data.voucherRef = String(body.voucherRef).trim();
  }
  if (body.notes !== undefined) {
    data.notes = String(body.notes).trim();
  }

  if (!Object.keys(data).length) return ok({ claim: { id: c.id, status: c.status } });

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.claim.update({ where: { id }, data });
    await audit(tx, {
      username: guard.user.username,
      action: "تعديل",
      entityType: "claim",
      entityId: id,
      entityName: c.claimNumber,
    });
    return row;
  });

  return ok({
    claim: {
      id: updated.id,
      claimNumber: updated.claimNumber,
      status: updated.status,
      title: updated.title,
      amount: Number(updated.amount),
      dueDate: updated.dueDate,
    },
  });
}

/** إلغاء المطالبة — ممنوع إلغاء المحصّلة/المدفوعة (الأثر المالي الوحيد للمطالبات) */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_claim_manage");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const c = await db.claim.findUnique({ where: { id } });
  if (!c) return jsonError("المطالبة غير موجودة", 404);
  if (c.status === "collected" || c.status === "paid") {
    return jsonError(c.status === "collected" ? "لا يمكن إلغاء مطالبة محصّلة" : "لا يمكن إلغاء مطالبة مدفوعة");
  }
  if (c.status === "cancelled") return jsonError("المطالبة ملغاة مسبقًا");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = String(body.reason || "").trim();
  if (!reason) return jsonError("سبب الإلغاء مطلوب");

  const today = todayStr();
  const entry = `[${today}] إلغاء المطالبة بواسطة ${guard.user.fullName || guard.user.username} — ${reason}`;
  const notes = ((c.notes || "").trim() + "\n" + entry).trim();

  await db.$transaction(async (tx) => {
    await tx.claim.update({ where: { id }, data: { status: "cancelled", notes, postponedUntil: "" } });
    await audit(tx, {
      username: guard.user.username,
      action: "إلغاء",
      entityType: "claim",
      entityId: id,
      entityName: c.claimNumber,
      oldStatus: c.status,
      newStatus: "cancelled",
      reason,
    });
  });

  return ok({ cancelled: true, id, claimNumber: c.claimNumber, status: "cancelled" });
}
