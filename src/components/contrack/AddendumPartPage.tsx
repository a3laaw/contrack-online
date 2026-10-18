"use client";

/**
 * صفحة «إضافة جزء للملحق» — تحويل نافذة إضافة الجزء في AddendumsTab إلى صفحة كاملة.
 * نفس الحقول (الإجراء/المرجع/الوصف/الكمية/الوحدة/سعر الوحدة/المبلغ/الاستحقاق/العنصر المحذوف/المرحلة)
 * ونفس التحققات ومِلَك الإضافة (POST /api/addendums/[id]/parts) حرفيًا — لا تغيير منطق أعمال.
 * لا مسار جديد — تُعرض مكان تاب الملاحق، والعودة تعيد فتح حوار الملحق عند خطوة الأجزاء.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

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
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPost } from "./api";
import type {
  BoqResponse,
  ContractPlanBrief,
  ContractStage,
} from "./contrack-types";
import { errMessage } from "./contrack-types";
import { fmtDate, formatKWD, round3 } from "@/lib/format";

type PartAction = "add" | "delete" | "unlink";
type PartRefKind = "boq" | "plan" | "stage";

interface AddendumPartPageProps {
  contractId: number;
  /** رقم العقد للعرض في المسار */
  contractNumber: string;
  /** الملحق المستهدف (currentId) */
  addendumId: number;
  /** رقم الملحق للعرض في المسار */
  addendumNumber: string;
  planLines: ContractPlanBrief[];
  stages: ContractStage[];
  onAuthError: () => void;
  /** بعد إضافة الجزء — يعود لحوار الملحق عند خطوة الأجزاء */
  onSaved: () => void;
  /** إلغاء — يعود لحوار الملحق عند خطوة الأجزاء */
  onCancel: () => void;
}

export function AddendumPartPage({
  contractId,
  contractNumber,
  addendumId,
  addendumNumber,
  planLines,
  stages,
  onAuthError,
  onSaved,
  onCancel,
}: AddendumPartPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // ===== الحقول (نفس حالات النافذة حرفيًا) =====
  const [pAction, setPAction] = React.useState<PartAction>("add");
  const [pRefKind, setPRefKind] = React.useState<PartRefKind>("boq");
  const [pDesc, setPDesc] = React.useState("");
  const [pQty, setPQty] = React.useState("");
  const [pUnit, setPUnit] = React.useState("");
  const [pUnitPrice, setPUnitPrice] = React.useState("");
  const [pAmount, setPAmount] = React.useState("");
  const [pDueDate, setPDueDate] = React.useState("");
  const [pRefId, setPRefId] = React.useState("none");

  const boqQuery = useQuery<BoqResponse>({
    queryKey: ["contract", contractId, "boq"],
    queryFn: () => apiGet<BoqResponse>(`/api/contracts/${contractId}/boq`),
    enabled: pRefKind === "boq",
  });
  const boqItems = boqQuery.data?.items ?? [];

  const partAmount = round3(Number(pQty || 0) * Number(pUnitPrice || 0));

  // ===== نفس الـmutation حرفيًا =====
  const addPartMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPost(`/api/addendums/${addendumId}/parts`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["addendum", addendumId] });
      qc.invalidateQueries({ queryKey: ["contract", contractId, "addendums"] });
      toast({ title: "أُضيف الجزء للملحق" });
      onSaved();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر إضافة الجزء", description: errMessage(e) });
    },
  });

  const submitPart = () => {
    const body: Record<string, unknown> = { action: pAction, refKind: pRefKind };
    if (pAction === "add") {
      if (!pDesc.trim()) {
        toast({ variant: "destructive", title: "أدخل الوصف" });
        return;
      }
      body.description = pDesc.trim();
      if (pRefKind === "boq") {
        if (!(Number(pQty) > 0) || !(Number(pUnitPrice) > 0)) {
          toast({ variant: "destructive", title: "أدخل الكمية وسعر الوحدة" });
          return;
        }
        body.qty = Number(pQty);
        body.unit = pUnit.trim();
        body.unitPrice = Number(pUnitPrice);
        body.amount = partAmount;
      } else {
        if (!(Number(pAmount) > 0)) {
          toast({ variant: "destructive", title: "أدخل مبلغ الدفعة" });
          return;
        }
        body.amount = Number(pAmount);
        // الخلفي يستقبل تاريخ استحقاق الدفعة في body.dueDate ويخزنه في unit داخليًا
        if (pDueDate) body.dueDate = pDueDate;
      }
    } else {
      if (pRefId === "none") {
        toast({ variant: "destructive", title: pAction === "unlink" ? "اختر المرحلة" : "اختر العنصر المحذوف" });
        return;
      }
      body.refId = Number(pRefId);
      if (pRefKind === "boq") {
        const b = boqItems.find((x) => String(x.id) === pRefId);
        body.description = b?.description ?? "";
        body.amount = b?.amount ?? 0;
      } else if (pRefKind === "plan") {
        const l = planLines.find((x) => String(x.id) === pRefId);
        body.description = l?.title ?? "";
        body.amount = l?.amount ?? 0;
      } else {
        const st = stages.find((x) => String(x.id) === pRefId);
        body.description = st?.name ?? "";
      }
    }
    addPartMutation.mutate(body);
  };

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
          <span aria-hidden="true">←</span>
          <span>ملحق {addendumNumber || "—"}</span>
        </nav>
        <h1 className="mt-1 text-xl font-bold">إضافة جزء للملحق</h1>
        <p className="text-sm text-muted-foreground">
          الإضافة تنشئ بندًا/دفعة جديدة، الحذف يستهدف عنصرًا موجودًا، وفك الربط يفصل مرحلة عن العقد.
        </p>
      </header>

      {/* ===== الحقول ===== */}
      <Card>
        <CardContent className="p-4 md:p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label>الإجراء</Label>
              <Select
                value={pAction}
                onValueChange={(v) => {
                  const a = v as PartAction;
                  setPAction(a);
                  setPRefId("none");
                  if (a === "unlink") setPRefKind("stage");
                  else setPRefKind("boq");
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="add">إضافة بند</SelectItem>
                  <SelectItem value="delete">حذف بند</SelectItem>
                  <SelectItem value="unlink">فك ربط مرحلة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>المرجع</Label>
              <Select
                value={pRefKind}
                disabled={pAction === "unlink"}
                onValueChange={(v) => {
                  setPRefKind(v as PartRefKind);
                  setPRefId("none");
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pAction !== "unlink" && (
                    <>
                      <SelectItem value="boq">بنود الكميات</SelectItem>
                      <SelectItem value="plan">دفعة</SelectItem>
                    </>
                  )}
                  {pAction === "unlink" && <SelectItem value="stage">مرحلة</SelectItem>}
                </SelectContent>
              </Select>
            </div>

            {pAction === "add" && pRefKind === "boq" && (
              <>
                <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                  <Label>وصف البند *</Label>
                  <Input className="h-9" value={pDesc} onChange={(e) => setPDesc(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>الكمية *</Label>
                  <Input type="number" step="0.001" min="0" dir="ltr" className="h-9" value={pQty} onChange={(e) => setPQty(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>الوحدة</Label>
                  <Input className="h-9" value={pUnit} onChange={(e) => setPUnit(e.target.value)} placeholder="م² ، م.ط ، عددة…" />
                </div>
                <div className="space-y-1.5">
                  <Label>سعر الوحدة *</Label>
                  <Input type="number" step="0.001" min="0" dir="ltr" className="h-9" value={pUnitPrice} onChange={(e) => setPUnitPrice(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>المبلغ (محسوب)</Label>
                  <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-bold tabular-nums">
                    {formatKWD(partAmount)}
                  </div>
                </div>
              </>
            )}

            {pAction === "add" && pRefKind === "plan" && (
              <>
                <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                  <Label>عنوان الدفعة *</Label>
                  <Input className="h-9" value={pDesc} onChange={(e) => setPDesc(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>المبلغ *</Label>
                  <Input type="number" step="0.001" min="0" dir="ltr" className="h-9" value={pAmount} onChange={(e) => setPAmount(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>تاريخ الاستحقاق</Label>
                  <Input type="date" className="h-9" value={pDueDate} onChange={(e) => setPDueDate(e.target.value)} />
                </div>
              </>
            )}

            {pAction === "delete" && pRefKind === "boq" && (
              <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                <Label>البند المحذوف *</Label>
                <Select value={pRefId} onValueChange={setPRefId}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="اختر بند الكميات" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— اختر —</SelectItem>
                    {boqItems.map((b) => (
                      <SelectItem key={b.id} value={String(b.id)}>
                        {b.description} — {formatKWD(b.qty)} {b.unit} × {formatKWD(b.unitPrice)} = {formatKWD(b.amount)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {boqItems.length === 0 && boqQuery.isSuccess && (
                  <p className="text-xs text-muted-foreground">لا بنود كميات على هذا العقد.</p>
                )}
              </div>
            )}

            {pAction === "delete" && pRefKind === "plan" && (
              <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                <Label>الدفعة المحذوفة *</Label>
                <Select value={pRefId} onValueChange={setPRefId}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="اختر الدفعة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— اختر —</SelectItem>
                    {planLines.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.title} — {formatKWD(l.amount)} — استحقاق {fmtDate(l.dueDate)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {planLines.length === 0 && (
                  <p className="text-xs text-muted-foreground">لا دفعات في خطة هذا العقد.</p>
                )}
              </div>
            )}

            {pAction === "unlink" && (
              <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                <Label>المرحلة المنفصلة *</Label>
                <Select value={pRefId} onValueChange={setPRefId}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="اختر المرحلة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— اختر —</SelectItem>
                    {stages.map((st) => (
                      <SelectItem key={st.id} value={String(st.id)}>
                        {st.name}
                        {st.startDate ? ` — بدأت ${fmtDate(st.startDate)}` : ""}
                        {st.isSkipped ? " — متخطاة" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {stages.length === 0 && <p className="text-xs text-muted-foreground">لا مراحل على هذا العقد.</p>}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ===== شريط الإجراءات السفلي ===== */}
      <div className="sticky bottom-2 z-30">
        <Card className="border bg-background/95 shadow-sm backdrop-blur">
          <CardContent className="flex items-center justify-end gap-2 p-2">
            <Button variant="outline" className="h-9" onClick={onCancel} disabled={addPartMutation.isPending}>
              إلغاء
            </Button>
            <Button className="h-9 gap-1.5" disabled={addPartMutation.isPending} onClick={submitPart}>
              {addPartMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              إضافة الجزء
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
