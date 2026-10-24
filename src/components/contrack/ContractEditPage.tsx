"use client";

/**
 * صفحة «تعديل بيانات العقد» — تحويل نافذة التعديل في ContractDetailView إلى صفحة كاملة.
 * مواءمة نافذة المكتبي (contract_hub.py:591–769): اسم العقد تلقائي من النوع ·
 * اختيار النوع من الأنواع المفعّلة + «غير محدد» · العملة · صفوف الإشراف
 * (تاريخ تعهد الإشراف/المدة/قيمة الشهر/الخصم) وقفل تاريخي البداية/النهاية لعقود الإشراف.
 * نفس مِلك الحفظ (PATCH /api/contracts/[id]) — لا تغيير منطق أعمال.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPatch } from "./api";
import { errMessage } from "./contrack-types";
import type { ContractDetailResponse, ContractTypesResponse } from "./contrack-types";
import { derivesNameFromType } from "@/lib/contract-types-admin";

interface ContractEditPageProps {
  contractId: number;
  onAuthError: () => void;
  /** بعد الحفظ الناجح — يعود لشاشة العقد */
  onSaved: () => void;
  /** إلغاء — يعود لشاشة العقد */
  onCancel: () => void;
}

/** قيمة «غير محدد» داخل Select — Radix لا يقبل قيمة عنصر فارغة */
const TYPE_NONE = "__none__";

export function ContractEditPage({ contractId, onAuthError, onSaved, onCancel }: ContractEditPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // نفس مفتاح الاستعلام في شاشة العقد — بيانات مخزّنة تُعرض فورًا
  const detailQuery = useQuery<ContractDetailResponse>({
    queryKey: ["contract", contractId],
    queryFn: () => apiGet<ContractDetailResponse>(`/api/contracts/${contractId}`),
  });
  const detail = detailQuery.data?.contract ?? null;

  // أنواع العقود — المفعّل منها + النوع الحالي للعقد إن كان معطّلًا (contract_hub.py:2210)
  const typesQuery = useQuery<ContractTypesResponse>({
    queryKey: ["contract-types"],
    queryFn: () => apiGet<ContractTypesResponse>("/api/contract-types"),
  });
  const allTypes = typesQuery.data?.types ?? [];

  const [form, setForm] = React.useState<{
    originalName: string; // الاسم الأصلي للعقد عند الفتح — يُبقى عليه عند «غير محدد»
    typeName: string; // "" = غير محدد
    currency: string;
    description: string;
    notes: string;
    contractDate: string;
    signDate: string;
    startDate: string;
    endDate: string;
    supStartDate: string;
    supMonths: string;
    supMonthly: string;
    supDiscount: string;
  } | null>(null);

  // تهيئة الحقول من بيانات العقد مرة واحدة (كما كانت openEdit في النافذة)
  React.useEffect(() => {
    if (!detail) return;
    setForm((f) =>
      f ?? {
        originalName: detail.contractName || "",
        typeName: detail.contractType && detail.contractType !== "غير محدد" ? detail.contractType : "",
        currency: detail.currency || "د.ك",
        description: detail.description || "",
        notes: detail.notes || "",
        contractDate: (detail.contractDate || "").slice(0, 10),
        signDate: (detail.signDate || "").slice(0, 10),
        startDate: (detail.startDate || "").slice(0, 10),
        endDate: (detail.endDate || "").slice(0, 10),
        supStartDate: (detail.supStartDate || "").slice(0, 10),
        supMonths: String(detail.supMonths ?? 0),
        supMonthly: String(detail.supMonthly ?? 0),
        supDiscount: String(detail.supDiscount ?? 0),
      }
    );
  }, [detail]);

  // 401 ⇒ إعادة فحص الجلسة (ستظهر شاشة الدخول)
  React.useEffect(() => {
    const e = detailQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [detailQuery.error, onAuthError]);

  const selectedType = form?.typeName ? allTypes.find((t) => t.name === form.typeName) ?? null : null;
  // صفوف الإشراف تظهر لمن نوعه إشرافي أو يملك مدة إشراف محفوظة (contract_hub.py:2242)
  const showSup = Boolean(selectedType?.isSupervision) || (detail?.supMonths ?? 0) > 0;

  // اسم العقد المعروض — يتبع النوع (contract_hub.py:619)
  const derivedName = form ? derivesNameFromType(form.typeName, form.originalName || "غير محدد") : "";

  const editMutation = useMutation({
    mutationFn: (f: NonNullable<typeof form>) =>
      apiPatch(`/api/contracts/${contractId}`, {
        contractType: f.typeName || "غير محدد",
        currency: f.currency.trim() || "د.ك",
        description: f.description.trim(),
        notes: f.notes.trim(),
        contractDate: f.contractDate,
        signDate: f.signDate,
        // لعقود الإشراف التواريخ تُدار من تعهد الإشراف — لا تُرسل (contract_hub.py:740)
        ...(showSup ? {} : { startDate: f.startDate, endDate: f.endDate }),
        // حقول الإشراف تُرسل فقط حين تكون صفوفها ظاهرة (كالمكتبي _sup_rows_shown)
        ...(showSup
          ? {
              supStartDate: f.supStartDate,
              supMonths: Math.trunc(Number(f.supMonths || 0)),
              supMonthly: Number(f.supMonthly || 0),
              supDiscount: Number(f.supDiscount || 0),
            }
          : {}),
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

  const submit = () => {
    if (!form) return;
    const supMonths = Math.trunc(Number(form.supMonths || 0));
    const supMonthly = Number(form.supMonthly || 0);
    if (showSup && supMonths > 0 && supMonthly <= 0) {
      toast({ variant: "destructive", title: "قيمة غير صالحة", description: "قيمة الشهر يجب أن تكون أكبر من صفر." });
      return;
    }
    if (!showSup && form.startDate && form.endDate && form.endDate <= form.startDate) {
      toast({ variant: "destructive", title: "تاريخ غير صالح", description: "تاريخ نهاية العقد يجب أن يكون بعد تاريخ البداية." });
      return;
    }
    editMutation.mutate(form);
  };

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
      {detailQuery.isLoading || !form ? (
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
              {/* اسم العقد — تلقائي من النوع (contract_hub.py:617) */}
              <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                <Label htmlFor="e-name">اسم العقد (تلقائي من النوع)</Label>
                <Input
                  id="e-name"
                  className="h-9 bg-muted/50"
                  readOnly
                  title="اسم العقد المعروض يتبع نوع العقد المختار ولا يُعدّل يدويًا"
                  value={derivedName}
                />
              </div>
              {/* نوع العقد — من الأنواع المفعّلة + «غير محدد» */}
              <div className="space-y-1.5">
                <Label>نوع العقد</Label>
                <Select
                  value={form.typeName || TYPE_NONE}
                  onValueChange={(v) => setForm((f) => (f ? { ...f, typeName: v === TYPE_NONE ? "" : v } : f))}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="اختر النوع" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    <SelectItem value={TYPE_NONE}>غير محدد</SelectItem>
                    {allTypes
                      .filter((t) => t.active || t.name === form.typeName)
                      .map((t) => (
                        <SelectItem key={t.id} value={t.name}>
                          {t.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              {/* العملة — نص قصير (contract_hub.py:674) */}
              <div className="space-y-1.5">
                <Label htmlFor="e-currency">العملة</Label>
                <Input
                  id="e-currency"
                  className="h-9 w-28"
                  value={form.currency}
                  onChange={(e) => setForm((f) => (f ? { ...f, currency: e.target.value } : f))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-cdate">تاريخ العقد</Label>
                <Input
                  id="e-cdate"
                  className="h-9"
                  dir="ltr"
                  type="date"
                  value={form.contractDate}
                  onChange={(e) => setForm((f) => (f ? { ...f, contractDate: e.target.value } : f))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-sdate">تاريخ التوقيع</Label>
                <Input
                  id="e-sdate"
                  className="h-9"
                  dir="ltr"
                  type="date"
                  value={form.signDate}
                  onChange={(e) => setForm((f) => (f ? { ...f, signDate: e.target.value } : f))}
                />
              </div>
              {/* لعقود الإشراف: تاريخا البداية/النهاية يأتيان من مرحلة بداية الإشراف — معطّلان (contract_hub.py:640) */}
              <div className="space-y-1.5">
                <Label htmlFor="e-start" className={showSup ? "text-muted-foreground" : undefined}>
                  تاريخ البداية
                </Label>
                <Input
                  id="e-start"
                  className="h-9"
                  dir="ltr"
                  type="date"
                  disabled={showSup}
                  title={showSup ? "يُحدَّد تلقائيًا من مرحلة بداية الإشراف" : undefined}
                  value={form.startDate}
                  onChange={(e) => setForm((f) => (f ? { ...f, startDate: e.target.value } : f))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-end" className={showSup ? "text-muted-foreground" : undefined}>
                  تاريخ الانتهاء
                </Label>
                <Input
                  id="e-end"
                  className="h-9"
                  dir="ltr"
                  type="date"
                  disabled={showSup}
                  title={showSup ? "يُحدَّد تلقائيًا من مرحلة بداية الإشراف" : undefined}
                  value={form.endDate}
                  onChange={(e) => setForm((f) => (f ? { ...f, endDate: e.target.value } : f))}
                />
              </div>

              {/* ===== صفوف الإشراف (contract_hub.py:649–669) ===== */}
              {showSup && (
                <>
                  <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                    <p className="text-xs font-medium text-muted-foreground">تعهد الإشراف الهندسي</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="e-sup-start">تاريخ تعهد الإشراف</Label>
                    <Input
                      id="e-sup-start"
                      className="h-9"
                      dir="ltr"
                      type="date"
                      value={form.supStartDate}
                      onChange={(e) => setForm((f) => (f ? { ...f, supStartDate: e.target.value } : f))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="e-sup-months">مدة الإشراف (أشهر)</Label>
                    <Input
                      id="e-sup-months"
                      className="h-9"
                      dir="ltr"
                      type="number"
                      min="0"
                      max="120"
                      step="1"
                      value={form.supMonths}
                      onChange={(e) => setForm((f) => (f ? { ...f, supMonths: e.target.value } : f))}
                    />
                    <p className="text-xs text-muted-foreground">الصفر = لا تعهد</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="e-sup-monthly">قيمة الشهر</Label>
                    <Input
                      id="e-sup-monthly"
                      className="h-9"
                      dir="ltr"
                      type="number"
                      min="0"
                      step="0.001"
                      value={form.supMonthly}
                      onChange={(e) => setForm((f) => (f ? { ...f, supMonthly: e.target.value } : f))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="e-sup-discount">خصم الإشراف</Label>
                    <Input
                      id="e-sup-discount"
                      className="h-9"
                      dir="ltr"
                      type="number"
                      min="0"
                      step="0.001"
                      value={form.supDiscount}
                      onChange={(e) => setForm((f) => (f ? { ...f, supDiscount: e.target.value } : f))}
                    />
                  </div>
                </>
              )}

              <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                <Label htmlFor="e-desc">الوصف</Label>
                <Textarea
                  id="e-desc"
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((f) => (f ? { ...f, description: e.target.value } : f))}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                <Label htmlFor="e-notes">ملاحظات</Label>
                <Textarea
                  id="e-notes"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm((f) => (f ? { ...f, notes: e.target.value } : f))}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== شريط الإجراءات السفلي ===== */}
      <div className="sticky bottom-0 z-30">
        <Card className="border bg-background/95 shadow-sm backdrop-blur">
          <CardContent className="flex items-center justify-end gap-2 p-2">
            <Button variant="outline" className="h-9" onClick={onCancel} disabled={editMutation.isPending}>
              إلغاء
            </Button>
            <Button className="h-9" disabled={!form || editMutation.isPending} onClick={submit}>
              {editMutation.isPending ? "جارٍ الحفظ…" : "حفظ"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
