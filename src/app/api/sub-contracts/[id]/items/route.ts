import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import { numOr } from "@/lib/contrack-server";

type P = { params: Promise<{ id: string }> };

/** بنود عقد الباطن مع وصف بند الكميات الأصلي */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_subcontractors");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const sc = await db.subContract.findUnique({
    where: { id },
    include: { items: { include: { boqItem: { select: { id: true, description: true, unit: true, stageId: true } } }, orderBy: { id: "asc" } } },
  });
  if (!sc) return jsonError("عقد الباطن غير موجود", 404);

  return ok({
    items: sc.items.map((it) => ({
      id: it.id,
      boqItemId: it.boqItemId,
      description: it.boqItem?.description || "",
      unit: it.boqItem?.unit || "",
      stageId: it.boqItem?.stageId || null,
      qty: Number(it.qty),
      unitPrice: Number(it.unitPrice),
      amount: Number(it.amount),
      sourceKind: it.sourceKind,
    })),
    total: r3(sc.items.reduce((s, it) => s + Number(it.amount), 0)),
  });
}

/** استبدال البنود كاملة: من boq بـ boqItemId أو يدوية — مع إعادة الحساب */
export async function PUT(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_subcontractors");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const sc = await db.subContract.findUnique({ where: { id } });
  if (!sc) return jsonError("عقد الباطن غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const itemsIn = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];

  const prepared: { boqItemId: number | null; qty: number; unitPrice: number; amount: number; sourceKind: string; sourceId: number; description: string }[] = [];
  for (const it of itemsIn) {
    if (it.boqItemId) {
      const boq = await db.boqItem.findUnique({ where: { id: Number(it.boqItemId) } });
      if (!boq || boq.contractId !== sc.contractId) return jsonError(`بند الكميات ${it.boqItemId} غير موجود في عقد العميل`, 400);
      prepared.push({
        boqItemId: boq.id,
        qty: Number(boq.qty),
        unitPrice: Number(boq.unitPrice),
        amount: Number(boq.amount),
        sourceKind: "",
        sourceId: 0,
        description: boq.description,
      });
    } else {
      const qty = numOr(it.qty, 0);
      const unitPrice = numOr(it.unitPrice, 0);
      if (!(qty > 0) || !(unitPrice > 0)) return jsonError("البند اليدوي يتطلب كمية وسعر وحدة أكبر من صفر");
      prepared.push({
        boqItemId: null,
        qty,
        unitPrice,
        amount: r3(qty * unitPrice),
        sourceKind: "",
        sourceId: 0,
        description: String(it.description || ""),
      });
    }
  }

  await db.$transaction(async (tx) => {
    await tx.subContractItem.deleteMany({ where: { subContractId: id } });
    for (const it of prepared) {
      await tx.subContractItem.create({
        data: {
          subContractId: id,
          boqItemId: it.boqItemId,
          qty: it.qty,
          unitPrice: it.unitPrice,
          amount: it.amount,
          sourceKind: it.sourceKind,
          sourceId: it.sourceId,
        },
      });
    }
    await tx.contractEvent.create({
      data: {
        contractId: sc.contractId,
        eventType: "تعديل بنود عقد باطن",
        description: `استبدال بنود عقد الباطن رقم ${id} — ${prepared.length} بندًا بإجمالي ${r3(prepared.reduce((s, it) => s + it.amount, 0))}`,
        username: guard.user.username,
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "تعديل",
      entityType: "sub_contract_items",
      entityId: id,
      entityName: `بنود باطن ${id}`,
    });
  });

  return ok({ replaced: true, count: prepared.length, total: r3(prepared.reduce((s, it) => s + it.amount, 0)) });
}
