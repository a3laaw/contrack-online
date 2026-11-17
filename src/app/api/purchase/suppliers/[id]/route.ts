import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { cleanPurchaseText } from "@/lib/purchase-core";

type P = { params: Promise<{ id: string }> };

/**
 * ر4 — تفصيل/تعديل/حذف المورد (docs/purchase-design.md §5):
 * • حذف مورد له أوامر مرفوض برسالة عدد الأوامر (نمط حماية الاستشارات) — مديرًا فقط
 * • التعديل حر للبيانات التعريفية والتفعيل
 */

export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_purchase");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "purchase", "الشراء");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف غير صالح");
  const row = await db.supplier.findUnique({
    where: { id },
    select: {
      id: true, supplierCode: true, name: true, phone: true, email: true,
      address: true, crNumber: true, active: true, notes: true, createdAt: true,
      purchaseOrders: {
        select: { id: true, poNumber: true, orderDate: true, expectedDate: true, status: true, totalAmount: true, receivedAmount: true },
        orderBy: { id: "desc" },
      },
      vouchers: {
        select: { id: true, voucherNumber: true, vtype: true, vdate: true, amount: true, description: true, cancelled: true },
        orderBy: { id: "desc" },
        take: 50,
      },
    },
  });
  if (!row) return jsonError("المورد غير موجود", 404);
  return ok({ supplier: row });
}

export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_purchase");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "purchase", "الشراء");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف غير صالح");
  const existing = await db.supplier.findUnique({ where: { id }, select: { id: true, supplierCode: true, name: true } });
  if (!existing) return jsonError("المورد غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = cleanPurchaseText(body.name);
    if (!name) return jsonError("اسم المورد إلزامي.", 400);
    data.name = name;
  }
  if (body.phone !== undefined) data.phone = cleanPurchaseText(body.phone);
  if (body.email !== undefined) data.email = cleanPurchaseText(body.email);
  if (body.address !== undefined) data.address = cleanPurchaseText(body.address);
  if (body.crNumber !== undefined) data.crNumber = cleanPurchaseText(body.crNumber);
  if (body.active !== undefined) data.active = Boolean(body.active);
  if (body.notes !== undefined) data.notes = cleanPurchaseText(body.notes);

  const row = await db.$transaction(async (tx) => {
    const updated = await tx.supplier.update({
      where: { id },
      data,
      select: { id: true, supplierCode: true, name: true, phone: true, email: true, address: true, crNumber: true, active: true, notes: true },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "تعديل مورد",
      entityType: "supplier",
      entityId: updated.id,
      entityName: `${updated.supplierCode} — ${updated.name}`,
    });
    return updated;
  });
  return ok({ supplier: row });
}

export async function DELETE(req: NextRequest, { params }: P) {
  // الحذف مديرًا فقط — وباب الشاشة قبل دور المدير
  const guard = await authGuard(req, "screen_purchase");
  if ("response" in guard) return guard.response;
  const admin = await adminGuard(req);
  if ("response" in admin) return admin.response;
  const mg = await moduleGuard(guard.user.companyId, "purchase", "الشراء");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف غير صالح");

  const existing = await db.supplier.findUnique({
    where: { id },
    select: { id: true, supplierCode: true, name: true, _count: { select: { purchaseOrders: true } } },
  });
  if (!existing) return jsonError("المورد غير موجود", 404);
  // حماية الحذف: مورد له أوامر شراء لا يُحذف (أثر تجاري موثق — نمط الاستشارات)
  if (existing._count.purchaseOrders > 0) {
    return jsonError(`لا يمكن حذف المورد المرتبط بأوامر شراء (عدد الأوامر: ${existing._count.purchaseOrders}).`, 400);
  }

  await db.$transaction(async (tx) => {
    await tx.supplier.delete({ where: { id } });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف مورد",
      entityType: "supplier",
      entityId: existing.id,
      entityName: `${existing.supplierCode} — ${existing.name}`,
    });
  });
  return ok({ deleted: true });
}
