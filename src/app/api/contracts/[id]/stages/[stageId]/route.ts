import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, ok, parseDay, todayStr } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import { triggerDuePayments } from "@/lib/contrack-server";
import { NOTIF_STAGE, notifyTransaction } from "@/lib/notification-server";
import { autoAddParticipant, TX_CONTRACT } from "@/lib/participants-server";

type P = { params: Promise<{ id: string; stageId: string }> };

/** الحالات المجمّدة — لا تغيير مراحل عليها (تجميد المكتبي للعقد الملغى/المغلق) */
const FROZEN_STATUSES = ["ملغى", "مغلق"];

/**
 * تحديث مرحلة:
 * - بداية/نهاية؛ إنهاء (endDate=today أو تاريخ) يستدعي triggerDuePayments.
 * - تخطي isSkipped+closedBy ⇒ «غير مستحقة لأن المرحلة المرتبطة تم تخطيها».
 * - إعادة فتح (مسح endDate) ⇒ تصفير triggeredAt لسطور المرحلة المُثيرة وnotes=''.
 * - تراجع مرحلة (action=revert — مدير): إرجاع العقد للمرحلة المكتملة السابقة
 *   مع عكس الاستحقاق التلقائي غير المصدر له سند (نفس منطق إعادة الفتح).
 * - طابع إشراف (action=supervision — مدير): ضبط أعمدة الإشراف على المرحلة.
 */
export async function PATCH(req: NextRequest, { params }: P) {
  const bodyRaw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof bodyRaw.action === "string" ? bodyRaw.action : "";

  const guard =
    action === "revert" || action === "supervision"
      ? await adminGuard(req)
      : await authGuard(req, "action_stage_advance");
  if ("response" in guard) return guard.response;

  const { id: idStr, stageId: stageIdStr } = await params;
  const contractId = Number(idStr);
  const stageId = Number(stageIdStr);
  if (!Number.isFinite(contractId) || !Number.isFinite(stageId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return jsonError("العقد غير موجود", 404);
  const stage = await db.contractStage.findUnique({ where: { id: stageId } });
  if (!stage || stage.contractId !== contractId) return jsonError("المرحلة غير موجودة", 404);

  // ===== تراجع مرحلة (مدير) — followup.py:1330 _revert_stage + workflow_service.revert_contract_stage =====
  if (action === "revert") {
    if (FROZEN_STATUSES.includes(contract.status)) {
      return jsonError("العقد مجمّد (ملغى/مغلق) — لا يمكن تغيير مراحله");
    }
    const reason = String(bodyRaw.reason || "").trim();
    const stages = await db.contractStage.findMany({
      where: { contractId },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    // المرحلة المكتملة غير المتخطاة الأعلى ترتيبًا قبل المرحلة المعطاة
    let target: (typeof stages)[number] | null = null;
    for (const s of stages) {
      if (s.id === stage.id) break;
      if (s.endDate && !s.isSkipped) target = s;
    }
    if (!target) return jsonError("لا توجد مرحلة مكتملة للتراجع عنها.");

    await db.$transaction(async (tx) => {
      // إعادة فتح W: مسح endDate/closedBy مع إبقاء startDate — وتصفير استحقاقاتها التلقائية غير المصدر لها سند
      await tx.contractStage.update({
        where: { id: target.id },
        data: { endDate: "", closedBy: "" },
      });
      await tx.paymentPlanItem.updateMany({
        where: { contractId, stageId: target.id, triggeredAt: { not: "" } },
        data: { triggeredAt: "", notes: "" },
      });
      // المرحلة الحالية المعطاة: مسح بدايتها/نهايتها إن وُجدت
      const xData: Record<string, string> = {};
      if (stage.startDate) xData.startDate = "";
      if (stage.endDate) {
        xData.endDate = "";
        xData.closedBy = "";
      }
      if (Object.keys(xData).length > 0) {
        await tx.contractStage.update({ where: { id: stage.id }, data: xData });
      }
      await tx.contractEvent.create({
        data: {
          contractId,
          eventType: "إرجاع مرحلة",
          description: `تم التراجع من «${stage.name}» إلى «${target.name}»${reason ? ` · ${reason}` : ""}`,
          username: guard.user.username,
        },
      });
      await audit(tx, {
        username: guard.user.username,
        action: "تراجع مرحلة",
        entityType: "contract",
        entityId: contractId,
        entityName: contract.contractNumber,
        reason,
      });
    });

  // G3 — إشعار تراجع المرحلة (المدير المنفِّذ مستبعد)
  try {
    await notifyTransaction({
      transactionType: "contract",
      transactionId: contractId,
      type: NOTIF_STAGE,
      text: `${guard.user.fullName || guard.user.username} أرجع العقد ${contract.contractNumber} من «${stage.name}» إلى «${target.name}»`,
      excludeUserId: guard.user.id,
    });
  } catch {
    /* الإشعار لا يعطل العملية */
  }

    return ok({ from: stage.name, to: target.name });
  }

  // ===== طابع إشراف المرحلة (مدير) — followup.py:223 StageSupervisionDialog =====
  if (action === "supervision") {
    if (FROZEN_STATUSES.includes(contract.status)) {
      return jsonError("العقد مجمّد (ملغى/مغلق) — لا يمكن تغيير طابعه الإشرافي");
    }
    const data: Record<string, unknown> = {};
    const changes: string[] = [];
    if (bodyRaw.isSupervision !== undefined) {
      const flag = Boolean(bodyRaw.isSupervision);
      if (flag !== stage.isSupervision) {
        changes.push(flag ? "تفعيل الطابع الإشرافي" : "إزالة الطابع الإشرافي");
      }
      data.isSupervision = flag;
    }
    const dateFields = [
      ["supEnd", "النهاية المخططة"],
      ["supStart", "تاريخ البداية"],
      ["supActualEnd", "تاريخ الإنهاء"],
    ] as const;
    for (const [key, label] of dateFields) {
      if (bodyRaw[key] !== undefined) {
        const d = String(bodyRaw[key] ?? "").trim();
        if (d && !parseDay(d)) return jsonError(`تاريخ غير صالح: ${label}`);
        if (d !== stage[key]) changes.push(`${label} ${d || "مُسحت"}`);
        data[key] = d;
      }
    }
    if (bodyRaw.supMonthly !== undefined) {
      const n = Number(bodyRaw.supMonthly);
      if (!Number.isFinite(n) || n < 0) return jsonError("قيمة الشهر غير صالحة");
      const v = r3(n);
      if (v !== Number(stage.supMonthly)) changes.push(`قيمة الشهر ${v} د.ك`);
      data.supMonthly = v;
    }
    if (Object.keys(data).length === 0) return jsonError("لا توجد بيانات للتعديل");

    const updated = await db.$transaction(async (tx) => {
      const st = await tx.contractStage.update({ where: { id: stageId }, data });
      await tx.contractEvent.create({
        data: {
          contractId,
          eventType: "تعديل طابع الإشراف",
          description: `طابع إشراف «${stage.name}»${changes.length ? `: ${changes.join(" · ")}` : " (بلا تغيير قيم)"}`,
          username: guard.user.username,
        },
      });
      return st;
    });

    return ok({
      isSupervision: updated.isSupervision,
      supStart: updated.supStart,
      supEnd: updated.supEnd,
      supActualEnd: updated.supActualEnd,
      supMonthly: Number(updated.supMonthly),
    });
  }

  // ===== الإجراءات الأصلية (بدء/إنهاء/تخطي/إعادة فتح/تعديل بيانات) =====
  const body = bodyRaw;
  const data: Record<string, unknown> = {};
  // G2 — تفاعل مع العقد يجعل المنفِّذ مشاركًا (المكتبي auto_add_participant في move_to_stage)
  await autoAddParticipant(guard.user.id, TX_CONTRACT, contractId);
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

  // G3 — إشعار بدء/إنهاء مرحلة العقد (المنفِّذ مستبعد) — المكتبي move_to_stage/إنهاء مرحلة
  try {
    const who = guard.user.fullName || guard.user.username;
    let notifText = "";
    if (finishDate) {
      notifText = `${who} أنهى مرحلة «${stage.name}» في العقد ${contract.contractNumber}`;
    } else if (typeof data.startDate === "string" && data.startDate && !stage.startDate) {
      notifText = `${who} نقل العقد ${contract.contractNumber} إلى مرحلة «${stage.name}»`;
    }
    if (notifText) {
      await notifyTransaction({
        transactionType: "contract",
        transactionId: contractId,
        type: NOTIF_STAGE,
        text: notifText,
        excludeUserId: guard.user.id,
      });
    }
  } catch {
    /* الإشعار لا يعطل العملية */
  }

  return ok({ message: "تم تحديث المرحلة" });
}
