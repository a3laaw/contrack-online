import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok, parseDay } from "@/lib/api-utils";
import { EPS, r3 } from "@/lib/contrack-core";

type P = { params: Promise<{ id: string }> };

/**
 * التقرير اليومي المجَمَّع (docs/daily-report-forecast-design.md §2.2):
 * تجميع (عقد، تاريخ) فوق سجلات التنفيذ الميداني حصرًا — لا جدول جديد (نمط الاشتقاق G9):
 * كل سجلات ذلك اليوم (بند/كمية/موثق/ملاحظة/صورة/GPS) + مشتقات كل بند
 * (الفعّال، التراكمي الكلي بعد اليوم، قبل اليوم، النسبة) + ملخص اليوم + أحدث أيام النشاط.
 */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const date = parseDay(req.nextUrl.searchParams.get("date") || "");
  if (!date) return jsonError("تاريخ غير صالح — الصيغة YYYY-MM-DD");

  const contract = await db.contract.findFirst({
    where: { id: contractId },
    select: {
      id: true,
      contractNumber: true,
      contractName: true,
      customer: { select: { name: true } },
    },
  });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const [rawRows, addParts, totalAgg, beforeAgg, activeDateRows, dayVisits] = await Promise.all([
    db.fieldExecution.findMany({
      where: { contractId, executionDate: date },
      include: {
        boqItem: { select: { itemNo: true, description: true, unit: true, qty: true, unitPrice: true } },
        attachment: { select: { fileName: true } },
        // د1 — ربط الزيارات: «من دوّن وفي أي زيارة»
        visit: { select: { id: true, hourSlot: true, note: true, staff: { select: { name: true } } } },
      },
      orderBy: [{ boqItemId: "asc" }, { id: "asc" }],
    }),
    // نصيب كل بند من الأوامر التغييرية المعتمدة — كما في مقايسة التنفيذ
    db.addendumItem.findMany({
      where: { addendum: { contractId, status: "معتمد", side: "client" }, action: "add", refKind: "boq" },
      select: { boqItemId: true, createdItemId: true, qty: true },
    }),
    db.fieldExecution.groupBy({ by: ["boqItemId"], where: { contractId }, _sum: { qty: true } }),
    db.fieldExecution.groupBy({
      by: ["boqItemId"],
      where: { contractId, executionDate: { lt: date } },
      _sum: { qty: true },
    }),
    db.fieldExecution.findMany({
      where: { contractId },
      select: { executionDate: true },
      distinct: ["executionDate"],
      orderBy: { executionDate: "desc" },
      take: 14,
    }),
    // د1 — زيارات هذا العقد في ذلك اليوم (ربط الزيارات — المرتبطة والسجلات عائدة إليها)
    db.visit.findMany({
      where: { contractId, visitDate: date },
      include: {
        staff: { select: { name: true } },
        customer: { select: { name: true } },
        _count: { select: { executions: true } },
      },
      orderBy: { hourSlot: "asc" },
    }),
  ]);

  const changeByItem = new Map<number, number>();
  for (const p of addParts) {
    const q = Number(p.qty);
    if (p.boqItemId) changeByItem.set(p.boqItemId, (changeByItem.get(p.boqItemId) || 0) + q);
    if (p.createdItemId && p.createdItemId !== p.boqItemId) {
      changeByItem.set(p.createdItemId, (changeByItem.get(p.createdItemId) || 0) + q);
    }
  }
  const totalByItem = new Map<number, number>();
  for (const g of totalAgg) totalByItem.set(g.boqItemId, Number(g._sum.qty || 0));
  const beforeByItem = new Map<number, number>();
  for (const g of beforeAgg) beforeByItem.set(g.boqItemId, Number(g._sum.qty || 0));

  const rows = rawRows.map((e) => {
    const effectiveQty = Number(e.boqItem.qty) + (changeByItem.get(e.boqItemId) || 0);
    const executedTotal = totalByItem.get(e.boqItemId) || 0;
    const executedBefore = beforeByItem.get(e.boqItemId) || 0;
    return {
      id: e.id,
      boqItemId: e.boqItemId,
      itemNo: e.boqItem.itemNo,
      description: e.boqItem.description,
      unit: e.boqItem.unit,
      qty: Number(e.qty),
      unitPrice: Number(e.boqItem.unitPrice),
      documented: e.documented,
      note: e.note,
      gpsLat: e.gpsLat,
      gpsLng: e.gpsLng,
      attachmentId: e.attachmentId,
      attachmentName: e.attachment?.fileName || "",
      // د1 — الزيارة المرتبطة بالسجل إن وجدت
      visitId: e.visitId,
      visitHour: e.visit?.hourSlot || "",
      visitStaff: e.visit?.staff.name || "",
      visitNote: e.visit?.note || "",
      createdBy: e.createdBy,
      effectiveQty: r3(effectiveQty),
      executedTotal: r3(executedTotal),
      executedBefore: r3(executedBefore),
      progressPct: effectiveQty > EPS ? Math.min(100, r3((executedTotal / effectiveQty) * 100)) : 0,
    };
  });

  const summary = {
    records: rows.length,
    itemsTouched: new Set(rows.map((r) => r.boqItemId)).size,
    documentedRecords: rows.filter((r) => r.documented).length,
    dayAmount: r3(rows.reduce((s, r) => s + r.qty * r.unitPrice, 0)),
  };

  return ok({
    contractId,
    contractNumber: contract.contractNumber,
    contractName: contract.contractName,
    customerName: contract.customer.name,
    date,
    rows,
    summary,
    // د1 — زيارات العقد في ذلك اليوم (المعروضة بترويسة التقرير والمنتقي في الإدخال السريع)
    visits: dayVisits.map((v) => ({
      id: v.id,
      hourSlot: v.hourSlot,
      staffName: v.staff.name,
      customerName: v.customer?.name || "",
      note: v.note,
      executionsCount: v._count.executions,
    })),
    activeDates: activeDateRows.map((d) => d.executionDate),
  });
}
