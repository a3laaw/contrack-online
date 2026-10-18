import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";

type P = { params: Promise<{ id: string }> };

/** بنود الكميات للعقد (غير المحذوفة ناعمًا) */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const items = await db.boqItem.findMany({
    where: { contractId, deleted: false },
    include: { stage: { select: { id: true, name: true } } },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  return ok({
    items: items.map((it) => ({
      id: it.id,
      contractId: it.contractId,
      stageId: it.stageId,
      stageName: it.stage?.name || "",
      description: it.description,
      qty: Number(it.qty),
      unit: it.unit,
      unitPrice: Number(it.unitPrice),
      amount: Number(it.amount),
      sortOrder: it.sortOrder,
    })),
  });
}

/** إضافة بند كميات */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const description = String(body.description || "").trim();
  if (!description) return jsonError("وصف البند مطلوب");

  const qty = Number(body.qty) || 1;
  const unitPrice = Number(body.unitPrice) || 0;
  const amount = body.amount !== undefined && Number(body.amount) ? Number(body.amount) : qty * unitPrice;

  let stageId: number | null = null;
  if (body.stageId !== undefined && body.stageId !== null && body.stageId !== "") {
    const sid = Number(body.stageId);
    const st = await db.contractStage.findUnique({ where: { id: sid } });
    if (!st || st.contractId !== contractId) return jsonError("المرحلة غير موجودة في هذا العقد");
    stageId = sid;
  }

  const max = await db.boqItem.aggregate({ where: { contractId }, _max: { sortOrder: true } });
  const item = await db.boqItem.create({
    data: {
      contractId,
      stageId,
      description,
      qty,
      unit: String(body.unit || ""),
      unitPrice,
      amount,
      sortOrder: body.sortOrder !== undefined ? Math.trunc(Number(body.sortOrder)) : (max._max.sortOrder ?? -1) + 1,
    },
  });
  return ok({ item: { ...item, qty: Number(item.qty), unitPrice: Number(item.unitPrice), amount: Number(item.amount) } }, 201);
}

/** تعديل بند كميات — ?itemId= */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  const itemId = Number(req.nextUrl.searchParams.get("itemId") || 0);
  if (!Number.isFinite(contractId) || !itemId) return jsonError("معرف غير صالح");

  const item = await db.boqItem.findUnique({ where: { id: itemId } });
  if (!item || item.contractId !== contractId || item.deleted) return jsonError("البند غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (body.description !== undefined) {
    const d = String(body.description).trim();
    if (!d) return jsonError("وصف البند مطلوب");
    data.description = d;
  }
  const qty = body.qty !== undefined ? Number(body.qty) || 1 : Number(item.qty);
  const unitPrice = body.unitPrice !== undefined ? Number(body.unitPrice) || 0 : Number(item.unitPrice);
  if (body.qty !== undefined) data.qty = qty;
  if (body.unit !== undefined) data.unit = String(body.unit || "");
  if (body.unitPrice !== undefined) data.unitPrice = unitPrice;
  if (body.qty !== undefined || body.unitPrice !== undefined || body.amount !== undefined) {
    data.amount = body.amount !== undefined && Number(body.amount) ? Number(body.amount) : qty * unitPrice;
  }
  if (body.sortOrder !== undefined) data.sortOrder = Math.trunc(Number(body.sortOrder) || 0);
  if (body.stageId !== undefined) {
    if (body.stageId === null || body.stageId === "") {
      data.stageId = null;
    } else {
      const sid = Number(body.stageId);
      const st = await db.contractStage.findUnique({ where: { id: sid } });
      if (!st || st.contractId !== contractId) return jsonError("المرحلة غير موجودة في هذا العقد");
      data.stageId = sid;
    }
  }

  await db.boqItem.update({ where: { id: itemId }, data });
  return ok({ message: "تم تعديل البند" });
}

/** حذف ناعم بند — ?itemId= — ممنوع إن كان مرتبطًا بعقد باطن */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  const itemId = Number(req.nextUrl.searchParams.get("itemId") || 0);
  if (!Number.isFinite(contractId) || !itemId) return jsonError("معرف غير صالح");

  const item = await db.boqItem.findUnique({ where: { id: itemId } });
  if (!item || item.contractId !== contractId || item.deleted) return jsonError("البند غير موجود", 404);

  const usedInSub = await db.subContractItem.findFirst({ where: { boqItemId: itemId }, select: { id: true } });
  if (usedInSub) return jsonError("لا يمكن حذف بند مرتبط بعقد باطن");

  await db.boqItem.update({
    where: { id: itemId },
    data: { deleted: true },
  });
  return ok({ message: "تم حذف البند" });
}
