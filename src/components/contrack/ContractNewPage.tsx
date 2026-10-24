"use client";

/**
 * «عقد جديد» — صفحة واحدة بالحالات الأربع (Task 89b — مطابقة المكتبي ContractDialog/_apply_mode):
 *   📦 الشامل  (pricing_mode=bundle)  ⟵ جدول مكوّنات (كمية × سعر مرجعي / إشراف: أشهر × شهري) — بلا صندوق إشراف
 *   🔧 اليدوي  (manual_track=1)       ⟵ الجدولان المتقابلان: يمين مراحل «الإعدادات» / يسار المختارة للعقد
 *   📏 التلقائي (له قالب مراحل)       ⟵ شجرة القالب تُسحب كاملة (عرض للقراءة) + دفعات القالب بمبالغ قابلة للتعديل
 *   ◼ المقطوعية (غير ذلك)            ⟵ نفس الجدولين مع إضافة مراحل حرة
 *   👁 الإشراف طابع فوق أي حالة (ما عدا الشامل): صندوق (تاريخ التعهد + أشهر × قيمة الشهر − خصم)
 *      وقيمة العقد = الصافي مقفلة، والدفعات اليدوية ممنوعة (التحصيل عبر أشهر الإشراف).
 * المنطق (payload/التحقق/حارس المبلغ/الترقيم) كما هو — التغيير تخطيطي ووظيفي للعرض فقط.
 * المرجع: upload/شرح_صفحة_العقد_والباطن_الحالات_الأربع.md (§3-أ ترتيب التحديد، §5 صناديق كل حالة).
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Banknote,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

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
import { Checkbox } from "@/components/ui/checkbox";
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
import type {
  ContractTypesResponse,
  CustomersResponse,
  TypeBundleComponentDTO,
  WorkflowStageDTO,
} from "./contrack-types";
import { errMessage } from "./contrack-types";
import { amountGuardProblems, templatePlanRows, type AmountGuardProblem } from "@/lib/contract-create";

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

/** صف مرحلة مختارة — level 1 رئيسية / 2 فرعية تابعة لـ parentName */
interface StageDraft {
  name: string;
  expectedDays: string;
  payPct: string;
  level: number;
  parentName: string;
  isSupervision: boolean;
  supMonthly: string;
}

interface PaymentDraft {
  title: string;
  amount: string;
  dueDate: string;
  /** وضع التلقائي: اسم مرحلة الربط من القالب — يُترجم stageIndex عند الحفظ */
  stageName?: string;
}

interface BundleRowState {
  enabled: boolean;
  qty: string;
  months: string;
  monthly: string;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const fmtK = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const addDays = (day: string, days: number): string => {
  if (!day) return "";
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + Math.trunc(days || 0));
  return d.toISOString().slice(0, 10);
};

const todayStr = () => new Date().toISOString().slice(0, 10);

/** بناء شجرة القالب: الرئيسيات (أو اليتيمات) بترتيبها وفرعياتها خلفها — مطابق لترتيب get_stages */
function buildTemplateTree(pool: WorkflowStageDTO[]): { main: WorkflowStageDTO; children: WorkflowStageDTO[] }[] {
  const ids = new Set(pool.map((s) => s.id));
  const isMain = (s: WorkflowStageDTO) => s.parentId == null || !ids.has(s.parentId);
  const byOrder = (a: WorkflowStageDTO, b: WorkflowStageDTO) => a.stageOrder - b.stageOrder;
  const mains = pool.filter(isMain).sort(byOrder);
  return mains.map((main) => ({
    main,
    children: pool.filter((s) => s.parentId === main.id).sort(byOrder),
  }));
}

const toDraft = (s: WorkflowStageDTO): StageDraft => ({
  name: s.stageName,
  expectedDays: String(s.expectedDays ?? 0),
  payPct: String(Number(s.paymentPct ?? 0)),
  level: s.parentId == null ? 1 : 2,
  parentName: "",
  isSupervision: Boolean(s.isSupervision),
  supMonthly: String(Number(s.supMonthly ?? 0)),
});

export function ContractNewPage({
  onAuthError,
  presetCustomerId,
  onSaved,
  onCancel,
  onOpenContract,
}: ContractNewPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
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
  const stagesQuery = useQuery<{ stages: WorkflowStageDTO[] }>({
    queryKey: ["workflow-stages"],
    queryFn: () => apiGet<{ stages: WorkflowStageDTO[] }>("/api/workflow-stages"),
  });

  const [fCustomerId, setFCustomerId] = React.useState(
    presetCustomerId ? String(presetCustomerId) : ""
  );
  const [fName, setFName] = React.useState("");
  const [fTypeId, setFTypeId] = React.useState("");
  const [fAmount, setFAmount] = React.useState("");
  const [fDate, setFDate] = React.useState(() => todayStr());
  const [fDescription, setFDescription] = React.useState("");

  // ===== الحالات الأربع =====
  const [selectedStages, setSelectedStages] = React.useState<StageDraft[]>([]);
  const [checkedTpl, setCheckedTpl] = React.useState<Set<number>>(new Set());
  const [stageSearch, setStageSearch] = React.useState("");
  const [payments, setPayments] = React.useState<PaymentDraft[]>([]);
  const [paymentsDirty, setPaymentsDirty] = React.useState(false);
  const [supForm, setSupForm] = React.useState({ start: "", months: "", monthly: "", discount: "0" });
  const [bundleOn, setBundleOn] = React.useState<Record<string, BundleRowState>>({});

  const selectedType = typesQuery.data?.types.find((t) => String(t.id) === fTypeId);
  const isBundle = selectedType?.pricingMode === "bundle";
  const isManualType = Boolean(selectedType?.manualTrack);
  const isSupervisionType = Boolean(selectedType?.isSupervision);

  /** قالب مراحل النوع: الخاص بالنوع أولًا وإلا القالب العام ('') — transactionType=contract */
  const tplStages = React.useMemo(() => {
    const all = (stagesQuery.data?.stages ?? []).filter((s) => s.transactionType === "contract");
    if (!selectedType) return [];
    const specific = all.filter((s) => (s.contractType || "") === selectedType.name);
    const general = all.filter((s) => (s.contractType || "") === "");
    return specific.length > 0 ? specific : general;
  }, [stagesQuery.data, selectedType]);
  const tplTree = React.useMemo(() => buildTemplateTree(tplStages), [tplStages]);

  /** ترتيب التحديد (§3-أ): الشامل ← اليدوي ← له قالب (تلقائي) ← المقطوعية */
  const mode: "bundle" | "manual" | "auto" | "lump" = isBundle
    ? "bundle"
    : isManualType
      ? "manual"
      : tplStages.length > 0
        ? "auto"
        : "lump";

  const supMonths = Math.trunc(Number(supForm.months || 0));
  const supMonthly = Number(supForm.monthly || 0);
  const supDiscount = Number(supForm.discount || 0);
  /** الإشراف طابع فوق أي حالة ما عدا الشامل (المكتبي يرفض الجمع صراحة) */
  const supCandidate = (isSupervisionType || Boolean(supForm.start)) && !isBundle;
  const supActive = supCandidate && supMonths > 0 && supMonthly > 0;
  const supNet = r3(supMonths * supMonthly - supDiscount);

  const bundleTotal = React.useMemo(() => {
    const comps = selectedType?.bundleComponents ?? [];
    return r3(
      comps.reduce((sum, c) => {
        const row = bundleOn[c.name];
        if (!row?.enabled) return sum;
        if (c.isSupervision) return sum + Math.trunc(Number(row.months || 0)) * Number(row.monthly || 0);
        return sum + Number(row.qty || 0) * c.unitPrice;
      }, 0)
    );
  }, [bundleOn, selectedType]);

  const effAmount = supActive ? supNet : Number(fAmount || 0);

  // توليد دفعات القالب في وضع التلقائي (مطابق templatePlanRows الخادمية) — يتوقف عند أي تحرير يدوي
  React.useEffect(() => {
    if (mode !== "auto" || paymentsDirty || !flagOn("template_plan_mode")) return;
    const amount = Number(fAmount || 0);
    const rows = templatePlanRows(
      (selectedType?.paymentTemplates ?? []).map((t) => ({
        title: t.title,
        pct: t.pct,
        amountFixed: t.amountFixed,
        daysOffset: t.daysOffset,
        triggerStageId: null,
      })),
      amount,
      fDate
    );
    setPayments(rows.map((r) => ({ title: r.title, amount: String(r.amount), dueDate: r.dueDate })));
  }, [mode, fAmount, fDate, fTypeId, paymentsDirty, flagOn]);

  // عند تغيير النوع: تصفير الحالات + تهيئة صندوق الإشراف ومكوّنات الشامل من افتراضيات النوع
  React.useEffect(() => {
    setSelectedStages([]);
    setCheckedTpl(new Set());
    setStageSearch("");
    setPayments([]);
    setPaymentsDirty(false);
    setSupForm((f) => ({ ...f, start: "", months: "", monthly: "", discount: "0" }));
    if (selectedType) {
      const init: Record<string, BundleRowState> = {};
      for (const b of selectedType.bundleComponents ?? []) {
        init[b.name] = {
          enabled: true,
          qty: String(b.qty || 1),
          months: String(b.qty || 1),
          monthly: String(b.unitPrice || 0),
        };
      }
      setBundleOn(init);
      if (selectedType.defaultAmount && Number(selectedType.defaultAmount) > 0) {
        setFAmount(String(Number(selectedType.defaultAmount)));
      }
      if (selectedType.isSupervision && Number(selectedType.unitPrice ?? 0) > 0) {
        setSupForm((f) => ({ ...f, monthly: String(Number(selectedType.unitPrice)) }));
      }
    } else {
      setBundleOn({});
    }
  }, [fTypeId]);

  // ===== نفس إنشاء النافذة السابقة حرفيًا (نفس الـinvalidations والـtoasts) + حقول الحالات الأربع =====
  const createMutation = useMutation({
    mutationFn: async (amountPolicy?: string) => {
      const typeName = selectedType?.name || "غير محدد";
      // المراحل: التلقائي يسحب القالب كاملًا، وغيره يرسل المختار/الحر
      const stagesOut: (StageDraft & { sortOrder: number })[] =
        mode === "auto"
          ? tplTree.flatMap(({ main, children }) => [main, ...children]).map(toDraft).map((s, i) => ({ ...s, sortOrder: i }))
          : selectedStages.map((s, i) => ({ ...s, sortOrder: i }));

      const body: Record<string, unknown> = {
        customerId: Number(fCustomerId),
        contractName: fName.trim(),
        contractType: typeName,
        amount: effAmount,
        contractDate: fDate,
        description: fDescription.trim(),
      };
      if (mode === "bundle") {
        body.components = (selectedType?.bundleComponents ?? [])
          .map((c) => ({ comp: c, row: bundleOn[c.name] }))
          .filter((x) => x.row?.enabled)
          .map((x) => ({
            compKey: x.comp.name,
            label: x.comp.name,
            kind: x.comp.isSupervision ? "months" : "qty",
            enabled: true,
            qty: Number(x.row.qty || 1),
            months: Math.trunc(Number(x.row.months || 0)),
            monthly: Number(x.row.monthly || 0),
          }));
      }
      if (supActive) {
        body.supStartDate = supForm.start;
        body.supMonths = supMonths;
        body.supMonthly = supMonthly;
        body.supDiscount = supDiscount;
      } else {
        body.stages = stagesOut;
        const stageIndexOf = (nm?: string) => {
          if (!nm) return undefined;
          const idx = stagesOut.findIndex((s) => s.name === nm);
          return idx >= 0 ? idx : undefined;
        };
        body.plan = payments
          .filter((p) => p.title.trim() && Number(p.amount) > 0)
          .map((p, i) => ({
            title: p.title.trim(),
            amount: Number(p.amount),
            dueDate: p.dueDate,
            sortOrder: i,
            stageIndex: stageIndexOf(p.stageName),
          }));
      }
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
  const [guardBox, setGuardBox] = React.useState<{
    amount: number;
    planTotal: number;
    problems: AmountGuardProblem[];
  } | null>(null);

  const submitCreate = () => {
    if (!fCustomerId) {
      toast({ variant: "destructive", title: "بيانات ناقصة", description: "اختر العميل أولًا" });
      return;
    }
    // الإشراف: الصافي هو القيمة والدفعات اليدوية ممنوعة (مطابق المكتبي — جدول مفرغ)
    if (supActive) {
      if (!supForm.start) {
        toast({ variant: "destructive", title: "بيانات ناقصة", description: "أدخل تاريخ تعهد الإشراف" });
        return;
      }
      if (!(supNet > 0)) {
        toast({
          variant: "destructive",
          title: "بيانات ناقصة",
          description: "صافي الإشراف (الأشهر × قيمة الشهر − الخصم) يجب أن يكون أكبر من صفر",
        });
        return;
      }
      createMutation.mutate(undefined);
      return;
    }
    if (!(Number(fAmount) > 0)) {
      toast({ variant: "destructive", title: "بيانات ناقصة", description: "أدخل مبلغ العقد" });
      return;
    }
    if (mode === "bundle" && !(bundleTotal > 0)) {
      toast({
        variant: "destructive",
        title: "بيانات ناقصة",
        description: "فعّل مكوّنًا واحدًا على الأقل وأدخل كمية/قيمة له — أو ألغِ اختيار النوع الشامل",
      });
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
          description:
            problems
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

  // ===== أدوات الجدولين (اليدوي/المقطوعية) =====
  const moveCheckedToSelected = () => {
    if (checkedTpl.size === 0) return;
    const blocks = tplTree.filter((b) => checkedTpl.has(b.main.id));
    const incoming: StageDraft[] = blocks.flatMap((b) => [
      { ...toDraft(b.main), parentName: "" },
      ...b.children.map((ch) => ({ ...toDraft(ch), level: 2, parentName: b.main.stageName })),
    ]);
    setSelectedStages((arr) => [...arr, ...incoming]);
    setCheckedTpl(new Set());
  };

  const moveOneToSelected = (mainId: number) => {
    const block = tplTree.find((b) => b.main.id === mainId);
    if (!block) return;
    const incoming: StageDraft[] = [
      { ...toDraft(block.main), parentName: "" },
      ...block.children.map((ch) => ({ ...toDraft(ch), level: 2, parentName: block.main.stageName })),
    ];
    setSelectedStages((arr) => [...arr, ...incoming]);
    setCheckedTpl((s) => {
      const n = new Set(s);
      n.delete(mainId);
      return n;
    });
  };

  /** تبديل كتلتين رئيسيتين (رئيسية وفرعياتها) في قائمة المختارة — للترتيب ↑↓ */
  const swapBlocks = (blockIdx: number, dir: -1 | 1) => {
    setSelectedStages((arr) => {
      const starts: number[] = [];
      arr.forEach((s, i) => {
        if (s.level === 1) starts.push(i);
      });
      const a = starts[blockIdx];
      const b = starts[blockIdx + dir];
      if (a === undefined || b === undefined) return arr;
      const aEnd = (starts[blockIdx + 1] ?? arr.length);
      const bEnd = (starts[blockIdx + dir + 1] ?? arr.length);
      const blockA = arr.slice(a, aEnd);
      const blockB = arr.slice(b, bEnd);
      const before = arr.slice(0, dir === -1 ? b : a);
      const after = arr.slice(dir === -1 ? aEnd : bEnd);
      return dir === -1 ? [...before, ...blockA, ...blockB, ...after] : [...before, ...blockB, ...blockA, ...after];
    });
  };

  const selectedBlockCount = selectedStages.filter((s) => s.level === 1).length;
  const search = stageSearch.trim();
  const filteredTree = React.useMemo(() => {
    if (!search) return tplTree;
    const hit = (s: WorkflowStageDTO) => s.stageName.includes(search);
    return tplTree
      .map((b) => ({ main: b.main, children: b.children.filter(hit) }))
      .filter((b) => hit(b.main) || b.children.length > 0);
  }, [tplTree, search]);

  const modeBadge =
    mode === "bundle" ? (
      <Badge className="bg-status-info-bg text-status-info">📦 شامل — مكوّنات</Badge>
    ) : mode === "manual" ? (
      <Badge className="bg-status-warn-bg text-status-warn">🔧 مسار يدوي</Badge>
    ) : mode === "auto" ? (
      <Badge variant="secondary">📏 تلقائي — قالب النوع</Badge>
    ) : (
      <Badge variant="secondary">◼ مقطوعية</Badge>
    );

  return (
    <div className="space-y-3">
      {/* ===== رأس مختصر — سطر واحد (العنوان + شارات الحالة) ===== */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold whitespace-nowrap">عقد جديد</h1>
        {modeBadge}
        {supCandidate && <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">👁 إشراف</Badge>}
      </div>

      {/* ===== ① بيانات العقد — صفّان مدمجان ===== */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
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
            <div className="space-y-1.5">
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
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">نوع العقد</Label>
              <Select
                value={fTypeId}
                onValueChange={(v) => {
                  setFTypeId(v);
                  setFAmount("");
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="اختر النوع" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {(typesQuery.data?.types ?? [])
                    .filter((t) => t.active !== false)
                    .map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-amount" className="text-xs">
                {supActive ? "قيمة العقد (صافي الإشراف)" : "المبلغ (د.ك) *"}
              </Label>
              <Input
                id="ct-amount"
                className="h-9"
                dir="ltr"
                type="number"
                min="0"
                step="0.001"
                value={supActive ? String(supNet) : fAmount}
                onChange={(e) => setFAmount(e.target.value)}
                disabled={supActive}
              />
              {supActive && (
                <p className="text-[11px] text-muted-foreground">
                  مقفل على صافي الإشراف: {supMonths} شهر × {fmtK(supMonthly)} − خصم {fmtK(supDiscount)}
                </p>
              )}
              {isBundle && bundleTotal > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  مجموع المكوّنات المفعّلة: {fmtK(bundleTotal)} د.ك
                  {Number(fAmount || 0) !== bundleTotal && (
                    <button
                      type="button"
                      className="ms-1 text-primary underline underline-offset-2"
                      onClick={() => setFAmount(String(bundleTotal))}
                    >
                      استخدام المجموع
                    </button>
                  )}
                </p>
              )}
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
          </div>
          <div className="space-y-1.5">
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
          <p className="text-xs text-muted-foreground">
            ملاحظة: مبلغ العقد لا يُعدَّل بعد الإنشاء — الزيادة والنقصان تتم عبر الملاحق المعتمدة.
          </p>
        </CardContent>
      </Card>

      {/* ===== ②-أ صندوق الإشراف (طابع فوق أي حالة ما عدا الشامل) ===== */}
      {supCandidate && (
        <Card className="border-purple-200 dark:border-purple-900">
          <CardContent className="space-y-3 p-4">
            <p className="text-xs font-semibold text-purple-700 dark:text-purple-300">
              👁 عقد إشراف هندسي — القيمة تُحسب: الأشهر × قيمة الشهر − الخصم (المكتبي contracts.py:2395)
            </p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label className="text-xs">تاريخ التعهد *</Label>
                <Input
                  className="h-9"
                  dir="ltr"
                  type="date"
                  value={supForm.start}
                  onChange={(e) => setSupForm((f) => ({ ...f, start: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">مدة الإشراف (شهر) *</Label>
                <Input
                  className="h-9"
                  dir="ltr"
                  type="number"
                  min="0"
                  max="120"
                  value={supForm.months}
                  onChange={(e) => setSupForm((f) => ({ ...f, months: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">قيمة الشهر (د.ك) *</Label>
                <Input
                  className="h-9"
                  dir="ltr"
                  type="number"
                  min="0"
                  step="0.001"
                  value={supForm.monthly}
                  onChange={(e) => setSupForm((f) => ({ ...f, monthly: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">خصم الإشراف</Label>
                <Input
                  className="h-9"
                  dir="ltr"
                  type="number"
                  min="0"
                  step="0.001"
                  value={supForm.discount}
                  onChange={(e) => setSupForm((f) => ({ ...f, discount: e.target.value }))}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== ②-ب منطقة المراحل حسب الحالة ===== */}
      {(mode === "manual" || mode === "lump" || (mode === "bundle" && tplStages.length === 0)) && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* يمين — مراحل الإعدادات (القوالب) */}
          <Card>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">مراحل النوع من الإعدادات</p>
                <span className="text-xs text-muted-foreground">{tplStages.length} مرحلة</span>
              </div>
              {tplStages.length > 0 ? (
                <>
                  <div className="relative">
                    <Search className="absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="h-8 ps-7 text-xs"
                      value={stageSearch}
                      onChange={(e) => setStageSearch(e.target.value)}
                      placeholder="ابحث عن مرحلة…"
                    />
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => setCheckedTpl(new Set(tplTree.map((b) => b.main.id)))}
                    >
                      ✓ الكل
                    </Button>
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setCheckedTpl(new Set())}>
                      ✕ لا شيء
                    </Button>
                    <Button
                      size="sm"
                      className="ms-auto h-8 gap-1 text-xs"
                      disabled={checkedTpl.size === 0}
                      onClick={moveCheckedToSelected}
                    >
                      <ArrowLeft className="size-3.5" />
                      نقل المحدد{checkedTpl.size > 0 ? ` (${checkedTpl.size})` : ""}
                    </Button>
                  </div>
                  <ul className="space-y-1 pe-1">
                    {filteredTree.map((b) => (
                      <React.Fragment key={b.main.id}>
                        <li className="flex items-center gap-2 rounded-md border p-1.5">
                          <Checkbox
                            checked={checkedTpl.has(b.main.id)}
                            onCheckedChange={(v) =>
                              setCheckedTpl((s) => {
                                const n = new Set(s);
                                if (v) n.add(b.main.id);
                                else n.delete(b.main.id);
                                return n;
                              })
                            }
                            aria-label={`اختيار ${b.main.stageName}`}
                          />
                          <span className="flex-1 truncate text-xs font-medium">
                            {b.main.stageName}
                            {b.main.isSupervision && " 👁"}
                          </span>
                          <span className="w-14 text-center text-[11px] text-muted-foreground" title="أيام متوقعة">
                            {b.main.expectedDays || 0} ي
                          </span>
                          <span className="w-12 text-center text-[11px] text-muted-foreground" title="نسبة الدفع">
                            {Number(b.main.paymentPct || 0)}%
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            title="نقل المرحلة (مع فرعياتها)"
                            onClick={() => moveOneToSelected(b.main.id)}
                          >
                            <ArrowLeft className="size-3.5" />
                          </Button>
                        </li>
                        {b.children.map((ch) => (
                          <li key={ch.id} className="flex items-center gap-2 rounded-md border border-dashed p-1.5 ps-7">
                            <span className="flex-1 truncate text-xs text-muted-foreground">
                              └ {ch.stageName}
                              {ch.isSupervision && " 👁"}
                            </span>
                            <span className="w-14 text-center text-[11px] text-muted-foreground">
                              {ch.expectedDays || 0} ي
                            </span>
                            <span className="w-12 text-center text-[11px] text-muted-foreground">
                              {Number(ch.paymentPct || 0)}%
                            </span>
                          </li>
                        ))}
                      </React.Fragment>
                    ))}
                  </ul>
                  <p className="text-[11px] text-muted-foreground">نقل المرحلة الرئيسية ينقل فرعياتها معها بالترتيب.</p>
                </>
              ) : (
                <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                  لا مراحل معرّفة لهذا النوع في «مراحل المتابعة» — أضف مراحل حرة من الجدول المجاور.
                </p>
              )}
            </CardContent>
          </Card>

          {/* يسار — المراحل المختارة للعقد */}
          <Card>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">
                  المراحل المختارة للعقد{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({selectedBlockCount} رئيسية · {selectedStages.length} صف)
                  </span>
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 text-xs"
                  onClick={() =>
                    setSelectedStages((arr) => [
                      { name: "", expectedDays: "", payPct: "", level: 1, parentName: "", isSupervision: false, supMonthly: "" },
                      ...arr,
                    ])
                  }
                >
                  <Plus className="size-3.5" />
                  مرحلة حرة
                </Button>
              </div>
              {selectedStages.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                  لا مراحل مختارة — انقل من قائمة الإعدادات أو أضف مرحلة حرة.
                </p>
              ) : (
                <ul className="max-h-72 space-y-1 overflow-y-auto pe-1">
                  {selectedStages.map((s, i) => {
                    const blockIdx = selectedStages.slice(0, i + 1).filter((x) => x.level === 1).length - 1;
                    const isBlockStart = s.level === 1;
                    return (
                      <li
                        key={i}
                        className={`grid grid-cols-[auto_1fr_4rem_4rem_auto] items-center gap-1.5 rounded-md border p-1.5 ${
                          s.level === 2 ? "border-dashed ps-5" : ""
                        }`}
                      >
                        <div className="flex items-center gap-0.5">
                          {isBlockStart && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                disabled={blockIdx === 0}
                                aria-label="تحريك أعلى"
                                onClick={() => swapBlocks(blockIdx, -1)}
                              >
                                <ArrowUp className="size-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                disabled={blockIdx === selectedBlockCount - 1}
                                aria-label="تحريك أسفل"
                                onClick={() => swapBlocks(blockIdx, 1)}
                              >
                                <ArrowDown className="size-3" />
                              </Button>
                            </>
                          )}
                        </div>
                        <Input
                          className="h-8 text-xs"
                          value={s.name}
                          placeholder={s.level === 2 ? `فرعية (${s.parentName})` : `المرحلة ${blockIdx + 1}`}
                          onChange={(e) =>
                            setSelectedStages((arr) => arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                          }
                        />
                        <Input
                          className="h-8 text-xs"
                          dir="ltr"
                          type="number"
                          min="0"
                          title="أيام متوقعة"
                          value={s.expectedDays}
                          onChange={(e) =>
                            setSelectedStages((arr) =>
                              arr.map((x, j) => (j === i ? { ...x, expectedDays: e.target.value } : x))
                            )
                          }
                        />
                        <Input
                          className="h-8 text-xs"
                          dir="ltr"
                          type="number"
                          min="0"
                          max="100"
                          title="نسبة الدفع %"
                          value={s.payPct}
                          onChange={(e) =>
                            setSelectedStages((arr) => arr.map((x, j) => (j === i ? { ...x, payPct: e.target.value } : x)))
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive hover:text-destructive"
                          aria-label="حذف المرحلة"
                          onClick={() => setSelectedStages((arr) => arr.filter((_, j) => j !== i))}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ===== ②-ب التلقائي — القالب يُسحب كاملًا (عرض للقراءة) ===== */}
      {mode === "auto" && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="rounded-md border border-primary/30 bg-primary/5 p-2.5 text-xs font-medium text-primary">
              📏 النوع «{selectedType?.name}» تلقائي — شجرة مراحل القالب ({tplStages.length} مرحلة) تُسحب كاملة تلقائيًا
              عند الإنشاء بلا اختيار يدوي (المكتبي _auto_plan_ui). المراحل الإشرافية معلّمة بـ 👁.
            </p>
            <ol className="space-y-1 pe-1">
              {tplTree.map((b, i) => (
                <React.Fragment key={b.main.id}>
                  <li className="flex items-center gap-2 rounded-md border p-1.5 text-xs">
                    <span className="w-6 text-center text-[11px] text-muted-foreground">{i + 1}</span>
                    <span className="flex-1 truncate font-medium">
                      {b.main.stageName}
                      {b.main.isSupervision && " 👁"}
                    </span>
                    <span className="w-14 text-center text-[11px] text-muted-foreground">{b.main.expectedDays || 0} ي</span>
                    <span className="w-12 text-center text-[11px] text-muted-foreground">{Number(b.main.paymentPct || 0)}%</span>
                  </li>
                  {b.children.map((ch) => (
                    <li key={ch.id} className="flex items-center gap-2 rounded-md border border-dashed p-1.5 ps-9 text-xs">
                      <span className="flex-1 truncate text-muted-foreground">└ {ch.stageName}{ch.isSupervision && " 👁"}</span>
                      <span className="w-14 text-center text-[11px] text-muted-foreground">{ch.expectedDays || 0} ي</span>
                      <span className="w-12 text-center text-[11px] text-muted-foreground">{Number(ch.paymentPct || 0)}%</span>
                    </li>
                  ))}
                </React.Fragment>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {/* ===== ②-ب الشامل — جدول المكوّنات ===== */}
      {mode === "bundle" && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="text-xs text-muted-foreground">
              📦 مكوّنات العقد الشامل — المكوّن الإشرافي يدخل بأشهر × قيمة الشهر، وغيره كمية × السعر المرجعي.
              الشامل لا يقبل صندوق إشراف مستقل (المكتبي contract_type_service.py:168).
            </p>
            {(selectedType?.bundleComponents ?? []).length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                لا مكوّنات معرّفة لهذا النوع الشامل — أضفها من الإعدادات ← أنواع العقود ← المكوّنات.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-[auto_1fr_5rem_6rem_auto] gap-2 px-1 text-[11px] font-medium text-muted-foreground">
                  <span />
                  <span>المكوّن</span>
                  <span className="text-center">{""}</span>
                  <span className="text-center">{""}</span>
                  <span className="w-20 text-end">الإجمالي</span>
                </div>
                <ul className="space-y-1">
                  {(selectedType?.bundleComponents ?? []).map((c: TypeBundleComponentDTO) => {
                    const row = bundleOn[c.name] ?? { enabled: true, qty: String(c.qty || 1), months: String(c.qty || 1), monthly: String(c.unitPrice || 0) };
                    const line = c.isSupervision
                      ? Math.trunc(Number(row.months || 0)) * Number(row.monthly || 0)
                      : Number(row.qty || 0) * c.unitPrice;
                    return (
                      <li key={c.componentTypeId} className="grid grid-cols-[auto_1fr_5rem_6rem_auto] items-center gap-2 rounded-md border p-1.5">
                        <Checkbox
                          checked={row.enabled}
                          onCheckedChange={(v) =>
                            setBundleOn((m) => ({ ...m, [c.name]: { ...row, enabled: v === true } }))
                          }
                          aria-label={`تفعيل ${c.name}`}
                        />
                        <span className="truncate text-xs font-medium">
                          {c.name}
                          {c.isSupervision && " 👁"}
                        </span>
                        {c.isSupervision ? (
                          <>
                            <Input
                              className="h-8 text-xs"
                              dir="ltr"
                              type="number"
                              min="0"
                              title="عدد الأشهر"
                              value={row.months}
                              onChange={(e) => setBundleOn((m) => ({ ...m, [c.name]: { ...row, months: e.target.value } }))}
                            />
                            <Input
                              className="h-8 text-xs"
                              dir="ltr"
                              type="number"
                              min="0"
                              step="0.001"
                              title="قيمة الشهر"
                              value={row.monthly}
                              onChange={(e) => setBundleOn((m) => ({ ...m, [c.name]: { ...row, monthly: e.target.value } }))}
                            />
                          </>
                        ) : (
                          <>
                            <Input
                              className="h-8 text-xs"
                              dir="ltr"
                              type="number"
                              min="0"
                              title={`الكمية (${c.unitLabel || "وحدة"})`}
                              value={row.qty}
                              onChange={(e) => setBundleOn((m) => ({ ...m, [c.name]: { ...row, qty: e.target.value } }))}
                            />
                            <span className="text-center text-[11px] text-muted-foreground" title="السعر المرجعي">
                              × {fmtK(c.unitPrice)}
                            </span>
                          </>
                        )}
                        <span className="w-20 text-end text-xs font-semibold tabular-nums">{fmtK(r3(line))}</span>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex items-center justify-between border-t pt-2 text-sm">
                  <span className="font-medium">الإجمالي</span>
                  <span className="font-bold tabular-nums text-primary">{fmtK(bundleTotal)} د.ك</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===== ③ الدفعات — ترويسة واحدة والمصدر حسب الحالة ===== */}
      <Card>
        <CardContent className="space-y-2 p-4">
          {supActive ? (
            <p className="rounded-md border border-purple-200 bg-purple-50 p-2.5 text-xs font-medium text-purple-700 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-300">
              👁 عقود الإشراف بلا دفعات يدوية — التحصيل يتم عبر أشهر الإشراف وسندات القبض مباشرة (المكتبي: الجدول مفرغ للإشراف).
            </p>
          ) : mode === "auto" && flagOn("template_plan_mode") ? (
            <p className="text-xs text-muted-foreground">
              دفعات قالب النوع — عدّل مبالغ هذا العقد فقط (الهيكل والاستحقاقات من القالب كالمكتبي).
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              أضف دفعات يدوية بقيم واستحقاقات محددة. إن تُركت فارغة فسيولّد النظام الخطة من نسب المراحل أو قالب النوع.
            </p>
          )}
          {payments.length === 0 && !supActive && (
            <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">لا دفعات مضافة</p>
          )}
          {payments.length > 0 && (
            <div className="space-y-1">
              <div className="grid grid-cols-[1fr_7rem_9rem_2rem] gap-2 px-1 text-[11px] font-medium text-muted-foreground">
                <span>عنوان الدفعة</span>
                <span className="text-center">المبلغ</span>
                <span className="text-center">الاستحقاق</span>
                <span />
              </div>
              <ul className="space-y-1">
                {payments.map((p, i) => {
                  const fixedRow = supActive || (mode === "auto" && flagOn("template_plan_mode"));
                  return (
                    <li key={i} className="grid grid-cols-[1fr_7rem_9rem_2rem] items-center gap-2 rounded-md border p-1.5">
                      <Input
                        className="h-8 text-xs"
                        value={p.title}
                        disabled={fixedRow}
                        onChange={(e) => {
                          setPaymentsDirty(true);
                          setPayments((arr) => arr.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)));
                        }}
                      />
                      <Input
                        className="h-8 text-xs"
                        dir="ltr"
                        type="number"
                        min="0"
                        step="0.001"
                        value={p.amount}
                        onChange={(e) => {
                          setPaymentsDirty(true);
                          setPayments((arr) => arr.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)));
                        }}
                      />
                      <Input
                        className="h-8 text-xs"
                        dir="ltr"
                        type="date"
                        value={p.dueDate}
                        disabled={fixedRow}
                        onChange={(e) => {
                          setPaymentsDirty(true);
                          setPayments((arr) => arr.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)));
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive hover:text-destructive"
                        aria-label="حذف الدفعة"
                        disabled={fixedRow}
                        onClick={() => {
                          setPaymentsDirty(true);
                          setPayments((arr) => arr.filter((_, j) => j !== i));
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {!supActive && !(mode === "auto" && flagOn("template_plan_mode")) && (
            <Button
              variant="outline"
              className="h-8 w-full gap-1.5 text-xs sm:w-auto"
              onClick={() => {
                setPaymentsDirty(true);
                setPayments((arr) => [...arr, { title: "", amount: "", dueDate: todayStr() }]);
              }}
            >
              <Banknote className="size-4" />
              إضافة دفعة
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ===== شريط الإجراءات السفلي — زر أساسي واحد + إلغاء ===== */}
      <div className="sticky bottom-2 z-30">
        <Card className="border bg-background/95 shadow-sm backdrop-blur">
          <CardContent className="flex items-center justify-end gap-2 p-2">
            <Button variant="outline" className="h-9" onClick={onCancel} disabled={createMutation.isPending}>
              إلغاء
            </Button>
            <Button className="h-9" onClick={submitCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? "جارٍ الإنشاء…" : "إنشاء العقد"}
            </Button>
          </CardContent>
        </Card>
      </div>

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
                <AlertDialogAction className="w-full" onClick={() => guardCreate("update_amount")}>
                  تحديث مبلغ العقد إلى {fmtK(guardBox.problems[0].total)}
                </AlertDialogAction>
                <AlertDialogAction className="w-full" onClick={() => guardCreate("scale_plan")}>
                  توزيع الدفعات على المبلغ {fmtK(guardBox.amount)}
                </AlertDialogAction>
                <AlertDialogAction className="w-full" onClick={() => guardCreate("keep_diff")}>
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
