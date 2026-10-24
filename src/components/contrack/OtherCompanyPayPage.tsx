"use client";

/**
 * صفحة «تسديد مختارات» — تحويل نافذة التسديد في OtherCompanyView إلى صفحة كاملة.
 * نفس حقول النافذة والتوزيع التلقائي التنازلي والحفظ (POST /api/other-company/transfers) حرفيًا — لا تغيير منطق أعمال.
 * لا مسار جديد — تُعرض مكان شاشة القائمة داخل OtherCompanyView عبر حالة داخلية، وبلا تحديد عمليات تعود بأمان.
 */

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2, Send, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPost } from "./api";
import type { OtherDueItem } from "./contrack-types";
import { errMessage } from "./contrack-types";
import { formatKWD, round3 } from "@/lib/format";

interface OtherCompanyPayPageProps {
  onAuthError: () => void;
  /** العمليات المحددة من تبويب المستحقات (selectedItems في الشاشة الأم) */
  selectedItems: OtherDueItem[];
  /** إبطال مفاتيح الكاش كما في الشاشة الأم */
  invalidateOther: () => void;
  /** بعد نجاح التسجيل — يعود لتبويب المستحقات ويُفرَّغ التحديد */
  onDone: () => void;
  /** إلغاء — يعود لشاشة القائمة */
  onCancel: () => void;
}

interface PaymentMethodLite {
  id: number;
  name: string;
  isActive: boolean;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** توزيع المبلغ تنازليًا على المحدد حسب المتبقي حتى يُستهلك (نمط المهمة) — منقولة حرفيًا من OtherCompanyView */
function allocateAmount(amount: number, items: OtherDueItem[]): { opId: number; alloc: number }[] {
  const sorted = [...items].sort((a, b) => b.remaining - a.remaining);
  let left = round3(amount);
  const rows: { opId: number; alloc: number }[] = [];
  for (const it of sorted) {
    if (left <= 0.0005) break;
    if (it.remaining <= 0.0005) continue;
    const a = round3(Math.min(it.remaining, left));
    rows.push({ opId: it.opId, alloc: a });
    left = round3(left - a);
  }
  return rows;
}

export function OtherCompanyPayPage({
  onAuthError,
  selectedItems,
  invalidateOther,
  onDone,
  onCancel,
}: OtherCompanyPayPageProps) {
  const { toast } = useToast();

  const selectedRemaining = round3(selectedItems.reduce((s, d) => s + Number(d.remaining || 0), 0));

  const [payAmount, setPayAmount] = React.useState(String(selectedRemaining));
  const [payDate, setPayDate] = React.useState(todayStr());
  const [payMethod, setPayMethod] = React.useState("");
  const [payRef, setPayRef] = React.useState("");
  const [payNotes, setPayNotes] = React.useState("");
  const [payError, setPayError] = React.useState("");

  const methodsQuery = useQuery<{ methods: PaymentMethodLite[] }>({
    queryKey: ["payment-methods"],
    queryFn: () => apiGet<{ methods: PaymentMethodLite[] }>("/api/payment-methods"),
  });
  const methodOptions = (methodsQuery.data?.methods ?? []).filter((m) => m.isActive);

  const payAmountNum = Number(payAmount);
  const allocation = allocateAmount(
    Number.isFinite(payAmountNum) && payAmountNum > 0 ? payAmountNum : 0,
    selectedItems
  );
  const allocatedSum = round3(allocation.reduce((s, a) => s + a.alloc, 0));
  const leftover = Number.isFinite(payAmountNum) ? round3(payAmountNum - allocatedSum) : 0;

  const payMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPost("/api/other-company/transfers", body),
    onSuccess: () => {
      invalidateOther();
      onDone();
      toast({
        title: "سُجّل التسديد",
        description: "وُزّع على العمليات المختارة — لا سندات (تسديد الشركة الأخرى بلا سندات)",
      });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      setPayError(errMessage(e));
    },
  });

  const submitPay = () => {
    if (!(Number.isFinite(payAmountNum) && payAmountNum > 0)) {
      setPayError("أدخل مبلغًا أكبر من صفر");
      return;
    }
    if (!payDate) {
      setPayError("حدد تاريخ التسديد");
      return;
    }
    if (allocation.length === 0) {
      setPayError("المبلغ لا يغطي أي عملية من المحدد (المتبقي = 0)");
      return;
    }
    setPayError("");
    payMutation.mutate({
      tdate: payDate,
      amount: round3(payAmountNum),
      method: payMethod.trim() || undefined,
      ref: payRef.trim() || undefined,
      notes: payNotes.trim() || undefined,
      opIds: allocation.map((a) => ({ opId: a.opId, amount: a.alloc })),
    });
  };

  const breadcrumb = (
    <nav aria-label="مسار التنقل" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <span>المحاسبة</span>
      <span aria-hidden="true">←</span>
      <span>الشركة الأخرى</span>
      <span aria-hidden="true">←</span>
      <span className="font-medium text-foreground">تسديد مختارات</span>
    </nav>
  );

  // حارس آمن: بلا تحديد عمليات — عودة بأمان دون تصيير النموذج
  if (selectedItems.length === 0) {
    return (
      <div className="space-y-4">
        <header>
          {breadcrumb}
          <h1 className="mt-1 flex items-center gap-2 text-xl font-bold">
            <Send className="size-5 text-primary" />
            تسديد مختارات
          </h1>
          <p className="text-sm text-muted-foreground">
            المبلغ يُوزَّع تلقائيًا تنازليًا على المحدد حسب المتبقي حتى يُستهلك — لا سندات.
          </p>
        </header>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <Wallet className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">لا عمليات محددة للتسديد</p>
            <p className="text-xs text-muted-foreground">
              عد إلى تبويب «المستحقات» وحدد عمليات ثم اختر «تسديد مختارات» من جديد.
            </p>
            <Button variant="outline" className="h-9 gap-1.5" onClick={onCancel}>
              <ArrowRight className="size-4" />
              عودة للقائمة
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ===== رأس الصفحة ===== */}
      <header>
        {breadcrumb}
        <h1 className="mt-1 flex items-center gap-2 text-xl font-bold">
          <Send className="size-5 text-primary" />
          تسديد مختارات ({selectedItems.length} عملية)
        </h1>
        <p className="text-sm text-muted-foreground">
          المبلغ يُوزَّع تلقائيًا تنازليًا على المحدد حسب المتبقي حتى يُستهلك — لا سندات.
        </p>
      </header>

      <Card>
        <CardContent className="p-4 md:p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label>المبلغ *</Label>
              <Input
                className="h-9 ltr text-start"
                inputMode="decimal"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">مجموع متبقي المحدد: {formatKWD(selectedRemaining)}</p>
            </div>
            <div className="space-y-1.5">
              <Label>التاريخ *</Label>
              <Input type="date" className="h-9" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>الطريقة</Label>
              {methodOptions.length > 0 ? (
                <Select value={payMethod || "none"} onValueChange={(v) => setPayMethod(v === "none" ? "" : v)}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="اختر الطريقة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون</SelectItem>
                    {methodOptions.map((m) => (
                      <SelectItem key={m.id} value={m.name}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className="h-9"
                  placeholder="تحويل بنكي / كفو…"
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label>مرجع</Label>
              <Input className="h-9" placeholder="رقم الحوالة…" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
            </div>
            <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
              <Label>ملاحظة</Label>
              <Textarea rows={2} value={payNotes} onChange={(e) => setPayNotes(e.target.value)} />
            </div>
          </div>

          {/* معاينة التوزيع */}
          {allocation.length > 0 && (
            <div className="mt-4 space-y-1 rounded-lg border bg-muted/30 p-3">
              <div className="text-[11px] font-bold text-muted-foreground">توزيع تلقائي تنازلي حسب المتبقي:</div>
              {allocation.map((a) => {
                const it = selectedItems.find((d) => d.opId === a.opId);
                return (
                  <div key={a.opId} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono">{it?.phone || `#${a.opId}`}</span>
                    <span className="truncate text-muted-foreground">{it?.customer || ""}</span>
                    <span className="ms-auto font-bold tabular-nums">{formatKWD(a.alloc)}</span>
                  </div>
                );
              })}
              <div className="flex justify-between border-t pt-1 text-xs font-bold">
                <span>مجموع الموزع</span>
                <span className="tabular-nums">{formatKWD(allocatedSum)}</span>
              </div>
              {leftover > 0.0005 && (
                <p className="text-[11px] font-semibold text-status-warn">
                  الفائض {formatKWD(leftover)} يبقى «دفعة على الحساب» للشركة الأخرى
                </p>
              )}
            </div>
          )}

          {payError && (
            <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs font-semibold text-destructive">
              {payError}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ===== شريط الإجراءات السفلي ===== */}
      <div className="sticky bottom-0 z-30">
        <Card className="border bg-background/95 shadow-sm backdrop-blur">
          <CardContent className="flex items-center justify-end gap-2 p-2">
            <Button variant="outline" className="h-9 gap-1.5" onClick={onCancel} disabled={payMutation.isPending}>
              <ArrowRight className="size-4" />
              إلغاء
            </Button>
            <Button className="h-9" disabled={payMutation.isPending} onClick={submitPay}>
              {payMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              تسجيل التسديد
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
