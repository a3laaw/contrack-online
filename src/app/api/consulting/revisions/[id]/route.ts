import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay, todayStr } from "@/lib/api-utils";
import {
  canDecide,
  canDelete,
  canEdit,
  REVISION_APPROVED,
  validateDecision,
  validateRevisionInput,
} from "@/lib/consulting-revision-core";

/**
 * دورة مراجعة واحدة (docs/revisions-ipc-design.md §1.3):
 * PATCH: تعديل بيانات قبل الحسم — أو القرار (decision: مقبول|معاد بتعديلات)
 *        القرار نهائي (G7) وملاحظة الإرجاع إلزامية — مع حدث عقد وتدقيق
 * DELETE: حذف دورة قيد المراجعة فقط — المحسوم تاريخ لا يُمس
 */

type P = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");
  const row = await db.consultingRevision.findUnique({
    where: { id },
    select: {
      id: true, contractId: true, title: true, revNo: true, status: true,
      contract: { select: { contractNumber: true } },
    },
  });
  if (!row) return jsonError("دورة المراجعة غير موجودة", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // ===== مسار القرار — نهائي بلا رجعة (نمط إجازات المهندسين) =====
  if (body.decision !== undefined) {
    if (!canDecide(row.status)) {
      return jsonError("القرار حُسم مسبقًا لهذا الإصدار — الدورات المحسومة تاريخ لا تتغير", 400);
    }
    const decision = validateDecision({ decision: body.decision, note: body.note });
    if (!decision.ok) return jsonError(decision.error);
    const updated = await db.$transaction(async (tx) => {
      const out = await tx.consultingRevision.update({
        where: { id: row.id },
        data: {
          status: decision.value.decision,
          decidedAt: todayStr(),
          decidedBy: guard.user.username,
          decisionNote: decision.value.note,
        },
      });
      await tx.contractEvent.create({
        data: {
          contractId: row.contractId,
          eventType: decision.value.decision === REVISION_APPROVED ? "اعتماد مراجعة مخطط" : "إرجاع مراجعة مخطط",
          description:
            decision.value.decision === REVISION_APPROVED
              ? `اعتُمد الإصدار V${row.revNo} من «${row.title}» — العقد ${row.contract.contractNumber}`
              : `أُعيد الإصدار V${row.revNo} من «${row.title}» بتعديلات: ${decision.value.note}`,
          username: guard.user.username,
        },
      });
      await audit(tx, {
        username: guard.user.username,
        action: "تعديل",
        entityType: "consulting_revision",
        entityId: row.id,
        entityName: `${row.title} V${row.revNo} → ${decision.value.decision}`,
      });
      return out;
    });
    return ok({ revision: { id: updated.id, status: updated.status, decidedAt: updated.decidedAt } });
  }

  // ===== مسار التعديل — قبل الحسم فقط =====
  if (!canEdit(row.status)) {
    return jsonError("لا يمكن تعديل إصدار حُسم قراره — أنشئ إصدارًا جديدًا لنفس المخطط", 400);
  }
  const input = validateRevisionInput(body);
  if (!input.ok) return jsonError(input.error);
  if (input.value.engineerId) {
    const eng = await db.engineer.findUnique({ where: { id: input.value.engineerId }, select: { id: true } });
    if (!eng) return jsonError("المهندس غير موجود", 404);
  }
  const submittedAt = parseDay(input.value.submittedAt) || "";
  const updated = await db.$transaction(async (tx) => {
    const out = await tx.consultingRevision.update({
      where: { id: row.id },
      data: {
        title: input.value.title,
        engineerId: input.value.engineerId,
        ...(submittedAt ? { submittedAt } : {}),
        notes: input.value.notes,
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "تعديل",
      entityType: "consulting_revision",
      entityId: row.id,
      entityName: `${input.value.title} V${row.revNo}`,
    });
    return out;
  });
  return ok({ revision: { id: updated.id, title: updated.title } });
}

export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");
  const row = await db.consultingRevision.findUnique({
    where: { id },
    select: { id: true, contractId: true, title: true, revNo: true, status: true },
  });
  if (!row) return jsonError("دورة المراجعة غير موجودة", 404);
  if (!canDelete(row.status)) {
    return jsonError("الإصدار المحسوم تاريخ — لا يُحذف؛ سجل إصدارًا جديدًا لنفس المخطط", 400);
  }
  await db.$transaction(async (tx) => {
    await tx.consultingRevision.delete({ where: { id: row.id } });
    await tx.contractEvent.create({
      data: {
        contractId: row.contractId,
        eventType: "حذف مراجعة مخطط",
        description: `حُذف الإصدار V${row.revNo} من «${row.title}» وهو قيد المراجعة`,
        username: guard.user.username,
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف",
      entityType: "consulting_revision",
      entityId: row.id,
      entityName: `${row.title} V${row.revNo}`,
    });
  });
  return ok({ deleted: true });
}
