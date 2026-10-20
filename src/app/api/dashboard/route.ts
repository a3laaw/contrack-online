import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { authGuard, ok } from "@/lib/api-utils";
import { hasPermission } from "@/lib/auth";
import { EPS, daysBetween, todayStr } from "@/lib/contrack-core";
import { getSettingsRow } from "@/lib/contrack-server";
import { loadContractsFinance, STATUS_CANCELLED, STATUS_CLOSED } from "@/lib/report-server";
import {
  buildExecutionAlertRows,
  expiryLevelsOrDefault,
  isFollowupCollection,
  isFollowupExpiring,
} from "@/lib/followup-alerts";
import { isEffectivelyEnabled } from "@/lib/feature-flags";
import { dailyClearing } from "@/lib/gateway-server";
import {
  ACTIVITY_EXPANDED,
  buildDashboardAlerts,
  contractLabelFrom,
  filterAlerts,
  type ActivityRow,
  type DashboardAlert,
} from "@/lib/dashboard-core";

/**
 * الرئيسية الكاملة (بند 7 من المرحلة 9) — GET /api/dashboard
 * مرآة DashboardPage.refresh المكتبي (main_window.py:272-420):
 * عدادات خام (عملاء/عقود/سندات) + تنبيهات النظام بالترتيب والألوان الحرفية
 * + صفوف النشاط (أحداث العقود والسندات) + مهام لوحة المهام المضمّنة.
 * أداء: استعلامات مجمعة بلا N+1 — خطة العقود والإشراف عبر loadContractsFinance لمرة واحدة.
 */

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** بصمة نص التنبيه — مرآة workflow_service.alert_key (sha1 ل UTF-8) */
function alertKey(text: string): string {
  return createHash("sha1").update(text || "", "utf8").digest("hex");
}

const SUP_EXCLUDED = [...STATUS_CLOSED, ...STATUS_CANCELLED];
const PLAN_EXCLUDED = [...STATUS_CLOSED, ...STATUS_CANCELLED];

export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const today = todayStr();
  const settings = await getSettingsRow();
  const alertDays = Math.max(7, settings.collectionAlertDays);
  const expiryWindow = expiryLevelsOrDefault(settings.expiryAlerts)[
    expiryLevelsOrDefault(settings.expiryAlerts).length - 1
  ];

  // ===== 1) العدادات الخام (contract_service.dashboard_stats + ui_data.dashboard_counts) =====
  // ملاحظة: «عدد المشاريع» المكتبية من جدول projects — لا نموذج مشاريع في الويب بعد
  // (بند 11 من قائمة المرحلة 9) فتعود صفرًا والبطاقة تتبع مفتاح المزايا.
  const [customersCount, contractsCount, vouchersCount, flagRows] = await Promise.all([
    db.customer.count(),
    db.contract.count(),
    db.voucher.count(),
    db.featureFlag.findMany({ where: { key: { in: ["comments", "followup"] } } }),
  ]);
  const storedFlags: Record<string, boolean> = {};
  for (const f of flagRows) storedFlags[f.key] = f.enabled;
  const commentsOn = isEffectivelyEnabled("comments", storedFlags);
  const followupOn = isEffectivelyEnabled("followup", storedFlags);

  // ===== 2) مالية العقود — تمريرة واحدة (خطة/تحصيل/إشراف/انتهاء/متوقف) =====
  const finances = await loadContractsFinance({});

  // 2-أ) عقود تنتهي قريبًا (lifecycle.expiring_contracts: يستبقي مغلق/ملغى/منتهي)
  const expiring = finances
    .filter((f) => {
      if (!isFollowupExpiring(f.status) || !f.endDate) return false;
      const left = daysBetween(today, f.endDate);
      return left >= 0 && left <= expiryWindow;
    })
    .map((f) => ({
      contractNumber: f.contractNumber,
      customerName: f.customerName,
      remaining: daysBetween(today, f.endDate),
      endDate: f.endDate,
    }))
    .sort((a, b) => a.remaining - b.remaining);

  // 2-ب) دفعات الخطة المتأخرة أو المستحقة خلال 7 أيام (overdue_plan_items strict=False)
  const planItems = finances
    .filter((f) => !PLAN_EXCLUDED.includes(f.status))
    .flatMap((f) =>
      f.planLines
        .filter(
          (l) =>
            l.remaining > EPS &&
            l.state !== "skipped" &&
            l.state !== "awaiting_stage" &&
            l.state !== "paid" &&
            l.daysDiff <= 7
        )
        .map((l) => ({
          title: l.title,
          customerName: f.customerName,
          contractNumber: f.contractNumber,
          remaining: l.remaining,
          daysDiff: l.daysDiff,
        }))
    )
    .sort((a, b) => a.daysDiff - b.daysDiff);

  // 2-ج) متابعة التحصيل (overdue_collections: يستبقي مغلق/ملغى/مسودة)
  const overdueCollections = finances
    .filter((f) => isFollowupCollection(f.status) && f.remaining > EPS)
    .map((f) => {
      const baseDate = f.lastReceiptDate || f.contractDate;
      const daysSince = baseDate ? daysBetween(baseDate, today) : 0;
      return {
        customerName: f.customerName,
        contractNumber: f.contractNumber,
        remaining: f.remaining,
        lastReceipt: f.lastReceiptDate || "",
        daysSince,
      };
    })
    .filter((o) => o.daysSince >= alertDays)
    .sort((a, b) => b.daysSince - a.daysSince);

  // 2-د) العقود المتوقفة (ui_data.paused_contracts)
  const paused = finances
    .filter((f) => f.status === "متوقف")
    .map((f) => ({ contractNumber: f.contractNumber, name: f.customerName }));

  // 2-هـ) الإشراف: قرب نهاية الأساس (30 يومًا) وتمديد قائم بمديونية
  const supLabels = new Map(
    finances.map((f) => [f.id, contractLabelFrom(f.contractName, f.description, f.contractDate)])
  );
  const nearBaseEnd: {
    customerName: string;
    label: string;
    daysLeft: number;
    baseEnd: string;
    monthly: number;
  }[] = [];
  const extensions: {
    customerName: string;
    label: string;
    baseEnd: string;
    billableExtension: number;
    extensionValue: number;
  }[] = [];
  for (const f of finances) {
    if (!f.isSup || !f.sup || !f.sup.baseEnd) continue;
    if (SUP_EXCLUDED.includes(f.status)) continue;
    // مرآة supervision_status: تاريخ الحساب = النهاية الفعلية إن كانت حاضرة
    const todayC = f.actualEnd && daysBetween(f.actualEnd, today) >= 0 ? f.actualEnd : today;
    const inExt = f.sup.baseEnd <= todayC;
    if (inExt) {
      // contracts_in_extension: التمديد القائم مع مديونية > 0.001 فقط
      if (f.sup.remaining > EPS) {
        extensions.push({
          customerName: f.customerName,
          label: supLabels.get(f.id) || "",
          baseEnd: f.sup.baseEnd,
          billableExtension: f.sup.billableExtMonths,
          extensionValue: f.sup.extensionValue,
        });
      }
    } else {
      // contracts_near_base_end: 0 ≤ (base_end − اليوم) ≤ 30 خارج التمديد
      const left = daysBetween(todayC, f.sup.baseEnd);
      if (left >= 0 && left <= 30) {
        nearBaseEnd.push({
          customerName: f.customerName,
          label: supLabels.get(f.id) || "",
          daysLeft: left,
          baseEnd: f.sup.baseEnd,
          monthly: f.supMonthly,
        });
      }
    }
  }
  nearBaseEnd.sort((a, b) => a.daysLeft - b.daysLeft);
  extensions.sort((a, b) => b.billableExtension - a.billableExtension);

  // ===== 3) تعليقات مثبّتة قديمة (comment_service.stale_pinned — 14 يومًا) =====
  let stalePinned: { customerName: string; ageDays: number; body: string }[] = [];
  if (commentsOn) {
    const since = new Date(Date.now() - 14 * 86_400_000);
    const pinnedRows = await db.comment.findMany({
      where: { pinned: true, isDeleted: false, createdAt: { lte: since } },
      select: { body: true, createdAt: true, customer: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
    stalePinned = pinnedRows.map((c) => ({
      customerName: c.customer.name,
      ageDays: Math.max(0, Math.floor((Date.now() - c.createdAt.getTime()) / 86_400_000)),
      body: c.body,
    }));
  }

  // ===== 4) الشيكات المستحقة خلال 7 أيام أو أقل (extras_service.due_cheques) =====
  const chequeRows = await db.voucher.findMany({
    where: { method: { contains: "شيك" }, chequeDueDate: { not: "" }, cancelled: false },
    select: { voucherNumber: true, vtype: true, party: true, amount: true, chequeDueDate: true },
  });
  const cheques = chequeRows
    .map((v) => ({
      vtype: v.vtype,
      voucherNumber: v.voucherNumber,
      party: v.party,
      amount: Number(v.amount),
      daysLeft: daysBetween(today, v.chequeDueDate),
      chequeDueDate: v.chequeDueDate,
    }))
    .filter((c) => !Number.isNaN(c.daysLeft) && c.daysLeft <= 7)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 25);

  // ===== 5) تسويات البوابة المتأخرة — بباب screen_gateway (V3.27) =====
  let lateSettlements: { gateway: string; day: string; expect: number; settleDate: string }[] = [];
  if (await hasPermission(guard.user.id, guard.user.role, "screen_gateway")) {
    const rows = (await dailyClearing(addDays(today, -60), today))
      .filter((r) => r.status === "late")
      .slice(0, 10);
    lateSettlements = rows.map((r) => ({
      gateway: r.gateway,
      day: r.day,
      expect: r.expect,
      settleDate: r.settle_date,
    }));
  }

  // ===== 6) مراحل التنفيذ — بمفتاح الميزة (main_window.py:349-359) =====
  let execution: Parameters<typeof buildDashboardAlerts>[0]["execution"] = [];
  if (followupOn) {
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
    execution = buildExecutionAlertRows(
      execContracts.map((c) => ({
        id: c.id,
        contractNumber: c.contractNumber,
        customerName: c.customer.name,
        status: c.status,
        stages: c.stages,
      })),
      today
    ).slice(0, 25);
  }

  // ===== 7) المهام — لوحة الرئيسية المضمّنة (task_service.list_tasks) =====
  const taskRows = await db.task.findMany({
    include: {
      customer: { select: { name: true } },
      contract: { select: { contractNumber: true } },
    },
    orderBy: [{ status: "desc" }, { dueAt: "asc" }],
    take: 500,
  });
  const nowMs = Date.now();
  const tasks = taskRows.map((t) => {
    const dueMs = new Date((t.dueAt || "").slice(0, 16).replace(" ", "T")).getTime();
    const minutesLeft = Number.isNaN(dueMs) ? 0 : Math.floor((dueMs - nowMs) / 60_000);
    return {
      id: t.id,
      title: t.title,
      details: t.details,
      dueAt: t.dueAt,
      remindMinutes: t.remindMinutes,
      taskType: t.taskType,
      status: t.status,
      doneAt: t.doneAt,
      minutesLeft,
      overdue: t.status !== "منجزة" && Number.isNaN(dueMs) === false && dueMs < nowMs,
      customerId: t.customerId,
      customerName: t.customer?.name || null,
      contractId: t.contractId,
      contractNumber: t.contract?.contractNumber || null,
    };
  });

  // ===== 8) النشاط الأخير (lifecycle.recent_activity — أحداث + سندات سارية) =====
  const [eventRows, voucherRows] = await Promise.all([
    db.contractEvent.findMany({
      orderBy: [{ eventTime: "desc" }, { id: "desc" }],
      take: ACTIVITY_EXPANDED,
      include: {
        contract: {
          select: {
            id: true,
            contractName: true,
            description: true,
            customer: { select: { id: true, name: true } },
          },
        },
      },
    }),
    db.voucher.findMany({
      where: { cancelled: false },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: ACTIVITY_EXPANDED,
      select: {
        createdAt: true,
        vdate: true,
        vtype: true,
        amount: true,
        description: true,
        contractId: true,
        contract: {
          select: {
            id: true,
            contractName: true,
            description: true,
            customer: { select: { id: true, name: true } },
          },
        },
      },
    }),
  ]);
  const activity: ActivityRow[] = [];
  for (const e of eventRows) {
    // V4.32: أحداث إنشاء السندات مكررة مع صفوف السندات — تُستبعد كالمكتبي
    if (e.eventType === "إنشاء سند قبض" || e.eventType === "إنشاء سند صرف") continue;
    activity.push({
      when: e.eventTime.toISOString(),
      kind: e.eventType || "حدث",
      text: e.description || "",
      amount: 0,
      sign: 0,
      contractId: e.contractId,
      customerId: e.contract?.customer?.id ?? null,
      customerName: e.contract?.customer?.name || "",
      contractLabel: e.contract?.contractName || e.contract?.description || "",
    });
  }
  for (const v of voucherRows) {
    const isReceipt = v.vtype === "receipt";
    activity.push({
      when: (v.createdAt ? v.createdAt.toISOString() : "") || v.vdate || "",
      kind: isReceipt ? "سند قبض" : "سند صرف",
      text: v.description || "",
      amount: Number(v.amount) || 0,
      sign: isReceipt ? 1 : -1,
      contractId: v.contractId,
      customerId: v.contract?.customer?.id ?? null,
      customerName: v.contract?.customer?.name || "",
      contractLabel: v.contract?.contractName || v.contract?.description || "",
    });
  }
  activity.sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
  activity.splice(ACTIVITY_EXPANDED);

  // ===== 9) بناء التنبيهات بالترتيب المكتبي + فلترة العمر والمخفاة =====
  const built: DashboardAlert[] = buildDashboardAlerts(
    {
      expiring,
      planItems,
      stalePinned,
      cheques,
      nearBaseEnd,
      extensions,
      lateSettlements,
      execution,
      overdueCollections,
      paused,
      overdueTasks: tasks.filter((t) => t.overdue).map((t) => ({ title: t.title, dueAt: t.dueAt })),
    },
    today
  ).map((a) => ({ ...a, key: alertKey(a.text) }));

  const dismissedRows = await db.dismissedAlert.findMany({
    where: { userId: guard.user.id },
    select: { alertKey: true },
  });
  const { fresh, hiddenCount } = filterAlerts(built, new Set(dismissedRows.map((r) => r.alertKey)));

  return ok({
    generatedAt: new Date().toISOString(),
    today,
    counts: {
      customers: customersCount,
      contracts: contractsCount,
      vouchers: vouchersCount,
      projects: 0, // لا نموذج مشاريع في الويب بعد — البطاقة تتبع مفتاح المزايا
    },
    alerts: fresh,
    alertsHidden: hiddenCount,
    dismissedCount: dismissedRows.length,
    activity,
    tasks,
  });
}
