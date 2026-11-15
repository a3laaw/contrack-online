"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  Flag,
  MapPin,
  Milestone,
  Play,
  RefreshCw,
  Search,
  SkipForward,
  TriangleAlert,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPatch } from "./api";
import { errMessage, isManagerRole, type User } from "./contrack-types";
import { permAllows, type PermsMap } from "./nav-perms";
import { fmtDate, formatKWD, statusBadgeClass, todayStr } from "@/lib/format";

/**
 * لوحة «أين وصلنا» — ربط العقود بمراحل العمل وموقع التقدم (قرار المالك 2026-11).
 * اشتقاقية حية فوق مراحل العقود (ContractStage) — بلا جداول جديدة (G9).
 * كل بطاقة: مسار المراحل خطوة خطوة + المرحلة الحالية بعدّادها + الإجراء السريع
 * (بدء/إنهاء المرحلة عبر نفس API المراحل في لوحة العقد — بمفتاح صلاحية action_stage_advance).
 */

interface StageRow {
  id: number;
  name: string;
  state: "done" | "skip" | "current" | "future";
  days: number;
  expectedDays: number;
}

interface ProgressRow {
  id: number;
  contractNumber: string;
  contractName: string;
  customerId: number;
  customerName: string;
  contractType: string;
  status: string;
  amount: number;
  currency: string;
  startDate: string;
  endDate: string;
  manualPath: boolean;
  timelinePct: number;
  timeStatus: string;
  /** التقرير اليومي الإلزامي (قرار المالك 2026-11) — يُطالَب به العقد الحي الذي بدأ تنفيذه */
  dailyReportRequired?: boolean;
  dailyReportDone?: boolean;
  stages: StageRow[];
  current: { id: number; name: string; daysIn: number; expectedDays: number; state: "ok" | "near" | "over" } | null;
  next: { id: number; name: string } | null;
  boardState: "over" | "near" | "ok" | "between" | "not_started" | "done" | "none";
  doneCount: number;
  totalCount: number;
  pct: number;
}

interface ProgressBoardResponse {
  contracts: ProgressRow[];
  summary: {
    total: number;
    over: number;
    near: number;
    active: number;
    notStarted: number;
    between: number;
    completed: number;
    noStages: number;
    avgPct: number;
  };
}

interface ContractProgressViewProps {
  user: User;
  perms: PermsMap;
  onAuthError: () => void;
  onOpenContract: (contractId: number) => void;
}

/** تطبيع عربي للبحث على العميل — نفس قواعد normalizeArabic الخلفية (بلا server-only) */
function normAr(s: string): string {
  return (s || "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .trim()
    .toLowerCase();
}

function daysLabel(n: number): string {
  return `${n} ${n === 1 ? "يوم" : n === 2 ? "يومين" : n <= 10 ? "أيام" : "يومًا"}`;
}

/** شارة حالة البطاقة على اللوحة */
const BOARD_CHIP: Record<ProgressRow["boardState"], { label: string; cls: string }> = {
  over: { label: "متأخر عن الخطة", cls: "bg-status-danger-bg text-status-danger" },
  near: { label: "قارب الانتهاء", cls: "bg-status-warn-bg text-status-warn" },
  ok: { label: "جارٍ في الموعد", cls: "bg-status-done-bg text-status-done" },
  between: { label: "بانتظار بدء التالية", cls: "bg-status-info-bg text-status-info" },
  not_started: { label: "لم يبدأ التنفيذ", cls: "bg-muted text-muted-foreground" },
  done: { label: "اكتمل المسار", cls: "bg-status-done-bg text-status-done" },
  none: { label: "بلا مراحل", cls: "bg-muted text-muted-foreground" },
};

// ==================== مسار المراحل خطوة بخطوة ====================

function StepCircle({ state }: { state: StageRow["state"] }) {
  if (state === "done") {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-status-done text-white" aria-hidden>
        <Check className="size-4" />
      </span>
    );
  }
  if (state === "skip") {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden>
        <SkipForward className="size-3.5" />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-gold text-text-on-brand ring-2 ring-brand-orange/60"
        aria-hidden
      >
        <span className="size-2 rounded-full bg-text-on-brand" />
      </span>
    );
  }
  return <span className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-border bg-muted/40" aria-hidden />;
}

function PhaseStepper({ stages }: { stages: StageRow[] }) {
  if (stages.length === 0) return null;
  return (
    <div className="overflow-x-auto pb-1 [scrollbar-width:thin]" aria-label="مسار مراحل العقد">
      <ol className="flex min-w-max items-start">
        {stages.map((s, i) => (
          <li key={s.id} className="flex items-start">
            <div className="flex w-[84px] flex-col items-center gap-1">
              <StepCircle state={s.state} />
              <span
                className={`max-w-[84px] truncate text-center text-[11px] leading-tight ${
                  s.state === "current"
                    ? "font-bold text-foreground"
                    : s.state === "done"
                      ? "text-status-done"
                      : s.state === "skip"
                        ? "text-muted-foreground/70 line-through"
                        : "text-muted-foreground"
                }`}
                title={s.name}
              >
                {s.name}
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground/80" dir="ltr">
                {s.state === "current"
                  ? `${s.days}${s.expectedDays ? `/${s.expectedDays}` : ""} يوم`
                  : s.state === "done" && s.expectedDays
                    ? `${s.expectedDays} يوم`
                    : ""}
              </span>
            </div>
            {i < stages.length - 1 && (
              <div
                className={`mt-3.5 h-0.5 w-6 shrink-0 rounded ${
                  s.state === "done" ? "bg-status-done/60" : s.state === "skip" ? "bg-border" : "bg-border"
                }`}
                aria-hidden
              />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ==================== بطاقة العقد ====================

function ContractCard({
  row,
  canAdvance,
  frozen,
  onOpenContract,
  onFinish,
  onStart,
  busy,
}: {
  row: ProgressRow;
  canAdvance: boolean;
  frozen: boolean;
  onOpenContract: (id: number) => void;
  onFinish: (row: ProgressRow) => void;
  onStart: (row: ProgressRow) => void;
  busy: boolean;
}) {
  const chip = BOARD_CHIP[row.boardState];
  const showActions = canAdvance && !frozen;

  const currentLine =
    row.boardState === "over"
      ? `متأخر: مر على «${row.current?.name}» ${daysLabel(row.current?.daysIn ?? 0)} والمتوقع ${daysLabel(row.current?.expectedDays ?? 0)} — تجاوز ${daysLabel((row.current?.daysIn ?? 0) - (row.current?.expectedDays ?? 0))}`
      : row.boardState === "near"
        ? `«${row.current?.name}» قاربت: ${daysLabel(row.current?.daysIn ?? 0)} من ${daysLabel(row.current?.expectedDays ?? 0)}`
        : row.boardState === "ok"
          ? `جارٍ التنفيذ في «${row.current?.name}» — ${daysLabel(row.current?.daysIn ?? 0)}${row.current?.expectedDays ? ` من ${daysLabel(row.current.expectedDays)}` : ""}`
          : row.boardState === "between"
            ? `أُنجزت «${[...row.stages].reverse().find((s) => s.state === "done")?.name ?? "المرحلة السابقة"}» — بانتظار بدء «${row.next?.name}»`
            : "";

  const currentCls =
    row.boardState === "over"
      ? "text-status-danger"
      : row.boardState === "near"
        ? "text-status-warn"
        : row.boardState === "between"
          ? "text-status-info"
          : "text-status-done";

  return (
    <Card className="flex flex-col gap-3 overflow-hidden transition-colors hover:border-primary/40">
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        {/* رأس البطاقة */}
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => onOpenContract(row.id)}
            className="min-w-0 flex-1 cursor-pointer text-start"
            aria-label={`فتح العقد ${row.contractNumber}`}
          >
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-bold" dir="ltr">
                {row.contractNumber}
              </span>
              <ChevronLeft className="size-3.5 shrink-0 text-muted-foreground/60" />
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {row.customerName}
              {row.contractName ? ` · ${row.contractName}` : ""}
            </div>
          </button>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge className={`border-0 text-[11px] ${chip.cls}`}>{chip.label}</Badge>
            {/* التقرير اليومي الإلزامي — «يوجد تقرير من الموقع الفلاني لم يتم اليوم» */}
            {row.dailyReportRequired && !row.dailyReportDone && (
              <Badge className="border-0 text-[10px] bg-status-danger-bg text-status-danger" title="التقرير اليومي للميدان إلزامي — لم يُسجل تقرير اليوم من التنفيذ الميداني">
                📍 لم يتم تقرير اليوم
              </Badge>
            )}
            <Badge variant="outline" className={`text-[10px] ${statusBadgeClass(row.status)}`}>
              {row.status}
            </Badge>
          </div>
        </div>

        {/* المعلومات السريعة */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>{row.contractType || "غير محدد"}</span>
          <span className="tabular-nums" dir="ltr">
            {formatKWD(row.amount)} {row.currency}
          </span>
          {(row.startDate || row.endDate) && (
            <span dir="ltr">
              {row.startDate ? fmtDate(row.startDate) : "؟"} ← {row.endDate ? fmtDate(row.endDate) : "؟"}
            </span>
          )}
          {row.manualPath && (
            <Badge variant="outline" className="h-4 px-1 text-[9px]">
              مسار يدوي
            </Badge>
          )}
        </div>

        {/* نسبة الإنجاز */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">
              المراحل المنجزة {row.doneCount} من {row.totalCount}
            </span>
            <span className="font-bold tabular-nums" dir="ltr">
              {row.pct}%
            </span>
          </div>
          <Progress value={row.pct} className="h-1.5" aria-label={`إنجاز ${row.contractNumber} ${row.pct} بالمئة`} />
          {(row.startDate || row.endDate) && (
            <div className="flex items-center justify-between text-[10px] text-muted-foreground/80">
              <span>المدة الزمنية: {row.timeStatus}</span>
              <span className="tabular-nums" dir="ltr">
                {row.timelinePct}%
              </span>
            </div>
          )}
        </div>

        {/* سطر المرحلة الحالية */}
        {currentLine && (
          <div className={`flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1.5 text-[11px] font-semibold ${currentCls}`}>
            <MapPin className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 leading-snug">{currentLine}</span>
          </div>
        )}

        {/* مسار المراحل */}
        {row.stages.length > 0 ? (
          <PhaseStepper stages={row.stages} />
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-[11px] text-muted-foreground">
            <TriangleAlert className="size-3.5 shrink-0 text-status-warn" />
            لا مراحل عمل معرفة لهذا العقد — أضفها من صفحة العقد (المراحل والدفعات).
          </div>
        )}

        {/* الإجراء السريع */}
        {showActions && (
          <div className="mt-auto flex items-center gap-2 pt-1">
            {row.current ? (
              <Button
                size="sm"
                className="h-8 flex-1 gap-1.5"
                disabled={busy}
                onClick={() => onFinish(row)}
              >
                <Flag className="size-3.5" />
                إنهاء «{row.current.name}»
              </Button>
            ) : row.next ? (
              <Button
                size="sm"
                variant="outline"
                className="h-8 flex-1 gap-1.5"
                disabled={busy}
                onClick={() => onStart(row)}
              >
                <Play className="size-3.5" />
                بدء «{row.next.name}»
              </Button>
            ) : row.boardState === "done" ? (
              <span className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-status-done-bg text-[11px] font-semibold text-status-done">
                <Check className="size-3.5" />
                اكتمل مسار المراحل
              </span>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ==================== الشاشة ====================

type BoardFilter = "all" | "over" | "near" | "ok" | "between" | "not_started" | "done" | "none";

const FILTERS: { key: BoardFilter; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "over", label: "متأخرة" },
  { key: "near", label: "قاربت" },
  { key: "ok", label: "جارية" },
  { key: "between", label: "بانتظار البدء" },
  { key: "not_started", label: "لم تبدأ" },
  { key: "done", label: "مكتملة" },
  { key: "none", label: "بلا مراحل" },
];

export function ContractProgressView({ user, perms, onAuthError, onOpenContract }: ContractProgressViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState<BoardFilter>("all");
  const [finishRow, setFinishRow] = React.useState<ProgressRow | null>(null);

  const boardQuery = useQuery<ProgressBoardResponse>({
    queryKey: ["contracts", "progress-board"],
    queryFn: () => apiGet<ProgressBoardResponse>("/api/contracts/progress-board"),
  });

  React.useEffect(() => {
    const e = boardQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [boardQuery.error, onAuthError]);

  const canAdvance = permAllows(perms, "action_stage_advance", isManagerRole(user.role));

  // إجراء المرحلة — نفس API لوحة العقد (PATCH /api/contracts/[id]/stages/[stageId])
  const stageAction = useMutation({
    mutationFn: ({ contractId, stageId, body }: { contractId: number; stageId: number; body: Record<string, unknown> }) =>
      apiPatch<{ message?: string; quantum?: { complete: boolean; executedPct: string; shortfall: { description: string }[] } | null }>(
        `/api/contracts/${contractId}/stages/${stageId}`,
        body
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["contracts", "progress-board"] });
      qc.invalidateQueries({ queryKey: ["contracts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setFinishRow(null);
      if (res?.quantum && !res.quantum.complete) {
        toast({
          variant: "destructive",
          title: "أُقفلت المرحلة والإنجاز الكمّي غير مكتمل",
          description: `الإنجاز ${res.quantum.executedPct}٪ — راجع مقايسة التنفيذ في صفحة العقد.`,
        });
      } else {
        toast({ title: "تم", description: "حُدّث موقع العقد في مراحل العمل" });
      }
    },
    onError: (e) => {
      setFinishRow(null);
      toast({ variant: "destructive", title: "تعذر تنفيذ الإجراء", description: errMessage(e) });
    },
  });

  const data = boardQuery.data;
  const allRows = data?.contracts ?? [];
  // البحث على العميل — البيانات صغيرة والسيرفر يعيدها كاملة (بلا استعلامات مفرّقة)
  const nq = normAr(q);
  const rows = nq
    ? allRows.filter((r) =>
        normAr(`${r.contractNumber} ${r.contractName} ${r.customerName} ${r.contractType}`).includes(nq)
      )
    : allRows;
  const filtered = filter === "all" ? rows : rows.filter((r) => r.boardState === filter);
  const summary = data?.summary;

  const statCards: { key: string; label: string; value: number | undefined; cls: string }[] = [
    { key: "total", label: "عقود قيد المتابعة", value: summary?.total, cls: "text-foreground" },
    { key: "over", label: "متأخرة عن الخطة", value: summary?.over, cls: "text-status-danger" },
    { key: "near", label: "قاربت الانتهاء", value: summary?.near, cls: "text-status-warn" },
    { key: "active", label: "جارية في الموعد", value: summary?.active, cls: "text-status-done" },
    { key: "notStarted", label: "لم تبدأ التنفيذ", value: summary?.notStarted, cls: "text-muted-foreground" },
    { key: "avgPct", label: "متوسط الإنجاز ٪", value: summary?.avgPct, cls: "text-foreground" },
  ];

  return (
    <div className="space-y-4">
      {/* الترويسة */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary-ink">
            <Milestone className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">أين وصلنا — تقدم العقود</h1>
            <p className="text-xs text-muted-foreground">
              ربط العقود بمراحل العمل وموقع كل عقد الآن — إنهاء وبدء المراحل من اللوحة مباشرة
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          disabled={boardQuery.isRefetching}
          onClick={() => boardQuery.refetch()}
        >
          <RefreshCw className={`size-4 ${boardQuery.isRefetching ? "animate-spin" : ""}`} />
          تحديث
        </Button>
      </div>

      {/* بطاقات العد */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {boardQuery.isLoading
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
          : statCards.map((s) => (
              <Card key={s.key}>
                <CardContent className="p-4">
                  <div className={`text-lg font-extrabold tabular-nums leading-none ${s.cls}`}>
                    {s.value ?? 0}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{s.label}</div>
                </CardContent>
              </Card>
            ))}
      </div>

      {/* الفلاتر والبحث */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="بحث برقم العقد أو العميل..."
            className="h-9 ps-8"
            aria-label="بحث في لوحة التقدم"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="تصفية حسب الحالة">
          {FILTERS.map((f) => {
            const count =
              f.key === "all" ? rows.length : rows.filter((r) => r.boardState === f.key).length;
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors ${
                  active
                    ? "border-primary bg-primary/10 text-primary-ink"
                    : "border-border bg-card text-muted-foreground hover:bg-accent/50"
                }`}
                aria-pressed={active}
              >
                {f.label}
                <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* بطاقات العقود */}
      {boardQuery.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Milestone className="size-10 text-muted-foreground/40" />
            <p className="text-sm font-semibold">لا عقود مطابقة</p>
            <p className="text-xs text-muted-foreground">
              {rows.length === 0
                ? "لا توجد عقود قيد التنفيذ بعد — أنشئ عقدًا من شاشة العقود."
                : "جرّب تغيير الفلتر أو البحث."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((r) => (
            <ContractCard
              key={r.id}
              row={r}
              canAdvance={canAdvance}
              frozen={r.status === "ملغى" || r.status === "مغلق"}
              onOpenContract={onOpenContract}
              onFinish={setFinishRow}
              onStart={(row) =>
                row.next &&
                stageAction.mutate({ contractId: row.id, stageId: row.next.id, body: { startDate: todayStr() } })
              }
              busy={stageAction.isPending}
            />
          ))}
        </div>
      )}

      {/* تأكيد إنهاء المرحلة الجارية */}
      <AlertDialog open={finishRow !== null} onOpenChange={(o) => !o && setFinishRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إنهاء المرحلة الجارية؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم إنهاء مرحلة «{finishRow?.current?.name}» في العقد {finishRow?.contractNumber} بتاريخ اليوم،
              وتُستحق الدفعات المرتبطة بها تلقائيًا. يمكنك الإرجاع لاحقًا من صفحة العقد.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>تراجع</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                finishRow?.current &&
                stageAction.mutate({
                  contractId: finishRow.id,
                  stageId: finishRow.current.id,
                  body: { endDate: "today" },
                })
              }
            >
              إنهاء المرحلة
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
