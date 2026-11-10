import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { validateExecutionInput } from "@/lib/field-execution-core";
import { quantumForStage } from "@/lib/stage-quantum-server";

type P = { params: Promise<{ id: string }> };

/** خطأ تحقق محلي برمز حالة — نمط AddendumError في addendum-server */
class ExecutionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** تحقق مرفق الصورة — يخص نفس العقد وإلا خطأ (مرفق واحد لكل سجل — تصميم §3) */
async function resolveAttachmentId(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  raw: unknown,
  contractId: number
): Promise<number | null> {
  if (raw === undefined || raw === null || raw === "" || Number(raw) === 0) return null;
  const id = Number(raw) || 0;
  const att = await tx.contractAttachment.findFirst({ where: { id, contractId } });
  if (!att) throw new ExecutionError("المرفق غير موجود في هذا العقد");
  return id;
}

/** تسجيل تنفيذ ميداني — يغذي عدادات المقايسة المشتقة لحظيًا (G9) */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findFirst({ where: { id: contractId } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const boqItemId = Number(body.boqItemId) || 0;
  if (!boqItemId) return jsonError("بند الكميات مطلوب");

  const check = validateExecutionInput(body);
  if (!check.ok || !check.value) return jsonError(check.error || "إدخال غير صالح");
  const v = check.value; // قصّة ثابتة خارج المعاملة — تضييق النمط يضيع داخل الـcallback

  try {
    const row = await db.$transaction(async (tx) => {
      const item = await tx.boqItem.findFirst({ where: { id: boqItemId, contractId, deleted: false } });
      if (!item) throw new ExecutionError("بند الكميات غير موجود في هذا العقد");
      const attachmentId = await resolveAttachmentId(tx, body.attachmentId, contractId);
      // الحالة الكمّية للمرحلة قبل/بعد الإنشاء (بند NOVA 6 — تصميم §3):
      // becameComplete تُحسب من قبل القاعدة نفسها — بلا افتراضات في العميل
      const stageId = item.stageId;
      const before = stageId ? await quantumForStage(contractId, stageId, tx) : null;
      const created = await tx.fieldExecution.create({
        data: {
          contractId,
          boqItemId,
          executionDate: v.executionDate,
          qty: v.qty,
          documented: Boolean(body.documented),
          gpsLat: v.gpsLat,
          gpsLng: v.gpsLng,
          attachmentId,
          note: v.note,
          createdBy: guard.user.username,
        },
      });
      const after = stageId ? await quantumForStage(contractId, stageId, tx) : null;
      await tx.contractEvent.create({
        data: {
          contractId,
          eventType: "تنفيذ ميداني",
          description: `تسجيل تنفيذ «${item.description}» — ${v.qty} ${item.unit || ""} بتاريخ ${v.executionDate}${created.documented ? " (موثق)" : ""}${after?.complete && !before?.complete ? " — المرحلة اكتملت كمّيًا" : ""}`,
          username: guard.user.username,
        },
      });
      await audit(tx, {
        username: guard.user.username,
        action: "تسجيل",
        entityType: "field_execution",
        entityId: created.id,
        entityName: item.description,
      });
      return { created, before, after };
    });
    return ok(
      {
        execution: { ...row.created, qty: Number(row.created.qty) },
        stageQuantum: row.after,
        becameComplete: Boolean(row.after?.complete && !row.before?.complete),
      },
      201
    );
  } catch (e) {
    if (e instanceof ExecutionError) return jsonError(e.message, e.status);
    throw e;
  }
}

/** تعديل سجل تنفيذ — ?executionId= — الحقول القابلة للتعديل تُدمج مع الموجود وتتحقق مجددًا */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  const executionId = Number(req.nextUrl.searchParams.get("executionId") || 0);
  if (!Number.isFinite(contractId) || !executionId) return jsonError("معرف غير صالح");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    const row = await db.$transaction(async (tx) => {
      const row = await tx.fieldExecution.findFirst({
        where: { id: executionId, contractId },
        include: { boqItem: { select: { description: true, unit: true } } },
      });
      if (!row) throw new ExecutionError("سجل التنفيذ غير موجود في هذا العقد", 404);

      const check = validateExecutionInput({
        executionDate: body.executionDate !== undefined ? body.executionDate : row.executionDate,
        qty: body.qty !== undefined ? body.qty : Number(row.qty),
        gpsLat: body.gpsLat !== undefined ? body.gpsLat : row.gpsLat,
        gpsLng: body.gpsLng !== undefined ? body.gpsLng : row.gpsLng,
        note: body.note !== undefined ? body.note : row.note,
      });
      if (!check.ok || !check.value) throw new ExecutionError(check.error || "إدخال غير صالح");

      const data: Record<string, unknown> = {
        executionDate: check.value.executionDate,
        qty: check.value.qty,
        gpsLat: check.value.gpsLat,
        gpsLng: check.value.gpsLng,
        note: check.value.note,
      };
      if (body.documented !== undefined) data.documented = Boolean(body.documented);
      if (body.attachmentId !== undefined) {
        data.attachmentId = await resolveAttachmentId(tx, body.attachmentId, contractId);
      }

      const updated = await tx.fieldExecution.update({ where: { id: row.id }, data });
      // الحالة الكمّية بعد التعديل — بنفس مصدر البوابة (NOVA 6)
      const stageId = (await tx.boqItem.findFirst({ where: { id: row.boqItemId }, select: { stageId: true } }))?.stageId;
      const quantum = stageId ? await quantumForStage(contractId, stageId, tx) : null;
      await tx.contractEvent.create({
        data: {
          contractId,
          eventType: "تعديل تنفيذ ميداني",
          description: `تعديل تنفيذ «${row.boqItem.description}» — ${check.value.qty} ${row.boqItem.unit || ""} بتاريخ ${check.value.executionDate}`,
          username: guard.user.username,
        },
      });
      await audit(tx, {
        username: guard.user.username,
        action: "تعديل",
        entityType: "field_execution",
        entityId: row.id,
        entityName: row.boqItem.description,
      });
      return { updated, quantum };
    });
    return ok({ execution: { ...row.updated, qty: Number(row.updated.qty) }, stageQuantum: row.quantum });
  } catch (e) {
    if (e instanceof ExecutionError) return jsonError(e.message, e.status);
    throw e;
  }
}

/** حذف سجل تنفيذ — ?executionId= — آمن دائمًا: العدادات تُشتق من الصفوف لحظيًا (G9) */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  const executionId = Number(req.nextUrl.searchParams.get("executionId") || 0);
  if (!Number.isFinite(contractId) || !executionId) return jsonError("معرف غير صالح");

  try {
    const quantum = await db.$transaction(async (tx) => {
      const row = await tx.fieldExecution.findFirst({
        where: { id: executionId, contractId },
        include: { boqItem: { select: { description: true, unit: true, stageId: true } } },
      });
      if (!row) throw new ExecutionError("سجل التنفيذ غير موجود في هذا العقد", 404);
      await tx.fieldExecution.delete({ where: { id: row.id } });
      // الحالة الكمّية بعد الحذف — العدادات مشتقة فورًا (G9)
      const q = row.boqItem.stageId ? await quantumForStage(contractId, row.boqItem.stageId, tx) : null;
      await tx.contractEvent.create({
        data: {
          contractId,
          eventType: "حذف تنفيذ ميداني",
          description: `حذف تنفيذ ميداني — ${row.boqItem.description} (${Number(row.qty)} ${row.boqItem.unit || ""})`,
          username: guard.user.username,
        },
      });
      await audit(tx, {
        username: guard.user.username,
        action: "حذف",
        entityType: "field_execution",
        entityId: row.id,
        entityName: row.boqItem.description,
      });
      return q;
    });
    return ok({ deleted: true, stageQuantum: quantum });
  } catch (e) {
    if (e instanceof ExecutionError) return jsonError(e.message, e.status);
    throw e;
  }
}
