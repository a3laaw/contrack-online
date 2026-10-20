"use client";

/**
 * الرئيسية الكاملة (بند 7 من المرحلة 9) — مرآة DashboardPage المكتبي بندًا بندًا:
 *   main_window.py:87-596 — عدادات خام · تغذية «🔔 التنبيهات والنشاطات» بألوان
 *   المكتبي ونصوصها الحرفية · «⚡ إجراءات سريعة» · لوحة المهام المضمّنة
 *   (TasksPage compact — ui/tasks.py:178) التي تختفي كليًا بمفتاح «المهام والتنبيهات».
 * الإخفاء/الاستعادة عبر مسارَي dismiss/restore ببصمة sha1 لنص التنبيه
 * (مرآة جرس المكتبي workflow_service.dismiss_alerts / restore_dismissed_alerts).
 */

import * as React from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPatch, apiPost } from "./api";
import type {
  DashboardActivityRow,
  DashboardAlertRow,
  DashboardResponse,
  DashboardTaskRow,
  User,
} from "./contrack-types";
import { isManagerRole, errMessage } from "./contrack-types";
import { permAllows, type PermsMap } from "./nav-perms";
import { useFeatureFlags } from "./FeatureFlagsProvider";
import { TaskEditPage } from "./TaskEditPage";
import {
  ACTIVITY_EXPANDED,
  ACTIVITY_HEX,
  ACTIVITY_ROWS,
  ALERT_HEX,
  DISMISS_CONFIRM_TEXT,
  DISMISS_CONFIRM_TITLE,
  EMPTY_FEED_CLASS,
  EMPTY_FEED_TEXT,
  activityBody,
  fSigned,
  pageSlice,
  restoredAlertsMessage,
  shortenTaskTitle,
  stripAlertPrefix,
  taskDueText,
  taskLeftText,
  taskSummaryText,
  taskTitleDisplay,
} from "@/lib/dashboard-core";
import { cn } from "@/lib/utils";

export type DashboardQuickAction =
  | "new_customer"
  | "new_contract"
  | "new_receipt"
  | "new_payment"
  | "new_subcontractor";

interface DashboardViewProps {
  user: User;
  onAuthError: () => void;
  perms: PermsMap | null;
  onQuickAction: (action: DashboardQuickAction) => void;
  onOpenContract: (id: number) => void;
  onOpenCustomerFile: (id: number) => void;
}

/** حبة التنبيه — لون النص وخلفية 10% وحد 30% كما _tint المكتبي (style.py) */
const ALERT_PILL: Record<DashboardAlertRow["color"], string> = {
  danger: "text-[#DC2626] bg-[rgba(220,38,38,0.10)] border-[rgba(220,38,38,0.30)]",
  warn: "text-[#D97706] bg-[rgba(217,119,6,0.10)] border-[rgba(217,119,6,0.30)]",
  info: "text-[#4F46E5] bg-[rgba(79,70,229,0.10)] border-[rgba(79,70,229,0.30)]",
  purple: "text-[#7C3AED] bg-[rgba(124,58,237,0.10)] border-[rgba(124,58,237,0.30)]",
  amber: "text-[#B45309] bg-[rgba(180,83,9,0.10)] border-[rgba(180,83,9,0.30)]",
};

type FeedItem =
  | { src: "alert"; alert: DashboardAlertRow }
  | { src: "activity"; row: DashboardActivityRow };

export function DashboardView({
  user,
  onAuthError,
  perms,
  onQuickAction,
  onOpenContract,
  onOpenCustomerFile,
}: DashboardViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const flags = useFeatureFlags();
  const tasksOn = flags.enabled("tasks");
  const projectsOn = flags.enabled("projects");
  const manager = isManagerRole(user.role);

  // ===== البيانات — مسار واحد محسّن + keepPreviousData عند التحديث =====
  const dashQuery = useQuery<DashboardResponse>({
    queryKey: ["dashboard"],
    queryFn: () => apiGet<DashboardResponse>("/api/dashboard"),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  React.useEffect(() => {
    const e = dashQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [dashQuery.error, onAuthError]);

  const data = dashQuery.data;
  const alerts = data?.alerts ?? [];
  const activity = data?.activity ?? [];
  const tasks = data?.tasks ?? [];

  // ===== التغذية المدمجة: التنبيهات أولًا ثم النشاط (8 أو 25) كالمكتبي =====
  const [expanded, setExpanded] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const feedItems = React.useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = alerts.map((a) => ({ src: "alert" as const, alert: a }));
    for (const row of activity.slice(0, expanded ? ACTIVITY_EXPANDED : ACTIVITY_ROWS)) {
      items.push({ src: "activity" as const, row });
    }
    return items;
  }, [alerts, activity, expanded]);
  const pageData = React.useMemo(() => pageSlice(feedItems, page), [feedItems, page]);

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }, [qc]);

  // ===== إخفاء/استعادة التنبيهات — بندا جرس المكتبي =====
  const [dismissOpen, setDismissOpen] = React.useState(false);
  const dismissMutation = useMutation({
    mutationFn: () => apiPost<{ dismissed: number }>("/api/dashboard/dismiss", { texts: alerts.map((a) => a.text) }),
    onSuccess: (res) => {
      setDismissOpen(false);
      invalidate();
      toast({ title: res.dismissed ? "تم إخفاء التنبيهات 🙈" : "لا تنبيهات ظاهرة" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر الإخفاء", description: errMessage(e) });
    },
  });
  const restoreMutation = useMutation({
    mutationFn: () => apiPost<{ restored: number }>("/api/dashboard/restore"),
    onSuccess: (res) => {
      invalidate();
      toast({ title: restoredAlertsMessage(res.restored) });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر الاستعادة", description: errMessage(e) });
    },
  });

  // ===== صفحة لوحة المهام (جديدة/تعديل/تحويل تنبيه) — تستبدل محتوى اللوحة =====
  const [taskPage, setTaskPage] = React.useState<{
    editing: DashboardTaskRow | null;
    preset?: { title?: string; details?: string } | null;
  } | null>(null);

  const convertAlertToTask = React.useCallback((text: string) => {
    setTaskPage({ editing: null, preset: { title: shortenTaskTitle(stripAlertPrefix(text)), details: text } });
  }, [setTaskPage]);

  const invalidateTasks = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  }, [qc]);

  // ===== بطاقات العدادات — specs المكتبي بترتيبه (main_window.py:135-152) =====
  const counters = React.useMemo(() => {
    const specs: { key: string; label: string; icon: string; value: number }[] = [
      { key: "customers", label: "عدد العملاء", icon: "👥", value: data?.counts.customers ?? 0 },
      { key: "contracts", label: "عدد العقود", icon: "📑", value: data?.counts.contracts ?? 0 },
    ];
    // V4.5.13: بطاقة «عدد المشاريع» تتبع مفتاح المزايا فعليًا
    if (projectsOn) specs.push({ key: "projects", label: "عدد المشاريع", icon: "🏗", value: data?.counts.projects ?? 0 });
    specs.push({ key: "vouchers", label: "عدد السندات", icon: "💵", value: data?.counts.vouchers ?? 0 });
    return specs;
  }, [data, projectsOn]);

  // ===== الإجراءات السريعة — specs المكتبي (main_window.py:190-199) =====
  const quickSpecs: { text: string; action: DashboardQuickAction }[] = [
    { text: "＋ تسجيل عميل", action: "new_customer" },
    { text: "＋ عقد جديد", action: "new_contract" },
    { text: "＋ سند قبض", action: "new_receipt" },
    { text: "＋ سند صرف", action: "new_payment" },
  ];
  if (permAllows(perms, "action_add_subcontractor", manager)) {
    quickSpecs.push({ text: "＋ مقاول باطن", action: "new_subcontractor" });
  }

  if (dashQuery.isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      </div>
    );
  }

  if (dashQuery.isError) {
    return (
      <Card className="border-status-danger/40">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <AlertTriangle className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{errMessage(dashQuery.error)}</p>
          <Button variant="outline" size="sm" className="h-9" onClick={() => dashQuery.refetch()}>
            <RefreshCw className="size-4" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ===== رأس الصفحة ===== */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">الرئيسية</h1>
        <Button
          variant="outline"
          size="icon"
          className="size-9"
          onClick={() => dashQuery.refetch()}
          aria-label="تحديث"
        >
          <RefreshCw className={dashQuery.isFetching ? "size-4 animate-spin" : "size-4"} />
        </Button>
      </div>

      {/* ===== بطاقات العدادات ===== */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {counters.map((c) => (
          <Card key={c.key} className="flex items-center gap-3 p-4">
            <span className="text-2xl leading-none" aria-hidden>
              {c.icon}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">{c.label}</p>
              <p className="text-lg font-bold tabular-nums" dir="ltr">
                {c.value}
              </p>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* ===== العمود الرئيسي: التغذية + الإجراءات السريعة ===== */}
        <div className="min-w-0 space-y-4">
          {/* 🔔 التنبيهات والنشاطات */}
          <Card className="p-4">
            <div className="mb-2 flex items-start justify-between gap-2">
              <h2 className="text-base font-bold">🔔 التنبيهات والنشاطات</h2>
              <div className="flex items-center gap-2">
                {(data.alertsHidden > 0 || data.dismissedCount > 0) && (
                  <span className="text-[11px] text-muted-foreground">
                    {data.alertsHidden > 0 ? `أُخفي ${data.alertsHidden} تنبيهًا أقدم من 30 يومًا — تفاصيلها في التقارير` : ""}
                  </span>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8" aria-label="خيارات التنبيهات">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuItem
                      disabled={alerts.length === 0 || dismissMutation.isPending}
                      onSelect={() => setDismissOpen(true)}
                    >
                      🙈 إخفاء كل التنبيهات النظامية
                    </DropdownMenuItem>
                    {data.dismissedCount > 0 && (
                      <DropdownMenuItem
                        disabled={restoreMutation.isPending}
                        onSelect={() => restoreMutation.mutate()}
                      >
                        ↩ إظهار التنبيهات المخفية
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {pageData.chunk.length === 0 ? (
              <p className={cn("rounded-[10px] px-4 py-3 text-sm font-bold", EMPTY_FEED_CLASS)}>
                {EMPTY_FEED_TEXT}
              </p>
            ) : (
              <ul className="max-h-[560px] space-y-1.5 overflow-y-auto pe-1">
                {pageData.chunk.map((it, idx) =>
                  it.src === "alert" ? (
                    <AlertRow
                      key={`a-${it.alert.key}-${idx}`}
                      alert={it.alert}
                      tasksOn={tasksOn}
                      onConvert={convertAlertToTask}
                    />
                  ) : (
                    <ActivityRowItem
                      key={`v-${it.row.kind}-${it.row.when}-${idx}`}
                      row={it.row}
                      onOpenContract={onOpenContract}
                      onOpenCustomerFile={onOpenCustomerFile}
                    />
                  )
                )}
              </ul>
            )}

            {/* تذييل: توسيع النشاط + شريط الترقيم */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {feedItems.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    setExpanded((v) => !v);
                    setPage(0);
                  }}
                >
                  {expanded ? "اختصار النشاط" : "توسيع النشاط"}
                </Button>
              )}
              <div className="ms-auto flex items-center gap-1">
                {pageData.total > 8 && (
                  <>
                    <Button variant="ghost" size="sm" className="h-8" disabled={pageData.page === 0} onClick={() => setPage(0)}>
                      الأولى
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8" disabled={pageData.page === 0} onClick={() => setPage(pageData.page - 1)} aria-label="السابق">
                      <ChevronRight className="size-4" />
                    </Button>
                    <span className="px-2 text-[11px] text-muted-foreground">{pageData.info}</span>
                    <Button variant="ghost" size="icon" className="size-8" disabled={pageData.page >= pageData.pages - 1} onClick={() => setPage(pageData.page + 1)} aria-label="التالي">
                      <ChevronLeft className="size-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8" disabled={pageData.page >= pageData.pages - 1} onClick={() => setPage(pageData.pages - 1)}>
                      الأخيرة
                    </Button>
                  </>
                )}
              </div>
            </div>
          </Card>

          {/* ⚡ الإجراءات السريعة */}
          <Card className="p-4">
            <p className="mb-2 text-sm font-extrabold">⚡ إجراءات سريعة:</p>
            <div className="flex flex-wrap gap-2">
              {quickSpecs.map((q) => (
                <Button key={q.action} variant="outline" size="sm" className="h-9" onClick={() => onQuickAction(q.action)}>
                  {q.text}
                </Button>
              ))}
            </div>
          </Card>
        </div>

        {/* ===== لوحة المهام المضمّنة — تختفي كليًا بمفتاح «المهام والتنبيهات» ===== */}
        {tasksOn && (
          <Card className="min-w-0 p-3 xl:w-[340px]">
            {taskPage ? (
              <TaskEditPage
                editing={taskPage.editing as never}
                preset={taskPage.preset ?? null}
                onAuthError={onAuthError}
                onSaved={invalidateTasks}
                onClose={() => setTaskPage(null)}
              />
            ) : (
              <DashboardTasksPanel
                tasks={tasks}
                onChanged={invalidateTasks}
                onAuthError={onAuthError}
                onEdit={(t) => setTaskPage({ editing: t })}
                onAdd={() => setTaskPage({ editing: null })}
              />
            )}
          </Card>
        )}
      </div>

      {/* تأكيد إخفاء التنبيهات — نص المكتبي الحرفي */}
      <Dialog open={dismissOpen} onOpenChange={setDismissOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{DISMISS_CONFIRM_TITLE}</DialogTitle>
            <DialogDescription className="whitespace-pre-line">{DISMISS_CONFIRM_TEXT}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDismissOpen(false)} disabled={dismissMutation.isPending}>
              تراجع
            </Button>
            <Button onClick={() => dismissMutation.mutate()} disabled={dismissMutation.isPending}>
              {dismissMutation.isPending ? "جارٍ الإخفاء…" : "إخفاء"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// صف تنبيه: حبة ملوّنة + زر «مهمة» (main_window.py:509-545)
// ============================================================

function AlertRow({
  alert,
  tasksOn,
  onConvert,
}: {
  alert: DashboardAlertRow;
  tasksOn: boolean;
  onConvert: (text: string) => void;
}) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={cn(
          "min-w-0 flex-1 whitespace-pre-wrap rounded-[10px] border px-3.5 py-2 text-[13px] font-bold leading-6",
          ALERT_PILL[alert.color] || ALERT_PILL.info
        )}
      >
        {alert.text}
      </span>
      {!alert.noConvert && tasksOn && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0"
          onClick={() => onConvert(alert.text)}
          title="تحويل التنبيه إلى مهمة"
        >
          مهمة
        </Button>
      )}
    </li>
  );
}

// ============================================================
// صف نشاط: شارة النوع + المكان والتفصيل + المبلغ الموقّع + الوقت
// النقر يفتح العقد أو ملف العميل (main_window.py:547-583)
// ============================================================

function ActivityRowItem({
  row,
  onOpenContract,
  onOpenCustomerFile,
}: {
  row: DashboardActivityRow;
  onOpenContract: (id: number) => void;
  onOpenCustomerFile: (id: number) => void;
}) {
  const color = row.sign > 0 ? ACTIVITY_HEX.in : row.sign < 0 ? ACTIVITY_HEX.out : ACTIVITY_HEX.neutral;
  const open = () => {
    if (row.contractId) onOpenContract(row.contractId);
    else if (row.customerId) onOpenCustomerFile(row.customerId);
  };
  return (
    <li
      className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 transition-colors hover:bg-muted/60"
      onClick={open}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") open();
      }}
    >
      <span
        className="shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold"
        style={{ color, backgroundColor: `${color}1A` }}
      >
        {row.kind}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px]">{activityBody(row)}</span>
      {row.amount != null && row.amount !== 0 && (
        <span className="shrink-0 text-[13px] font-extrabold tabular-nums" style={{ color }} dir="ltr">
          {fSigned(row.sign * row.amount)}
        </span>
      )}
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground" dir="ltr">
        {row.when.slice(0, 16).replace("T", " ")}
      </span>
    </li>
  );
}

// ============================================================
// لوحة المهام المضمّنة — TasksPage(compact=True) المكتبية:
// أعمدة المهمة/الموعد/المتبقي · إتمام/تعديل/إعادة · سطر الإجمالي
// ============================================================

interface TasksPanelProps {
  tasks: DashboardTaskRow[];
  onChanged: () => void;
  onAuthError: () => void;
  onEdit: (t: DashboardTaskRow) => void;
  onAdd: () => void;
}

function DashboardTasksPanel({ tasks, onChanged, onAuthError, onEdit, onAdd }: TasksPanelProps) {
  const { toast } = useToast();
  const [showDone, setShowDone] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);

  const visible = React.useMemo(
    () => (showDone ? tasks : tasks.filter((t) => t.status !== "منجزة")),
    [tasks, showDone]
  );
  const openCount = visible.filter((t) => t.status !== "منجزة").length;
  const overdueCount = visible.filter((t) => t.overdue).length;
  const selected = visible.find((t) => t.id === selectedId) ?? null;

  const toggleMutation = useMutation({
    mutationFn: (vars: { id: number; action: "complete" | "reopen" }) =>
      apiPatch(`/api/tasks/${vars.id}`, { action: vars.action }),
    onSuccess: (_res, vars) => {
      onChanged();
      toast({
        title: vars.action === "complete" ? "أُنجزت المهمة" : "أُعيد فتح المهمة",
      });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر تنفيذ الإجراء", description: errMessage(e) });
    },
  });

  /** مرآة _selected: بلا صف محدد ⇒ رسالة المكتبي الحرفية */
  const withSelected = (fn: (t: DashboardTaskRow) => void) => {
    if (!selected) {
      toast({ title: "اختر مهمة من الجدول أولاً." });
      return;
    }
    fn(selected);
  };

  return (
    <div className="space-y-2.5">
      {/* الرأس: 📌 المهام + المنجزة + جديدة */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold">📌 المهام</h2>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <Checkbox checked={showDone} onCheckedChange={(v) => setShowDone(v === true)} />
            المنجزة
          </label>
          <Button variant="outline" size="sm" className="h-8" onClick={onAdd} title="مهمة جديدة">
            + جديدة
          </Button>
        </div>
      </div>

      {/* الجدول: المهمة · الموعد · المتبقي */}
      <div className="max-h-80 overflow-y-auto rounded-lg border">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-muted/70 text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-2 text-start font-medium">المهمة</th>
              <th className="px-2 py-2 text-center font-medium">الموعد</th>
              <th className="px-2 py-2 text-center font-medium">المتبقي</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-xs text-muted-foreground">
                  لا مهام بعد — أضف أول مهمة بزر «+ جديدة»
                </td>
              </tr>
            ) : (
              visible.map((t) => {
                const done = t.status === "منجزة";
                const isSelected = t.id === selectedId;
                return (
                  <tr
                    key={t.id}
                    className={cn(
                      "cursor-pointer border-t transition-colors",
                      isSelected ? "bg-primary/10" : "hover:bg-muted/50",
                      done && "text-muted-foreground",
                      t.overdue && !done && "text-status-danger"
                    )}
                    onClick={() => setSelectedId(t.id)}
                    onDoubleClick={() => onEdit(t)}
                  >
                    <td className={cn("px-2 py-2 text-start leading-5", t.overdue && !done && "font-bold")}>
                      {taskTitleDisplay(t)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-center text-xs tabular-nums" dir="ltr">
                      {taskDueText(t.dueAt).text}
                    </td>
                    <td className={cn("whitespace-nowrap px-2 py-2 text-center text-xs", t.overdue && !done && "font-bold")}>
                      {taskLeftText(t)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* الأزرار: إتمام · ✎ تعديل · إعادة */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          className="h-8 border-0 bg-status-done-bg text-status-done hover:bg-status-done-bg/80"
          disabled={toggleMutation.isPending}
          onClick={() => withSelected((t) => toggleMutation.mutate({ id: t.id, action: "complete" }))}
          title="إتمام المهمة المحددة"
        >
          إتمام
        </Button>
        <Button variant="ghost" size="sm" className="h-8" onClick={() => withSelected(onEdit)} title="تعديل المهمة">
          ✎ تعديل
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8"
          disabled={toggleMutation.isPending}
          onClick={() => withSelected((t) => toggleMutation.mutate({ id: t.id, action: "reopen" }))}
          title="إعادة فتح مهمة منجزة"
        >
          إعادة
        </Button>
      </div>

      {/* سطر الإجمالي */}
      <p className="text-[11px] text-muted-foreground">{taskSummaryText(openCount, overdueCount)}</p>
    </div>
  );
}
