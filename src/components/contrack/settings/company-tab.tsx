"use client";

/**
 * تبويب «⌂ بيانات الشركة» — مرآة المكتبي _tab_company (settings.py:540-699):
 * بيانات الشركة + نص هيدر النظام + الإعدادات المالية (رسوم البنك · بوابة
 * صرف الباطن · الأرصدة الافتتاحية) + أساليب الدفع والرسوم (PaymentMethodsDialog
 * المكتبية كشبكة ويب) + صف الحفظ. كل الأسلاك عبر /api/settings و
 * /api/payment-methods كما كانت — بلا تغيير في العقود.
 */

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiPatch, apiPost } from "../api";
import type { PaymentMethodDTO, PaymentMethodsResponse } from "../contrack-types";
import { errMessage } from "../contrack-types";
import { SaveRow, type SettingsFormDTO } from "./shared";

export interface CompanyTabProps {
  form: SettingsFormDTO;
  upd: (patch: Partial<SettingsFormDTO>) => void;
  methodsQuery: { data?: PaymentMethodsResponse; isLoading: boolean };
  onReset: () => void;
  onSave: () => void;
  savePending: boolean;
  onAuthError: () => void;
}

export function CompanyTab({ form, upd, methodsQuery, onReset, onSave, savePending, onAuthError }: CompanyTabProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">بيانات الشركة</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="s-company">اسم الشركة</Label>
            <Input id="s-company" className="h-9" value={form.companyName} onChange={(e) => upd({ companyName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-currency">العملة</Label>
            <Input id="s-currency" className="h-9" value={form.currency} onChange={(e) => upd({ currency: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-phone">الهاتف</Label>
            <Input id="s-phone" className="h-9" dir="ltr" value={form.companyPhone} onChange={(e) => upd({ companyPhone: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-email">البريد الإلكتروني</Label>
            <Input id="s-email" className="h-9" dir="ltr" type="email" value={form.companyEmail} onChange={(e) => upd({ companyEmail: e.target.value })} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="s-address">العنوان</Label>
            <Input id="s-address" className="h-9" value={form.companyAddress} onChange={(e) => upd({ companyAddress: e.target.value })} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="s-header">نص هيدر النظام</Label>
            <Input
              id="s-header"
              className="h-9"
              placeholder="نظام إدارة العقود والمحاسبة"
              value={form.headerTitle ?? ""}
              onChange={(e) => upd({ headerTitle: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              يظهر كنص هيدر في أعلى شاشات النظام ويُستخدم كعنوان افتراضي في المطبوعات عند الحاجة
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">الإعدادات المالية</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">رسوم البنك</div>
                <div className="text-xs text-muted-foreground">تفعيل احتساب رسوم على سندات القبض</div>
              </div>
              <Switch checked={form.bankFeeEnabled} onCheckedChange={(v) => upd({ bankFeeEnabled: v })} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">بوابة صرف الباطن</div>
                <div className="text-xs text-muted-foreground">إيقاف خط الباطن حتى تحصيل دفعة العميل (subPayClientGate)</div>
              </div>
              <Switch checked={form.subPayClientGate} onCheckedChange={(v) => upd({ subPayClientGate: v })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-fee">قيمة رسوم البنك</Label>
              <Input id="s-fee" className="h-9" dir="ltr" type="number" min="0" step="0.001" value={String(form.bankFeeAmount ?? "")} onChange={(e) => upd({ bankFeeAmount: Number(e.target.value || 0) })} />
            </div>
            <div className="space-y-1.5">
              <Label>طريقة رسوم البنك</Label>
              <Select value={form.bankFeeMethod || ""} onValueChange={(v) => upd({ bankFeeMethod: v })}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="اختر الطريقة" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {(methodsQuery.data?.methods ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-ob-bank">الرصيد الافتتاحي — البنك</Label>
              <Input id="s-ob-bank" className="h-9" dir="ltr" type="number" step="0.001" value={String(form.openingBalanceBank ?? "")} onChange={(e) => upd({ openingBalanceBank: Number(e.target.value || 0) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-ob-cash">الرصيد الافتتاحي — الصندوق</Label>
              <Input id="s-ob-cash" className="h-9" dir="ltr" type="number" step="0.001" value={String(form.openingBalanceCash ?? "")} onChange={(e) => upd({ openingBalanceCash: Number(e.target.value || 0) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-ob-date">تاريخ الرصيد الافتتاحي</Label>
              <Input id="s-ob-date" className="h-9" dir="ltr" type="date" value={(form.openingBalanceDate || "").slice(0, 10)} onChange={(e) => upd({ openingBalanceDate: e.target.value })} />
            </div>
          </div>
        </CardContent>
      </Card>

      <PaymentMethodsCard methodsQuery={methodsQuery} onAuthError={onAuthError} />

      <SaveRow onReset={onReset} onSave={onSave} pending={savePending} />
    </div>
  );
}

// ==================== أساليب الدفع والرسوم (كالمكتبي PaymentMethodsDialog) ====================

function PaymentMethodsCard({
  methodsQuery,
  onAuthError,
}: {
  methodsQuery: { data?: PaymentMethodsResponse; isLoading: boolean };
  onAuthError: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const items = methodsQuery.data?.methods ?? [];

  const [addOpen, setAddOpen] = React.useState(false);
  const [addForm, setAddForm] = React.useState<{ name: string; feeType: string; feeValue: string; isActive: boolean }>({
    name: "",
    feeType: "amount",
    feeValue: "0",
    isActive: true,
  });
  const [deleteTarget, setDeleteTarget] = React.useState<PaymentMethodDTO | null>(null);

  const fail = (e: unknown, title: string) => {
    if (e instanceof ApiError && e.status === 401) onAuthError();
    toast({ variant: "destructive", title, description: errMessage(e) });
  };

  const addMutation = useMutation({
    mutationFn: () =>
      apiPost<{ method: PaymentMethodDTO }>("/api/payment-methods", {
        name: addForm.name.trim(),
        feeType: addForm.feeType,
        feeValue: Number(addForm.feeValue || 0),
        isActive: addForm.isActive,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payment-methods"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast({ title: "تمت الإضافة", description: "أُضيف أسلوب الدفع" });
      setAddOpen(false);
      setAddForm({ name: "", feeType: "amount", feeValue: "0", isActive: true });
    },
    onError: (e) => fail(e, "تعذر الإضافة"),
  });

  // عقد الخلفي: PATCH/DELETE عبر ?id= — التعديل الفوري عند مغادرة الحقل
  const patchMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<PaymentMethodDTO> }) =>
      apiPatch<{ method: PaymentMethodDTO }>(`/api/payment-methods?id=${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payment-methods"] });
      toast({ title: "تم", description: "حُدّث أسلوب الدفع" });
    },
    onError: (e) => fail(e, "تعذر التعديل"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/payment-methods?id=${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payment-methods"] });
      toast({ title: "تم الحذف", description: "حُذف أسلوب الدفع" });
      setDeleteTarget(null);
    },
    onError: (e) => {
      setDeleteTarget(null);
      fail(e, "تعذر الحذف");
    },
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">أساليب الدفع والرسوم</CardTitle>
        <Button size="sm" className="h-9 gap-1.5" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          إضافة
        </Button>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {methodsQuery.isLoading ? (
          <div className="space-y-2 px-6 pb-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="px-6 py-4 text-sm text-muted-foreground">لا أساليب دفع — أضف أول أسلوب.</p>
        ) : (
          <div className="overflow-x-auto px-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-36">الاسم</TableHead>
                  <TableHead className="w-32">نوع الرسم</TableHead>
                  <TableHead className="w-28">القيمة</TableHead>
                  <TableHead className="w-20 text-center">تفعيل</TableHead>
                  <TableHead className="w-16 text-center">حذف</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <Input
                        className="h-9"
                        defaultValue={m.name}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== m.name) patchMutation.mutate({ id: m.id, body: { name: v } });
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={m.feeType}
                        onValueChange={(v) => patchMutation.mutate({ id: m.id, body: { feeType: v } })}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="amount">مبلغ ثابت</SelectItem>
                          <SelectItem value="percent">نسبة %</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-9"
                        dir="ltr"
                        type="number"
                        min="0"
                        step="0.001"
                        defaultValue={String(Number(m.feeValue))}
                        onBlur={(e) => {
                          const v = Number(e.target.value || 0);
                          if (v !== Number(m.feeValue)) patchMutation.mutate({ id: m.id, body: { feeValue: v } });
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch checked={m.isActive} onCheckedChange={(v) => patchMutation.mutate({ id: m.id, body: { isActive: v } })} />
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(m)}
                        aria-label="حذف"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* إضافة أسلوب */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">إضافة أسلوب دفع</DialogTitle>
            <DialogDescription>سيظهر الاسم في قوائم طرق الدفع عند السندات.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pm-name">الاسم *</Label>
              <Input id="pm-name" className="h-9" value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>نوع الرسم</Label>
                <Select value={addForm.feeType} onValueChange={(v) => setAddForm((f) => ({ ...f, feeType: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="amount">مبلغ ثابت</SelectItem>
                    <SelectItem value="percent">نسبة %</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pm-value">القيمة</Label>
                <Input id="pm-value" className="h-9" dir="ltr" type="number" min="0" step="0.001" value={addForm.feeValue} onChange={(e) => setAddForm((f) => ({ ...f, feeValue: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm font-medium">مفعّل</span>
              <Switch checked={addForm.isActive} onCheckedChange={(v) => setAddForm((f) => ({ ...f, isActive: v }))} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setAddOpen(false)} disabled={addMutation.isPending}>إلغاء</Button>
            <Button className="h-9" disabled={addMutation.isPending || !addForm.name.trim()} onClick={() => addMutation.mutate()}>
              {addMutation.isPending ? "جارٍ الإضافة…" : "إضافة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأكيد الحذف */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف أسلوب الدفع؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف «{deleteTarget?.name}». إن كان مستخدمًا في سندات سيرفض النظام الحذف مع إظهار السبب.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9">إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="h-9 bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
              }}
            >
              {deleteMutation.isPending ? "جارٍ الحذف…" : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
