import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay } from "@/lib/api-utils";
import { LEAVE_TYPES, leaveDaysBetween } from "@/lib/consulting-constants";

/** GET: طلبات الإجازات مع المهندس — فلتر حالة اختياري */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;

  const status = req.nextUrl.searchParams.get("status") || "";
  const rows = await db.engineerLeave.findMany({
    where: status ? { status } : undefined,
    orderBy: [{ id: "desc" }],
    include: { engineer: { select: { name: true, specialty: true, status: true } } },
  });

  return ok({
    leaves: rows.map((l) => ({
      id: l.id,
      engineerId: l.engineerId,
      engineerName: l.engineer.name,
      engineerSpecialty: l.engineer.specialty,
      leaveType: l.leaveType,
      startDate: l.startDate,
      endDate: l.endDate,
      days: Number(l.days),
      status: l.status,
      reason: l.reason,
      decisionBy: l.decisionBy,
      decisionAt: l.decisionAt,
      decisionNote: l.decisionNote,
      createdAt: l.createdAt,
    })),
  });
}

/** POST: طلب إجازة — المهندس والنوع والفترة إلزامية والأيام تُحسب تلقائيًا شاملة الطرفين */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const engineerId = Number(body.engineerId) || 0;
  if (!engineerId) return jsonError("اختيار المهندس إلزامي");
  const engineer = await db.engineer.findUnique({ where: { id: engineerId }, select: { id: true } });
  if (!engineer) return jsonError("المهندس غير موجود", 404);

  const leaveType = String(body.leaveType || "");
  if (!(LEAVE_TYPES as readonly string[]).includes(leaveType)) return jsonError("نوع الإجازة غير معروف");

  const startDate = parseDay(body.startDate);
  if (!startDate) return jsonError("تاريخ بداية الإجازة غير صالح");
  const endDate = parseDay(body.endDate);
  if (!endDate) return jsonError("تاريخ نهاية الإجازة غير صالح");
  if (endDate < startDate) return jsonError("نهاية الإجازة قبل بدايتها");

  const days = leaveDaysBetween(startDate, endDate);
  if (days <= 0) return jsonError("أيام الإجازة غير صالحة");

  const created = await db.engineerLeave.create({
    data: {
      engineerId,
      leaveType,
      startDate,
      endDate,
      days,
      reason: String(body.reason || "").trim(),
      status: "معلقة",
    },
  });
  await audit(db, {
    username: guard.user.username,
    action: "طلب إجازة",
    entityType: "engineer_leave",
    entityId: created.id,
    entityName: `${leaveType} — ${startDate}`,
    newStatus: "معلقة",
  });
  return ok({ leave: created }, 201);
}
