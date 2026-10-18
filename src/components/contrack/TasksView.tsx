"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CalendarClock,
  Check,
  Clock,
  FileText,
  ListTodo,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  User as UserIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiGet, apiPatch } from "./api";
import type {
  TaskItem,
  TaskNotificationsResponse,
  TasksResponse,
  User,
} from "./contrack-types";
import { errMessage } from "./contrack-types";
import { cn } from "@/lib/utils";
import { TaskEditPage } from "./TaskEditPage";

interface TasksViewProps {
  user: User;
  onAuthError: () => void;
}

type StatusTab = "all" | "open" | "done" | "late";

/** تطبيع بحثي بسيط (همزات/تاء مربوطة/ألف مقصورة) */
function normSearch(s: string): string {
  return s.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** دقائق حتى الموعد (سالب = فات) */
function minutesUntil(s: string): number {
  if (!s) return 0;
  const d = new Date(s.slice(0, 16).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return 0;
  return Math.round((d.getTime() - Date.now()) / 60000);
}

/** عرض الاستحقاق: اليوم/غدًا/التاريخ الكامل */
function fmtDueAt(s: string): string {
  if (!s) return "—";
  const date = s.slice(0, 10);
  const time = s.slice(11, 16);
  if (date === todayStr()) return `اليوم ${time}`;
  const tmr = new Date();
  tmr.setDate(tmr.getDate() + 1);
  const tomorrow = `${tmr.getFullYear()}-${pad2(tmr.getMonth() + 1)}-${pad2(tmr.getDate())}`;
  if (date === tomorrow) return `غدًا ${time}`;
  return `${date} ${time}`;
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <Card className="gap-1 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="size-4 shrink-0 text-primary/70" />
      </div>
      <p className={`text-base font-bold tabular-nums sm:text-lg ${tone || ""}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </Card>
  );
}

// ==================== الشاشة الرئيسية ====================

export function TasksView({ onAuthError }: TasksViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // ===== البيانات =====
  const listQuery = useQuery<TasksResponse>({
    queryKey: ["tasks"],
    queryFn: () => apiGet<TasksResponse>("/api/tasks"),
  });
  const items: TaskItem[] = listQuery.data?.tasks ?? listQuery.data?.items ?? [];

  React.useEffect(() => {
    const e = listQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [listQuery.error, onAuthError]);

  // ===== مؤشرات =====
  const today = todayStr();
  const openTasks = items.filter((t) => t.status !== "منجزة");
  const lateTasks = openTasks.filter((t) => minutesUntil(t.dueAt) < 0);
  const doneToday = items.filter((t) => t.status === "منجزة" && (t.doneAt || "").slice(0, 10) === today);

  // ===== فلاتر =====
  const [tab, setTab] = React.useState<StatusTab>("all");
  const [q, setQ] = React.useState("");
  const [fromDate, setFromDate] = React.useState("");
  const [toDate, setToDate] = React.useState("");

  const filtered = React.useMemo(() => {
    const needle = normSearch(q.trim());
    const rows = items.filter((t) => {
      const mins = minutesUntil(t.dueAt);
      if (tab === "open" && t.status === "منجزة") return false;
      if (tab === "done" && t.status !== "منجزة") return false;
      if (tab === "late" && !(t.status !== "منجزة" && mins < 0)) return false;
      const d = (t.dueAt || "").slice(0, 10);
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      if (needle) {
        const hay = normSearch(
          `${t.title} ${t.details} ${t.customerName ?? ""} ${t.contractNumber ?? ""}`
        );
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    // المفتوحة أولًا حسب الأقرب استحقاقًا، فالمنجزة حسب الأحدث إنجازًا
    return [...rows].sort((a, b) => {
      const aDone = a.status === "منجزة";
      const bDone = b.status === "منجزة";
      if (aDone !== bDone) return aDone ? 1 : -1;
      if (aDone && bDone) return (b.doneAt || "").localeCompare(a.doneAt || "");
      return (a.dueAt || "").localeCompare(b.dueAt || "");
    });
  }, [items, tab, q, fromDate, toDate]);

  // ===== إجراءات =====
  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }, [qc]);

  const toggleMutation = useMutation({
    mutationFn: (vars: { id: number; action: "complete" | "reopen" }) =>
      apiPatch<{ item?: TaskItem }>(`/api/tasks/${vars.id}`, { action: vars.action }),
    onSuccess: (_res, vars) => {
      invalidate();
      toast({
        title: vars.action === "complete" ? "أُنجزت المهمة" : "أُعيد فتح المهمة",
        description:
          vars.action === "complete" ? "يمكن التراجع بزر «إعادة الفتح»" : "عادت إلى قائمة المفتوحة",
      });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر تنفيذ الإجراء", description: errMessage(e) });
    },
  });

  const [deleteTarget, setDeleteTarget] = React.useState<TaskItem | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/tasks/${id}`),
    onSuccess: () => {
      setDeleteTarget(null);
      invalidate();
      toast({ title: "حُذفت المهمة" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر الحذف", description: errMessage(e) });
    },
  });

  // ===== محرك التذكير: فحص كل 60 ثانية + فحص أولي =====
  React.useEffect(() => {
    let cancelled = false;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const res = await apiGet<TaskNotificationsResponse>("/api/tasks/notifications");
        if (cancelled) return;
        const before = res.before ?? [];
        const after = res.after ?? [];
        for (const t of before) {
          toast({ title: `تذكير قبل موعد: ${t.title}`, description: `الاستحقاق: ${fmtDueAt(t.dueAt)}` });
          apiPatch(`/api/tasks/${t.id}`, { action: "notified", stage: "before" }).catch(() => {});
        }
        for (const t of after) {
          toast({
            variant: "destructive",
            title: `فوت موعد المهمة: ${t.title}`,
            description: `كان الاستحقاق: ${fmtDueAt(t.dueAt)}`,
          });
          apiPatch(`/api/tasks/${t.id}`, { action: "notified", stage: "after" }).catch(() => {});
        }
        if (before.length || after.length) qc.invalidateQueries({ queryKey: ["tasks"] });
      } catch {
        /* فحص دوري صامت — لا إزعاج عند تعذر الاتصال */
      } finally {
        busy = false;
      }
    };
    check();
    const timer = setInterval(check, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [toast, qc]);

  // ===== صفحة المهمة (جديدة/تعديل) — بلا مسار، استبدال في نفس المستوى =====
  const [taskPage, setTaskPage] = React.useState<{ editing: TaskItem | null } | null>(null);
  const openNew = () => setTaskPage({ editing: null });
  const openEdit = (t: TaskItem) => setTaskPage({ editing: t });

  // الصفحة تُركَّب مكان القائمة عند الفتح (بعد كل الـhooks)
  if (taskPage) {
    return (
      <TaskEditPage
        editing={taskPage.editing}
        onAuthError={onAuthError}
        onSaved={invalidate}
        onClose={() => setTaskPage(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* العنوان والإضافة */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold tracking-tight sm:text-xl">المهام والتذكيرات</h1>
          <p className="text-xs text-muted-foreground">
            مواعيد وتذكيرات بإشعارات قبل وبعد الاستحقاق
          </p>
        </div>
        <Button onClick={openNew} className="gap-1.5">
          <Plus className="size-4" />
          مهمة جديدة
        </Button>
      </div>

      {/* المؤشرات */}
      <div className="grid grid-cols-3 gap-3">
        <KpiCard icon={ListTodo} label="المفتوحة" value={String(openTasks.length)} tone="text-status-info" />
        <KpiCard
          icon={Check}
          label="منجزة اليوم"
          value={String(doneToday.length)}
          tone="text-status-done"
        />
        <KpiCard
          icon={Clock}
          label="متأخرة"
          value={String(lateTasks.length)}
          tone="text-status-danger"
          sub={lateTasks.length ? "تجاوزت موعد استحقاقها" : undefined}
        />
      </div>

      {/* الفلاتر */}
      <Card className="gap-3 p-3 sm:p-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as StatusTab)}>
          <TabsList className="h-9 w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="all">الكل ({items.length})</TabsTrigger>
            <TabsTrigger value="open">المفتوحة ({openTasks.length})</TabsTrigger>
            <TabsTrigger value="done">المنجزة ({items.length - openTasks.length})</TabsTrigger>
            <TabsTrigger value="late">المتأخرة ({lateTasks.length})</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
          <div className="relative">
            <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="بحث في العنوان/التفاصيل/العميل/العقد…"
              className="ps-8"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Label className="shrink-0 text-xs text-muted-foreground">من</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-9" />
          </div>
          <div className="flex items-center gap-1.5">
            <Label className="shrink-0 text-xs text-muted-foreground">إلى</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-9" />
          </div>
        </div>
      </Card>

      {/* القائمة */}
      {listQuery.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : listQuery.isError ? (
        <Card className="p-8 text-center text-sm text-destructive">
          تعذر تحميل المهام — {errMessage(listQuery.error)}
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center">
          <ListTodo className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm font-medium">
            {items.length === 0 ? "لا توجد مهام بعد" : "لا نتائج مطابقة للفلاتر"}
          </p>
          <p className="text-xs text-muted-foreground">
            {items.length === 0 ? "أضف مهمتك الأولى بزر «مهمة جديدة»" : "جرّب تعديل البحث أو تبويب الحالة"}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => {
            const done = t.status === "منجزة";
            const mins = minutesUntil(t.dueAt);
            const late = !done && mins < 0;
            const soon = !done && !late && mins <= 1440;
            const TypeIcon = t.taskType === "موعد" ? CalendarClock : Bell;
            return (
              <Card key={t.id} className={cn("p-3 sm:p-4", done && "opacity-70")}>
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg",
                      done
                        ? "bg-status-done-bg text-status-done"
                        : t.taskType === "موعد"
                          ? "bg-primary-soft text-primary-soft-foreground"
                          : "bg-status-info-bg text-status-info"
                    )}
                  >
                    <TypeIcon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={cn("text-sm font-bold", done && "line-through text-muted-foreground")}>
                        {t.title}
                      </span>
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                        {t.taskType}
                      </Badge>
                      {late && (
                        <Badge className="h-5 bg-status-danger-bg px-1.5 text-[10px] text-status-danger">
                          متأخرة
                        </Badge>
                      )}
                      {soon && (
                        <Badge className="h-5 bg-status-warn-bg px-1.5 text-[10px] text-status-warn">
                          قريبة
                        </Badge>
                      )}
                      {t.source === "جدول الزيارات" && (
                        <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
                          من الزيارات
                        </Badge>
                      )}
                    </div>
                    {t.details && (
                      <p className="line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">{t.details}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1",
                          late && "font-semibold text-status-danger"
                        )}
                      >
                        <Clock className="size-3" />
                        {fmtDueAt(t.dueAt)}
                      </span>
                      {t.customerName && (
                        <span className="inline-flex items-center gap-1">
                          <UserIcon className="size-3" />
                          {t.customerName}
                        </span>
                      )}
                      {t.contractNumber && (
                        <span className="inline-flex items-center gap-1" dir="ltr">
                          <FileText className="size-3" />
                          {t.contractNumber}
                        </span>
                      )}
                      {done && t.doneAt && <span>أُنجزت: {(t.doneAt || "").slice(0, 16)}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {done ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-status-warn hover:text-status-warn"
                        title="إعادة الفتح (تراجع)"
                        disabled={toggleMutation.isPending}
                        onClick={() => toggleMutation.mutate({ id: t.id, action: "reopen" })}
                      >
                        <RotateCcw className="size-4" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-status-done hover:text-status-done"
                        title="إنجاز"
                        disabled={toggleMutation.isPending}
                        onClick={() => toggleMutation.mutate({ id: t.id, action: "complete" })}
                      >
                        <Check className="size-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-foreground"
                      title="تعديل"
                      onClick={() => openEdit(t)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      title="حذف"
                      onClick={() => setDeleteTarget(t)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* تأكيد الحذف — نافذة صغيرة (بلا حقول) */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-destructive">حذف المهمة</DialogTitle>
            <DialogDescription>
              سيُحذف «{deleteTarget?.title}» وموعدها {deleteTarget ? fmtDueAt(deleteTarget.dueAt) : ""} نهائيًا.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteMutation.isPending}>
              تراجع
            </Button>
            <Button
              className="border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              حذف نهائي
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
