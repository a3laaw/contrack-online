import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok, parseDay } from "@/lib/api-utils";
import { HOUR_SLOT_RE } from "@/lib/visits-server";

/**
 * تحويل زيارة إلى مهمة (كالمصدر visit_to_task):
 * - ينشئ مهمة نوع «موعد» بمصدر «جدول الزيارات» بتاريخ/ساعة الزيارة نفسها.
 * - العنوان الافتراضي: «زيارة: اسم العميل» (أو «زيارة: عميل غير محدد»).
 * - تعلَّم الزيارة بـ taskId — الترحيل المكرر مرفوض.
 */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_visits");
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const visitDate = parseDay(body.visitDate);
  if (!visitDate) return jsonError("تاريخ الزيارة مطلوب بالصيغة YYYY-MM-DD");
  const hourSlot = String(body.hourSlot || "").trim();
  if (!HOUR_SLOT_RE.test(hourSlot)) return jsonError("خانة الساعة غير صالحة — الصيغة HH:mm");
  const staffId = Number(body.staffId) || 0;
  if (!staffId) return jsonError("اختيار الموظف مطلوب");

  const visit = await db.visit.findUnique({
    where: { visitDate_hourSlot_staffId: { visitDate, hourSlot, staffId } },
    include: {
      customer: { select: { id: true, name: true } },
      staff: { select: { id: true, name: true } },
    },
  });
  if (!visit) return jsonError("الزيارة غير موجودة", 404);
  if (visit.taskId) return jsonError("تم ترحيل هذه الزيارة إلى مهمة مسبقًا");

  const customTitle = String(body.title || "").trim();
  const title = customTitle || `زيارة: ${visit.customer?.name || "عميل غير محدد"}`;

  const result = await db.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        title,
        details: visit.note || "",
        dueAt: `${visitDate} ${hourSlot}`,
        remindMinutes: 30,
        taskType: "موعد",
        source: "جدول الزيارات",
        status: "مفتوحة",
        customerId: visit.customerId,
      },
    });
    await tx.visit.update({ where: { id: visit.id }, data: { taskId: task.id } });
    await audit(tx, {
      username: guard.user.username,
      action: "ترحيل زيارة لمهمة",
      entityType: "task",
      entityId: task.id,
      entityName: title,
    });
    return { task, visitId: visit.id };
  });

  return ok(
    {
      task: {
        id: result.task.id,
        title: result.task.title,
        dueAt: result.task.dueAt,
        taskType: result.task.taskType,
        source: result.task.source,
        status: result.task.status,
      },
      visitId: result.visitId,
    },
    201
  );
}
