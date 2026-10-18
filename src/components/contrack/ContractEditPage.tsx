"use client";

/**
 * صفحة «تعديل بيانات العقد» — تحويل نافذة التعديل في ContractDetailView إلى صفحة كاملة.
 * نفس حقول النافذة ومِلَك الحفظ (PATCH /api/contracts/[id]) حرفيًا — لا تغيير منطق أعمال.
 * لا مسار جديد — تُعرض مكان شاشة العقد داخل ContractDetailView عبر حالة داخلية.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPatch } from "./api";
import { errMessage } from "./contrack-types";
import type { ContractDetailResponse } from "./contrack-types";

interface ContractEditPageProps {
  contractId: number;
  onAuthError: () => void;
  /** بعد الحفظ الناجح — يعود لشاشة العقد */
  onSaved: () => void;
  /** إلغاء — يعود لشاشة العقد */
  onCancel: () => void;
}

interface EditForm {
  contractName: string;
  description: string;
  notes: string;
  contractDate: string;
  signDate: string;
  startDate: string;
  endDate: string;
}

export function ContractEditPage({ contractId, onAuthError, onSaved, onCancel }: ContractEditPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // نفس مفتاح الاستعلام في شاشة العقد — بيانات مخزّنة تُعرض فورًا
  const detailQuery = useQuery<ContractDetailResponse>({
    queryKey: ["contract", contractId],
    queryFn: () => apiGet<ContractDetailResponse>(`/api/contracts/${contractId}`),
  });
  const detail = detailQuery.data?.contract ?? null;

  const [editForm, setEditForm] = React.useState<EditForm | null>(null);

  // تهيئة الحقول من بيانات العقد مرة واحدة (كما كانت openEdit في النافذة)
  React.useEffect(() => {
    if (!detail) return;
    setEditForm((f) =>
      f ?? {
        contractName: detail.contractName || "",
        description: detail.description || "",
        notes: detail.notes || "",
        contractDate: (detail.contractDate || "").slice(0, 10),
        signDate: (detail.signDate || "").slice(0, 10),
        startDate: (detail.startDate || "").slice(0, 10),
        endDate: (detail.endDate || "").slice(0, 10),
      }
    );
  }, [detail]);

  // 401 ⇒ إعادة فحص الجلسة (ستظهر شاشة الدخول)
  React.useEffect(() => {
    const e = detailQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [detailQuery.error, onAuthError]);

  const editMutation = useMutation({
    mutationFn: (form: EditForm) =>
      apiPatch(`/api/contracts/${contractId}`, {
        contractName: form.contractName.trim(),
        description: form.description.trim(),
        notes: form.notes.trim(),
        contractDate: form.contractDate,
        signDate: form.signDate,
        startDate: form.startDate,
        endDate: form.endDate,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contract", contractId] });
      qc.invalidateQueries({ queryKey: ["contracts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: "تم التعديل", description: "حُدّثت بيانات العقد" });
      onSaved();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر تعديل العقد", description: errMessage(e) });
    },
  });

  const breadcrumb = (
    <nav aria-label="مسار التنقل" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <span>العملاء والعقود</span>
      <span aria-hidden="true">←</span>
      <span>العقود</span>
      <span aria-hidden="true">←</span>
      <span className="font-medium text-foreground" dir="ltr">
        {detail?.contractNumber ?? "—"}
      </span>
    </nav>
  );

  return (
    <div className="space-y-4">
      {/* ===== رأس الصفحة ===== */}
      <header>
        {breadcrumb}
        <h1 className="mt-1 text-xl font-bold">تعديل بيانات العقد</h1>
        <p className="text-sm text-muted-foreground">
          مبلغ العقد ثابت ولا يُعدَّل — القيمة الحالية تُحسب من الملاحق والإشراف.
        </p>
      </header>

      {/* ===== الحقول ===== */}
      {detailQuery.isLoading || !editForm ? (
        <Card>
          <CardContent className="p-4 md:p-6">
            <Skeleton className="h-64 rounded-lg" />
          </CardContent>
        </Card>
      ) : detailQuery.isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">{errMessage(detailQuery.error)}</p>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={onCancel}>
              <ArrowRight className="size-4" />
              رجوع لشاشة العقد
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4 md:p-6">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                <Label htmlFor="e-name">اسم العقد</Label>
                <Input
                  id="e-name"
                  className="h-9"
                  value={editForm.contractName}
                  onChange={(e) => setEditForm((f) => (f ? { ...f, contractName: e.target.value } : f))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-cdate">تاريخ العقد</Label>
                <Input
                  id="e-cdate"
                  className="h-9"
                  dir="ltr"
                  type="date"
                  value={editForm.contractDate}
                  onChange={(e) => setEditForm((f) => (f ? { ...f, contractDate: e.target.value } : f))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-sdate">تاريخ التوقيع</Label>
                <Input
                  id="e-sdate"
                  className="h-9"
                  dir="ltr"
                  type="date"
                  value={editForm.signDate}
                  onChange={(e) => setEditForm((f) => (f ? { ...f, signDate: e.target.value } : f))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-start">تاريخ البدء</Label>
                <Input
                  id="e-start"
                  className="h-9"
                  dir="ltr"
                  type="date"
                  value={editForm.startDate}
                  onChange={(e) => setEditForm((f) => (f ? { ...f, startDate: e.target.value } : f))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-end">تاريخ الانتهاء</Label>
                <Input
                  id="e-end"
                  className="h-9"
                  dir="ltr"
                  type="date"
                  value={editForm.endDate}
                  onChange={(e) => setEditForm((f) => (f ? { ...f, endDate: e.target.value } : f))}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                <Label htmlFor="e-desc">الوصف</Label>
                <Textarea
                  id="e-desc"
                  rows={2}
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => (f ? { ...f, description: e.target.value } : f))}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                <Label htmlFor="e-notes">ملاحظات</Label>
                <Textarea
                  id="e-notes"
                  rows={2}
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => (f ? { ...f, notes: e.target.value } : f))}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== شريط الإجراءات السفلي ===== */}
      <div className="sticky bottom-2 z-30">
        <Card className="border bg-background/95 shadow-sm backdrop-blur">
          <CardContent className="flex items-center justify-end gap-2 p-2">
            <Button variant="outline" className="h-9" onClick={onCancel} disabled={editMutation.isPending}>
              إلغاء
            </Button>
            <Button
              className="h-9"
              disabled={!editForm || editMutation.isPending}
              onClick={() => editForm && editMutation.mutate(editForm)}
            >
              {editMutation.isPending ? "جارٍ الحفظ…" : "حفظ"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
