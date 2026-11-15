import "server-only";
import { db } from "@/lib/db";
import { todayStr } from "@/lib/contrack-core";
import { STATUS_CANCELLED, STATUS_CLOSED, STATUS_DRAFT } from "@/lib/report-server";
import { NOTIF_DAILY_REPORT, notifyTargets, pushNotifications } from "./notification-server";

/**
 * التقرير اليومي الإلزامي للميدان (قرار المالك 2026-11):
 * «شروط الزياره اليوميه للميدان او التقرير اليومي اجباري اذا لم يتم عمله في يوم
 * لازم يظهر اجباري اما المستخدم ومدير المشاريع والمتابعين — يوجد تقرير من الموقع
 * الفلاني لم يتم اليوم».
 *
 * اشتقاقي بلا جداول جديدة (G9): «تم تقرير الموقع اليوم» = يوجد سجل تنفيذ ميداني
 * FieldExecution على العقد بتاريخ اليوم — نفس مصدر التقرير اليومي المجمع
 * (api/contracts/[id]/daily-report) فلا تتفرق الأرقام.
 *
 * على من يُنتظر التقرير: العقد الحي (ليس مسودة/ملغى/مغلق/متوقف) الذي بدأ تنفيذه
 * (startDate ≤ اليوم) ولم ينته (endDate فارغ أو ≥ اليوم) — الموقع المتوقف أو ما
 * قبل البدء أو المكتمل لا يُطالب.
 */

export interface MissingDailyReportRow {
  contractId: number;
  contractNumber: string;
  /** اسم الموقع — اسم العقد أو وصفه (نفس contractLabelFrom بلا بادئة «عقد») */
  label: string;
  customerName: string;
}

/** العقود الحية المطالبة بتقرير اليوم ناقص ما سُجل اليوم — نصوص التنبيه تشتق منها */
export async function missingDailyReports(today = todayStr()): Promise<MissingDailyReportRow[]> {
  const rows = await db.contract.findMany({
    where: {
      status: { notIn: [...STATUS_DRAFT, ...STATUS_CANCELLED, ...STATUS_CLOSED, "متوقف"] },
      startDate: { not: "", lte: today },
      OR: [{ endDate: "" }, { endDate: { gte: today } }],
    },
    select: {
      id: true,
      contractNumber: true,
      contractName: true,
      description: true,
      customer: { select: { name: true } },
    },
  });
  const reported = await db.fieldExecution.findMany({
    where: { executionDate: today },
    select: { contractId: true },
    distinct: ["contractId"],
  });
  const done = new Set(reported.map((r) => r.contractId));
  return rows
    .filter((c) => !done.has(c.id))
    .map((c) => ({
      contractId: c.id,
      contractNumber: c.contractNumber,
      label: (c.contractName || c.description || "").trim() || `العقد ${c.contractNumber}`,
      customerName: c.customer.name,
    }));
}

/**
 * دفع إشعار الجرس مرة واحدة في اليوم لكل موقع ناقص — إلى المشاركين في العقد
 * (المستخدم ومدير المشاريع والمتابعين — G2 المشاركة = الرؤية) وكل المديرين،
 * بلا المنفِّذ. الحرس: إشعار بنفس النص لهذا العقد اليوم = لا تكرار.
 */
export async function enforceDailyReportNotifications(actorUserId: number, missing: MissingDailyReportRow[]): Promise<number> {
  if (missing.length === 0) return 0;
  const dayStart = new Date(`${todayStr()}T00:00:00`);
  let pushed = 0;
  for (const m of missing) {
    const text = `📍 يوجد تقرير من الموقع «${m.label}» · ${m.customerName} لم يتم اليوم`;
    const exists = await db.appNotification.findFirst({
      where: {
        type: NOTIF_DAILY_REPORT,
        transactionType: "contract",
        transactionId: m.contractId,
        createdAt: { gte: dayStart },
      },
      select: { id: true },
    });
    if (exists) continue;
    const targets = await notifyTargets(actorUserId, "contract", m.contractId);
    pushed += await pushNotifications(db, {
      targets,
      transactionType: "contract",
      transactionId: m.contractId,
      type: NOTIF_DAILY_REPORT,
      text,
    });
  }
  return pushed;
}
