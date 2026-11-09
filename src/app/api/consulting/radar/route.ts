import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay, todayStr } from "@/lib/api-utils";
import { getUiPrefs } from "@/lib/ui-prefs";
import {
  HOUR_SLOT_RE,
  checkRadarBooking,
  isEngineerOnLeave,
  isValidRadarSlot,
  normalizeRadarSlotMinutes,
  radarSlotsFromWorkday,
} from "@/lib/consulting-radar-core";

/**
 * رادار مواعيد المهندسين (بند NOVA 4 — docs/consulting-radar-design.md):
 * الخانات مشتقة من إعدادات دوام الشركة (hrWorkStart/hrWorkEnd) ومدة الخانة من
 * uiPrefs.radar_slot_minutes — والحجز مرآة جدول الزيارات بلا خيار force.
 */

/** قراءة إعدادات الرادار: نطاق الدوام من إعدادات HR + مدة الخانة من uiPrefs */
async function readRadarConfig(companyId: number) {
  const setting = await db.setting.findUnique({ where: { companyId } });
  const workStart = setting?.hrWorkStart || "08:00";
  const workEnd = setting?.hrWorkEnd || "17:00";
  const { prefs } = await getUiPrefs();
  const slotMinutes = normalizeRadarSlotMinutes(prefs.radar_slot_minutes);
  return { workStart, workEnd, slotMinutes };
}

/** GET ?date=YYYY-MM-DD — شبكة اليوم: الخانات × المهندسون مع الخلايا المحجوزة */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;

  const date = parseDay(req.nextUrl.searchParams.get("date")) || todayStr();
  const config = await readRadarConfig(guard.user.companyId || 0);
  const slots = radarSlotsFromWorkday(config.workStart, config.workEnd, config.slotMinutes);

  const [engineers, appointments, onLeaveRows] = await Promise.all([
    db.engineer.findMany({
      where: { status: "نشط" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, specialty: true, jobTitle: true },
    }),
    db.engineerAppointment.findMany({
      where: { appointmentDate: date },
      include: {
        customer: { select: { name: true } },
        contract: { select: { contractNumber: true, contractName: true } },
        engineer: { select: { name: true } },
      },
    }),
    db.engineerLeave.findMany({
      where: { status: "معتمدة", startDate: { lte: date }, endDate: { gte: date } },
      select: { engineerId: true },
    }),
  ]);

  // الشبكة: cells[hourSlot][engineerId] = بيانات الموعد — والخانات خارج نطاق الدوام الحالي تُهمل
  const cells: Record<string, Record<number, Record<string, unknown>>> = {};
  for (const s of slots) cells[s] = {};
  for (const a of appointments) {
    if (!cells[a.hourSlot]) continue; // خانة خارج نطاق الدوام الحالي — كجدول الزيارات
    cells[a.hourSlot][a.engineerId] = {
      id: a.id,
      customerId: a.customerId,
      customerName: a.customer?.name || "",
      contractId: a.contractId,
      contractNumber: a.contract?.contractNumber || "",
      note: a.note,
      createdBy: a.createdBy,
    };
  }

  return ok({
    date,
    config,
    slots,
    engineers,
    cells,
    leaveEngineerIds: onLeaveRows.map((l) => l.engineerId),
    total: appointments.length,
  });
}

/** POST — حجز/تحديث موعد على unique(appointmentDate,hourSlot,engineerId) — بلا force */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const appointmentDate = parseDay(body.appointmentDate);
  if (!appointmentDate) return jsonError("تاريخ الموعد مطلوب بالصيغة YYYY-MM-DD");

  const hourSlot = String(body.hourSlot || "").trim();
  if (!HOUR_SLOT_RE.test(hourSlot)) return jsonError("خانة الساعة غير صالحة — الصيغة HH:mm");

  const engineerId = Number(body.engineerId) || 0;
  if (!engineerId) return jsonError("اختيار المهندس مطلوب");
  const engineer = await db.engineer.findUnique({ where: { id: engineerId } });
  if (!engineer) return jsonError("المهندس غير موجود", 404);
  if (engineer.status !== "نشط") return jsonError("المهندس غير نشط", 400);

  // الخانة يجب أن تقع ضمن نطاق دوام الشركة الحالي
  const config = await readRadarConfig(guard.user.companyId || 0);
  const slots = radarSlotsFromWorkday(config.workStart, config.workEnd, config.slotMinutes);
  if (!isValidRadarSlot(hourSlot, slots)) return jsonError("الخانة خارج نطاق الدوام", 400);

  // منع الحجز في يوم إجازة معتمدة
  const leaves = await db.engineerLeave.findMany({
    where: { engineerId, status: "معتمدة", startDate: { lte: appointmentDate }, endDate: { gte: appointmentDate } },
    select: { startDate: true, endDate: true, status: true },
  });
  if (isEngineerOnLeave(appointmentDate, leaves)) {
    return jsonError("المهندس في إجازة معتمدة هذا اليوم — اختر يومًا آخر", 409);
  }

  // التعارض خطأ صريح — لا خيار force (على خلاف جدول الزيارات)
  const existing = await db.engineerAppointment.findFirst({
    where: { appointmentDate, hourSlot, engineerId },
    include: { customer: { select: { name: true } } },
  });
  const chk = checkRadarBooking({
    slot: hourSlot,
    slots,
    engineerActive: true,
    onLeave: false,
    existing: existing ? { customerName: existing.customer?.name, engineerName: engineer.name } : null,
  });
  if (!chk.ok) {
    let msg = chk.error || "الخانة محجوزة";
    if (existing?.note) msg += ` — ملاحظة الحجز: ${existing.note}`;
    return jsonError(msg, 409);
  }

  const customerId = Number(body.customerId) || 0;
  if (customerId) {
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) return jsonError("العميل غير موجود", 404);
  }
  const contractId = Number(body.contractId) || 0;
  if (contractId) {
    const contract = await db.contract.findUnique({ where: { id: contractId } });
    if (!contract) return jsonError("العقد غير موجود", 404);
  }

  const note = String(body.note || "");
  const data = { customerId: customerId || null, contractId: contractId || null, note };

  const appointment = await db.$transaction(async (tx) => {
    const row = await tx.engineerAppointment.upsert({
      where: { appointmentDate_hourSlot_engineerId: { appointmentDate, hourSlot, engineerId } },
      update: data,
      create: { appointmentDate, hourSlot, engineerId, ...data, createdBy: guard.user.username },
    });
    await audit(tx, {
      username: guard.user.username,
      action: existing ? "تعديل موعد" : "حجز موعد",
      entityType: "engineer_appointment",
      entityId: row.id,
      entityName: `${appointmentDate} ${hourSlot} — ${engineer.name}`,
    });
    return row;
  });

  return ok(
    {
      appointment: {
        id: appointment.id,
        appointmentDate: appointment.appointmentDate,
        hourSlot: appointment.hourSlot,
        engineerId: appointment.engineerId,
        engineerName: engineer.name,
        customerId: appointment.customerId,
        contractId: appointment.contractId,
        note: appointment.note,
        createdBy: appointment.createdBy,
      },
      updated: Boolean(existing),
    },
    existing ? 200 : 201
  );
}

/** DELETE ?appointmentDate&hourSlot&engineerId — تفريغ الخانة (deleteMany مع count) */
export async function DELETE(req: NextRequest) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;

  const sp = req.nextUrl.searchParams;
  const appointmentDate = parseDay(sp.get("appointmentDate"));
  const hourSlot = (sp.get("hourSlot") || "").trim();
  const engineerId = Number(sp.get("engineerId")) || 0;
  if (!appointmentDate || !HOUR_SLOT_RE.test(hourSlot) || !engineerId) {
    return jsonError("حدد appointmentDate وhourSlot وengineerId لتفريغ الخانة");
  }

  const row = await db.engineerAppointment.findFirst({
    where: { appointmentDate, hourSlot, engineerId },
    include: { engineer: { select: { name: true } } },
  });
  if (!row) return ok({ deleted: 0 });

  const result = await db.engineerAppointment.deleteMany({ where: { appointmentDate, hourSlot, engineerId } });
  await audit(db, {
    username: guard.user.username,
    action: "تفريغ موعد",
    entityType: "engineer_appointment",
    entityId: row.id,
    entityName: `${appointmentDate} ${hourSlot} — ${row.engineer.name}`,
  });

  return ok({ deleted: result.count });
}
