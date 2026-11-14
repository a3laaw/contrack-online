"use client";

/**
 * الشاشة الموحدة «أنواع العقود ← مراحل العمل ← الدفعات» — طلب المالك الحرفي:
 * «أنواع العقود ومراحل العمل والدفعات كلها في صفحة واحدة — نوع العقد أمامه عمود
 *  مراحل العمل، اختيار مرحلة العمل يُظهر عمود الدفعة المرتبطة».
 *
 * ثلاثة أعمدة متتالية (تتكدس على الجوال):
 *   1) أنواع العقود — الاختيار المفتاح: تعديل/تفعيل/حذف بنفس مسارات الإدارة القائمة.
 *   2) مراحل العمل للنوع المحدد — شجرة رئيسيات/فرعيات مع اختيار مرحلة.
 *   3) الدفعة المرتبطة بالمرحلة المختارة — إضافة/تعديل/فك الربط/حذف عبر قوالب
 *      الدفع القائمة (/api/payment-templates) بقواعدها الحرفية:
 *      «المرحلة↔دفعة واحدة» و«مرحلة واحدة = هي المحفزة تلقائيًا».
 * بلا أي جداول أو مسارات جديدة — كل الكتابة عبر الـAPI القائم (حرس adminGuard).
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeDollarSign,
  ClipboardList,
  FileStack,
  Layers,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Unlink,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "./api";
import { errMessage, type User } from "./contrack-types";
import { adminApi } from "@/lib/admin-api";
import type { PaymentTemplateDTO } from "@/lib/admin-types";
import { formatKWD } from "@/lib/format";

// ===== أنواع الـAPI =====
/** صف نوع عقد من GET /api/contract-types */
interface TspType {
  id: number;
  name: string;
  category?: string;
  defaultAmount?: number;
  notes?: string;
  active?: boolean;
  manualTrack?: boolean;
  pricingMode?: string;
  isSupervision?: boolean;
  contractsCount?: number;
  templatesCount?: number;
}
/** صف مرحلة خام من GET /api/workflow-stages (شجرة كل المعاملات — تُصفّى هنا) */
interface TspStage {
  id: number;
  transactionType: string;
  stageName: string;
  stageOrder: number;
  contractType?: string;
  parentId?: number | null;
  expectedDays?: number;
  paymentPct?: number | string;
  payKind?: string;
}
interface TspStageRef { stageId: number; stageName: string }

const payKindLabel: Record<string, string> = {
  advance: "مقدمة",
  achieve: "عند الإنجاز",
  final: "ختامية",
  days: "بالأيام",
};

function valueLabel(p: PaymentTemplateDTO): string {
  if (p.kind === "pct") return `${Number(p.pct)}%`;
  if (p.kind === "fixed") return formatKWD(p.amountFixed);
  return "مرن — 0";
}

const kindBadgeCls: Record<PaymentTemplateDTO["kind"], string> = {
  pct: "bg-status-info-bg text-status-info",
  fixed: "bg-secondary text-secondary-foreground",
  flex: "bg-muted text-muted-foreground",
};

interface TypesStagesPaymentsViewProps {
  user: User;
  onAuthError: () => void;
  /** مُمرَّر من RefListsView لتوحيد التوست */
  onFailToast?: (e: unknown, title: string) => void;
}

export function TypesStagesPaymentsView({ user, onAuthError, onFailToast }: TypesStagesPaymentsViewProps) {
  const { toast } = useToast();
  const manager = user.role === "admin" || user.role === "developer";

  const onFail = React.useCallback(
    (e: unknown, title: string) => {
      if (onFailToast) {
        onFailToast(e, title);
        return;
      }
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title, description: errMessage(e) });
    },
    [onAuthError, onFailToast, toast]
  );

  // ===== البيانات =====
  const typesQuery = useQuery<{ types: TspType[] }>({
    queryKey: ["contract-types"],
    queryFn: () => apiGet<{ types: TspType[] }>("/api/contract-types"),
  });
  const stagesQuery = useQuery<{ stages: TspStage[] }>({
    queryKey: ["workflow-stages"],
    queryFn: () => apiGet<{ stages: TspStage[] }>("/api/workflow-stages"),
  });

  const types = typesQuery.data?.types ?? [];
  const [selectedTypeId, setSelectedTypeId] = React.useState<number | null>(null);
  const selectedType = React.useMemo(
    () => types.find((t) => t.id === selectedTypeId) ?? types[0] ?? null,
    [types, selectedTypeId]
  );

  // مراحل النوع المحدد — العقد فقط (transactionType=contract) المطابقة بالاسم
  const typeStages = React.useMemo(() => {
    const all = stagesQuery.data?.stages ?? [];
    if (!selectedType) return [];
    return all
      .filter((s) => s.transactionType === "contract" && s.contractType === selectedType.name)
      .sort((a, b) => a.stageOrder - b.stageOrder || a.id - b.id);
  }, [stagesQuery.data?.stages, selectedType]);

  const mains = React.useMemo(() => typeStages.filter((s) => !s.parentId), [typeStages]);
  const childrenOf = React.useCallback(
    (parentId: number) => typeStages.filter((s) => s.parentId === parentId),
    [typeStages]
  );
  /** مراحل قابلة للربط بدفعة = بلا أبناء (خطوات التنفيذ الفعلية) */
  const isLeaf = React.useCallback(
    (stage: TspStage) => !typeStages.some((s) => s.parentId === stage.id),
    [typeStages]
  );

  // ===== اختيار المرحلة — المفتاح لظهور عمود الدفعة =====
  const [selectedStageId, setSelectedStageId] = React.useState<number | null>(null);
  React.useEffect(() => {
    setSelectedStageId(null);
  }, [selectedType?.id]);
  const selectedStage = React.useMemo(
    () => typeStages.find((s) => s.id === selectedStageId) ?? null,
    [typeStages, selectedStageId]
  );

  // ===== قالب دفعات النوع — من مصدره الحقيقي =====
  const tplQuery = useQuery<{ contractType: string; templates: PaymentTemplateDTO[] }>({
    queryKey: ["payment-templates", selectedType?.name ?? ""],
    queryFn: () => adminApi.paymentTemplates(selectedType?.name ?? ""),
    enabled: Boolean(selectedType),
  });
  const payments = React.useMemo(
    () => tplQuery.data?.templates ?? [],
    [tplQuery.data?.templates]
  );
  /** خريطة مرحلة→دفعة: كل مرحلة تتبع دفعة واحدة بحد أقصى (قاعدة الخادم) */
  const stagePaymentMap = React.useMemo(() => {
    const map = new Map<number, PaymentTemplateDTO>();
    for (const p of payments) for (const l of p.stages) map.set(l.stageId, p);
    return map;
  }, [payments]);

  const linkedPayment = selectedStage ? stagePaymentMap.get(selectedStage.id) ?? null : null;
  const daysPayments = React.useMemo(() => payments.filter((p) => p.stages.length === 0), [payments]);
  const otherPayments = React.useMemo(
    () =>
      payments.filter(
        (p) =>
          p.stages.length > 0 &&
          (selectedStage ? p.stages.every((l) => l.stageId !== selectedStage.id) : true)
      ),
    [payments, selectedStage]
  );

  const qc = useQueryClient();
  const invalidateAll = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["contract-types"] });
    qc.invalidateQueries({ queryKey: ["workflow-stages"] });
    if (selectedType) qc.invalidateQueries({ queryKey: ["payment-templates", selectedType.name] });
  }, [qc, selectedType]);

  // ======================================================================
  // طفرات الكتابة — كلها عبر مسارات الإدارة القائمة (adminGuard خلفها)
  // ======================================================================

  // ---- نوع العقد ----
  const [typeDialog, setTypeDialog] = React.useState<{ mode: "add" | "edit" } | null>(null);
  const [typeName, setTypeName] = React.useState("");
  const [typeAmount, setTypeAmount] = React.useState("0");
  const [deleteType, setDeleteType] = React.useState<TspType | null>(null);

  const openTypeDialog = (mode: "add" | "edit") => {
    setTypeName(mode === "edit" && selectedType ? selectedType.name : "");
    setTypeAmount(mode === "edit" && selectedType ? String(selectedType.defaultAmount ?? 0) : "0");
    setTypeDialog({ mode });
  };

  const saveTypeMutation = useMutation({
    mutationFn: () => {
      const name = typeName.trim();
      if (!name) throw new Error("اسم النوع مطلوب");
      const amount = Number(typeAmount || 0);
      if (!Number.isFinite(amount) || amount < 0) throw new Error("المبلغ الافتراضي غير صالح");
      return typeDialog?.mode === "edit" && selectedType
        ? apiPatch(`/api/contract-types/${selectedType.id}`, { name, defaultAmount: amount })
        : apiPost("/api/contract-types", { name, defaultAmount: amount, pricingMode: "lump" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contract-types"] });
      setTypeDialog(null);
      toast({ title: typeDialog?.mode === "edit" ? "تم تعديل النوع" : "تمت إضافة النوع" });
    },
    onError: (e: unknown) => onFail(e, "تعذر حفظ النوع"),
  });

  const deleteTypeMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/contract-types/${id}`),
    onSuccess: () => {
      setDeleteType(null);
      setSelectedTypeId(null);
      qc.invalidateQueries({ queryKey: ["contract-types"] });
      toast({ title: "تم حذف النوع" });
    },
    onError: (e: unknown) => {
      setDeleteType(null);
      onFail(e, "تعذر حذف النوع");
    },
  });

  const toggleTypeMutation = useMutation({
    mutationFn: (t: TspType) => apiPatch(`/api/contract-types/${t.id}`, { active: !t.active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contract-types"] });
      toast({ title: "تم تحديث حالة النوع" });
    },
    onError: (e: unknown) => onFail(e, "تعذر تحديث النوع"),
  });

  // ---- مرحلة العمل ----
  const [stageDialog, setStageDialog] = React.useState<{ mode: "add" | "edit"; stage?: TspStage } | null>(null);
  const [stageName, setStageName] = React.useState("");
  const [stageDays, setStageDays] = React.useState("");
  const [stageParent, setStageParent] = React.useState<string>("none");
  const [deleteStage, setDeleteStage] = React.useState<TspStage | null>(null);

  const openStageDialog = (mode: "add" | "edit", stage?: TspStage) => {
    setStageName(mode === "edit" && stage ? stage.stageName : "");
    setStageDays(mode === "edit" && stage ? String(stage.expectedDays ?? 0) : "");
    setStageParent(mode === "edit" && stage?.parentId ? String(stage.parentId) : "none");
    setStageDialog({ mode, stage });
  };

  const saveStageMutation = useMutation({
    mutationFn: () => {
      const name = stageName.trim();
      if (!name) throw new Error("اسم المرحلة مطلوب");
      if (!selectedType) throw new Error("اختر نوع عقد أولًا");
      const days = stageDays === "" ? 0 : Math.max(0, Math.trunc(Number(stageDays)));
      if (!Number.isFinite(days)) throw new Error("الأيام المتوقعة غير صالحة");
      if (stageDialog?.mode === "edit" && stageDialog.stage) {
        return apiPatch(`/api/workflow-stages?id=${stageDialog.stage.id}`, {
          stageName: name,
          expectedDays: days,
        });
      }
      const nextOrder = typeStages.length > 0 ? Math.max(...typeStages.map((s) => s.stageOrder)) + 1 : 1;
      return apiPost("/api/workflow-stages", {
        transactionType: "contract",
        contractType: selectedType.name,
        stageName: name,
        expectedDays: days,
        stageOrder: nextOrder,
        parentId: stageParent !== "none" ? Number(stageParent) : null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow-stages"] });
      setStageDialog(null);
      toast({ title: stageDialog?.mode === "edit" ? "تم تعديل المرحلة" : "تمت إضافة المرحلة" });
    },
    onError: (e: unknown) => onFail(e, "تعذر حفظ المرحلة"),
  });

  const deleteStageMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/workflow-stages?id=${id}`),
    onSuccess: () => {
      setDeleteStage(null);
      setSelectedStageId(null);
      qc.invalidateQueries({ queryKey: ["workflow-stages"] });
      toast({ title: "تم حذف المرحلة" });
    },
    onError: (e: unknown) => {
      setDeleteStage(null);
      onFail(e, "تعذر حذف المرحلة");
    },
  });

  // ---- الدفعة المرتبطة ----
  const [payDialog, setPayDialog] = React.useState<{ mode: "add" | "edit"; payment?: PaymentTemplateDTO } | null>(null);
  const [payTitle, setPayTitle] = React.useState("");
  const [payMode, setPayMode] = React.useState<PaymentTemplateDTO["kind"]>("pct");
  const [payPct, setPayPct] = React.useState("");
  const [payFixed, setPayFixed] = React.useState("");
  const [payDays, setPayDays] = React.useState("");
  const [deletePayment, setDeletePayment] = React.useState<PaymentTemplateDTO | null>(null);

  const openPayDialog = (mode: "add" | "edit", payment?: PaymentTemplateDTO) => {
    setPayTitle(mode === "edit" && payment ? payment.title : "");
    setPayMode(mode === "edit" && payment ? payment.kind : "pct");
    setPayPct(mode === "edit" && payment ? String(Number(payment.pct) || "") : "");
    setPayFixed(mode === "edit" && payment ? String(Number(payment.amountFixed) || "") : "");
    setPayDays(mode === "edit" && payment && payment.daysOffset > 0 ? String(payment.daysOffset) : "");
    setPayDialog({ mode, payment });
  };

  const savePaymentMutation = useMutation({
    mutationFn: () => {
      const title = payTitle.trim();
      if (!title) throw new Error("اسم الدفعة مطلوب");
      const mode = payDialog?.mode;
      const valueMode = payMode;
      const pct = valueMode === "pct" ? Number(payPct || 0) : 0;
      const fixed = valueMode === "fixed" ? Number(payFixed || 0) : 0;
      if (valueMode === "pct" && !(pct > 0)) throw new Error("أدخل نسبة أكبر من صفر أو اختر نمطًا آخر");
      if (valueMode === "fixed" && !(fixed > 0)) throw new Error("أدخل مبلغًا أكبر من صفر أو اختر نمطًا آخر");
      if (!selectedType) throw new Error("اختر نوع عقد أولًا");
      const common = {
        title,
        valueMode,
        pct,
        amountFixed: fixed,
        ...(payDays !== "" ? { daysOffset: Math.max(0, Math.trunc(Number(payDays))) } : {}),
      };
      if (mode === "edit" && payDialog?.payment) {
        return apiPatch(`/api/payment-templates/${payDialog.payment.id}`, common);
      }
      if (!selectedStage) throw new Error("اختر مرحلة العمل أولًا");
      // دفعة جديدة مربوطة بالمرحلة المختارة مباشرة — مرحلة واحدة = هي المحفزة تلقائيًا (بالخادم)
      return apiPost("/api/payment-templates", {
        contractType: selectedType.name,
        stageIds: [selectedStage.id],
        ...common,
      });
    },
    onSuccess: () => {
      invalidateAll();
      setPayDialog(null);
      toast({
        title: payDialog?.mode === "edit" ? "تم تعديل الدفعة" : "أُضيفت الدفعة وارتبطت بالمرحلة",
      });
    },
    onError: (e: unknown) => onFail(e, "تعذر حفظ الدفعة"),
  });

  /** فك ربط المرحلة المختارة عن دفعتها — إعادة توجيه المحفِّز وفق القواعد الحرفية */
  const unlinkMutation = useMutation({
    mutationFn: (payment: PaymentTemplateDTO) => {
      if (!selectedStage) throw new Error("اختر المرحلة أولًا");
      const remaining = payment.stages
        .filter((s) => s.stageId !== selectedStage.id)
        .map((s) => s.stageId);
      const trigger = payment.triggerStageId;
      const triggerStageId =
        remaining.length > 1
          ? trigger != null && remaining.includes(trigger)
            ? trigger
            : remaining[0]
          : null; // 0 مرحلة = بالأيام بلا محفِّز · 1 مرحلة = الخادم يجعلها المحفِّزة تلقائيًا
      return apiPatch(`/api/payment-templates/${payment.id}`, {
        stageIds: remaining,
        triggerStageId,
      });
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "تم فك ربط المرحلة عن الدفعة" });
    },
    onError: (e: unknown) => onFail(e, "تعذر فك الربط"),
  });

  /** ربط دفعة قائمة (بالأيام بلا مراحل) بالمرحلة المختارة */
  const linkDaysMutation = useMutation({
    mutationFn: ({ payment, stageId }: { payment: PaymentTemplateDTO; stageId: number }) =>
      apiPatch(`/api/payment-templates/${payment.id}`, { stageIds: [stageId] }),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "تم ربط الدفعة بالمرحلة — وهي المحفِّزة تلقائيًا" });
    },
    onError: (e: unknown) => onFail(e, "تعذر ربط الدفعة"),
  });

  const deletePaymentMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/payment-templates/${id}`),
    onSuccess: () => {
      setDeletePayment(null);
      invalidateAll();
      toast({ title: "تم حذف الدفعة من القالب" });
    },
    onError: (e: unknown) => {
      setDeletePayment(null);
      onFail(e, "تعذر حذف الدفعة");
    },
  });

  // ======================================================================
  // العرض
  // ======================================================================

  const renderStageRow = (stage: TspStage, isChild: boolean) => {
    const selected = selectedStageId === stage.id;
    const linked = stagePaymentMap.get(stage.id);
    const leaf = isLeaf(stage);
    return (
      <li key={stage.id}>
        <div
          role="button"
          tabIndex={0}
          aria-pressed={selected}
          aria-label={`اختيار المرحلة ${stage.stageName}`}
          onClick={() => setSelectedStageId(stage.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setSelectedStageId(stage.id);
            }
          }}
          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start transition-colors cursor-pointer border ${
            selected
              ? "border-primary/50 bg-primary/10"
              : "border-transparent hover:bg-muted/60"
          } ${isChild ? "ms-5 border-s ps-3" : ""}`}
        >
          <span
            className={`numeric size-6 shrink-0 rounded-full text-[11px] font-bold flex items-center justify-center ${
              selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {stage.stageOrder}
          </span>
          <span className={`min-w-0 flex-1 truncate text-sm ${isChild ? "" : "font-semibold"}`}>
            {stage.stageName}
          </span>
          {linked && (
            <Badge className="border-0 bg-status-done-bg text-status-done text-[10px] shrink-0">
              <BadgeDollarSign className="size-3" aria-hidden />
              دفعة
            </Badge>
          )}
          {(stage.expectedDays ?? 0) > 0 && (
            <span className="numeric text-[11px] text-muted-foreground shrink-0">
              {stage.expectedDays} يومًا
            </span>
          )}
          {manager && (
            <span className="flex shrink-0 items-center gap-0.5">
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={`تعديل المرحلة ${stage.stageName}`}
                onClick={(e) => {
                  e.stopPropagation();
                  openStageDialog("edit", stage);
                }}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 text-destructive hover:text-destructive"
                aria-label={`حذف المرحلة ${stage.stageName}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteStage(stage);
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </span>
          )}
        </div>
        {!leaf && childrenOf(stage.id).length > 0 && (
          <ul className="mt-1 space-y-1">
            {childrenOf(stage.id).map((c) => renderStageRow(c, true))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold whitespace-nowrap">الأنواع والمراحل والدفعات</h1>
        <span className="hidden xl:inline text-xs text-muted-foreground">
          اختر نوع العقد ← ستظهر مراحله ← اختر مرحلة فتظهر الدفعة المرتبطة بها
        </span>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,250px)_minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* ============ العمود 1: أنواع العقود ============ */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <FileStack className="size-4 text-primary" aria-hidden />
              أنواع العقود
            </CardTitle>
            {manager && (
              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => openTypeDialog("add")}>
                <Plus className="size-3.5" aria-hidden />
                إضافة
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {typesQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded-lg" />
                ))}
              </div>
            ) : typesQuery.isError ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                تعذر تحميل الأنواع — {errMessage(typesQuery.error)}
              </p>
            ) : types.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                لا أنواع عقود بعد{manager ? " — أضف أول نوع بالزر أعلى" : ""}
              </p>
            ) : (
              <>
                <ul className="max-h-96 space-y-1.5 overflow-y-auto pe-1" aria-label="قائمة أنواع العقود">
                  {types.map((t) => {
                    const selected = selectedType?.id === t.id;
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedTypeId(t.id)}
                          aria-pressed={selected}
                          className={`flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-start transition-colors ${
                            selected ? "border-primary/60 bg-primary/10" : "hover:bg-muted/60"
                          }`}
                        >
                          <span className="flex w-full items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={t.name}>
                              {t.name}
                            </span>
                            {!t.active && <Badge variant="secondary" className="text-[10px]">معطّل</Badge>}
                            {t.isSupervision && (
                              <Badge variant="outline" className="text-[10px] shrink-0">إشراف</Badge>
                            )}
                          </span>
                          <span className="flex w-full items-center gap-2 text-[11px] text-muted-foreground">
                            {t.category ? <span className="truncate">{t.category}</span> : null}
                            <span className="numeric ms-auto">
                              {t.contractsCount ?? 0} عقد · {t.templatesCount ?? 0} دفعة
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {manager && selectedType && (
                  <div className="flex items-center gap-1.5 border-t pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 flex-1 gap-1 text-xs"
                      onClick={() => openTypeDialog("edit")}
                    >
                      <Pencil className="size-3.5" aria-hidden />
                      تعديل النوع
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 text-xs"
                      disabled={toggleTypeMutation.isPending}
                      onClick={() => toggleTypeMutation.mutate(selectedType)}
                    >
                      {selectedType.active ? "تعطيل" : "تفعيل"}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-destructive hover:text-destructive"
                      aria-label={`حذف النوع ${selectedType.name}`}
                      onClick={() => setDeleteType(selectedType)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* ============ العمود 2: مراحل العمل للنوع المحدد ============ */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <ClipboardList className="size-4 text-primary" aria-hidden />
              مراحل العمل
              {selectedType && (
                <span className="truncate font-normal text-muted-foreground" title={selectedType.name}>
                  — {selectedType.name}
                </span>
              )}
            </CardTitle>
            {manager && selectedType && (
              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => openStageDialog("add")}>
                <Plus className="size-3.5" aria-hidden />
                مرحلة
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {!selectedType ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                اختر نوع عقد من العمود الأول لعرض مراحله
              </p>
            ) : stagesQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-11 rounded-lg" />
                ))}
              </div>
            ) : stagesQuery.isError ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                تعذر تحميل المراحل — {errMessage(stagesQuery.error)}
              </p>
            ) : typeStages.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                لا مراحل عمل لنوع «{selectedType.name}» بعد{manager ? " — أضف أول مرحلة بالزر أعلى" : ""}
              </p>
            ) : (
              <ul className="max-h-[420px] space-y-1 overflow-y-auto pe-1" aria-label="شجرة مراحل العمل">
                {mains.map((m) => renderStageRow(m, false))}
              </ul>
            )}
            {typeStages.length > 0 && (
              <p className="mt-2 border-t pt-2 text-[11px] text-muted-foreground">
                المرحلة المختارة: {selectedStage ? selectedStage.stageName : "لم تُختر بعد"} — الشارة «دفعة» تعني وجود دفعة مربوطة
              </p>
            )}
          </CardContent>
        </Card>

        {/* ============ العمود 3: الدفعة المرتبطة بالمرحلة المختارة ============ */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <BadgeDollarSign className="size-4 text-primary" aria-hidden />
              الدفعة المرتبطة
              {selectedStage && (
                <span className="truncate font-normal text-muted-foreground">— مرحلة {selectedStage.stageName}</span>
              )}
            </CardTitle>
            {manager && selectedStage && !linkedPayment && (
              <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => openPayDialog("add")}>
                <Link2 className="size-3.5" aria-hidden />
                ربط دفعة بهذه المرحلة
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {!selectedStage ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                اختر مرحلة من عمود «مراحل العمل» لتظهر الدفعة المرتبطة بها
              </p>
            ) : tplQuery.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-20 rounded-lg" />
              </div>
            ) : tplQuery.isError ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                تعذر تحميل قالب الدفعات — {errMessage(tplQuery.error)}
              </p>
            ) : linkedPayment ? (
              <PaymentCard
                payment={linkedPayment}
                selectedStageId={selectedStage.id}
                manager={manager}
                onEdit={() => openPayDialog("edit", linkedPayment)}
                onUnlink={() => unlinkMutation.mutate(linkedPayment)}
                unlinkPending={unlinkMutation.isPending}
                onDelete={() => setDeletePayment(linkedPayment)}
              />
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                لا توجد دفعة مربوطة بهذه المرحلة
                {manager ? " — اربط دفعة جديدة من الزر أعلى" : ""}
              </p>
            )}

            {/* بقية دفعات القالب — سياق كامل للنوع */}
            {(otherPayments.length > 0 || daysPayments.length > 0) && (
              <div className="space-y-2 border-t pt-3">
                <p className="text-xs font-bold text-muted-foreground">
                  بقية دفعات قالب «{selectedType?.name}»
                </p>
                <div className="max-h-52 space-y-1.5 overflow-y-auto pe-1">
                  {otherPayments.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2.5 py-1.5">
                      <span className="numeric size-5 shrink-0 rounded-full bg-secondary text-[10px] font-bold text-secondary-foreground flex items-center justify-center">
                        {p.payNo}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold" title={p.title}>
                        {p.title}
                      </span>
                      <span className="numeric text-[11px] text-muted-foreground shrink-0" dir="ltr">
                        {valueLabel(p)}
                      </span>
                      <span className="hidden truncate text-[11px] text-muted-foreground sm:inline max-w-36">
                        {p.stages.map((s) => s.stageName).join("، ")}
                      </span>
                    </div>
                  ))}
                  {daysPayments.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 rounded-lg border border-dashed px-2.5 py-1.5">
                      <span className="numeric size-5 shrink-0 rounded-full bg-secondary text-[10px] font-bold text-secondary-foreground flex items-center justify-center">
                        {p.payNo}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold" title={p.title}>
                        {p.title}
                      </span>
                      <Badge variant="secondary" className="text-[10px] shrink-0">بالأيام — بلا مراحل</Badge>
                      {manager && selectedStage && isLeaf(selectedStage) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0 gap-1 px-2 text-[11px]"
                          disabled={linkDaysMutation.isPending}
                          onClick={() => linkDaysMutation.mutate({ payment: p, stageId: selectedStage.id })}
                        >
                          <Link2 className="size-3" aria-hidden />
                          ربط بالمرحلة
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ================== نوافذ نوع العقد ================== */}
      <Dialog open={typeDialog !== null} onOpenChange={(o) => !o && setTypeDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{typeDialog?.mode === "edit" ? "تعديل نوع العقد" : "إضافة نوع عقد"}</DialogTitle>
            <DialogDescription>
              بعد التعريف تُربط مراحله ودفعاته من الأعمدة المجاورة في هذه الصفحة نفسها.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="tsp-type-name">اسم النوع</Label>
              <Input
                id="tsp-type-name"
                className="h-10"
                placeholder="مثال: بناء فيلا"
                value={typeName}
                onChange={(e) => setTypeName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tsp-type-amount">المبلغ الافتراضي (د.ك)</Label>
              <Input
                id="tsp-type-amount"
                type="number"
                min="0"
                step="0.001"
                dir="ltr"
                className="h-10 numeric text-start"
                value={typeAmount}
                onChange={(e) => setTypeAmount(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-10" onClick={() => setTypeDialog(null)} disabled={saveTypeMutation.isPending}>
              إلغاء
            </Button>
            <Button className="h-10" disabled={saveTypeMutation.isPending} onClick={() => saveTypeMutation.mutate()}>
              {saveTypeMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteType !== null} onOpenChange={(o) => !o && setDeleteType(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>حذف نوع العقد</DialogTitle>
            <DialogDescription>
              حذف النوع «{deleteType?.name}»؟ لا يمكن الحذف إن كانت له عقود مسجلة.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-10" onClick={() => setDeleteType(null)}>إلغاء</Button>
            <Button
              variant="destructive"
              className="h-10"
              disabled={deleteTypeMutation.isPending}
              onClick={() => deleteType && deleteTypeMutation.mutate(deleteType.id)}
            >
              {deleteTypeMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================== نوافذ مرحلة العمل ================== */}
      <Dialog open={stageDialog !== null} onOpenChange={(o) => !o && setStageDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{stageDialog?.mode === "edit" ? "تعديل مرحلة" : "إضافة مرحلة عمل"}</DialogTitle>
            <DialogDescription>
              للنوع «{selectedType?.name}» — المرحلة الفرعية (خطوة التنفيذ) هي القابلة للربط بدفعة.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="tsp-stage-name">اسم المرحلة</Label>
              <Input
                id="tsp-stage-name"
                className="h-10"
                placeholder="مثال: صب الأساسات"
                value={stageName}
                onChange={(e) => setStageName(e.target.value)}
              />
            </div>
            {stageDialog?.mode === "add" && mains.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="tsp-stage-parent">مرتبطة بمرحلة رئيسية (اختياري)</Label>
                <Select value={stageParent} onValueChange={setStageParent}>
                  <SelectTrigger id="tsp-stage-parent" className="h-10 w-full">
                    <SelectValue placeholder="رئيسية بلا أب" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    <SelectItem value="none">رئيسية بلا أب</SelectItem>
                    {mains.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.stageName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="tsp-stage-days">الأيام المتوقعة (اختياري)</Label>
              <Input
                id="tsp-stage-days"
                type="number"
                min="0"
                dir="ltr"
                className="h-10 numeric text-start"
                value={stageDays}
                onChange={(e) => setStageDays(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-10" onClick={() => setStageDialog(null)} disabled={saveStageMutation.isPending}>
              إلغاء
            </Button>
            <Button className="h-10" disabled={saveStageMutation.isPending} onClick={() => saveStageMutation.mutate()}>
              {saveStageMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteStage !== null} onOpenChange={(o) => !o && setDeleteStage(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>حذف مرحلة العمل</DialogTitle>
            <DialogDescription>
              حذف المرحلة «{deleteStage?.stageName}»؟ لا يمكن الحذف إن كان لها مراحل فرعية أو دفعة مربوطة.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-10" onClick={() => setDeleteStage(null)}>إلغاء</Button>
            <Button
              variant="destructive"
              className="h-10"
              disabled={deleteStageMutation.isPending}
              onClick={() => deleteStage && deleteStageMutation.mutate(deleteStage.id)}
            >
              {deleteStageMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================== نوافذ الدفعة ================== */}
      <Dialog open={payDialog !== null} onOpenChange={(o) => !o && setPayDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {payDialog?.mode === "edit" ? `تعديل الدفعة #${payDialog.payment?.payNo}` : "دفعة جديدة مرتبطة بالمرحلة"}
            </DialogTitle>
            <DialogDescription>
              {payDialog?.mode === "edit"
                ? `الدفعة «${payDialog.payment?.title}» من قالب «${selectedType?.name}» — مراحلها تُدار من الشاشة نفسها (ربط/فك ربط).`
                : `ستُربط بالمرحلة «${selectedStage?.stageName}» مباشرة — ومرحلة واحدة هي المحفِّزة تلقائيًا.`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="tsp-pay-title">اسم الدفعة</Label>
              <Input
                id="tsp-pay-title"
                className="h-10"
                placeholder="مثال: الدفعة الثانية"
                value={payTitle}
                onChange={(e) => setPayTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>نمط القيمة</Label>
              <div className="grid grid-cols-3 gap-2">
                {(["pct", "fixed", "flex"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPayMode(m)}
                    aria-pressed={payMode === m}
                    className={`h-10 rounded-lg border text-sm font-semibold transition-colors ${
                      payMode === m ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted/60"
                    }`}
                  >
                    {m === "pct" ? "نسبة %" : m === "fixed" ? "مبلغ ثابت" : "مرن (0)"}
                  </button>
                ))}
              </div>
            </div>
            {payMode === "pct" && (
              <div className="space-y-1.5">
                <Label htmlFor="tsp-pay-pct">النسبة من قيمة العقد</Label>
                <Input
                  id="tsp-pay-pct"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  dir="ltr"
                  className="h-10 numeric text-start"
                  value={payPct}
                  onChange={(e) => setPayPct(e.target.value)}
                />
              </div>
            )}
            {payMode === "fixed" && (
              <div className="space-y-1.5">
                <Label htmlFor="tsp-pay-fixed">المبلغ الثابت (د.ك)</Label>
                <Input
                  id="tsp-pay-fixed"
                  type="number"
                  min="0"
                  step="0.001"
                  dir="ltr"
                  className="h-10 numeric text-start"
                  value={payFixed}
                  onChange={(e) => setPayFixed(e.target.value)}
                />
              </div>
            )}
            {payMode === "flex" && (
              <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                الدفعة المرنة تُدرج بقيمة 0 ويُعبأ مبلغها عند إنشاء دفعات العقود.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="tsp-pay-days">أيام بعد المرحلة (اختياري)</Label>
              <Input
                id="tsp-pay-days"
                type="number"
                min="0"
                dir="ltr"
                className="h-10 numeric text-start"
                value={payDays}
                onChange={(e) => setPayDays(e.target.value)}
                placeholder="افتراضي: أيام المرحلة المحفزة"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-10" onClick={() => setPayDialog(null)} disabled={savePaymentMutation.isPending}>
              إلغاء
            </Button>
            <Button className="h-10" disabled={savePaymentMutation.isPending} onClick={() => savePaymentMutation.mutate()}>
              {savePaymentMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              {payDialog?.mode === "edit" ? "حفظ التعديلات" : "إضافة وربط"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deletePayment !== null} onOpenChange={(o) => !o && setDeletePayment(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>حذف الدفعة من القالب</DialogTitle>
            <DialogDescription>
              حذف الدفعة «{deletePayment?.title}» مع روابط مراحلها؟ العقود القائمة تحتفظ بلقطتها ولا تتأثر.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-10" onClick={() => setDeletePayment(null)}>إلغاء</Button>
            <Button
              variant="destructive"
              className="h-10"
              disabled={deletePaymentMutation.isPending}
              onClick={() => deletePayment && deletePaymentMutation.mutate(deletePayment.id)}
            >
              {deletePaymentMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ====================================================================
// بطاقة الدفعة المرتبطة بالمرحلة المختارة
// ====================================================================
function PaymentCard({
  payment,
  selectedStageId,
  manager,
  onEdit,
  onUnlink,
  unlinkPending,
  onDelete,
}: {
  payment: PaymentTemplateDTO;
  selectedStageId: number;
  manager: boolean;
  onEdit: () => void;
  onUnlink: () => void;
  unlinkPending: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border-2 border-primary/30 bg-primary/5 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="numeric size-6 shrink-0 rounded-full bg-primary text-[11px] font-bold text-primary-foreground flex items-center justify-center">
              {payment.payNo}
            </span>
            <span className="font-bold text-sm">{payment.title}</span>
            <Badge className={`border-0 text-[10px] ${kindBadgeCls[payment.kind]}`}>
              {payment.kind === "pct" ? "نسبة" : payment.kind === "fixed" ? "ثابتة" : "مرنة"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            القيمة: <span className="numeric font-bold text-foreground" dir="ltr">{valueLabel(payment)}</span>
            {payment.daysOffset > 0 && (
              <> · تستحق بعد <span className="numeric">{payment.daysOffset}</span> يومًا من المحفِّز</>
            )}
            {payment.triggerStageName && <> · المحفِّزة: «{payment.triggerStageName}»</>}
          </p>
        </div>
        <span className="numeric shrink-0 text-sm font-bold" dir="ltr">{valueLabel(payment)}</span>
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-semibold text-muted-foreground">مراحل الدفعة</p>
        <div className="flex flex-wrap gap-1.5">
          {payment.stages.map((s) => (
            <Badge
              key={s.stageId}
              variant={s.stageId === selectedStageId ? "default" : "outline"}
              className="text-[11px] font-normal"
            >
              {s.stageId === selectedStageId ? "◀ " : ""}
              {s.stageName}
            </Badge>
          ))}
        </div>
      </div>

      {manager && (
        <div className="flex flex-wrap items-center gap-1.5 border-t pt-2">
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={onEdit}>
            <Pencil className="size-3.5" aria-hidden />
            تعديل الدفعة
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={unlinkPending}
            onClick={onUnlink}
            title="إزالة المرحلة المختارة من مراحل الدفعة"
          >
            {unlinkPending ? <Loader2 className="size-3.5 animate-spin" /> : <Unlink className="size-3.5" aria-hidden />}
            فك ربط هذه المرحلة
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" aria-hidden />
            حذف الدفعة
          </Button>
        </div>
      )}
    </div>
  );
}
