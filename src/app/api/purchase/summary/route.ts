import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, moduleGuard, ok } from "@/lib/api-utils";
import { purchaseKpis } from "@/lib/purchase-core";

/**
 * ر4 — مؤشرات الشراء (docs/purchase-design.md §5): الأوامر المفتوحة بقيمها ·
 * قيمة المستلم الكلية · الموردون النشطون — اشتقاقية بلا جداول عدادات (G9).
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_purchase");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "purchase", "الشراء");
  if (mg) return mg;

  const [orders, suppliers] = await Promise.all([
    db.purchaseOrder.findMany({ select: { status: true, totalAmount: true, receivedAmount: true, supplierId: true } }),
    db.supplier.findMany({ where: { active: true }, select: { id: true } }),
  ]);
  const summary = purchaseKpis([
    ...orders.map((o) => ({
      status: o.status,
      totalAmount: Number(o.totalAmount) || 0,
      receivedAmount: Number(o.receivedAmount) || 0,
      supplierId: o.supplierId,
      active: false, // الموردون يُحسبون من جدولهم — لا من الأوامر
    })),
    ...suppliers.map((s) => ({
      status: "",
      totalAmount: 0,
      receivedAmount: 0,
      supplierId: s.id,
      active: true,
    })),
  ]);
  return ok({ summary });
}
