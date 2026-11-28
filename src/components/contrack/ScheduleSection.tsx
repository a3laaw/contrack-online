"use client";

/**
 * قسم «البرنامج الزمني» في شاشة العقد — ب1 + ب2/ب3 + ج1 المتبقي (docs/schedule-import-design.md §4/§6/§8/§12/§13).
 * ب1: حالة أحدث دفعة استيراد (المراجعة/Data Date/نافذة المشروع) + جدول نوافذ الأقسام
 * المشتقة من أنشطة work مقابل قيم بنود BOQ — «عندي برنامج زمني معروف كل بند هيخلص امتي».
 * ب3 (§13): شجرة الأنشطة بالـbands + Float المشتق (الصفر مسار حرج) + الربط المباشر
 * نشطة→بند للمدير + التوزيع الشهري بالأقسام من الأنشطة (منحنى أدق §4) — كلها
 * مشتقة بالعميل من صفوف GET /schedule (G9 — لا حالة مخزنة).
 * ج1 المتبقي (§8): قسم «النافذة لكل بند» — البرنامج الزمني للبنود مرئيًا.
 * الاستيراد عبر ScheduleImportDialog.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, ChevronDown, ChevronLeft, Clock3, Link2, Network, Unlink, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPatch } from "./api";
import { errMessage } from "./contrack-types";
import { formatKWD } from "@/lib/format";
import { scheduleItemsView, type ScheduleItemRow, type ScheduleItemStatus } from "@/lib/schedule-items-core";
import { buildActivityTree, distributeSectionAcrossActivities } from "@/lib/schedule-activities-core";
import type { ScheduleActivityDTO, ScheduleStateDTO } from "@/lib/schedule-types";
import type { BoqResponse } from "./contrack-types";

interface ScheduleSectionProps {
  contractId: number;
  manager: boolean;
  /** إبطال الاستعلامات بعد استيراد جديد */
  refreshKey: number;
  onImportClick: () => void;
  onAuthError: () => void;
}

function fmtDate(d: string): string {
  return d ? d.slice(2) : "—";
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** شارة حالة الجدولة — ألوان الهوية (لا أزرق/نيلي) */
const STATUS_META: Record<ScheduleItemStatus, { label: string; variant: "success" | "outline" | "warn" | "secondary" }> = {
  active: { label: "جارية", variant: "success" },
  upcoming: { label: "قادمة", variant: "outline" },
  overdue: { label: "متجاوزة", variant: "warn" },
  none: { label: "بلا نافذة", variant: "secondary" },
};

/** ب3 — شارة نوع النشطة */
const KIND_LABELS: Record<string, string> = {
  work: "عمل",
  submittal: "تسليم",
  approval: "اعتماد",
  procurement: "شراء",
  shopdrawing: "رسم تنفيذي",
  testing: "اختبار",
  authority: "جهة",
  closeout: "إقفال",
  general: "عام",
};

/** شارة Float — null «—» · صفر مسار حرج · موجب بالأيام */
function FloatBadge({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>;
  if (value === 0) return <Badge variant="warn" className="text-[10px]">حرج — صفر Float</Badge>;
  return (
    <Badge variant="outline" className="text-[10px] tabular-nums" dir="ltr">
      {value} يوم
    </Badge>
  );
}

export function ScheduleSection({ contractId, manager, refreshKey, onImportClick, onAuthError }: ScheduleSectionProps) {
  const stateQuery = useQuery<ScheduleStateDTO>({
    queryKey: ["contract", contractId, "schedule", refreshKey],
    queryFn: () => apiGet<ScheduleStateDTO>(`/api/contracts/${contractId}/schedule`),
    retry: false,
  });
  React.useEffect(() => {
    if (stateQuery.error instanceof Error && /401|جلسة/.test(stateQuery.error.message)) onAuthError();
  }, [stateQuery.error, onAuthError]);

  // ج1 المتبقي — بنود العقد (نفس مفتاح كاش ContractDetailView — مشاركة لا إعادة جلب)
  const boqQuery = useQuery<BoqResponse>({
    queryKey: ["contract", contractId, "boq"],
    queryFn: () => apiGet<BoqResponse>(`/api/contracts/${contractId}/boq`),
    enabled: stateQuery.isSuccess, // البرنامج الزمني بلا استيراد أيضًا يدويًا — يكفي نجاح الحالة
  });

  const state = stateQuery.data;
  const latest = state?.latest ?? null;
  const divisions = state?.divisions ?? [];

  // اشتقاق العرض الزمني — يعرضه حتى مع استيراد واحد فقط (استقلالية عن دقة القسم)
  const [divisionFilter, setDivisionFilter] = React.useState<string>("all");
  const scheduleRows: ScheduleItemRow[] = React.useMemo(() => {
    const items = boqQuery.data?.items ?? [];
    return items
      .filter((it) => !it.deleted)
      .map((it) => ({
        id: it.id,
        itemNo: it.itemNo ?? "",
        description: it.description,
        divisionCode: it.divisionCode ?? "",
        divisionName: it.divisionName ?? "",
        plannedStart: it.plannedStart ?? "",
        plannedFinish: it.plannedFinish ?? "",
      }));
  }, [boqQuery.data]);
  const view = React.useMemo(() => scheduleItemsView(scheduleRows, todayStr()), [scheduleRows]);
  const filteredRows = React.useMemo(
    () => (divisionFilter === "all" ? view.rows : view.rows.filter((r) => r.divisionCode === divisionFilter)),
    [view.rows, divisionFilter]
  );
  const divisionCodes = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const r of view.rows) if (r.divisionCode && !map.has(r.divisionCode)) map.set(r.divisionCode, r.divisionName || r.divisionCode);
    return [...map.entries()];
  }, [view.rows]);

  // ==================== ب3 §13.3 — الشجرة والتوزيع والربط ====================
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const activities = state?.activities ?? [];
  const tree = React.useMemo(() => buildActivityTree(activities), [activities]);

  // حالة الفتح: أول band مفتوح افتراضيًا — والباقي بضغطة
  const [openBands, setOpenBands] = React.useState<Set<string>>(() => new Set());
  React.useEffect(() => {
    if (tree.length > 0) setOpenBands((prev) => (prev.size === 0 ? new Set([tree[0].name]) : prev));
  }, [tree]);
  const toggleBand = (name: string) =>
    setOpenBands((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  // حوار الربط
  const [linkTarget, setLinkTarget] = React.useState<ScheduleActivityDTO | null>(null);
  const [linkItemId, setLinkItemId] = React.useState<string>("");
  const linkMutation = useMutation({
    mutationFn: (p: { activityId: number; boqItemId: number | null }) =>
      apiPatch<{ id: number; boqItemId: number | null; message: string }>(
        `/api/contracts/${contractId}/schedule/activity`,
        p
      ),
    onSuccess: (res) => {
      toast({ title: res.message || "حُفظ الربط" });
      setLinkTarget(null);
      setLinkItemId("");
      queryClient.invalidateQueries({ queryKey: ["contract", contractId, "schedule"] });
    },
    onError: (e) => toast({ variant: "destructive", title: "تعذر حفظ الربط", description: errMessage(e) }),
  });

  // التوزيع الشهري بالأقسام من الأنشطة — منتقي قسم + دلاء مشتقة بالعميل (G9)
  const [distDivision, setDistDivision] = React.useState<string>("");
  const distBuckets = React.useMemo(() => {
    const div = distDivision || divisions[0]?.code || "";
    if (!div) return [];
    const d = divisions.find((x) => x.code === div);
    const acts = activities
      .filter((a) => a.divisionCode === div && a.kind === "work")
      .map((a) => ({ durationDays: a.durationDays, earlyStart: a.earlyStart, earlyFinish: a.earlyFinish }));
    return distributeSectionAcrossActivities(d?.boqTotal ?? 0, acts);
  }, [distDivision, divisions, activities]);
  const distDivisionCode = distDivision || divisions[0]?.code || "";
  const distTotal = distBuckets.length ? distBuckets[distBuckets.length - 1].plannedCum : 0;

  return (
    <Card className="p-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-1.5">
            <CalendarRange className="size-4 text-warn-ink" aria-hidden />
            البرنامج الزمني · {latest ? `المراجعة ${latest.revision || "—"}` : "لا يوجد استيراد"}
          </span>
          {manager && (
            <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={onImportClick}>
              <Upload className="size-4" />
              {latest ? "استيراد تحديث (R02)" : "استيراد ملف البرنامج الزمني"}
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {stateQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
          </div>
        ) : !latest ? (
          <p className="py-2 text-center text-sm text-muted-foreground">
            لم يُستورد برنامج زمني بعد — ارفع ملف CPM من Primavera لتُشتق نافذة كل قسم وبند
            («كل بند هيخلص امتي») وتُبنى مقارنة «متأخرين فين متقدمين فين» — أو عيّن نافذة البند يدويًا
            من عمود «النافذة المخططة» في جدول البنود أعلاه.
          </p>
        ) : (
          <div className="space-y-3">
            {/* شريط ملخص الجدول الحي */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">الأنشطة المستوردة</p>
                <p className="text-lg font-bold tabular-nums">{latest.activityCount}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">أنشطة عمل</p>
                <p className="text-lg font-bold tabular-nums">{latest.workCount}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">نافذة المشروع</p>
                <p className="text-sm font-bold tabular-nums" dir="ltr">
                  {fmtDate(latest.projectStart)} ← {fmtDate(latest.projectFinish)}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock3 className="size-3" aria-hidden /> Data Date
                </p>
                <p className="text-sm font-bold tabular-nums" dir="ltr">{fmtDate(latest.dataDate)}</p>
              </div>
            </div>

            {latest.warnings.length > 0 && (
              <p className="text-xs text-warn-ink">
                تحذيرات الاستيراد: {latest.warnings[0]}
                {latest.warnings.length > 1 && ` (+${latest.warnings.length - 1})`}
              </p>
            )}

            {/* نوافذ الأقسام — النافذة المخططة لكل قسم من CPM مقابل قيمة القسم */}
            {divisions.length === 0 ? (
              <p className="text-xs text-muted-foreground">لا أنشطة عمل مطابقة للأقسام في هذه الدفعة.</p>
            ) : (
              <div className="rounded-xl border overflow-hidden">
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">القسم</TableHead>
                        <TableHead className="min-w-32">الاسم</TableHead>
                        <TableHead className="w-20 text-center">الأنشطة</TableHead>
                        <TableHead className="w-40 text-center">النافذة المخططة</TableHead>
                        <TableHead className="w-16 text-center">بنود</TableHead>
                        <TableHead className="w-28 text-end">قيمة القسم</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {divisions.map((d) => (
                        <TableRow key={d.code}>
                          <TableCell>
                            <Badge variant="secondary" className="tabular-nums" dir="ltr">{d.code}</Badge>
                          </TableCell>
                          <TableCell className="font-medium">{d.name}</TableCell>
                          <TableCell className="text-center tabular-nums">{d.activityCount}</TableCell>
                          <TableCell className="text-center tabular-nums text-xs" dir="ltr">
                            {fmtDate(d.start)} ← {fmtDate(d.finish)}
                          </TableCell>
                          <TableCell className="text-center tabular-nums">{d.boqItems}</TableCell>
                          <TableCell className="text-end font-bold tabular-nums" dir="ltr">{formatKWD(d.boqTotal)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              نافذة كل بند مخططة من نافذة قسمه (عمودا «مخطط» في بنود الكميات) — والبند المربوط
              بنشطاته من الشجرة أدناه تُشتق نافذته من أنشطته حصرًا (ب3 — دقة الأنشطة).
            </p>

            {/* ==================== ب3 §13.3 — شجرة الأنشطة ==================== */}
            {tree.length === 0 ? (
              <p className="text-xs text-muted-foreground">لا أنشطة معروضة في هذه الدفعة.</p>
            ) : (
              <div>
                <p className="flex items-center gap-1.5 text-sm font-bold">
                  <Network className="size-4 text-primary-ink" aria-hidden /> شجرة الأنشطة — بالأبنية (Float من Early/Late المحفوظة)
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  الأنشطة: {activities.length} · الأبنية: {tree.length} · الربط بنشطة بند يشتق نافذته في اللوحة من الأنشطة حصرًا.
                </p>
                <div className="mt-2 rounded-xl border">
                  <div className="max-h-96 overflow-y-auto">
                    {tree.map((band) => {
                      const open = openBands.has(band.name);
                      return (
                        <div key={band.name} className="border-b last:border-b-0">
                          <button
                            type="button"
                            onClick={() => toggleBand(band.name)}
                            className="flex min-h-11 w-full items-center justify-between gap-2 bg-muted/40 px-3 py-2 text-start transition-colors hover:bg-muted/70"
                            aria-expanded={open}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              {open ? (
                                <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                              ) : (
                                <ChevronLeft className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                              )}
                              <span className="truncate text-sm font-bold">{band.name}</span>
                            </span>
                            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{band.count} نشطة</span>
                          </button>
                          {open && (
                            <div>
                              {/* سطح المكتب: جدول الأنشطة */}
                              <div className="hidden overflow-x-auto md:block">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="w-28">الكود</TableHead>
                                      <TableHead className="min-w-40">الاسم</TableHead>
                                      <TableHead className="w-20 text-center">النوع</TableHead>
                                      <TableHead className="w-32 text-center">Early</TableHead>
                                      <TableHead className="w-14 text-center">مدة</TableHead>
                                      <TableHead className="w-24 text-center">Float</TableHead>
                                      <TableHead className="w-24 text-center">البند المربوط</TableHead>
                                      {manager && <TableHead className="w-16 text-center">ربط</TableHead>}
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {band.items.map((a) => (
                                      <TableRow key={a.id}>
                                        <TableCell className="tabular-nums text-xs text-muted-foreground" dir="ltr">{a.activityCode || "—"}</TableCell>
                                        <TableCell className="max-w-56 truncate text-xs" title={a.name}>{a.name}</TableCell>
                                        <TableCell className="text-center">
                                          <Badge variant={a.kind === "work" ? "secondary" : "outline"} className="text-[10px]">
                                            {KIND_LABELS[a.kind] || a.kind}
                                          </Badge>
                                        </TableCell>
                                        <TableCell className="text-center text-[11px] tabular-nums" dir="ltr">
                                          {a.earlyStart ? fmtDate(a.earlyStart) : "—"}
                                        </TableCell>
                                        <TableCell className="text-center text-xs tabular-nums">{a.durationDays}</TableCell>
                                        <TableCell className="text-center"><FloatBadge value={a.float} /></TableCell>
                                        <TableCell className="text-center text-[11px] tabular-nums" dir="ltr">
                                          {a.boqItemId ? (a.linkedItemNo || `#${a.boqItemId}`) : "—"}
                                        </TableCell>
                                        {manager && (
                                          <TableCell className="text-center">
                                            {a.boqItemId ? (
                                              <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-8 gap-1 text-warn-ink"
                                                disabled={linkMutation.isPending}
                                                onClick={() => linkMutation.mutate({ activityId: a.id, boqItemId: null })}
                                                title="فك الربط"
                                              >
                                                <Unlink className="size-3.5" />
                                                فك
                                              </Button>
                                            ) : (
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-8 gap-1"
                                                onClick={() => {
                                                  setLinkTarget(a);
                                                  setLinkItemId("");
                                                }}
                                                title="ربط ببند"
                                              >
                                                <Link2 className="size-3.5" />
                                                ربط
                                              </Button>
                                            )}
                                          </TableCell>
                                        )}
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                              {/* الجوال: بطاقات النشطة */}
                              <div className="space-y-2 p-2 md:hidden">
                                {band.items.map((a) => (
                                  <Card key={a.id} className="p-2.5">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="text-[11px] tabular-nums text-muted-foreground" dir="ltr">{a.activityCode || "—"}</span>
                                      <Badge variant={a.kind === "work" ? "secondary" : "outline"} className="text-[10px]">
                                        {KIND_LABELS[a.kind] || a.kind}
                                      </Badge>
                                      <FloatBadge value={a.float} />
                                    </div>
                                    <p className="mt-1 truncate text-sm font-medium" title={a.name}>{a.name}</p>
                                    <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                                      <span dir="ltr" className="tabular-nums">{a.earlyStart ? fmtDate(a.earlyStart) : "—"} · {a.durationDays} يوم</span>
                                      {a.boqItemId ? (
                                        <span className="flex items-center gap-1">
                                          <span dir="ltr" className="tabular-nums">{a.linkedItemNo || `#${a.boqItemId}`}</span>
                                          {manager && (
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              className="h-8 text-warn-ink"
                                              disabled={linkMutation.isPending}
                                              onClick={() => linkMutation.mutate({ activityId: a.id, boqItemId: null })}
                                            >
                                              <Unlink className="size-3.5" />
                                              فك
                                            </Button>
                                          )}
                                        </span>
                                      ) : manager ? (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-8 gap-1"
                                          onClick={() => {
                                            setLinkTarget(a);
                                            setLinkItemId("");
                                          }}
                                        >
                                          <Link2 className="size-3.5" />
                                          ربط ببند
                                        </Button>
                                      ) : (
                                        <span>—</span>
                                      )}
                                    </div>
                                  </Card>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ==================== ب3 §13.3 — التوزيع الشهري بالأقسام من الأنشطة (منحنى أدق §4) ==================== */}
            {divisions.length > 0 && activities.some((a) => a.kind === "work" && a.durationDays > 0 && a.earlyStart && a.earlyFinish) && (
              <div>
                <p className="text-sm font-bold">التوزيع الشهري بالأقسام — من الأنشطة (منحنى أدق)</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  قيمة القسم توزّع على أنشطته بوزن المدة وكل نشطة تنتشر خطيًا داخل نافذتها — عرض بالأقسام لا يمس أساس PV الإداري للبنود.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {divisions.map((d) => (
                    <button
                      key={d.code}
                      type="button"
                      onClick={() => setDistDivision(d.code)}
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                        distDivisionCode === d.code ? "border-primary bg-primary/10 font-bold" : "border-border hover:bg-muted/60"
                      }`}
                    >
                      <span dir="ltr" className="tabular-nums">{d.code}</span> {d.name}
                    </button>
                  ))}
                </div>
                {distBuckets.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">لا أنشطة مؤرخة بمدة لهذا القسم — لا منحنى مختلق.</p>
                ) : (
                  <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr]">
                    <div className="overflow-hidden rounded-xl border">
                      <div className="max-h-96 overflow-y-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-24 text-center">الشهر</TableHead>
                              <TableHead className="text-end">المخطط من الأنشطة</TableHead>
                              <TableHead className="text-end">التراكمي</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {distBuckets.map((m) => (
                              <TableRow key={m.month}>
                                <TableCell className="text-center tabular-nums" dir="ltr">{m.month}</TableCell>
                                <TableCell className="text-end font-bold tabular-nums" dir="ltr">{formatKWD(m.planned)}</TableCell>
                                <TableCell className="text-end tabular-nums text-muted-foreground" dir="ltr">{formatKWD(m.plannedCum)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="rounded-lg border p-2.5">
                        <p className="text-[10px] text-muted-foreground">قيمة القسم المستهدفة بالتوزيع</p>
                        <p className="text-sm font-bold tabular-nums" dir="ltr">{formatKWD(divisions.find((x) => x.code === distDivisionCode)?.boqTotal ?? 0)}</p>
                      </div>
                      <div className="rounded-lg border p-2.5">
                        <p className="text-[10px] text-muted-foreground">نهاية المنحنى (يجب أن تطابق قيمة القسم)</p>
                        <p className={`text-sm font-bold tabular-nums ${Math.abs(distTotal - (divisions.find((x) => x.code === distDivisionCode)?.boqTotal ?? 0)) < 0.01 ? "text-status-done" : "text-warn-ink"}`} dir="ltr">
                          {formatKWD(distTotal)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ============ ج1 المتبقي (§8) — النافذة لكل بند: البرنامج الزمني للبنود ============ */}
        {boqQuery.isLoading ? (
          <div className="mt-3 space-y-2 border-t pt-3">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-9 rounded-lg" />)}
          </div>
        ) : (
          <div className="mt-3 border-t pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold">النافذة لكل بند — البرنامج الزمني للبنود</p>
              {view.rows.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  بنود: {view.totals.total} · بنافذة: {view.totals.withWindow} ·{" "}
                  <span className="text-success-ink">جارية {view.totals.active}</span> ·{" "}
                  <span className="text-warn-ink">متجاوزة {view.totals.overdue}</span> ·{" "}
                  <span className="text-muted-foreground">قادمة {view.totals.upcoming}</span>
                </p>
              )}
            </div>

            {scheduleRows.length === 0 ? (
              <p className="py-2 text-center text-xs text-muted-foreground">لا بنود كميات على هذا العقد بعد.</p>
            ) : view.totals.withWindow === 0 ? (
              <p className="py-2 text-center text-xs text-muted-foreground">
                لا بنود بنافذة مخططة بعد — استورد ملف البرنامج الزمني لتعبئتها آليًا من نوافذ الأقسام،
                أو عيّن نافذة كل بند يدويًا من عمود «النافذة المخططة» في جدول البنود أعلاه.
              </p>
            ) : (
              <>
                {/* رأس المحور — نافذة المشروع من البنود ذات النافذة */}
                {view.projectWindow && divisionFilter === "all" && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    محور المشروع من البنود:{" "}
                    <span dir="ltr" className="tabular-nums">
                      {view.projectWindow.start.slice(2)} ← {view.projectWindow.finish.slice(2)}
                    </span>{" "}
                    ({Math.max(1, Math.round((new Date(`${view.projectWindow.finish}T00:00:00Z`).getTime() - new Date(`${view.projectWindow.start}T00:00:00Z`).getTime()) / 86400000))} يوماً)
                  </p>
                )}
                {divisionCodes.length > 1 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setDivisionFilter("all")}
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                        divisionFilter === "all" ? "border-primary bg-primary/10 font-bold" : "border-border hover:bg-muted/60"
                      }`}
                    >
                      كل الأقسام
                    </button>
                    {divisionCodes.map(([code, name]) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setDivisionFilter(code)}
                        title={name}
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                          divisionFilter === code ? "border-primary bg-primary/10 font-bold" : "border-border hover:bg-muted/60"
                        }`}
                      >
                        <span dir="ltr" className="tabular-nums">{code}</span> {name}
                      </button>
                    ))}
                  </div>
                )}

                {/* سطح المكتب: جدول زمني بأشرطة على المحور */}
                <div className="mt-2 hidden overflow-hidden rounded-xl border md:block">
                  <div className="max-h-96 overflow-y-auto overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-24">رقم البند</TableHead>
                          <TableHead className="min-w-36">الوصف</TableHead>
                          <TableHead className="w-16 text-center">القسم</TableHead>
                          <TableHead className="w-32 text-center">النافذة</TableHead>
                          <TableHead className="min-w-44">الشريط على المحور</TableHead>
                          <TableHead className="w-20 text-center">الحالة</TableHead>
                          <TableHead className="w-20 text-center">الأيام</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRows.map((r) => {
                          const meta = STATUS_META[r.status];
                          return (
                            <TableRow key={r.id}>
                              <TableCell className="tabular-nums text-muted-foreground" dir="ltr">{r.itemNo || "—"}</TableCell>
                              <TableCell className="max-w-56 truncate" title={r.description}>{r.description}</TableCell>
                              <TableCell className="text-center">
                                {r.divisionCode ? (
                                  <Badge variant="outline" className="text-[10px]" dir="ltr">{r.divisionCode}</Badge>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-center text-xs tabular-nums" dir="ltr">
                                {r.status !== "none" ? `${r.plannedStart.slice(2)} ← ${r.plannedFinish.slice(2)}` : "—"}
                              </TableCell>
                              <TableCell>
                                {r.bar && view.projectWindow ? (
                                  <div
                                    className="relative h-3 w-full min-w-40 overflow-hidden rounded-full bg-muted/70"
                                    role="img"
                                    aria-label={`نافذة البند ${r.itemNo || r.description} على محور المشروع`}
                                  >
                                    <div
                                      className={`absolute inset-y-0 rounded-full ${
                                        r.status === "overdue" ? "bg-warn-ink/70" : r.status === "active" ? "bg-primary/70" : "bg-muted-foreground/40"
                                      }`}
                                      style={{ left: `${r.bar.left}%`, width: `${r.bar.width}%` }}
                                    />
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge variant={meta.variant} className="text-[10px]">{meta.label}</Badge>
                              </TableCell>
                              <TableCell className="text-center text-xs tabular-nums" dir="ltr">
                                {r.status === "none" ? "—" : r.daysToFinish > 0 ? `${r.daysToFinish}` : r.daysToFinish === 0 ? "اليوم" : `${Math.abs(r.daysToFinish)}+`}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {/* الجوال: قائمة مكدسة — بند/نافذة/شريط/حالة */}
                <div className="mt-2 space-y-2 md:hidden">
                  {filteredRows.map((r) => {
                    const meta = STATUS_META[r.status];
                    return (
                      <Card key={r.id} className="p-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {r.itemNo && <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">{r.itemNo}</span>}
                          {r.divisionCode && <Badge variant="outline" className="text-[10px]" dir="ltr">{r.divisionCode}</Badge>}
                          <Badge variant={meta.variant} className="text-[10px]">{meta.label}</Badge>
                        </div>
                        <p className="mt-1 truncate text-sm font-medium" title={r.description}>{r.description}</p>
                        {r.bar && view.projectWindow && (
                          <div
                            className="mt-1.5 relative h-2.5 w-full overflow-hidden rounded-full bg-muted/70"
                            role="img"
                            aria-label={`نافذة البند ${r.itemNo || r.description} على محور المشروع`}
                          >
                            <div
                              className={`absolute inset-y-0 rounded-full ${
                                r.status === "overdue" ? "bg-warn-ink/70" : r.status === "active" ? "bg-primary/70" : "bg-muted-foreground/40"
                              }`}
                              style={{ left: `${r.bar.left}%`, width: `${r.bar.width}%` }}
                            />
                          </div>
                        )}
                        <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                          <span dir="ltr" className="tabular-nums">
                            {r.status !== "none" ? `${r.plannedStart.slice(2)} ← ${r.plannedFinish.slice(2)}` : "بلا نافذة"}
                          </span>
                          <span dir="ltr" className="tabular-nums">
                            {r.status === "none" ? "" : r.daysToFinish > 0 ? `متبقي ${r.daysToFinish} يوماً` : r.daysToFinish === 0 ? "تنتهي اليوم" : `تجاوز ${Math.abs(r.daysToFinish)} يوماً`}
                          </span>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* حوار الربط المباشر — ب3 §13.3 (منتقي البنود مرشح بقسم النشطة أولًا) */}
        <Dialog open={linkTarget !== null} onOpenChange={(v) => !v && setLinkTarget(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base">ربط النشطة ببند كميات</DialogTitle>
              <DialogDescription className="sr-only">اختيار بند كميات لربطه بالنشطة — فك الربط من زر فك بالصف</DialogDescription>
            </DialogHeader>
            {linkTarget && (
              <div className="space-y-3">
                <div className="rounded-lg border p-2.5 text-xs">
                  <p className="font-bold" dir="ltr">{linkTarget.activityCode}</p>
                  <p className="mt-0.5 truncate" title={linkTarget.name}>{linkTarget.name}</p>
                  <p className="mt-1 text-muted-foreground" dir="ltr">
                    {linkTarget.earlyStart ? `${linkTarget.earlyStart} ← ${linkTarget.earlyFinish}` : "بلا تواريخ"} · {linkTarget.durationDays} يوم
                  </p>
                </div>
                {linkTarget.boqItemId && (
                  <p className="text-xs text-warn-ink">
                    مربوط حاليًا بالبند <span dir="ltr" className="tabular-nums">{linkTarget.linkedItemNo || `#${linkTarget.boqItemId}`}</span> — الربط الجديد يستبدله.
                  </p>
                )}
                <div>
                  <p className="mb-1.5 text-xs font-bold">اختر البند</p>
                  <Select value={linkItemId} onValueChange={setLinkItemId}>
                    <SelectTrigger className="w-full" aria-label="اختيار البند المربوط">
                      <SelectValue placeholder="بنود كميات العقد" />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {(boqQuery.data?.items ?? [])
                        .filter((it) => !it.deleted)
                        .sort((a, b) => {
                          const aSame = (a.divisionCode || "") === linkTarget.divisionCode ? 0 : 1;
                          const bSame = (b.divisionCode || "") === linkTarget.divisionCode ? 0 : 1;
                          return aSame - bSame || (a.itemNo || "").localeCompare(b.itemNo || "");
                        })
                        .map((it) => (
                          <SelectItem key={it.id} value={String(it.id)}>
                            <span dir="ltr" className="tabular-nums">{it.itemNo || `#${it.id}`}</span> {it.description.slice(0, 44)}
                            {(it.divisionCode || "") === linkTarget.divisionCode ? " — نفس القسم" : ""}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[11px] text-muted-foreground">بنود قسم النشطة ({KIND_LABELS[linkTarget.kind] || linkTarget.kind} — قسم <span dir="ltr" className="tabular-nums">{linkTarget.divisionCode || "—"}</span>) مرتبة أولًا.</p>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setLinkTarget(null)}>إلغاء</Button>
                  <Button
                    size="sm"
                    disabled={!linkItemId || linkMutation.isPending}
                    onClick={() => linkMutation.mutate({ activityId: linkTarget.id, boqItemId: Number(linkItemId) })}
                  >
                    حفظ الربط
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
