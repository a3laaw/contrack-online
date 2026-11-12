// POST /api/boq-docs/[id]/items — إضافة بند يدوي إلى وثيقة BOQ
// (الإضافة اليدوية للشجرة — القسم اختياري: قسم قائم بكوده أو قسم جديد)
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, jsonError, ok } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";

type P = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const docId = Number(idStr);
  if (!Number.isFinite(docId)) return jsonError("معرف غير صالح");

  const doc = await db.boqDoc.findUnique({ where: { id: docId } });
  if (!doc) return jsonError("وثيقة BOQ غير موجودة", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const description = String(body.description || "").trim();
  if (!description) return jsonError("وصف البند مطلوب");

  const qty = Number(body.qty) || 1;
  const unitPrice = Number(body.unitPrice) || 0;

  const max = await db.boqDocItem.aggregate({ where: { docId }, _max: { sortOrder: true } });
  const item = await db.boqDocItem.create({
    data: {
      docId,
      itemNo: String(body.itemNo || "").trim(),
      divisionCode: String(body.divisionCode || "").trim(),
      divisionName: String(body.divisionName || "").trim(),
      description,
      qty: r3(qty),
      unit: String(body.unit || "").trim(),
      unitPrice: r3(unitPrice),
      amount: r3(qty * unitPrice), // اليدوي لا يحمل مبلغاً أصلياً — كمية×سعر دائماً
      sortOrder: (max._max.sortOrder ?? -1) + 1,
    },
  });
  return ok({ id: item.id }, 201);
}
