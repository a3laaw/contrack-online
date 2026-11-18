import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import { invoicedQtyByBoqItem } from "@/lib/invoice-server";
import { validatePlannedWindow } from "@/lib/schedule-items-core";

type P = { params: Promise<{ id: string }> };

/**
 * التحقق من مراحل البند: كلها مراحل حية في هذا العقد — يعيد نص الخطأ أو null.
 * سيناريو المالك 2026-11: «هربط البند مع مرحلة عمل او اكثر».
 */
async function validateStageIds(contractId: number, ids: number[]): Promise<string | null> {
  if (ids.length === 0) return null;
  const found = await db.contractStage.findMany({
    where: { id: { in: ids }, contractId },
    select: { id: true },
  });
  if (found.length !== new Set(ids).size) return "إحدى المراحل غير موجودة في هذا العقد";
  return null;
}

/** تطبيع قائمة المراحل القادمة: أعداد صحيحة موجودة بترتيب دون تكرار */
function parseStageIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const x of raw) {
    const n = Number(x);
    if (Number.isFinite(n) && n > 0 && !out.includes(Math.trunc(n))) out.push(Math.trunc(n));
  }
  return out;
}

/** بنود الكميات للعقد (غير المحذوفة ناعمًا) + المفوتر بالبند (ز1 — وقود منتقي الفواتير) */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const [items, invoicedBefore] = await Promise.all([
    db.boqItem.findMany({
      where: { contractId, deleted: false },
      include: {
        stage: { select: { id: true, name: true } },
        // سيناريو المالك 2026-11 — كل مراحل البند بالترتيب (الأساسية أولًا)
        stageLinks: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          select: { stage: { select: { id: true, name: true } } },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    // ز1 — المفوتر السابق لكل بند (من فواتير العميل غير الملغاة) — المتاح = qty − invoicedQty
    invoicedQtyByBoqItem(db, contractId),
  ]);
  return ok({
    items: items.map((it) => {
      // جدول الربط هو المصدر؛ والبنود القديمة (ما قبل الربط) تُشتق من stageId مباشرة
      const linked = it.stageLinks.length > 0
        ? it.stageLinks.map((l) => ({ id: l.stage.id, name: l.stage.name }))
        : it.stageId && it.stage
          ? [{ id: it.stage.id, name: it.stage.name }]
          : [];
      return {
      id: it.id,
      contractId: it.contractId,
      stageId: it.stageId,
      stageName: it.stage?.name || "",
      // سيناريو المالك 2026-11 — المراحل المرتبطة بالبند (الأساسية أولًا)
      stageLinks: linked,
      itemNo: it.itemNo,
      divisionCode: it.divisionCode,
      divisionName: it.divisionName,
      description: it.description,
      qty: Number(it.qty),
      unit: it.unit,
      unitPrice: Number(it.unitPrice),
      plannedQty: Number(it.plannedQty),
      // ب1 — نافذة البند المخططة المشتقة من البرنامج الزمني (عرض لا مصدر)
      plannedStart: it.plannedStart,
      plannedFinish: it.plannedFinish,
      amount: Number(it.amount),
      // ز1 — المفوتر بالبند والمتاح للفوترة الكمي
      invoicedQty: r3(invoicedBefore.get(it.id) || 0),
      availableQty: Math.max(0, r3(Number(it.qty) - (invoicedBefore.get(it.id) || 0))),
      sortOrder: it.sortOrder,
      };
    }),
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
  // الكمية المخططة للتنفيذ (عداد «مخطط» — بند NOVA 5) — اختيارية بأرضية صفر
  const plannedQty = Math.max(0, r3(Number(body.plannedQty) || 0));

  // ج1 المتبقي — نافذة البند المخططة عند الإضافة اليدوية (docs/schedule-import-design.md §8.2)
  const winData: Record<string, string> = {};
  if (body.plannedStart !== undefined || body.plannedFinish !== undefined) {
    const win = validatePlannedWindow(body.plannedStart, body.plannedFinish);
    if (!win.ok) return jsonError(win.error || "نافذة البند غير صالحة");
    if (win.value) Object.assign(winData, win.value);
  }

  // سيناريو المالك 2026-11 — مرحلة واحدة أو أكثر: stageIds[] (الأولى أساسية) مع مرآة stageId
  const stageIds = parseStageIds(body.stageIds);
  if (body.stageIds === undefined && body.stageId !== undefined && body.stageId !== null && body.stageId !== "") {
    const sid = Number(body.stageId);
    if (Number.isFinite(sid) && sid > 0) stageIds.push(Math.trunc(sid));
  }
  const stageErr = await validateStageIds(contractId, stageIds);
  if (stageErr) return jsonError(stageErr);
  const stageId = stageIds.length > 0 ? stageIds[0] : null;

  const max = await db.boqItem.aggregate({ where: { contractId }, _max: { sortOrder: true } });
  const item = await db.$transaction(async (tx) => {
    const created = await tx.boqItem.create({
      data: {
        contractId,
        stageId,
        itemNo: String(body.itemNo || "").trim(),
        divisionCode: String(body.divisionCode || "").trim(),
        divisionName: String(body.divisionName || "").trim(),
        description,
        qty,
        unit: String(body.unit || ""),
        unitPrice,
        plannedQty,
        amount,
        plannedStart: winData.plannedStart ?? "",
        plannedFinish: winData.plannedFinish ?? "",
        sortOrder: body.sortOrder !== undefined ? Math.trunc(Number(body.sortOrder)) : (max._max.sortOrder ?? -1) + 1,
      },
    });
    if (stageIds.length > 0) {
      await tx.boqItemStage.createMany({
        data: stageIds.map((sid, i) => ({ boqItemId: created.id, stageId: sid, sortOrder: i })),
      });
    }
    return created;
  });
  return ok({ item: { ...item, qty: Number(item.qty), unitPrice: Number(item.unitPrice), plannedQty: Number(item.plannedQty), amount: Number(item.amount) } }, 201);
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
  // ج1 المتبقي — النافذة المخططة للبند: التحقق عبر النواة (فارغ = إفراغ صريح)
  if (body.plannedStart !== undefined || body.plannedFinish !== undefined) {
    const win = validatePlannedWindow(body.plannedStart, body.plannedFinish);
    if (!win.ok) return jsonError(win.error || "نافذة البند غير صالحة");
    data.plannedStart = win.value?.plannedStart ?? "";
    data.plannedFinish = win.value?.plannedFinish ?? "";
  }
  if (body.itemNo !== undefined) data.itemNo = String(body.itemNo || "").trim();
  if (body.divisionCode !== undefined) data.divisionCode = String(body.divisionCode || "").trim();
  if (body.divisionName !== undefined) data.divisionName = String(body.divisionName || "").trim();
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
  if (body.plannedQty !== undefined) data.plannedQty = Math.max(0, r3(Number(body.plannedQty) || 0));
  if (body.qty !== undefined || body.unitPrice !== undefined || body.amount !== undefined) {
    data.amount = body.amount !== undefined && Number(body.amount) ? Number(body.amount) : qty * unitPrice;
  }
  if (body.sortOrder !== undefined) data.sortOrder = Math.trunc(Number(body.sortOrder) || 0);
  // سيناريو المالك 2026-11 — استبدال مراحل البند كاملة: stageIds[] (فارغة = فك كل الربط)
  if (body.stageIds !== undefined) {
    const stageIds = parseStageIds(body.stageIds);
    const stageErr = await validateStageIds(contractId, stageIds);
    if (stageErr) return jsonError(stageErr);
    data.stageId = stageIds.length > 0 ? stageIds[0] : null;
    await db.$transaction(async (tx) => {
      await tx.boqItem.update({ where: { id: itemId }, data });
      await tx.boqItemStage.deleteMany({ where: { boqItemId: itemId } });
      if (stageIds.length > 0) {
        await tx.boqItemStage.createMany({
          data: stageIds.map((sid, i) => ({ boqItemId: itemId, stageId: sid, sortOrder: i })),
        });
      }
    });
    return ok({ message: "تم تحديث مراحل البند" });
  }
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
