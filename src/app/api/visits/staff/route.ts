import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok, todayStr } from "@/lib/api-utils";

/** قائمة موظفي الزيارات — لكل موظف عدد زيارات اليوم */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_visits");
  if ("response" in guard) return guard.response;

  const today = todayStr();
  const [staff, todayVisits] = await Promise.all([
    db.visitStaff.findMany({ orderBy: [{ sort: "asc" }, { id: "asc" }] }),
    db.visit.groupBy({ by: ["staffId"], where: { visitDate: today }, _count: { _all: true } }),
  ]);

  const countMap = new Map(todayVisits.map((g) => [g.staffId, g._count._all]));

  return ok({
    staff: staff.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      active: s.active,
      sort: s.sort,
      todayVisits: countMap.get(s.id) || 0,
    })),
  });
}

/** إضافة موظف زيارات */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_visits");
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name || "").trim();
  if (!name) return jsonError("اسم الموظف مطلوب");

  const sortRaw = Number(body.sort);

  const created = await db.$transaction(async (tx) => {
    const staff = await tx.visitStaff.create({
      data: {
        name,
        phone: String(body.phone || ""),
        sort: Number.isFinite(sortRaw) ? Math.floor(sortRaw) : 0,
        active: true,
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "إنشاء",
      entityType: "visit_staff",
      entityId: staff.id,
      entityName: name,
    });
    return staff;
  });

  return ok({ staff: { id: created.id, name: created.name, phone: created.phone, active: created.active, sort: created.sort, todayVisits: 0 } }, 201);
}
