"use client";

/**
 * قسم «البرنامج الزمني» في شاشة العقد — ب1 (docs/schedule-import-design.md §4/§6).
 * يعرض حالة أحدث دفعة استيراد (المراجعة/Data Date/نافذة المشروع) + جدول نوافذ الأقسام
 * المشتقة من أنشطة work مقابل قيم بنود BOQ — هذا هو «عندي برنامج زمني معروف كل بند
 * هيخلص امتي» على مستوى القسم (الربط المباشر activity→بند = ب3).
 * كل الأرقام مشتقة لحظة الطلب (G9) — الاستيراد عبر ScheduleImportDialog.
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
import type { ScheduleStateDTO } from "@/lib/schedule-types";

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

export function ScheduleSection({ contractId, manager, refreshKey, onImportClick, onAuthError }: ScheduleSectionProps) {
  const stateQuery = useQuery<ScheduleStateDTO>({
    queryKey: ["contract", contractId, "schedule", refreshKey],
    queryFn: () => apiGet<ScheduleStateDTO>(`/api/contracts/${contractId}/schedule`),
    retry: false,
  });
  React.useEffect(() => {
    if (stateQuery.error instanceof Error && /401|جلسة/.test(stateQuery.error.message)) onAuthError();
  }, [stateQuery.error, onAuthError]);

  const state = stateQuery.data;
  const latest = state?.latest ?? null;
  const divisions = state?.divisions ?? [];

  return (
    <Card className="p-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-1.5">
            <CalendarRange className="size-4 text-amber-700 dark:text-amber-400" aria-hidden />
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
            («كل بند هيخلص امتي») وتُبنى مقارنة «متأخرين فين متقدمين فين».
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
              <p className="text-xs text-amber-700 dark:text-amber-400">
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
      </CardContent>
    </Card>
  );
}
