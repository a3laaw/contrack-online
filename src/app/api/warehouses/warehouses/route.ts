// GET/POST /api/warehouses/warehouses — المستودعات (بيانات أساسية — §7 قسم «الأصناف والمستودعات»)
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";

/** GET: المستودعات مع عدد الأذون (ذو حركة لا يُحذف) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_warehouses");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "warehouses", "المخازن");
  if (mg) return mg;

  const warehouses = await db.warehouse.findMany({
    orderBy: { id: "desc" },
    select: { id: true, name: true, location: true, active: true, notes: true, _count: { select: { sourceDocs: true } } },
  });
  return ok({
    warehouses: warehouses.map((w) => ({
      id: w.id,
      name: w.name,
      location: w.location,
      active: w.active,
      notes: w.notes,
      docCount: w._count.sourceDocs,
    })),
  });
}

/** POST: مستودع جديد باسم فريد */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_warehouses");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "warehouses", "المخازن");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? "").trim();
  if (!name) return jsonError("اسم المستودع مطلوب");
  const location = String(body.location ?? "").trim();
  const notes = String(body.notes ?? "").trim();

  const exists = await db.warehouse.findFirst({ where: { name }, select: { id: true } });
  if (exists) return jsonError("يوجد مستودع بهذا الاسم بالفعل");

  const warehouse = await db.warehouse.create({ data: { name, location, notes } });
  await audit(db, {
    username: guard.user.username,
    action: "إنشاء",
    entityType: "warehouse",
    entityId: warehouse.id,
    entityName: name,
  });
  return ok({ warehouse }, 201);
}
