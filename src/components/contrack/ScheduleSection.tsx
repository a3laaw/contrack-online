"use client";

/**
 * قسم «البرنامج الزمني» في شاشة العقد — ب1 + ج1 المتبقي (docs/schedule-import-design.md §4/§6/§8).
 * ب1: حالة أحدث دفعة استيراد (المراجعة/Data Date/نافذة المشروع) + جدول نوافذ الأقسام
 * المشتقة من أنشطة work مقابل قيم بنود BOQ — «عندي برنامج زمني معروف كل بند هيخلص امتي»
 * على مستوى القسم (الربط المباشر activity→بند = ب3).
 * ج1 المتبقي (§8): قسم «النافذة لكل بند» — البرنامج الزمني للبنود مرئيًا: ترتيب زمني +
 * شريط كل بند على محور المشروع + حالة الجدولة (جارية/قادمة/متجاوزة) + أيام متبقية/تجاوز —
 * كلها مشتقة لحظة الطلب من GET /boq عبر نواة schedule-items-core (G9 — لا حالة مخزنة).
 * الاستيراد عبر ScheduleImportDialog.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, Clock3, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet } from "./api";
import { formatKWD } from "@/lib/format";
import { scheduleItemsView, type ScheduleItemRow, type ScheduleItemStatus } from "@/lib/schedule-items-core";
import type { ScheduleStateDTO } from "@/lib/schedule-types";
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
              نافذة كل بند مخططة من نافذة قسمه (عمودا «مخطط» في بنود الكميات) — الربط المباشر نشطة↔بند في المرحلة ب3.
            </p>
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
      </CardContent>
    </Card>
  );
}
