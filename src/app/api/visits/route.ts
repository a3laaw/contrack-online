import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok, parseDay, todayStr } from "@/lib/api-utils";
import { HOUR_SLOT_RE, VISITS_CONFIG, buildHourSlots } from "@/lib/visits-server";

/** جدول الزيارات ليوم محدد — شبكة [ساعة][موظف] مع أسماء العملاء */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_visits");
  if ("response" in guard) return guard.response;

  const date = parseDay(req.nextUrl.searchParams.get("date")) || todayStr();

  const [staff, visits] = await Promise.all([
    db.visitStaff.findMany({ orderBy: [{ sort: "asc" }, { id: "asc" }] }),
    db.visit.findMany({
      where: { visitDate: date },
      include: {
        customer: { select: { id: true, name: true, customerCode: true } },
        task: { select: { id: true, title: true, status: true } },
      },
    }),
  ]);

  const hours = buildHourSlots();
  // الشبكة: cells[hourSlot][staffId] = بيانات الزيارة
  const cells: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const h of hours) cells[h] = {};
  for (const v of visits) {
    if (!cells[v.hourSlot]) continue; // خانة خارج ساعات العمل الحالية
    cells[v.hourSlot][String(v.staffId)] = {
      visitId: v.id,
      customerId: v.customerId,
      customerName: v.customer?.name || "",
      customerCode: v.customer?.customerCode || "",
      note: v.note,
      taskId: v.taskId,
      taskTitle: v.task?.title || "",
      taskStatus: v.task?.status || "",
      createdBy: v.createdBy,
    };
  }

  return ok({
    date,
    config: { ...VISITS_CONFIG },
    hours,
    cells,
    staff: staff.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      active: s.active,
      sort: s.sort,
      dayCount: visits.filter((v) => v.staffId === s.id).length,
    })),
    total: visits.length,
  });
}

/** جسم الحجز المشترك بين POST وPUT — upsert على unique(visitDate,hourSlot,staffId) */
async function upsertVisit(
  req: NextRequest,
  user: { username: string }
): Promise<ReturnType<typeof ok> | ReturnType<typeof jsonError>> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const visitDate = parseDay(body.visitDate);
  if (!visitDate) return jsonError("تاريخ الزيارة مطلوب بالصيغة YYYY-MM-DD");

  const hourSlot = String(body.hourSlot || "").trim();
  if (!HOUR_SLOT_RE.test(hourSlot)) return jsonError("خانة الساعة غير صالحة — الصيغة HH:mm");

  const staffId = Number(body.staffId) || 0;
  if (!staffId) return jsonError("اختيار الموظف مطلوب");
  const staff = await db.visitStaff.findUnique({ where: { id: staffId } });
  if (!staff) return jsonError("الموظف غير موجود", 404);
  if (!staff.active) return jsonError("لا يمكن الحجز لموظف معطل");

  const customerId = Number(body.customerId) || 0;
  if (customerId) {
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) return jsonError("العميل غير موجود", 404);
  }

  const note = String(body.note || "");
  const taskId = Number(body.taskId) || 0;

  const existing = await db.visit.findUnique({
    where: { visitDate_hourSlot_staffId: { visitDate, hourSlot, staffId } },
  });

  // الخانة الواحدة عميل واحد — الحجز فوق خانة مشغولة يتطلب force كالمصدر
  if (existing && body.force !== true) {
    return jsonError("الخانة محجوزة");
  }

  const data = {
    customerId: customerId || null,
    note,
    taskId: taskId || null,
  };

  const visit = await db.$transaction(async (tx) => {
    const row = existing
      ? await tx.visit.update({ where: { id: existing.id }, data })
      : await tx.visit.create({
          data: { visitDate, hourSlot, staffId, ...data, createdBy: user.username },
        });
    await audit(tx, {
      username: user.username,
      action: existing ? "تعديل زيارة" : "حجز زيارة",
      entityType: "visit",
      entityId: row.id,
      entityName: `${visitDate} ${hourSlot} — ${staff.name}`,
    });
    return row;
  });

  const customer = visit.customerId ? await db.customer.findUnique({ where: { id: visit.customerId } }) : null;

  return ok(
    {
      visit: {
        id: visit.id,
        visitDate: visit.visitDate,
        hourSlot: visit.hourSlot,
        staffId: visit.staffId,
        staffName: staff.name,
        customerId: visit.customerId,
        customerName: customer?.name || "",
        note: visit.note,
        taskId: visit.taskId,
      },
      updated: Boolean(existing),
    },
    existing ? 200 : 201
  );
}

export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_visits");
  if ("response" in guard) return guard.response;
  return upsertVisit(req, guard.user);
}

export async function PUT(req: NextRequest) {
  const guard = await authGuard(req, "screen_visits");
  if ("response" in guard) return guard.response;
  return upsertVisit(req, guard.user);
}

/** تفريغ خانة = حذف الصف كالمصدر — DELETE ?visitDate&hourSlot&staffId */
export async function DELETE(req: NextRequest) {
  const guard = await authGuard(req, "screen_visits");
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const visitDate = parseDay(sp.get("visitDate"));
  const hourSlot = (sp.get("hourSlot") || "").trim();
  const staffId = Number(sp.get("staffId")) || 0;
  if (!visitDate || !HOUR_SLOT_RE.test(hourSlot) || !staffId) {
    return jsonError("حدد visitDate وhourSlot وstaffId لتفريغ الخانة");
  }

  const visit = await db.visit.findUnique({
    where: { visitDate_hourSlot_staffId: { visitDate, hourSlot, staffId } },
    include: { staff: { select: { name: true } } },
  });
  if (!visit) return jsonError("الخانة فارغة بالفعل", 404);

  await db.$transaction(async (tx) => {
    await tx.visit.delete({ where: { id: visit.id } });
    await audit(tx, {
      username: guard.user.username,
      action: "تفريغ زيارة",
      entityType: "visit",
      entityId: visit.id,
      entityName: `${visitDate} ${hourSlot} — ${visit.staff.name}`,
    });
  });

  return ok({ deleted: true });
}
