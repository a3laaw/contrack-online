"use client";

/**
 * «عقد جديد» — صفحة كاملة (بدل نافذة المعالج ثلاثية الخطوات السابقة في ContractsView):
 * نفس الحقول كلها ونفس الخطوات الثلاث والتحقق والـpayload والـinvalidations والـtoasts حرفيًا.
 * الخطوات بقيت خطوات داخل الصفحة (مؤشر + تنقل السابق/التالي) بلا نوافذ،
 * والشريط السفلي sticky: زر أساسي واحد (التالي / إنشاء العقد) + إلغاء outline.
 * بلا مسار جديد — تُعرض مكان شاشة العقود (استبدال في نفس المستوى).
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, ChevronLeft, ChevronRight, Layers, ListTree, Plus, Trash2 } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPost } from "./api";
import { useFeatureFlags } from "./FeatureFlagsProvider";
import { SearchableSelect } from "./SearchableSelect";
import type { ContractTypesResponse, CustomersResponse } from "./contrack-types";
import { errMessage } from "./contrack-types";
import { amountGuardProblems, type AmountGuardProblem } from "@/lib/contract-create";

interface ContractNewPageProps {
  onAuthError: () => void;
  /** عميل محدد مسبقًا عند القدوم من شاشة العملاء (نفس presetCustomerId السابق) */
  presetCustomerId?: number | null;
  /** بعد نجاح الإنشاء — تُغلق الصفحة من الشاشة المستدعية */
  onSaved?: () => void;
  /** العودة لقائمة العقود */
  onCancel: () => void;
  /** فتح شاشة العقد المنشأ (كما كان بعد إنشاء النافذة) */
  onOpenContract: (id: number) => void;
}

interface StageDraft {
  name: string;
  expectedDays: string;
  payPct: string;
  /** 1 = تصنيف رئيسي · 2 = فرعية تابعة لأقرب رئيسية قبلها */
  level: number;
}

/** صف شجرة مراحل النوع — GET /api/workflow-stages */
interface WorkflowStageLite {
  id: number;
  stageName: string;
  stageOrder: number;
  parentId: number | null;
  expectedDays: number;
  payPct: number;
  contractType: string;
  transactionType: string;
}

interface PaymentDraft {
  title: string;
  amount: string;
  dueDate: string;
}

export function ContractNewPage({
  onAuthError,
  presetCustomerId,
  onSaved,
  onCancel,
  onOpenContract,
}: ContractNewPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [step, setStep] = React.useState(1);
  // المرحلة 3/ج: مفاتيح amount_guard وtemplate_plan_mode (كالمكتبي)
  const { enabled: flagOn } = useFeatureFlags();

  const typesQuery = useQuery<ContractTypesResponse>({
    queryKey: ["contract-types"],
    queryFn: () => apiGet<ContractTypesResponse>("/api/contract-types"),
  });
  const customersQuery = useQuery<CustomersResponse>({
    queryKey: ["customers", ""],
    queryFn: () => apiGet<CustomersResponse>("/api/customers"),
  });

  // الصفحة تُركَّب عند الفتح فقط — التهيئة مباشرة (العميل المحدد مسبقًا يُملأ هنا)
  const [fCustomerId, setFCustomerId] = React.useState(
    presetCustomerId ? String(presetCustomerId) : ""
  );
  const [fName, setFName] = React.useState("");
  const [fTypeId, setFTypeId] = React.useState("");
  const [fAmount, setFAmount] = React.useState("");
  const [fDate, setFDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [fDescription, setFDescription] = React.useState("");
  const [stages, setStages] = React.useState<StageDraft[]>([]);
  const [payments, setPayments] = React.useState<PaymentDraft[]>([]);

  // ===== شجرة مراحل النوع (Task 82) — تنزل للعقد كتصنيفات رئيسية وفرعياتها =====
  const selectedTypeName = fTypeId
    ? typesQuery.data?.types.find((t) => String(t.id) === fTypeId)?.name || ""
    : "";
  const wfTreeQuery = useQuery<{ stages: WorkflowStageLite[] }>({
    queryKey: ["workflow-stages", "tree"],
    queryFn: () => apiGet<{ stages: WorkflowStageLite[] }>("/api/workflow-stages"),
    enabled: Boolean(selectedTypeName),
  });
  const typeTree = React.useMemo(() => {
    const rows = (wfTreeQuery.data?.stages ?? [])
      .filter((s) => s.transactionType === "contract" && s.contractType === selectedTypeName)
      .sort((a, b) => a.stageOrder - b.stageOrder || a.id - b.id);
    // الرئيسيات (بلا أب) أولًا بترتيبها، وتحتها فرعياتها — مطابق لترتيب الشجرة
    const parents = rows.filter((s) => !s.parentId);
    const byParent = new Map<number, WorkflowStageLite[]>();
    for (const s of rows) if (s.parentId) {
      const arr = byParent.get(s.parentId) ?? [];
      arr.push(s);
      byParent.set(s.parentId, arr);
    }
    const flat: { name: string; expectedDays: string; payPct: string; level: number }[] = [];
    for (const p of parents) {
      flat.push({ name: p.stageName, expectedDays: String(p.expectedDays || 0), payPct: String(Number(p.payPct) || 0), level: 1 });
      for (const c of byParent.get(p.id) ?? []) {
        flat.push({ name: c.stageName, expectedDays: String(c.expectedDays || 0), payPct: String(Number(c.payPct) || 0), level: 2 });
      }
    }
    return flat;
  }, [wfTreeQuery.data, selectedTypeName]);
  const [importConfirm, setImportConfirm] = React.useState(false);
  const importTree = () => {
    setStages(typeTree.map((s) => ({ ...s })));
    setImportConfirm(false);
    toast({
      title: "تم استيراد شجرة النوع",
      description: `نُزّلت ${typeTree.filter((s) => s.level === 1).length} تصنيفًا و${typeTree.filter((s) => s.level === 2).length} مرحلة فرعية — عدّلها أو احذف ما لا يلزم قبل الحفظ.`,
    });
  };

  // ===== نفس إنشاء النافذة السابقة حرفيًا (نفس الـpayload والـinvalidations والـtoasts) =====
  // المرحلة 3/ج: body.amountPolicy يُرسل فقط عند فرق المبلغ مع ميزة amount_guard مفعّلة
  const createMutation = useMutation({
    mutationFn: async (amountPolicy?: string) => {
      const typeName = fTypeId
        ? typesQuery.data?.types.find((t) => String(t.id) === fTypeId)?.name
        : undefined;
      const body: Record<string, unknown> = {
        customerId: Number(fCustomerId),
        contractName: fName.trim(),
        contractType: typeName || "غير محدد",
        amount: Number(fAmount || 0),
        contractDate: fDate,
        description: fDescription.trim(),
        stages: stages
          .filter((s) => s.name.trim())
          .map((s, i, arr) => {
            // parentName = أقرب تصنيف رئيسي قبلها (الاقتران بالترتيب — مطابق للعرض)
            let parentName = "";
            for (let j = i - 1; j >= 0; j--) {
              if (arr[j].level === 1 && arr[j].name.trim()) {
                parentName = arr[j].name.trim();
                break;
              }
            }
            return {
              name: s.name.trim(),
              expectedDays: Number(s.expectedDays || 0),
              payPct: Number(s.payPct || 0),
              level: s.level === 2 ? 2 : 1,
              parentName: s.level === 2 ? parentName : "",
              sortOrder: i,
            };
          }),
        plan: payments
          .filter((p) => p.title.trim() && Number(p.amount) > 0)
          .map((p, i) => ({
            title: p.title.trim(),
            amount: Number(p.amount),
            dueDate: p.dueDate,
            sortOrder: i,
          })),
      };
      if (amountPolicy) body.amountPolicy = amountPolicy;
      return apiPost<{ contract: { id: number; contractNumber: string } }>("/api/contracts", body);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["contracts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast({
        title: "تم إنشاء العقد",
        description: `رقم العقد ${res.contract.contractNumber}`,
      });
      onSaved?.();
      onOpenContract(res.contract.id);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر إنشاء العقد", description: errMessage(e) });
    },
  });

  // ===== حارس المبلغ amount_guard — مطابقة المكتبي (contracts.py) =====
  // معطّلة ⇒ منع صارم برسالة الأصل الحرفية · مفعّلة ⇒ حوار الخيارات الثلاثة
  const [guardBox, setGuardBox] = React.useState<{
    amount: number;
    planTotal: number;
    problems: AmountGuardProblem[];
  } | null>(null);

  const fmtK = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  const submitCreate = () => {
    if (!fCustomerId) {
      toast({ variant: "destructive", title: "بيانات ناقصة", description: "اختر العميل أولًا" });
      setStep(1);
      return;
    }
    if (!(Number(fAmount) > 0)) {
      toast({ variant: "destructive", title: "بيانات ناقصة", description: "أدخل مبلغ العقد" });
      setStep(1);
      return;
    }
    const planList = payments.filter((p) => p.title.trim() && Number(p.amount) > 0);
    const amount = Number(fAmount || 0);
    const planTotal = planList.reduce((s, p) => s + Number(p.amount || 0), 0);
    const problems = amountGuardProblems(amount, planList.length ? planTotal : null);
    if (problems.length) {
      if (!flagOn("amount_guard")) {
        // المنع الصارم — رسالة الأصل الحرفية
        toast({
          variant: "destructive",
          title: "تعذر إنشاء العقد",
          description: problems
            .map((p) => `${p.label}: ${fmtK(p.total)} د.ك (الفرق ${fmtK(p.total - amount)})`)
            .join("\n") + "\n\nعدّل القيم حتى تتساوى قبل الحفظ.",
          className: "whitespace-pre-line text-right",
        });
        return;
      }
      setGuardBox({ amount, planTotal, problems });
      return;
    }
    createMutation.mutate(undefined);
  };

  const guardCreate = (policy: string) => {
    setGuardBox(null);
    createMutation.mutate(policy);
  };

  // ===== وضع القالب template_plan_mode — مطابقة المكتبي (contracts.py:947) =====
  // نوع له دفعات قالب + الميزة مفعّلة ⇒ وضع القالب (الإضافة اليدوية معطّلة والخطة تُولّد من القالب)
  const selectedType = typesQuery.data?.types.find((t) => String(t.id) === fTypeId);
  const hasTpl = Boolean(
    selectedType && (selectedType.templatesCount ?? 0) > 0 && flagOn("template_plan_mode")
  );

  return (
    <div className="space-y-4">
      {/* ===== رأس الصفحة ===== */}
      <div>
        <p className="text-xs text-muted-foreground">العملاء والعقود ← العقود</p>
        <h1 className="text-xl font-bold">عقد جديد</h1>
        <p className="text-sm text-muted-foreground">
          الخطوة {step} من 3 —{" "}
          {step === 1 ? "بيانات العقد الأساسية" : step === 2 ? "المراحل (اختياري)" : "الدفعات (اختياري)"}
        </p>
      </div>

      {/* مؤشر الخطوات */}
      <div className="flex items-center gap-1.5">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className={`h-1.5 flex-1 rounded-full ${n <= step ? "bg-primary" : "bg-muted"}`}
          />
        ))}
      </div>

      {/* ===== الخطوة 1 — بيانات العقد الأساسية ===== */}
      {step === 1 && (
        <Card>
          <CardContent className="p-4 md:p-6">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                <Label htmlFor="ct-name" className="text-xs">
                  اسم العقد
                </Label>
                <Input
                  id="ct-name"
                  className="h-9"
                  value={fName}
                  onChange={(e) => setFName(e.target.value)}
                  placeholder="مثال: تأسيس فيلا — قطعة 123"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                <Label className="text-xs">العميل *</Label>
                <SearchableSelect
                  value={fCustomerId}
                  onValueChange={setFCustomerId}
                  options={(customersQuery.data?.customers ?? []).map((c) => ({
                    value: String(c.id),
                    label: `${c.name} (${c.customerCode})`,
                  }))}
                  placeholder="اختر العميل"
                  searchPlaceholder="ابحث بالاسم أو الكود…"
                  emptyText="لا نتائج مطابقة"
                  loading={customersQuery.isLoading}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">نوع العقد</Label>
                <Select value={fTypeId} onValueChange={(v) => {
                  setFTypeId(v);
                  const t = typesQuery.data?.types.find((x) => String(x.id) === v);
                  if (t && t.defaultAmount && Number(t.defaultAmount) > 0 && !fAmount) {
                    setFAmount(String(Number(t.defaultAmount)));
                  }
                }}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="اختر النوع" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {(typesQuery.data?.types ?? []).filter((t) => t.active !== false).map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-amount" className="text-xs">
                  المبلغ (د.ك) *
                </Label>
                <Input
                  id="ct-amount"
                  className="h-9"
                  dir="ltr"
                  type="number"
                  min="0"
                  step="0.001"
                  value={fAmount}
                  onChange={(e) => setFAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-date" className="text-xs">
                  تاريخ العقد *
                </Label>
                <Input
                  id="ct-date"
                  className="h-9"
                  dir="ltr"
                  type="date"
                  value={fDate}
                  onChange={(e) => setFDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                <Label htmlFor="ct-desc" className="text-xs">
                  الوصف
                </Label>
                <Textarea
                  id="ct-desc"
                  rows={2}
                  value={fDescription}
                  onChange={(e) => setFDescription(e.target.value)}
                  placeholder="وصف موجز لنطاق العمل…"
                />
              </div>
              <p className="text-xs text-muted-foreground md:col-span-2 lg:col-span-3">
                ملاحظة: مبلغ العقد لا يُعدَّل بعد الإنشاء — الزيادة والنقصان تتم عبر الملاحق المعتمدة.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== الخطوة 2 — المراحل (اختياري) ===== */}
      {step === 2 && (
        <Card>
          <CardContent className="space-y-3 p-4 md:p-6">
            <p className="text-xs text-muted-foreground">
              أضف مراحل تنفيذ العقد بالترتيب — تُستخدم كبوابات استحقاق للدفعات. يمكنك استيراد شجرة مراحل النوع
              كاملة (تصنيفات وفرعياتها) أو الإدخال اليدوي.
            </p>
            {selectedTypeName && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {wfTreeQuery.isLoading
                    ? "جارٍ تحميل شجرة النوع…"
                    : typeTree.length > 0
                      ? `شجرة «${selectedTypeName}»: ${typeTree.filter((s) => s.level === 1).length} تصنيفًا و${typeTree.filter((s) => s.level === 2).length} مرحلة فرعية`
                      : `النوع «${selectedTypeName}» بلا شجرة مراحل — استخدم الإدخال اليدوي`}
                </p>
                {typeTree.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5"
                    onClick={() => (stages.length > 0 ? setImportConfirm(true) : importTree())}
                  >
                    <ListTree className="size-4" />
                    استيراد شجرة مراحل النوع
                  </Button>
                )}
              </div>
            )}
            {stages.length === 0 && (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                لا مراحل مضافة
              </p>
            )}
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {stages.map((s, i) => {
                const isChild = s.level === 2;
                return (
                  <li
                    key={i}
                    className={`rounded-md border p-2 ${isChild ? "ms-6 border-dashed bg-muted/30" : "border-primary/30"}`}
                  >
                    <div className="grid grid-cols-[auto_1fr_5rem_5rem_auto_auto] items-end gap-2">
                      <div className="pb-2">
                        {isChild ? (
                          <span className="text-xs text-muted-foreground" title="فرعية تابعة لأقرب تصنيف رئيسي قبلها">
                            ↳
                          </span>
                        ) : (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                            تصنيف
                          </Badge>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{isChild ? `مرحلة فرعية` : `التصنيف ${stages.slice(0, i + 1).filter((x) => x.level === 1).length}`}</Label>
                        <Input
                          className={`h-9 ${isChild ? "" : "font-semibold"}`}
                          value={s.name}
                          onChange={(e) =>
                            setStages((arr) => arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">أيام</Label>
                        <Input
                          className="h-9"
                          dir="ltr"
                          type="number"
                          min="0"
                          value={s.expectedDays}
                          onChange={(e) =>
                            setStages((arr) => arr.map((x, j) => (j === i ? { ...x, expectedDays: e.target.value } : x)))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">دفع %</Label>
                        <Input
                          className="h-9"
                          dir="ltr"
                          type="number"
                          min="0"
                          max="100"
                          value={s.payPct}
                          onChange={(e) =>
                            setStages((arr) => arr.map((x, j) => (j === i ? { ...x, payPct: e.target.value } : x)))
                          }
                        />
                      </div>
                      {!isChild && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 gap-1 px-2"
                          title="إضافة مرحلة فرعية تحت هذا التصنيف"
                          onClick={() =>
                            setStages((arr) => {
                              const next = [...arr];
                              // تُدرج بعد آخر فرعيات هذا التصنيف (أو بعده مباشرة)
                              let insertAt = i + 1;
                              while (insertAt < next.length && next[insertAt].level === 2) insertAt += 1;
                              next.splice(insertAt, 0, { name: "", expectedDays: "", payPct: "", level: 2 });
                              return next;
                            })
                          }
                        >
                          <Plus className="size-3.5" />
                          فرعية
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9 text-destructive hover:text-destructive"
                        onClick={() => setStages((arr) => arr.filter((_, j) => j !== i))}
                        aria-label="حذف المرحلة"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <Button
              variant="outline"
              className="h-9 w-full gap-1.5"
              onClick={() => setStages((arr) => [...arr, { name: "", expectedDays: "", payPct: "", level: 1 }])}
            >
              <Layers className="size-4" />
              إضافة تصنيف رئيسي
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ===== الخطوة 3 — الدفعات (اختياري) ===== */}
      {step === 3 && (
        <Card>
          <CardContent className="space-y-3 p-4 md:p-6">
            {hasTpl ? (
              <p className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs font-medium text-primary">
                وضع القالب: دفعات النوع ستولّد خطة السداد تلقائيًا (النسبة من قيمة العقد أو المبلغ اليدوي)
                — الإضافة اليدوية معطّلة كالمكتبي. أضف مراحل العقد في الخطوة السابقة لربطها.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                أضف دفعات يدوية بقيم واستحقاقات محددة. إن تُركت فارغة فسيولّد النظام الخطة من نسب المراحل أو قالب النوع.
              </p>
            )}
            {payments.length === 0 && (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                لا دفعات مضافة
              </p>
            )}
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {payments.map((p, i) => (
                <li key={i} className="grid grid-cols-[1fr_6rem_9rem_2rem] items-end gap-2 rounded-md border p-2">
                  <div className="space-y-1">
                    <Label className="text-xs">عنوان الدفعة {i + 1}</Label>
                    <Input
                      className="h-9"
                      value={p.title}
                      onChange={(e) =>
                        setPayments((arr) => arr.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">المبلغ</Label>
                    <Input
                      className="h-9"
                      dir="ltr"
                      type="number"
                      min="0"
                      step="0.001"
                      value={p.amount}
                      onChange={(e) =>
                        setPayments((arr) => arr.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">الاستحقاق</Label>
                    <Input
                      className="h-9"
                      dir="ltr"
                      type="date"
                      value={p.dueDate}
                      onChange={(e) =>
                        setPayments((arr) => arr.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))
                      }
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 text-destructive hover:text-destructive"
                    onClick={() => setPayments((arr) => arr.filter((_, j) => j !== i))}
                    aria-label="حذف الدفعة"
                    disabled={hasTpl}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
            {!hasTpl && (
              <Button
                variant="outline"
                className="h-9 w-full gap-1.5"
                onClick={() =>
                  setPayments((arr) => [...arr, { title: "", amount: "", dueDate: new Date().toISOString().slice(0, 10) }])
                }
              >
                <Banknote className="size-4" />
                إضافة دفعة
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===== شريط الإجراءات السفلي — زر أساسي واحد + إلغاء outline ===== */}
      <div className="sticky bottom-2 z-30">
        <Card className="border bg-background/95 shadow-sm backdrop-blur">
          <CardContent className="flex items-center justify-end gap-2 p-2">
            <Button
              variant="outline"
              className="h-9"
              onClick={onCancel}
              disabled={createMutation.isPending}
            >
              إلغاء
            </Button>
            {step > 1 && (
              <Button
                variant="outline"
                className="h-9 gap-1"
                onClick={() => setStep((s) => s - 1)}
                disabled={createMutation.isPending}
              >
                <ChevronRight className="size-4" />
                السابق
              </Button>
            )}
            {step < 3 ? (
              <Button className="h-9 gap-1" onClick={() => setStep((s) => s + 1)}>
                التالي
                <ChevronLeft className="size-4" />
              </Button>
            ) : (
              <Button className="h-9" onClick={submitCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? "جارٍ الإنشاء…" : "إنشاء العقد"}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ===== تأكيد الاستيراد فوق مراحل مُدخلة يدويًا ===== */}
      <AlertDialog open={importConfirm} onOpenChange={setImportConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>استبدال المراحل المُدخلة؟</AlertDialogTitle>
            <AlertDialogDescription>
              لديك {stages.length} مرحلة مُدخلة يدويًا — الاستيراد سيستبدلها كلها بشجرة النوع
              ({typeTree.length} صفًا). لا يمكن التراجع بعد الحفظ.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>رجوع للتعديل</AlertDialogCancel>
            <AlertDialogAction onClick={importTree}>استبدال بالشجرة</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== حوار حارس المبلغ amount_guard — مطابقة المكتبي حرفيًا (QMessageBox + 3 خيارات) ===== */}
      <AlertDialog open={guardBox !== null} onOpenChange={(o) => !o && setGuardBox(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تنبيه: فرق بين المبلغ والمجموع</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">
              يوجد فرق — ماذا تريد أن تفعل؟
              {"\n"}
              {guardBox && `قيمة العقد: ${fmtK(guardBox.amount)} د.ك`}
              {guardBox &&
                guardBox.problems.map((p) => (
                  <span key={p.label}>
                    {"\n"}
                    {`${p.label}: ${fmtK(p.total)} د.ك (الفرق ${fmtK(p.total - guardBox.amount)})`}
                  </span>
                ))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            {guardBox && (
              <>
                <AlertDialogAction
                  className="w-full"
                  onClick={() => guardCreate("update_amount")}
                >
                  تحديث مبلغ العقد إلى {fmtK(guardBox.problems[0].total)}
                </AlertDialogAction>
                <AlertDialogAction
                  className="w-full"
                  onClick={() => guardCreate("scale_plan")}
                >
                  توزيع الدفعات على المبلغ {fmtK(guardBox.amount)}
                </AlertDialogAction>
                <AlertDialogAction
                  className="w-full"
                  onClick={() => guardCreate("keep_diff")}
                >
                  حفظ بالفرق (يُسجل في التقرير)
                </AlertDialogAction>
                <AlertDialogCancel className="w-full">رجوع للتعديل</AlertDialogCancel>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
