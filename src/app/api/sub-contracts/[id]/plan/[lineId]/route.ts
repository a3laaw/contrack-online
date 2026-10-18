import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok, parseDay } from "@/lib/api-utils";
import { EPS, r3 } from "@/lib/contrack-core";

type P = { params: Promise<{ id: string; lineId: string }> };

/** تعديل خط دفعة باطن — ممنوع على المفعّل مرحليًا، مع سقف الخطة */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_payment");
  if ("response" in guard) return guard.response;
  const { id: idStr, lineId: lineIdStr } = await params;
  const subContractId = Number(idStr);
  const lineId = Number(lineIdStr);
  if (!Number.isFinite(subContractId) || !Number.isFinite(lineId)) return jsonError("معرف غير صالح");

  const sc = await db.subContract.findUnique({ where: { id: subContractId } });
  if (!sc) return jsonError("عقد الباطن غير موجود", 404);

  const line = await db.subPaymentPlanItem.findUnique({ where: { id: lineId }, include: { sources: true } });
  if (!line || line.subContractId !== subContractId) return jsonError("خط الدفعة غير موجود في هذا العقد الباطن", 404);
  if (line.triggeredAt) return jsonError("لا يمكن تعديل دفعة مفعّلة مرحليًا");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: { title?: string; amount?: number; dueDate?: string; notes?: string } = {};
  if (body.title !== undefined) {
    const title = String(body.title || "").trim();
    if (!title) return jsonError("عنوان الدفعة مطلوب");
    data.title = title;
  }
  if (body.amount !== undefined) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || !(amount > 0)) return jsonError("قيمة الدفعة يجب أن تكون أكبر من صفر");
    data.amount = amount;
  }
  if (body.dueDate !== undefined) {
    const dueDate = parseDay(body.dueDate);
    if (!dueDate) return jsonError("تاريخ الاستحقاق غير صالح");
    data.dueDate = dueDate;
  }
  if (body.notes !== undefined) data.notes = String(body.notes || "");

  // سقف الخطة بعد التعديل (باستثناء السطر نفسه)
  if (data.amount !== undefined) {
    const agg = await db.subPaymentPlanItem.aggregate({
      where: { subContractId, id: { not: lineId } },
      _sum: { amount: true },
    });
    const planSum = r3(Number(agg._sum.amount || 0));
    if (r3(planSum + data.amount) > r3(Number(sc.amount) + EPS)) {
      return jsonError("مجموع دفعات الباطن يتجاوز قيمة عقد الباطن");
    }
  }

  // استبدال المصادر إن قُدمت
  const sourceIds = Array.isArray(body.sources)
    ? [...new Set((body.sources as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))]
    : null;
  if (sourceIds && sourceIds.length > 0) {
    const found = await db.paymentPlanItem.findMany({ where: { id: { in: sourceIds }, contractId: sc.contractId }, select: { id: true } });
    if (found.length !== sourceIds.length) return jsonError("إحدى دفعات العميل المصدرية غير موجودة في هذا العقد");
  }

  await db.$transaction(async (tx) => {
    await tx.subPaymentPlanItem.update({ where: { id: lineId }, data });
    if (sourceIds) {
      await tx.subPaymentSource.deleteMany({ where: { subLineId: lineId } });
      if (sourceIds.length > 0) {
        await tx.subPaymentSource.createMany({
          data: sourceIds.map((custLineId) => ({ subLineId: lineId, custLineId })),
        });
      }
    }
    await audit(tx, {
      username: guard.user.username,
      action: "تعديل",
      entityType: "sub_payment_plan",
      entityId: lineId,
      entityName: data.title || line.title,
    });
  });

  return ok({ updated: true });
}

/** حذف خط دفعة باطن — ممنوع مع روابط صرف صريحة أو تفعيل مرحلي */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_payment");
  if ("response" in guard) return guard.response;
  const { id: idStr, lineId: lineIdStr } = await params;
  const subContractId = Number(idStr);
  const lineId = Number(lineIdStr);
  if (!Number.isFinite(subContractId) || !Number.isFinite(lineId)) return jsonError("معرف غير صالح");

  const sc = await db.subContract.findUnique({ where: { id: subContractId } });
  if (!sc) return jsonError("عقد الباطن غير موجود", 404);

  const line = await db.subPaymentPlanItem.findUnique({ where: { id: lineId } });
  if (!line || line.subContractId !== subContractId) return jsonError("خط الدفعة غير موجود في هذا العقد الباطن", 404);
  if (line.triggeredAt) return jsonError("لا يمكن حذف دفعة مفعّلة مرحليًا");

  const links = await db.voucherPaymentLink.count({
    where: { kind: "payment", lineId, voucher: { cancelled: false } },
  });
  if (links > 0) return jsonError("لا يمكن حذف دفعة مرتبطة بروابط سندات صرف صريحة");

  await db.$transaction(async (tx) => {
    await tx.subPaymentSource.deleteMany({ where: { subLineId: lineId } });
    await tx.subPaymentPlanItem.delete({ where: { id: lineId } });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف",
      entityType: "sub_payment_plan",
      entityId: lineId,
      entityName: line.title,
    });
  });

  return ok({ deleted: true });
}
