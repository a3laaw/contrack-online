import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok, parseDay } from "@/lib/api-utils";
import { EPS, r3 } from "@/lib/contrack-core";
import { loadContractCore } from "@/lib/contrack-server";

type P = { params: Promise<{ id: string; lineId: string }> };

/** تعديل دفعة (amount/تاريخ/عنوان/مرحلة) مع نفس سقف مجموع الخطة */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_payment");
  if ("response" in guard) return guard.response;
  const { id: idStr, lineId: lineIdStr } = await params;
  const contractId = Number(idStr);
  const lineId = Number(lineIdStr);
  if (!Number.isFinite(contractId) || !Number.isFinite(lineId)) return jsonError("معرف غير صالح");

  const core = await loadContractCore(contractId);
  if (!core) return jsonError("العقد غير موجود", 404);
  const line = await db.paymentPlanItem.findUnique({ where: { id: lineId } });
  if (!line || line.contractId !== contractId) return jsonError("الدفعة غير موجودة", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  let newAmount = Number(line.amount);

  if (body.title !== undefined) {
    const title = String(body.title).trim();
    if (!title) return jsonError("عنوان الدفعة مطلوب");
    data.title = title;
  }
  if (body.amount !== undefined) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || !(amount > 0)) return jsonError("قيمة الدفعة يجب أن تكون أكبر من صفر");
    data.amount = amount;
    newAmount = amount;
  }
  if (body.dueDate !== undefined) {
    const d = parseDay(body.dueDate);
    if (!d) return jsonError("تاريخ استحقاق غير صالح");
    data.dueDate = d;
  }
  if (body.notes !== undefined) data.notes = String(body.notes || "");
  if (body.stageId !== undefined) {
    if (body.stageId === null || body.stageId === "") {
      data.stageId = null;
    } else {
      const sid = Number(body.stageId);
      const st = await db.contractStage.findUnique({ where: { id: sid } });
      if (!st || st.contractId !== contractId) return jsonError("المرحلة غير موجودة في هذا العقد");
      data.stageId = sid;
    }
  }

  // السقف بعد استثناء الدفعة نفسها
  const agg = await db.paymentPlanItem.aggregate({
    where: { contractId, id: { not: lineId } },
    _sum: { amount: true },
  });
  const othersSum = Number(agg._sum.amount || 0);
  if (r3(othersSum + newAmount) > r3(core.current + EPS)) {
    return jsonError("مجموع الدفعات يتجاوز القيمة الحالية");
  }

  await db.$transaction(async (tx) => {
    await tx.paymentPlanItem.update({ where: { id: lineId }, data });
    await tx.contractEvent.create({
      data: {
        contractId,
        eventType: "تعديل دفعة",
        description: `تعديل دفعة «${data.title ?? line.title}» إلى ${newAmount}`,
        username: guard.user.username,
      },
    });
  });
  return ok({ message: "تم تعديل الدفعة" });
}

/** حذف دفعة — ممنوع إن كانت مغطاة بروابط صريحة أو مرتبطة بمطالبة */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_payment");
  if ("response" in guard) return guard.response;
  const { id: idStr, lineId: lineIdStr } = await params;
  const contractId = Number(idStr);
  const lineId = Number(lineIdStr);
  if (!Number.isFinite(contractId) || !Number.isFinite(lineId)) return jsonError("معرف غير صالح");

  const line = await db.paymentPlanItem.findUnique({ where: { id: lineId } });
  if (!line || line.contractId !== contractId) return jsonError("الدفعة غير موجودة", 404);

  const link = await db.voucherPaymentLink.findFirst({
    where: { lineId, kind: "receipt" },
    select: { id: true },
  });
  if (link) return jsonError("لا يمكن حذف دفعة مرتبطة بسند قبض");

  const claim = await db.claim.findFirst({ where: { custLineId: lineId }, select: { id: true } });
  if (claim) return jsonError("لا يمكن حذف دفعة مرتبطة بمطالبة");

  await db.$transaction(async (tx) => {
    await tx.paymentPlanItem.delete({ where: { id: lineId } });
    await tx.contractEvent.create({
      data: {
        contractId,
        eventType: "حذف دفعة",
        description: `حُذفت دفعة «${line.title}» بمبلغ ${Number(line.amount)}`,
        username: guard.user.username,
      },
    });
  });
  return ok({ message: "تم حذف الدفعة" });
}
