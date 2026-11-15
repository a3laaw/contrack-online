"use client";

/**
 * صفحة «إضافة بند كميات» — تحويل النافذة الصغيرة في ContractDetailView إلى صفحة كاملة صغيرة.
 * نفس الحقول (الوصف/الكمية/الوحدة/سعر الوحدة/المخططة) + محدد المراحل (سيناريو المالك 2026-11:
 * «في جداول الكميات للعميل هربط البند مع مرحلة عمل او اكثر» — شارات اختيار، الأولى أساسية)
 * بنفس مِلَك الإضافة (POST /api/contracts/[id]/boq) — لا تغيير منطق أعمال.
 * لا مسار جديد — تُعرض مكان شاشة العقد عبر flowPage.
 */

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Layers } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiPost } from "./api";
import { errMessage } from "./contrack-types";

interface StageLite {
  id: number;
  name: string;
  isSkipped?: boolean;
}

interface ContractBoqPageProps {
  contractId: number;
  contractNumber: string;
  /** مراحل العقد (المستوى الأول) — محدد الربط بالمرحلة أو أكثر */
  stages?: StageLite[];
  onAuthError: () => void;
  /** بعد الإضافة الناجحة — يعود لشاشة العقد */
  onSaved: () => void;
  /** إلغاء — يعود لشاشة العقد */
  onCancel: () => void;
}

export function ContractBoqPage({ contractId, contractNumber, stages, onAuthError, onSaved, onCancel }: ContractBoqPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // نفس حقول النافذة (تُهيأ فارغة عند كل فتح كما كانت) — plannedQty: الكمية المخططة للتنفيذ (بند NOVA 5)
  const [boqForm, setBoqForm] = React.useState({ description: "", qty: "1", unit: "", unitPrice: "", plannedQty: "" });
  // سيناريو المالك 2026-11 — مراحل البند: الأولى المختارة أساسية والباقي إضافية
  const [stageIds, setStageIds] = React.useState<number[]>([]);

  const stageOptions = (stages ?? []).filter((s) => !s.isSkipped);

  const toggleStage = (id: number) => {
    setStageIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // نفس الـmutation حرفيًا + المراحل المختارة
  const addBoqMutation = useMutation({
    mutationFn: () =>
      apiPost(`/api/contracts/${contractId}/boq`, {
        description: boqForm.description.trim(),
        qty: Number(boqForm.qty || 1),
        unit: boqForm.unit.trim(),
        unitPrice: Number(boqForm.unitPrice || 0),
        // الكمية المخططة تُرسل فقط عند إدخالها (> 0) — اختيارية بأرضية صفر
        ...(Number(boqForm.plannedQty || 0) > 0 ? { plannedQty: Number(boqForm.plannedQty) } : {}),
        // المراحل بالترتيب: الأولى أساسية — فارغة = بند بلا ربط مرحلي
        stageIds,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contract", contractId, "boq"] });
      toast({ title: "تمت الإضافة", description: stageIds.length > 0 ? "أُضيف البند وُربط بالمراحل المختارة" : "أُضيف البند لبنود الكميات" });
      setBoqForm({ description: "", qty: "1", unit: "", unitPrice: "", plannedQty: "" });
      setStageIds([]);
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
            <div className="space-y-1.5">
              <Label htmlFor="bq-planned">الكمية المخططة</Label>
              <Input
                id="bq-planned"
                className="h-9"
                dir="ltr"
                type="number"
                min="0"
                step="any"
                value={boqForm.plannedQty}
                onChange={(e) => setBoqForm((f) => ({ ...f, plannedQty: e.target.value }))}
              />
            </div>

            {/* ===== سيناريو المالك 2026-11 — ربط البند بمرحلة عمل أو أكثر ===== */}
            <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
              <Label>
                <Layers className="me-1 inline size-3.5" aria-hidden />
                مراحل العمل المرتبطة (اختياري — واحدة أو أكثر)
              </Label>
              {stageOptions.length === 0 ? (
                <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                  لا مراحل عمل على هذا العقد بعد — أضف مراحل من «المسار الفني» ثم اربط البنود بها.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="اختيار مراحل العمل">
                    {stageOptions.map((s, i) => {
                      const idx = stageIds.indexOf(s.id);
                      const picked = idx >= 0;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleStage(s.id)}
                          aria-pressed={picked}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                            picked
                              ? "border-primary bg-primary/10 text-primary-ink"
                              : "border-border bg-background text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          <span className="tabular-nums opacity-60" dir="ltr">{i + 1}</span>
                          {s.name}
                          {picked && idx === 0 && (
                            <Badge className="bg-primary/15 text-[10px] text-primary-ink" variant="secondary">
                              أساسية
                            </Badge>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {stageIds.length === 0
                      ? "لم تُختر مرحلة بعد — البند يبقى بلا ربط مرحلي."
                      : `المختارة: ${stageIds.length} — «${stageOptions.find((s) => s.id === stageIds[0])?.name ?? ""}» أساسية، والمستحقات تُشتق عند إنهائها.`}
                  </p>
                </>
              )}
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
