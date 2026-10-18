import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok, todayStr } from "@/lib/api-utils";

type P = { params: Promise<{ id: string }> };

const DUE_AT_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const TASK_TYPES = ["تذكير", "موعد"] as const;

/** الطابع الزمني الحرفي للمصدر: YYYY-MM-DD HH:mm */
function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function validDueAt(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!DUE_AT_RE.test(s)) return "";
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? "" : s;
}

/**
 * تعديل مهمة:
 * - إجراءات: {action:'complete'} ⇒ منجزة + doneAt، {action:'reopen'} ⇒ مفتوحة + تصفير أعلام التنبيه،
 *   {action:'notified', stage:'before'|'after'} ⇒ تعليم محرك التذكير (مرة واحدة لكل مرحلة).
 * - تعديل الحقول (title/details/dueAt/remindMinutes/taskType/customerId/contractId) —
 *   تعديل الموعد أو التذكير يصفّر أعلام التنبيه كالمصدر (task_service.py:127–130).
 */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_tasks");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const task = await db.task.findUnique({ where: { id } });
  if (!task) return jsonError("المهمة غير موجودة", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "").trim();

  // ===== إجراء الإتمام =====
  if (action === "complete") {
    await db.$transaction(async (tx) => {
      await tx.task.update({ where: { id }, data: { status: "منجزة", doneAt: nowStamp() } });
      await audit(tx, {
        username: guard.user.username,
        action: "إكمال",
        entityType: "task",
        entityId: id,
        entityName: task.title,
        oldStatus: "مفتوحة",
        newStatus: "منجزة",
      });
    });
    return ok({ updated: true, status: "منجزة" });
  }

  // ===== إجراء إعادة الفتح (يصفّر أعلام التنبيه كالمصدر) =====
  if (action === "reopen") {
    await db.$transaction(async (tx) => {
      await tx.task.update({
        where: { id },
        data: { status: "مفتوحة", doneAt: "", notifiedBefore: false, notifiedAfter: false },
      });
      await audit(tx, {
        username: guard.user.username,
        action: "إعادة فتح",
        entityType: "task",
        entityId: id,
        entityName: task.title,
        oldStatus: "منجزة",
        newStatus: "مفتوحة",
      });
    });
    return ok({ updated: true, status: "مفتوحة" });
  }

  // ===== تعليم التنبيه من محرك التذكير =====
  if (action === "notified") {
    const stage = String(body.stage || "").trim();
    if (stage !== "before" && stage !== "after") return jsonError("مرحلة التنبيه يجب أن تكون before أو after");
    const data: Prisma.TaskUpdateInput = stage === "before" ? { notifiedBefore: true } : { notifiedAfter: true };
    await db.task.update({ where: { id }, data });
    return ok({ updated: true, stage });
  }

  // ===== تعديل الحقول =====
  const data: Prisma.TaskUpdateInput = {};
  let dueChanged = false;
  let remindChanged = false;

  if (body.title !== undefined) {
    const title = String(body.title || "").trim();
    if (!title) return jsonError("عنوان المهمة مطلوب");
    data.title = title;
  }
  if (body.details !== undefined) data.details = String(body.details || "");
  if (body.dueAt !== undefined) {
    const dueAt = validDueAt(body.dueAt);
    if (!dueAt) return jsonError("موعد المهمة غير صالح — الصيغة YYYY-MM-DD HH:mm");
    if (dueAt !== task.dueAt) dueChanged = true;
    data.dueAt = dueAt;
  }
  if (body.remindMinutes !== undefined) {
    const n = Number(body.remindMinutes);
    if (!Number.isFinite(n) || n < 0) return jsonError("دقائق التذكير يجب أن تكون رقمًا غير سالب");
    if (Math.floor(n) !== task.remindMinutes) remindChanged = true;
    data.remindMinutes = Math.floor(n);
  }
  if (body.taskType !== undefined) {
    const taskType = String(body.taskType);
    if (!TASK_TYPES.includes(taskType as (typeof TASK_TYPES)[number])) {
      return jsonError("نوع المهمة يجب أن يكون «تذكير» أو «موعد»");
    }
    data.taskType = taskType;
  }

  const customerId = body.customerId !== undefined ? Number(body.customerId) || 0 : -1;
  const contractId = body.contractId !== undefined ? Number(body.contractId) || 0 : -1;

  if (customerId > 0) {
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) return jsonError("العميل غير موجود", 404);
  }
  if (contractId > 0) {
    const contract = await db.contract.findUnique({ where: { id: contractId } });
    if (!contract) return jsonError("العقد غير موجود", 404);
    const effCustomerId = customerId > 0 ? customerId : task.customerId || 0;
    if (effCustomerId && contract.customerId !== effCustomerId) {
      return jsonError("العقد المحدد لا يخص هذا العميل");
    }
  }
  if (body.customerId !== undefined) data.customer = customerId ? { connect: { id: customerId } } : { disconnect: true };
  if (body.contractId !== undefined) data.contract = contractId ? { connect: { id: contractId } } : { disconnect: true };

  // تعديل الموعد أو دقائق التذكير يصفّر أعلام التنبيه (كالمصدر)
  if (dueChanged || remindChanged) {
    data.notifiedBefore = false;
    data.notifiedAfter = false;
  }

  await db.$transaction(async (tx) => {
    await tx.task.update({ where: { id }, data });
    await audit(tx, {
      username: guard.user.username,
      action: "تعديل",
      entityType: "task",
      entityId: id,
      entityName: String(data.title || task.title),
    });
  });

  return ok({ updated: true });
}

/** حذف فعلي للمهمة (مسموح كالمصدر) — مع سجل PurgeAudit وتحرير زياراتها (taskId ⇒ null) */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_tasks");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const task = await db.task.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true, customerCode: true } },
      contract: { select: { contractNumber: true, contractName: true } },
    },
  });
  if (!task) return jsonError("المهمة غير موجودة", 404);

  const reason = (req.nextUrl.searchParams.get("reason") || "").trim() || "حذف مهمة";

  const snapshot = {
    action: "task_delete",
    task: {
      id: task.id,
      title: task.title,
      details: task.details,
      dueAt: task.dueAt,
      remindMinutes: task.remindMinutes,
      taskType: task.taskType,
      status: task.status,
      source: task.source,
      doneAt: task.doneAt,
      customerId: task.customerId,
      customerName: task.customer?.name || "",
      contractId: task.contractId,
      contractNumber: task.contract?.contractNumber || "",
      createdAt: task.createdAt,
    },
    deletedAt: todayStr(),
    deletedBy: guard.user.username,
  };

  await db.$transaction(async (tx) => {
    await tx.task.delete({ where: { id } });
    await tx.purgeAudit.create({
      data: {
        purgedBy: guard.user.username,
        entity: "task",
        entityId: id,
        label: task.title,
        reason,
        snapshot: JSON.stringify(snapshot),
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف",
      entityType: "task",
      entityId: id,
      entityName: task.title,
      reason,
    });
  });

  return ok({ deleted: true });
}
