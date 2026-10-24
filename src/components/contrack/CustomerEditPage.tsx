"use client";

/**
 * نموذج العميل — صفحة كاملة (بدل نافذة CustomerFormDialog السابقة — 9 حقول):
 * نفس الحقول كلها ونفس الحفظ والتحقق والـinvalidations والـtoasts حرفيًا.
 * تُفتح من شاشة العملاء («عميل جديد»/«تعديل») ومن ملف العميل («تعديل البيانات»)
 * — بلا مسار جديد، تُعرض مكان الشاشة المستدعية (استبدال في نفس المستوى).
 */

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

interface CustomerEditPageProps {
  /** عميل للتعديل — null لإضافة عميل جديد */
  editing: Customer | null;
  initialForm?: CustomerFormData;
  onAuthError: () => void;
  /** بعد الحفظ الناجح (مع العميل المحفوظ) */
  onSaved?: (customer: Customer) => void;
  /** العودة للشاشة السابقة — تُستدعى بعد الحفظ أو عند الإلغاء */
  onClose: () => void;
  /** مفاتيح استعلامات إضافية تُبطل بعد الحفظ (مثل ملف العميل) */
  invalidateKeys?: (string | number)[][];
}

export function CustomerEditPage({
  editing,
  initialForm,
  onAuthError,
  onSaved,
  onClose,
  invalidateKeys = [],
}: CustomerEditPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  // الصفحة تُركَّب عند الفتح فقط — التهيئة مباشرة (تعديل → بيانات العميل، إضافة → فارغ)
  const [form, setForm] = React.useState<CustomerFormData>(
    initialForm ?? (editing ? toCustomerForm(editing) : EMPTY_CUSTOMER_FORM)
  );

  const set = (key: keyof CustomerFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  // ===== نفس حفظ النافذة السابقة حرفيًا (نفس الـpayload والـinvalidations والـtoasts) =====
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
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "خطأ", description: errMessage(e) || "تعذر حفظ العميل" });
    },
  });

  return (
    <div className="space-y-4">
      {/* ===== رأس الصفحة ===== */}
      <div>
        <p className="text-xs text-muted-foreground">العملاء والعقود ← العملاء</p>
        <h1 className="text-xl font-bold">{editing ? `تعديل بيانات: ${editing.name}` : "عميل جديد"}</h1>
        <p className="text-sm text-muted-foreground">
          {editing ? "عدّل بيانات العميل ثم احفظ" : "الكود يُولَّد تلقائيًا (CUS-####)"}
        </p>
      </div>

      {/* ===== الحقول — نفس حقول النافذة السابقة كلها ===== */}
      <Card>
        <CardContent className="p-4 md:p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
              <Label htmlFor="c-name" className="text-xs">
                الاسم *
              </Label>
              <Input id="c-name" className="h-9" value={form.name} onChange={set("name")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-phone" className="text-xs">
                الهاتف
              </Label>
              <Input id="c-phone" className="h-9" dir="ltr" value={form.phone} onChange={set("phone")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-email" className="text-xs">
                البريد الإلكتروني
              </Label>
              <Input id="c-email" className="h-9" dir="ltr" type="email" value={form.email} onChange={set("email")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-gov" className="text-xs">
                المحافظة
              </Label>
              <Input id="c-gov" className="h-9" value={form.governorate} onChange={set("governorate")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-area" className="text-xs">
                المنطقة
              </Label>
              <Input id="c-area" className="h-9" value={form.area} onChange={set("area")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-block" className="text-xs">
                القطعة (Block)
              </Label>
              <Input id="c-block" className="h-9" value={form.block} onChange={set("block")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-plot" className="text-xs">
                القطعة الأرضية (Plot)
              </Label>
              <Input id="c-plot" className="h-9" value={form.plot} onChange={set("plot")} />
            </div>
            <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
              <Label htmlFor="c-address" className="text-xs">
                العنوان التفصيلي
              </Label>
              <Input id="c-address" className="h-9" value={form.address} onChange={set("address")} />
            </div>
            <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
              <Label htmlFor="c-notes" className="text-xs">
                ملاحظات
              </Label>
              <Textarea id="c-notes" rows={2} value={form.notes} onChange={set("notes")} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== شريط الإجراءات السفلي — حفظ أساسي واحد + إلغاء outline ===== */}
      <div className="sticky bottom-0 z-30">
        <Card className="border bg-background/95 shadow-sm backdrop-blur">
          <CardContent className="flex items-center justify-end gap-2 p-2">
            <Button variant="outline" className="h-9" onClick={onClose} disabled={saveMutation.isPending}>
              إلغاء
            </Button>
            <Button className="h-9" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "جارٍ الحفظ…" : "حفظ"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
