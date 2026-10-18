"use client";

import * as React from "react";
import { Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { StatementRow, StatementTotals } from "./contrack-types";
import { formatKWD, fmtDate } from "@/lib/format";

/**
 * جدول كشف الحساب المشترك — يُستخدم في شاشة الكشوفات وتبويب «كشف الحساب» بتفاصيل العقد.
 * القاعدة 5: صفوف الفواتير (kind='invoice_info') «للعلم» فقط — مدين=دائن=0 ولا تخفض المديونية.
 * يتضمن CSS طباعة مبسطًا: إخفاء التنقل (header/footer/nav) عند window.print.
 */
export function StatementTable({
  rows,
  totals,
  loading,
  emptyMessage = "لا حركات في هذا الكشف",
}: {
  rows: StatementRow[];
  totals?: StatementTotals | null;
  loading?: boolean;
  emptyMessage?: string;
}) {
  return (
    <>
      {/* CSS طباعة مشترك — يُحقن مرة مع الجدول */}
      <style>{`@media print {
        header, footer, nav, .print-hidden { display: none !important; }
        body { background: #fff !important; }
        .print-block { box-shadow: none !important; border: none !important; }
        .print-scroll { max-height: none !important; overflow: visible !important; }
      }`}</style>

      {loading ? (
        <div className="space-y-2 p-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">{emptyMessage}</div>
      ) : (
        <div className="print-block overflow-hidden rounded-lg border">
          <div className="print-scroll max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted">
                <TableRow>
                  <TableHead className="w-16 text-center">#</TableHead>
                  <TableHead className="w-24 whitespace-nowrap">التاريخ</TableHead>
                  <TableHead className="w-28 whitespace-nowrap">المرجع</TableHead>
                  <TableHead>البيان</TableHead>
                  <TableHead className="w-28 text-left whitespace-nowrap">مدين</TableHead>
                  <TableHead className="w-28 text-left whitespace-nowrap">دائن</TableHead>
                  <TableHead className="w-32 text-left whitespace-nowrap">الرصيد</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => {
                  const info = r.kind === "invoice_info";
                  const heavy = r.kind === "opening" || r.kind === "subtotal" || r.kind === "total" || r.kind === "section";
                  return (
                    <TableRow
                      key={`${i}-${r.ref}-${r.date}`}
                      className={
                        info
                          ? "italic text-muted-foreground/70"
                          : heavy
                            ? "bg-muted/60 font-semibold"
                            : undefined
                      }
                    >
                      <TableCell className="text-center text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs" dir="ltr">
                        {fmtDate(r.date)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs font-medium" dir="ltr">
                        {r.ref || "—"}
                      </TableCell>
                      <TableCell className="min-w-48">
                        <span className="line-clamp-2 whitespace-pre-wrap">{r.desc || "—"}</span>
                        {info && (
                          <TooltipProvider delayDuration={150}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="outline"
                                  className="ms-2 h-5 gap-1 border-dashed px-1.5 text-[10px] font-normal not-italic"
                                >
                                  <Info className="size-3" />
                                  للعلم
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-64 text-xs">
                                الفاتورة لا تخفض المديونية — المديونية يخفضها التحصيل فقط.
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </TableCell>
                      <TableCell className="text-left whitespace-nowrap tabular-nums">
                        {r.debit ? formatKWD(r.debit) : "—"}
                      </TableCell>
                      <TableCell className="text-left whitespace-nowrap tabular-nums">
                        {r.credit ? formatKWD(r.credit) : "—"}
                      </TableCell>
                      <TableCell className="text-left whitespace-nowrap font-medium tabular-nums">
                        {formatKWD(r.balance)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              {totals && (
                <TableFooter>
                  <TableRow className="sticky bottom-0 bg-muted font-semibold">
                    <TableCell colSpan={4} className="text-sm">
                      الإجماليات — مدين / دائن / المتبقي
                    </TableCell>
                    <TableCell className="text-left whitespace-nowrap tabular-nums">
                      {formatKWD(totals.debit)}
                    </TableCell>
                    <TableCell className="text-left whitespace-nowrap tabular-nums">
                      {formatKWD(totals.credit)}
                    </TableCell>
                    <TableCell
                      className={`text-left whitespace-nowrap tabular-nums ${
                        totals.remaining > 0.001
                          ? "text-status-warn"
                          : "text-status-done"
                      }`}
                    >
                      {formatKWD(totals.remaining)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </div>
      )}
    </>
  );
}
