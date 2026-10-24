"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";

/** G6 — عربي أنماط التسعير (مرآة PRICING_MODE_LABEL الخلفية بلا استيراد خادمي) */
const PRICING_MODE_AR: Record<string, string> = {
  bundle: "شامل (مكونات)",
  items: "بنود",
  unit: "وحدة × سعر",
  lump: "مقطوعية",
};
import {
  ArrowRight,
  Pencil,
  ArrowLeftRight,
  BadgeCheck,
  Banknote,
  HandCoins,
  TrendingUp,
  Wallet,
  Play,
  CheckCircle2,
  SkipForward,
  RotateCcw,
  Plus,
  Trash2,
  Building2,
  Loader2,
  AlertTriangle,
  HardHat,
  Eye,
  Menu,
  Download,
  FileText,
  Lock,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, getStoredToken } from "./api";
import { fetchBlobDownload } from "@/lib/download-blob";
import type {
  BoqResponse,
  ContractDetailResponse,
  ContractOverviewResponse,
  ContractPayViewResponse,
  PayViewLine,
  PayViewSubLine,
  PlanLine,
  StatementTarget,
  SubContractsResponse,
  SupervisionResponse,
  User,
} from "./contrack-types";
import { STATUS_CHANGE_OPTIONS, STATUS_REASON_REQUIRED, errMessage, isManagerRole } from "./contrack-types";
import { PAYMENT_STATUS_LABEL, fmtDate, formatKWD } from "@/lib/format";
import { formatStageHistoryLine, noteChip, pathPrefix, pctSuffix } from "@/lib/stage-panel";
import { VoucherPage } from "./VoucherPage";
import { SubContractDialog } from "./SubContractDialog";
import { StatusBadge } from "./StatusBadge";
import { SearchableSelect } from "./SearchableSelect";
import { PayBlockCard, PlanTable, UnifiedPayTable } from "./pay-tables";
import { SubcontractorLedger } from "./SubcontractorLedger";
import { AddendumsTab } from "./AddendumsTab";
import { ContractEditPage } from "./ContractEditPage";
import { ContractSettlePage } from "./ContractSettlePage";
import { SubContractNewPage } from "./SubContractNewPage";
import { ContractBoqPage } from "./ContractBoqPage";
import { ContractSupervisionPage } from "./ContractSupervisionPage";

interface ContractDetailViewProps {
  contractId: number;
  user: User;
  onBack: () => void;
  onAuthError: () => void;
  /** فتح الكشف في شاشة الكشوفات الكاملة — من «☰ إجراءات العقد → ▦ كشف حساب» */
  onOpenStatement?: (target: StatementTarget) => void;
  /** فتح ملف العميل صاحب العقد — من زر «◉ ملف العميل» في الترويسة (كالمكتبي dealings._open_customer) */
  onOpenCustomerFile?: (customerId: number) => void;
}

type PageKey = "stages" | "info" | "pay" | "addendums";

/** الصفحات الداخلية الكاملة — بدل النوافذ الكبرى والصغيرة متوسطة الحجم */
type FlowPage = "edit" | "sub-new" | "settle" | "boq" | "sup";

/** طفرة إجراء المراحل المشتركة — تبويب المسار الفني ولوحة المتابعة معًا (PATCH stages/[stageId]) */
type StageActionMut = UseMutationResult<unknown, Error, { stageId: number; body: Record<string, unknown> }>;

/** PageNav بأسلوب المكتبي (contract_hub.py:129–135) — أربع صفحات بمجموعاتها */
const PAGE_GROUPS: { key: PageKey; group: string; label: string }[] = [
  { key: "stages", group: "مراحل التنفيذ", label: "المسار الفني" },
  { key: "info", group: "ملخص العقد", label: "نظرة عامة" },
  { key: "pay", group: "💵 الدفعات والبنود", label: "الدفعات والمقاولون" },
  { key: "addendums", group: "الأوامر التغييرية", label: "الأوامر والتعديلات" },
];

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ContractDetailView({
  contractId,
  user,
  onBack,
  onAuthError,
  onOpenStatement,
  onOpenCustomerFile,
}: ContractDetailViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);

  // الصفحة الافتراضية «نظرة عامة» كالمكتبي؛ عقد المسار اليدوي يفتح على مساره (V4.56)
  const [page, setPage] = React.useState<PageKey>("info");
  const initialPageApplied = React.useRef(false);

  // ===== استعلامات =====
  const detailQuery = useQuery<ContractDetailResponse>({
    queryKey: ["contract", contractId],
    queryFn: () => apiGet<ContractDetailResponse>(`/api/contracts/${contractId}`),
  });

  // ===== الصفحات الداخلية الكاملة (بدل النوافذ الكبرى) =====
  const [flowPage, setFlowPage] = React.useState<FlowPage | null>(null);

  const planQuery = useQuery<{ lines: PlanLine[] }>({
    queryKey: ["contract", contractId, "plan"],
    queryFn: async () => {
      const res = await apiGet<{ lines: PlanLine[] }>(`/api/contracts/${contractId}/plan`);
      return { lines: res.lines };
    },
  });

  const overviewQuery = useQuery<ContractOverviewResponse>({
    queryKey: ["contract", contractId, "overview"],
    queryFn: () => apiGet<ContractOverviewResponse>(`/api/contracts/${contractId}/overview`),
    enabled: page === "info" || flowPage === "settle",
  });

  const payViewQuery = useQuery<ContractPayViewResponse>({
    queryKey: ["contract", contractId, "pay-view"],
    queryFn: () => apiGet<ContractPayViewResponse>(`/api/contracts/${contractId}/pay-view`),
    enabled: page === "pay",
  });

  const boqQuery = useQuery<BoqResponse>({
    queryKey: ["contract", contractId, "boq"],
    queryFn: () => apiGet<BoqResponse>(`/api/contracts/${contractId}/boq`),
    enabled: page === "pay",
  });

  const supQuery = useQuery<SupervisionResponse>({
    queryKey: ["contract", contractId, "supervision"],
    queryFn: () => apiGet<SupervisionResponse>(`/api/contracts/${contractId}/supervision`),
    enabled: page === "info",
  });

  const detail = detailQuery.data?.contract ?? null;
  const detailData = detailQuery.data ?? null;

  // العقد اليدوي يفتح على المسار الفني أول مرة (V4.56: العقد اليدوي يفتح على مساره مباشرة)
  React.useEffect(() => {
    if (!initialPageApplied.current && detailData?.contract.manualPath) {
      initialPageApplied.current = true;
      setPage("stages");
    }
  }, [detailData]);

  // تبويب «الأوامر التغييرية» مخفي لعقد الإشراف (دراسة الحالات الأربع §3) —
  // إن كان المستخدم على صفحة الأوامر لحظة تحميل عقد إشراف نُعيده إلى «نظرة عامة»
  React.useEffect(() => {
    if (detailData?.isSupervision) {
      setPage((p) => (p === "addendums" ? "info" : p));
    }
  }, [detailData]);

  // 401 ⇒ إعادة فحص الجلسة (ستظهر شاشة الدخول)
  React.useEffect(() => {
    const e = detailQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [detailQuery.error, onAuthError]);

  const invalidateAll = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["contract", contractId] });
    qc.invalidateQueries({ queryKey: ["contracts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }, [qc, contractId]);

  const fail = React.useCallback(
    (e: unknown, title: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title, description: errMessage(e) });
    },
    [onAuthError, toast]
  );

  // ===== نافذة تغيير الحالة =====
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [newStatus, setNewStatus] = React.useState("");
  const [statusReason, setStatusReason] = React.useState("");
  // مبلغ إغلاق الإلغاء — يظهر عند «ملغى» فقط (contract_hub.py:735 QInputDialog.getDouble)
  const [cancelCloseAmount, setCancelCloseAmount] = React.useState("0");

  const openStatus = () => {
    if (!detail) return;
    setNewStatus(detail.status);
    setStatusReason(detail.statusReason || "");
    setCancelCloseAmount("0");
    setStatusOpen(true);
  };

  const statusMutation = useMutation({
    mutationFn: () =>
      apiPatch(`/api/contracts/${contractId}`, {
        status: newStatus,
        statusReason: statusReason.trim(),
        ...(newStatus === "ملغى" ? { cancelCloseAmount: Number(cancelCloseAmount || 0) } : {}),
      }),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "تم تغيير الحالة", description: `أصبحت حالة العقد «${newStatus}»` });
      setStatusOpen(false);
    },
    onError: (e) => fail(e, "تعذر تغيير الحالة"),
  });

  const submitStatus = () => {
    if (STATUS_REASON_REQUIRED.has(newStatus) && !statusReason.trim()) {
      toast({
        variant: "destructive",
        title: "السبب إلزامي",
        description: `يجب إدخال سبب عند جعل العقد «${newStatus}»`,
      });
      return;
    }
    if (newStatus === "ملغى" && Number(cancelCloseAmount || 0) < 0) {
      toast({
        variant: "destructive",
        title: "مبلغ غير صالح",
        description: "مبلغ الإغلاق لا يمكن أن يكون سالبًا.",
      });
      return;
    }
    statusMutation.mutate();
  };

  // ===== إجراءات المراحل =====
  // عقد الخلفي: PATCH /api/contracts/[id]/stages/[stageId]
  //   بدء {startDate} / إنهاء {endDate:'today'} / تخطي {isSkipped:true} / إعادة فتح {endDate:''} أو {isSkipped:false}
  const stageAction = useMutation({
    mutationFn: ({ stageId, body }: { stageId: number; body: Record<string, unknown> }) =>
      apiPatch(`/api/contracts/${contractId}/stages/${stageId}`, body),
    onSuccess: () => {
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["contract", contractId, "overview"] });
      toast({ title: "تم", description: "حُدّثت حالة المرحلة" });
    },
    onError: (e) => fail(e, "تعذر تنفيذ الإجراء"),
  });

  const actStart = (stageId: number) => stageAction.mutate({ stageId, body: { startDate: todayStr() } });
  const actFinish = (stageId: number) => stageAction.mutate({ stageId, body: { endDate: "today" } });
  const actSkip = (stageId: number) => stageAction.mutate({ stageId, body: { isSkipped: true } });
  const actReopen = (stageId: number, skipped: boolean) =>
    stageAction.mutate({ stageId, body: skipped ? { isSkipped: false } : { endDate: "" } });

  const [skipDialog, setSkipDialog] = React.useState<{ stageId: number; name: string } | null>(null);

  const [addStageOpen, setAddStageOpen] = React.useState(false);
  // Task 82: parentName فارغ = تصنيف رئيسي · وإلا مرحلة فرعية تابعة له
  const [stageForm, setStageForm] = React.useState({ name: "", expectedDays: "", payPct: "", parentName: "" });

  const addStageMutation = useMutation({
    mutationFn: () => {
      const parent = String(stageForm.parentName || "");
      return apiPost(`/api/contracts/${contractId}/stages`, {
        name: stageForm.name.trim(),
        expectedDays: Number(stageForm.expectedDays || 0),
        payPct: Number(stageForm.payPct || 0),
        level: parent ? 2 : 1,
        parentName: parent,
      });
    },
    onSuccess: () => {
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["contract", contractId, "overview"] });
      toast({ title: "تمت الإضافة", description: "أُضيفت المرحلة للعقد" });
      setAddStageOpen(false);
      setStageForm({ name: "", expectedDays: "", payPct: "", parentName: "" });
    },
    onError: (e) => fail(e, "تعذر إضافة المرحلة"),
  });

  // ===== الدفعات =====
  const [addPayOpen, setAddPayOpen] = React.useState(false);
  // Task 82: stageId اختياري — الدفعة المرتبطة بمرحلة تُستحق تلقائيًا عند إنهائها
  const [payForm, setPayForm] = React.useState({ title: "", amount: "", dueDate: todayStr(), stageId: "" });

  // المرحلة 8: زر «تصدير Excel» في تاب الدفعات ⇒ xlsx حقيقي بتنزيل blob (كان window.open لCSV نصي)
  const [payExporting, setPayExporting] = React.useState(false);
  const onPayExport = React.useCallback(async () => {
    if (payExporting) return;
    try {
      setPayExporting(true);
      await fetchBlobDownload({
        url: `/api/contracts/${contractId}/pay-export?format=xlsx`,
        token: getStoredToken(),
        filename: `pay-blocks-${contractId}.xlsx`,
      });
      toast({ title: "تم التصدير", description: "نُزّل ملف Excel بنجاح" });
    } catch (e) {
      if ((e as { status?: number }).status === 401) onAuthError();
      else toast({ variant: "destructive", title: "تعذر التصدير", description: errMessage(e) });
    } finally {
      setPayExporting(false);
    }
  }, [contractId, onAuthError, payExporting, toast]);

  const addPayMutation = useMutation({
    mutationFn: () =>
      apiPost(`/api/contracts/${contractId}/plan`, {
        title: payForm.title.trim(),
        amount: Number(payForm.amount || 0),
        dueDate: payForm.dueDate,
        ...(payForm.stageId ? { stageId: Number(payForm.stageId) } : {}),
      }),
    onSuccess: () => {
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["contract", contractId, "pay-view"] });
      toast({ title: "تمت الإضافة", description: payForm.stageId ? "أُضيفت الدفعة وارتبطت بالمرحلة — تُستحق تلقائيًا عند إنهائها" : "أُضيفت الدفعة للخطة" });
      setAddPayOpen(false);
      setPayForm({ title: "", amount: "", dueDate: todayStr(), stageId: "" });
    },
    onError: (e) => fail(e, "رُفضت الإضافة"),
  });

  const [deletePayId, setDeletePayId] = React.useState<number | null>(null);
  const deletePayMutation = useMutation({
    mutationFn: (lineId: number) => apiDelete(`/api/contracts/${contractId}/plan/${lineId}`),
    onSuccess: () => {
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["contract", contractId, "pay-view"] });
      toast({ title: "تم الحذف", description: "حُذفت الدفعة من الخطة" });
      setDeletePayId(null);
    },
    onError: (e) => {
      setDeletePayId(null);
      fail(e, "تعذر حذف الدفعة");
    },
  });

  // ===== بنود الكميات (الصفحة الداخلية) — تأكيد الحذف يبقى نافذة =====
  const [deleteBoqId, setDeleteBoqId] = React.useState<number | null>(null);
  const deleteBoqMutation = useMutation({
    mutationFn: (itemId: number) => apiDelete(`/api/contracts/${contractId}/boq?itemId=${itemId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contract", contractId, "boq"] });
      toast({ title: "تم الحذف", description: "حُذف البند" });
      setDeleteBoqId(null);
    },
    onError: (e) => {
      setDeleteBoqId(null);
      fail(e, "تعذر حذف البند");
    },
  });

  // ===== الإشراف (الصفحة الداخلية) — التنازل يبقى نافذة (حقلان) =====
  const [waiveOpen, setWaiveOpen] = React.useState(false);
  const [waiveForm, setWaiveForm] = React.useState({ months: "", reason: "" });

  const waiveMutation = useMutation({
    mutationFn: () =>
      apiPatch(`/api/contracts/${contractId}/supervision`, {
        months: Number(waiveForm.months || 0),
        reason: waiveForm.reason.trim(),
      }),
    onSuccess: () => {
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["contract", contractId, "overview"] });
      toast({ title: "تم التنازل", description: "سُجّل تنازل أشهر الإشراف" });
      setWaiveOpen(false);
      setWaiveForm({ months: "", reason: "" });
    },
    onError: (e) => fail(e, "تعذر تسجيل التنازل"),
  });

  // ===== صفحة السند على هذا العقد (بدل النافذة) — تُعرض مكان شاشة العقد =====
  const [voucherPage, setVoucherPage] = React.useState<"receipt" | "payment" | null>(null);

  const invalidateVouchers = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["vouchers"] });
    qc.invalidateQueries({ queryKey: ["contract", contractId, "pay-view"] });
    qc.invalidateQueries({ queryKey: ["contract", contractId, "overview"] });
    invalidateAll();
  }, [qc, invalidateAll, contractId]);

  // ===== الباطن على هذا العقد =====
  const [subDetailId, setSubDetailId] = React.useState<number | null>(null);

  const contractSubsQuery = useQuery<SubContractsResponse>({
    queryKey: ["sub-contracts", "contract", contractId],
    queryFn: () => apiGet<SubContractsResponse>(`/api/sub-contracts?contractId=${contractId}`),
    enabled: page === "pay" || flowPage === "sub-new" || subDetailId !== null,
  });

  // ===== حالات التحميل والأخطاء =====
  if (detailQuery.isLoading) return <DetailSkeleton />;

  if (detailQuery.isError || !detail || !detailData) {
    return (
      <Card className="border-status-danger/40">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <AlertTriangle className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{errMessage(detailQuery.error)}</p>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={onBack}>
            <ArrowRight className="size-4" />
            رجوع للعقود
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ===== الصفحات الداخلية الكاملة — تُعرض مكان شاشة العقد (بدل النوافذ الكبرى) =====
  if (flowPage === "edit") {
    return (
      <ContractEditPage
        contractId={contractId}
        onAuthError={onAuthError}
        onSaved={() => setFlowPage(null)}
        onCancel={() => setFlowPage(null)}
      />
    );
  }
  if (flowPage === "sub-new") {
    return (
      <SubContractNewPage
        contractId={contractId}
        contractNumber={detail.contractNumber}
        user={user}
        onAuthError={onAuthError}
        onCancel={() => setFlowPage(null)}
      />
    );
  }
  if (flowPage === "settle") {
    return (
      <ContractSettlePage
        contractId={contractId}
        contractNumber={detail.contractNumber}
        onAuthError={onAuthError}
        onCancel={() => setFlowPage(null)}
      />
    );
  }
  if (flowPage === "boq") {
    return (
      <ContractBoqPage
        contractId={contractId}
        contractNumber={detail.contractNumber}
        onAuthError={onAuthError}
        onSaved={() => setFlowPage(null)}
        onCancel={() => setFlowPage(null)}
      />
    );
  }
  if (flowPage === "sup") {
    return (
      <ContractSupervisionPage
        contractId={contractId}
        contractNumber={detail.contractNumber}
        onAuthError={onAuthError}
        onSaved={() => setFlowPage(null)}
        onCancel={() => setFlowPage(null)}
      />
    );
  }

  // صفحة السند (بدل النافذة) — تُعرض مكان شاشة العقد؛ إن فُتحت من حوار الباطن فيعود إليه بعد الإغلاق
  if (voucherPage) {
    return (
      <VoucherPage
        user={user}
        onAuthError={onAuthError}
        mode={voucherPage}
        onSaved={() => {
          invalidateVouchers();
          setVoucherPage(null);
        }}
        onCancel={() => setVoucherPage(null)}
      />
    );
  }

  const cur = detail.currency || "د.ك";
  const sup = detailData.sup;
  const hasSupervision = detailData.isSupervision || (detail.supMonths ?? 0) > 0;
  // شارة المسار — الحالات الأربع من دراسة المكتبي (§3، بصياغة §4-3 المصحّحة): يدوي/إشراف/إجباري
  const manualPath = Boolean(detail.manualPath);
  const isSupervision = Boolean(detailData.isSupervision);
  const remaining = detailData.remaining;
  const stages = [...(detailData.stages ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const l1Stages = stages.filter((s) => (s.level ?? 1) === 1);

  // ===== Task 82 — تصنيفات المسار الفني (رئيسيات وفرعياتها بالاقتران بالترتيب) =====
  // حساب مباشر بلا useMemo — توجد early returns أعلى المكوّن (قواعد الـ hooks)
  const stageGroups: { parent: (typeof stages)[number]; children: (typeof stages)[number][] }[] = [];
  for (const st of stages) {
    if ((st.level ?? 1) === 2 && stageGroups.length > 0) {
      stageGroups[stageGroups.length - 1].children.push(st);
    } else {
      stageGroups.push({ parent: st, children: [] });
    }
  }
  const hasStageHierarchy = stageGroups.some((g) => g.children.length > 0);
  const overview = overviewQuery.data ?? null;
  const planLines = planQuery.data?.lines ?? [];

  // دفعات كل مرحلة (stageId ⇒ عدد + مجموع) — تظهر داخل صف المرحلة (Task 82)
  const stagePayMap = new Map<number, { count: number; sum: number }>();
  for (const l of planLines) {
    if (l.stageId == null) continue;
    const entry = stagePayMap.get(l.stageId) ?? { count: 0, sum: 0 };
    entry.count += 1;
    entry.sum = Math.round((entry.sum + l.amountN) * 1000) / 1000;
    stagePayMap.set(l.stageId, entry);
  }
  const stageNameById = new Map(stages.map((s) => [s.id, s.name] as const));

  // عرض صف مرحلة واحد (يُستخدم في القائمة المسطحة وفي تابات التصنيفات) — Task 82
  const renderStageRow = (st: (typeof stages)[number], globalIdx: number, child = false) => {
    const state: "skipped" | "done" | "active" | "pending" = st.isSkipped
      ? "skipped"
      : st.endDate
        ? "done"
        : st.startDate
          ? "active"
          : "pending";
    const payInfo = stagePayMap.get(st.id);
    return (
      <li
        key={st.id}
        className={`relative rounded-lg border bg-card p-3 ${child ? "ms-6 border-dashed bg-muted/20" : ""}`}
      >
        <span className="absolute -start-[1.42rem] top-4 flex size-5 items-center justify-center rounded-full border bg-background text-[10px] font-bold">
          {globalIdx + 1}
        </span>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {child && <span className="text-xs text-muted-foreground">↳</span>}
              <span className={`font-semibold ${child ? "text-sm" : ""}`}>{st.name}</span>
              {state === "skipped" && (
                <Badge className="bg-status-done-bg text-status-done">متخطاة</Badge>
              )}
              {state === "done" && (
                <Badge className="bg-status-done-bg text-status-done">منتهية</Badge>
              )}
              {state === "active" && (
                <Badge className="bg-status-warn-bg text-status-warn">جارية</Badge>
              )}
              {state === "pending" && <Badge variant="secondary">لم تبدأ</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
              {Number(st.expectedDays) > 0 && <span>المدة المتوقعة: {st.expectedDays} يوم</span>}
              {Number(st.payPct) > 0 && <span>نسبة الدفع: {st.payPct}%</span>}
              <span>البدء: {fmtDate(st.startDate)}</span>
              <span>النهاية: {fmtDate(st.endDate)}</span>
              {(st.isSkipped || st.endDate) && st.closedBy && <span>بواسطة: {st.closedBy}</span>}
              {payInfo && (
                <span
                  className="font-medium text-foreground/70"
                  title="دفعات مرتبطة بهذه المرحلة — تُستحق تلقائيًا عند إنهائها"
                >
                  ⚙ دفعات مرتبطة: {payInfo.count} ({formatKWD(payInfo.sum)} {cur})
                </span>
              )}
            </div>
            {st.isSkipped && <p className="mt-1 text-xs text-muted-foreground">دفعاتها المرحلية غير مستحقة.</p>}
          </div>
          {manager && (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {!st.startDate && !st.isSkipped && (
                <Button size="sm" className="h-9 gap-1" disabled={stageAction.isPending} onClick={() => actStart(st.id)}>
                  <Play className="size-3.5" />
                  بدء
                </Button>
              )}
              {st.startDate && !st.endDate && !st.isSkipped && (
                <>
                  <Button size="sm" className="h-9 gap-1" disabled={stageAction.isPending} onClick={() => actFinish(st.id)}>
                    <CheckCircle2 className="size-3.5" />
                    إنهاء
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1"
                    disabled={stageAction.isPending}
                    onClick={() => setSkipDialog({ stageId: st.id, name: st.name })}
                  >
                    <SkipForward className="size-3.5" />
                    تخطي
                  </Button>
                </>
              )}
              {(st.endDate || st.isSkipped) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1"
                  disabled={stageAction.isPending}
                  onClick={() => actReopen(st.id, Boolean(st.isSkipped))}
                >
                  <RotateCcw className="size-3.5" />
                  إعادة فتح
                </Button>
              )}
            </div>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-4">
      {/* رأس العقد */}
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={onBack} aria-label="رجوع">
                <ArrowRight className="size-4" />
              </Button>
              <span className="font-bold text-primary" dir="ltr">
                {detail.contractNumber}
              </span>
              <StatusBadge status={detail.status} className="px-2 py-0.5 text-[11px]" />
              {/* شارة المسار (§3): 🔧 اليدوي · 👁 الإشراف (مساره إجباري من قالب النوع) · 📏 الإجباري */}
              {manualPath ? (
                <Badge className="px-2 py-0.5 text-[11px] bg-status-warn-bg text-status-warn">
                  🔧 مسار يدوي
                </Badge>
              ) : isSupervision ? (
                <Badge className="px-2 py-0.5 text-[11px] bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                  👁 إشراف — مسار إجباري
                </Badge>
              ) : (
                <Badge variant="secondary" className="px-2 py-0.5 text-[11px]">📏 مسار إجباري</Badge>
              )}
              {hasSupervision && (
                <Badge variant="secondary" className="gap-1 bg-status-done-bg text-status-done">
                  <Building2 className="size-3" />
                  إشراف هندسي
                </Badge>
              )}
              {/* G6 — نمط تسعير هذا العقد تحديدًا (يحسم من بيانات العقد قبل النوع) */}
              {overview?.pricingMode && (
                <Badge variant="secondary" className="gap-1 bg-status-info-bg text-status-info" title="نمط التسعير المحدود لهذا العقد — يحسم من بيانات العقد قبل إعدادات النوع">
                  نمط التسعير: {PRICING_MODE_AR[overview.pricingMode] || overview.pricingMode}
                </Badge>
              )}
            </div>
            <h1 className="mt-1 truncate text-lg font-bold">{detail.contractName || "عقد بلا اسم"}</h1>
            <p className="text-sm text-muted-foreground">
              العميل: <span className="font-medium text-foreground">{detail.customer?.name || "—"}</span>
              {" · "}النوع: {detail.contractType || "—"}
            </p>
            {(detail.statusReason || "").trim() && (
              <p className="mt-1 text-xs text-muted-foreground">السبب: {detail.statusReason}</p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* ◉ ملف العميل — فتح ملف العميل صاحب هذا العقد (كالمكتبي dealings._open_customer) */}
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              title="فتح ملف العميل صاحب هذا العقد"
              disabled={!onOpenCustomerFile || !detail.customerId}
              onClick={() => detail.customerId && onOpenCustomerFile?.(detail.customerId)}
            >
              ◉ ملف العميل
            </Button>
            {/* ☰ إجراءات العقد — المرجع: contract_hub.py:248–282 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="h-9 gap-1.5" title="إظهار إجراءات العقد عند الحاجة">
                  <Menu className="size-4" />
                  ☰ إجراءات العقد
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem className="gap-2" onClick={() => setFlowPage("edit")}>
                  <Pencil className="size-4" />
                  ✎ تعديل البيانات
                </DropdownMenuItem>
                {manager && (
                  <DropdownMenuItem className="gap-2" onClick={openStatus}>
                    <ArrowLeftRight className="size-4" />
                    ⇄ تغيير الحالة
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="gap-2"
                  disabled={!onOpenStatement}
                  onClick={() => onOpenStatement?.({ kind: "contract", id: contractId })}
                >
                  <FileText className="size-4" />
                  ▦ كشف حساب
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="gap-2" onClick={() => setWaiveOpen(true)}>
                  <BadgeCheck className="size-4" />
                  ✖ إلغاء أشهر تمديد
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" onClick={() => setFlowPage("settle")}>
                  <CheckCircle2 className="size-4" />
                  ✔ تصفية وإغلاق
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>تاريخ العقد: {fmtDate(detail.contractDate)}</span>
          <span>التوقيع: {fmtDate(detail.signDate)}</span>
          <span>البدء: {fmtDate(detail.startDate)}</span>
          <span>الانتهاء: {fmtDate(detail.endDate)}</span>
        </div>
      </Card>

      {/* البطاقات المالية */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <FinCard icon={Wallet} label="القيمة الأصلية" value={formatKWD(detail.amount)} />
        <FinCard
          icon={TrendingUp}
          label="القيمة الحالية"
          value={formatKWD(detailData.current)}
          hint={hasSupervision ? "تشمل تمديد الإشراف" : undefined}
          tone="text-primary"
        />
        <FinCard icon={HandCoins} label="المحصّل" value={formatKWD(detailData.collected)} />
        <FinCard
          icon={Banknote}
          label="المتبقي"
          value={formatKWD(remaining)}
          tone={remaining > 0 ? "text-status-warn" : "text-status-done"}
        />
      </div>

      {/* PageNav — أربع صفحات بمجموعاتها (contract_hub.py:129–135) */}
      <div className="flex flex-wrap items-stretch justify-between gap-2" role="tablist" aria-label="صفحات العقد">
        <div className="flex flex-1 flex-wrap gap-1.5">
          {/* تبويب «الأوامر التغييرية» مخفي لعقد الإشراف (دراسة الحالات الأربع §3) */}
          {(isSupervision ? PAGE_GROUPS.filter((g) => g.key !== "addendums") : PAGE_GROUPS).map((g) => {
            const active = page === g.key;
            return (
              <button
                key={g.key}
                role="tab"
                aria-selected={active}
                onClick={() => setPage(g.key)}
                className={`min-h-[44px] flex-1 basis-40 rounded-lg border px-3 py-1.5 text-start transition-colors ${
                  active
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card hover:bg-muted/60"
                }`}
              >
                <span className={`block text-[10px] font-medium ${active ? "text-primary" : "text-muted-foreground"}`}>
                  {g.group}
                </span>
                <span className={`block text-sm font-bold ${active ? "text-primary" : ""}`}>{g.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ===== الصفحة 1: المسار الفني (_tab_stages) ===== */}
      {page === "stages" && (
        <div className="space-y-3">
          {manager && (
            <div className="flex justify-end">
              <Button size="sm" className="h-9 gap-1.5" onClick={() => setAddStageOpen(true)}>
                <Plus className="size-4" />
                إضافة مرحلة
              </Button>
            </div>
          )}
          {stages.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                لا مراحل على هذا العقد — الاستحقاق يعتمد على تواريخ الدفعات فقط.
              </CardContent>
            </Card>
          ) : !hasStageHierarchy ? (
            <ol className="relative space-y-2 border-s-2 ps-4">
              {stages.map((st, i) => renderStageRow(st, i))}
            </ol>
          ) : (
            <Tabs defaultValue="all" dir="rtl">
              <TabsList className="h-auto max-w-full flex-wrap justify-start gap-1 overflow-x-auto">
                <TabsTrigger value="all" className="gap-1">
                  الكل
                  <span className="text-[10px] text-muted-foreground">({stages.length})</span>
                </TabsTrigger>
                {stageGroups.map((g, gi) => (
                  <TabsTrigger key={g.parent.id} value={`g-${gi}`} className="gap-1">
                    {g.parent.name}
                    <span className="text-[10px] text-muted-foreground">({g.children.length + 1})</span>
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="all">
                <ol className="relative space-y-2 border-s-2 ps-4">
                  {stages.map((st, i) => renderStageRow(st, i))}
                </ol>
              </TabsContent>
              {stageGroups.map((g, gi) => (
                <TabsContent key={g.parent.id} value={`g-${gi}`}>
                  <ol className="relative space-y-2 border-s-2 ps-4">
                    {renderStageRow(g.parent, stages.findIndex((s) => s.id === g.parent.id))}
                    {g.children.map((c) =>
                      renderStageRow(c, stages.findIndex((s) => s.id === c.id), true)
                    )}
                  </ol>
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>
      )}

      {/* ===== الصفحة 2: نظرة عامة (_tab_dashboard) ===== */}
      {page === "info" && (
        <OverviewPage
          detail={detailData}
          overview={overview}
          overviewLoading={overviewQuery.isLoading}
          sup={sup}
          supActualEnd={supQuery.data?.actualEnd ?? ""}
          supLoading={supQuery.isLoading}
          manager={manager}
          cur={cur}
          stages={l1Stages}
          planLines={planLines}
          planLoading={planQuery.isLoading}
          user={user}
          stageAction={stageAction}
          onSkipStage={(stageId, name) => setSkipDialog({ stageId, name })}
          onActionError={fail}
          onOpenSupDialog={() => setFlowPage("sup")}
          onWaive={() => setWaiveOpen(true)}
          onSettle={() => setFlowPage("settle")}
        />
      )}

      {/* ===== الصفحة 3: الدفعات والمقاولون (_tab_pay) ===== */}
      {page === "pay" && (
        <PayPage
          manager={manager}
          cur={cur}
          payView={payViewQuery.data ?? null}
          payViewLoading={payViewQuery.isLoading}
          payViewError={payViewQuery.error ? errMessage(payViewQuery.error) : ""}
          stageNameById={stageNameById}
          boq={boqQuery.data?.items ?? []}
          boqLoading={boqQuery.isLoading}
          subs={contractSubsQuery.data?.items ?? []}
          onAddPay={() => setAddPayOpen(true)}
          onDeletePay={(id) => setDeletePayId(id)}
          onReceipt={() => setVoucherPage("receipt")}
          onPayment={() => setVoucherPage("payment")}
          onExport={onPayExport}
          exporting={payExporting}
          onAddBoq={() => setFlowPage("boq")}
          onDeleteBoq={(id) => setDeleteBoqId(id)}
          onSubDetail={(id) => setSubDetailId(id)}
          onNewSub={() => setFlowPage("sub-new")}
        />
      )}

      {/* ===== الصفحة 4: الأوامر والتعديلات (_tab_addendums) ===== */}
      {page === "addendums" &&
        (isSupervision ? (
          /* الأوامر التغييرية غير متاحة لعقود الإشراف (دراسة الحالات الأربع §3) */
          <Card className="border-dashed">
            <CardContent className="p-4 text-sm text-muted-foreground">
              الأوامر التغييرية غير متاحة لعقود الإشراف.
            </CardContent>
          </Card>
        ) : (
          <div>
            {detailData ? (
              <AddendumsTab contract={detailData} user={user} onAuthError={onAuthError} />
            ) : (
              <div className="space-y-2">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            )}
          </div>
        ))}

      {/* ===== نافذة تغيير الحالة ===== */}
      <Dialog open={statusOpen} onOpenChange={setStatusOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>تغيير حالة العقد</DialogTitle>
            <DialogDescription>الحالة الحالية: {detail.status}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>الحالة الجديدة</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_CHANGE_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>
                {newStatus === "ملغى" ? "سبب إلغاء العقد" : "السبب"}
                {STATUS_REASON_REQUIRED.has(newStatus) && <span className="text-destructive"> *</span>}
              </Label>
              <Textarea
                rows={2}
                placeholder={
                  newStatus === "ملغى"
                    ? "اكتب سبب الإلغاء / التوضيح الذي سيظهر في سجل العقد:"
                    : STATUS_REASON_REQUIRED.has(newStatus)
                      ? "إلزامي للإغلاق"
                      : "اختياري"
                }
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
              />
            </div>
            {newStatus === "ملغى" && (
              <div className="space-y-1.5">
                <Label htmlFor="status-close-amount">مبلغ إغلاق الإلغاء</Label>
                <Input
                  id="status-close-amount"
                  className="h-9"
                  dir="ltr"
                  type="number"
                  min="0"
                  step="0.001"
                  value={cancelCloseAmount}
                  onChange={(e) => setCancelCloseAmount(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  اكتب مبلغ الإغلاق/التسوية عند إلغاء العقد (0 إذا لا يوجد):
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setStatusOpen(false)} disabled={statusMutation.isPending}>
              إلغاء
            </Button>
            <Button className="h-9" onClick={submitStatus} disabled={statusMutation.isPending || !newStatus}>
              {statusMutation.isPending ? "جارٍ التنفيذ…" : "تطبيق"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تخطي مرحلة ===== */}
      <Dialog open={skipDialog !== null} onOpenChange={(open) => !open && setSkipDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>تخطي المرحلة</DialogTitle>
            <DialogDescription>
              سيُعلَّم تخطي «{skipDialog?.name}» ولن تُستحق دفعاتها المرحلية تلقائيًا.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setSkipDialog(null)} disabled={stageAction.isPending}>
              إلغاء
            </Button>
            <Button
              className="h-9"
              disabled={stageAction.isPending}
              onClick={() => {
                if (!skipDialog) return;
                const id = skipDialog.stageId;
                setSkipDialog(null);
                actSkip(id);
              }}
            >
              {stageAction.isPending ? "جارٍ التنفيذ…" : "تأكيد التخطي"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== إضافة مرحلة ===== */}
      <Dialog open={addStageOpen} onOpenChange={setAddStageOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>إضافة مرحلة</DialogTitle>
            <DialogDescription>تُضاف في نهاية الترتيب الحالي — كتصنيف رئيسي أو فرعية تابعة له.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="st-name">اسم المرحلة *</Label>
              <Input id="st-name" className="h-9" value={stageForm.name} onChange={(e) => setStageForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>التصنيف</Label>
              <Select
                value={stageForm.parentName || "__root"}
                onValueChange={(v) => setStageForm((f) => ({ ...f, parentName: v === "__root" ? "" : v }))}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="تصنيف رئيسي" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="__root">تصنيف رئيسي</SelectItem>
                  {(detailData.stages ?? [])
                    .filter((s) => (s.level ?? 1) === 1)
                    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
                    .map((s) => (
                      <SelectItem key={s.id} value={s.name}>
                        فرعية تابعة لـ: {s.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="st-days">المدة المتوقعة (يوم)</Label>
                <Input id="st-days" className="h-9" dir="ltr" type="number" min="0" value={stageForm.expectedDays} onChange={(e) => setStageForm((f) => ({ ...f, expectedDays: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="st-pct">نسبة الدفع %</Label>
                <Input id="st-pct" className="h-9" dir="ltr" type="number" min="0" max="100" value={stageForm.payPct} onChange={(e) => setStageForm((f) => ({ ...f, payPct: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setAddStageOpen(false)} disabled={addStageMutation.isPending}>
              إلغاء
            </Button>
            <Button
              className="h-9"
              disabled={addStageMutation.isPending || !stageForm.name.trim()}
              onClick={() => addStageMutation.mutate()}
            >
              {addStageMutation.isPending ? "جارٍ الإضافة…" : "إضافة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== إضافة دفعة ===== */}
      <Dialog open={addPayOpen} onOpenChange={setAddPayOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>إضافة دفعة للخطة</DialogTitle>
            <DialogDescription>
              مجموع الدفعات اليدوية لا يتجاوز القيمة الحالية للعقد — يتحقق النظام من السقف.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pay-title">العنوان *</Label>
              <Input id="pay-title" className="h-9" value={payForm.title} onChange={(e) => setPayForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pay-amount">المبلغ (د.ك) *</Label>
                <Input id="pay-amount" className="h-9" dir="ltr" type="number" min="0" step="0.001" value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pay-due">الاستحقاق *</Label>
                <Input id="pay-due" className="h-9" dir="ltr" type="date" value={payForm.dueDate} onChange={(e) => setPayForm((f) => ({ ...f, dueDate: e.target.value }))} />
              </div>
            </div>
            {(detailData.stages ?? []).length > 0 && (
              <div className="space-y-1.5">
                <Label>المرحلة (اختياري)</Label>
                <SearchableSelect
                  value={payForm.stageId}
                  onValueChange={(v) => setPayForm((f) => ({ ...f, stageId: v }))}
                  options={[
                    { value: "", label: "بدون مرحلة — تستحق بالتاريخ فقط" },
                    ...[...(detailData.stages ?? [])]
                      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
                      .map((s, i) => ({
                        value: String(s.id),
                        label: `${i + 1} · ${s.name}`,
                      })),
                  ]}
                  placeholder="اختر المرحلة المرتبطة"
                  searchPlaceholder="ابحث باسم المرحلة…"
                  emptyText="لا نتائج مطابقة"
                />
                <p className="text-xs text-muted-foreground">
                  الدفعة المرتبطة بمرحلة تُستحق تلقائيًا عند إنهائها — وتولد مطالبة تلقائية إن لم تكن مغطاة.
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setAddPayOpen(false)} disabled={addPayMutation.isPending}>
              إلغاء
            </Button>
            <Button
              className="h-9"
              disabled={addPayMutation.isPending || !payForm.title.trim() || !(Number(payForm.amount) > 0)}
              onClick={() => addPayMutation.mutate()}
            >
              {addPayMutation.isPending ? "جارٍ الإضافة…" : "إضافة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تأكيد حذف دفعة ===== */}
      <AlertDialog open={deletePayId !== null} onOpenChange={(open) => !open && setDeletePayId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الدفعة؟</AlertDialogTitle>
            <AlertDialogDescription>سيُحذف سطر الدفعة من خطة الدفعات. لا يمكن التراجع.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9">إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="h-9 bg-destructive text-white hover:bg-destructive/90"
              disabled={deletePayMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deletePayId !== null) deletePayMutation.mutate(deletePayId);
              }}
            >
              {deletePayMutation.isPending ? "جارٍ الحذف…" : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== تأكيد حذف بند ===== */}
      <AlertDialog open={deleteBoqId !== null} onOpenChange={(open) => !open && setDeleteBoqId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف البند؟</AlertDialogTitle>
            <AlertDialogDescription>سيُحذف البند من بنود الكميات (حذف ناعم).</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9">إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="h-9 bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteBoqMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteBoqId !== null) deleteBoqMutation.mutate(deleteBoqId);
              }}
            >
              {deleteBoqMutation.isPending ? "جارٍ الحذف…" : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== تنازل إشراف ===== */}
      <Dialog open={waiveOpen} onOpenChange={setWaiveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>تنازل عن أشهر إشراف</DialogTitle>
            <DialogDescription>يُخفّض الأشهر المحتسبة — بحد أقصى التمديد غير المدفوع.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="wv-months">عدد الأشهر *</Label>
              <Input id="wv-months" className="h-9" dir="ltr" type="number" min="0" value={waiveForm.months} onChange={(e) => setWaiveForm((f) => ({ ...f, months: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wv-reason">السبب</Label>
              <Textarea id="wv-reason" rows={2} value={waiveForm.reason} onChange={(e) => setWaiveForm((f) => ({ ...f, reason: e.target.value }))} />
            </div>
            <p className="text-xs text-muted-foreground">
              الحد الأقصى المتاح الآن: {Number(sup?.unpaidExtMonths ?? 0)} شهر.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setWaiveOpen(false)} disabled={waiveMutation.isPending}>
              إلغاء
            </Button>
            <Button
              className="h-9"
              disabled={waiveMutation.isPending || !(Number(waiveForm.months) > 0)}
              onClick={() => waiveMutation.mutate()}
            >
              {waiveMutation.isPending ? "جارٍ التنفيذ…" : "تنازل"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تفاصيل عقد الباطن ===== */}
      <SubContractDialog
        subContractId={subDetailId}
        onOpenChange={(o) => !o && setSubDetailId(null)}
        user={user}
        onAuthError={onAuthError}
        onPay={() => setVoucherPage("payment")}
      />

    </div>
  );
}

// ===================================================================
// الصفحة 2: نظرة عامة — _tab_dashboard (407) + المؤشرات (2098–2135)
// ===================================================================
function OverviewPage({
  detail,
  overview,
  overviewLoading,
  sup,
  supActualEnd,
  supLoading,
  manager,
  cur,
  stages,
  planLines,
  planLoading,
  user,
  stageAction,
  onSkipStage,
  onActionError,
  onOpenSupDialog,
  onWaive,
  onSettle,
}: {
  detail: ContractDetailResponse;
  overview: ContractOverviewResponse | null;
  overviewLoading: boolean;
  sup: ContractDetailResponse["sup"];
  supActualEnd: string;
  supLoading: boolean;
  manager: boolean;
  cur: string;
  stages: ContractDetailResponse["stages"];
  planLines: PlanLine[];
  planLoading: boolean;
  user: User;
  stageAction: StageActionMut;
  onSkipStage: (stageId: number, name: string) => void;
  onActionError: (e: unknown, title: string) => void;
  onOpenSupDialog: () => void;
  onWaive: () => void;
  onSettle: () => void;
}) {
  const [showDetails, setShowDetails] = React.useState(false);

  const current = overview?.currentValue ?? detail.current;
  const collected = overview?.totalReceipts ?? detail.collected;
  const timePct = overview?.timeline.percent ?? 0;
  const timeStatus = overview?.timeline.timeStatus ?? "—";
  const collectedPct = current > 0.001 ? Math.round(((collected / current) * 100) * 10) / 10 : 0;
  const gap = timePct - collectedPct;
  const paceOverdue = current > 0.001 && gap > 15;

  // أقصى تأخر من الخطة (tooltip المتبقي)
  let maxLateDays = 0;
  for (const l of planLines) {
    if (l.remaining > 0.001 && (l.daysDiff ?? 0) < 0) maxLateDays = Math.max(maxLateDays, -Math.trunc(l.daysDiff ?? 0));
  }

  const settle = overview?.settlement ?? null;
  const money = (n: number) => `${formatKWD(n)} ${cur}`;

  return (
    <div className="space-y-3">
      {/* ملخص العقد (بطاقة المكتبي 433–454) */}
      {overviewLoading || !overview ? (
        <Skeleton className="h-44 rounded-xl" />
      ) : (
        <Card className="p-4">
          <CardHeader className="p-0 pb-2">
            <CardTitle className="text-base">ملخص العقد</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 p-0">
            <SumRow
              label="المتبقي"
              value={money(overview.remaining)}
              tone={
                overview.remaining <= 0.001
                  ? "text-status-done"
                  : maxLateDays > 0
                    ? "text-status-danger"
                    : "text-status-warn"
              }
              tooltip={maxLateDays > 0 ? `عليه دفعة متأخرة منذ ${maxLateDays} يومًا` : undefined}
            />
            <SumRow label="القيمة الحالية" value={money(overview.currentValue)} />
            <SumRow label="المحصّل" value={money(overview.totalReceipts)} />
            <SumRow label="الحالة الزمنية" value={timeStatus} />
          </CardContent>

          {/* شريطا التقدم (456–474) */}
          <div className="mt-3 space-y-2">
            <div>
              <div className="mb-1 flex items-center justify-between text-xs font-bold">
                <span>نسبة الإنجاز الزمني: {timePct}%</span>
              </div>
              <Progress value={Math.min(100, Math.max(0, timePct))} className="h-4" aria-label="نسبة الإنجاز الزمني" />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs font-bold">
                <span className="text-status-done">نسبة التحصيل المالي: {collectedPct}%</span>
              </div>
              <Progress value={Math.min(100, Math.max(0, collectedPct))} className="h-4" aria-label="نسبة التحصيل المالي" />
            </div>
            {current > 0.001 && (
              <p
                className={`text-sm font-bold ${paceOverdue ? "text-status-danger" : "text-status-done"}`}
                title={
                  paceOverdue
                    ? `الفارق ${Math.round(gap)} نقطة · المحصّل ${formatKWD(overview.totalReceipts)} من ${formatKWD(current)}`
                    : `المحصّل ${formatKWD(overview.totalReceipts)} من ${formatKWD(current)}`
                }
              >
                {paceOverdue
                  ? `⚠ التحصيل متأخر · الزمن ${Math.round(timePct)}% / التحصيل ${Math.round(collectedPct)}%`
                  : `التحصيل متوازن · الزمن ${Math.round(timePct)}% / التحصيل ${Math.round(collectedPct)}%`}
              </p>
            )}
          </div>

          {/* تفاصيل أكثر (484–537) */}
          <div className="mt-3">
            <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={() => setShowDetails((v) => !v)} title="عرض المؤشرات التفصيلية للعقد">
              {showDetails ? "إخفاء" : "تفاصيل أكثر"}
            </Button>
          </div>
          {showDetails && (
            <div className="mt-1 space-y-1 rounded-lg border bg-muted/20 p-3">
              {manager ? (
                <>
                  <SumRow label="إجمالي المنصرف الفعلي" value={money(overview.totalPayments)} />
                  <SumRow
                    label="الربح الفعلي"
                    value={money(overview.profit)}
                    tone={overview.profit >= 0 ? "text-status-done" : "text-status-danger"}
                    tooltip="الفعلي = إجمالي المحصل - إجمالي المنصرف"
                  />
                  <SumRow
                    label="الربح المتوقع"
                    value={money(overview.expectedProfit)}
                    tone={overview.expectedProfit >= 0 ? "text-status-done" : "text-status-danger"}
                    tooltip="المتوقع = إجمالي العقد - عقود الباطن - المنصرف الآخر عليه"
                  />
                </>
              ) : (
                <p className="text-xs font-medium text-status-warn" title="رؤية الربحية غير متاحة لحسابك">
                  رؤية الربحية غير متاحة لحسابك
                </p>
              )}
              <SumRow label="قيمة العقد الأصلية" value={money(overview.originalValue)} />
              <SumRow label="صافي أوامر التغيير" value={`${overview.addendumsNet >= 0 ? "+" : "−"}${formatKWD(Math.abs(overview.addendumsNet))} ${cur}`} />
              <SumRow
                label="تمديد الإشراف المستحق"
                value={`${overview.supExtension >= 0 ? "+" : "−"}${formatKWD(Math.abs(overview.supExtension))} ${cur}`}
                tooltip="يعامل كزيادة مستحقة على قيمة العقد بسبب تأخير/تمديد الإشراف"
              />
              <SumRow label="إجمالي عقود الباطن" value={money(overview.totalSubs)} />
              <SumRow label="تاريخ التعاقد" value={fmtDate(detail.contract.contractDate)} />
              <SumRow label="تاريخ البداية" value={fmtDate(detail.contract.startDate)} />
              <SumRow label="تاريخ النهاية" value={fmtDate(detail.contract.endDate)} />
              <SumRow label="مدة العقد" value={overview.timeline.duration ? `${overview.timeline.duration} يوم` : "-"} />
              <SumRow label="الأيام المنقضية" value={`${overview.timeline.elapsed} يوم`} />
              <SumRow label="الأيام المتبقية" value={`${overview.timeline.remaining} يوم`} />
            </div>
          )}
        </Card>
      )}

      {/* عقد إشراف هندسي (539–565 + 2120–2154) */}
      {supLoading ? (
        <Skeleton className="h-28 rounded-xl" />
      ) : (
        sup && (
          <Card className="border-border bg-muted/40">
            <CardHeader className="p-4 pb-1">
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm text-primary">
                <span>عقد إشراف هندسي</span>
                {manager && (
                  <span className="flex gap-1.5">
                    <Button variant="outline" size="sm" className="h-8 gap-1" onClick={onOpenSupDialog}>
                      <Pencil className="size-3.5" />
                      ضبط
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1"
                      onClick={onWaive}
                      title="إلغاء أشهر التمديد غير المسددة (مدير)"
                    >
                      <BadgeCheck className="size-3.5" />
                      ✕ إلغاء أشهر تمديد (مدير)
                    </Button>
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 p-4 pt-1 text-xs leading-6">
              <p>
                بداية الإشراف: {fmtDate(detail.contract.supStartDate)}  |  نهاية الإشراف الفعلية:{" "}
                {supActualEnd || "لم تُسجل بعد"}
              </p>
              <p>
                المدة: {Number(detail.contract.supMonths ?? 0)} شهر × {formatKWD(detail.contract.supMonthly)} ={" "}
                {formatKWD(sup.grossValue)}
                {Number(detail.contract.supDiscount ?? 0) > 0 ? ` · خصم ${formatKWD(detail.contract.supDiscount)}` : ""}
                {"  |  "}صافي الأساس: {formatKWD(sup.baseValue)}{"  |  "}نهاية المدة: {fmtDate(sup.baseEnd)}
              </p>
              <p>الوضع الزمني: {supTimeLeftText(detail.contract.supStartDate, sup.baseEnd)}</p>
              {sup.extensionValue > 0.001 && (
                <p>
                  تمديد مستحق: {sup.billableExtMonths} شهر = {formatKWD(sup.extensionValue)}
                  {paidExtText(sup, collected)}
                  {Number(detail.contract.supWaivedMonths ?? 0) > 0
                    ? `  · مُلغى بتنازل: ${Number(detail.contract.supWaivedMonths)} شهر`
                    : ""}
                </p>
              )}
              <p className="font-semibold">
                المستحق الكلي: {formatKWD(sup.totalDue)}  |  المحصّل: {formatKWD(sup.collected)}  |  المتبقي:{" "}
                {formatKWD(sup.remaining)}
              </p>
            </CardContent>
          </Card>
        )
      )}

      {/* بطاقة التصفية (567–583 + 2156–2199) */}
      {settle && detail.contract.status !== "مغلق" && detail.contract.status !== "ملغى" && (
        <Card className="border-status-done/40 bg-status-done-bg/60">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
            <p className="text-sm font-bold text-status-done">
              {settle.closable
                ? `✅ اكتمل تحصيل كامل قيمة العقد (${formatKWD(collected)} ${cur}) · ومسار المراحل مكتمل. يمكنك الآن تصفيته وإغلاقه.`
                : settle.stagesComplete && !settle.fullyCollected
                  ? `✅ مسار المراحل مكتمل. سيُتاح الإغلاق النهائي بعد تحصيل المتبقي: ${formatKWD(settle.remaining)} ${cur}.`
                  : settle.fullyCollected && settle.stageRequired && !settle.stagesComplete
                    ? "✅ التحصيل مكتمل، لكن الإغلاق النهائي ينتظر اكتمال مسار المراحل."
                    : ""}
            </p>
            {manager && settle.closable && (
              <Button size="sm" className="h-9 gap-1.5" onClick={onSettle} title="تصفية العقد وإغلاقه نهائيًا">
                <CheckCircle2 className="size-4" />
                ✔ تصفية وإغلاق العقد
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* لوحة المتابعة المضمنة (_sec_followup_panel — نسخة مدمجة من FollowupPanel) */}
      <FollowupPanelCompact
        stages={stages}
        stagePath={overview?.stagePath ?? null}
        loading={overviewLoading}
        manualPath={Boolean(detail.contract.manualPath)}
        manual={overview ? { done: overview.stagePath.manualDone, total: overview.stagePath.manualTotal, pct: overview.stagePath.manualPct } : null}
        planLines={planLines}
        planLoading={planLoading}
        contractId={detail.contract.id}
        contractNumber={detail.contract.contractNumber}
        status={detail.contract.status}
        manager={manager}
        username={user.username}
        stageAction={stageAction}
        onSkipStage={onSkipStage}
        onActionError={onActionError}
      />
    </div>
  );
}

function paidExtText(sup: NonNullable<ContractDetailResponse["sup"]>, collected: number): string {
  const paidExt = Math.max(0, Math.min(sup.extensionValue, collected - sup.baseValue));
  return paidExt > 0.001 ? `  (سُدد منها ${formatKWD(paidExt)})` : "";
}

/** المدة الباقية من الإشراف بالأشهر والأيام (supervision_service time_left_text) */
function supTimeLeftText(start: string | undefined, baseEnd: string): string {
  if (!start || !baseEnd) return "غير محدد";
  const today = new Date();
  const day = (d: Date) => Math.floor(d.getTime() / 86400000);
  const be = new Date(`${baseEnd}T00:00:00`);
  const td = day(today);
  const bed = day(be);
  if (td < bed) {
    // أشهر كاملة حتى نهاية المدة + الأيام الباقية
    let m = 0;
    const addMonths = (date: Date, n: number) => {
      const d = new Date(date);
      d.setMonth(d.getMonth() + n);
      return d;
    };
    while (day(addMonths(today, m + 1)) <= bed) m += 1;
    const dLeft = bed - day(addMonths(today, m));
    return `${monthsDaysText(m, dLeft)} حتى نهاية المدة`;
  }
  const overDays = td - bed;
  return overDays === 0 ? "انتهت المدة الأساسية اليوم" : `في التمديد منذ ${overDays} يوم`;
}

function monthsDaysText(m: number, d: number): string {
  const parts: string[] = [];
  if (m > 0) parts.push(m === 1 ? "شهر" : m === 2 ? "شهران" : `${m} أشهر`);
  if (d > 0) parts.push(d === 1 ? "يوم" : d === 2 ? "يومان" : `${d} يوم`);
  return parts.length ? parts.join(" و") : "صفر";
}

// ===================================================================
// لوحة المتابعة المضمنة — نسخة مدمجة من FollowupPanel (followup.py:487)
// + StageBar للعقود اليدوية (StageBar/بطاقة المسار اليدوي 602–622)
// + المرحلة 7-ب: أزرار الإجراء · ملاحظة المرحلة · الطابع الإشرافي ·
//   سجل المراحل · محادثة المعاملة · تجميد الملغى/المغلق
// ===================================================================

/** ملاحظة مرحلة — GET/POST /api/contracts/[id]/stage-notes */
interface StageNoteRow {
  id: number;
  stageName: string;
  note: string;
  author: string;
  createdAt: string;
}

/** رسالة محادثة المعاملة — GET/POST /api/contracts/[id]/messages */
interface TxMessageRow {
  id: number;
  username: string;
  body: string;
  createdAt: string;
}

/** حدث سجل المراحل — GET /api/contracts/[id]/stage-history */
interface StageHistoryRow {
  id: number;
  eventTime: string;
  eventType: string;
  description: string;
  username: string;
}

/** G4 — صف سجل نقل المراحل — GET /api/stage-moves?type=contract&id= */
interface StageMoveRow {
  id: number;
  action: string; // move | finish | revert | skip | reopen
  stageName: string;
  movedByName: string;
  note: string;
  startDate: string;
  endDate: string;
  movedAt: string;
}

const STAGE_MOVE_ACTION: Record<string, { label: string; cls: string }> = {
  move: { label: "نقل", cls: "bg-status-info-bg text-status-info" },
  finish: { label: "إنهاء", cls: "bg-slate-200 text-slate-700" },
  revert: { label: "تراجع", cls: "bg-status-warn-bg text-status-warn" },
  skip: { label: "تخطٍ", cls: "bg-status-danger-bg text-status-danger" },
  reopen: { label: "إعادة فتح", cls: "bg-status-info-bg text-status-info" },
};

/** سجل نقل المراحل الكامل بترقيم صفحات — المنفِّذ والملاحظة (G4) */
function StageMovesLog({ contractId }: { contractId: number }) {
  const [page, setPage] = React.useState(1);
  const pageSize = 10;
  const movesQuery = useQuery<{ total: number; page: number; pageSize: number; rows: StageMoveRow[] }>({
    queryKey: ["contract", contractId, "stage-moves", page],
    queryFn: () => apiGet(`/api/stage-moves?type=contract&id=${contractId}&page=${page}&pageSize=${pageSize}`),
  });
  const rows = movesQuery.data?.rows ?? [];
  const total = movesQuery.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  if (movesQuery.isLoading) return <Skeleton className="mt-3 h-10 rounded-lg" />;
  if (total === 0) return null;

  return (
    <div className="mt-4 border-t pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-bold text-muted-foreground">سجل نقل المراحل ({total})</h4>
        {pages > 1 && (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              السابق
            </Button>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {page} / {pages}
            </span>
            <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
              التالي
            </Button>
          </div>
        )}
      </div>
      <ul className="max-h-56 space-y-1.5 overflow-y-auto pe-1 text-xs leading-5">
        {rows.map((m) => {
          const kind = STAGE_MOVE_ACTION[m.action] ?? STAGE_MOVE_ACTION.move;
          return (
            <li key={m.id} className="rounded-md border px-2.5 py-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge className={`h-5 border-0 px-1.5 text-[10px] ${kind.cls}`}>{kind.label}</Badge>
                {m.stageName && <span className="font-medium">{m.stageName}</span>}
                <span className="text-muted-foreground">· {m.movedByName}</span>
                <span className="ms-auto text-[10px] text-muted-foreground tabular-nums">
                  {m.movedAt.slice(0, 16).replace("T", " ")}
                </span>
              </div>
              {(m.startDate || m.endDate) && (
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {m.startDate ? `من ${m.startDate}` : ""}{m.endDate ? ` · أُغلقت ${m.endDate}` : ""}
                </div>
              )}
              {m.note && <div className="mt-0.5 text-muted-foreground">{m.note}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FollowupPanelCompact({
  stages,
  stagePath,
  loading,
  manualPath,
  manual,
  planLines,
  planLoading,
  contractId,
  contractNumber,
  status,
  manager,
  username,
  stageAction,
  onSkipStage,
  onActionError,
}: {
  stages: ContractDetailResponse["stages"];
  stagePath: ContractOverviewResponse["stagePath"] | null;
  loading: boolean;
  manualPath: boolean;
  manual: { done: number; total: number; pct: number } | null;
  planLines: PlanLine[];
  planLoading: boolean;
  contractId: number;
  contractNumber: string;
  /** حالة العقد — الملغى/المغلق يجمّد كل أزرار المراحل (followup.py:712–717) */
  status: string;
  manager: boolean;
  username: string;
  stageAction: StageActionMut;
  onSkipStage: (stageId: number, name: string) => void;
  onActionError: (e: unknown, title: string) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const cur = stagePath?.current ?? null;
  const state = stagePath?.state ?? "done";
  const path = stagePath?.path ?? [];

  const frozen = status === "ملغى" || status === "مغلق";
  const today = todayStr();

  // ===== استعلامات اللوحة: الملاحظات · المحادثة · سجل المراحل =====
  const notesQuery = useQuery<{ notes: StageNoteRow[] }>({
    queryKey: ["contract", contractId, "stage-notes"],
    queryFn: () => apiGet<{ notes: StageNoteRow[] }>(`/api/contracts/${contractId}/stage-notes`),
  });
  const msgsQuery = useQuery<{ messages: TxMessageRow[] }>({
    queryKey: ["contract", contractId, "messages"],
    queryFn: () => apiGet<{ messages: TxMessageRow[] }>(`/api/contracts/${contractId}/messages`),
  });
  const historyQuery = useQuery<{ events: StageHistoryRow[] }>({
    queryKey: ["contract", contractId, "stage-history"],
    queryFn: () => apiGet<{ events: StageHistoryRow[] }>(`/api/contracts/${contractId}/stage-history`),
  });
  const invalidatePanel = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["contract", contractId] });
    qc.invalidateQueries({ queryKey: ["contracts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }, [qc, contractId]);

  // المرحلة الحالية: أول مرحلة بدأت ولم تُنهَ ولم تُتخطَ (stagePath.current عند توافره)
  const currentStage = React.useMemo(() => {
    if (cur) {
      const byId = stages.find((s) => s.id === cur.id);
      if (byId) return byId;
    }
    return stages.find((s) => s.startDate && !s.endDate && !s.isSkipped) ?? null;
  }, [cur, stages]);

  const payPctOf = React.useMemo(() => new Map(stages.map((s) => [s.id, Number(s.payPct || 0)])), [stages]);

  const counterText = manualPath
    ? `🔧 العقد على المسار اليدوي: علّم أي مرحلة من أي تصنيف — المنجز ${manual?.done ?? 0} من ${manual?.total ?? 0}.`
    : cur === null
      ? path.length === 0
        ? "لا مسار مراحل لهذا العقد."
        : "اكتمل مسار المراحل لهذه المعاملة."
      : state === "over"
        ? `🔴 متأخر: مر عليها ${cur.daysIn} يومًا (المتوقع ${cur.expectedDays}) — تجاوز ${cur.daysIn - cur.expectedDays} يوم`
        : state === "near"
          ? `🟡 قاربت على الانتهاء: ${cur.daysIn} يومًا من أصل ${cur.expectedDays} — بقي ${cur.expectedDays - cur.daysIn} يوم`
          : `🟢 مر عليها ${cur.daysIn} يومًا${cur.expectedDays ? ` (المتوقع ${cur.expectedDays})` : ""}`;

  const counterClass =
    state === "over"
      ? "text-status-danger"
      : state === "near"
        ? "text-status-warn"
        : "text-status-done";

  // سطر عدّاد الإشراف للمرحلة الحالية (followup.py:1143–1166)
  const supLine = (() => {
    if (!currentStage?.isSupervision || !currentStage.supEnd) return "";
    const supEnd = currentStage.supEnd;
    const supActualEnd = currentStage.supActualEnd || "";
    if (supActualEnd && today > supEnd) return `👁 إشراف: في التمديد · النهاية الكاملة ${supActualEnd}`;
    if (today > supEnd) return `👁 إشراف: متأخر · حتى ${supEnd}`;
    return `👁 إشراف: ضمن المدة · حتى ${supEnd}`;
  })();
  const supLineClass = supLine.startsWith("👁 إشراف: متأخر") ? "text-status-danger" : "text-status-warn";

  // الشريحة المختصرة: السابقة / الحالية / التالية (followup.py:1015–1083)
  const chips: { label: string; name: string; state: string; days: number; payPct: number }[] = [];
  if (manualPath) {
    for (const s of stages) {
      chips.push({
        label: "",
        name: s.name,
        state: s.endDate || s.isSkipped ? (s.isSkipped ? "skip" : "done") : s.startDate ? "current" : "future",
        days: 0,
        payPct: Number(s.payPct || 0),
      });
    }
  } else {
    const idx = cur ? path.findIndex((p) => p.id === cur.id) : path.length;
    for (const i of [idx - 1, idx, idx + 1]) {
      if (i >= 0 && i < path.length) {
        const p = path[i];
        chips.push({
          label: cur ? (i === idx - 1 ? "السابقة" : i === idx ? "الحالية" : "التالية") : "سابقة",
          name: p.name,
          state: p.state,
          days: p.days,
          payPct: payPctOf.get(p.id) ?? 0,
        });
      }
    }
  }

  const chipClass = (state: string) =>
    state === "done"
      ? "border-status-done/40 bg-status-done-bg text-status-done"
      : state === "skip"
        ? "border-border bg-muted text-muted-foreground"
        : state === "current"
          ? "border-status-warn/40 bg-status-warn-bg text-status-warn"
          : "border-border bg-muted/30 text-muted-foreground";
  const chipIcon = (state: string) => (state === "done" ? "✅" : state === "skip" ? "⏭️" : state === "current" ? "🔵" : "⚪");

  // الملاحظات: من ملاحظات خطوط الخطة (أحدثها أولًا)
  const notes = planLoading
    ? []
    : planLines
        .filter((l) => (l.notes || "").trim())
        .slice(-6)
        .reverse();

  // شارة آخر ملاحظة على المعاملة (V5.9 — followup.py:726–746)
  const lastNote = notesQuery.data?.notes?.[0] ?? null;

  // ===== نافذة ملاحظة المرحلة (StageNoteDialog — followup.py:395–484) =====
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [noteText, setNoteText] = React.useState("");
  const noteMutation = useMutation({
    mutationFn: () =>
      apiPost(`/api/contracts/${contractId}/stage-notes`, {
        note: noteText.trim(),
        stageName: currentStage?.name ?? "",
      }),
    onSuccess: () => {
      toast({ title: "تم حفظ الملاحظة — ظهرت في السجل والتعليقات ✅" });
      setNoteText("");
      setNoteOpen(false);
      qc.invalidateQueries({ queryKey: ["contract", contractId, "stage-notes"] });
      qc.invalidateQueries({ queryKey: ["contract", contractId, "stage-history"] });
    },
    onError: (e) => onActionError(e, "تعذر حفظ الملاحظة"),
  });
  const submitNote = () => {
    if (!noteText.trim()) {
      toast({ variant: "destructive", title: "اكتب الملاحظة أولًا." });
      return;
    }
    noteMutation.mutate();
  };

  // ===== نافذة التراجع عن مرحلة (مدير — followup.py:1330 _revert_stage) =====
  const [revertOpen, setRevertOpen] = React.useState(false);
  const [revertReason, setRevertReason] = React.useState("");
  const revertMutation = useMutation({
    mutationFn: () =>
      apiPatch<{ from: string; to: string }>(`/api/contracts/${contractId}/stages/${currentStage?.id ?? 0}`, {
        action: "revert",
        reason: revertReason.trim(),
      }),
    onSuccess: (res) => {
      toast({ title: `تم التراجع من «${res.from}» إلى «${res.to}»` });
      setRevertOpen(false);
      setRevertReason("");
      invalidatePanel();
    },
    onError: (e) => onActionError(e, "تعذر التراجع عن المرحلة"),
  });

  // ===== نافذة الطابع الإشرافي للمرحلة (V3.21 — followup.py:223–355) =====
  const [supOpen, setSupOpen] = React.useState(false);
  const [supForm, setSupForm] = React.useState({
    isSupervision: false,
    supEnd: "",
    supMonthly: "",
    supStart: "",
    supActualEnd: "",
  });
  const openSupDialog = () => {
    if (!currentStage) return;
    setSupForm({
      isSupervision: Boolean(currentStage.isSupervision),
      supEnd: currentStage.supEnd || "",
      supMonthly: currentStage.supMonthly !== undefined && currentStage.supMonthly !== null ? String(currentStage.supMonthly) : "",
      supStart: currentStage.supStart || "",
      supActualEnd: currentStage.supActualEnd || "",
    });
    setSupOpen(true);
  };
  // سطر الحالة في النافذة — بحسب الطابع المحفوظ حاليًا في الخانات
  const supStatusLine = !supForm.isSupervision
    ? "بلا طابع إشرافي — فعّل الخانة وحدد النهاية والقيمة ثم احفظ."
    : !supForm.supEnd
      ? "ناقص: حدد النهاية والقيمة ثم احفظ."
      : `👁 طابع إشرافي حتى ${supForm.supEnd}${supForm.supActualEnd && today > supForm.supEnd ? " · في التمديد" : ""}`;
  const supMutation = useMutation({
    mutationFn: () =>
      apiPatch<{ isSupervision: boolean; supStart: string; supEnd: string; supActualEnd: string; supMonthly: number }>(
        `/api/contracts/${contractId}/stages/${currentStage?.id ?? 0}`,
        {
          action: "supervision",
          isSupervision: supForm.isSupervision,
          supEnd: supForm.supEnd,
          supMonthly: Number(supForm.supMonthly || 0),
          supStart: supForm.supStart,
          supActualEnd: supForm.supActualEnd,
        }
      ),
    onSuccess: (res) => {
      toast({ title: "تم حفظ الطابع الإشرافي" });
      setSupForm((f) => ({
        ...f,
        isSupervision: res.isSupervision,
        supEnd: res.supEnd,
        supStart: res.supStart,
        supActualEnd: res.supActualEnd,
        supMonthly: String(res.supMonthly),
      }));
      invalidatePanel();
    },
    onError: (e) => onActionError(e, "تعذر حفظ الطابع الإشرافي"),
  });

  // ===== محادثة المعاملة (followup.py:624–654 + 1277–1299) =====
  const [msgText, setMsgText] = React.useState("");
  const msgMutation = useMutation({
    mutationFn: () => apiPost(`/api/contracts/${contractId}/messages`, { body: msgText.trim() }),
    onSuccess: () => {
      setMsgText("");
      qc.invalidateQueries({ queryKey: ["contract", contractId, "messages"] });
    },
    onError: (e) => onActionError(e, "تعذر إرسال الرسالة"),
  });

  const btnDisabled = frozen || stageAction.isPending;

  return (
    <>
      <Card className="p-4">
        <CardHeader className="p-0 pb-2">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span>🔄 مرحلة التنفيذ</span>
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              {/* V5.9: شارة آخر ملاحظة — كاملة في التلميح (followup.py:726–746) */}
              {lastNote && (
                <span
                  className="inline-flex max-w-56 items-center truncate rounded-full border px-2.5 py-1 text-[11px] font-bold text-status-warn"
                  title={`${lastNote.note}\n\n— ${lastNote.author || "مستخدم"} · ${lastNote.createdAt.slice(0, 16).replace("T", " ")}${lastNote.stageName ? ` · ${lastNote.stageName}` : ""}`}
                >
                  {noteChip(lastNote.note)}
                </span>
              )}
              <span className="text-sm font-bold">
                {cur ? `${pathPrefix(manualPath)}${cur.name}` : "اكتمل المسار ✓"}
              </span>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-0">
          {loading ? (
            <Skeleton className="h-16 rounded-lg" />
          ) : (
            <>
              {manualPath && manual && (
                <p className="text-sm font-bold text-primary">
                  المنجز {manual.done} من {manual.total} · {manual.pct}٪
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {chips.map((c, i) => (
                  <span
                    key={`${c.name}-${i}`}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${chipClass(c.state)}`}
                  >
                    {c.label ? `${c.label}: ` : ""}
                    {chipIcon(c.state)} {c.name}
                    {pctSuffix(c.payPct)}
                    {c.days > 0 ? ` · ${c.days} ي` : ""}
                  </span>
                ))}
                {chips.length === 0 && <span className="text-xs text-muted-foreground">لا مراحل على هذا العقد.</span>}
                {!manualPath && path.length > chips.length && chips.length > 0 && (
                  <span className="self-center text-[10.5px] text-muted-foreground">
                    + {path.length - chips.length} مرحلة أخرى في المسار
                  </span>
                )}
              </div>
              <p className={`text-sm font-bold ${counterClass}`}>{counterText}</p>
              {supLine && <p className={`text-sm font-bold ${supLineClass}`}>{supLine}</p>}
              {frozen && (
                <p className="text-sm font-bold text-status-danger">
                  🔒 العقد ملغى ومجمّد — لا يمكن تغيير المراحل أو تحفيز دفعات جديدة.
                </p>
              )}
              {/* أزرار الإجراء — نفس معالجات تبويب المراحل (PATCH stages/[stageId]) */}
              <div className="flex flex-wrap items-center gap-1.5">
                {currentStage && (
                  <>
                    <Button
                      size="sm"
                      className="h-8 gap-1"
                      disabled={btnDisabled}
                      onClick={() => stageAction.mutate({ stageId: currentStage.id, body: { endDate: "today" } })}
                      title="إغلاق المرحلة الحالية والانتقال للمرحلة التالية تلقائيًا"
                    >
                      <CheckCircle2 className="size-3.5" />
                      إنهاء المرحلة
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1"
                      disabled={btnDisabled}
                      onClick={() => onSkipStage(currentStage.id, currentStage.name)}
                      title="للحالات الاستثنائية — عقد لا يحتاج هذه المرحلة"
                    >
                      <SkipForward className="size-3.5" />
                      تخطي هذه المرحلة
                    </Button>
                    {manager && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                        disabled={btnDisabled}
                        onClick={() => setRevertOpen(true)}
                        title="للمدير فقط: إرجاع العقد للمرحلة السابقة مع عكس الاستحقاقات التلقائية الآمنة"
                      >
                        <RotateCcw className="size-3.5" />
                        تراجع مرحلة
                      </Button>
                    )}
                    {manager && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1"
                        disabled={btnDisabled}
                        onClick={openSupDialog}
                        title="المرحلة بطابع إشرافي: بداية/نهاية وتأخير شهور في ملف تأخيرات الإشراف"
                      >
                        <Eye className="size-3.5" />
                        طابع إشراف
                      </Button>
                    )}
                  </>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1"
                  disabled={frozen}
                  onClick={() => setNoteOpen(true)}
                  title="اكتب سبب التأخير أو «واقفة فين» بلا تغيير المرحلة — تظهر في سجل المراحل وتعليقات العميل"
                >
                  <FileText className="size-3.5" />
                  ملاحظة المرحلة
                </Button>
              </div>
              {notes.length > 0 && (
                <div className="rounded-lg border bg-muted/20 p-2">
                  <p className="mb-1 text-[11px] font-bold text-muted-foreground">📝 ملاحظات الدفعات والمراحل</p>
                  <ul className="space-y-0.5">
                    {notes.map((n) => (
                      <li key={n.id} className="truncate text-xs text-muted-foreground" title={n.notes}>
                        • {n.title}: {(n.notes || "").split("\n")[0]}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ===== نافذة ملاحظة المرحلة (StageNoteDialog — followup.py:395–484) ===== */}
      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ملاحظة على المعاملة</DialogTitle>
            <DialogDescription>
              {currentStage ? `📝 المرحلة الحالية: ${currentStage.name}` : "📝 ملاحظة على المعاملة"}
              {" — "}اكتب سبب التأخير أو «واقفة فين» — بلا تغيير للمرحلة.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {/* الملاحظات السابقة — آخر 12 (followup.py:437–450) */}
            <div className="max-h-48 overflow-y-auto rounded-lg border bg-muted/20 p-2">
              <p className="mb-1 text-[11px] font-bold text-muted-foreground">
                {(notesQuery.data?.notes?.length ?? 0) > 0 ? "🕘 الملاحظات السابقة" : "لا ملاحظات سابقة"}
              </p>
              <ul className="space-y-1.5">
                {(notesQuery.data?.notes ?? []).slice(0, 12).map((n) => (
                  <li key={n.id} className="text-xs leading-5">
                    <span className="font-semibold text-muted-foreground">
                      {n.createdAt.slice(0, 16).replace("T", " ")} — {n.author || "مستخدم"}
                      {n.stageName ? ` · ${n.stageName}` : ""}
                    </span>
                    <span className="block whitespace-pre-wrap">{n.note}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stage-note-text">الملاحظة</Label>
              <Textarea
                id="stage-note-text"
                rows={3}
                placeholder="مثال: واقف عند البلدية — بانتظار موافقة الإطفاء"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                تظهر الملاحظة في: سجل المراحل · تعليقات العميل · سجل العقد.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setNoteOpen(false)} disabled={noteMutation.isPending}>
              ✕ إغلاق
            </Button>
            <Button className="h-9" onClick={submitNote} disabled={noteMutation.isPending}>
              {noteMutation.isPending ? "جارٍ الحفظ…" : "💾 حفظ الملاحظة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== نافذة تأكيد التراجع (مدير — followup.py:1338–1346) ===== */}
      <Dialog open={revertOpen} onOpenChange={setRevertOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>تأكيد التراجع</DialogTitle>
            <DialogDescription className="leading-6">
              سيتم إرجاع العقد للمرحلة السابقة.
              <br />
              أي استحقاق دفعة تلقائي لم يصدر له سند قبض سيعود لحالة غير مستحق.
              <br />
              السندات المالية الموجودة لن تُحذف ولن تُلغى تلقائيًا.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="revert-reason">
              سبب التراجع عن المرحلة <span className="text-destructive">*</span>
            </Label>
            <Input
              id="revert-reason"
              className="h-9"
              placeholder="اكتب سبب التراجع؛ سيظهر تلقائيًا في تعليقات العميل وسجل العقد"
              value={revertReason}
              onChange={(e) => setRevertReason(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="h-9"
              onClick={() => setRevertOpen(false)}
              disabled={revertMutation.isPending}
            >
              إلغاء
            </Button>
            <Button
              className="h-9"
              disabled={revertMutation.isPending || !revertReason.trim()}
              onClick={() => revertMutation.mutate()}
            >
              {revertMutation.isPending ? "جارٍ التنفيذ…" : "تأكيد"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== نافذة الطابع الإشرافي للمرحلة (V3.21 — followup.py:223–355) ===== */}
      <Dialog open={supOpen} onOpenChange={setSupOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>الطابع الإشرافي للمرحلة</DialogTitle>
            <DialogDescription>
              {contractNumber ? `العقد ${contractNumber} · ` : ""}المرحلة «{currentStage?.name ?? ""}»
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="sup-flag"
                checked={supForm.isSupervision}
                onCheckedChange={(v) => setSupForm((f) => ({ ...f, isSupervision: v === true }))}
              />
              <Label htmlFor="sup-flag" className="cursor-pointer">
                مرحلة ذات طابع إشراف
              </Label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sup-end">النهاية المخططة</Label>
                <Input
                  id="sup-end"
                  type="date"
                  className="h-9"
                  dir="ltr"
                  value={supForm.supEnd}
                  onChange={(e) => setSupForm((f) => ({ ...f, supEnd: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-monthly">قيمة الشهر (د.ك/شهر)</Label>
                <Input
                  id="sup-monthly"
                  type="number"
                  min="0"
                  step="0.001"
                  className="h-9"
                  dir="ltr"
                  value={supForm.supMonthly}
                  onChange={(e) => setSupForm((f) => ({ ...f, supMonthly: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-start">تاريخ البداية</Label>
                <Input
                  id="sup-start"
                  type="date"
                  className="h-9"
                  dir="ltr"
                  value={supForm.supStart}
                  onChange={(e) => setSupForm((f) => ({ ...f, supStart: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-actual">تاريخ الإنهاء</Label>
                <Input
                  id="sup-actual"
                  type="date"
                  className="h-9"
                  dir="ltr"
                  value={supForm.supActualEnd}
                  onChange={(e) => setSupForm((f) => ({ ...f, supActualEnd: e.target.value }))}
                />
              </div>
            </div>
            <p className={`text-sm font-bold ${supForm.isSupervision ? "text-status-warn" : "text-muted-foreground"}`}>
              {supStatusLine}
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setSupOpen(false)} disabled={supMutation.isPending}>
              ✕ إغلاق
            </Button>
            <Button className="h-9" onClick={() => supMutation.mutate()} disabled={supMutation.isPending}>
              {supMutation.isPending ? "جارٍ الحفظ…" : "💾 حفظ الطابع"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== سجل المراحل (followup.py:1301–1324) ===== */}
      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-sm text-primary">🕒 سجل المراحل</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-1">
          {historyQuery.isLoading ? (
            <Skeleton className="h-12 rounded-lg" />
          ) : (historyQuery.data?.events?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">لا حركة بعد</p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-y-auto pe-1 text-xs leading-5 text-muted-foreground">
              {(historyQuery.data?.events ?? []).map((ev) => (
                <li key={ev.id}>{formatStageHistoryLine(ev)}</li>
              ))}
            </ul>
          )}

          {/* G4 — سجل نقل المراحل الكامل: المنفِّذ والملاحظة بترقيم صفحات */}
          <StageMovesLog contractId={contractId} />
        </CardContent>
      </Card>

      {/* ===== محادثة المعاملة (followup.py:624–654 + 1277–1299) ===== */}
      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-sm text-primary">💬 محادثة المعاملة</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-4 pt-1">
          {msgsQuery.isLoading ? (
            <Skeleton className="h-12 rounded-lg" />
          ) : (msgsQuery.data?.messages?.length ?? 0) === 0 ? (
            <p className="py-2 text-center text-xs text-muted-foreground">
              لا رسائل بعد · اكتب أول رسالة للمشاركين
            </p>
          ) : (
            <div className="max-h-64 space-y-1.5 overflow-y-auto pe-1">
              {(msgsQuery.data?.messages ?? []).map((m) => {
                const mine = m.username === username;
                return (
                  <div
                    key={m.id}
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-5 ${
                      mine ? "bg-primary/10" : "bg-muted/60"
                    }`}
                  >
                    <span className="font-bold text-muted-foreground">
                      {m.username || "مستخدم"} · {m.createdAt.slice(0, 16).replace("T", " ")}
                    </span>
                    <span className="block whitespace-pre-wrap">{m.body}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Input
              className="h-9"
              placeholder="اكتب رسالتك للمشاركين..."
              value={msgText}
              onChange={(e) => setMsgText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (msgText.trim() && !msgMutation.isPending) msgMutation.mutate();
                }
              }}
              aria-label="رسالة المحادثة"
            />
            <Button
              size="sm"
              className="h-9 shrink-0"
              disabled={!msgText.trim() || msgMutation.isPending}
              onClick={() => msgMutation.mutate()}
            >
              {msgMutation.isPending ? "جارٍ الإرسال…" : "إرسال"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ===================================================================
// الصفحة 3: الدفعات والمقاولون — _tab_pay (919) + _sec_pay (1389)
// ===================================================================
function PayPage({
  manager,
  cur,
  payView,
  payViewLoading,
  payViewError,
  stageNameById,
  boq,
  boqLoading,
  subs,
  onAddPay,
  onDeletePay,
  onReceipt,
  onPayment,
  onExport,
  exporting,
  onAddBoq,
  onDeleteBoq,
  onSubDetail,
  onNewSub,
}: {
  manager: boolean;
  cur: string;
  payView: ContractPayViewResponse | null;
  payViewLoading: boolean;
  payViewError: string;
  /** Task 82: stageId ⇒ اسم المرحلة — لشارة الربط على سطور الدفعات */
  stageNameById: Map<number, string>;
  boq: BoqResponse["items"];
  boqLoading: boolean;
  subs: SubContractsResponse["items"];
  onAddPay: () => void;
  onDeletePay: (id: number) => void;
  onReceipt: () => void;
  onPayment: (subContractId?: number, subLabel?: string) => void;
  onExport: () => void;
  /** المرحلة 8: حالة جارٍ تصدير xlsx — يبدّل الأيقونة لسبينر ويُعطل الزر */
  exporting?: boolean;
  onAddBoq: () => void;
  onDeleteBoq: (id: number) => void;
  onSubDetail: (id: number) => void;
  onNewSub: () => void;
}) {
  const m = payView;
  const modeText = m
    ? m.manualPath
      ? `🔧 مسار يدوي — المنجز ${m.manual.done} من ${m.manual.total} · ${m.manual.pct}٪`
      : `📏 مسار إجباري — الحالية: ${m.currentStageName || "اكتمل المسار ✓"}`
    : "";
  // النوت الصغير — آخر ملاحظة على المعاملة (V5.9)
  const lastNote = (m?.client.lines ?? []).filter((l) => (l.notes || "").trim()).slice(-1)[0]?.notes || "";

  const sumText = m
    ? `لنا: مستحق ${formatKWD(m.totals.clientDue)} · مسدَّد ${formatKWD(m.totals.clientCollected)} · متبقٍ ${formatKWD(m.totals.clientRemaining)} ${cur}` +
      `    |    عليهم (مقاولون): مستحق ${formatKWD(m.totals.subsDue)} · مسدَّد ${formatKWD(m.totals.subsPaid)} · متبقٍ ${formatKWD(m.totals.subsRemaining)} ${cur}` +
      (m.totals.subsWaiting > 0 ? ` · بانتظار تحصيل العميل ${formatKWD(m.totals.subsWaiting)}` : "")
    : "";

  return (
    <div className="space-y-3">
      {/* ① الشريط العلوي المختصر + زر سند القبض (939–974) */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{modeText}{lastNote ? ` · 📝 ${lastNote.length <= 48 ? lastNote : `${lastNote.slice(0, 46)}…`}` : ""}</p>
          <p className="mt-0.5 text-xs text-muted-foreground" title="عرض فقط — القبض من زر سند القبض هنا، والصرف من زر كل مقاول في كتلته">
            {sumText}
          </p>
        </div>
        {manager && (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              size="sm"
              className="h-9 gap-1.5"
              onClick={onReceipt}
              title="تحصيل من العميل — تختار الدفعة المستحقة بنفسك من داخل السند"
            >
              <HandCoins className="size-4" />
              ＋ سند قبض
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-9"
              disabled={exporting}
              onClick={onExport}
              title="تصدير دفعات العميل والمقاولين إلى Excel"
              aria-label="تصدير كتل الدفعات"
            >
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            </Button>
          </div>
        )}
      </div>

      {payViewLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      ) : payViewError ? (
        <Card>
          <CardContent className="p-4 text-center text-sm text-destructive">تعذر تحميل كتل الدفعات — {payViewError}</CardContent>
        </Card>
      ) : m ? (
        <>
          {/* ② كتلة العميل «دفعاتنا على العميل» */}
          <PayBlockCard
            title="دفعاتنا على العميل"
            titleTone="text-primary"
            action={
              manager ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1"
                  onClick={() => onPayment()}
                  title="صرف لمقاول الباطن — تختار الدفعة المستحقة بنفسك من داخل السند"
                >
                  <Banknote className="size-3.5" />
                  ＋ سند صرف
                </Button>
              ) : undefined
            }
          >
            <p className="text-xs text-muted-foreground">
              خطة دفعات العميل الكاملة — ولكل مقاول باطن جدوله الموحّد: دفعات العميل مقابل دفعاته على نفس السطر.
            </p>
            {m.blocks.length === 0 && (
              <p className="text-xs text-muted-foreground">
                لا عقود باطن على هذا العقد بعد — أنشئها من صفحة «مقاولو الباطن» ثم يُعرض لكل مقاول جدوله الأول بدفعاته مقابل دفعاته من العميل.
              </p>
            )}
            <PlanTable
              lines={m.client.lines.map((l) => ({
                ...l,
                stageName: l.stageId != null ? stageNameById.get(l.stageId) : undefined,
              }))}
              manager={manager}
              onDelete={onDeletePay}
              onAdd={onAddPay}
            />
            <p className="text-xs text-muted-foreground">
              {m.client.lines.length > 0
                ? `الإجمالي ${formatKWD(m.totals.clientDue)} ${cur} · مسدَّد ${formatKWD(m.totals.clientCollected)} · متبقٍ ${formatKWD(m.totals.clientRemaining)}`
                : "لا خطة دفعات لهذا العقد بعد · تُدخل من شاشة العقد"}
            </p>
          </PayBlockCard>

          {/* ③ كتلة لكل مقاول باطن (1202–1249) */}
          {/* كشف المقاول الموحّد — لكل مقاول جدول واحد: بنوده + دفعاته مقابل دفعات العميل (Task 63) */}
          {m.blocks.map((b) => (
            <SubcontractorLedger
              key={b.id}
              name={b.name}
              subCode={b.subCode}
              amount={b.amount}
              status={b.status}
              items={b.items}
              itemsTotal={b.items.reduce((s, it) => s + it.amount, 0)}
              clientLines={m.client.lines.filter((cl) => (b.plan?.lines ?? []).some((sl) => (sl.sourceIds || []).includes(cl.id)))}
              subLines={b.plan?.lines ?? []}
              planTotal={b.plan?.planTotal ?? 0}
              paid={b.paid}
              waiting={b.waiting}
              currency={cur}
              manager={manager}
              onPay={() => onPayment(b.id, b.name)}
              onManageItems={() => onSubDetail(b.id)}
            />
          ))}

          {/* دفعات العميل غير المرتبطة بمقاول (1274–1284) */}
          {m.blocks.length > 0 && m.freeClientIds.length > 0 && (
            <PayBlockCard title="دفعات العميل غير المرتبطة بمقاول" titleTone="text-muted-foreground">
              <p className="text-xs text-muted-foreground">
                هذه الدفعات لم تُربط بأي مقاول بعد — تُربط عند إنشاء أو تعديل عقد الباطن من صفحة «مقاولو الباطن».
              </p>
              <PlanTable
                lines={m.client.lines.filter((l) => m.freeClientIds.includes(l.id))}
                manager={false}
                onDelete={() => {}}
                readOnly
              />
            </PayBlockCard>
          )}

          {/* سطر الإجماليات السفلي (1286–1312) */}
          <p className="text-xs text-muted-foreground">
            {m.blocks.length > 0
              ? `الإجمالي ${formatKWD(m.totals.subsDue)} ${cur} · مسدَّد ${formatKWD(m.totals.subsPaid)} · متبقٍ ${formatKWD(m.totals.subsRemaining)}${m.totals.subsWaiting > 0 ? ` · بانتظار تحصيل العميل ${formatKWD(m.totals.subsWaiting)}` : ""}`
              : "لا عقود باطن على هذا العقد بعد"}
          </p>
        </>
      ) : null}

      {/* ④ قسم مقاولي الباطن (القائمة القديمة تبقى كقسم) */}
      <Card className="p-4">
        <CardHeader className="p-0 pb-2">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-1.5">
              <HardHat className="size-4 text-primary/70" />
              مقاولو الباطن
            </span>
            {manager && (
              <Button size="sm" className="h-9 gap-1.5" onClick={onNewSub}>
                <Plus className="size-4" />
                عقد باطن جديد
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {subs.length === 0 ? (
            <p className="p-2 text-center text-sm text-muted-foreground">
              لا عقود باطنة على هذا العقد — أضف عقدًا باطنًا لمقاول مع بنوده وخطة دفعاته.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {subs.map((s) => (
                <div key={s.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <HardHat className="size-4 text-primary/70" />
                      {s.subcontractor?.name ?? "—"}
                      {s.subcontractor?.subCode && (
                        <span className="text-xs font-normal text-muted-foreground" dir="ltr">({s.subcontractor.subCode})</span>
                      )}
                    </span>
                    <StatusBadge status={s.status || ""} className="text-[11px]" />
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">القيمة</div>
                      <div className="font-bold tabular-nums" dir="ltr">{formatKWD(s.amount)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">المدفوع</div>
                      <div className="font-bold tabular-nums text-status-done" dir="ltr">{formatKWD(s.paid)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">المتبقي</div>
                      <div className="font-bold tabular-nums text-status-warn" dir="ltr">{formatKWD(s.remaining)}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex justify-end">
                    <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => onSubDetail(s.id)}>
                      <Eye className="size-3.5" />
                      تفاصيل العقد الباطن
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ⑤ بنود الكميات — قسم داخل الصفحة (سطر «بنود: N» كالمكتبي 1232) */}
      <Card className="p-4">
        <CardHeader className="p-0 pb-2">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span>بنود الكميات · بنود: {boq.length}</span>
            {manager && (
              <Button size="sm" className="h-9 gap-1.5" onClick={onAddBoq}>
                <Plus className="size-4" />
                إضافة بند
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {boqLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-lg" />
              ))}
            </div>
          ) : boq.length === 0 ? (
            <p className="p-2 text-center text-sm text-muted-foreground">لا بنود كميات على هذا العقد.</p>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-40">الوصف</TableHead>
                      <TableHead className="w-20 text-center">الكمية</TableHead>
                      <TableHead className="w-20 text-center">الوحدة</TableHead>
                      <TableHead className="w-28 text-end">سعر الوحدة</TableHead>
                      <TableHead className="w-28 text-end">الإجمالي</TableHead>
                      {manager && <TableHead className="w-16 text-center">حذف</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {boq.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell>
                          <div className="font-medium">{it.description}</div>
                          {it.stageName && <div className="text-xs text-muted-foreground">المرحلة: {it.stageName}</div>}
                        </TableCell>
                        <TableCell className="text-center tabular-nums" dir="ltr">{Number(it.qty)}</TableCell>
                        <TableCell className="text-center">{it.unit || "—"}</TableCell>
                        <TableCell className="text-end tabular-nums" dir="ltr">{formatKWD(it.unitPrice)}</TableCell>
                        <TableCell className="text-end font-bold tabular-nums" dir="ltr">{formatKWD(it.amount)}</TableCell>
                        {manager && (
                          <TableCell className="text-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-destructive hover:text-destructive"
                              onClick={() => onDeleteBoq(it.id)}
                              aria-label="حذف البند"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FinCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <Card className="gap-1 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="size-4 text-primary/70" />
      </div>
      <div className={`text-lg font-bold tabular-nums ${tone || ""}`} dir="ltr">
        {value}
      </div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </Card>
  );
}

function SumRow({ label, value, tone, tooltip }: { label: string; value: string; tone?: string; tooltip?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5 text-sm" title={tooltip}>
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-bold tabular-nums ${tone || ""}`} dir="auto">
        {value || "—"}
      </span>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-28 rounded-xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-10 rounded-lg" />
      <Skeleton className="h-64 rounded-xl" />
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        جارٍ تحميل العقد…
      </div>
    </div>
  );
}
