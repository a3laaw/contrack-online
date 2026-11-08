// GET /api/warehouses/docs/[id] — تفاصيل إذن بالأسطر والقيد المرتبط (نمط السندات: القيد يعرض ويفتح)
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { r3 } from "@/lib/warehouses-constants";

type P = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_warehouses");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "warehouses", "المخازن");
  if (mg) return mg;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) return jsonError("معرّف غير صالح");

  const doc = await db.stockDoc.findFirst({
    where: { id },
    select: {
      id: true, docNumber: true, kind: true, entrySource: true, vdate: true,
      warehouseId: true, targetWarehouseId: true, contractId: true, party: true,
      payAccountName: true, totalAmount: true, status: true, cancelReason: true,
      cancelledAt: true, notes: true, createdBy: true, createdAt: true,
      warehouse: { select: { name: true } },
      targetWarehouse: { select: { name: true } },
      contract: { select: { id: true, contractNumber: true, contractName: true } },
      journalEntry: { select: { id: true, entryNo: true, status: true } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true, itemId: true, boqItemId: true, qty: true, countedQty: true,
          snapUnitCost: true, amount: true, note: true,
          item: { select: { name: true, unit: true, category: true } },
          boqItem: { select: { description: true } },
        },
      },
    },
  });
  if (!doc) return jsonError("الإذن غير موجود", 404);

  return ok({
    doc: {
      id: doc.id,
      docNumber: doc.docNumber,
      kind: doc.kind,
      entrySource: doc.entrySource,
      vdate: doc.vdate,
      warehouseId: doc.warehouseId,
      warehouseName: doc.warehouse.name,
      targetWarehouseId: doc.targetWarehouseId,
      targetWarehouseName: doc.targetWarehouse?.name ?? "",
      contractId: doc.contractId,
      contractNumber: doc.contract?.contractNumber ?? "",
      contractName: doc.contract?.contractName ?? "",
      party: doc.party,
      payAccountName: doc.payAccountName,
      totalAmount: r3(Number(doc.totalAmount)),
      status: doc.status,
      cancelReason: doc.cancelReason,
      cancelledAt: doc.cancelledAt,
      notes: doc.notes,
      createdBy: doc.createdBy,
      journal: doc.journalEntry ? { id: doc.journalEntry.id, entryNo: doc.journalEntry.entryNo, status: doc.journalEntry.status } : null,
      lines: doc.lines.map((l) => ({
        id: l.id,
        itemId: l.itemId,
        itemName: l.item.name,
        unit: l.item.unit,
        category: l.item.category,
        boqItemId: l.boqItemId,
        boqDescription: l.boqItem?.description ?? "",
        qty: r3(Number(l.qty)),
        countedQty: r3(Number(l.countedQty)),
        snapUnitCost: r3(Number(l.snapUnitCost)),
        amount: r3(Number(l.amount)),
        note: l.note,
      })),
    },
  });
}
