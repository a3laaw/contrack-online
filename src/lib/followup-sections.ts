import { EPS, daysBetween, todayStr } from "@/lib/contrack-core";
import { db } from "@/lib/db";
import {
  buildExecutionAlertRows,
  expiryLevelsOrDefault,
  expiryTier,
  isFollowupCollection,
  isFollowupExpiring,
} from "@/lib/followup-alerts";
import { STATUS_CANCELLED, STATUS_CLOSED, type ContractFinance } from "@/lib/report-server";

/**
 * نواة حساب أقسام المتابعة المشتركة — مصدر الحقيقة الواحد (Task 84) لكل من:
 *   · GET /api/followup  — شاشة «المتابعة» + قسمي المستحق في «المهام المستحقة»
 *   · GET /api/dashboard — تغذية «🔔 التنبيهات والنشاطات» في الرئيسية
 * أي تعديل في قاعدة قسم يُكتب هنا فقط حتى لا تتفرق الأرقام بين الشاشات.
 *
 * ملاحظة معمارية موثقة — «تمديد الإشراف» مقصود خارج هذه النواة لأن المكتبي فيه ميزتان مختلفتان:
 *   · dashboard: تمديد قائم بمديونية (من finances.sup — بوابة remaining > EPS) لتوليد تنبيه نصي.
 *   · followup:  إشراف في حالة تمديد على مستوى المرحلة (isSupervisionInExtension — GAP 2) كقسم مستقل بلا شرط مديونية.
 */

/** نوافذ المتابعة من الإعدادات — مرآة المكتبي: max(7, collection_alert_days) وأكبر مستوى تنبيه انتهاء */
export function followupWindows(settings: { collectionAlertDays: number; expiryAlerts: string | undefined | null }) {
  const alertDays = Math.max(7, settings.collectionAlertDays);
  const levels = expiryLevelsOrDefault(settings.expiryAlerts);
  return { alertDays, expiryWindow: levels[levels.length - 1] };
}

/** تعثر التحصيل — متبقٍ > EPS وأيام منذ آخر قبض (أو تاريخ العقد) ≥ أيام التنبيه، بلا مسودة/مغلق/ملغى (lifecycle:5303) */
export function overdueCollectionsRows(finances: ContractFinance[], today: string, alertDays: number) {
  return finances
    .filter((f) => isFollowupCollection(f.status))
    .filter((f) => f.remaining > EPS && (f.lastReceiptDate || f.contractDate))
    .map((f) => {
      const baseDate = f.lastReceiptDate || f.contractDate;
      const daysSince = daysBetween(baseDate, today);
      return {
        contractId: f.id,
        contractNumber: f.contractNumber,
        customerName: f.customerName,
        remaining: f.remaining,
        daysSince,
        lastReceiptDate: f.lastReceiptDate || undefined,
      };
    })
    .filter((x) => x.daysSince >= alertDays)
    .sort((a, b) => b.daysSince - a.daysSince);
}

/** عقود تنتهي قريبًا — 0 ≤ الأيام المتبقية ≤ أكبر مستوى تنبيه، بلا مغلق/ملغى/منتهي (lifecycle:437) */
export function expiringContractsRows(
  finances: ContractFinance[],
  today: string,
  expiryWindow: number,
  expiryAlerts: string | undefined | null
) {
  return finances
    .filter((f) => {
      if (!isFollowupExpiring(f.status)) return false;
      if (!f.endDate) return false;
      const left = daysBetween(today, f.endDate);
      return left >= 0 && left <= expiryWindow;
    })
    .map((f) => {
      const daysLeft = daysBetween(today, f.endDate);
      return {
        contractId: f.id,
        contractNumber: f.contractNumber,
        customerName: f.customerName,
        endDate: f.endDate,
        daysLeft,
        tier: expiryTier(daysLeft, expiryAlerts),
      };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/**
 * إشراف قريب من نهاية الأساس (30 يومًا — contracts_near_base_end) — مرآة supervision_status:
 * تاريخ الحساب = النهاية الفعلية إن كانت حاضرة، والعقود داخل التمديد تُستبعد (هي قسم آخر).
 */
export function nearBaseEndRows(finances: ContractFinance[], today: string) {
  const rows: {
    contractId: number;
    contractNumber: string;
    customerName: string;
    baseEnd: string;
    daysLeft: number;
    monthly: number;
  }[] = [];
  for (const f of finances) {
    if (!f.isSup || !f.sup || !f.sup.baseEnd) continue;
    if (STATUS_CLOSED.includes(f.status) || STATUS_CANCELLED.includes(f.status)) continue;
    // مرآة supervision_status: تاريخ الحساب = النهاية الفعلية إن كانت حاضرة
    const todayC = f.actualEnd && daysBetween(f.actualEnd, today) >= 0 ? f.actualEnd : today;
    if (f.sup.baseEnd <= todayC) continue; // في حالة تمديد — ليس «قريب من نهاية الأساس»
    const left = daysBetween(todayC, f.sup.baseEnd);
    if (left >= 0 && left <= 30) {
      rows.push({
        contractId: f.id,
        contractNumber: f.contractNumber,
        customerName: f.customerName,
        baseEnd: f.sup.baseEnd,
        daysLeft: left,
        monthly: f.supMonthly,
      });
    }
  }
  return rows.sort((a, b) => a.daysLeft - b.daysLeft);
}

/** مراحل التنفيذ — نفس معيار تقرير مراحل التنفيذ الحرفي (بلا مسودة/مغلق/ملغى) — استعلام + بناء موحد */
export async function executionRows() {
  const execContracts = await db.contract.findMany({
    where: { status: { notIn: [...STATUS_CLOSED, ...STATUS_CANCELLED, "مسودة"] } },
    select: {
      id: true,
      contractNumber: true,
      status: true,
      customer: { select: { name: true } },
      stages: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { name: true, startDate: true, endDate: true, isSkipped: true, expectedDays: true },
      },
    },
  });
  return buildExecutionAlertRows(
    execContracts.map((c) => ({
      id: c.id,
      contractNumber: c.contractNumber,
      customerName: c.customer.name,
      status: c.status,
      stages: c.stages,
    })),
    todayStr()
  );
}
