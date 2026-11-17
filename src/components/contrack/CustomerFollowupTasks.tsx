"use client";

/**
 * FollowupTasksPanel — ر2 «ملف العميل الموحّد» (قرار المالك):
 * مهام المتابعة المرتبطة بالعميل داخل تبويب «التعليقات والمتابعة» —
 * قائمة مفتوحة/منجزة + إنجاز/إعادة فتح + حذف + إضافة سريعة.
 * الصلاحية screen_tasks مفتوحة سلفًا في المهام — عند عدم توفرها تُخفى اللوحة بلطف (403).
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, ListTodo, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "./api";
import type { TaskItem, TasksResponse } from "./contrack-types";

/** اللحظة الحالية بصيغة «YYYY-MM-DD HH:mm» بتوقيت الكويت (UTC+3) — للمقارنة النصية */
function nowKwStamp(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
}

export function CustomerFollowupTasks({
  customerId,
  onAuthError,
  onError,
}: {
  customerId: number;
  onAuthError: () => void;
  onError: (e: unknown, fallback: string) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const tasksQuery = useQuery<TasksResponse>({
    queryKey: ["customer-file", customerId, "tasks"],
    queryFn: () => apiGet<TasksResponse>(`/api/tasks?customerId=${customerId}`),
    retry: false,
  });

  const all = tasksQuery.data?.tasks ?? [];
  const open = all
    .filter((t) => t.status === "مفتوحة")
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const done = all
    .filter((t) => t.status === "منجزة")
    .sort((a, b) => (b.doneAt || b.dueAt).localeCompare(a.doneAt || a.dueAt));

  const refresh = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["customer-file", customerId, "tasks"] });
  }, [qc, customerId]);

  const toggleTask = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "complete" | "reopen" }) =>
      apiPatch(`/api/tasks/${id}`, { action }),
    onSuccess: () => refresh(),
    onError: (e) => onError(e, "تعذر تحديث المهمة"),
  });

  const deleteTask = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/tasks/${id}`),
    onSuccess: () => {
      toast({ title: "تم حذف المهمة" });
      refresh();
    },
    onError: (e) => onError(e, "تعذر حذف المهمة"),
  });

  // إضافة سريعة: عنوان + موعد (نوع افتراضي «تذكير»)
  const [title, setTitle] = React.useState("");
  const [due, setDue] = React.useState("");

  const addTask = useMutation({
    mutationFn: () =>
      apiPost("/api/tasks", {
        customerId,
        title: title.trim(),
        dueAt: due.replace("T", " "),
        taskType: "تذكير",
      }),
    onSuccess: () => {
      setTitle("");
      setDue("");
      toast({ title: "تمت إضافة المهمة" });
      refresh();
    },
    onError: (e) => onError(e, "تعذر إضافة المهمة"),
  });

  React.useEffect(() => {
    if (tasksQuery.error instanceof ApiError && tasksQuery.error.status === 401) onAuthError();
  }, [tasksQuery.error, onAuthError]);

  // صلاحية المهام غير متاحة لهذا المستخدم — إخفاء بلطف دون كسر ملف العميل
  if (tasksQuery.isError) {
    const st = (tasksQuery.error as { status?: number }).status;
    if (st && st !== 401) return null;
  }

  const canSubmit = title.trim().length > 0 && due !== "";
  const nowStamp = nowKwStamp();
  const busy = toggleTask.isPending || deleteTask.isPending;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-bold">
            <ListTodo className="size-4 text-primary-ink" />
            مهام المتابعة
          </h3>
          <span className="text-xs text-muted-foreground">
            {open.length} مفتوحة · {done.length} منجزة
          </span>
        </div>

        {/* إضافة سريعة */}
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1 space-y-1">
            <Input
              className="h-9"
              placeholder="مهمة متابعة — مثال: اتصال بمتابعة العرض"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <Input
            type="datetime-local"
            dir="ltr"
            className="h-9 w-56"
            aria-label="موعد المهمة"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
          <Button className="h-9 gap-1.5" disabled={!canSubmit || addTask.isPending} onClick={() => addTask.mutate()}>
            <Plus className="size-4" />
            إضافة
          </Button>
        </div>

        {tasksQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 w-full animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : all.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            لا مهام متابعة لهذا العميل بعد — أضف أول مهمة من الأعلى.
          </p>
        ) : (
          <div className="space-y-4">
            {open.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">المفتوحة</p>
                {open.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    nowStamp={nowStamp}
                    onToggle={() => toggleTask.mutate({ id: t.id, action: "complete" })}
                    onDelete={() => deleteTask.mutate(t.id)}
                    busy={busy}
                  />
                ))}
              </div>
            )}
            {done.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">المنجزة</p>
                {done.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    nowStamp={nowStamp}
                    onToggle={() => toggleTask.mutate({ id: t.id, action: "reopen" })}
                    onDelete={() => deleteTask.mutate(t.id)}
                    busy={busy}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TaskRow({
  task,
  nowStamp,
  onToggle,
  onDelete,
  busy,
}: {
  task: TaskItem;
  nowStamp: string;
  onToggle: () => void;
  onDelete: () => void;
  busy?: boolean;
}) {
  const isOpen = task.status === "مفتوحة";
  const overdue = isOpen && !!task.dueAt && task.dueAt < nowStamp;
  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2">
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        disabled={busy}
        onClick={onToggle}
        title={isOpen ? "إنجاز المهمة" : "إعادة فتح"}
        aria-label={isOpen ? "إنجاز المهمة" : "إعادة فتح"}
      >
        {isOpen ? <Circle className="size-4 text-muted-foreground" /> : <CheckCircle2 className="size-4 text-status-done" />}
      </Button>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${isOpen ? "" : "text-muted-foreground line-through"}`}>{task.title}</p>
        {task.dueAt && (
          <p className="text-[11px] text-muted-foreground" dir="ltr">
            {task.dueAt}
          </p>
        )}
      </div>
      {overdue && (
        <Badge variant="destructive" className="shrink-0 text-[10px]">
          متأخرة
        </Badge>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
        disabled={busy}
        onClick={onDelete}
        title="حذف المهمة"
        aria-label="حذف المهمة"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
