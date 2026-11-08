// GET /api/warehouses/summary — بطاقات KPI أعلى شاشة المخازن (بنمط /api/hr/summary)
import { NextRequest } from "next/server";
import { authGuard, moduleGuard, ok } from "@/lib/api-utils";
import { loadBalances } from "@/lib/warehouses-server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_warehouses");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "warehouses", "المخازن");
  if (mg) return mg;

  const [stock, itemsCount, warehousesCount, docsThisMonth] = await Promise.all([
    loadBalances(),
    db.stockItem.count({ where: { active: true } }),
    db.warehouse.count({ where: { active: true } }),
    db.stockDoc.count({ where: { vdate: { gte: new Date().toISOString().slice(0, 7) + "-01" } } }),
  ]);

  const belowMin = stock.balances.filter((b) => b.belowMin).length;
  return ok({
    stockValue: stock.totals.value,
    activeItems: itemsCount,
    activeWarehouses: warehousesCount,
    belowMin,
    docsThisMonth,
  });
}
