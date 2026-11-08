import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay, todayStr } from "@/lib/api-utils";

const PERM_KINDS = ["late", "early"] as const;
const PERM_STATUSES = ["معلقة", "معتمدة", "مرفوضة"] as const;

/** GET: الأذونات — فلاتر month / employeeId / status (الأحدث أولًا — سقف 1000) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const month = req.nextUrl.searchParams.get("month") || "";
  const employeeId = Number(req.nextUrl.searchParams.get("employeeId")) || 0;
  const status = req.nextUrl.searchParams.get("status") || "";

  const where: Record<string, unknown> = {};
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) return jsonError("صيغة الشهر غير صالحة (YYYY-MM)");
    where.permDate = { gte: `${month}-01`, lte: `${month}-31` };
  }
  if (employeeId) where.employeeId = employeeId;
  if (status) {
    if (!(PERM_STATUSES as readonly string[]).includes(status)) return jsonError("حالة إذن غير معروفة");
    where.status = status;
  }

  const rows = await db.employeePermission.findMany({
    where,
    orderBy: [{ permDate: "desc" }, { id: "desc" }],
    take: 1000,
    include: { employee: { select: { name: true, jobTitle: true } } },
  });

  return ok({
    permissions: rows.map((p) => ({
      id: p.id,
      employeeId: p.employeeId,
      employeeName: p.employee.name,
      jobTitle: p.employee.jobTitle,
      permDate: p.permDate,
      kind: p.kind,
      kindLabel: p.kind === "late" ? "تأخير صباحي" : "انصراف مبكر",
      minutes: p.minutes,
      reason: p.reason,
      status: p.status,
      decisionBy: p.decisionBy,
      decisionAt: p.decisionAt,
      decisionNote: p.decisionNote,
    })),
  });
}

/** POST: طلب إذن جديد (معلقة) — علة إلزامية · مدة 5..240 دقيقة */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_hr");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "hr", "الموارد البشرية");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const employeeId = Number(body.employeeId);
  if (!Number.isFinite(employeeId)) return jsonError("اختر الموظف أولًا");
  const employee = await db.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return jsonError("الموظف غير موجود", 404);
  if (!employee.active) return jsonError("الموظف غير نشط — الأذونات للنشطين حصرًا");

  const kind = String(body.kind || "");
  if (!(PERM_KINDS as readonly string[]).includes(kind)) return jsonError("نوع الإذن: تأخير صباحي أو انصراف مبكر");

  const permDate = parseDay(body.permDate);
  if (!permDate) return jsonError("تاريخ الإذن غير صالح");
  if (permDate > todayStr()) return jsonError("لا يمكن طلب إذن بتاريخ مستقبلي");

  const minutes = Math.round(Number(body.minutes));
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 240) return jsonError("مدة الإذن بين 5 و240 دقيقة");

  const reason = String(body.reason || "").trim();
  if (!reason) return jsonError("علة الإذن إلزامية");

  const created = await db.employeePermission.create({
    data: { employeeId, permDate, kind, minutes, reason, status: "معلقة" },
  });
  await audit(db, {
    username: guard.user.username,
    action: "طلب إذن",
    entityType: "employee_permission",
    entityId: created.id,
    entityName: `${employee.name} — ${kind === "late" ? "تأخير" : "انصراف"} ${minutes} دقيقة`,
  });
  return ok({ permission: created }, 201);
}
