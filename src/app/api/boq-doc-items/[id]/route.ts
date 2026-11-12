// PATCH  /api/boq-doc-items/[id] — تعديل بند في وثيقة BOQ
// DELETE /api/boq-doc-items/[id] — حذف بند (الشجرة مشتقة — حذف آخر بند
//        في قسم يُسقط القسم تلقائياً من العرض)
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, jsonError, ok } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";

type P = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const itemId = Number(idStr);
  if (!Number.isFinite(itemId)) return jsonError("معرف غير صالح");

  const item = await db.boqDocItem.findUnique({ where: { id: itemId } });
  if (!item) return jsonError("البند غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: {
    itemNo?: string;
    divisionCode?: string;
    divisionName?: string;
    description?: string;
    qty?: number;
    unit?: string;
    unitPrice?: number;
    amount?: number;
  } = {};
  if (body.itemNo !== undefined) data.itemNo = String(body.itemNo).trim();
  if (body.divisionCode !== undefined) data.divisionCode = String(body.divisionCode).trim();
  if (body.divisionName !== undefined) data.divisionName = String(body.divisionName).trim();
  if (body.unit !== undefined) data.unit = String(body.unit).trim();
  if (body.description !== undefined) {
    const d = String(body.description || "").trim();
    if (!d) return jsonError("وصف البند مطلوب");
    data.description = d;
  }

  // الكمية/السعر — إعادة حساب المبلغ تلقائياً (اليدوي كمية×سعر)
  const qty = body.qty !== undefined ? Number(body.qty) || 1 : Number(item.qty);
  const unitPrice = body.unitPrice !== undefined ? Number(body.unitPrice) || 0 : Number(item.unitPrice);
  if (body.qty !== undefined) data.qty = r3(Math.max(0, qty));
  if (body.unitPrice !== undefined) data.unitPrice = r3(Math.max(0, unitPrice));
  if (body.qty !== undefined || body.unitPrice !== undefined) {
    data.amount = r3(qty * unitPrice);
  }

  await db.boqDocItem.update({ where: { id: itemId }, data });
  return ok({ id: itemId });
}

export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const itemId = Number(idStr);
  if (!Number.isFinite(itemId)) return jsonError("معرف غير صالح");

  const item = await db.boqDocItem.findUnique({ where: { id: itemId } });
  if (!item) return jsonError("البند غير موجود", 404);

  await db.boqDocItem.delete({ where: { id: itemId } });
  return ok({ ok: true });
}
