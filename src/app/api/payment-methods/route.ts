import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { numOr } from "@/lib/contrack-server";

/** طرق الدفع — القائمة لكل المستخدمين */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const methods = await db.paymentMethod.findMany({ orderBy: { id: "asc" } });
  return ok({
    methods: methods.map((m) => ({
      id: m.id,
      name: m.name,
      feeType: m.feeType,
      feeValue: Number(m.feeValue),
      isActive: m.isActive,
    })),
  });
}

export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name || "").trim();
  if (!name) return jsonError("اسم طريقة الدفع مطلوب");
  const exists = await db.paymentMethod.findFirst({ where: { name } });
  if (exists) return jsonError("طريقة الدفع موجودة مسبقًا");
  const feeType = String(body.feeType || "amount");
  if (feeType !== "amount" && feeType !== "percent") return jsonError("نوع الرسوم غير صحيح (amount أو percent)");

  const method = await db.paymentMethod.create({
    data: {
      name,
      feeType,
      feeValue: numOr(body.feeValue, 0),
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
    },
  });
  await audit(db, {
    username: guard.user.username,
    action: "إنشاء",
    entityType: "paymentMethod",
    entityId: method.id,
    entityName: name,
  });
  return ok({ method: { ...method, feeValue: Number(method.feeValue) } }, 201);
}

/** تعديل طريقة — ?id= */
export async function PATCH(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const id = Number(req.nextUrl.searchParams.get("id") || 0);
  if (!id) return jsonError("معرف غير صالح");

  const method = await db.paymentMethod.findUnique({ where: { id } });
  if (!method) return jsonError("طريقة الدفع غير موجودة", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return jsonError("اسم طريقة الدفع مطلوب");
    if (name !== method.name) {
      const exists = await db.paymentMethod.findFirst({ where: { name } });
      if (exists) return jsonError("طريقة الدفع موجودة مسبقًا");
    }
    data.name = name;
  }
  if (body.feeType !== undefined) {
    const feeType = String(body.feeType);
    if (feeType !== "amount" && feeType !== "percent") return jsonError("نوع الرسوم غير صحيح (amount أو percent)");
    data.feeType = feeType;
  }
  if (body.feeValue !== undefined) data.feeValue = numOr(body.feeValue, 0);
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

  const updated = await db.paymentMethod.update({ where: { id }, data });
  await audit(db, {
    username: guard.user.username,
    action: "تعديل",
    entityType: "paymentMethod",
    entityId: id,
    entityName: updated.name,
  });
  return ok({ method: { ...updated, feeValue: Number(updated.feeValue) } });
}

/** حذف طريقة — ممنوع إن استُخدمت في سندات (عطّلها بدلًا من حذفها) */
export async function DELETE(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const id = Number(req.nextUrl.searchParams.get("id") || 0);
  if (!id) return jsonError("معرف غير صالح");

  const method = await db.paymentMethod.findUnique({ where: { id } });
  if (!method) return jsonError("طريقة الدفع غير موجودة", 404);

  const used = await db.voucher.count({ where: { method: method.name, cancelled: false } });
  if (used > 0) return jsonError("لا يمكن حذف طريقة مستخدمة في سندات — يمكنك تعطيلها");

  await db.paymentMethod.delete({ where: { id } });
  await audit(db, {
    username: guard.user.username,
    action: "حذف",
    entityType: "paymentMethod",
    entityId: id,
    entityName: method.name,
  });
  return ok({ message: "تم حذف طريقة الدفع" });
}
