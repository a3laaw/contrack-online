import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { TX_OPTS } from "@/lib/journal-server";
import { createStockDocTx } from "@/lib/warehouses-server";
import {
  assertReceiptLine,
  cleanPurchaseDate,
  poReceivedAmountAfter,
  poStatusAfterReceipt,
  r3,
  RECEIVE_ENTRY_SOURCE,
} from "@/lib/purchase-core";

type P = { params: Promise<{ id: string }> };

/**
 * ر4 — «استلام» أمر الشراء (docs/purchase-design.md §5 د4 — قلب الموديول):
 * يستدعي دالة الإدخال القائمة `createStockDocTx` حرفيًا داخل المعاملة نفسها (G3/G5 —
 * صفر مسار كتابة ثانٍ) فتجفّ لقطة سعر الأمر إلى snapUnitCost ويُرحَّل قيد الإدخال
 * الائتماني (مدين 1160 / دائن 2111 باسم المورد) ويحسب المتوسط المرجحي محرك المخازن تلقائيًا.
 * • الاستلام جزئي أو كلي بكميات سطرية — والزيادة على المطلوب مرفوضة برسالة بالأرقام (د4)
 * • الأمر الملغى/المسودة/المستلم لا يُستلم — والمستلم يتولد من مجموع السطور اشتقاقيًا (G9)
 */

export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_purchase");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "purchase", "الشراء");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف غير صالح");

  const existing = await db.purchaseOrder.findUnique({
    where: { id },
    select: {
      id: true, poNumber: true, status: true, receivedAmount: true,
      supplier: { select: { id: true, name: true } },
      items: {
        select: {
          id: true, itemId: true, qty: true, receivedQty: true, unitPrice: true,
          item: { select: { id: true, name: true } },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!existing) return jsonError("أمر الشراء غير موجود", 404);
  // الاستلام على المُرسل للمورد والجزئي حصرًا (د3) — المسودة تُرسل أولًا والمستلم/الملغى نهائيان
  if (existing.status !== "مرسل للمورد" && existing.status !== "جزئي") {
    return jsonError(`الاستلام متاح على الأمر «مرسل للمورد» أو «جزئي» فقط — الحالة الحالية «${existing.status}».`, 400);
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const vdate = cleanPurchaseDate(body.vdate) || new Date().toISOString().slice(0, 10);
  const warehouseId = Number(body.warehouseId ?? 0) || 0;
  if (!warehouseId) return jsonError("يجب اختيار المستودع الذي يُدخل إليه الاستلام.", 400);
  const warehouse = await db.warehouse.findFirst({ where: { id: warehouseId }, select: { id: true, name: true, active: true } });
  if (!warehouse) return jsonError("المستودع غير موجود.", 400);
  if (!warehouse.active) return jsonError("المستودع غير نشط.", 400);

  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 300) : "";

  // د4 — الكميات: مرجعية سطر الأمر نفسه، موجبة، والمستلم + الجديد لا يتجاوز المطلوب
  const rawLines = Array.isArray(body.lines) ? (body.lines as Record<string, unknown>[]) : [];
  if (rawLines.length === 0) return jsonError("أضف كميات الاستلام لبند واحد على الأقل.", 400);
  const receiptByPoItem = new Map<number, { qty: number; note: string }>();
  for (const l of rawLines) {
    const poItemId = Number(l?.poItemId ?? 0) || 0;
    const qty = Number(l?.qty ?? 0) || 0;
    const line = existing.items.find((it) => it.id === poItemId);
    if (!line) return jsonError("بند الاستلام لا يعود لأمر الشراء هذا.", 400);
    const guardLine = assertReceiptLine(
      { itemId: line.itemId, itemName: line.item?.name, qty: Number(line.qty), receivedQty: Number(line.receivedQty), unitPrice: Number(line.unitPrice) },
      qty
    );
    if (!guardLine.ok) return jsonError(guardLine.error, 400);
    receiptByPoItem.set(poItemId, { qty, note: typeof l?.note === "string" ? l.note.trim().slice(0, 200) : "" });
  }

  const entryLines = existing.items
    .filter((it) => receiptByPoItem.has(it.id))
    .map((it) => {
      const r = receiptByPoItem.get(it.id)!;
      return {
        itemId: it.itemId,
        boqItemId: null as number | null,
        qty: r.qty,
        countedQty: 0,
        // لقطة سعر الشراء المجمدة على سطر الأمر (د1 الفلسفة — د2 المخازن محفوظة حرفيًا)
        snapUnitCost: Number(it.unitPrice),
        note: r.note || `استلام أمر شراء ${existing.poNumber}`,
      };
    });
  const receiptValue = r3(entryLines.reduce((s, l) => s + r3(l.qty * l.snapUnitCost), 0));

  const result = await db.$transaction(
    async (tx) => {
      // 1) إذن الإدخال الآلي عبر دالة المخازن القائمة — القيد والمتوسط المرجحي داخلها (صفر مسار ثانٍ)
      const doc = await createStockDocTx(tx, {
        kind: "entry",
        entrySource: RECEIVE_ENTRY_SOURCE, // ائتماني دائمًا — السداد عبر سند صرف المورد (د6)
        vdate,
        warehouseId,
        targetWarehouseId: null,
        contractId: null,
        contractNumber: null,
        party: existing.supplier.name, // لقطة اسم المورد على الإذن (نمط الإدخال الائتماني القائم)
        payAccountId: null,
        payAccountName: "",
        totalAmount: receiptValue,
        notes: notes || `استلام أمر شراء ${existing.poNumber} من ${existing.supplier.name}`,
        actor: guard.user.username,
        auditLabel: `استلام أمر شراء ${existing.poNumber}`,
        lines: entryLines,
      });
      // 2) ربط الإذن بالأمر (نمط saleInvoiceId حرفيًا)
      await tx.stockDoc.update({ where: { id: doc.docId }, data: { purchaseOrderId: id } });
      // 3) تراكم المستلم على سطور الأمر
      for (const [poItemId, r] of receiptByPoItem) {
        await tx.purchaseOrderItem.update({
          where: { id: poItemId },
          data: { receivedQty: { increment: r.qty } },
        });
      }
      // 4) الحالة وقيمة المستلم اشتقاقيًا من السطور بعد التراكم (G9 — بلا عدادات)
      const freshItems = await tx.purchaseOrderItem.findMany({
        where: { poId: id },
        select: { itemId: true, qty: true, receivedQty: true, unitPrice: true },
      });
      const nextStatus = poStatusAfterReceipt(
        freshItems.map((it) => ({ itemId: it.itemId, qty: Number(it.qty), receivedQty: Number(it.receivedQty), unitPrice: Number(it.unitPrice) }))
      );
      const nextReceived = poReceivedAmountAfter(
        freshItems.map((it) => ({ itemId: it.itemId, qty: Number(it.qty), receivedQty: Number(it.receivedQty), unitPrice: Number(it.unitPrice) })),
        []
      );
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: { status: nextStatus, receivedAmount: nextReceived },
        select: { id: true, poNumber: true, status: true, receivedAmount: true },
      });
      await audit(tx, {
        username: guard.user.username,
        action: `استلام أمر شراء (${nextStatus === "مستلم" ? "كامل" : "جزئي"})`,
        entityType: "purchase_order",
        entityId: updated.id,
        entityName: `${updated.poNumber} — إذن الإدخال ${doc.docNumber}`,
        oldStatus: existing.status,
        newStatus: updated.status,
      });
      return { docNumber: doc.docNumber, order: updated };
    },
    TX_OPTS
  );

  return ok({
    received: {
      docNumber: result.docNumber,
      status: result.order.status,
      receivedAmount: result.order.receivedAmount,
    },
  });
}
