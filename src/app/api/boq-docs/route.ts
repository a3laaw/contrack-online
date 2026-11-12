// GET  /api/boq-docs — قائمة وثائق جدول الكميات المستقلة (BOQ Doc)
// POST /api/boq-docs — إنشاء وثيقة جديدة (المرحلة أ — قرار المالك:
//      «بنود العقد حاجة والـBOQ حاجة تانية» — docs/boq-doc-design.md)
// الحرس: adminGuard — الوثائق بيانات إعدادات (المالك يبنيها قبل العقد)
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, jsonError, ok } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";

/** إجمالي البند: المستورد (له رقم بند) يأخذ مبلغ الملف الأصلي — واليدوي كمية×سعر
 *  (نفس قاعدة مسار بنود العقد — والبنود المشمولة INCLUDED تبقى 0 كما في الملف وملخصه) */
export function itemAmount(itemNo: string, amount: number, qty: number, unitPrice: number): number {
  return itemNo ? r3(amount) : r3(qty * unitPrice);
}

export async function GET(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const [docs, items] = await Promise.all([
    db.boqDoc.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    db.boqDocItem.findMany({
      select: { docId: true, itemNo: true, amount: true, qty: true, unitPrice: true },
    }),
  ]);
  const countBy = new Map<number, number>();
  const totalBy = new Map<number, number>();
  for (const it of items) {
    countBy.set(it.docId, (countBy.get(it.docId) ?? 0) + 1);
    totalBy.set(it.docId, r3((totalBy.get(it.docId) ?? 0) + itemAmount(it.itemNo, Number(it.amount), Number(it.qty), Number(it.unitPrice))));
  }

  return ok({
    docs: docs.map((d) => ({
      id: d.id,
      name: d.name,
      projectName: d.projectName,
      clientName: d.clientName,
      consultantName: d.consultantName,
      status: d.status === "ready" ? "ready" : "draft",
      notes: d.notes,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      itemCount: countBy.get(d.id) ?? 0,
      grandTotal: totalBy.get(d.id) ?? 0,
    })),
  });
}

export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name || "").trim();
  if (!name) return jsonError("اسم الوثيقة مطلوب");

  const status = body.status === "ready" ? "ready" : "draft";
  const doc = await db.boqDoc.create({
    data: {
      name,
      projectName: String(body.projectName || "").trim(),
      clientName: String(body.clientName || "").trim(),
      consultantName: String(body.consultantName || "").trim(),
      notes: String(body.notes || "").trim(),
      status,
    },
  });
  return ok(
    {
      doc: {
        id: doc.id,
        name: doc.name,
        projectName: doc.projectName,
        clientName: doc.clientName,
        consultantName: doc.consultantName,
        status,
        notes: doc.notes,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
        itemCount: 0,
        grandTotal: 0,
      },
    },
    201,
  );
}
