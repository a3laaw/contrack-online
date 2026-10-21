"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  CalendarClock,
  Eye,
  HandCoins,
  Loader2,
  Plus,
  ReceiptText,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { SearchableSelect } from "./SearchableSelect";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPost } from "./api";
import type { ClaimRow, ClaimsResponse, User } from "./contrack-types";
import { errMessage } from "./contrack-types";
import { CLAIM_NEXT, CLAIM_STATUS_LABEL, fmtDate, formatKWD, statusBadgeClass } from "@/lib/format";
import { ClaimNewPage, type ClaimDirection } from "./ClaimNewPage";

interface ClaimsViewProps {
  user: User;
  onAuthError: () => void;
}

type Dir = "out" | "in";

/** سلسلة الحالات الخطية لكل اتجاه (الانتقال المشروع التالي فقط) */
const CHAINS: Record<Dir, string[]> = {
  out: ["registered", "sent", "approved", "collected"],
  in: ["registered", "in_review", "approved", "paid"],
};

const ACTIVE_STATUSES = new Set(["registered", "sent", "in_review", "approved", "postponed"]);
const DEAD_STATUSES = new Set(["collected", "paid", "refused", "cancelled", "archived"]);

const DIR_LABEL: Record<Dir, string> = {
  out: "على العملاء",
  in: "من المقاولين",
};

/** تطبيع بحثي بسيط (همزات/تاء مربوطة/ألف مقصورة) */
function normSearch(s: string): string {
  return s.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** الانتقالات المتاحة لصف مطالبة — المشتقة من CLAIM_NEXT، والخلفي هو الحَكَم */
function nextTransitions(c: ClaimRow): { label: string; next: string }[] {
  const opts = CLAIM_NEXT[c.direction] ?? [];
  if (c.status === "postponed") return opts; // مؤجلة: الخلفي يتحقق من الانتقال المسموح
  const chain = CHAINS[(c.direction as Dir) || "out"] ?? [];
  const idx = chain.indexOf(c.status);
  if (idx === -1 || idx === chain.length - 1) return [];
  const next = chain[idx + 1];
  return opts.filter((o) => o.next === next);
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

export function ClaimsView({ onAuthError }: ClaimsViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // ===== البيانات =====
  const listQuery = useQuery<ClaimsResponse>({
    queryKey: ["claims"],
    queryFn: () => apiGet<ClaimsResponse>("/api/claims"),
  });
  const items: ClaimRow[] = listQuery.data?.items ?? [];

  React.useEffect(() => {
    const e = listQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [listQuery.error, onAuthError]);

  // ===== مؤشرات =====
  const notCancelled = (c: ClaimRow) => c.status !== "cancelled";
  const outRows = items.filter((c) => c.direction === "out");
  const inRows = items.filter((c) => c.direction === "in");
  const outTotal = outRows.filter(notCancelled).reduce((s, c) => s + Number(c.amount || 0), 0);
  const inTotal = inRows.filter(notCancelled).reduce((s, c) => s + Number(c.amount || 0), 0);
  const outCollected = outRows
    .filter((c) => c.status === "collected")
    .reduce((s, c) => s + Number(c.amount || 0), 0);
  const inPaid = inRows.filter((c) => c.status === "paid").reduce((s, c) => s + Number(c.amount || 0), 0);
  const today = todayStr();
  const overdueCount = items.filter(
    (c) => c.dueDate && c.dueDate < today && !DEAD_STATUSES.has(c.status)
  ).length;
  const postponedCount = items.filter((c) => c.status === "postponed").length;

  // ===== التبويب والفلاتر =====
  const [dir, setDir] = React.useState<Dir>("out");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [q, setQ] = React.useState("");
  const [contractFilter, setContractFilter] = React.useState("all");

  const dirRows = items.filter((c) => c.direction === dir);
  const contractOptions = (() => {
    const map = new Map<number, string>();
    for (const c of dirRows) {
      if (c.contract?.id) map.set(c.contract.id, c.contract.contractNumber || `#${c.contract.id}`);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "ar"));
  })();

  const filtered = dirRows.filter((c) => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (contractFilter !== "all" && String(c.contract?.id ?? "") !== contractFilter) return false;
    if (q.trim()) {
      const hay = normSearch(
        `${c.claimNumber} ${c.title} ${c.contract?.contractNumber ?? ""} ${c.contract?.customer?.name ?? ""}`
      );
      if (!hay.includes(normSearch(q.trim()))) return false;
    }
    return true;
  });

  // ===== انتقالات =====
  const [transitionError, setTransitionError] = React.useState("");
  const [reasonTarget, setReasonTarget] = React.useState<{ claim: ClaimRow; kind: "refused" | "cancelled" } | null>(null);
  const [postponeTarget, setPostponeTarget] = React.useState<ClaimRow | null>(null);
  const [reason, setReason] = React.useState("");
  const [postponeDate, setPostponeDate] = React.useState("");

  const transitionMutation = useMutation({
    mutationFn: (vars: { id: number; next: string; reason?: string; postponedUntil?: string }) =>
      apiPost<{ item: ClaimRow }>(`/api/claims/${vars.id}/transition`, {
        next: vars.next,
        reason: vars.reason,
        postponedUntil: vars.postponedUntil,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["claims"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setReasonTarget(null);
      setPostponeTarget(null);
      setReason("");
      setPostponeDate("");
      setTransitionError("");
      toast({
        title: "تم تحديث حالة المطالبة",
        description: `${res.item?.claimNumber ?? ""} — ${CLAIM_STATUS_LABEL[res.item?.status ?? ""] ?? res.item?.status ?? ""}`,
      });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      // رسائل الخلفية حرفيًا: انتقال غير مشروع / تأجيل بلا تاريخ / تجاوز سقف السند…
      setTransitionError(errMessage(e));
      toast({ variant: "destructive", title: "رُفض الانتقال", description: errMessage(e) });
    },
  });

  const doTransition = (claim: ClaimRow, next: string) => {
    setTransitionError("");
    transitionMutation.mutate({ id: claim.id, next });
  };

  const submitReason = () => {
    if (!reasonTarget || !reason.trim()) {
      toast({ variant: "destructive", title: "أدخل السبب" });
      return;
    }
    setTransitionError("");
    transitionMutation.mutate({
      id: reasonTarget.claim.id,
      next: reasonTarget.kind,
      reason: reason.trim(),
    });
  };

  const submitPostpone = () => {
    if (!postponeTarget) return;
    if (!postponeDate) {
      setTransitionError("التأجيل يتطلب تاريخ «مؤجل حتى» — حدد التاريخ أولًا");
      toast({ variant: "destructive", title: "التأجيل بلا تاريخ", description: "حدد تاريخ «مؤجل حتى» أولًا" });
      return;
    }
    setTransitionError("");
    transitionMutation.mutate({
      id: postponeTarget.id,
      next: "postponed",
      reason: reason.trim() || undefined,
      postponedUntil: postponeDate,
    });
  };

  // ===== تفاصيل =====
  const [detailClaim, setDetailClaim] = React.useState<ClaimRow | null>(null);

  // ===== صفحة «مطالبة جديدة» (بدل النافذة) — تحمل اتجاه التبويب النشط كتهيئة =====
  const [claimPage, setClaimPage] = React.useState<ClaimDirection | null>(null);

  const renderRowActions = (c: ClaimRow) => {
    const transitions = nextTransitions(c);
    const active = ACTIVE_STATUSES.has(c.status);
    return (
      <div className="flex flex-wrap items-center justify-end gap-1">
        {transitions.map((t) => (
          <Button
            key={t.next}
            variant="outline"
            size="sm"
            className="h-7 gap-1 border-status-done/40 px-2 text-xs text-status-done hover:bg-status-done-bg hover:text-status-done"
            disabled={transitionMutation.isPending}
            onClick={() => doTransition(c, t.next)}
          >
            {t.label}
          </Button>
        ))}
        {active && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 border-status-danger/40 px-2 text-xs text-status-danger hover:bg-status-danger-bg hover:text-status-danger"
              disabled={transitionMutation.isPending}
              onClick={() => {
                setReason("");
                setTransitionError("");
                setReasonTarget({ claim: c, kind: "refused" });
              }}
            >
              <XCircle className="size-3.5" />
              رفض
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 border-status-warn/40 px-2 text-xs text-status-warn hover:bg-status-warn-bg hover:text-status-warn"
              disabled={transitionMutation.isPending}
              onClick={() => {
                setReason("");
                setPostponeDate("");
                setTransitionError("");
                setPostponeTarget(c);
              }}
            >
              <CalendarClock className="size-3.5" />
              تأجيل
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
              disabled={transitionMutation.isPending}
              onClick={() => {
                setReason("");
                setTransitionError("");
                setReasonTarget({ claim: c, kind: "cancelled" });
              }}
            >
              <Ban className="size-3.5" />
              إلغاء
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground"
          onClick={() => setDetailClaim(c)}
        >
          <Eye className="size-3.5" />
          تفاصيل
        </Button>
      </div>
    );
  };

  // صفحة «مطالبة جديدة» تُعرض مكان القائمة مباشرة (لا نافذة) — بعد كل الـhooks
  if (claimPage) {
    return (
      <ClaimNewPage
        initialDir={claimPage}
        onAuthError={onAuthError}
        onSaved={() => setClaimPage(null)}
        onCancel={() => setClaimPage(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* العنوان */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-extrabold sm:text-xl">
            <ReceiptText className="size-5 text-primary" />
            المطالبات
          </h1>
          <p className="text-xs text-muted-foreground">
            مطالباتنا على العملاء ومطالبات المقاولين علينا — كل انتقال يسجّل سطر تدقيق.
          </p>
        </div>
        <Button size="sm" className="h-9 gap-1.5" onClick={() => setClaimPage(dir)}>
          <Plus className="size-4" />
          مطالبة جديدة
        </Button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={ArrowUpRight}
          label="مطالباتنا على العملاء"
          value={formatKWD(outTotal)}
          sub={`${outRows.filter(notCancelled).length} مطالبة`}
        />
        <KpiCard
          icon={ArrowDownLeft}
          label="مطالبات المقاولين علينا"
          value={formatKWD(inTotal)}
          sub={`${inRows.filter(notCancelled).length} مطالبة`}
        />
        <KpiCard
          icon={HandCoins}
          label="محصّلة / مدفوعة"
          value={formatKWD(outCollected + inPaid)}
          sub={`محصّل ${formatKWD(outCollected)} · مدفوع ${formatKWD(inPaid)}`}
          tone="text-status-done"
        />
        <KpiCard
          icon={CalendarClock}
          label="متأخرة / مؤجلة"
          value={`${overdueCount} / ${postponedCount}`}
          sub="متأخرة عن الاستحقاق · مؤجلة بتاريخ"
          tone={overdueCount + postponedCount > 0 ? "text-status-warn" : ""}
        />
      </div>

      {/* التبويبان */}
      <Tabs value={dir} onValueChange={(v) => setDir(v as Dir)}>
        <TabsList className="h-auto w-full justify-start overflow-x-auto">
          <TabsTrigger value="out" className="gap-1.5">
            <ArrowUpRight className="size-4" />
            على العملاء
            <Badge variant="secondary" className="ms-1 h-5 px-1.5 text-[10px]">
              {outRows.filter(notCancelled).length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="in" className="gap-1.5">
            <ArrowDownLeft className="size-4" />
            من المقاولين
            <Badge variant="secondary" className="ms-1 h-5 px-1.5 text-[10px]">
              {inRows.filter(notCancelled).length}
            </Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* الفلاتر */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="الحالة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            {Object.entries(CLAIM_STATUS_LABEL).map(([k, label]) => (
              <SelectItem key={k} value={k}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SearchableSelect
          value={contractFilter}
          onValueChange={setContractFilter}
          className="w-44"
          options={[
            { value: "all", label: "كل العقود" },
            ...contractOptions.map(([id, num]) => ({ value: String(id), label: num })),
          ]}
          placeholder="العقد"
          searchPlaceholder="ابحث برقم العقد…"
          emptyText="لا نتائج مطابقة"
        />
        <Input
          className="h-9"
          placeholder="بحث برقم المطالبة/العنوان/العميل…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* القائمة */}
      {listQuery.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : listQuery.isError ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">
            تعذر تحميل المطالبات — {errMessage(listQuery.error)}
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <ReceiptText className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">
              {dirRows.length === 0 ? `لا مطالبات ${DIR_LABEL[dir]} بعد` : "لا نتائج مطابقة للفلاتر"}
            </p>
            <p className="text-xs text-muted-foreground">
              سجّل مطالبة جديدة من زر «مطالبة جديدة» — المطالبة السارية تمنع إلغاء السند المرتبط بها.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* سطح المكتب */}
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الرقم</TableHead>
                    <TableHead className="text-start">العقد / العميل</TableHead>
                    <TableHead className="text-start">العنوان</TableHead>
                    <TableHead className="text-start">المبلغ</TableHead>
                    <TableHead className="text-start">الاستحقاق</TableHead>
                    <TableHead className="text-start">الحالة</TableHead>
                    <TableHead className="text-start">مؤجل حتى</TableHead>
                    <TableHead className="text-start">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs font-bold">{c.claimNumber}</TableCell>
                      <TableCell>
                        <div className="text-xs font-semibold">{c.contract?.contractNumber ?? "—"}</div>
                        <div className="text-[11px] text-muted-foreground">{c.contract?.customer?.name ?? "—"}</div>
                      </TableCell>
                      <TableCell className="max-w-48">
                        <div className="truncate text-xs" title={c.title}>{c.title}</div>
                        {c.voucherRef && (
                          <div className="text-[11px] text-muted-foreground">سند: {c.voucherRef}</div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs font-bold tabular-nums">
                        {formatKWD(c.amount)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDate(c.dueDate)}</TableCell>
                      <TableCell>
                        <Badge className={`border-transparent text-[11px] ${statusBadgeClass(c.status)}`}>
                          {CLAIM_STATUS_LABEL[c.status] || c.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {c.status === "postponed" && c.postponedUntil ? fmtDate(c.postponedUntil) : "—"}
                      </TableCell>
                      <TableCell>{renderRowActions(c)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* موبايل */}
          <div className="space-y-2 md:hidden">
            {filtered.map((c) => (
              <Card key={c.id}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold">{c.claimNumber}</span>
                    <Badge className={`border-transparent text-[11px] ${statusBadgeClass(c.status)}`}>
                      {CLAIM_STATUS_LABEL[c.status] || c.status}
                    </Badge>
                    <span className="ms-auto text-sm font-bold tabular-nums">{formatKWD(c.amount)}</span>
                  </div>
                  <div className="text-xs">
                    <span className="font-semibold">{c.contract?.contractNumber ?? "—"}</span>
                    <span className="text-muted-foreground"> · {c.contract?.customer?.name ?? "—"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{c.title}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>الاستحقاق: {fmtDate(c.dueDate)}</span>
                    {c.status === "postponed" && c.postponedUntil && <span>مؤجل حتى: {fmtDate(c.postponedUntil)}</span>}
                    {c.voucherRef && <span>سند: {c.voucherRef}</span>}
                  </div>
                  {renderRowActions(c)}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* ===== حوار رفض/إلغاء ===== */}
      <Dialog open={reasonTarget !== null} onOpenChange={(o) => !o && setReasonTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reasonTarget?.kind === "refused" ? "رفض المطالبة" : "إلغاء المطالبة"}{" "}
              {reasonTarget?.claim.claimNumber ?? ""}
            </DialogTitle>
            <DialogDescription>اذكر السبب — يُسجّل في سجل التدقيق ولا يمكن حذفه لاحقًا.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>السبب *</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {transitionError && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs font-semibold text-destructive">
              {transitionError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setReasonTarget(null)}>
              رجوع
            </Button>
            <Button
              variant="destructive"
              className="h-9"
              disabled={transitionMutation.isPending || !reason.trim()}
              onClick={submitReason}
            >
              {transitionMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              تأكيد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== حوار التأجيل ===== */}
      <Dialog open={postponeTarget !== null} onOpenChange={(o) => !o && setPostponeTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>تأجيل المطالبة {postponeTarget?.claimNumber ?? ""}</DialogTitle>
            <DialogDescription>
              التأجيل يتطلب تاريخًا مستقبليًا «مؤجل حتى» إلزاميًا — يُسجّل في سجل التدقيق.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1.5">
              <Label>مؤجل حتى *</Label>
              <Input type="date" className="h-9" value={postponeDate} onChange={(e) => setPostponeDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>السبب (اختياري)</Label>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          {transitionError && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs font-semibold text-destructive">
              {transitionError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setPostponeTarget(null)}>
              رجوع
            </Button>
            <Button
              className="h-9 gap-1.5"
              disabled={transitionMutation.isPending || !postponeDate}
              onClick={submitPostpone}
            >
              {transitionMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              تأكيد التأجيل
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تفاصيل المطالبة ===== */}
      <Dialog open={detailClaim !== null} onOpenChange={(o) => !o && setDetailClaim(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{detailClaim?.claimNumber ?? ""}</span>
              {detailClaim && (
                <Badge className={`border-transparent text-[11px] ${statusBadgeClass(detailClaim.status)}`}>
                  {CLAIM_STATUS_LABEL[detailClaim.status] || detailClaim.status}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>{detailClaim?.title}</DialogDescription>
          </DialogHeader>
          {detailClaim && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border p-3 text-xs">
                <div>
                  <p className="text-muted-foreground">الاتجاه</p>
                  <p className="font-semibold">{detailClaim.direction === "out" ? "على العميل (لنا)" : "من مقاول (علينا)"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">المبلغ</p>
                  <p className="font-bold tabular-nums">{formatKWD(detailClaim.amount)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">العقد</p>
                  <p className="font-semibold">{detailClaim.contract?.contractNumber ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">العميل</p>
                  <p className="font-semibold">{detailClaim.contract?.customer?.name ?? "—"}</p>
                </div>
                {detailClaim.subContract && (
                  <div>
                    <p className="text-muted-foreground">العقد الباطن</p>
                    <p className="font-semibold">SB-{detailClaim.subContract.id}</p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground">الاستحقاق</p>
                  <p className="font-semibold">{fmtDate(detailClaim.dueDate)}</p>
                </div>
                {detailClaim.postponedUntil && (
                  <div>
                    <p className="text-muted-foreground">مؤجل حتى</p>
                    <p className="font-semibold">{fmtDate(detailClaim.postponedUntil)}</p>
                  </div>
                )}
                {detailClaim.voucherRef && (
                  <div>
                    <p className="text-muted-foreground">سند القبض المرتبط</p>
                    <p className="font-semibold font-mono">{detailClaim.voucherRef}</p>
                  </div>
                )}
              </div>

              {/* سجل التدقيق — زمنيًا */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold">سجل التدقيق</p>
                {(detailClaim.notes || "").trim() ? (
                  <ol className="space-y-1">
                    {(detailClaim.notes || "")
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean)
                      .map((line, i) => (
                        <li key={i} className="flex items-start gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-xs">
                          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold">
                            {i + 1}
                          </span>
                          <span className="min-w-0 break-words">{line}</span>
                        </li>
                      ))}
                  </ol>
                ) : (
                  <p className="text-xs text-muted-foreground">لا حركات مسجلة بعد.</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
