"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Loader2, TriangleAlert, Wrench } from "lucide-react";

import { apiGet, apiPost } from "./api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * تقرير الفروقات (V3.2 ج) — المرجع: contracts.py GapsDialog
 * «عقود تختلف قيمتها عن خطتها/بنودها» — فتح/إصلاح/تصدير.
 */

interface GapRow {
  contractId: number;
  contractNumber: string;
  customerName: string;
  contractType: string;
  status: string;
  amount: number;
  planTotal: number;
  planN: number;
  itemsTotal: number;
  itemsN: number;
  gapPlan: number;
  gapItems: number;
}

const HEADS = [
  "العقد",
  "العميل",
  "النوع",
  "القيمة",
  "مجموع الخطة",
  "فرق الخطة",
  "مجموع البنود",
  "فرق البنود",
];

const money = (x: number) =>
  x.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const signed = (x: number) => (x > 0 ? `+${money(x)}` : money(x));

interface GapsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenContract: (contractId: number) => void;
}

export function GapsDialog({ open, onOpenChange, onOpenContract }: GapsDialogProps) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [fixOpen, setFixOpen] = React.useState(false);

  const gapsQuery = useQuery<{ rows: GapRow[]; count: number }>({
    queryKey: ["contracts", "gaps"],
    queryFn: async () => apiGet("/api/contracts/gaps"),
    enabled: open,
  });

  const fixMutation = useMutation({
    mutationFn: async (mode: "amounts" | "plan") => {
      const rows = gapsQuery.data?.rows ?? [];
      return apiPost<{ ok: number; skipped: string[]; errors: string[] }>(
        "/api/contracts/gaps",
        { mode, contractIds: rows.map((r) => r.contractId) }
      );
    },
    onSuccess: (res) => {
      let msg = `تم إصلاح ${res.ok}.`;
      if (res.skipped.length) {
        msg += `\nتُركت بلا خطة (بنود فقط): ${res.skipped.slice(0, 5).join("، ")}`;
      }
      if (res.errors.length) {
        msg += `\nأخطاء:\n${res.errors.slice(0, 5).join("\n")}`;
      }
      toast({
        title: "إصلاح الكل",
        description: msg,
        // المكتبي يعرض النتيجة في نافذة معلومات طويلة
        className: "whitespace-pre-line",
      });
      setFixOpen(false);
      qc.invalidateQueries({ queryKey: ["contracts", "gaps"] });
      qc.invalidateQueries({ queryKey: ["contracts"] });
    },
    onError: (e) => {
      toast({ variant: "destructive", title: "تعذر تنفيذ الإصلاح", description: String(e) });
    },
  });

  const rows = gapsQuery.data?.rows ?? [];

  const exportCsv = () => {
    const head = HEADS.join(",");
    const body = rows
      .map((r) =>
        [
          r.contractNumber,
          r.customerName,
          r.contractType,
          r.amount,
          r.planN ? r.planTotal : "",
          r.planN ? r.gapPlan : "",
          r.itemsN ? r.itemsTotal : "",
          r.itemsN ? r.gapItems : "",
        ].join(",")
      )
      .join("\n");
    const blob = new Blob(["\uFEFF" + head + "\n" + body], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "contract_gaps.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>عقود بفروقات (القيمة × الخطة × البنود)</DialogTitle>
          <DialogDescription>
            {gapsQuery.isLoading
              ? "جارٍ الحساب…"
              : `العقود ذات الفروقات: ${gapsQuery.data?.count ?? 0}`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="h-8 gap-1.5"
            disabled={selectedId === null}
            onClick={() => {
              if (selectedId !== null) {
                onOpenChange(false);
                onOpenContract(selectedId);
              }
            }}
          >
            <FolderOpen className="size-4" />
            فتح العقد
          </Button>
          <Button
            variant="outline"
            className="h-8 gap-1.5"
            disabled={!rows.length || fixMutation.isPending}
            onClick={() => setFixOpen(true)}
          >
            {fixMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Wrench className="size-4" />
            )}
            إصلاح الكل
          </Button>
          <Button variant="outline" className="h-8 gap-1.5" onClick={exportCsv} disabled={!rows.length}>
            📤 تصدير Excel
          </Button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 bg-muted/60">
              <TableRow>
                {HEADS.map((h) => (
                  <TableHead key={h} className="whitespace-nowrap text-center">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {gapsQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={HEADS.length} className="h-24 text-center">
                    <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : !rows.length ? (
                <TableRow>
                  <TableCell colSpan={HEADS.length} className="h-24 text-center text-muted-foreground">
                    لا فروقات — كل العقود مطابقة لخططها/بنودها
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => {
                  const gapPlanBad = r.planN > 0 && Math.abs(r.gapPlan) > 0.001;
                  const gapItemsBad = r.itemsN > 0 && Math.abs(r.gapItems) > 0.001;
                  return (
                    <TableRow
                      key={r.contractId}
                      className={cn(
                        "cursor-pointer",
                        selectedId === r.contractId && "bg-primary/10"
                      )}
                      onClick={() => setSelectedId(r.contractId)}
                      onDoubleClick={() => {
                        onOpenChange(false);
                        onOpenContract(r.contractId);
                      }}
                    >
                      <TableCell className="whitespace-nowrap font-mono text-xs">{r.contractNumber}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.customerName}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{r.contractType}</TableCell>
                      <TableCell className="whitespace-nowrap text-end tabular-nums">{money(r.amount)}</TableCell>
                      <TableCell className="whitespace-nowrap text-end tabular-nums">
                        {r.planN ? money(r.planTotal) : ""}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "whitespace-nowrap text-end tabular-nums",
                          gapPlanBad && "font-bold text-status-warn"
                        )}
                      >
                        {r.planN ? signed(r.gapPlan) : ""}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-end tabular-nums">
                        {r.itemsN ? money(r.itemsTotal) : ""}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "whitespace-nowrap text-end tabular-nums",
                          gapItemsBad && "font-bold text-status-warn"
                        )}
                      >
                        {r.itemsN ? signed(r.gapItems) : ""}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* اختيار قاعدة الإصلاح — المرجع: _fix_all (تُؤخذ نسخة احتياطية أولًا في المكتبي؛
            في الويب يُسجَّل كل تغيير في سجل الأحداث والتدقيق) */}
        <Dialog open={fixOpen} onOpenChange={setFixOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <TriangleAlert className="size-4 text-status-warn" />
                إصلاح الكل
              </DialogTitle>
              <DialogDescription>
                {rows.length} عقود بفروقات — اختر قاعدة الإصلاح:
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Button
                variant="outline"
                className="h-10 justify-start"
                disabled={fixMutation.isPending}
                onClick={() => fixMutation.mutate("amounts")}
              >
                تحديث المبالغ لتطابق المجاميع
              </Button>
              <Button
                variant="outline"
                className="h-10 justify-start"
                disabled={fixMutation.isPending}
                onClick={() => fixMutation.mutate("plan")}
              >
                توزيع الخطط على المبالغ
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              ملاحظة: المكتبي يأخذ نسخة احتياطية للملف أولًا؛ في نسخة الويب يُوثَّق كل تغيير في سجل أحداث العقد وسجل التدقيق.
            </p>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
