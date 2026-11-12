// GET    /api/boq-docs/[id] — تفاصيل الوثيقة + بنودها (الشجرة مشتقة من القسم)
// PATCH  /api/boq-docs/[id] — تعديل بيانات الوثيقة أو حالتها (draft|ready)
// DELETE /api/boq-docs/[id] — حذف الوثيقة وبنودها (حارس مدير)
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, jsonError, ok } from "@/lib/api-utils";
import { itemAmount } from "../route";

type P = { params: Promise<{ id: string }> };

/** تحميل تفاصيل الوثيقة (بيانات + بنود مرتبة + إجماليات) — مشترك GET/PATCH */
async function docDetail(docId: number) {
  const doc = await db.boqDoc.findUnique({
    where: { id: docId },
    include: { items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
  });
  if (!doc) return null;
  return {
    id: doc.id,
    name: doc.name,
    projectName: doc.projectName,
    clientName: doc.clientName,
    consultantName: doc.consultantName,
    status: doc.status === "ready" ? ("ready" as const) : ("draft" as const),
    notes: doc.notes,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    itemCount: doc.items.length,
    grandTotal: doc.items.reduce(
      (s, it) => s + itemAmount(it.itemNo, Number(it.amount), Number(it.qty), Number(it.unitPrice)),
      0,
    ),
    items: doc.items.map((it) => ({
      id: it.id,
      docId: it.docId,
      itemNo: it.itemNo,
      divisionCode: it.divisionCode,
      divisionName: it.divisionName,
      description: it.description,
      qty: Number(it.qty),
      unit: it.unit,
      unitPrice: Number(it.unitPrice),
      amount: Number(it.amount),
      total: itemAmount(it.itemNo, Number(it.amount), Number(it.qty), Number(it.unitPrice)),
      sortOrder: it.sortOrder,
    })),
  };
}

export async function GET(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const docId = Number(idStr);
  if (!Number.isFinite(docId)) return jsonError("معرف غير صالح");

  const detail = await docDetail(docId);
  if (!detail) return jsonError("وثيقة BOQ غير موجودة", 404);
  return ok(detail);
}

export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const docId = Number(idStr);
  if (!Number.isFinite(docId)) return jsonError("معرف غير صالح");

  const doc = await db.boqDoc.findUnique({ where: { id: docId } });
  if (!doc) return jsonError("وثيقة BOQ غير موجودة", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, string> = {};
  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) return jsonError("اسم الوثيقة مطلوب");
    data.name = name;
  }
  for (const k of ["projectName", "clientName", "consultantName", "notes"] as const) {
    if (body[k] !== undefined) data[k] = String(body[k]).trim();
  }
  if (body.status !== undefined) {
    const status = String(body.status);
    if (status !== "draft" && status !== "ready") return jsonError("الحالة غير صالحة (draft أو ready)");
    data.status = status;
  }
  if (Object.keys(data).length === 0) return jsonError("لا توجد حقول للتعديل");

  await db.boqDoc.update({ where: { id: docId }, data });
  const detail = await docDetail(docId);
  return ok(detail);
}

// DELETE — حذف الوثيقة وبنودها كاملاً (Cascade)
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const docId = Number(idStr);
  if (!Number.isFinite(docId)) return jsonError("معرف غير صالح");

  const doc = await db.boqDoc.findUnique({ where: { id: docId } });
  if (!doc) return jsonError("وثيقة BOQ غير موجودة", 404);

  await db.boqDoc.delete({ where: { id: docId } });
  return ok({ ok: true });
}
