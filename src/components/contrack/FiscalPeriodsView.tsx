"use client";

/**
 * شاشة «الفترات والإقفال المالي» — Task 109.
 * ثلاثة أقسام:
 *  1) السنوات المالية: بطاقة لكل سنة — فتراتها الشهرية (فتح/قفل للمدير)، نتيجة السنة
 *     من الأستاذ (إيرادات/مصروفات/صافي)، وإقفالها سنويًا بقيد موثق أو إعادة فتحها.
 *  2) سجل الإقفالات الموثق: كل إقفال بسنة وقيدِه وأرقامه ومن نفّذه ومتى.
 *  3) افتتاحية السنة الجديدة: ميزان محسوب من الأستاذ بنهاية السنة السابقة —
 *     الأستاذ مستمر فيحمل الأرصدة آليًا؛ الوثيقة للمراجعة (قرار معلن في النواة).
 * كل الأرقام من الخادم (الأستاذ مصدر الحقيقة) — الشاشة تعرض ولا تعيد الحساب.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarCheck2,
  CircleDollarSign,
  Download,
  LockKeyhole,
  LockOpen,
  Loader2,
  RefreshCw,
  RotateCcw,
  Stamp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPost } from "./api";
import { errMessage, isManagerRole, type User } from "./contrack-types";
import { formatKWD } from "@/lib/format";
import {
  FISCAL_STATUS_LABEL_AR,
  monthLabelOf,
} from "@/lib/fiscal-close-core";

// ==================== الأنواع ====================

interface PeriodDto {
  id: number;
  periodDate: string;
  status: string;
  entriesCount: number;
}

interface ClosingDto {
  id: number;
  status: string;
  closingEntryId: number | null;
  totalRevenue: number;
  totalExpense: number;
  netResult: number;
  linesCount: number;
  notes: string;
  closedBy: string;
  closedAt: string;
  revertReason: string;
}

interface YearDto {
  id: number;
  year: number;
  status: string;
  pnl: { totalRevenue: number; totalExpense: number; net: number };
  closing: ClosingDto | null;
  periods: PeriodDto[];
}

interface FiscalData {
  years: YearDto[];
  currentYear: number;
}

interface OpeningRow {
  accountId: number;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  net: number;
  side: string;
}

interface OpeningResponse {
  year: number;
  asOf: string;
  priorYearClosed: boolean;
  result: {
    rows: OpeningRow[];
    totals: { debit: number; credit: number; diff: number };
  };
}

// ==================== ثوابت العرض ====================

const TYPE_LABEL_AR: Record<string, string> = {
  asset: "أصول",
  liability: "التزامات",
  equity: "حقوق ملكية",
  revenue: "إيرادات",
  expense: "مصروفات",
};

const CLOSED_CLS = "bg-status-warn-bg text-status-warn";
const OPEN_CLS = "bg-status-done-bg text-status-done";

// ==================== المكوّن ====================

interface FiscalPeriodsViewProps {
  user: User;
  onAuthError: () => void;
}

export function FiscalPeriodsView({ user, onAuthError }: FiscalPeriodsViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);

  const [periodDialog, setPeriodDialog] = React.useState<{ period: PeriodDto; action: "open" | "close" } | null>(null);
  const [periodReason, setPeriodReason] = React.useState("");
  const [closeYear, setCloseYear] = React.useState<YearDto | null>(null);
  const [closeNotes, setCloseNotes] = React.useState("");
  const [reopenYear, setReopenYear] = React.useState<YearDto | null>(null);
  const [reopenReason, setReopenReason] = React.useState("");
  const [openingYear, setOpeningYear] = React.useState<number | null>(null);

  // بيانات الفترات — refresh تلقائي بعد كل إجراء
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["fiscal-periods"],
    queryFn: async () => {
      try {
        return await apiGet<FiscalData>("/api/fiscal-periods");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) onAuthError();
        throw e;
      }
    },
  });

  // تبديل فترة شهرية (مدير)
  const toggleMut = useMutation({
    mutationFn: async (p: { periodId: number; action: "open" | "close"; reason?: string }) =>
      apiPost<{ period: { periodDate: string; status: string } }>("/api/fiscal-periods", p),
    onSuccess: (res, vars) => {
      toast({
        title: vars.action === "close" ? "قُفلت الفترة" : "أُعيد فتح الفترة",
        description: `${monthLabelOf(res.period.periodDate)} — ${FISCAL_STATUS_LABEL_AR[res.period.status]}`,
      });
      setPeriodDialog(null);
      setPeriodReason("");
      qc.invalidateQueries({ queryKey: ["fiscal-periods"] });
    },
    onError: (e) => {
      toast({ title: "تعذر التنفيذ", description: errMessage(e), variant: "destructive" });
    },
  });

  // الإقفال السنوي الموثق (مدير)
  const closeMut = useMutation({
    mutationFn: async (p: { year: number; notes: string }) =>
      apiPost<{ closed: boolean; entryNo: number | null; net: number; totalRevenue: number; totalExpense: number; linesCount: number }>(
        "/api/fiscal-periods/close-year",
        { action: "close", ...p }
      ),
    onSuccess: (res) => {
      toast({
        title: "تم الإقفال السنوي",
        description: `النتيجة ${res.net >= 0 ? "ربح" : "خسارة"} ${formatKWD(Math.abs(res.net))}${
          res.entryNo ? ` — قيد الإغلاق #${res.entryNo}` : " — بلا حركة دخل (بلا قيد)"
        }`,
      });
      setCloseYear(null);
      setCloseNotes("");
      qc.invalidateQueries({ queryKey: ["fiscal-periods"] });
    },
    onError: (e) => {
      toast({ title: "تعذر الإقفال السنوي", description: errMessage(e), variant: "destructive" });
    },
  });

  // إعادة فتح آخر سنة مقفلة (مدير)
  const reopenMut = useMutation({
    mutationFn: async (p: { year: number; reason: string }) =>
      apiPost<{ reopened: boolean; cancelledEntry: boolean }>("/api/fiscal-periods/close-year", {
        action: "reopen",
        ...p,
      }),
    onSuccess: (res) => {
      toast({
        title: `أُعيد فتح السنة`,
        description: res.cancelledEntry ? "أُلغي قيد الإغلاق بسبب موثق — الفترات مفتوحة من جديد." : "فُتحت الفترات من جديد.",
      });
      setReopenYear(null);
      setReopenReason("");
      qc.invalidateQueries({ queryKey: ["fiscal-periods"] });
    },
    onError: (e) => {
      toast({ title: "تعذر إعادة الفتح", description: errMessage(e), variant: "destructive" });
    },
  });

  // افتتاحية السنة الجديدة
  const openingQ = useQuery({
    queryKey: ["fiscal-opening", openingYear],
    enabled: openingYear != null,
    queryFn: async () => {
      try {
        return await apiGet<OpeningResponse>(`/api/fiscal-periods/opening?year=${openingYear}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) onAuthError();
        throw e;
      }
    },
  });

  // ==================== اشتقاقات ====================

  const years = data?.years ?? [];
  const currentPeriodKey = `${data?.currentYear ?? new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const currentPeriod = years
    .flatMap((y) => y.periods)
    .find((p) => p.periodDate === currentPeriodKey);
  const closedPeriods = years.reduce((s, y) => s + y.periods.filter((p) => p.status === "closed").length, 0);
  const totalPeriods = years.reduce((s, y) => s + y.periods.length, 0);
  const closedYears = years.filter((y) => y.closing?.status === "closed");
  const lastClosed = closedYears[0];
  // إعادة الفتح لأحدث سنة مقفلة حصرًا (الخادم يحرس ذلك أيضًا)
  const latestClosedYear = closedYears.reduce<number | null>((acc, y) => (acc == null || y.year > acc ? y.year : acc), null);
  const openingCandidates = React.useMemo(
    () => Array.from(new Set([...(data?.years ?? []).map((y) => y.year), (data?.currentYear ?? 0) + 1])).sort((a, b) => b - a),
    [data]
  );

  const downloadOpeningCsv = () => {
    const q = openingQ.data;
    if (!q || !q.result.rows.length) return;
    const head = "الكود,الحساب,النوع,مدين,دائن,الجهة";
    const lines = q.result.rows.map((r) =>
      [r.code, `"${r.name.replace(/"/g, '""')}"`, TYPE_LABEL_AR[r.type] || r.type, r.debit.toFixed(3), r.credit.toFixed(3), r.side === "debit" ? "مدين" : "دائن"].join(",")
    );
    const totals = `الإجمالي,,,${q.result.totals.debit.toFixed(3)},${q.result.totals.credit.toFixed(3)},`;
    const csv = `\uFEFF${head}\n${lines.join("\n")}\n${totals}\n`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `opening-trial-balance-${q.year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ==================== العرض ====================

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 md:p-6">
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            تعذر تحميل الفترات المالية — {errMessage(error)}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 pb-24" dir="rtl">
      {/* العنوان */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <LockKeyhole className="h-6 w-6 text-primary-ink" />
            الفترات والإقفال المالي
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            قفل الفترات الشهرية، الإقفال السنوي الموثق للنتيجة إلى الأرباح المحتجزة، وافتتاحية السنة الجديدة.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          تحديث
        </Button>
      </div>

      {/* بطاقات المؤشرات */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">الفترة الحالية</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">{monthLabelOf(currentPeriodKey)}</div>
            {currentPeriod ? (
              <Badge className={`mt-1 ${currentPeriod.status === "closed" ? CLOSED_CLS : OPEN_CLS}`}>
                {currentPeriod.status === "closed" ? "مقفلة" : "مفتوحة"}
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">الفترات المقفلة</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">
              {closedPeriods} <span className="text-sm font-normal text-muted-foreground">من {totalPeriods}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">السنوات المقفلة</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">{closedYears.length}</div>
            {lastClosed ? (
              <div className="text-xs text-muted-foreground">آخرها {lastClosed.year}</div>
            ) : (
              <div className="text-xs text-muted-foreground">لا إقفالات بعد</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">آخر نتيجة سنوية</CardTitle>
          </CardHeader>
          <CardContent>
            {lastClosed ? (
              <>
                <div className={`text-lg font-bold ${lastClosed.closing!.netResult >= 0 ? "text-status-done" : "text-status-danger"}`}>
                  {formatKWD(lastClosed.closing!.netResult)}
                </div>
                <div className="text-xs text-muted-foreground">سنة {lastClosed.year}</div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">—</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* السنوات المالية */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">السنوات المالية</h2>
        {years.map((y) => {
          const closed = y.closing?.status === "closed";
          const reverted = y.closing?.status === "reverted";
          return (
            <Card key={y.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <CardTitle className="flex items-center gap-2 text-base">
                    سنة {y.year}
                    <Badge className={y.status === "closed" ? CLOSED_CLS : OPEN_CLS}>
                      {FISCAL_STATUS_LABEL_AR[y.status] || y.status}
                    </Badge>
                    {reverted && (
                      <Badge variant="outline" className="text-status-warn border-status-warn">
                        سُجّل إقفالها معادًا للفتح
                      </Badge>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-2 flex-wrap">
                    {manager && y.status === "open" && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setCloseNotes("");
                          setCloseYear(y);
                        }}
                      >
                        <Stamp className="h-4 w-4" />
                        الإقفال السنوي
                      </Button>
                    )}
                    {manager && closed && latestClosedYear === y.year && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setReopenReason("");
                          setReopenYear(y);
                        }}
                      >
                        <RotateCcw className="h-4 w-4" />
                        إعادة فتح السنة
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setOpeningYear(y.year + 1)}
                    >
                      <CalendarCheck2 className="h-4 w-4" />
                      افتتاحية {y.year + 1}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* نتيجة السنة */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">الإيرادات</div>
                    <div className="text-sm md:text-base font-bold mt-1">{formatKWD(y.pnl.totalRevenue)}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">المصروفات</div>
                    <div className="text-sm md:text-base font-bold mt-1">{formatKWD(y.pnl.totalExpense)}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">النتيجة</div>
                    <div className={`text-sm md:text-base font-bold mt-1 ${y.pnl.net > 0 ? "text-status-done" : y.pnl.net < 0 ? "text-status-danger" : ""}`}>
                      {formatKWD(y.pnl.net)}
                      <span className="text-xs font-normal"> {y.pnl.net > 0 ? "(ربح)" : y.pnl.net < 0 ? "(خسارة)" : ""}</span>
                    </div>
                  </div>
                </div>

                {/* ملخص الإقفال الموثق إن وجد */}
                {y.closing && (
                  <div className="rounded-lg border bg-muted/40 p-3 text-xs md:text-sm space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={closed ? CLOSED_CLS : OPEN_CLS}>
                        {closed ? "مقفلة سنويًا" : "معاد للفتح"}
                      </Badge>
                      {y.closing.closingEntryId && (
                        <span>قيد الإغلاق: {y.closing.closingEntryId > 0 ? `#${y.closing.closingEntryId}` : "—"}</span>
                      )}
                      <span>بواسطة: {y.closing.closedBy || "—"}</span>
                      <span>
                        بتاريخ:{" "}
                        {y.closing.closedAt ? new Date(y.closing.closedAt).toLocaleDateString("ar-KW") : "—"}
                      </span>
                      <span>أسطر الإغلاق: {y.closing.linesCount}</span>
                    </div>
                    {y.closing.notes && <div className="text-muted-foreground">ملاحظات: {y.closing.notes}</div>}
                    {reverted && y.closing.revertReason && (
                      <div className="text-status-warn">سبب الإعادة للفتح: {y.closing.revertReason}</div>
                    )}
                  </div>
                )}

                {/* فترات الشهور */}
                <div>
                  <div className="text-sm font-medium mb-2 flex items-center gap-2">
                    <CircleDollarSign className="h-4 w-4 text-muted-foreground" />
                    الفترات الشهرية — اضغط لتبديل الحالة{manager ? "" : " (عرض)"}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                    {y.periods.map((p) => {
                      const isClosed = p.status === "closed";
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={!manager || y.status === "closed"}
                          onClick={() => {
                            setPeriodReason("");
                            setPeriodDialog({ period: p, action: isClosed ? "open" : "close" });
                          }}
                          className={`rounded-lg border p-2.5 text-right transition-colors min-h-[44px] ${
                            isClosed ? "bg-status-warn-bg border-status-warn/40" : "bg-status-done-bg border-status-done/30"
                          } ${manager && y.status === "open" ? "hover:ring-2 hover:ring-primary/40 cursor-pointer" : "cursor-default opacity-80"}`}
                          title={
                            manager && y.status === "open"
                              ? isClosed
                                ? "اضغط لإعادة الفتح"
                                : "اضغط للقفل"
                              : undefined
                          }
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-semibold">{monthLabelOf(p.periodDate)}</span>
                            {isClosed ? (
                              <LockKeyhole className="h-3.5 w-3.5 text-status-warn shrink-0" />
                            ) : (
                              <LockOpen className="h-3.5 w-3.5 text-status-done shrink-0" />
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {p.entriesCount} قيد منشور
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      {/* سجل الإقفالات الموثق */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">سجل الإقفالات الموثق</h2>
        <Card>
          <CardContent className="p-0">
            {years.every((y) => !y.closing) ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                لا إقفالات سنوية بعد — سجل الإقفالات يوثق كل إقفال بقيدِه وأرقامه ومن نفّذه.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[720px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">السنة</TableHead>
                      <TableHead className="text-right">الحالة</TableHead>
                      <TableHead className="text-right">قيد الإغلاق</TableHead>
                      <TableHead className="text-right">الإيرادات</TableHead>
                      <TableHead className="text-right">المصروفات</TableHead>
                      <TableHead className="text-right">النتيجة</TableHead>
                      <TableHead className="text-right">بواسطة / بتاريخ</TableHead>
                      <TableHead className="text-right">ملاحظات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {years
                      .filter((y) => y.closing)
                      .map((y) => {
                        const c = y.closing!;
                        const reverted = c.status === "reverted";
                        return (
                          <TableRow key={c.id}>
                            <TableCell className="font-bold">{y.year}</TableCell>
                            <TableCell>
                              <Badge className={reverted ? CLOSED_CLS : OPEN_CLS}>
                                {FISCAL_STATUS_LABEL_AR[c.status] || c.status}
                              </Badge>
                            </TableCell>
                            <TableCell>{c.closingEntryId ? `#${c.closingEntryId}` : "بلا قيد"}</TableCell>
                            <TableCell>{formatKWD(c.totalRevenue)}</TableCell>
                            <TableCell>{formatKWD(c.totalExpense)}</TableCell>
                            <TableCell className={c.netResult >= 0 ? "text-status-done font-semibold" : "text-status-danger font-semibold"}>
                              {formatKWD(c.netResult)}
                            </TableCell>
                            <TableCell className="text-xs">
                              {c.closedBy || "—"}
                              {c.closedAt ? ` · ${new Date(c.closedAt).toLocaleDateString("ar-KW")}` : ""}
                            </TableCell>
                            <TableCell className="text-xs max-w-[220px]">
                              {c.notes || "—"}
                              {reverted && c.revertReason && (
                                <div className="text-status-warn mt-1">أُعيد للفتح: {c.revertReason}</div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* افتتاحية السنة الجديدة */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">افتتاحية السنة الجديدة</h2>
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Label className="text-sm">افتتاحية سنة</Label>
                <Select
                  value={openingYear != null ? String(openingYear) : undefined}
                  onValueChange={(v) => setOpeningYear(Number(v) || null)}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder="اختر سنة" />
                  </SelectTrigger>
                  <SelectContent>
                    {openingCandidates.map((yr) => (
                      <SelectItem key={yr} value={String(yr)}>
                        {yr}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {openingQ.data && openingQ.data.result.rows.length > 0 && (
                <Button size="sm" variant="outline" onClick={downloadOpeningCsv}>
                  <Download className="h-4 w-4" />
                  CSV
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
              الأستاذ مستمر عبر السنوات — أرصدة الميزانية تُحمل آليًا للسنة التالية بلا قيد افتتاحية فعلي (كان سيزدوج
              الأرصدة). هذه الوثيقة = ميزان الأرصدة بنهاية السنة السابقة لأغراض المراجعة، وتُوثق نسخة منها في سجل
              الإقفال عند الإغلاق السنوي.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {openingYear == null ? (
              <div className="py-8 text-center text-sm text-muted-foreground">اختر سنة لعرض افتتاحيتها.</div>
            ) : openingQ.isLoading ? (
              <div className="py-8 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : openingQ.error ? (
              <div className="py-8 text-center text-sm text-status-danger">{errMessage(openingQ.error)}</div>
            ) : !openingQ.data!.result.rows.length ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                لا أرصدة محمولة لهذه السنة (بداية جديدة كليًا).
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[640px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">الكود</TableHead>
                      <TableHead className="text-right">الحساب</TableHead>
                      <TableHead className="text-right">النوع</TableHead>
                      <TableHead className="text-right">مدين</TableHead>
                      <TableHead className="text-right">دائن</TableHead>
                      <TableHead className="text-right">الجهة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openingQ.data!.result.rows.map((r) => (
                      <TableRow key={r.accountId}>
                        <TableCell className="font-mono">{r.code}</TableCell>
                        <TableCell>{r.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{TYPE_LABEL_AR[r.type] || r.type}</TableCell>
                        <TableCell className={r.side === "debit" ? "font-semibold" : "text-muted-foreground"}>
                          {r.debit ? formatKWD(r.debit) : "—"}
                        </TableCell>
                        <TableCell className={r.side === "credit" ? "font-semibold" : "text-muted-foreground"}>
                          {r.credit ? formatKWD(r.credit) : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={r.side === "debit" ? "text-foreground" : "text-muted-foreground"}>
                            {r.side === "debit" ? "مدين" : "دائن"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={3} className="text-right font-semibold">
                        الإجمالي — حتى {openingQ.data!.asOf}
                        {openingQ.data!.priorYearClosed ? " (بعد إغلاق نتيجة السنة السابقة)" : " (نتيجة السنة السابقة غير مقفلة)"}
                      </TableCell>
                      <TableCell className="font-bold">{formatKWD(openingQ.data!.result.totals.debit)}</TableCell>
                      <TableCell className="font-bold">{formatKWD(openingQ.data!.result.totals.credit)}</TableCell>
                      <TableCell>
                        {Math.abs(openingQ.data!.result.totals.diff) < 0.001 ? (
                          <Badge className={OPEN_CLS}>متوازن ✔</Badge>
                        ) : (
                          <Badge className={CLOSED_CLS}>فرق {formatKWD(openingQ.data!.result.totals.diff)}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* حوار تبديل فترة */}
      <Dialog open={periodDialog != null} onOpenChange={(o) => !o && setPeriodDialog(null)}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {periodDialog?.action === "close" ? "قفل الفترة الشهرية" : "إعادة فتح الفترة الشهرية"}
            </DialogTitle>
            <DialogDescription>
              {periodDialog && `${monthLabelOf(periodDialog.period.periodDate)} — ${periodDialog.period.entriesCount} قيد منشور.`}
              {periodDialog?.action === "close"
                ? " القفل يمنع نشر أي قيد جديد بتاريخ داخل هذه الفترة — محرك الترحيل يرفضه."
                : " إعادة الفتح تحتاج سببًا يُوثق في سجل التدقيق."}
            </DialogDescription>
          </DialogHeader>
          {periodDialog?.action === "open" && (
            <div className="space-y-2">
              <Label htmlFor="period-reason">سبب إعادة الفتح *</Label>
              <Input
                id="period-reason"
                value={periodReason}
                onChange={(e) => setPeriodReason(e.target.value)}
                placeholder="مثال: تسوية قيد متأخر بإذن الإدارة"
              />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPeriodDialog(null)}>
              إلغاء
            </Button>
            <Button
              disabled={toggleMut.isPending || (periodDialog?.action === "open" && !periodReason.trim())}
              onClick={() => {
                if (!periodDialog) return;
                toggleMut.mutate({
                  periodId: periodDialog.period.id,
                  action: periodDialog.action,
                  reason: periodReason,
                });
              }}
            >
              {toggleMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {periodDialog?.action === "close" ? "تأكيد القفل" : "تأكيد الفتح"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* حوار الإقفال السنوي */}
      <Dialog open={closeYear != null} onOpenChange={(o) => !o && setCloseYear(null)}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>الإقفال السنوي لسنة {closeYear?.year}</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm leading-relaxed">
                <p>تُنفَّذ العملية داخل معاملة ذرية واحدة:</p>
                <ul className="list-disc pr-5 space-y-1 text-muted-foreground">
                  <li>نشر قيد الإغلاق السنوي: إقفال أرصدة الإيرادات والمصروفات إلى الأرباح المحتجزة (بتاريخ 31 ديسمبر).</li>
                  <li>قفل كل فترات سنة {closeYear?.year} — لا قيود جديدة عليها بعده.</li>
                  <li>افتتاح سنة {(closeYear?.year ?? 0) + 1} بفتراتها المفتوحة (الأرصدة تُحمل آليًا).</li>
                  <li>توثيق السجل بأرقام السنة وقيد الإغلاق وميزان الافتتاحية.</li>
                </ul>
                <p>
                  النتيجة الحالية:{" "}
                  <span className={closeYear && closeYear.pnl.net >= 0 ? "text-status-done font-bold" : "text-status-danger font-bold"}>
                    {closeYear ? `${formatKWD(closeYear.pnl.net)} ${closeYear.pnl.net >= 0 ? "ربح" : "خسارة"}` : ""}
                  </span>
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="close-notes">ملاحظات الإقفال (اختياري)</Label>
            <Textarea
              id="close-notes"
              value={closeNotes}
              onChange={(e) => setCloseNotes(e.target.value)}
              placeholder="مثال: إقفال سنة 2025 بعد مراجعة الميزان — إجازة الإدارة"
              rows={2}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCloseYear(null)}>
              إلغاء
            </Button>
            <Button
              variant="destructive"
              disabled={closeMut.isPending}
              onClick={() => closeYear && closeMut.mutate({ year: closeYear.year, notes: closeNotes })}
            >
              {closeMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              تنفيذ الإقفال السنوي
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* حوار إعادة فتح السنة */}
      <Dialog open={reopenYear != null} onOpenChange={(o) => !o && setReopenYear(null)}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>إعادة فتح سنة {reopenYear?.year}</DialogTitle>
            <DialogDescription>
              يُلغى قيد الإغلاق السنوي إلغاءً موثقًا (يبقى في السجل بسبب الإلغاء)، وتُعاد فترات السنة كلها مفتوحة، ويُعلَّم
              سجل الإقفال «معاد للفتح». الإعادة لأحدث سنة مقفلة حصرًا.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reopen-reason">سبب إعادة الفتح *</Label>
            <Textarea
              id="reopen-reason"
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="مثال: ظهور مستند متأخر ضمن السنة — إذن الإدارة"
              rows={2}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReopenYear(null)}>
              إلغاء
            </Button>
            <Button
              variant="destructive"
              disabled={reopenMut.isPending || !reopenReason.trim()}
              onClick={() => reopenYear && reopenMut.mutate({ year: reopenYear.year, reason: reopenReason })}
            >
              {reopenMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              تأكيد إعادة الفتح
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
