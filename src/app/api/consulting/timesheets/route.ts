import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay } from "@/lib/api-utils";
import { MAX_DAY_HOURS, TIMESHEET_ACTIVITIES } from "@/lib/consulting-constants";
import { r3 } from "@/lib/contrack-core";

const MONTH_RE = /^\d{4}-\d{2}$/;

/** GET: الساعات — فلاتر month (YYYY-MM)/engineerId/contractId + تجميعات (بالأنشطة/بالمهندسين/بالعقود) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;

  const sp = req.nextUrl.searchParams;
  const month = (sp.get("month") || "").trim();
  if (month && !MONTH_RE.test(month)) return jsonError("صيغة الشهر يجب أن تكون YYYY-MM");
  const engineerId = Number(sp.get("engineerId")) || 0;
  const contractId = Number(sp.get("contractId")) || 0;

  const rows = await db.engineerTimesheet.findMany({
    where: {
      ...(month ? { workDate: { startsWith: `${month}-` } } : {}),
      ...(engineerId ? { engineerId } : {}),
      ...(contractId ? { contractId } : {}),
    },
    orderBy: [{ workDate: "desc" }, { id: "desc" }],
    take: 1000,
    include: {
      engineer: { select: { name: true, specialty: true } },
      contract: {
        select: { contractNumber: true, contractName: true, customer: { select: { name: true } } },
      },
    },
  });

  // ===== تجميعات من نفس المجموعة المفلترة (عرض لحظي — القوائم صغيرة) =====
  let totalHours = 0;
  const byEngineer = new Map<number, { engineerId: number; name: string; hours: number }>();
  const byContract = new Map<number, { contractId: number; label: string; hours: number }>();
  const byActivity = new Map<string, number>();

  for (const t of rows) {
    const h = Number(t.hours);
    totalHours += h;
    const e = byEngineer.get(t.engineerId) || { engineerId: t.engineerId, name: t.engineer.name, hours: 0 };
    e.hours += h;
    byEngineer.set(t.engineerId, e);
    if (t.contractId) {
      const c = byContract.get(t.contractId) || {
        contractId: t.contractId,
        label: `${t.contract?.contractNumber || ""} — ${t.contract?.contractName || ""}`.trim(),
        hours: 0,
      };
      c.hours += h;
      byContract.set(t.contractId, c);
    }
    const act = t.activity || "غير محدد";
    byActivity.set(act, (byActivity.get(act) || 0) + h);
  }

  return ok({
    entries: rows.map((t) => ({
      id: t.id,
      engineerId: t.engineerId,
      engineerName: t.engineer.name,
      contractId: t.contractId,
      contractNumber: t.contract?.contractNumber || "",
      contractName: t.contract?.contractName || "",
      customerName: t.contract?.customer?.name || "",
      workDate: t.workDate,
      hours: Number(t.hours),
      activity: t.activity,
      notes: t.notes,
    })),
    totals: {
      totalHours: r3(totalHours),
      byEngineer: [...byEngineer.values()]
        .map((x) => ({ ...x, hours: r3(x.hours) }))
        .sort((a, b) => b.hours - a.hours),
      byContract: [...byContract.values()]
        .map((x) => ({ ...x, hours: r3(x.hours) }))
        .sort((a, b) => b.hours - a.hours),
      byActivity: [...byActivity.entries()]
        .map(([activity, hours]) => ({ activity, hours: r3(hours) }))
        .sort((a, b) => b.hours - a.hours),
    },
  });
}

/** POST: تسجيل ساعات — المهندس والتاريخ والساعات إلزامية، والعقد اختياري (ساعات إدارية) */
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

  const workDate = parseDay(body.workDate);
  if (!workDate) return jsonError("تاريخ العمل غير صالح");

  const hours = Number(body.hours);
  if (!Number.isFinite(hours) || hours <= 0) return jsonError("الساعات يجب أن تكون رقمًا أكبر من صفر");
  if (hours > MAX_DAY_HOURS) return jsonError(`الساعات لا تتجاوز ${MAX_DAY_HOURS} في اليوم`);

  const activity = String(body.activity || "تصميم");
  if (!(TIMESHEET_ACTIVITIES as readonly string[]).includes(activity)) return jsonError("نوع النشاط غير معروف");

  let contractId: number | null = null;
  if (body.contractId !== undefined && body.contractId !== null && String(body.contractId) !== "") {
    const cid = Number(body.contractId) || 0;
    if (cid) {
      const contract = await db.contract.findUnique({ where: { id: cid }, select: { id: true } });
      if (!contract) return jsonError("العقد غير موجود", 404);
      contractId = cid;
    }
  }

  const created = await db.engineerTimesheet.create({
    data: {
      engineerId,
      contractId,
      workDate,
      hours,
      activity,
      notes: String(body.notes || "").trim(),
    },
  });
  await audit(db, {
    username: guard.user.username,
    action: "تسجيل ساعات",
    entityType: "engineer_timesheet",
    entityId: created.id,
    entityName: `${workDate} — ${activity}`,
  });
  return ok({ entry: created }, 201);
}
