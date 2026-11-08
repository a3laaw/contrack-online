// GET/POST /api/warehouses/items — الأصناف (بيانات أساسية)
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";

/** GET: الأصناف مع عدد أسطر الحركة (ذو حركة لا يُحذف) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_warehouses");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "warehouses", "المخازن");
  if (mg) return mg;

  const items = await db.stockItem.findMany({
    orderBy: { id: "desc" },
    select: { id: true, name: true, unit: true, category: true, minQty: true, active: true, notes: true, _count: { select: { docLines: true } } },
  });
  return ok({
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      category: i.category,
      minQty: Number(i.minQty),
      active: i.active,
      notes: i.notes,
      lineCount: i._count.docLines,
    })),
  });
}

/** POST: صنف جديد باسم فريد — الوحدة نص للعرض (بلا تحويلات وحدات — حدود التصميم) */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_warehouses");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "warehouses", "المخازن");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? "").trim();
  if (!name) return jsonError("اسم الصنف مطلوب");
  const unit = String(body.unit ?? "").trim();
  const category = String(body.category ?? "").trim();
  const notes = String(body.notes ?? "").trim();
  const minQtyRaw = Number(body.minQty ?? 0);
  const minQty = Number.isFinite(minQtyRaw) && minQtyRaw > 0 ? minQtyRaw : 0;

  const exists = await db.stockItem.findFirst({ where: { name }, select: { id: true } });
  if (exists) return jsonError("يوجد صنف بهذا الاسم بالفعل");

  const item = await db.stockItem.create({ data: { name, unit, category, minQty, notes } });
  await audit(db, {
    username: guard.user.username,
    action: "إنشاء",
    entityType: "stock_item",
    entityId: item.id,
    entityName: name,
  });
  return ok({ item }, 201);
}
