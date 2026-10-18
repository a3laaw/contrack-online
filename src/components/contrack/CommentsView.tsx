"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  FilePen,
  Flag,
  Loader2,
  MessageSquareText,
  Pin,
  Plus,
  Search,
  Settings2,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiGet, apiPatch } from "./api";
import type {
  CommentItem,
  CommentsResponse,
  User,
} from "./contrack-types";
import {
  COMMENT_KINDS,
  COMMENT_PRIORITIES,
  COMMENT_PRIORITY_BADGE,
  COMMENT_STATUSES,
  COMMENT_STATUS_BADGE,
  errMessage,
  isManagerRole,
} from "./contrack-types";
import { cn } from "@/lib/utils";
import { CommentEditPage } from "./CommentEditPage";

interface CommentsViewProps {
  user: User;
  onAuthError: () => void;
  onOpenCustomer?: (customerId: number) => void;
  onOpenContract?: (contractId: number) => void;
}

const MAX_BODY = 2000;

const pad2 = (n: number) => String(n).padStart(2, "0");

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** تطبيع بحثي بسيط (همزات/تاء مربوطة/ألف مقصورة) */
function normSearch(s: string): string {
  return s.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
}

/** توقيت نسبي عربي: قبل ساعتين… */
function relTime(s: string): string {
  if (!s) return "";
  const d = new Date(s.slice(0, 16).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return s;
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `قبل ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    if (hrs === 1) return "قبل ساعة";
    if (hrs === 2) return "قبل ساعتين";
    if (hrs <= 10) return `قبل ${hrs} ساعات`;
    return `قبل ${hrs} ساعة`;
  }
  const days = Math.floor(hrs / 24);
  if (days === 1) return "قبل يوم";
  if (days === 2) return "قبل يومين";
  if (days < 30) return `قبل ${days} أيام`;
  return s.slice(0, 10);
}

function parseTags(s: string): string[] {
  return (s || "")
    .split(/[,،]/)
    .map((t) => t.trim())
    .filter(Boolean);
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

/** «تعليق جديد» (7 حقول) و«تعديل بيانات التعليق» (5 حقول) صاروا صفحة كاملة واحدة:
 * CommentEditPage (mode "new" | "meta") — نفس النوافذ السابقتين حرفيًا. */

// ==================== حوار تعديل النص (مدير) ====================

interface BodyDialogProps {
  target: CommentItem | null;
  onClose: () => void;
  onAuthError: () => void;
  onSaved: () => void;
}

function BodyDialog({ target, onClose, onAuthError, onSaved }: BodyDialogProps) {
  const { toast } = useToast();
  const [body, setBody] = React.useState("");
  const [formError, setFormError] = React.useState("");

  const wasTarget = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (target && wasTarget.current !== target.id) {
      setBody(target.body || "");
      setFormError("");
      wasTarget.current = target.id;
    }
    if (!target) wasTarget.current = null;
  }, [target]);

  const bodyMutation = useMutation({
    mutationFn: () => apiPatch<{ item?: CommentItem }>(`/api/comments/${target?.id}`, { action: "body", body: body.trim() }),
    onSuccess: () => {
      onClose();
      onSaved();
      toast({ title: "حُدّث نص التعليق", description: "سُجّل اسم المُعدِّل في التدقيق" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      const msg = errMessage(e);
      setFormError(msg);
      toast({ variant: "destructive", title: "تعذر تعديل النص", description: msg });
    },
  });

  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>تعديل نص التعليق</DialogTitle>
          <DialogDescription>صلاحية مدير — التعديل بلا مهلة ويُسجَّل في التدقيق</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>النص</Label>
              <span
                className={cn(
                  "text-[11px] tabular-nums",
                  body.length > MAX_BODY ? "font-bold text-destructive" : "text-muted-foreground"
                )}
              >
                {body.length}/{MAX_BODY}
              </span>
            </div>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              maxLength={MAX_BODY + 50}
            />
          </div>
          {formError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
              {formError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={bodyMutation.isPending}>
            إلغاء
          </Button>
          <Button
            onClick={() => {
              if (!body.trim()) {
                setFormError("النص لا يكون فارغًا");
                return;
              }
              bodyMutation.mutate();
            }}
            disabled={bodyMutation.isPending}
          >
            {bodyMutation.isPending && <Loader2 className="size-4 animate-spin" />}
            حفظ النص
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== الشاشة الرئيسية ====================

const PRIO_RANK: Record<string, number> = { "عاجل": 0, "مهم": 1, "عادي": 2 };

export function CommentsView({ user, onAuthError, onOpenCustomer, onOpenContract }: CommentsViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);
  const today = todayStr();

  // ===== البيانات =====
  const listQuery = useQuery<CommentsResponse>({
    queryKey: ["comments"],
    queryFn: () => apiGet<CommentsResponse>("/api/comments"),
  });
  const items: CommentItem[] = React.useMemo(
    () => (listQuery.data?.comments ?? listQuery.data?.items ?? []).filter((c) => !c.isDeleted),
    [listQuery.data]
  );

  React.useEffect(() => {
    const e = listQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [listQuery.error, onAuthError]);

  const isActive = (c: CommentItem) => c.status !== "تم" && c.status !== "ملغى";

  // ===== مؤشرات =====
  const openCount = items.filter((c) => c.status === "مفتوح").length;
  const importantCount = items.filter((c) => c.priority === "مهم" && isActive(c)).length;
  const urgentCount = items.filter((c) => c.priority === "عاجل" && isActive(c)).length;
  const dueTodayCount = items.filter((c) => c.followupDate === today && isActive(c)).length;

  // ===== فلاتر =====
  const [q, setQ] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [kindFilter, setKindFilter] = React.useState("all");
  const [priorityFilter, setPriorityFilter] = React.useState("all");
  const [openOnly, setOpenOnly] = React.useState(false);
  const [dueOnly, setDueOnly] = React.useState(false);

  const sorted = React.useMemo(() => {
    const needle = normSearch(q.trim());
    const rows = items.filter((c) => {
      if (openOnly && !isActive(c)) return false;
      if (dueOnly && c.followupDate !== today) return false;
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (kindFilter !== "all" && c.kind !== kindFilter) return false;
      if (priorityFilter !== "all" && c.priority !== priorityFilter) return false;
      if (needle) {
        const hay = normSearch(
          `${c.body} ${c.customerName ?? ""} ${c.contractNumber ?? ""} ${c.author} ${c.tags}`
        );
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    // ترتيب المواصفات: مثبّت ← عاجل ← مهم ← الأحدث
    return [...rows].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const r = (PRIO_RANK[a.priority] ?? 2) - (PRIO_RANK[b.priority] ?? 2);
      if (r !== 0) return r;
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });
  }, [items, q, statusFilter, kindFilter, priorityFilter, openOnly, dueOnly, today]);

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["comments"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }, [qc]);

  // ===== صفحة التعليق (جديد / تعديل بيانات) — بلا مسار، استبدال في نفس المستوى =====
  const [commentPage, setCommentPage] = React.useState<
    { mode: "new" } | { mode: "meta"; target: CommentItem } | null
  >(null);
  const [bodyTarget, setBodyTarget] = React.useState<CommentItem | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<CommentItem | null>(null);
  const [deleteReason, setDeleteReason] = React.useState("");
  const [deleteError, setDeleteError] = React.useState("");

  const pinMutation = useMutation({
    mutationFn: (c: CommentItem) =>
      apiPatch<{ item?: CommentItem }>(`/api/comments/${c.id}`, { action: c.pinned ? "unpin" : "pin" }),
    onSuccess: (_res, c) => {
      invalidate();
      toast({ title: c.pinned ? "أُلغي التثبيت" : "ثُبّت التعليق", description: c.pinned ? undefined : "سيظهر أول القائمة" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر التثبيت", description: errMessage(e) });
    },
  });

  const openDelete = (c: CommentItem) => {
    setDeleteTarget(c);
    setDeleteReason("");
    setDeleteError("");
  };

  const deleteMutation = useMutation({
    mutationFn: (vars: { id: number; reason: string }) =>
      apiDelete(`/api/comments/${vars.id}?reason=${encodeURIComponent(vars.reason)}`),
    onSuccess: () => {
      setDeleteTarget(null);
      invalidate();
      toast({ title: "حُذف التعليق", description: "حذف ناعم — يبقى في سجل التدقيق" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      const msg = errMessage(e);
      setDeleteError(msg);
      toast({ variant: "destructive", title: "تعذر الحذف", description: msg });
    },
  });

  const submitDelete = () => {
    if (!deleteTarget) return;
    if (!deleteReason.trim()) {
      setDeleteError("السبب إلزامي للحذف (يُحفظ في التدقيق)");
      return;
    }
    deleteMutation.mutate({ id: deleteTarget.id, reason: deleteReason.trim() });
  };

  const canDelete = (c: CommentItem) => manager || (c.createdBy ? c.createdBy === user.username : false);

  // الصفحة تُركَّب مكان القائمة عند الفتح (بعد كل الـhooks)
  if (commentPage) {
    return (
      <CommentEditPage
        mode={commentPage.mode}
        target={commentPage.mode === "meta" ? commentPage.target : null}
        onAuthError={onAuthError}
        onSaved={invalidate}
        onClose={() => setCommentPage(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* العنوان */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold tracking-tight sm:text-xl">مركز التعليقات</h1>
          <p className="text-xs text-muted-foreground">ملاحظات العملاء بأنواعها وأولوياتها ومتابعاتها</p>
        </div>
        <Button onClick={() => setCommentPage({ mode: "new" })} className="gap-1.5">
          <Plus className="size-4" />
          تعليق جديد
        </Button>
      </div>

      {/* المؤشرات */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard icon={MessageSquareText} label="مفتوحة" value={String(openCount)} tone="text-status-info" />
        <KpiCard icon={Flag} label="مهمة" value={String(importantCount)} tone="text-status-warn" />
        <KpiCard icon={AlertTriangle} label="عاجلة" value={String(urgentCount)} tone="text-status-danger" />
        <KpiCard
          icon={CalendarClock}
          label="متابعة اليوم"
          value={String(dueTodayCount)}
          tone="text-status-info"
        />
      </div>

      {/* الفلاتر */}
      <Card className="gap-3 p-3 sm:p-4">
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="بحث في النص/العميل/العقد/المؤلف/الوسوم…"
            className="ps-8"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="الحالة" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              {COMMENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={kindFilter} onValueChange={setKindFilter}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="النوع" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأنواع</SelectItem>
              {COMMENT_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="الأولوية" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأولويات</SelectItem>
              {COMMENT_PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <Switch checked={openOnly} onCheckedChange={setOpenOnly} />
            المفتوحة فقط
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <Switch checked={dueOnly} onCheckedChange={setDueOnly} />
            متابعة اليوم فقط
          </label>
          <span className="text-xs text-muted-foreground">
            {sorted.length} من {items.length} تعليقًا
          </span>
        </div>
      </Card>

      {/* القائمة */}
      {listQuery.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : listQuery.isError ? (
        <Card className="p-8 text-center text-sm text-destructive">
          تعذر تحميل التعليقات — {errMessage(listQuery.error)}
        </Card>
      ) : sorted.length === 0 ? (
        <Card className="p-10 text-center">
          <MessageSquareText className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm font-medium">
            {items.length === 0 ? "لا توجد تعليقات بعد" : "لا نتائج مطابقة للفلاتر"}
          </p>
          <p className="text-xs text-muted-foreground">
            {items.length === 0 ? "أضف أول تعليق بزر «تعليق جديد»" : "جرّب تعديل البحث أو المفاتيح"}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {sorted.map((c) => {
            const tags = parseTags(c.tags);
            const dueToday = !!c.followupDate && c.followupDate === today;
            return (
              <Card
                key={c.id}
                className={cn(
                  "relative gap-2 border-s-4 p-3 sm:p-4",
                  c.pinned
                    ? "border-s-status-warn"
                    : c.priority === "عاجل"
                      ? "border-s-status-danger"
                      : "border-s-border"
                )}
              >
                {c.pinned && (
                  <Badge className="absolute -top-2 start-3 gap-1 bg-status-warn-bg text-[10px] text-status-warn">
                    <Pin className="size-3" />
                    مثبّت
                  </Badge>
                )}
                <div className="flex items-start justify-between gap-2 pt-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {(c.author || "؟").slice(0, 1)}
                    </div>
                    <div className="min-w-0 leading-tight">
                      <p className="truncate text-xs font-bold">{c.author || "—"}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {relTime(c.createdAt)}
                        {c.editedAt ? ` • عُدّل بواسطة ${c.editor || "مدير"}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-foreground"
                      title="تعديل البيانات"
                      onClick={() => setCommentPage({ mode: "meta", target: c })}
                    >
                      <Settings2 className="size-3.5" />
                    </Button>
                    {manager && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-foreground"
                        title="تعديل النص (مدير)"
                        onClick={() => setBodyTarget(c)}
                      >
                        <FilePen className="size-3.5" />
                      </Button>
                    )}
                    {manager && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn("size-7", c.pinned ? "text-status-warn" : "text-muted-foreground hover:text-foreground")}
                        title={c.pinned ? "إلغاء التثبيت" : "تثبيت (مدير)"}
                        disabled={pinMutation.isPending}
                        onClick={() => pinMutation.mutate(c)}
                      >
                        <Pin className="size-3.5" />
                      </Button>
                    )}
                    {canDelete(c) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive hover:text-destructive"
                        title="حذف (بسبب)"
                        onClick={() => openDelete(c)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                <p className="whitespace-pre-wrap text-sm leading-relaxed">{c.body}</p>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    {c.kind}
                  </Badge>
                  <Badge className={cn("h-5 px-1.5 text-[10px]", COMMENT_PRIORITY_BADGE[c.priority] ?? "")}>
                    {c.priority}
                  </Badge>
                  <Badge className={cn("h-5 px-1.5 text-[10px]", COMMENT_STATUS_BADGE[c.status] ?? "")}>
                    {c.status}
                  </Badge>
                  {c.followupDate && (
                    <Badge
                      className={cn(
                        "h-5 gap-1 px-1.5 text-[10px]",
                        dueToday
                          ? "bg-status-info-bg text-status-info"
                          : "bg-status-done-bg text-status-done"
                      )}
                    >
                      <CalendarClock className="size-3" />
                      متابعة: {c.followupDate}
                      {dueToday ? " — اليوم" : ""}
                    </Badge>
                  )}
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex h-5 items-center rounded-full border bg-background px-2 text-[10px] text-muted-foreground"
                    >
                      {t}
                    </span>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-[11px] text-muted-foreground">
                  {onOpenCustomer ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-primary hover:underline"
                      onClick={() => onOpenCustomer(c.customerId)}
                    >
                      <UserIcon className="size-3" />
                      {c.customerName || `عميل #${c.customerId}`}
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <UserIcon className="size-3" />
                      {c.customerName || `عميل #${c.customerId}`}
                    </span>
                  )}
                  {c.contractId && c.contractNumber ? (
                    onOpenContract ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-primary hover:underline"
                        onClick={() => onOpenContract(c.contractId as number)}
                      >
                        عقد: {c.contractNumber}
                      </button>
                    ) : (
                      <span>عقد: {c.contractNumber}</span>
                    )
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* الحوارات الصغيرة (≤3 حقول) */}
      <BodyDialog target={bodyTarget} onClose={() => setBodyTarget(null)} onAuthError={onAuthError} onSaved={invalidate} />

      {/* تأكيد الحذف بسبب إلزامي */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-destructive">حذف التعليق</DialogTitle>
            <DialogDescription>
              حذف ناعم — يُعلَّم محذوفًا مع السبب ولا يظهر في القوائم. صاحب التعليق أو المدير من يحذف.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="delete-reason">سبب الحذف *</Label>
            <Input
              id="delete-reason"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="مثال: تسجيل خاطئ"
              autoFocus
            />
            {deleteError && <p className="text-xs font-medium text-destructive">{deleteError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteMutation.isPending}>
              تراجع
            </Button>
            <Button
              className="border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80"
              onClick={submitDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
