import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { EPS, daysBetween, r3, todayStr } from "@/lib/contrack-core";
import { getSettingsRow } from "@/lib/contrack-server";
import { STATUS_CANCELLED, STATUS_CLOSED, loadContractsFinance } from "@/lib/report-server";

/**
 * شاشة المتابعة — GET /api/followup
 * يجمع: المستحق الآن (strict مع تفاصيل الخطوط المتأخرة)، تعريض التحصيل،
 * عقود تنتهي قريبًا، إشراف قريب من نهاية الأساس (30 يوم) — بحالات ألوان.
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const settings = await getSettingsRow();
  const alertDays = Math.max(7, settings.collectionAlertDays);
  const expiryWindow = Number((settings.expiryAlerts || "90,60,30,7").split(",")[0]) || 90;
  const today = todayStr();

  const finances = await loadContractsFinance({ excludeStatuses: STATUS_CANCELLED });

  // 1) المستحق الآن — صفوف مسطّحة لكل خط متأخر (FollowupDueRow[]) مع تفاصيل الخطوط
  const dueNowRows: {
    contractId: number; contractNumber: string; customerName: string;
    remaining: number; daysDiff: number; title?: string;
  }[] = [];
  let dueTotal = 0;
  for (const f of finances) {
    if (STATUS_CLOSED.includes(f.status)) continue;
    if (f.dueNow <= EPS) continue;
    const lateLines = f.planLines
      .filter((l) => l.remaining > EPS && l.state !== "skipped" && l.state !== "awaiting_stage" && l.daysDiff <= 0)
      .sort((a, b) => a.daysDiff - b.daysDiff || b.remaining - a.remaining);
    dueTotal = r3(dueTotal + f.dueNow);
    if (lateLines.length === 0) {
      // أمان: عقد عليه مستحق دون خطوط متأخرة مفصّلة
      dueNowRows.push({
        contractId: f.id, contractNumber: f.contractNumber, customerName: f.customerName,
        remaining: f.dueNow, daysDiff: 0,
      });
      continue;
    }
    for (const l of lateLines) {
      dueNowRows.push({
        contractId: f.id, contractNumber: f.contractNumber, customerName: f.customerName,
        remaining: l.remaining, daysDiff: l.daysDiff, title: l.title,
      });
    }
  }
  dueNowRows.sort((a, b) => a.daysDiff - b.daysDiff || b.remaining - a.remaining);

  // 2) تعريض التحصيل — متبقٍ وdaysSince(آخر قبض || تاريخ العقد) ≥ أيام التنبيه
  const overdueCollections = finances
    .filter((f) => f.remaining > EPS && (f.lastReceiptDate || f.contractDate))
    .map((f) => {
      const baseDate = f.lastReceiptDate || f.contractDate;
      const daysSince = daysBetween(baseDate, today);
      return {
        contractId: f.id, contractNumber: f.contractNumber,
        customerName: f.customerName,
        remaining: f.remaining, daysSince,
        lastReceiptDate: f.lastReceiptDate || undefined,
      };
    })
    .filter((x) => x.daysSince >= alertDays)
    .sort((a, b) => b.daysSince - a.daysSince);

  // 3) عقود تنتهي قريبًا (نافذة التنبيه من الإعدادات — الافتراضي 90 يومًا)
  const expiring = finances
    .filter((f) => {
      if (STATUS_CLOSED.includes(f.status)) return false;
      if (!f.endDate) return false;
      const left = daysBetween(today, f.endDate);
      return left >= 0 && left <= expiryWindow;
    })
    .map((f) => {
      const daysLeft = daysBetween(today, f.endDate);
      return {
        contractId: f.id, contractNumber: f.contractNumber,
        customerName: f.customerName,
        endDate: f.endDate, daysLeft,
      };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // 4) إشراف قريب من نهاية الأساس (30 يومًا — contracts_near_base_end)
  const nearBaseEnd = finances
    .filter((f) => {
      if (!f.isSup || !f.sup || !f.sup.baseEnd) return false;
      if (STATUS_CLOSED.includes(f.status)) return false;
      const left = daysBetween(today, f.sup.baseEnd);
      return left >= 0 && left <= 30;
    })
    .map((f) => {
      const sup = f.sup!;
      const daysLeft = daysBetween(today, sup.baseEnd);
      return {
        contractId: f.id, contractNumber: f.contractNumber,
        customerName: f.customerName,
        baseEnd: sup.baseEnd, daysLeft,
      };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);

  return ok({
    generatedAt: new Date().toISOString(),
    today,
    settings: { collectionAlertDays: alertDays, expiryWindow },
    dueNowTotal: dueTotal,
    dueNow: dueNowRows,
    overdueCollections,
    expiring,
    nearBaseEnd,
  });
}
