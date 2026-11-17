import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay } from "@/lib/api-utils";
import {
  CONSULTING_PROJECT_STATUSES,
  CONSULTING_SERVICE_TYPES,
} from "@/lib/consulting-constants";

type P = { params: Promise<{ id: string }> };

/** PATCH: تعديل بيانات مشروع استشاري — الحقول المرسلة فقط (نمط مهندسين [id]) */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const project = await db.consultingProject.findUnique({ where: { id } });
  if (!project) return jsonError("المشروع الاستشاري غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Prisma.ConsultingProjectUpdateInput = {};

  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) return jsonError("اسم المشروع الاستشاري مطلوب");
    if (name.length > 200) return jsonError("اسم المشروع طويل — 200 حرف كحد أقصى");
    data.name = name;
  }
  if (body.serviceType !== undefined) {
    const serviceType = String(body.serviceType || "").trim();
    if (!(CONSULTING_SERVICE_TYPES as readonly string[]).includes(serviceType))
      return jsonError("نوع الخدمة الاستشارية غير معروف");
    data.serviceType = serviceType;
  }
  if (body.status !== undefined) {
    const status = String(body.status);
    if (!(CONSULTING_PROJECT_STATUSES as readonly string[]).includes(status))
      return jsonError("حالة المشروع غير معروفة");
    data.status = status;
  }
  if (body.fee !== undefined) {
    const n = Number(body.fee);
    if (!Number.isFinite(n) || n < 0) return jsonError("الأتعاب يجب أن تكون رقمًا غير سالب");
    if (n > 999_999_999) return jsonError("الأتعاب تتجاوز الحد المسموح");
    data.fee = n;
  }
  if (body.startDate !== undefined) {
    const startDate = body.startDate ? parseDay(body.startDate) : "";
    if (body.startDate && !startDate) return jsonError("تاريخ البداية غير صالح");
    data.startDate = startDate;
  }
  if (body.endDate !== undefined) {
    const endDate = body.endDate ? parseDay(body.endDate) : "";
    if (body.endDate && !endDate) return jsonError("تاريخ النهاية غير صالح");
    data.endDate = endDate;
  }
  if (body.customerId !== undefined) {
    const customerId = Number(body.customerId) || 0;
    if (customerId) {
      const customer = await db.customer.findUnique({ where: { id: customerId }, select: { id: true } });
      if (!customer) return jsonError("العميل غير موجود", 404);
      data.customer = { connect: { id: customerId } };
    } else {
      data.customer = { disconnect: true };
    }
  }
  if (body.notes !== undefined) data.notes = String(body.notes || "").trim();

  try {
    await db.consultingProject.update({ where: { id }, data });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return jsonError("تعارض في التحديث — أعد المحاولة");
    throw e;
  }
  await audit(db, {
    username: guard.user.username,
    action: "تعديل",
    entityType: "consulting_project",
    entityId: id,
    entityName: String(data.name || project.name),
    newStatus: String(data.status || project.status),
  });
  return ok({ updated: true });
}

/** DELETE: حذف مشروع استشاري — مرفوض عند وجود ارتباطات (حماية التتبع) */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const project = await db.consultingProject.findUnique({
    where: { id },
    include: { _count: { select: { assignments: true, timesheets: true, revisions: true } } },
  });
  if (!project) return jsonError("المشروع الاستشاري غير موجود", 404);

  const linked = project._count.assignments + project._count.timesheets + project._count.revisions;
  if (linked > 0)
    return jsonError(
      `لا يمكن حذف المشروع — مرتبط بـ ${project._count.assignments} إسناد و${project._count.timesheets} سجل ساعات و${project._count.revisions} مراجعة`,
    );

  await db.consultingProject.delete({ where: { id } });
  await audit(db, {
    username: guard.user.username,
    action: "حذف",
    entityType: "consulting_project",
    entityId: id,
    entityName: `${project.projectNumber} — ${project.name}`,
  });
  return ok({ deleted: true });
}
