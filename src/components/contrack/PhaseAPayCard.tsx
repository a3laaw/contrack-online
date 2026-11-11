"use client";

/**
 * بطاقة المرحلة (أ) في صفحة «الدفعات والمقاولون» (docs/retention-subipc-advance-design.md §5.3):
 *  · المحتجزات: التراكمي/المُفرج/القائم + جدول الفواتير ذات المحتجزات بزر «إفراج» (مدير)
 *  · الدفعة المقدمة: القيمة/نسبة الاسترداد/المسترد/المتبقي
 *  · مستخلصات الباطن: المؤشرات + قائمة المستخلصات بحالاتها
 * الإفراج ينشر قيدًا آليًا (مدين ذمم/فرعي · دائن 1122) — لا حركة يدوية.
 */

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, LockOpen, Loader2, PiggyBank, ShieldHalf } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiPost } from "./api";
import { errMessage } from "./contrack-types";
import { fmtDate, formatKWD } from "@/lib/format";

const CERT_STATUS_CLS: Record<string, string> = {
  مسودة: "bg-muted text-muted-foreground",
  مقدم: "bg-status-warn/15 text-status-warn",
  معتمد: "bg-primary/15 text-primary-ink",
  مدفوع: "bg-status-done/15 text-status-done",
  ملغي: "bg-status-danger/10 text-status-danger",
};

export function PhaseAPayCard({
  contractId,
  manager,
  phaseA,
  onActionError,
}: {
  contractId: number;
  manager: boolean;
  phaseA: NonNullable<import("./contrack-types").ContractPayViewResponse["phaseA"]>;
  onActionError: (e: unknown, title: string) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const releaseMutation = useMutation({
    mutationFn: (invoiceId: number) =>
      apiPost<{ released: boolean; entryNo: number; retentionAmount: number }>(
        `/api/invoices/${invoiceId}/retention-release`,
        {}
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["contract", contractId, "pay-view"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast({
        title: "أُفرج عن المحتجزات",
        description: `قيد آلي #${res.entryNo} بمبلغ ${formatKWD(res.retentionAmount)} — المبلغ الآن ذمم قابلة للتحصيل بسند قبض عادي`,
      });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onActionError(e, "الإفراج عن المحتجزات");
      toast({ variant: "destructive", title: "تعذر الإفراج", description: errMessage(e) });
    },
  });

  const { retention, advance, subCerts } = phaseA;
  const pendingInvoices = retention.invoices.filter((i) => !i.retentionReleased);

  if (retention.total <= 0 && advance.amount <= 0 && subCerts.overall.count === 0) return null;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-bold">
            <ShieldHalf className="size-4 text-primary-ink/70" />
            المحتجزات والدفعة المقدمة
            <span className="text-[10px] font-normal text-muted-foreground">المرحلة (أ)</span>
          </h3>
        </div>

        {/* المؤشرات */}
        <div className="grid grid-cols-2 gap-2 text-center text-xs md:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-lg border bg-muted/30 p-2">
            <div className="text-muted-foreground">محتجز تراكمي</div>
            <div className="font-mono font-bold tabular-nums" dir="ltr">{formatKWD(retention.total)}</div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-2">
            <div className="text-muted-foreground">مُفرج عنه</div>
            <div className="font-mono font-bold tabular-nums text-status-done" dir="ltr">{formatKWD(retention.released)}</div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-2">
            <div className="text-muted-foreground">محتجز قائم</div>
            <div className="font-mono font-extrabold tabular-nums text-status-warn" dir="ltr">{formatKWD(retention.pending)}</div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-2">
            <div className="text-muted-foreground">الدفعة المقدمة</div>
            <div className="font-mono font-bold tabular-nums" dir="ltr">{formatKWD(advance.amount)}</div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-2">
            <div className="text-muted-foreground">مسترد {advance.recoveryPct > 0 ? `(${advance.recoveryPct}%)` : ""}</div>
            <div className="font-mono font-bold tabular-nums text-status-done" dir="ltr">{formatKWD(advance.recovered)}</div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-2">
            <div className="text-muted-foreground">متبقٍ من الدفعة</div>
            <div className="font-mono font-extrabold tabular-nums" dir="ltr">{formatKWD(advance.remaining)}</div>
          </div>
        </div>

        {/* جدول الفواتير ذات المحتجزات — سطح المكتب */}
        {retention.invoices.length > 0 && (
          <div className="hidden max-h-96 overflow-y-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="text-start">الفاتورة</TableHead>
                  <TableHead className="text-start">التاريخ</TableHead>
                  <TableHead className="text-end">الإجمالي</TableHead>
                  <TableHead className="text-end">المطلوب نقدًا</TableHead>
                  <TableHead className="text-end">المحتجز</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  <TableHead className="text-start">إجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {retention.invoices.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs font-bold">{i.invoiceNumber}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDate(i.invoiceDate)}</TableCell>
                    <TableCell className="text-end text-xs font-bold tabular-nums" dir="ltr">{formatKWD(i.total)}</TableCell>
                    <TableCell className="text-end text-xs tabular-nums" dir="ltr">{formatKWD(i.netDue)}</TableCell>
                    <TableCell className="text-end text-xs font-bold tabular-nums text-status-warn" dir="ltr">
                      {formatKWD(i.retentionAmount)}
                    </TableCell>
                    <TableCell>
                      <Badge className={`border-0 text-[11px] ${i.retentionReleased ? "bg-status-done/15 text-status-done" : "bg-status-warn/15 text-status-warn"}`}>
                        {i.retentionReleased ? `مُفرج ${i.retentionReleasedAt ? fmtDate(i.retentionReleasedAt) : ""}` : "معلّق"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {manager && !i.retentionReleased ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1"
                          disabled={releaseMutation.isPending}
                          onClick={() => releaseMutation.mutate(i.id)}
                        >
                          {releaseMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <LockOpen className="size-3.5" />}
                          إفراج
                        </Button>
                      ) : i.retentionReleased ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-status-done">
                          <LockOpen className="size-3" /> يُحصّل بسند قبض
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Lock className="size-3" /> مدير حصرًا
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* موبايل — قائمة مبسطة */}
        {pendingInvoices.length > 0 && (
          <div className="space-y-2 md:hidden">
            {pendingInvoices.map((i) => (
              <div key={i.id} className="rounded-lg border p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold">{i.invoiceNumber}</span>
                  <Badge className="border-0 bg-status-warn/15 text-status-warn">محتجز {formatKWD(i.retentionAmount)}</Badge>
                </div>
                <div className="mt-1 text-muted-foreground">
                  {fmtDate(i.invoiceDate)} · المطلوب نقدًا <span className="tabular-nums" dir="ltr">{formatKWD(i.netDue)}</span>
                </div>
                {manager && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 h-9 w-full gap-1"
                    disabled={releaseMutation.isPending}
                    onClick={() => releaseMutation.mutate(i.id)}
                  >
                    {releaseMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <LockOpen className="size-3.5" />}
                    إفراج عن المحتجزات
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        {pendingInvoices.length === 0 && retention.total > 0 && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <LockOpen className="size-3.5 shrink-0" />
            لا محتجزات معلّقة — المُفرج عنه يُحصَّل بسندات القبض العادية.
          </p>
        )}

        {/* مستخلصات الباطن SubIPC */}
        {subCerts.overall.count > 0 && (
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <div className="flex items-center justify-between">
              <h4 className="flex items-center gap-1.5 text-xs font-bold">
                <PiggyBank className="size-3.5 text-primary-ink/70" />
                مستخلصات الباطن (SubIPC) — {subCerts.overall.count} مستخلص
              </h4>
              <p className="text-[11px] text-muted-foreground">
                تراكمي معتمد <span className="tabular-nums font-bold" dir="ltr">{formatKWD(subCerts.overall.approvedCumulative)}</span>
                {" · "}مدفوع <span className="tabular-nums font-bold text-status-done" dir="ltr">{formatKWD(subCerts.overall.paidCumulative)}</span>
                {" · "}محتجز قائم <span className="tabular-nums font-bold text-status-warn" dir="ltr">{formatKWD(subCerts.overall.pendingRetention)}</span>
              </p>
            </div>
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-start">الرقم</TableHead>
                    <TableHead className="text-start">التاريخ</TableHead>
                    <TableHead className="text-end">الإجمالي</TableHead>
                    <TableHead className="text-end">الخصومات</TableHead>
                    <TableHead className="text-end">الصافي</TableHead>
                    <TableHead className="text-end">التراكمي</TableHead>
                    <TableHead className="text-start">الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subCerts.list.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs font-bold" dir="ltr">{c.certNumber}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDate(c.certDate)}</TableCell>
                      <TableCell className="text-end text-xs tabular-nums" dir="ltr">{formatKWD(c.grossAmount)}</TableCell>
                      <TableCell className="text-end text-xs tabular-nums text-status-danger" dir="ltr">
                        −{formatKWD(c.retentionAmount + c.advanceRecovery + c.otherDeductions)}
                      </TableCell>
                      <TableCell className="text-end text-xs font-bold tabular-nums text-primary-ink" dir="ltr">{formatKWD(c.netAmount)}</TableCell>
                      <TableCell className="text-end text-xs tabular-nums" dir="ltr">{formatKWD(c.cumulativeAmount)}</TableCell>
                      <TableCell>
                        <Badge className={`border-0 text-[11px] ${CERT_STATUS_CLS[c.status] ?? "bg-muted"}`}>{c.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-[10px] text-muted-foreground">
              إنشاء المستخلصات وإدارتها من «تفاصيل العقد الباطن» لكل مقاول — الصرف بسند صرف باطن عادي (بوابة العميل والسقف تعملان تلقائيًا).
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
