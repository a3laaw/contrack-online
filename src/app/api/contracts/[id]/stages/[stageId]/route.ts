import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok, parseDay, todayStr } from "@/lib/api-utils";
import { triggerDuePayments } from "@/lib/contrack-server";

type P = { params: Promise<{ id: string; stageId: string }> };

/**
 * تحديث مرحلة:
 * - بداية/نهاية؛ إنهاء (endDate=today أو تاريخ) يستدعي triggerDuePayments.
 * - تخطي isSkipped+closedBy ⇒ «غير مستحقة لأن المرحلة المرتبطة تم تخطيها».
 * - إعادة فتح (مسح endDate) ⇒ تصفير triggeredAt لسطور المرحلة المُثيرة وnotes=''.
 */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_stage_advance");
  if ("response" in guard) return guard.response;
  const { id: idStr, stageId: stageIdStr } = await params;
  const contractId = Number(idStr);
  const stageId = Number(stageIdStr);
  if (!Number.isFinite(contractId) || !Number.isFinite(stageId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return jsonError("العقد غير موجود", 404);
  const stage = await db.contractStage.findUnique({ where: { id: stageId } });
  if (!stage || stage.contractId !== contractId) return jsonError("المرحلة غير موجودة", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return jsonError("اسم المرحلة مطلوب");
    data.name = name;
  }
  if (body.level !== undefined) data.level = Math.trunc(Number(body.level) || 1);
  if (body.parentName !== undefined) data.parentName = String(body.parentName || "");
  if (body.expectedDays !== undefined) data.expectedDays = Math.trunc(Number(body.expectedDays) || 0);
  if (body.payPct !== undefined) data.payPct = Number(body.payPct) || 0;
  if (body.payKind !== undefined) data.payKind = String(body.payKind || "");
  if (body.sortOrder !== undefined) data.sortOrder = Math.trunc(Number(body.sortOrder) || 0);
  if (body.startDate !== undefined) {
    const d = parseDay(body.startDate);
    if (!d) return jsonError("تاريخ بداية المرحلة غير صالح");
    data.startDate = d;
  }

  let finishDate = "";
  let reopened = false;
  if (body.endDate !== undefined) {
    if (body.endDate === null || body.endDate === "") {
      data.endDate = "";
      data.closedBy = "";
      reopened = true;
    } else {
      const d = parseDay(body.endDate) || (body.endDate === "today" ? todayStr() : "");
      if (!d) return jsonError("تاريخ إنهاء المرحلة غير صالح");
      data.endDate = d;
      data.closedBy = guard.user.username;
      finishDate = d;
    }
  }

  let skipping = false;
  let unskipping = false;
  if (body.isSkipped !== undefined) {
    if (Boolean(body.isSkipped)) {
      data.isSkipped = true;
      data.closedBy = guard.user.username;
      skipping = true;
    } else {
      data.isSkipped = false;
      data.closedBy = "";
      unskipping = true;
    }
  }

  if (Object.keys(data).length === 0) return jsonError("لا توجد بيانات للتعديل");

  await db.$transaction(async (tx) => {
    await tx.contractStage.update({ where: { id: stageId }, data });

    if (skipping) {
      await tx.paymentPlanItem.updateMany({
        where: { contractId, stageId, triggeredAt: "" },
        data: { notes: "غير مستحقة لأن المرحلة المرتبطة تم تخطيها" },
      });
      await tx.contractEvent.create({
        data: {
          contractId,
          eventType: "تخطي مرحلة",
          description: `تم تخطي مرحلة «${stage.name}»`,
          username: guard.user.username,
        },
      });
    }
    if (unskipping) {
      await tx.paymentPlanItem.updateMany({
        where: { contractId, stageId, triggeredAt: "" },
        data: { notes: "" },
      });
      await tx.contractEvent.create({
        data: {
          contractId,
          eventType: "إرجاع مرحلة",
          description: `تم إرجاع مرحلة «${stage.name}» من التخطي`,
          username: guard.user.username,
        },
      });
    }
    if (finishDate) {
      await triggerDuePayments(contractId, stageId, finishDate, tx);
      await tx.contractEvent.create({
        data: {
          contractId,
          eventType: "إنهاء مرحلة",
          description: `أُنهيت مرحلة «${stage.name}» بتاريخ ${finishDate}`,
          username: guard.user.username,
        },
      });
    }
    if (reopened) {
      await tx.paymentPlanItem.updateMany({
        where: { contractId, stageId, triggeredAt: { not: "" } },
        data: { triggeredAt: "", notes: "" },
      });
      await tx.contractEvent.create({
        data: {
          contractId,
          eventType: "إعادة فتح مرحلة",
          description: `أُعيد فتح مرحلة «${stage.name}»`,
          username: guard.user.username,
        },
      });
    }
  });

  return ok({ message: "تم تحديث المرحلة" });
}
