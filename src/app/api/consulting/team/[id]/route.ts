import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay } from "@/lib/api-utils";
import { ENGINEER_STATUSES } from "@/lib/consulting-constants";

type P = { params: Promise<{ id: string }> };

/** PATCH: تعديل بيانات مهندس — الحقول المرسلة فقط */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const engineer = await db.engineer.findUnique({ where: { id } });
  if (!engineer) return jsonError("المهندس غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Prisma.EngineerUpdateInput = {};

  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) return jsonError("اسم المهندس مطلوب");
    data.name = name;
  }
  if (body.jobTitle !== undefined) data.jobTitle = String(body.jobTitle || "").trim();
  if (body.specialty !== undefined) data.specialty = String(body.specialty || "").trim();
  if (body.civilId !== undefined) {
    const civilId = String(body.civilId || "").trim();
    if (civilId && !/^\d{10}$/.test(civilId)) return jsonError("الرقم المدني يجب أن يكون 10 أرقام");
    data.civilId = civilId;
  }
  if (body.nationality !== undefined) data.nationality = String(body.nationality || "").trim();
  if (body.phone !== undefined) data.phone = String(body.phone || "").trim();
  if (body.email !== undefined) data.email = String(body.email || "").trim();
  if (body.licenseNo !== undefined) data.licenseNo = String(body.licenseNo || "").trim();
  if (body.licenseExpiry !== undefined) {
    const licenseExpiry = body.licenseExpiry ? parseDay(body.licenseExpiry) : "";
    if (body.licenseExpiry && !licenseExpiry) return jsonError("تاريخ انتهاء الترخيص غير صالح");
    data.licenseExpiry = licenseExpiry;
  }
  if (body.hireDate !== undefined) {
    const hireDate = body.hireDate ? parseDay(body.hireDate) : "";
    if (body.hireDate && !hireDate) return jsonError("تاريخ التعيين غير صالح");
    data.hireDate = hireDate;
  }
  if (body.baseSalary !== undefined) {
    const n = Number(body.baseSalary);
    if (!Number.isFinite(n) || n < 0) return jsonError("الراتب الأساسي يجب أن يكون رقمًا غير سالب");
    data.baseSalary = n;
  }
  if (body.status !== undefined) {
    const status = String(body.status);
    if (!(ENGINEER_STATUSES as readonly string[]).includes(status)) return jsonError("حالة المهندس غير معروفة");
    data.status = status;
  }
  if (body.notes !== undefined) data.notes = String(body.notes || "").trim();

  try {
    await db.engineer.update({ where: { id }, data });
    await audit(db, {
      username: guard.user.username,
      action: "تعديل",
      entityType: "engineer",
      entityId: id,
      entityName: String(data.name || engineer.name),
      oldStatus: engineer.status,
      newStatus: String(data.status || engineer.status),
    });
    return ok({ updated: true });
  } catch (e) {
    console.error(e);
    return jsonError("تعذر تعديل المهندس", 500);
  }
}

/** DELETE: حذف مهندس — يُحذف معه إسناداته وساعاته وإجازاته (Cascade) مع لقطة تدقيق */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const engineer = await db.engineer.findUnique({ where: { id } });
  if (!engineer) return jsonError("المهندس غير موجود", 404);

  const reason = (req.nextUrl.searchParams.get("reason") || "").trim() || "حذف مهندس";

  await db.$transaction(async (tx) => {
    await tx.engineer.delete({ where: { id } });
    await tx.purgeAudit.create({
      data: {
        purgedBy: guard.user.username,
        entity: "engineer",
        entityId: id,
        label: engineer.name,
        reason,
        snapshot: JSON.stringify({ engineer, deletedAt: new Date().toISOString() }),
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف",
      entityType: "engineer",
      entityId: id,
      entityName: engineer.name,
      reason,
    });
  });

  return ok({ deleted: true });
}
