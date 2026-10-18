"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Banknote,
  BarChart3,
  BookOpenText,
  Download,
  FileText,
  Gauge,
  HardHat,
  Layers,
  ListFilter,
  Receipt,
  ScrollText,
  Target,
  Timer,
  Users as UsersIcon,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, getStoredToken } from "./api";
import type { ReportCellValue, ReportResponse, User } from "./contrack-types";
import { errMessage } from "./contrack-types";
import { formatKWD } from "@/lib/format";

interface ReportsViewProps {
  user: User;
  onAuthError: () => void;
}

interface ReportOption {
  value: string;
  label: string;
}

interface ReportDef {
  key: string; // مفتاح المسار /api/reports/{key}
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  desc: string;
  period?: boolean; // from/to
  selectParam?: string; // اسم باراميتر القائمة المنسدلة
  selectLabel?: string;
  options?: ReportOption[]; // أول خيار = «الكل» (قيمة فارغة لا تُرسل)
}

const REPORTS: ReportDef[] = [
  {
    key: "customers-balances",
    label: "العملاء والأرصدة",
    icon: UsersIcon,
    desc: "أرصدة العملاء والمحصّل والمستحق الآن",
    period: true,
    selectParam: "option",
    selectLabel: "العرض",
    options: [
      { value: "", label: "الكل" },
      { value: "with_balance", label: "من عليهم أرصدة" },
      { value: "no_balance", label: "بلا أرصدة" },
      { value: "due_only", label: "المستحق الآن فقط" },
      { value: "by_stages", label: "بالمراحل" },
    ],
  },
  {
    key: "stage-dues",
    label: "مستحقات المراحل",
    icon: Layers,
    desc: "المستحق لكل مرحلة بحالاتها الصارمة",
    selectParam: "option",
    selectLabel: "العرض",
    options: [
      { value: "", label: "الكل" },
      { value: "due_only", label: "المستحق الآن" },
      { value: "overdue_only", label: "المتأخر فقط" },
    ],
  },
  {
    key: "supervision-delays",
    label: "تأخير الإشراف",
    icon: Timer,
    desc: "شهور وأيام وأموال التأخير الإشرافي",
    selectParam: "option",
    selectLabel: "العرض",
    options: [
      { value: "unpaid", label: "غير المسددة (افتراضي)" },
      { value: "all", label: "الكل" },
    ],
  },
  {
    key: "subcontractors",
    label: "المقاولون",
    icon: HardHat,
    desc: "تقرير مقاولي الباطن الشامل بالدفعات",
  },
  {
    key: "vouchers",
    label: "الإيرادات والمصروفات",
    icon: Receipt,
    desc: "سندات الفترة مقسمة إيرادًا ومصروفًا",
    period: true,
    selectParam: "vtype",
    selectLabel: "نوع السند",
    options: [
      { value: "", label: "الكل" },
      { value: "receipt", label: "قبض" },
      { value: "payment", label: "صرف" },
      { value: "custody_return", label: "إرجاع عهدة" },
      { value: "salary_deduction", label: "خصم راتب" },
    ],
  },
  {
    key: "expenses",
    label: "تفصيل المصروفات",
    icon: Wallet,
    desc: "المصروفات بتفصيل حساباتها",
    period: true,
  },
  {
    key: "cashflow",
    label: "التدفق النقدي",
    icon: Banknote,
    desc: "الوارد والمنصرف وصافي الحركة",
    period: true,
    selectParam: "mode",
    selectLabel: "العرض",
    options: [
      { value: "detail", label: "تفصيلي" },
      { value: "summary", label: "ملخص" },
      { value: "daily", label: "يومي" },
      { value: "monthly", label: "شهري" },
      { value: "yearly", label: "سنوي" },
    ],
  },
  {
    key: "contracts",
    label: "تقارير العقود",
    icon: FileText,
    desc: "نظرة شاملة وربحية وانتهاء",
    period: true,
    selectParam: "option",
    selectLabel: "الخيار",
    options: [
      { value: "", label: "كل العقود" },
      { value: "profitability", label: "الربحية الفعلية" },
      { value: "profit_by_type", label: "الربحية حسب النوع" },
      { value: "by_type", label: "حسب نوع العقد" },
      { value: "expiring", label: "العقود المنتهية قريبًا" },
    ],
  },
  {
    key: "execution",
    label: "مراحل التنفيذ",
    icon: Gauge,
    desc: "الإشغال الزمني للمراحل الجارية",
    selectParam: "option",
    selectLabel: "العرض",
    options: [
      { value: "", label: "الكل" },
      { value: "current", label: "الجارية" },
      { value: "delayed", label: "المتأخرة" },
      { value: "near", label: "قاربت الانتهاء" },
      { value: "ok", label: "ضمن الوقت" },
      { value: "no_stage", label: "بلا مراحل" },
    ],
  },
  {
    key: "leads",
    label: "الفرص البيعية",
    icon: Target,
    desc: "العملاء المسجلون بلا أي عقد بعد · فرصك البيعية القادمة للتواصل والمتابعة",
    period: true,
  },
  {
    key: "journal",
    label: "دفتر اليومية",
    icon: BookOpenText,
    desc: "قيود اليومية المزدوجة",
    period: true,
  },
];

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** قيمة «الكل» الحسنية — Radix يمنع قيمة فارغة في SelectItem */
const ALL = "__all__";

/** أول يوم من الشهر الحالي — افتراض «من» للتقارير الفترية */
function monthStart(): string {
  return `${todayStr().slice(0, 7)}-01`;
}

/** صف الإجماليات: يدعم مصفوفة أو كائنًا مرسلًا من الخلفي */
function normalizeTotals(data: ReportResponse): ReportCellValue[] | null {
  if (!data.totals) return null;
  if (Array.isArray(data.totals)) {
    return data.totals.length > 0 ? data.totals : null;
  }
  const rec = data.totals as Record<string, ReportCellValue>;
  const byHeads = data.heads.map((h) => (h in rec ? rec[h] : ""));
  if (byHeads.filter((v) => v !== "").length > 1) return byHeads;
  const vals = Object.values(rec);
  return vals.length > 0 ? vals : null;
}

/** تنزيل CSV عبر POST /api/reports/export — blob باسم من عنوان التقرير */
async function downloadCsv(report: string, params: Record<string, string>, title: string): Promise<void> {
  const token = getStoredToken();
  const res = await fetch("/api/reports/export", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
    body: JSON.stringify({ report, params }),
  });
  if (res.status === 401) throw new ApiError("انتهت الجلسة — أعد تسجيل الدخول", 401);
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error || `فشل التصدير (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/\s+/g, "-") || "تقرير"}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ReportsView({ user: _user, onAuthError }: ReportsViewProps) {
  const { toast } = useToast();

  const [selected, setSelected] = React.useState(REPORTS[0].key);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [option, setOption] = React.useState("");
  const [exporting, setExporting] = React.useState(false);

  const def = REPORTS.find((r) => r.key === selected) ?? REPORTS[0];

  // إعادة ضبط الفلاتر عند تبديل التقرير
  React.useEffect(() => {
    setOption("");
    if (def.period) {
      setFrom(monthStart());
      setTo("");
    } else {
      setFrom("");
      setTo("");
    }
  }, [def]);

  const params = React.useMemo(() => {
    const p: Record<string, string> = {};
    if (def.period && from) p.from = from;
    if (def.period && to) p.to = to;
    if (def.selectParam && option) p[def.selectParam] = option;
    return p;
  }, [def, from, to, option]);

  const qs = new URLSearchParams(params).toString();
  const reportQuery = useQuery<ReportResponse>({
    queryKey: ["report", def.key, qs],
    queryFn: () => apiGet<ReportResponse>(`/api/reports/${def.key}${qs ? `?${qs}` : ""}`),
  });

  React.useEffect(() => {
    const e = reportQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [reportQuery.error, onAuthError]);

  const data = reportQuery.data ?? null;
  const totalsRow = data ? normalizeTotals(data) : null;
  const numberCols = React.useMemo(() => new Set(data?.numberCols ?? []), [data]);
  const accents = React.useMemo(() => new Set(data?.accentRows ?? []), [data]);

  const onExport = async () => {
    try {
      setExporting(true);
      await downloadCsv(def.key, params, data?.title || def.label);
      toast({ title: "تم التصدير", description: "نُزّل ملف CSV بنجاح" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر التصدير", description: errMessage(e) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* الترويسة */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BarChart3 className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">مركز التقارير</h1>
            <p className="text-xs text-muted-foreground">تقارير محسوبة لحظيًا من الحركات — لا أرصدة مخزنة</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 md:flex-row">
        {/* القائمة الجانبية — سطح المكتب */}
        <aside className="hidden w-56 shrink-0 md:block">
          <nav className="sticky top-20 space-y-1 rounded-lg border bg-card p-1.5">
            {REPORTS.map((r) => {
              const Icon = r.icon;
              const active = r.key === selected;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setSelected(r.key)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-sm transition-colors ${
                    active
                      ? "bg-primary/10 font-semibold text-primary"
                      : "text-foreground/80 hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{r.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* اختيار التقرير — موبايل */}
        <div className="md:hidden">
          <Label className="mb-1.5 block text-xs text-muted-foreground">اختر التقرير</Label>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="h-10 w-full gap-2">
              <ListFilter className="size-4 shrink-0 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPORTS.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* منطقة التقرير */}
        <div className="min-w-0 flex-1 space-y-3">
          {/* الفلاتر */}
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <def.icon className="size-4 text-primary" />
                  <h2 className="text-sm font-bold">{data?.title || def.label}</h2>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{def.desc}</p>
              </div>

              {def.period && (
                <>
                  <div className="w-36 space-y-1">
                    <Label className="text-xs text-muted-foreground">من تاريخ</Label>
                    <Input
                      type="date"
                      dir="ltr"
                      className="h-9"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </div>
                  <div className="w-36 space-y-1">
                    <Label className="text-xs text-muted-foreground">إلى تاريخ</Label>
                    <Input
                      type="date"
                      dir="ltr"
                      className="h-9"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </div>
                </>
              )}

              {def.selectParam && def.options && (
                <div className="w-44 space-y-1">
                  <Label className="text-xs text-muted-foreground">{def.selectLabel}</Label>
                  <Select value={option ? option : ALL} onValueChange={(v) => setOption(v === ALL ? "" : v)}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="الكل" />
                    </SelectTrigger>
                    <SelectContent>
                      {def.options.map((o) => (
                        <SelectItem key={o.value || ALL} value={o.value || ALL}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Button
                size="sm"
                variant="outline"
                className="h-9 gap-1.5"
                disabled={exporting || reportQuery.isLoading}
                onClick={onExport}
              >
                <Download className="size-4" />
                {exporting ? "جارٍ التصدير…" : "تصدير CSV"}
              </Button>
            </CardContent>
          </Card>

          {/* الجدول الموحد */}
          <Card className="p-0">
            <CardContent className="p-2 sm:p-3">
              {reportQuery.isLoading ? (
                <div className="space-y-2 p-1">
                  <Skeleton className="h-9 w-full" />
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : reportQuery.isError ? (
                <div className="py-10 text-center text-sm text-destructive">
                  تعذر تحميل التقرير — {errMessage(reportQuery.error)}
                </div>
              ) : !data || data.rows.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <ScrollText className="size-8 text-muted-foreground/40" />
                  <p className="text-sm font-medium">لا بيانات في هذه الفترة</p>
                  <p className="text-xs text-muted-foreground">جرّب توسيع الفترة أو تغيير خيارات العرض</p>
                </div>
              ) : (
                <>
                  <div className="max-h-[60vh] overflow-auto rounded-md border">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-muted">
                        <TableRow>
                          <TableHead className="w-12 text-center">#</TableHead>
                          {data.heads.map((h, hi) => (
                            <TableHead
                              key={hi}
                              className={`whitespace-nowrap ${numberCols.has(hi) ? "text-left" : ""}`}
                            >
                              {h}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.rows.map((row, ri) => (
                          <TableRow
                            key={ri}
                            className={accents.has(ri) ? "bg-status-done-bg font-medium" : undefined}
                          >
                            <TableCell className="text-center text-xs text-muted-foreground">{ri + 1}</TableCell>
                            {row.map((cell, ci) => (
                              <TableCell
                                key={ci}
                                className={`whitespace-nowrap ${
                                  numberCols.has(ci) ? "text-left tabular-nums" : ""
                                }`}
                              >
                                {numberCols.has(ci) && typeof cell === "number"
                                  ? formatKWD(cell)
                                  : String(cell ?? "")}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                      {totalsRow && (
                        <TableFooter>
                          <TableRow className="sticky bottom-0 bg-muted font-semibold">
                            <TableCell className="text-center">—</TableCell>
                            {totalsRow.map((cell, ci) => (
                              <TableCell
                                key={ci}
                                className={`whitespace-nowrap ${
                                  numberCols.has(ci) ? "text-left tabular-nums" : ""
                                }`}
                              >
                                {numberCols.has(ci) && typeof cell === "number"
                                  ? formatKWD(cell)
                                  : String(cell ?? "")}
                              </TableCell>
                            ))}
                          </TableRow>
                        </TableFooter>
                      )}
                    </Table>
                  </div>
                  {data.note && (
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">📝 {data.note}</p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
