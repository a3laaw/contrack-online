"use client";

/**
 * صفحة «إضافة بند كميات» — تحويل النافذة الصغيرة في ContractDetailView إلى صفحة كاملة صغيرة.
 * نفس الحقول الأربعة (الوصف/الكمية/الوحدة/سعر الوحدة) بنفس ids ومِلَك الإضافة
 * (POST /api/contracts/[id]/boq) حرفيًا — لا تغيير منطق أعمال.
 * لا مسار جديد — تُعرض مكان شاشة العقد عبر flowPage.
 */

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiPost } from "./api";
import { errMessage } from "./contrack-types";

interface ContractBoqPageProps {
  contractId: number;
  contractNumber: string;
  onAuthError: () => void;
  /** بعد الإضافة الناجحة — يعود لشاشة العقد */
  onSaved: () => void;
  /** إلغاء — يعود لشاشة العقد */
  onCancel: () => void;
}

export function ContractBoqPage({ contractId, contractNumber, onAuthError, onSaved, onCancel }: ContractBoqPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // نفس حقول النافذة (تُهيأ فارغة عند كل فتح كما كانت)
  const [boqForm, setBoqForm] = React.useState({ description: "", qty: "1", unit: "", unitPrice: "" });

  // نفس الـmutation حرفيًا
  const addBoqMutation = useMutation({
    mutationFn: () =>
      apiPost(`/api/contracts/${contractId}/boq`, {
        description: boqForm.description.trim(),
        qty: Number(boqForm.qty || 1),
        unit: boqForm.unit.trim(),
        unitPrice: Number(boqForm.unitPrice || 0),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contract", contractId, "boq"] });
      toast({ title: "تمت الإضافة", description: "أُضيف البند لبنود الكميات" });
      setBoqForm({ description: "", qty: "1", unit: "", unitPrice: "" });
      onSaved();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر إضافة البند", description: errMessage(e) });
    },
  });

  return (
    <div className="space-y-4">
      {/* ===== رأس الصفحة ===== */}
      <header>
        <nav aria-label="مسار التنقل" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>العملاء والعقود</span>
          <span aria-hidden="true">←</span>
          <span>العقود</span>
          <span aria-hidden="true">←</span>
          <span className="font-medium text-foreground" dir="ltr">
            {contractNumber}
          </span>
        </nav>
        <h1 className="mt-1 text-xl font-bold">إضافة بند كميات</h1>
        <p className="text-sm text-muted-foreground">بند وصفي لا يؤثر على قيمة العقد المالية.</p>
      </header>

      {/* ===== الحقول ===== */}
      <Card>
        <CardContent className="p-4 md:p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
              <Label htmlFor="bq-desc">الوصف *</Label>
              <Input
                id="bq-desc"
                className="h-9"
                value={boqForm.description}
                onChange={(e) => setBoqForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bq-qty">الكمية</Label>
              <Input
                id="bq-qty"
                className="h-9"
                dir="ltr"
                type="number"
                min="0"
                step="0.001"
                value={boqForm.qty}
                onChange={(e) => setBoqForm((f) => ({ ...f, qty: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bq-unit">الوحدة</Label>
              <Input
                id="bq-unit"
                className="h-9"
                value={boqForm.unit}
                onChange={(e) => setBoqForm((f) => ({ ...f, unit: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bq-price">سعر الوحدة</Label>
              <Input
                id="bq-price"
                className="h-9"
                dir="ltr"
                type="number"
                min="0"
                step="0.001"
                value={boqForm.unitPrice}
                onChange={(e) => setBoqForm((f) => ({ ...f, unitPrice: e.target.value }))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== شريط الإجراءات السفلي ===== */}
      <div className="sticky bottom-0 z-30">
        <Card className="border bg-background/95 shadow-sm backdrop-blur">
          <CardContent className="flex items-center justify-end gap-2 p-2">
            <Button variant="outline" className="h-9" onClick={onCancel} disabled={addBoqMutation.isPending}>
              إلغاء
            </Button>
            <Button
              className="h-9"
              disabled={addBoqMutation.isPending || !boqForm.description.trim()}
              onClick={() => addBoqMutation.mutate()}
            >
              {addBoqMutation.isPending ? "جارٍ الإضافة…" : "إضافة"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
