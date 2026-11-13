"use client";

/**
 * ProjectsView — وحدة «المشاريع»: مركز عمليات الموقع بعقلية مهندس مدير الموقع.
 * ثلاثة أقسام تحاكي حلقة اليوم الواحد:
 *   1. hub     لوحة المشاريع — صباحًا: أين نقف في كل مشروع؟ (تقدم/مفوتر/محصّل/آخر نشاط)
 *   2. daily   التقرير اليومي — أثناء اليوم: تجميع اشتقاقي لسجلات التنفيذ الميداني لليوم
 *              (لا جدول جديد — G9: مشتق لا مخزّن — docs/daily-report-forecast-design.md §2.2)
 *              + إدخال سريع (كمية أو نسبة %) + طباعة متصفحية (v1 بلا PDF مستقل)
 *   3. takeoff تنفيذ البنود — متابعة تفصيلية: تعاقدي/تغييري/منفذ/موثق/مفوتر لكل بند
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  CalendarDays,
  ClipboardList,
  Loader2,
  NotebookPen,
  Printer,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { ApiError, apiDelete, apiGet, apiPost } from "./api";
import type {
  DailyReportResponse,
  ProjectHubRow,
  ProjectsHubResponse,
  ProjectsSection,
  TakeoffItemDTO,
  TakeoffTotalsDTO,
  User,
} from "./contrack-types";
import { SearchableSelect } from "./SearchableSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatKWD, round3, statusBadgeClass } from "@/lib/format";

/** تاريخ اليوم بتوقيت الكويت (YYYY-MM-DD) — المالك بتوقيت آسيا/الكويت */
function todayKw(): string {
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuwait" });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

interface ProjectsViewProps {
  user: User;
  onAuthError: () => void;
  section: ProjectsSection;
  onSectionChange: (s: ProjectsSection) => void;
  onOpenContract: (id: number) => void;
}

export function ProjectsView({ user, onAuthError, section, onSectionChange, onOpenContract }: ProjectsViewProps) {
  void user;
  const qc = useQueryClient();

  const hubQuery = useQuery<ProjectsHubResponse>({
    queryKey: ["projects-hub"],
    queryFn: () => apiGet<ProjectsHubResponse>("/api/projects/hub"),
  });

  React.useEffect(() => {
    if (hubQuery.error instanceof ApiError && hubQuery.error.status === 401) onAuthError();
  }, [hubQuery.error, onAuthError]);

  // العقد المحدد مشترك بين الأقسام — يبقى محفوظًا عند التنقل بين اللوحة واليومية والبنود
  const [contractId, setContractId] = React.useState<number | null>(null);
  const [date, setDate] = React.useState<string>(todayKw());

  const rows = hubQuery.data?.rows ?? [];
  const projectOptions = React.useMemo(
    () =>
      rows.map((r) => ({
        value: String(r.id),
        label: `${r.contractNumber} — ${r.contractName || r.customerName}`,
      })),
    [rows]
  );

  const openDaily = React.useCallback(
    (id: number) => {
      setContractId(id);
      setDate(todayKw());
      onSectionChange("daily");
    },
    [onSectionChange]
  );

  const openTakeoff = React.useCallback(
    (id: number) => {
      setContractId(id);
      onSectionChange("takeoff");
    },
    [onSectionChange]
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6 print:hidden">
        {/* الترويسة — الجلسة 15: بلا مبدّل أقسام داخل الصفحة؛ الشريط العلوي هو ملاحّ الأقسام الوحيد */}
        <header className="mb-4 flex flex-col gap-3 sm:mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-primary-ink sm:text-2xl">المشاريع</h1>
              <p className="text-xs text-muted-foreground sm:text-sm">
                مركز عمليات الموقع — اللوحة والتقرير اليومي وتنفيذ البنود في مكان واحد
              </p>
            </div>
          </div>
        </header>

        {hubQuery.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-56 rounded-xl" />
            ))}
          </div>
        ) : hubQuery.isError ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-destructive">
              تعذر تحميل لوحة المشاريع — حاول تحديث الصفحة
            </CardContent>
          </Card>
        ) : (
          <>
            {section === "hub" && (
              <HubSection rows={rows} totals={hubQuery.data!.totals} onOpenDaily={openDaily} onOpenTakeoff={openTakeoff} onOpenContract={onOpenContract} />
            )}
            {section === "daily" && (
              <DailySection
                projectOptions={projectOptions}
                contractId={contractId}
                onSelectContract={setContractId}
                date={date}
                onDateChange={setDate}
                onAuthError={onAuthError}
                onSectionChange={onSectionChange}
                qc={qc}
              />
            )}
            {section === "takeoff" && (
              <TakeoffSection
                rows={rows}
                projectOptions={projectOptions}
                contractId={contractId}
                onSelectContract={setContractId}
                onAuthError={onAuthError}
                onOpenDaily={openDaily}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ==================== 1) لوحة المشاريع ====================

function HubSection({
  rows,
  totals,
  onOpenDaily,
  onOpenTakeoff,
  onOpenContract,
}: {
  rows: ProjectHubRow[];
  totals: ProjectsHubResponse["totals"];
  onOpenDaily: (id: number) => void;
  onOpenTakeoff: (id: number) => void;
  onOpenContract: (id: number) => void;
}) {
  return (
    <div className="space-y-4">
      {/* شريط المؤشرات العليا */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard label="المشاريع" value={String(totals.contracts)} sub={`${totals.active} نشط`} />
        <KpiCard label="القيمة الحالية" value={formatKWD(totals.amount)} unit="KWD" />
        <KpiCard label="المنفذ ميدانيًا" value={formatKWD(totals.executed)} unit="KWD" sub={`النسبة ${totals.progressPct}%`} />
        <KpiCard label="المفوتر" value={formatKWD(totals.invoiced)} unit="KWD" />
        <KpiCard label="المحصّل" value={formatKWD(totals.collected)} unit="KWD" />
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            لا مشاريع بعد — أنشئ عقدًا من شاشة العقود ليظهر هنا
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <ProjectCard key={r.id} row={r} onOpenDaily={onOpenDaily} onOpenTakeoff={onOpenTakeoff} onOpenContract={onOpenContract} />
          ))}
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4">
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-lg font-extrabold tabular-nums text-primary-ink" dir="ltr">
          {value} {unit && <span className="text-[11px] font-semibold text-muted-foreground">{unit}</span>}
        </p>
        {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function ProjectCard({
  row,
  onOpenDaily,
  onOpenTakeoff,
  onOpenContract,
}: {
  row: ProjectHubRow;
  onOpenDaily: (id: number) => void;
  onOpenTakeoff: (id: number) => void;
  onOpenContract: (id: number) => void;
}) {
  return (
    <Card className="flex flex-col border-border/60 transition-shadow hover:shadow-md">
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        {/* العنوان والحالة */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-primary-ink">{row.contractName || row.contractNumber}</h3>
            <p className="truncate text-xs text-muted-foreground">
              {row.contractNumber} · {row.customerName}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge className={statusBadgeClass(row.status)}>{row.status}</Badge>
            {row.isSupervision && <Badge variant="outline" className="text-[10px]">إشراف</Badge>}
          </div>
        </div>

        {/* شريط التقدم */}
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>نسبة التنفيذ الميداني</span>
            <span className="font-bold tabular-nums text-primary-ink" dir="ltr">
              {row.progressPct}%
            </span>
          </div>
          <Progress value={Math.max(0, Math.min(100, row.progressPct))} className="h-2" />
        </div>

        {/* المؤشرات الأربع */}
        <div className="grid grid-cols-4 gap-2 rounded-lg bg-muted/50 p-2 text-center">
          <MiniStat label="القيمة" value={formatKWD(row.current)} />
          <MiniStat label="منفذ" value={formatKWD(row.executedAmount)} />
          <MiniStat label="مفوتر" value={formatKWD(row.invoicedAmount)} />
          <MiniStat label="محصّل" value={formatKWD(row.collectedAmount)} />
        </div>

        {/* النشاط */}
        <p className="text-[11px] text-muted-foreground">
          {row.lastExecutionDate ? (
            <>
              آخر تنفيذ: <span className="font-semibold tabular-nums" dir="ltr">{row.lastExecutionDate}</span>
              {row.recentExecCount > 0 && <> · {row.recentExecCount} سجل آخر 7 أيام</>}
            </>
          ) : (
            "لا نشاط ميداني مسجّل بعد"
          )}
          {row.boqItemCount > 0 && <> · {row.boqItemCount} بند BOQ</>}
        </p>

        {/* الإجراءات */}
        <div className="mt-auto grid grid-cols-3 gap-2 pt-1">
          <Button size="sm" variant="secondary" className="h-11 gap-1 text-xs sm:h-9" onClick={() => onOpenDaily(row.id)}>
            <NotebookPen className="size-3.5" />
            تقرير اليوم
          </Button>
          <Button size="sm" variant="outline" className="h-11 gap-1 text-xs sm:h-9" onClick={() => onOpenTakeoff(row.id)}>
            <Activity className="size-3.5" />
            البنود
          </Button>
          <Button size="sm" variant="ghost" className="h-11 gap-1 text-xs sm:h-9" onClick={() => onOpenContract(row.id)}>
            <ArrowLeft className="size-3.5" />
            فتح العقد
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="truncate text-xs font-bold tabular-nums text-primary-ink" dir="ltr" title={value}>
        {value}
      </p>
    </div>
  );
}

// ==================== 2) التقرير اليومي ====================

function DailySection({
  projectOptions,
  contractId,
  onSelectContract,
  date,
  onDateChange,
  onAuthError,
  onSectionChange,
  qc,
}: {
  projectOptions: { value: string; label: string }[];
  contractId: number | null;
  onSelectContract: (id: number | null) => void;
  date: string;
  onDateChange: (d: string) => void;
  onAuthError: () => void;
  onSectionChange: (s: ProjectsSection) => void;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const reportQuery = useQuery<DailyReportResponse>({
    queryKey: ["projects-daily", contractId, date],
    queryFn: () => apiGet<DailyReportResponse>(`/api/contracts/${contractId}/daily-report?date=${date}`),
    enabled: contractId !== null,
  });

  React.useEffect(() => {
    if (reportQuery.error instanceof ApiError && reportQuery.error.status === 401) onAuthError();
  }, [reportQuery.error, onAuthError]);

  const report = reportQuery.data;

  return (
    <div className="space-y-4">
      {/* شريط اختيار المشروع والتاريخ */}
      <Card className="border-border/60">
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="daily-project">المشروع</Label>
            <SearchableSelect
              id="daily-project"
              value={contractId ? String(contractId) : ""}
              onValueChange={(v) => onSelectContract(v ? Number(v) : null)}
              options={projectOptions}
              placeholder="اختر المشروع…"
              searchPlaceholder="ابحث برقم العقد أو الاسم…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="daily-date">تاريخ اليوم</Label>
            <Input
              id="daily-date"
              type="date"
              value={date}
              onChange={(e) => onDateChange(e.target.value)}
              className="h-11 w-full lg:w-44 lg:h-9"
            />
          </div>
          {contractId !== null && (
            <Button
              variant="outline"
              className="h-11 gap-1.5 lg:h-9"
              onClick={() => window.print()}
              disabled={reportQuery.isLoading || !report}
            >
              <Printer className="size-4" />
              طباعة التقرير
            </Button>
          )}
        </CardContent>
      </Card>

      {/* أيام النشاط — تنقل سريع */}
      {report && report.activeDates.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">أيام النشاط:</span>
          {report.activeDates.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onDateChange(d)}
              className={`h-8 rounded-full border px-3 text-[11px] tabular-nums transition-colors ${
                d === date ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted"
              }`}
              dir="ltr"
            >
              {d}
            </button>
          ))}
        </div>
      )}

      {contractId === null ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <CalendarDays className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">اختر المشروع لعرض تقرير اليوم — سجلات التنفيذ الميداني لذلك اليوم تُجمع هنا تلقائيًا</p>
          </CardContent>
        </Card>
      ) : reportQuery.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : reportQuery.isError || !report ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-destructive">تعذر تحميل التقرير اليومي</CardContent>
        </Card>
      ) : (
        <>
          {/* بطاقات ملخص اليوم */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard label="سجلات اليوم" value={String(report.summary.records)} />
            <KpiCard label="بنود نُفذت" value={String(report.summary.itemsTouched)} />
            <KpiCard
              label="موثقة"
              value={String(report.summary.documentedRecords)}
              sub={`غير موثقة ${report.summary.records - report.summary.documentedRecords}`}
            />
            <KpiCard label="قيمة يوم العمل" value={formatKWD(report.summary.dayAmount)} unit="KWD" />
          </div>

          {/* جدول سجلات اليوم */}
          {report.rows.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center text-sm text-muted-foreground">
                لا سجلات تنفيذ بتاريخ <span dir="ltr" className="tabular-nums">{date}</span> — أضف أول سجل من نموذج التسجيل أدناه
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border/60">
              <CardContent className="p-4">
                <h3 className="mb-3 text-sm font-bold text-primary-ink">سجلات تنفيذ اليوم</h3>
                <div className="max-h-96 overflow-y-auto rounded-lg border">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <TableRow>
                        <TableHead className="min-w-44">البند</TableHead>
                        <TableHead className="w-24 text-center">كمية اليوم</TableHead>
                        <TableHead className="w-24 text-center">التراكمي</TableHead>
                        <TableHead className="w-20 text-center">النسبة</TableHead>
                        <TableHead className="w-16 text-center">موثق</TableHead>
                        <TableHead className="min-w-32">ملاحظة</TableHead>
                        <TableHead className="w-24">بواسطة</TableHead>
                        <TableHead className="w-12 text-center">حذف</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.rows.map((e) => (
                        <DailyRow key={e.id} row={e} contractId={contractId} qc={qc} date={date} onAuthError={onAuthError} />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* نموذج التسجيل السريع */}
          <QuickEntry contractId={contractId} date={date} qc={qc} onAuthError={onAuthError} />

          {/* وصول سريع لتفصيل البنود */}
          <div className="flex justify-start">
            <Button variant="ghost" size="sm" className="h-11 gap-1.5 sm:h-9" onClick={() => onSectionChange("takeoff")}>
              <ArrowLeft className="size-3.5" />
              عرض تفصيل تنفيذ البنود
            </Button>
          </div>

          {/* نسخة الطباعة — تظهر حصرًا عند الطباعة (v1 طباعة المتصفح — تصميم §2.2) */}
          <PrintableReport report={report} />
        </>
      )}
    </div>
  );
}

function DailyRow({
  row,
  contractId,
  qc,
  date,
  onAuthError,
}: {
  row: DailyReportResponse["rows"][number];
  contractId: number;
  qc: ReturnType<typeof useQueryClient>;
  date: string;
  onAuthError: () => void;
}) {
  const del = useMutation({
    mutationFn: () => apiDelete(`/api/contracts/${contractId}/executions?executionId=${row.id}`),
    onSuccess: () => {
      toast.success("حُذف سجل التنفيذ — العدادات تحدثت لحظيًا");
      qc.invalidateQueries({ queryKey: ["projects-daily", contractId, date] });
      qc.invalidateQueries({ queryKey: ["contract", contractId, "takeoff"] });
      qc.invalidateQueries({ queryKey: ["projects-hub"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      else toast.error(e instanceof Error ? e.message : "فشل الحذف");
    },
  });

  return (
    <TableRow>
      <TableCell>
        <p className="text-xs font-semibold text-primary-ink">{row.description}</p>
        <p className="text-[10px] text-muted-foreground">
          {row.itemNo && <span dir="ltr">{row.itemNo}</span>}
          {row.itemNo && " · "}
          <span dir="ltr">{row.unit}</span>
        </p>
      </TableCell>
      <TableCell className="text-center text-xs font-bold tabular-nums" dir="ltr">
        {row.qty}
      </TableCell>
      <TableCell className="text-center text-xs tabular-nums text-muted-foreground" dir="ltr">
        {row.executedTotal}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-center gap-1">
          <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-status-done-bg" style={{ width: `${Math.max(0, Math.min(100, row.progressPct))}%` }} />
          </div>
          <span className="text-[10px] tabular-nums text-muted-foreground" dir="ltr">{row.progressPct}%</span>
        </div>
      </TableCell>
      <TableCell className="text-center">
        {row.documented ? <Badge className="bg-status-done-bg text-status-done">موثق</Badge> : <Badge variant="outline" className="text-[10px]">—</Badge>}
      </TableCell>
      <TableCell className="max-w-40 truncate text-xs text-muted-foreground" title={row.note || undefined}>
        {row.note || "—"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{row.createdBy || "—"}</TableCell>
      <TableCell className="text-center">
        <Button
          size="icon"
          variant="ghost"
          className="size-9 text-destructive hover:text-destructive"
          aria-label="حذف السجل"
          disabled={del.isPending}
          onClick={() => {
            if (window.confirm(`حذف سجل «${row.description}» — الكمية ${row.qty}؟ العدادات تُعاد لحظيًا بعد الحذف.`)) del.mutate();
          }}
        >
          {del.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        </Button>
      </TableCell>
    </TableRow>
  );
}

/** نموذج تسجيل سريع: بند + كمية أو نسبة % + موثق + ملاحظة — يغذي FieldExecution مباشرة */
function QuickEntry({
  contractId,
  date,
  qc,
  onAuthError,
}: {
  contractId: number;
  date: string;
  qc: ReturnType<typeof useQueryClient>;
  onAuthError: () => void;
}) {
  const takeoffQuery = useQuery<{ items: TakeoffItemDTO[]; totals: TakeoffTotalsDTO }>({
    queryKey: ["contract", contractId, "takeoff"],
    queryFn: () => apiGet(`/api/contracts/${contractId}/takeoff`),
  });

  React.useEffect(() => {
    if (takeoffQuery.error instanceof ApiError && takeoffQuery.error.status === 401) onAuthError();
  }, [takeoffQuery.error, onAuthError]);

  const items = takeoffQuery.data?.items ?? [];
  const itemOptions = React.useMemo(
    () =>
      items.map((it) => ({
        value: String(it.boqItemId),
        label: `${it.itemNo ? it.itemNo + " · " : ""}${it.description} — منفذ ${it.executedQty}/${it.effectiveQty} ${it.unit}`,
      })),
    [items]
  );

  const [boqItemId, setBoqItemId] = React.useState("");
  const [mode, setMode] = React.useState<"qty" | "pct">("qty");
  const [amount, setAmount] = React.useState("");
  const [documented, setDocumented] = React.useState(false);
  const [note, setNote] = React.useState("");

  const selectedItem = items.find((it) => String(it.boqItemId) === boqItemId) || null;
  // النسبة تتحول لكمية: qty = النسبة × الكمية الفعّالة ÷ 100 (تصميم §2.1 — الكمية الصلبة محرك العدادات G9)
  const qtyFromPct =
    mode === "pct" && selectedItem && amount !== ""
      ? round3((Number(amount) * selectedItem.effectiveQty) / 100)
      : null;
  const effectiveQty = mode === "qty" ? selectedItem?.effectiveQty ?? 0 : selectedItem?.effectiveQty ?? 0;
  const availableQty = selectedItem ? round3(selectedItem.effectiveQty - selectedItem.executedQty) : 0;
  const requestedQty = mode === "qty" ? Number(amount) : qtyFromPct ?? 0;
  const overWarning = selectedItem && requestedQty > 0 && requestedQty > availableQty + 1e-9;

  const reset = () => {
    setBoqItemId("");
    setAmount("");
    setDocumented(false);
    setNote("");
  };

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPost(`/api/contracts/${contractId}/executions`, body),
    onSuccess: () => {
      toast.success("سُجل التنفيذ — المقايسة واللوحة تحدثت لحظيًا");
      reset();
      qc.invalidateQueries({ queryKey: ["projects-daily", contractId, date] });
      qc.invalidateQueries({ queryKey: ["contract", contractId, "takeoff"] });
      qc.invalidateQueries({ queryKey: ["projects-hub"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      else toast.error(e instanceof Error ? e.message : "فشل التسجيل");
    },
  });

  const submit = () => {
    if (!selectedItem) {
      toast.error("اختر بند الكميات أولًا");
      return;
    }
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error(mode === "qty" ? "أدخل الكمية المنفذة" : "أدخل نسبة الإنجاز");
      return;
    }
    const qty = mode === "qty" ? round3(n) : qtyFromPct ?? 0;
    if (qty <= 0) {
      toast.error("الكمية الناتجة صفر — راجع الإدخال");
      return;
    }
    save.mutate({
      boqItemId: selectedItem.boqItemId,
      executionDate: date,
      qty,
      documented,
      note: note.trim(),
    });
  };

  return (
    <Card className="border-border/60">
      <CardContent className="space-y-3 p-4">
        <h3 className="text-sm font-bold text-primary-ink">تسجيل تنفيذ اليوم</h3>
        <div className="grid gap-3 lg:grid-cols-12">
          <div className="space-y-1.5 lg:col-span-5">
            <Label htmlFor="qe-item">بند الكميات</Label>
            <SearchableSelect
              id="qe-item"
              value={boqItemId}
              onValueChange={setBoqItemId}
              options={itemOptions}
              placeholder="ابحث برقم البند أو الوصف…"
              searchPlaceholder="ابحث…"
              loading={takeoffQuery.isLoading}
              emptyText="لا بنود — أضف مقايسة العقد أولًا"
            />
            {selectedItem && (
              <p className={`text-[11px] ${overWarning ? "font-semibold text-status-warn" : "text-muted-foreground"}`}>
                الفعّال <span dir="ltr" className="tabular-nums">{effectiveQty}</span> {selectedItem.unit} · المنفذ{" "}
                <span dir="ltr" className="tabular-nums">{selectedItem.executedQty}</span> · المتاح{" "}
                <span dir="ltr" className="tabular-nums">{availableQty}</span>
                {overWarning && " — تحذير: الكمية تتجاوز المتاح"}
              </p>
            )}
          </div>

          <div className="space-y-1.5 lg:col-span-3">
            <Label>طريقة الإدخال</Label>
            <div className="flex gap-1.5" role="group" aria-label="طريقة الإدخال">
              <Button
                type="button"
                size="sm"
                variant={mode === "qty" ? "default" : "outline"}
                className="h-11 flex-1 sm:h-9"
                onClick={() => setMode("qty")}
              >
                كمية
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "pct" ? "default" : "outline"}
                className="h-11 flex-1 sm:h-9"
                onClick={() => setMode("pct")}
              >
                إنجز %
              </Button>
            </div>
            <Input
              type="number"
              min="0"
              step={mode === "qty" ? "0.001" : "0.1"}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={mode === "qty" ? "الكمية المنفذة" : "النسبة 0-100"}
              className="h-11 lg:h-9"
              aria-label={mode === "qty" ? "الكمية المنفذة" : "نسبة الإنجاز بالمئة"}
            />
            {mode === "pct" && qtyFromPct !== null && selectedItem && (
              <p className="text-[11px] text-muted-foreground">
                الكمية = <span dir="ltr" className="font-bold tabular-nums text-primary-ink">{qtyFromPct}</span> {selectedItem.unit}
              </p>
            )}
          </div>

          <div className="space-y-1.5 lg:col-span-4">
            <Label htmlFor="qe-note">ملاحظة (اختياري)</Label>
            <Textarea
              id="qe-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="ماذا تم اليوم في هذا البند…"
              className="min-h-[44px] lg:min-h-[68px]"
              rows={2}
            />
            <div className="flex items-center gap-2">
              <Checkbox id="qe-documented" checked={documented} onCheckedChange={(v) => setDocumented(v === true)} />
              <Label htmlFor="qe-documented" className="cursor-pointer text-xs">
                موثق من مهندس الموقع
              </Label>
            </div>
          </div>
        </div>

        <div className="flex justify-start">
          <Button className="h-11 gap-1.5 sm:h-9" onClick={submit} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <NotebookPen className="size-4" />}
            تسجيل التنفيذ
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** نسخة الطباعة — تقرير يومي جاهز للتوقيع (تظهر فقط عند window.print) */
function PrintableReport({ report }: { report: DailyReportResponse }) {
  if (report.rows.length === 0) return null;
  return (
    <div className="hidden print:block" dir="rtl">
      <div className="border-b-2 border-black pb-2">
        <h2 className="text-lg font-black">التقرير اليومي لأعمال الموقع</h2>
        <p className="text-xs">
          العقد: {report.contractNumber} — {report.contractName} · العميل: {report.customerName}
        </p>
        <p className="text-xs">
          التاريخ: <span dir="ltr">{report.date}</span>
        </p>
      </div>
      <table className="mt-3 w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-black text-right">
            <th className="border border-black p-1">بند BOQ</th>
            <th className="border border-black p-1">الكمية</th>
            <th className="border border-black p-1">الوحدة</th>
            <th className="border border-black p-1">التراكمي</th>
            <th className="border border-black p-1">النسبة</th>
            <th className="border border-black p-1">موثق</th>
            <th className="border border-black p-1">ملاحظة</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((e) => (
            <tr key={e.id} className="border-b border-black">
              <td className="border border-black p-1">
                {e.itemNo ? <span dir="ltr">{e.itemNo}</span> : ""} {e.description}
              </td>
              <td className="border border-black p-1 text-center" dir="ltr">{e.qty}</td>
              <td className="border border-black p-1 text-center" dir="ltr">{e.unit}</td>
              <td className="border border-black p-1 text-center" dir="ltr">{e.executedTotal}</td>
              <td className="border border-black p-1 text-center" dir="ltr">{e.progressPct}%</td>
              <td className="border border-black p-1 text-center">{e.documented ? "نعم" : "لا"}</td>
              <td className="border border-black p-1">{e.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 text-[11px]">
        قيمة يوم العمل: <span dir="ltr">{formatKWD(report.summary.dayAmount)}</span> KWD · السجلات: {report.summary.records} · الموثقة:{" "}
        {report.summary.documentedRecords}
      </div>
      <div className="mt-10 flex justify-between text-xs">
        <div>مهندس الموقع: ...............................</div>
        <div>تمثيل العميل/الاستشاري: ...............................</div>
      </div>
    </div>
  );
}

// ==================== 3) تنفيذ البنود ====================

function TakeoffSection({
  rows,
  projectOptions,
  contractId,
  onSelectContract,
  onAuthError,
  onOpenDaily,
}: {
  rows: ProjectHubRow[];
  projectOptions: { value: string; label: string }[];
  contractId: number | null;
  onSelectContract: (id: number | null) => void;
  onAuthError: () => void;
  onOpenDaily: (id: number) => void;
}) {
  const takeoffQuery = useQuery<{ items: TakeoffItemDTO[]; totals: TakeoffTotalsDTO }>({
    queryKey: ["contract", contractId, "takeoff"],
    queryFn: () => apiGet(`/api/contracts/${contractId}/takeoff`),
    enabled: contractId !== null,
  });

  React.useEffect(() => {
    if (takeoffQuery.error instanceof ApiError && takeoffQuery.error.status === 401) onAuthError();
  }, [takeoffQuery.error, onAuthError]);

  const t = takeoffQuery.data?.totals;

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex-1 space-y-1.5 sm:max-w-md">
            <Label htmlFor="takeoff-project">المشروع</Label>
            <SearchableSelect
              id="takeoff-project"
              value={contractId ? String(contractId) : ""}
              onValueChange={(v) => onSelectContract(v ? Number(v) : null)}
              options={projectOptions}
              placeholder="اختر المشروع…"
              searchPlaceholder="ابحث برقم العقد أو الاسم…"
            />
          </div>
          {contractId !== null && (
            <Button variant="outline" className="h-11 gap-1.5 sm:h-9" onClick={() => onOpenDaily(contractId)}>
              <NotebookPen className="size-4" />
              تقرير اليوم
            </Button>
          )}
        </CardContent>
      </Card>

      {contractId === null ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <Activity className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">اختر المشروع لعرض مقايسة التنفيذ: تعاقدي/تغييري/منفذ/موثق/مفوتر لكل بند</p>
          </CardContent>
        </Card>
      ) : takeoffQuery.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : takeoffQuery.isError || !takeoffQuery.data ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-destructive">تعذر تحميل مقايسة التنفيذ</CardContent>
        </Card>
      ) : (
        <>
          {/* شريط الإجماليات — نفس شارة مقايسة التنفيذ في تفاصيل العقد */}
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="h-8 px-3 tabular-nums text-xs">
              التعاقدي {formatKWD(t?.contractAmount ?? 0)}
            </Badge>
            <Badge variant="outline" className="h-8 px-3 tabular-nums text-xs">
              التغييري {formatKWD(t?.changeAmount ?? 0)}
            </Badge>
            <Badge className="h-8 bg-status-info-bg px-3 tabular-nums text-xs text-status-info">
              المنفذ {formatKWD(t?.executedAmount ?? 0)} ({t?.progressPct ?? 0}%)
            </Badge>
            <Badge variant="outline" className="h-8 px-3 tabular-nums text-xs">
              الموثق {formatKWD(t?.documentedAmount ?? 0)}
            </Badge>
            <Badge variant="outline" className="h-8 px-3 tabular-nums text-xs">
              المفوتر {formatKWD(t?.invoicedAmount ?? 0)}
            </Badge>
            <Badge variant="outline" className="h-8 px-3 tabular-nums text-xs">
              المحصّل {formatKWD(t?.collectedAmount ?? 0)}
            </Badge>
          </div>

          {takeoffQuery.data.items.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center text-sm text-muted-foreground">
                لا بنود كميات لهذا العقد — أضف المقايسة من تفاصيل العقد
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border/60">
              <CardContent className="p-4">
                <div className="max-h-96 overflow-y-auto rounded-lg border">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <TableRow>
                        <TableHead className="min-w-52">البند</TableHead>
                        <TableHead className="w-16 text-center">الوحدة</TableHead>
                        <TableHead className="w-20 text-center">تعاقدي</TableHead>
                        <TableHead className="w-20 text-center">تغييري</TableHead>
                        <TableHead className="w-20 text-center">فعّال</TableHead>
                        <TableHead className="w-20 text-center">منفذ</TableHead>
                        <TableHead className="w-20 text-center">موثق</TableHead>
                        <TableHead className="w-20 text-center">مفوتر</TableHead>
                        <TableHead className="w-28 text-center">النسبة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {takeoffQuery.data.items.map((it) => {
                        const available = round3(it.effectiveQty - it.executedQty);
                        return (
                          <TableRow key={it.boqItemId}>
                            <TableCell>
                              <p className="text-xs font-semibold text-primary-ink">{it.description}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {it.itemNo && <span dir="ltr">{it.itemNo}</span>}
                                {it.stageName && <> · {it.stageName}</>}
                              </p>
                            </TableCell>
                            <TableCell className="text-center text-xs text-muted-foreground" dir="ltr">{it.unit}</TableCell>
                            <TableCell className="text-center text-xs tabular-nums" dir="ltr">{it.contractQty}</TableCell>
                            <TableCell className="text-center text-xs tabular-nums" dir="ltr">{it.changeQty || "—"}</TableCell>
                            <TableCell className="text-center text-xs font-bold tabular-nums" dir="ltr">{it.effectiveQty}</TableCell>
                            <TableCell className="text-center text-xs tabular-nums" dir="ltr">{it.executedQty}</TableCell>
                            <TableCell className="text-center text-xs tabular-nums text-muted-foreground" dir="ltr">{it.documentedQty}</TableCell>
                            <TableCell className="text-center text-xs tabular-nums text-muted-foreground" dir="ltr">{it.invoicedQty}</TableCell>
                            <TableCell>
                              <div className="flex items-center justify-center gap-1.5">
                                <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                                  <div className="h-full bg-status-done-bg" style={{ width: `${Math.max(0, Math.min(100, it.progressPct))}%` }} />
                                </div>
                                <span className="text-[10px] tabular-nums text-muted-foreground" dir="ltr">{it.progressPct}%</span>
                                {available < 0 && (
                                  <span className="text-[10px] font-bold text-status-warn" title="المنفذ يتجاوز الفعّال">
                                    !
                                  </span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  البنود المرتبة حسب تسلسل المقايسة · المفوتر بالبند من أسطر مستخلصات العميل غير الملغاة المرتبطة بالبند (ز1)
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
