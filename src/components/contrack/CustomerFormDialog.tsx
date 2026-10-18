"use client";

/**
 * حوار إضافة/تعديل عميل — مُستخرج من CustomersView ليُعاد استعماله
 * من ملف العميل (زر «تعديل البيانات» في EntityHeader) بنفس السلوك الحرفي.
 */

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiPatch, apiPost } from "./api";
import type { Customer } from "./contrack-types";
import { errMessage } from "./contrack-types";

export interface CustomerFormData {
  name: string;
  phone: string;
  email: string;
  governorate: string;
  area: string;
  block: string;
  plot: string;
  address: string;
  notes: string;
}

export const EMPTY_CUSTOMER_FORM: CustomerFormData = {
  name: "",
  phone: "",
  email: "",
  governorate: "",
  area: "",
  block: "",
  plot: "",
  address: "",
  notes: "",
};

export function toCustomerForm(c: Customer): CustomerFormData {
  return {
    name: c.name || "",
    phone: c.phone || "",
    email: c.email || "",
    governorate: c.governorate || "",
    area: c.area || "",
    block: c.block || "",
    plot: c.plot || "",
    address: c.address || "",
    notes: c.notes || "",
  };
}

interface CustomerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** عميل للتعديل — null لإضافة عميل جديد */
  editing: Customer | null;
  initialForm?: CustomerFormData;
  onAuthError: () => void;
  /** بعد الحفظ الناجح (مع العميل المحفوظ) */
  onSaved?: (customer: Customer) => void;
  /** مفتاح الاستعلام الإضافي الذي يُبطل بعد الحفظ (مثل ملف العميل) */
  invalidateKeys?: (string | number)[][];
}

export function CustomerFormDialog({
  open,
  onOpenChange,
  editing,
  initialForm,
  onAuthError,
  onSaved,
  invalidateKeys = [],
}: CustomerFormDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = React.useState<CustomerFormData>(initialForm ?? EMPTY_CUSTOMER_FORM);

  // مزامنة النموذج عند الفتح (تعديل → بيانات العميل، إضافة → فارغ)
  React.useEffect(() => {
    if (open) setForm(initialForm ?? (editing ? toCustomerForm(editing) : EMPTY_CUSTOMER_FORM));
  }, [open, editing]);

  const set = (key: keyof CustomerFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new ApiError("اسم العميل مطلوب", 400);
      const body = { ...form, name: form.name.trim() };
      if (editing) return apiPatch<{ customer: Customer }>(`/api/customers/${editing.id}`, body);
      return apiPost<{ customer: Customer }>("/api/customers", body);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      if (editing) qc.invalidateQueries({ queryKey: ["customer", editing.id] });
      for (const key of invalidateKeys) qc.invalidateQueries({ queryKey: key });
      toast({
        title: editing ? "تم التعديل" : "تمت الإضافة",
        description: `العميل «${res.customer.name}» (${res.customer.customerCode})`,
      });
      onSaved?.(res.customer);
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "خطأ", description: errMessage(e) || "تعذر حفظ العميل" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onOpenChange(false); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `تعديل العميل — ${editing.name}` : "إضافة عميل جديد"}</DialogTitle>
          <DialogDescription>
            {editing ? "عدّل بيانات العميل ثم احفظ" : "الكود يُولَّد تلقائيًا (CUS-####)"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="c-name">الاسم *</Label>
            <Input id="c-name" className="h-9" value={form.name} onChange={set("name")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-phone">الهاتف</Label>
            <Input id="c-phone" className="h-9" dir="ltr" value={form.phone} onChange={set("phone")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-email">البريد الإلكتروني</Label>
            <Input id="c-email" className="h-9" dir="ltr" type="email" value={form.email} onChange={set("email")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-gov">المحافظة</Label>
            <Input id="c-gov" className="h-9" value={form.governorate} onChange={set("governorate")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-area">المنطقة</Label>
            <Input id="c-area" className="h-9" value={form.area} onChange={set("area")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-block">القطعة (Block)</Label>
            <Input id="c-block" className="h-9" value={form.block} onChange={set("block")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-plot">القطعة الأرضية (Plot)</Label>
            <Input id="c-plot" className="h-9" value={form.plot} onChange={set("plot")} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="c-address">العنوان التفصيلي</Label>
            <Input id="c-address" className="h-9" value={form.address} onChange={set("address")} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="c-notes">ملاحظات</Label>
            <Textarea id="c-notes" rows={2} value={form.notes} onChange={set("notes")} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-9" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>
            إلغاء
          </Button>
          <Button className="h-9" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "جارٍ الحفظ…" : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
