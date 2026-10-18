"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Info,
  Landmark,
  Loader2,
  NotebookText,
  Pencil,
  Scale,
  Send,
  Trash2,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiGet, apiPut } from "./api";
import type {
  OtherBalanceResponse,
  OtherDailySettlementResponse,
  OtherDueItem,
  OtherDueItemsResponse,
  OtherLedgerResponse,
  OtherOpeningResponse,
  OtherTransferCoverageResponse,
  OtherTransferItem,
  OtherTransfersResponse,
  User,
} from "./contrack-types";
import { errMessage, isManagerRole } from "./contrack-types";
import { fmtDate, formatKWD, round3 } from "@/lib/format";
import { OtherCompanyPayPage } from "./OtherCompanyPayPage";

interface OtherCompanyViewProps {
  user: User;
  onAuthError: () => void;
}

type OtherTab = "due" | "transfers" | "ledger" | "daily";

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="gap-1 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="size-4 shrink-0 text-primary/70" />
      </div>
      <p className={`text-base font-bold tabular-nums sm:text-lg ${tone || ""}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      {action && <div className="pt-0.5">{action}</div>}
    </Card>
  );
}

/** لون الرصيد بالإشارة: موجب = مستحق للشركة (أحمر) / سالب = لصالحنا (أخضر) / صفر محايد */
function balanceTone(v: number): string {
  if (v > 0.001) return "text-status-danger";
  if (v < -0.001) return "text-status-done";
  return "text-muted-foreground";
}

function balanceSub(v: number): string {
  if (v > 0.001) return "مستحق للشركة الأخرى";
  if (v < -0.001) return "لصالحنا (دفع زائد)";
  return "مسدد بالكامل";
}

const LEDGER_KIND: Record<string, { label: string; cls: string }> = {
  due: { label: "مستحق صافي", cls: "bg-status-warn-bg text-status-warn" },
  pay: { label: "تسديد", cls: "bg-status-done-bg text-status-done" },
};

export function OtherCompanyView({ user, onAuthError }: OtherCompanyViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);

  // ===== البيانات =====
  const balanceQuery = useQuery<OtherBalanceResponse>({
    queryKey: ["other-balance"],
    queryFn: () => apiGet<OtherBalanceResponse>("/api/other-company/balance"),
  });

  const openingQuery = useQuery<OtherOpeningResponse>({
    queryKey: ["other-opening"],
    queryFn: () => apiGet<OtherOpeningResponse>("/api/other-company/opening"),
  });

  const dueQuery = useQuery<OtherDueItemsResponse>({
    queryKey: ["other-due"],
    queryFn: () => apiGet<OtherDueItemsResponse>("/api/other-company/due-items"),
  });
  const dueItems: OtherDueItem[] = dueQuery.data?.items ?? [];

  const transfersQuery = useQuery<OtherTransfersResponse>({
    queryKey: ["other-transfers"],
    queryFn: () => apiGet<OtherTransfersResponse>("/api/other-company/transfers"),
  });
  const transfers: OtherTransferItem[] = transfersQuery.data?.transfers ?? [];

  // تبويب الدفتر
  const [tab, setTab] = React.useState<OtherTab>("due");

  // ===== صفحة «تسديد مختارات» الكاملة الداخلية (بلا مسار جديد) =====
  const [page, setPage] = React.useState<"pay" | null>(null);
  const [lFrom, setLFrom] = React.useState("");
  const [lTo, setLTo] = React.useState("");
  const ledgerQuery = useQuery<OtherLedgerResponse>({
    queryKey: ["other-ledger", { from: lFrom, to: lTo }],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (lFrom) sp.set("from", lFrom);
      if (lTo) sp.set("to", lTo);
      const qs = sp.toString();
      return apiGet<OtherLedgerResponse>(`/api/other-company/ledger${qs ? `?${qs}` : ""}`);
    },
    enabled: tab === "ledger",
  });

  // تبويب التسوية اليومية
  const [dFrom, setDFrom] = React.useState("");
  const [dTo, setDTo] = React.useState("");
  const dailyQuery = useQuery<OtherDailySettlementResponse>({
    queryKey: ["other-daily", { from: dFrom, to: dTo }],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (dFrom) sp.set("from", dFrom);
      if (dTo) sp.set("to", dTo);
      const qs = sp.toString();
      return apiGet<OtherDailySettlementResponse>(`/api/other-company/daily-settlement${qs ? `?${qs}` : ""}`);
    },
    enabled: tab === "daily",
  });

  React.useEffect(() => {
    for (const e of [balanceQuery.error, openingQuery.error, dueQuery.error, transfersQuery.error]) {
      if (e instanceof ApiError && e.status === 401) onAuthError();
    }
  }, [balanceQuery.error, openingQuery.error, dueQuery.error, transfersQuery.error, onAuthError]);

  React.useEffect(() => {
    for (const e of [ledgerQuery.error, dailyQuery.error]) {
      if (e instanceof ApiError && e.status === 401) onAuthError();
    }
  }, [ledgerQuery.error, dailyQuery.error, onAuthError]);

  const invalidateOther = React.useCallback(() => {
    for (const k of [
      "other-balance",
      "other-opening",
      "other-due",
      "other-transfers",
      "other-ledger",
      "other-daily",
      "gateway-ops",
      "gateway-summary",
    ]) {
      qc.invalidateQueries({ queryKey: [k] });
    }
  }, [qc]);

  // ===== البطاقات =====
  const dueRemaining = round3(
    dueQuery.data?.totals?.remaining ?? dueItems.reduce((s, d) => s + Number(d.remaining || 0), 0)
  );
  const paidTotal = round3(
    balanceQuery.data?.paid ?? transfers.reduce((s, t) => s + Number(t.amount || 0), 0)
  );
  const opening = round3(openingQuery.data?.opening ?? balanceQuery.data?.opening?.amount ?? 0);
  const unallocatedTotal = round3(
    transfers.reduce((s, t) => s + Math.max(0, Number(t.unalloc ?? 0)), 0)
  );
  const balanceFallback = round3(opening + dueRemaining - unallocatedTotal);
  const balance = balanceQuery.data ? Number(balanceQuery.data.remaining) : balanceFallback;

  // ===== الرصيد الافتتاحي (مدير) =====
  const [openingOpen, setOpeningOpen] = React.useState(false);
  const wasOpeningOpen = React.useRef(false);
  const [openingVal, setOpeningVal] = React.useState("");
  const [openingError, setOpeningError] = React.useState("");

  React.useEffect(() => {
    if (openingOpen && !wasOpeningOpen.current) {
      setOpeningVal(String(opening ?? 0));
      setOpeningError("");
    }
    wasOpeningOpen.current = openingOpen;
  }, [openingOpen]);

  const openingMutation = useMutation({
    mutationFn: (v: number) => apiPut("/api/other-company/opening", { amount: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["other-opening"] });
      qc.invalidateQueries({ queryKey: ["other-balance"] });
      qc.invalidateQueries({ queryKey: ["other-ledger"] });
      setOpeningOpen(false);
      toast({ title: "حُفظ الرصيد الافتتاحي" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      setOpeningError(errMessage(e));
    },
  });

  const submitOpening = () => {
    const v = Number(openingVal);
    if (!Number.isFinite(v)) {
      setOpeningError("أدخل رقمًا صحيحًا");
      return;
    }
    if (v < 0) {
      setOpeningError("الرصيد الافتتاحي السالب مرفوض");
      return;
    }
    setOpeningError("");
    openingMutation.mutate(round3(v));
  };

  // ===== تسديد مختارات =====
  const [selectedOps, setSelectedOps] = React.useState<Set<number>>(new Set());
  const allDueSelected = dueItems.length > 0 && dueItems.every((d) => selectedOps.has(d.opId));
  const toggleAllDue = () => {
    if (allDueSelected) setSelectedOps(new Set());
    else setSelectedOps(new Set(dueItems.map((d) => d.opId)));
  };
  const toggleDue = (opId: number, checked: boolean) => {
    const next = new Set(selectedOps);
    if (checked) next.add(opId);
    else next.delete(opId);
    setSelectedOps(next);
  };

  const selectedItems = dueItems.filter((d) => selectedOps.has(d.opId));

  // ===== تغطية التسديد =====
  const [coverageId, setCoverageId] = React.useState<number | null>(null);
  const coverageQuery = useQuery<OtherTransferCoverageResponse>({
    queryKey: ["other-transfer-coverage", coverageId],
    queryFn: () => apiGet<OtherTransferCoverageResponse>(`/api/other-company/transfers/${coverageId}/coverage`),
    enabled: coverageId !== null,
  });

  // ===== حذف تسديد (مدير) =====
  const [deleteTransfer, setDeleteTransfer] = React.useState<OtherTransferItem | null>(null);
  const deleteTransferMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/other-company/transfers/${id}`),
    onSuccess: () => {
      invalidateOther();
      setDeleteTransfer(null);
      toast({ title: "حُذف التسديد", description: "عادت العمليات المغطاة إلى المستحق تلقائيًا" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر حذف التسديد", description: errMessage(e) });
    },
  });

  // ===== صفحة تسديد مختارات الكاملة — تُعرض مكان شاشة القائمة (نفس نمط ContractEditPage) =====
  if (page === "pay") {
    return (
      <OtherCompanyPayPage
        onAuthError={onAuthError}
        selectedItems={selectedItems}
        invalidateOther={invalidateOther}
        onDone={() => {
          setSelectedOps(new Set());
          setPage(null);
        }}
        onCancel={() => setPage(null)}
      />
    );
  }

  // ===== مجاميع التسوية اليومية =====
  const dailyRows = (dailyQuery.data?.days ?? []).map((r) => ({
    ...r,
    cumulative_diff:
      r.cumulative_diff !== undefined
        ? Number(r.cumulative_diff)
        : round3((r.cumulative_due ?? 0) - (r.cumulative_paid ?? 0)),
  }));

  const renderDueCard = (d: OtherDueItem) => (
    <Card key={d.opId}>
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={selectedOps.has(d.opId)}
            onCheckedChange={(v) => toggleDue(d.opId, v === true)}
            aria-label={`تحديد عملية ${d.opId}`}
          />
          <span className="text-sm font-bold tabular-nums">{formatKWD(d.gross)}</span>
          <span className="ms-auto text-xs font-bold tabular-nums text-status-danger">
            متبقي {formatKWD(d.remaining)}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>{fmtDate(d.opDate)}</span>
          <span dir="ltr">{d.phone || "—"}</span>
          {d.customer && <span className="font-medium text-foreground">{d.customer}</span>}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>
            عمولة: <span className="font-semibold tabular-nums text-status-warn">{formatKWD(d.fee)}</span>
          </span>
          <span>
            صافي: <span className="font-semibold tabular-nums">{formatKWD(d.net)}</span>
          </span>
          <span>
            مخصص: <span className="font-semibold tabular-nums">{formatKWD(d.paidAllocated)}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      {/* العنوان */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-extrabold sm:text-xl">
            <Building2 className="size-5 text-primary" />
            الشركة الأخرى
          </h1>
          <p className="text-xs text-muted-foreground">
            مستحقاتنا للشركة المالكة لبوابة الدفع المشتركة — تُستحق صافي (بعد عمولة البوابة) وتُسدَّد بتحويلات.
          </p>
        </div>
        {manager && (
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            onClick={() => setOpeningOpen(true)}
          >
            <Pencil className="size-4" />
            الرصيد الافتتاحي
          </Button>
        )}
      </div>

      {/* رسالة توضيحية ثابتة */}
      <div className="flex items-start gap-2 rounded-lg border border-status-info/40/70 bg-status-info-bg p-2.5 text-xs font-medium text-status-info">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        تسديد الشركة الأخرى لا ينشئ سندات — توزيع على العمليات فقط (عبر transfer_op_allocs على الصافي).
      </div>

      {/* البطاقات */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={Scale}
          label="الرصيد الحالي"
          value={formatKWD(balance)}
          sub={balanceSub(balance)}
          tone={balanceTone(balance)}
        />
        <KpiCard
          icon={Wallet}
          label="المستحق الصافي"
          value={formatKWD(dueRemaining)}
          sub={`${dueItems.length} عملية بغير مسدد كامل`}
          tone="text-status-warn"
        />
        <KpiCard
          icon={CircleDollarSign}
          label="المدفوع"
          value={formatKWD(paidTotal)}
          sub={`${transfers.length} تسديد`}
          tone="text-status-done"
        />
        <KpiCard
          icon={Landmark}
          label="الافتتاحي"
          value={formatKWD(opening)}
          sub={manager ? "قابل للتعديل (مدير)" : "صف واحد — السالب مرفوض"}
        />
      </div>

      {/* التبويبات */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as OtherTab)}>
        <TabsList className="h-auto w-full justify-start overflow-x-auto">
          <TabsTrigger value="due" className="gap-1.5">
            <Wallet className="size-4" />
            المستحقات
            <Badge variant="secondary" className="ms-1 h-5 px-1.5 text-[10px]">
              {dueItems.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="transfers" className="gap-1.5">
            <Send className="size-4" />
            التسديدات
            <Badge variant="secondary" className="ms-1 h-5 px-1.5 text-[10px]">
              {transfers.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="ledger" className="gap-1.5">
            <NotebookText className="size-4" />
            الدفتر
          </TabsTrigger>
          <TabsTrigger value="daily" className="gap-1.5">
            <Scale className="size-4" />
            التسوية اليومية
          </TabsTrigger>
        </TabsList>

        {/* ===== المستحقات ===== */}
        <TabsContent value="due" className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              عمليات البوابة المصنفة «للشركة الأخرى» والمحصلة والموزعة — تُسدد على الصافي (المبلغ − العمولة).
            </p>
            <Button
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => setPage("pay")}
            >
              <Send className="size-4" />
              تسديد مختارات{selectedOps.size > 0 ? ` (${selectedOps.size})` : ""}
            </Button>
          </div>

          {dueQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : dueQuery.isError ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-destructive">
                تعذر تحميل المستحقات — {errMessage(dueQuery.error)}
              </CardContent>
            </Card>
          ) : dueItems.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                <Wallet className="size-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">لا مستحقات للشركة الأخرى</p>
                <p className="text-xs text-muted-foreground">
                  العمليات المصنفة «أخرى» والموزعة والمحصلة تظهر هنا بمتبقي الصافي.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="hidden md:block">
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8">
                          <Checkbox
                            checked={allDueSelected}
                            onCheckedChange={toggleAllDue}
                            aria-label="تحديد الكل"
                          />
                        </TableHead>
                        <TableHead className="text-start">التاريخ</TableHead>
                        <TableHead className="text-start">الهاتف</TableHead>
                        <TableHead className="text-start">العميل</TableHead>
                        <TableHead className="text-start">المبلغ</TableHead>
                        <TableHead className="text-start">العمولة</TableHead>
                        <TableHead className="text-start">الصافي</TableHead>
                        <TableHead className="text-start">المخصص</TableHead>
                        <TableHead className="text-start">المتبقي</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dueItems.map((d) => (
                        <TableRow key={d.opId}>
                          <TableCell>
                            <Checkbox
                              checked={selectedOps.has(d.opId)}
                              onCheckedChange={(v) => toggleDue(d.opId, v === true)}
                              aria-label={`تحديد عملية ${d.opId}`}
                            />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">{fmtDate(d.opDate)}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs" dir="ltr">
                            {d.phone || "—"}
                          </TableCell>
                          <TableCell className="max-w-40">
                            <div className="truncate text-xs" title={d.customer ?? ""}>
                              {d.customer || "—"}
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs font-bold tabular-nums">
                            {formatKWD(d.gross)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs tabular-nums text-status-warn">
                            {formatKWD(d.fee)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs font-semibold tabular-nums">
                            {formatKWD(d.net)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                            {formatKWD(d.paidAllocated)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs font-bold tabular-nums text-status-danger">
                            {formatKWD(d.remaining)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <div className="space-y-2 md:hidden">{dueItems.map(renderDueCard)}</div>
            </>
          )}
        </TabsContent>

        {/* ===== التسديدات ===== */}
        <TabsContent value="transfers" className="mt-3 space-y-3">
          {transfersQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : transfersQuery.isError ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-destructive">
                تعذر تحميل التسديدات — {errMessage(transfersQuery.error)}
              </CardContent>
            </Card>
          ) : transfers.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                <Send className="size-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">لا تسديدات بعد</p>
                <p className="text-xs text-muted-foreground">سجّل تسديدًا من تبويب المستحقات بتحديد عمليات ثم «تسديد مختارات».</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="hidden md:block">
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-start">التاريخ</TableHead>
                        <TableHead className="text-start">المبلغ</TableHead>
                        <TableHead className="text-start">الطريقة</TableHead>
                        <TableHead className="text-start">المرجع</TableHead>
                        <TableHead className="text-start">التخصيص</TableHead>
                        <TableHead className="text-start">إجراءات</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transfers.map((t) => {
                        const unalloc = t.unalloc;
                        const full = t.status === "full" || (unalloc !== undefined && unalloc <= 0.001);
                        return (
                          <TableRow key={t.id}>
                            <TableCell className="whitespace-nowrap text-xs">{fmtDate(t.tdate)}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs font-bold tabular-nums">
                              {formatKWD(t.amount)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">{t.method || "—"}</TableCell>
                            <TableCell className="whitespace-nowrap font-mono text-[11px]">{t.ref || "—"}</TableCell>
                            <TableCell>
                              {full ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-status-done">
                                  <CheckCircle2 className="size-3.5" />
                                  مخصص كامل {t.nOps !== undefined ? `(${t.nOps} عملية)` : ""}
                                </span>
                              ) : unalloc !== undefined ? (
                                <Badge className="border-0 bg-status-warn-bg text-[10px] text-status-warn">
                                  {t.status === "open" ? "على الحساب" : "جزئي"} {formatKWD(unalloc)}
                                </Badge>
                              ) : (
                                <span className="text-[11px] text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                                  onClick={() => setCoverageId(t.id)}
                                >
                                  <ChevronRight className="size-3.5" />
                                  تغطية
                                </Button>
                                {manager && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 gap-1 border-status-danger/40 px-2 text-xs text-status-danger hover:bg-status-danger-bg hover:text-status-danger"
                                    onClick={() => setDeleteTransfer(t)}
                                  >
                                    <Trash2 className="size-3.5" />
                                    حذف
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* موبايل */}
              <div className="space-y-2 md:hidden">
                {transfers.map((t) => {
                  const unalloc = t.unalloc;
                  const full = t.status === "full" || (unalloc !== undefined && unalloc <= 0.001);
                  return (
                    <Card key={t.id}>
                      <CardContent className="space-y-2 p-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold tabular-nums">{formatKWD(t.amount)}</span>
                          {unalloc !== undefined ? (
                            full ? (
                              <span className="ms-auto inline-flex items-center gap-1 text-[11px] font-bold text-status-done">
                                <CheckCircle2 className="size-3.5" />
                                مخصص كامل
                              </span>
                            ) : (
                              <Badge className="ms-auto border-0 bg-status-warn-bg text-[10px] text-status-warn">
                                على الحساب {formatKWD(unalloc ?? 0)}
                              </Badge>
                            )
                          ) : (
                            <span className="ms-auto text-[11px] text-muted-foreground">—</span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span>{fmtDate(t.tdate)}</span>
                          {t.method && <span className="font-medium text-foreground">{t.method}</span>}
                          {t.ref && <span className="font-mono">{t.ref}</span>}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                            onClick={() => setCoverageId(t.id)}
                          >
                            <ChevronRight className="size-3.5" />
                            تغطية
                          </Button>
                          {manager && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 border-status-danger/40 px-2 text-xs text-status-danger hover:bg-status-danger-bg hover:text-status-danger"
                              onClick={() => setDeleteTransfer(t)}
                            >
                              <Trash2 className="size-3.5" />
                              حذف
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </TabsContent>

        {/* ===== الدفتر ===== */}
        <TabsContent value="ledger" className="mt-3 space-y-3">
          <Card>
            <CardContent className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
              <Input type="date" className="h-9" value={lFrom} onChange={(e) => setLFrom(e.target.value)} aria-label="من تاريخ" />
              <Input type="date" className="h-9" value={lTo} onChange={(e) => setLTo(e.target.value)} aria-label="إلى تاريخ" />
            </CardContent>
          </Card>

          {ledgerQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : ledgerQuery.isError ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-destructive">
                تعذر تحميل الدفتر — {errMessage(ledgerQuery.error)}
              </CardContent>
            </Card>
          ) : (ledgerQuery.data?.lines ?? []).length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                <NotebookText className="size-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">لا حركات في الفترة</p>
                <p className="text-xs text-muted-foreground">الدفتر: افتتاحي + مستحق صافي + تسديدات برصيد تراكمي.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">التاريخ</TableHead>
                      <TableHead className="text-start">النوع</TableHead>
                      <TableHead className="text-start">البيان</TableHead>
                      <TableHead className="text-start">مضاف</TableHead>
                      <TableHead className="text-start">مخصوم</TableHead>
                      <TableHead className="text-start">الرصيد</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(ledgerQuery.data?.prior ?? 0) !== 0 && (
                      <TableRow className="bg-muted/40 font-semibold">
                        <TableCell className="text-xs" colSpan={5}>
                          رصيد أول الفترة (شامل الافتتاحي {formatKWD(ledgerQuery.data?.opening?.amount ?? 0)})
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs font-bold tabular-nums">
                          {formatKWD(ledgerQuery.data?.prior ?? 0)}
                        </TableCell>
                      </TableRow>
                    )}
                    {(ledgerQuery.data?.lines ?? []).map((r, i) => {
                      const kind = LEDGER_KIND[r.kind] ?? {
                        label: r.kind === "pay" ? "تسديد" : "مستحق صافي",
                        cls: "bg-status-done-bg text-status-done",
                      };
                      return (
                        <TableRow key={i}>
                          <TableCell className="whitespace-nowrap font-mono text-xs">{fmtDate(r.date)}</TableCell>
                          <TableCell>
                            <Badge className={`${kind.cls} border-0 text-[10px]`}>{kind.label}</Badge>
                          </TableCell>
                          <TableCell className="max-w-64">
                            <div className="truncate text-xs text-muted-foreground" title={r.text ?? ""}>
                              {r.text || "—"}
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs font-semibold tabular-nums text-status-warn">
                            {Number(r.plus || 0) > 0 ? formatKWD(r.plus) : "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs font-semibold tabular-nums text-status-done">
                            {Number(r.minus || 0) > 0 ? formatKWD(r.minus) : "—"}
                          </TableCell>
                          <TableCell
                            className={`whitespace-nowrap text-xs font-bold tabular-nums ${balanceTone(Number(r.balance || 0))}`}
                          >
                            {formatKWD(r.balance)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-muted/40 font-bold">
                      <TableCell className="text-xs" colSpan={4}>
                        الإجماليات: مضاف {formatKWD(ledgerQuery.data?.totalPlus ?? 0)} · مخصوم{" "}
                        {formatKWD(ledgerQuery.data?.totalMinus ?? 0)}
                      </TableCell>
                      <TableCell className="text-xs">الختامي</TableCell>
                      <TableCell
                        className={`whitespace-nowrap text-xs font-extrabold tabular-nums ${balanceTone(Number(ledgerQuery.data?.end ?? 0))}`}
                      >
                        {formatKWD(ledgerQuery.data?.end ?? 0)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ===== التسوية اليومية ===== */}
        <TabsContent value="daily" className="mt-3 space-y-3">
          <Card>
            <CardContent className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
              <Input type="date" className="h-9" value={dFrom} onChange={(e) => setDFrom(e.target.value)} aria-label="من تاريخ" />
              <Input type="date" className="h-9" value={dTo} onChange={(e) => setDTo(e.target.value)} aria-label="إلى تاريخ" />
            </CardContent>
          </Card>

          {dailyQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : dailyQuery.isError ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-destructive">
                تعذر تحميل التسوية اليومية — {errMessage(dailyQuery.error)}
              </CardContent>
            </Card>
          ) : dailyRows.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                <Scale className="size-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">لا أيام في الفترة</p>
                <p className="text-xs text-muted-foreground">مستحق كل يوم (صافي) مقابل المسدد منه والفرق التراكمي.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">اليوم</TableHead>
                      <TableHead className="text-start">عدد</TableHead>
                      <TableHead className="text-start">المستحق الصافي</TableHead>
                      <TableHead className="text-start">المسدد</TableHead>
                      <TableHead className="text-start">المتبقي</TableHead>
                      <TableHead className="text-start">التراكمي</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dailyRows.map((r, i) => {
                      const remaining =
                        r.remaining !== undefined ? Number(r.remaining) : round3(Number(r.net || 0) - Number(r.paid || 0));
                      return (
                        <TableRow key={i}>
                          <TableCell className="whitespace-nowrap font-mono text-xs font-bold">{fmtDate(r.day)}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                            {r.n ?? "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs font-semibold tabular-nums">
                            {formatKWD(r.net)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs tabular-nums text-status-done">
                            {formatKWD(r.paid)}
                          </TableCell>
                          <TableCell
                            className={`whitespace-nowrap text-xs font-bold tabular-nums ${balanceTone(remaining)}`}
                          >
                            {formatKWD(remaining)}
                          </TableCell>
                          <TableCell
                            className={`whitespace-nowrap text-xs font-bold tabular-nums ${balanceTone(Number(r.cumulative_diff ?? 0))}`}
                          >
                            {formatKWD(r.cumulative_diff)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ===== حوار تغطية التسديد ===== */}
      <Dialog open={coverageId !== null} onOpenChange={(o) => !o && setCoverageId(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>تغطية التسديد #{coverageId ?? ""}</DialogTitle>
            <DialogDescription>ما غطّاه التسديد من عمليات (توزيع على الصافي) وما بقي على الحساب.</DialogDescription>
          </DialogHeader>
          {coverageQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : coverageQuery.isError ? (
            <p className="text-sm text-destructive">{errMessage(coverageQuery.error)}</p>
          ) : (
            <div className="space-y-2">
              {coverageQuery.data?.transfer && (
                <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
                  <div>
                    <div className="text-muted-foreground">التاريخ</div>
                    <div className="font-bold">{fmtDate(coverageQuery.data.transfer.tdate)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">المبلغ</div>
                    <div className="font-extrabold tabular-nums">{formatKWD(coverageQuery.data.transfer.amount)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">الطريقة / المرجع</div>
                    <div className="font-bold">
                      {coverageQuery.data.transfer.method || "—"} {coverageQuery.data.transfer.ref ? `· ${coverageQuery.data.transfer.ref}` : ""}
                    </div>
                  </div>
                </div>
              )}
              {(coverageQuery.data?.ops ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">تسديد على الحساب — لا عمليات مغطاة</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">التاريخ</TableHead>
                      <TableHead className="text-start">الهاتف</TableHead>
                      <TableHead className="text-start">العميل</TableHead>
                      <TableHead className="text-start">الصافي</TableHead>
                      <TableHead className="text-start">المخصص</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(coverageQuery.data?.ops ?? []).map((it) => (
                      <TableRow key={it.id}>
                        <TableCell className="whitespace-nowrap text-xs">{fmtDate(it.opDate)}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs" dir="ltr">
                          {it.phone || "—"}
                        </TableCell>
                        <TableCell className="max-w-36">
                          <div className="truncate text-xs" title={it.customer ?? ""}>
                            {it.customer || "—"}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                          {formatKWD(it.net)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs font-bold tabular-nums">
                          {formatKWD(it.alloc)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {(coverageQuery.data?.groups ?? []).length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                  {(coverageQuery.data?.groups ?? []).map((g) => (
                    <span key={g.date}>
                      {fmtDate(g.date)}: {g.n} عملية · صافي {formatKWD(g.net)}
                    </span>
                  ))}
                </div>
              )}
              {coverageQuery.data?.transfer &&
                Number(coverageQuery.data.transfer.unalloc ?? 0) > 0.0005 && (
                  <p className="text-xs font-semibold text-status-warn">
                    غير مخصص (على الحساب): {formatKWD(coverageQuery.data.transfer.unalloc ?? 0)}
                  </p>
                )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ===== حوار الرصيد الافتتاحي (مدير) ===== */}
      <Dialog open={openingOpen} onOpenChange={setOpeningOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>الرصيد الافتتاحي للشركة الأخرى</DialogTitle>
            <DialogDescription>صف واحد — الرصيد السالب مرفوض. يدخل في الرصيد الحالي والدفتر.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>المبلغ *</Label>
            <Input
              className="h-9 ltr text-start"
              inputMode="decimal"
              value={openingVal}
              onChange={(e) => setOpeningVal(e.target.value)}
            />
          </div>
          {openingError && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs font-semibold text-destructive">
              {openingError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setOpeningOpen(false)}>
              إلغاء
            </Button>
            <Button className="h-9" disabled={openingMutation.isPending} onClick={submitOpening}>
              {openingMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== حوار حذف تسديد (مدير) ===== */}
      <Dialog open={deleteTransfer !== null} onOpenChange={(o) => !o && setDeleteTransfer(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>حذف التسديد</DialogTitle>
            <DialogDescription>
              يحذف التحويل ويعيد تخصيصاته — العمليات المغطاة تعود للمستحق تلقائيًا. لا أثر على سندات العملاء.
            </DialogDescription>
          </DialogHeader>
          {deleteTransfer && (
            <div className="rounded-lg border bg-muted/30 p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">التاريخ / المبلغ</span>
                <span className="font-extrabold tabular-nums">
                  {fmtDate(deleteTransfer.tdate)} · {formatKWD(deleteTransfer.amount)}
                </span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-muted-foreground">الطريقة / المرجع</span>
                <span className="font-bold">
                  {deleteTransfer.method || "—"} {deleteTransfer.ref ? `· ${deleteTransfer.ref}` : ""}
                </span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setDeleteTransfer(null)}>
              رجوع
            </Button>
            <Button
              className="h-9 border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80"
              disabled={deleteTransferMutation.isPending}
              onClick={() => deleteTransfer && deleteTransferMutation.mutate(deleteTransfer.id)}
            >
              {deleteTransferMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              حذف نهائي
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
