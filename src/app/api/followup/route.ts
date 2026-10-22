import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { EPS, r3, todayStr } from "@/lib/contrack-core";
import { getSettingsRow } from "@/lib/contrack-server";
import { db } from "@/lib/db";
import { STATUS_CANCELLED, STATUS_CLOSED, loadContractsFinance } from "@/lib/report-server";
import { canViewAllOf, participantTxIds, TX_CONTRACT } from "@/lib/participants-server";
import { isSupervisionInExtension } from "@/lib/followup-alerts";
import {
  executionRows,
  expiringContractsRows,
  followupWindows,
  nearBaseEndRows,
  overdueCollectionsRows,
} from "@/lib/followup-sections";

/**
 * شاشة المتابعة — GET /api/followup
 * يجمع: المستحق الآن (strict مع تفاصيل الخطوط المتأخرة)، تعريض التحصيل،
 * عقود تنتهي قريبًا (بتدرّج مستويات التنبيه)، إشراف قريب من نهاية الأساس،
 * إشراف في حالة تمديد، وتنبيهات مراحل التنفيذ (متأخر/قارب) — بحالات ألوان.
 * الأقسام المشتركة تُحسب من نواة followup-sections (مصدر الحقيقة الواحد مع الرئيسية).
 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const settings = await getSettingsRow();
  const { alertDays, expiryWindow } = followupWindows(settings);
  const today = todayStr();

  // G2 — الرؤية على المتابعة: المدير/المطور/مالك شاشة العقود يرى الكل، وغيره يرى ما يشارك فيه فقط
  const seesAll = await canViewAllOf(guard.user, TX_CONTRACT);
  const visibleIds = seesAll ? null : await participantTxIds(guard.user.id, TX_CONTRACT);
  const vf = (contractId: number) => !visibleIds || visibleIds.has(contractId);

  const finances = await loadContractsFinance({ excludeStatuses: STATUS_CANCELLED });

  // 1) المستحق الآن — صفوف مسطّحة لكل خط متأخر (FollowupDueRow[]) مع تفاصيل الخطوط
  const dueNowRows: {
    contractId: number; contractNumber: string; customerName: string;
    remaining: number; daysDiff: number; title?: string;
  }[] = [];
  for (const f of finances) {
    if (STATUS_CLOSED.includes(f.status)) continue;
    if (f.dueNow <= EPS) continue;
    const lateLines = f.planLines
      .filter((l) => l.remaining > EPS && l.state !== "skipped" && l.state !== "awaiting_stage" && l.daysDiff <= 0)
      .sort((a, b) => a.daysDiff - b.daysDiff || b.remaining - a.remaining);
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

  // 2) تعثر التحصيل + 3) عقود تنتهي قريبًا + 4) إشراف قريب من نهاية الأساس — النواة المشتركة
  const overdueCollections = overdueCollectionsRows(finances, today, alertDays);
  const expiring = expiringContractsRows(finances, today, expiryWindow, settings.expiryAlerts);
  const nearBaseEnd = nearBaseEndRows(finances, today).map((r) => ({
    contractId: r.contractId,
    contractNumber: r.contractNumber,
    customerName: r.customerName,
    baseEnd: r.baseEnd,
    daysLeft: r.daysLeft,
  }));

  // 5) تمديد إشراف (GAP 2) — أساس الإشراف انتهى والتمديد ساري (مرحلة isSupervision)
  const supStages = await db.contractStage.findMany({
    where: {
      isSupervision: true,
      supEnd: { not: "" },
      contract: { status: { notIn: [...STATUS_CLOSED, ...STATUS_CANCELLED] } },
    },
    select: {
      contractId: true, supEnd: true, supActualEnd: true, supMonthly: true,
      sortOrder: true, id: true,
      contract: { select: { contractNumber: true, customer: { select: { name: true } } } },
    },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  const extensionByContract = new Map<number, (typeof supStages)[number]>();
  for (const st of supStages) {
    if (!isSupervisionInExtension({ isSupervision: true, supEnd: st.supEnd, supActualEnd: st.supActualEnd }, today)) continue;
    const prev = extensionByContract.get(st.contractId);
    // عقد بعدة مراحل إشراف: الأحدث بنهاية الأساس هي المعنية
    if (!prev || st.supEnd > prev.supEnd) extensionByContract.set(st.contractId, st);
  }
  const extension = [...extensionByContract.values()]
    .map((st) => ({
      contractId: st.contractId,
      contractNumber: st.contract.contractNumber,
      customerName: st.contract.customer.name,
      baseEnd: st.supEnd,
      actualEnd: st.supActualEnd || undefined,
      supMonthly: Number(st.supMonthly),
    }))
    .sort((a, b) => a.baseEnd.localeCompare(b.baseEnd) || a.contractId - b.contractId);

  // 6) تنبيهات مراحل التنفيذ (GAP 3) — نفس معيار تقرير مراحل التنفيذ الحرفي (النواة المشتركة)
  const execution = await executionRows();

  return ok({
    generatedAt: new Date().toISOString(),
    today,
    settings: { collectionAlertDays: alertDays, expiryWindow },
    dueNowTotal: r3(dueNowRows.filter((x) => vf(x.contractId)).reduce((s, x) => s + x.remaining, 0)),
    dueNow: dueNowRows.filter((x) => vf(x.contractId)),
    overdueCollections: overdueCollections.filter((x) => vf(x.contractId)),
    expiring: expiring.filter((x) => vf(x.contractId)),
    nearBaseEnd: nearBaseEnd.filter((x) => vf(x.contractId)),
    extension: extension.filter((x) => vf(x.contractId)),
    execution: execution.filter((x) => vf(x.contractId)),
  });
}
