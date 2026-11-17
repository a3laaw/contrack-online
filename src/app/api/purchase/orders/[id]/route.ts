import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { r3, cleanPurchaseDate, cleanPurchaseText, poTotalAmount } from "@/lib/purchase-core";
import { poTransitionAllowed, poTransitionBlockedMessage } from "@/lib/purchase-constants";

type P = { params: Promise<{ id: string }> };

/**
 * ر4 — تفصيل/تعديل/حذف أمر الشراء (docs/purchase-design.md §5):
 * • التعديل الكامل على «مسودة» فقط (د3) — والانتقال مسودة→مرسل للمورد/ملغى بحرس المصفوفة
 * • الحذف «مسودة» فقط ومديرًا فقط — والمستلم منه ممنوع أصلًا
 */

async function loadDetail(id: number) {
  return db.purchaseOrder.findUnique({
    where: { id },
    select: {
      id: true, poNumber: true, orderDate: true, expectedDate: true, status: true,
      totalAmount: true, receivedAmount: true, notes: true, supplierId: true, contractId: true, createdAt: true,
      supplier: { select: { id: true, name: true, supplierCode: true, phone: true, crNumber: true } },
      contract: { select: { id: true, contractNumber: true } },
      items: {
        select: {
          id: true, itemId: true, qty: true, receivedQty: true, unitPrice: true, amount: true, sortOrder: true,
          item: { select: { id: true, name: true, unit: true } },
        },
        orderBy: { sortOrder: "asc" },
      },
      receipts: { select: { id: true, docNumber: true, vdate: true, totalAmount: true, status: true }, orderBy: { id: "desc" } },
    },
  });
}

export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_purchase");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "purchase", "الشراء");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف غير صالح");
  const row = await loadDetail(id);
  if (!row) return jsonError("أمر الشراء غير موجود", 404);
  return ok({ order: row });
}

export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_purchase");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "purchase", "الشراء");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف غير صالح");

  const existing = await db.purchaseOrder.findUnique({
    where: { id },
    select: { id: true, poNumber: true, status: true, totalAmount: true },
  });
  if (!existing) return jsonError("أمر الشراء غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // انتقال الحالة (د3): مصفوفة مغلقة — مسودة→مرسل للمورد/ملغى (وما فوقها من الاستلام آلي حصرًا)
  const newStatus = typeof body.status === "string" && body.status && body.status !== existing.status ? body.status : undefined;
  if (newStatus !== undefined) {
    if (!poTransitionAllowed(existing.status, newStatus)) {
      return jsonError(poTransitionBlockedMessage(existing.status, newStatus), 400);
    }
  }

  const wantsDataEdit =
    body.supplierId !== undefined || body.orderDate !== undefined || body.expectedDate !== undefined ||
    body.contractId !== undefined || body.items !== undefined || body.notes !== undefined;
  if (wantsDataEdit && existing.status !== "مسودة") {
    return jsonError("التعديل متاح على الأمر في حالة «مسودة» فقط.", 400);
  }

  const data: Record<string, unknown> = {};

  if (body.supplierId !== undefined) {
    const supplierId = Number(body.supplierId ?? 0) || 0;
    if (!supplierId) return jsonError("يجب اختيار المورد.", 400);
    const supplier = await db.supplier.findUnique({ where: { id: supplierId }, select: { id: true, active: true } });
    if (!supplier) return jsonError("المورد غير موجود.", 400);
    if (!supplier.active) return jsonError("المورد غير نشط.", 400);
    data.supplierId = supplierId;
  }
  if (body.orderDate !== undefined) {
    const d = cleanPurchaseDate(body.orderDate);
    if (!d) return jsonError("تاريخ الأمر غير صالح (YYYY-MM-DD).", 400);
    data.orderDate = d;
  }
  if (body.expectedDate !== undefined) data.expectedDate = cleanPurchaseDate(body.expectedDate);
  if (body.contractId !== undefined) {
    const contractId = Number(body.contractId ?? 0) || 0;
    if (contractId > 0) {
      const contract = await db.contract.findUnique({ where: { id: contractId }, select: { id: true, status: true } });
      if (!contract) return jsonError("العقد المرتبط غير موجود.", 400);
      if (contract.status === "ملغى") return jsonError("لا يمكن ربط الأمر بعقد ملغى.", 400);
    }
    data.contractId = contractId > 0 ? contractId : null;
  }
  if (body.notes !== undefined) data.notes = cleanPurchaseText(body.notes);

  let itemsPayload: { itemId: number; qty: number; unitPrice: number; amount: number; note: string }[] | null = null;
  if (body.items !== undefined) {
    const rawItems = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
    const parsed: { itemId: number; qty: number; unitPrice: number; amount: number; note: string }[] = [];
    for (const it of rawItems) {
      const itemId = Number(it?.itemId ?? 0) || 0;
      const qty = Number(it?.qty ?? 0) || 0;
      const unitPrice = Math.max(0, Number(it?.unitPrice ?? 0) || 0);
      if (!itemId) return jsonError("كل بند أمر شراء يتطلب صنفًا من المخازن.", 400);
      if (qty <= 0) return jsonError("كمية كل بند يجب أن تكون أكبر من صفر.", 400);
      parsed.push({ itemId, qty, unitPrice, amount: r3(qty * unitPrice), note: cleanPurchaseText(it?.note) });
    }
    if (parsed.length === 0) return jsonError("يجب إضافة بند واحد على الأقل لأمر الشراء.", 400);
    const itemIds = [...new Set(parsed.map((p) => p.itemId))];
    if (itemIds.length !== parsed.length) return jsonError("لا يُكرر الصنف نفسه في بنود الأمر — اجمع الكميات في سطر واحد.", 400);
    const stockItems = await db.stockItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, active: true } });
    for (const iid of itemIds) {
      const found = stockItems.find((s) => s.id === iid);
      if (!found) return jsonError(`الصنف #${iid} غير موجود.`, 400);
      if (!found.active) return jsonError(`الصنف «${found.name}» غير نشط.`, 400);
    }
    itemsPayload = parsed;
    data.totalAmount = poTotalAmount(parsed);
  }

  const row = await db.$transaction(async (tx) => {
    if (itemsPayload) {
      await tx.purchaseOrderItem.deleteMany({ where: { poId: id } });
      await tx.purchaseOrderItem.createMany({
        data: itemsPayload.map((p, i) => ({
          poId: id, itemId: p.itemId, qty: p.qty, receivedQty: 0,
          unitPrice: p.unitPrice, amount: p.amount, sortOrder: i,
        })),
      });
    }
    const updated = await tx.purchaseOrder.update({
      where: { id },
      data: { ...data, ...(newStatus !== undefined ? { status: newStatus } : {}) },
      select: { id: true, poNumber: true, status: true, totalAmount: true },
    });
    await audit(tx, {
      username: guard.user.username,
      action: newStatus !== undefined ? `تغيير حالة أمر الشراء إلى «${newStatus}»` : "تعديل أمر شراء",
      entityType: "purchase_order",
      entityId: updated.id,
      entityName: updated.poNumber,
      oldStatus: existing.status,
      newStatus: updated.status,
    });
    return updated;
  });
  return ok({ order: row });
}

export async function DELETE(req: NextRequest, { params }: P) {
  // الحذف مديرًا فقط — والمسودة فقط (د3)
  const guard = await authGuard(req, "screen_purchase");
  if ("response" in guard) return guard.response;
  const admin = await adminGuard(req);
  if ("response" in admin) return admin.response;
  const mg = await moduleGuard(guard.user.companyId, "purchase", "الشراء");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف غير صالح");

  const existing = await db.purchaseOrder.findUnique({
    where: { id },
    select: { id: true, poNumber: true, status: true, supplier: { select: { name: true } } },
  });
  if (!existing) return jsonError("أمر الشراء غير موجود", 404);
  if (existing.status !== "مسودة") {
    return jsonError("الحذف متاح على الأمر في حالة «مسودة» فقط.", 400);
  }

  await db.$transaction(async (tx) => {
    await tx.purchaseOrder.delete({ where: { id } });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف أمر شراء",
      entityType: "purchase_order",
      entityId: existing.id,
      entityName: `${existing.poNumber} — ${existing.supplier.name}`,
    });
  });
  return ok({ deleted: true });
}
