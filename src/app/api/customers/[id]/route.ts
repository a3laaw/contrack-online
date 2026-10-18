import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";

type P = { params: Promise<{ id: string }> };

/** العميل + عقوده (رقم/حالة/قيمة أصلية) */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_customers");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) return jsonError("العميل غير موجود", 404);

  const contracts = await db.contract.findMany({
    where: { customerId: id },
    select: {
      id: true,
      contractNumber: true,
      contractName: true,
      contractType: true,
      status: true,
      amount: true,
      contractDate: true,
      signDate: true,
      startDate: true,
      endDate: true,
    },
    orderBy: { id: "desc" },
  });
  return ok({
    customer,
    contracts: contracts.map((c) => ({ ...c, amount: Number(c.amount) })),
  });
}

/** تعديل عميل */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) return jsonError("العميل غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, string> = {};
  const strFields = ["name", "phone", "email", "governorate", "area", "block", "plot", "address", "notes", "folderPath"];
  for (const f of strFields) {
    if (body[f] !== undefined) {
      const v = String(body[f]).trim();
      if (f === "name" && !v) return jsonError("اسم العميل مطلوب");
      data[f] = v;
    }
  }
  const updated = await db.customer.update({ where: { id }, data });
  await audit(db, {
    username: guard.user.username,
    action: "تعديل",
    entityType: "customer",
    entityId: id,
    entityName: updated.name,
  });
  return ok({ customer: updated });
}

/** حذف عميل — ممنوع مع وجود عقود */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) return jsonError("العميل غير موجود", 404);

  const contractsCount = await db.contract.count({ where: { customerId: id } });
  if (contractsCount > 0) return jsonError("لا يمكن حذف عميل له عقود");

  await db.$transaction(async (tx) => {
    await tx.comment.deleteMany({ where: { customerId: id } });
    await tx.task.deleteMany({ where: { customerId: id } });
    await tx.visit.deleteMany({ where: { customerId: id } });
    await tx.customer.delete({ where: { id } });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف",
      entityType: "customer",
      entityId: id,
      entityName: customer.name,
    });
  });
  return ok({ message: "تم حذف العميل" });
}
