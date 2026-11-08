// GET /api/warehouses/movements?itemId=&warehouseId= — كشف حركة صنف (كل الحركات المرتبة زمنيًا مع الرصيد الجاري)
// G9: الرصيد الجاري مشتق بالتراكم على نفس الأسطر — لا مصدر ثانٍ.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { r3 } from "@/lib/warehouses-constants";
import { docMovements } from "@/lib/warehouses-core";

export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_warehouses");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "warehouses", "المخازن");
  if (mg) return mg;

  const sp = req.nextUrl.searchParams;
  const itemId = Number(sp.get("itemId") ?? "");
  if (!Number.isFinite(itemId) || itemId <= 0) return jsonError("معرّف الصنف مطلوب");
  const warehouseId = Number(sp.get("warehouseId") ?? "") || null;

  const item = await db.stockItem.findFirst({ where: { id: itemId }, select: { id: true, name: true, unit: true } });
  if (!item) return jsonError("الصنف غير موجود", 404);

  const docs = await db.stockDoc.findMany({
    where: { status: "posted" },
    orderBy: [{ vdate: "asc" }, { id: "asc" }],
    select: {
      id: true, docNumber: true, kind: true, entrySource: true, vdate: true,
      warehouseId: true, targetWarehouseId: true, contractId: true, party: true,
      warehouse: { select: { name: true } },
      targetWarehouse: { select: { name: true } },
      contract: { select: { contractNumber: true } },
      lines: { where: { itemId }, select: { itemId: true, boqItemId: true, qty: true, countedQty: true, snapUnitCost: true, note: true } },
    },
  });

  const whName = (id: number) => {
    for (const d of docs) {
      if (d.warehouseId === id) return d.warehouse.name;
      if (d.targetWarehouseId === id) return d.targetWarehouse?.name ?? "";
    }
    return `#${id}`;
  };

  // الحركات المرشّحة بالصنف (والتوقيع يحدد الاتجاه) ثم التصفية بالمستودع إن طُلب
  type Row = {
    date: string; docId: number; docNumber: string; kind: string; kindLabel: string;
    warehouseId: number; warehouseName: string; direction: "in" | "out";
    qty: number; snapUnitCost: number; amount: number; contractNumber: string; party: string; note: string;
  };
  const KIND_LABELS: Record<string, string> = { entry: "إدخال", issue: "صرف", transfer: "تحويل", count: "جرد" };
  const rows: Row[] = [];
  for (const d of docs) {
    if (d.lines.length === 0) continue;
    const mvs = docMovements(
      {
        kind: d.kind as "entry" | "issue" | "transfer" | "count",
        entrySource: d.entrySource as "cash" | "credit" | "return" | "",
        vdate: d.vdate,
        warehouseId: d.warehouseId,
        targetWarehouseId: d.targetWarehouseId,
        contractId: d.contractId,
        payAccountId: null,
        status: "posted",
      },
      d.lines.map((l) => ({ itemId: l.itemId, boqItemId: l.boqItemId, qty: Number(l.qty), countedQty: Number(l.countedQty), snapUnitCost: Number(l.snapUnitCost), note: l.note }))
    );
    for (const m of mvs) {
      if (warehouseId && m.warehouseId !== warehouseId) continue;
      rows.push({
        date: m.date,
        docId: d.id,
        docNumber: d.docNumber,
        kind: d.kind,
        kindLabel: KIND_LABELS[d.kind] ?? d.kind,
        warehouseId: m.warehouseId,
        warehouseName: whName(m.warehouseId),
        direction: m.qty >= 0 ? "in" : "out",
        qty: r3(Math.abs(m.qty)),
        snapUnitCost: Math.abs(m.qty) > 0 ? r3(Math.abs(m.value) / Math.abs(m.qty)) : 0,
        amount: r3(Math.abs(m.value)),
        contractNumber: d.contract?.contractNumber ?? "",
        party: d.party,
        note: d.lines[0]?.note ?? "",
      });
    }
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.docId - b.docId));

  // الرصيد الجاري المشتق (تراكم التوقيع بالترتيب الزمني)
  let runningQty = 0;
  let runningValue = 0;
  const ledger = rows.map((r) => {
    runningQty = r3(runningQty + (r.direction === "in" ? r.qty : -r.qty));
    runningValue = r3(runningValue + (r.direction === "in" ? r.amount : -r.amount));
    return { ...r, balanceQty: runningQty, balanceValue: runningValue, wac: runningQty > 0 ? r3(runningValue / runningQty) : 0 };
  });

  return ok({ item: { id: item.id, name: item.name, unit: item.unit }, movements: ledger });
}
