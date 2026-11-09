import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { deriveTakeoffRow, summarizeTakeoff } from "@/lib/field-execution-core";

type P = { params: Promise<{ id: string }> };

/**
 * مقايسة التنفيذ المشتقة (بند NOVA 5 — docs/field-execution-design.md):
 * كل العدادات الستة مشتقة من الصفوف لحظيًا (درس G9 — لا عدّاد مخزّن):
 * تعاقدي/مخطط/تغييري على مستوى البند · منفذ/موثق من سجلات field_executions ·
 * مفوتر على مستوى العقد حصرًا (Σ فواتير غير ملغاة).
 */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findFirst({ where: { id: contractId } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const [items, addParts, execAgg, docAgg, invoices, executions] = await Promise.all([
    db.boqItem.findMany({
      where: { contractId, deleted: false },
      include: { stage: { select: { name: true } } },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    // نصيب كل بند من الأوامر التغييرية المعتمدة — أجزاء add boq حصرًا (تصميم §1.1:
    // اعتماد الملحق ينشئ بندًا جديدًا ولا يزيد بندًا قائمًا، وrefKind=boq يمنع تصادم أجزاء plan)
    db.addendumItem.findMany({
      where: { addendum: { contractId, status: "معتمد", side: "client" }, action: "add", refKind: "boq" },
      select: { boqItemId: true, createdItemId: true, qty: true },
    }),
    db.fieldExecution.groupBy({ by: ["boqItemId"], where: { contractId }, _sum: { qty: true } }),
    db.fieldExecution.groupBy({ by: ["boqItemId"], where: { contractId, documented: true }, _sum: { qty: true } }),
    db.invoice.findMany({
      where: { contractId, status: { not: "void" } },
      select: { total: true, paidAmount: true },
    }),
    db.fieldExecution.findMany({
      where: { contractId },
      orderBy: [{ executionDate: "desc" }, { id: "desc" }],
      take: 15,
      include: {
        boqItem: { select: { description: true, unit: true } },
        attachment: { select: { fileName: true } },
      },
    }),
  ]);

  // خريطة التغييري: boqItemId وcreatedItemId كلاهما يشير للبند المنشأ بعد التطبيق — تُحسب مرة واحدة
  const changeByItem = new Map<number, number>();
  for (const p of addParts) {
    const q = Number(p.qty);
    if (p.boqItemId) changeByItem.set(p.boqItemId, (changeByItem.get(p.boqItemId) || 0) + q);
    if (p.createdItemId && p.createdItemId !== p.boqItemId) {
      changeByItem.set(p.createdItemId, (changeByItem.get(p.createdItemId) || 0) + q);
    }
  }
  const executedByItem = new Map<number, number>();
  for (const g of execAgg) executedByItem.set(g.boqItemId, Number(g._sum.qty || 0));
  const documentedByItem = new Map<number, number>();
  for (const g of docAgg) documentedByItem.set(g.boqItemId, Number(g._sum.qty || 0));

  const rows = items.map((it) => ({
    ...deriveTakeoffRow({
      boqItemId: it.id,
      qty: Number(it.qty),
      unitPrice: Number(it.unitPrice),
      plannedQty: Number(it.plannedQty),
      changeQty: changeByItem.get(it.id) || 0,
      executedQty: executedByItem.get(it.id) || 0,
      documentedQty: documentedByItem.get(it.id) || 0,
    }),
    description: it.description,
    unit: it.unit,
    stageName: it.stage?.name || "",
  }));

  const invoicedAmount = invoices.reduce((s, v) => s + Number(v.total), 0);
  const collectedAmount = invoices.reduce((s, v) => s + Number(v.paidAmount), 0);

  return ok({
    items: rows,
    totals: summarizeTakeoff(rows, invoicedAmount, collectedAmount),
    executions: executions.map((e) => ({
      id: e.id,
      boqItemId: e.boqItemId,
      description: e.boqItem.description,
      unit: e.boqItem.unit,
      executionDate: e.executionDate,
      qty: Number(e.qty),
      documented: e.documented,
      gpsLat: e.gpsLat,
      gpsLng: e.gpsLng,
      attachmentId: e.attachmentId,
      attachmentName: e.attachment?.fileName || "",
      note: e.note,
      createdBy: e.createdBy,
      createdAt: e.createdAt,
    })),
  });
}
