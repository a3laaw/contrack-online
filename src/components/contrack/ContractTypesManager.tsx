"use client";

/**
 * ContractTypesManager — إدارة أنواع العقود الكاملة (إضافة/تعديل/تفعيل-تعطيل/حذف)
 * في تبويب «أنواع العقود والمبالغ» من الإعدادات.
 * المرجع المكتبي الحرفي (V9.15.18):
 *   - settings.py:1851–2314 (_tab_contract_types: الجدول 9 أعمدة + _ct_add/_ct_edit/_ct_toggle/_ct_delete)
 *   - settings.py:4297      (_ContractTypeDialog: حقول النافذة ونص التلميح)
 *   - contract_type_service.py (الحرس والرسائل الحرفية عبر validateTypeInput)
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Power, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "./api";
import type { ContractTypeDTO, ContractTypesResponse } from "./contrack-types";
import { errMessage } from "./contrack-types";
import { formatKWD } from "@/lib/format";
import { PRICING_MODES, pricingModeLabel, validateTypeInput } from "@/lib/contract-types-admin";

interface ContractTypesManagerProps {
  /** مُركّب داخل تبويب إعدادات للمدير فقط — الصلاحية محكومة بالخادم (adminGuard) */
  onAuthError: () => void;
}

interface TypeForm {
  name: string;
  pricingMode: string;
  isSupervision: boolean;
  manualTrack: boolean;
  defaultAmount: string;
  unitLabel: string;
  unitPrice: string;
  notes: string;
}

const EMPTY_FORM: TypeForm = {
  name: "",
  pricingMode: "lump",
  isSupervision: false,
  manualTrack: false,
  defaultAmount: "0",
  unitLabel: "",
  unitPrice: "0",
  notes: "",
};

function formFromRow(t: ContractTypeDTO): TypeForm {
  return {
    name: t.name,
    pricingMode: t.pricingMode || "lump",
    isSupervision: Boolean(t.isSupervision),
    manualTrack: Boolean(t.manualTrack),
    defaultAmount: String(t.defaultAmount ?? 0),
    unitLabel: t.unitLabel || "",
    unitPrice: String(t.unitPrice ?? 0),
    notes: t.notes || "",
  };
}

export function ContractTypesManager({ onAuthError }: ContractTypesManagerProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const typesQuery = useQuery<ContractTypesResponse>({
    queryKey: ["contract-types"],
    queryFn: () => apiGet<ContractTypesResponse>("/api/contract-types"),
  });
  const types = typesQuery.data?.types ?? [];

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["contract-types"] });
  }, [qc]);

  const fail = React.useCallback(
    (e: unknown, title: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      // رسالة الخادم تُعرض حرفيًا (حرس المكتبي)
      toast({ variant: "destructive", title, description: errMessage(e) });
    },
    [onAuthError, toast]
  );

  // ===== نافذة الإضافة/التعديل =====
  const [dialog, setDialog] = React.useState<{ mode: "create" | "edit"; row: ContractTypeDTO | null } | null>(null);
  const [form, setForm] = React.useState<TypeForm>(EMPTY_FORM);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setDialog({ mode: "create", row: null });
  };
  const openEdit = (t: ContractTypeDTO) => {
    setForm(formFromRow(t));
    setDialog({ mode: "edit", row: t });
  };

  const saveMutation = useMutation({
    mutationFn: (f: TypeForm) => {
      const payload = {
        name: f.name.trim(),
        pricingMode: f.pricingMode,
        isSupervision: f.isSupervision,
        manualTrack: f.manualTrack,
        defaultAmount: Number(f.defaultAmount || 0),
        unitLabel: f.unitLabel.trim(),
        unitPrice: Number(f.unitPrice || 0),
        notes: f.notes,
      };
      return dialog?.mode === "edit" && dialog.row
        ? apiPatch(`/api/contract-types/${dialog.row.id}`, payload)
        : apiPost("/api/contract-types", payload);
    },
    onSuccess: () => {
      invalidate();
      toast({
        title: dialog?.mode === "edit" ? "تم التعديل" : "تمت الإضافة",
        description: dialog?.mode === "edit" ? "حُدّث نوع العقد" : "أُضيف نوع العقد",
      });
      setDialog(null);
    },
    onError: (e) => fail(e, "تعذر حفظ النوع"),
  });

  const submitDialog = () => {
    // حرس المكتبي قبل الإرسال — الرسائل الحرفية نفسها (validateTypeInput)
    const guardError = validateTypeInput({
      name: form.name,
      defaultAmount: Number(form.defaultAmount || 0),
      unitPrice: Number(form.unitPrice || 0),
      pricingMode: form.pricingMode,
      isSupervision: form.isSupervision,
    });
    if (guardError) {
      toast({ variant: "destructive", title: "بيانات غير صالحة", description: guardError });
      return;
    }
    saveMutation.mutate(form);
  };

  // ===== تفعيل/تعطيل =====
  const toggleMutation = useMutation({
    mutationFn: (t: ContractTypeDTO) => apiPatch(`/api/contract-types/${t.id}`, { active: !t.active }),
    onSuccess: () => {
      invalidate();
      toast({ title: "تم", description: "حُدّثت حالة النوع" });
    },
    onError: (e) => fail(e, "تعذر تحديث النوع"),
  });

  // ===== حذف (بتأكيد) =====
  const [deleteRow, setDeleteRow] = React.useState<ContractTypeDTO | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/contract-types/${id}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "تم الحذف", description: "حُذف نوع العقد" });
      setDeleteRow(null);
    },
    onError: (e) => {
      setDeleteRow(null);
      fail(e, "تعذر حذف النوع");
    },
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-base">أنواع العقود والمبالغ</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">نوع العقد يحدد طريقة التسعير للعقود الجديدة فقط.</p>
        </div>
        <Button size="sm" className="h-9 gap-1.5" onClick={openCreate}>
          <Plus className="size-4" />
          ＋ إضافة نوع
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {typesQuery.isLoading ? (
          <Skeleton className="h-64 rounded-lg" />
        ) : typesQuery.isError ? (
          <p className="p-4 text-center text-sm text-muted-foreground">{errMessage(typesQuery.error)}</p>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-lg border">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center">النوع</TableHead>
                  <TableHead className="text-center">نمط التسعير</TableHead>
                  <TableHead className="text-center">المبلغ الافتراضي</TableHead>
                  <TableHead className="text-center">وحدة القياس</TableHead>
                  <TableHead className="text-center">سعر الوحدة</TableHead>
                  <TableHead className="text-center">عدد العقود</TableHead>
                  <TableHead className="text-center">الحالة</TableHead>
                  <TableHead className="text-center">المسار</TableHead>
                  <TableHead className="text-center">ملاحظات</TableHead>
                  <TableHead className="w-40 text-center">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {types.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="p-6 text-center text-sm text-muted-foreground">
                      لا أنواع عقود بعد — أضف أول نوع بالزر أعلى.
                    </TableCell>
                  </TableRow>
                ) : (
                  types.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="max-w-40 truncate font-semibold" title={t.name}>
                        {t.name}
                      </TableCell>
                      <TableCell className="text-center text-xs">
                        {pricingModeLabel(t.pricingMode)}
                        {t.isSupervision && " (إشرافي)"}
                      </TableCell>
                      <TableCell className="text-center text-xs" dir="ltr">
                        {formatKWD(t.defaultAmount)}
                      </TableCell>
                      <TableCell className="text-center text-xs">{(t.unitLabel || "").trim() || "—"}</TableCell>
                      <TableCell className="text-center text-xs" dir="ltr">
                        {Number(t.unitPrice ?? 0) > 0 ? formatKWD(t.unitPrice) : "—"}
                      </TableCell>
                      <TableCell className="text-center text-xs" dir="ltr">
                        {t.contractsCount ?? 0}
                      </TableCell>
                      <TableCell className="text-center">
                        {t.active ? (
                          <Badge className="bg-status-done-bg text-status-done">مفعّل</Badge>
                        ) : (
                          <Badge variant="secondary">معطّل</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center text-xs">{t.manualTrack ? "🔧 يدوي" : "تلقائي"}</TableCell>
                      <TableCell className="max-w-48 truncate text-xs text-muted-foreground" title={t.notes || undefined}>
                        {t.notes || ""}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1 px-2 text-xs"
                            onClick={() => openEdit(t)}
                          >
                            <Pencil className="size-3" />
                            ✎ تعديل
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1 px-2 text-xs"
                            title="تعطيل نوع: يختفي من قائمة العقود الجديدة ويبقى في التقارير."
                            disabled={toggleMutation.isPending}
                            onClick={() => toggleMutation.mutate(t)}
                          >
                            <Power className="size-3" />
                            {t.active ? "تعطيل" : "تفعيل"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setDeleteRow(t)}
                          >
                            <Trash2 className="size-3" />
                            حذف
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          المفعّل يظهر في قائمة العقود الجديدة · المعطّل يبقى في العقود والتقارير القائمة.
        </p>
      </CardContent>

      {/* ===== نافذة إضافة/تعديل نوع (_ContractTypeDialog) ===== */}
      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialog?.mode === "edit" ? "تعديل نوع العقد" : "إضافة نوع عقد"}</DialogTitle>
            <DialogDescription>
              النمط يحدد شكل نافذة العقد · التغيير يسري على العقود الجديدة فقط ولا يعيد حساب أي عقد قائم
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ct-name">اسم النوع</Label>
              <Input
                id="ct-name"
                className="h-9"
                placeholder="اسم النوع (مثال: بناء فيلا)"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>نمط التسعير</Label>
              <Select value={form.pricingMode} onValueChange={(v) => setForm((f) => ({ ...f, pricingMode: v }))}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {PRICING_MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-start gap-2 rounded-lg border p-2.5 text-sm sm:col-span-2">
              <Checkbox
                className="mt-0.5"
                checked={form.isSupervision}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isSupervision: v === true }))}
              />
              <span>عقد إشراف هندسي (تاريخ تعهد + تمديد تلقائي)</span>
            </label>
            <label className="flex items-start gap-2 rounded-lg border p-2.5 text-sm sm:col-span-2">
              <Checkbox
                className="mt-0.5"
                checked={form.manualTrack}
                onCheckedChange={(v) => setForm((f) => ({ ...f, manualTrack: v === true }))}
              />
              <span>🔧 مسار يدوي (تعليم حر للمراحل)</span>
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="ct-amount">المبلغ الافتراضي</Label>
              <Input
                id="ct-amount"
                className="h-9"
                dir="ltr"
                type="number"
                min="0"
                step="0.001"
                value={form.defaultAmount}
                onChange={(e) => setForm((f) => ({ ...f, defaultAmount: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-unit">وحدة القياس</Label>
              <Input
                id="ct-unit"
                className="h-9"
                placeholder="واجهة · دور · متر (اتركه فارغًا للمبلغ المقطوع)"
                value={form.unitLabel}
                onChange={(e) => setForm((f) => ({ ...f, unitLabel: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-unit-price">سعر الوحدة الواحدة</Label>
              <Input
                id="ct-unit-price"
                className="h-9"
                dir="ltr"
                type="number"
                min="0"
                step="0.001"
                value={form.unitPrice}
                onChange={(e) => setForm((f) => ({ ...f, unitPrice: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ct-notes">ملاحظات</Label>
              <Input
                id="ct-notes"
                className="h-9"
                placeholder="ملاحظات (اختياري)"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setDialog(null)} disabled={saveMutation.isPending}>
              إلغاء
            </Button>
            <Button className="h-9" onClick={submitDialog} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تأكيد الحذف (contract_hub.py:2312) ===== */}
      <AlertDialog open={deleteRow !== null} onOpenChange={(open) => !open && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف نوع العقد</AlertDialogTitle>
            <AlertDialogDescription>حذف نوع العقد «{deleteRow?.name}»؟</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => deleteRow && deleteMutation.mutate(deleteRow.id)}
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
