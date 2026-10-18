"use client";

/**
 * صفحة «ضبط الإشراف الهندسي» — تحويل النافذة الصغيرة في ContractDetailView إلى صفحة كاملة صغيرة.
 * نفس الحقول الأربعة (تاريخ الأساس/الأشهر/الشهري/الخصم) بنفس ids ومِلَك الضبط
 * (DELETE للتصفير عند وجود ضبط سابق ثم POST /api/contracts/[id]/supervision) حرفيًا — لا تغيير منطق أعمال.
 * لا مسار جديد — تُعرض مكان شاشة العقد عبر flowPage.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiGet, apiPost } from "./api";
import type { ContractDetailResponse } from "./contrack-types";
import { errMessage } from "./contrack-types";

interface ContractSupervisionPageProps {
  contractId: number;
  contractNumber: string;
  onAuthError: () => void;
  /** بعد الحفظ الناجح — يعود لشاشة العقد */
  onSaved: () => void;
  /** إلغاء — يعود لشاشة العقد */
  onCancel: () => void;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ContractSupervisionPage({
  contractId,
  contractNumber,
  onAuthError,
  onSaved,
  onCancel,
}: ContractSupervisionPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // نفس مفتاح الاستعلام في شاشة العقد — بيانات مخزّنة تُعرض فورًا (isSupervision + القيم السابقة)
  const detailQuery = useQuery<ContractDetailResponse>({
    queryKey: ["contract", contractId],
    queryFn: () => apiGet<ContractDetailResponse>(`/api/contracts/${contractId}`),
  });
  const detail = detailQuery.data?.contract ?? null;
  const detailData = detailQuery.data ?? null;

  // نفس حقول النافذة — تهيئة مرة واحدة من بيانات العقد (كما كانت openSupDialog)
  const [supForm, setSupForm] = React.useState<{
    supStartDate: string;
    supMonths: string;
    supMonthly: string;
    supDiscount: string;
  } | null>(null);

  React.useEffect(() => {
    if (!detail) return;
    setSupForm((f) =>
      f ?? {
        supStartDate: (detail.supStartDate || "").slice(0, 10) || todayStr(),
        supMonths: detail.supMonths ? String(detail.supMonths) : "",
        supMonthly: detail.supMonthly ? String(Number(detail.supMonthly)) : "",
        supDiscount: detail.supDiscount ? String(Number(detail.supDiscount)) : "0",
      }
    );
  }, [detail]);

  // 401 ⇒ إعادة فحص الجلسة (ستظهر شاشة الدخول)
  React.useEffect(() => {
    const e = detailQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [detailQuery.error, onAuthError]);

  // نفس الـmutation حرفيًا: ضبط = إزالة السابق (إن وجد) ثم ضبط جديد — POST يضبط و DELETE يصفّر
  const supMutation = useMutation({
    mutationFn: () => {
      const body = {
        supStartDate: supForm?.supStartDate ?? todayStr(),
        supMonths: Number(supForm?.supMonths || 0),
        supMonthly: Number(supForm?.supMonthly || 0),
        supDiscount: Number(supForm?.supDiscount || 0),
      };
      const setup = () => apiPost(`/api/contracts/${contractId}/supervision`, body);
      if (detailData?.isSupervision) {
        return apiDelete(`/api/contracts/${contractId}/supervision`).then(setup);
      }
      return setup();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contract", contractId] });
      qc.invalidateQueries({ queryKey: ["contracts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["contract", contractId, "overview"] });
      toast({ title: "تم", description: "ضُبط الإشراف الهندسي" });
      onSaved();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر حفظ الإشراف", description: errMessage(e) });
    },
  });

  const breadcrumb = (
    <nav aria-label="مسار التنقل" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <span>العملاء والعقود</span>
      <span aria-hidden="true">←</span>
      <span>العقود</span>
      <span aria-hidden="true">←</span>
      <span className="font-medium text-foreground" dir="ltr">
        {contractNumber}
      </span>
    </nav>
  );

  return (
    <div className="space-y-4">
      {/* ===== رأس الصفحة ===== */}
      <header>
        {breadcrumb}
        <h1 className="mt-1 text-xl font-bold">ضبط الإشراف الهندسي</h1>
        <p className="text-sm text-muted-foreground">
          قيمة الأساس = الأشهر × الشهري − الخصم، وتمديد الإشراف اللاحق يدخل في القيمة الحالية للعقد.
        </p>
      </header>

      {/* ===== الحقول ===== */}
      {detailQuery.isLoading || !supForm ? (
        <Card>
          <CardContent className="p-4 md:p-6">
            <Skeleton className="h-48 rounded-lg" />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4 md:p-6">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                <Label htmlFor="sup-start">تاريخ الأساس *</Label>
                <Input
                  id="sup-start"
                  className="h-9"
                  dir="ltr"
                  type="date"
                  value={supForm.supStartDate}
                  onChange={(e) => setSupForm((f) => (f ? { ...f, supStartDate: e.target.value } : f))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-months">الأشهر *</Label>
                <Input
                  id="sup-months"
                  className="h-9"
                  dir="ltr"
                  type="number"
                  min="0"
                  value={supForm.supMonths}
                  onChange={(e) => setSupForm((f) => (f ? { ...f, supMonths: e.target.value } : f))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-monthly">الشهري *</Label>
                <Input
                  id="sup-monthly"
                  className="h-9"
                  dir="ltr"
                  type="number"
                  min="0"
                  step="0.001"
                  value={supForm.supMonthly}
                  onChange={(e) => setSupForm((f) => (f ? { ...f, supMonthly: e.target.value } : f))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-disc">الخصم</Label>
                <Input
                  id="sup-disc"
                  className="h-9"
                  dir="ltr"
                  type="number"
                  min="0"
                  step="0.001"
                  value={supForm.supDiscount}
                  onChange={(e) => setSupForm((f) => (f ? { ...f, supDiscount: e.target.value } : f))}
                />
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">إعادة الضبط تستبدل الضبط السابق بالكامل (تصفير ثم ضبط جديد).</p>
          </CardContent>
        </Card>
      )}

      {/* ===== شريط الإجراءات السفلي ===== */}
      <div className="sticky bottom-2 z-30">
        <Card className="border bg-background/95 shadow-sm backdrop-blur">
          <CardContent className="flex items-center justify-end gap-2 p-2">
            <Button variant="outline" className="h-9" onClick={onCancel} disabled={supMutation.isPending}>
              إلغاء
            </Button>
            <Button
              className="h-9"
              disabled={
                supMutation.isPending ||
                !supForm ||
                !(Number(supForm.supMonths) > 0) ||
                !(Number(supForm.supMonthly) > 0)
              }
              onClick={() => supMutation.mutate()}
            >
              {supMutation.isPending ? "جارٍ الحفظ…" : "حفظ"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
