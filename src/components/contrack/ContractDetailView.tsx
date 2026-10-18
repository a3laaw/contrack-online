"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "./api";
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
import { VoucherPage } from "./VoucherPage";
import { SubContractDialog } from "./SubContractDialog";
import { StatusBadge } from "./StatusBadge";
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
}

type PageKey = "stages" | "info" | "pay" | "addendums";

/** الصفحات الداخلية الكاملة — بدل النوافذ الكبرى والصغيرة متوسطة الحجم */
type FlowPage = "edit" | "sub-new" | "settle" | "boq" | "sup";

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

  const openStatus = () => {
    if (!detail) return;
    setNewStatus(detail.status);
    setStatusReason(detail.statusReason || "");
    setStatusOpen(true);
  };

  const statusMutation = useMutation({
    mutationFn: () =>
      apiPatch(`/api/contracts/${contractId}`, {
        status: newStatus,
        statusReason: statusReason.trim(),
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
  const [stageForm, setStageForm] = React.useState({ name: "", expectedDays: "", payPct: "" });

  const addStageMutation = useMutation({
    mutationFn: () =>
      apiPost(`/api/contracts/${contractId}/stages`, {
        name: stageForm.name.trim(),
        expectedDays: Number(stageForm.expectedDays || 0),
        payPct: Number(stageForm.payPct || 0),
      }),
    onSuccess: () => {
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["contract", contractId, "overview"] });
      toast({ title: "تمت الإضافة", description: "أُضيفت المرحلة للعقد" });
      setAddStageOpen(false);
      setStageForm({ name: "", expectedDays: "", payPct: "" });
    },
    onError: (e) => fail(e, "تعذر إضافة المرحلة"),
  });

  // ===== الدفعات =====
  const [addPayOpen, setAddPayOpen] = React.useState(false);
  const [payForm, setPayForm] = React.useState({ title: "", amount: "", dueDate: todayStr() });

  const addPayMutation = useMutation({
    mutationFn: () =>
      apiPost(`/api/contracts/${contractId}/plan`, {
        title: payForm.title.trim(),
        amount: Number(payForm.amount || 0),
        dueDate: payForm.dueDate,
      }),
    onSuccess: () => {
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["contract", contractId, "pay-view"] });
      toast({ title: "تمت الإضافة", description: "أُضيفت الدفعة للخطة" });
      setAddPayOpen(false);
      setPayForm({ title: "", amount: "", dueDate: todayStr() });
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
  const remaining = detailData.remaining;
  const stages = [...(detailData.stages ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const l1Stages = stages.filter((s) => (s.level ?? 1) === 1);
  const overview = overviewQuery.data ?? null;
  const planLines = planQuery.data?.lines ?? [];

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
              {hasSupervision && (
                <Badge variant="secondary" className="gap-1 bg-status-done-bg text-status-done">
                  <Building2 className="size-3" />
                  إشراف هندسي
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
          {PAGE_GROUPS.map((g) => {
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
          ) : (
            <ol className="relative space-y-2 border-s-2 ps-4">
              {stages.map((st, i) => {
                const state: "skipped" | "done" | "active" | "pending" = st.isSkipped
                  ? "skipped"
                  : st.endDate
                    ? "done"
                    : st.startDate
                      ? "active"
                      : "pending";
                return (
                  <li key={st.id} className="relative rounded-lg border bg-card p-3">
                    <span className="absolute -start-[1.42rem] top-4 flex size-5 items-center justify-center rounded-full border bg-background text-[10px] font-bold">
                      {i + 1}
                    </span>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{st.name}</span>
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
              })}
            </ol>
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
          boq={boqQuery.data?.items ?? []}
          boqLoading={boqQuery.isLoading}
          subs={contractSubsQuery.data?.items ?? []}
          onAddPay={() => setAddPayOpen(true)}
          onDeletePay={(id) => setDeletePayId(id)}
          onReceipt={() => setVoucherPage("receipt")}
          onPayment={() => setVoucherPage("payment")}
          onExport={() => {
            window.open(`/api/contracts/${contractId}/pay-export`, "_blank");
          }}
          onAddBoq={() => setFlowPage("boq")}
          onDeleteBoq={(id) => setDeleteBoqId(id)}
          onSubDetail={(id) => setSubDetailId(id)}
          onNewSub={() => setFlowPage("sub-new")}
        />
      )}

      {/* ===== الصفحة 4: الأوامر والتعديلات (_tab_addendums) ===== */}
      {page === "addendums" && (
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
      )}

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
                السبب {STATUS_REASON_REQUIRED.has(newStatus) && <span className="text-destructive">*</span>}
              </Label>
              <Textarea
                rows={2}
                placeholder={STATUS_REASON_REQUIRED.has(newStatus) ? "إلزامي للإلغاء/الإغلاق" : "اختياري"}
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
              />
            </div>
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
            <DialogDescription>تُضاف في نهاية الترتيب الحالي.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="st-name">اسم المرحلة *</Label>
              <Input id="st-name" className="h-9" value={stageForm.name} onChange={(e) => setStageForm((f) => ({ ...f, name: e.target.value }))} />
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
// ===================================================================
function FollowupPanelCompact({
  stages,
  stagePath,
  loading,
  manualPath,
  manual,
  planLines,
  planLoading,
}: {
  stages: ContractDetailResponse["stages"];
  stagePath: ContractOverviewResponse["stagePath"] | null;
  loading: boolean;
  manualPath: boolean;
  manual: { done: number; total: number; pct: number } | null;
  planLines: PlanLine[];
  planLoading: boolean;
}) {
  const cur = stagePath?.current ?? null;
  const state = stagePath?.state ?? "done";
  const path = stagePath?.path ?? [];

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

  // الشريحة المختصرة: السابقة / الحالية / التالية (followup.py:1015–1083)
  const chips: { label: string; name: string; state: string; days: number }[] = [];
  if (manualPath) {
    for (const s of stages) {
      chips.push({
        label: "",
        name: s.name,
        state: s.endDate || s.isSkipped ? (s.isSkipped ? "skip" : "done") : s.startDate ? "current" : "future",
        days: 0,
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

  return (
    <Card className="p-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span>🔄 مرحلة التنفيذ</span>
          <span className="text-sm font-bold">
            {manualPath
              ? `🔧 مسار يدوي — ${manual?.done ?? 0}/${manual?.total ?? 0}`
              : cur
                ? cur.name
                : "اكتمل المسار ✓"}
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
                  {c.days > 0 ? ` · ${c.days} ي` : ""}
                </span>
              ))}
              {chips.length === 0 && <span className="text-xs text-muted-foreground">لا مراحل على هذا العقد.</span>}
            </div>
            <p className={`text-sm font-bold ${counterClass}`}>{counterText}</p>
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
  boq,
  boqLoading,
  subs,
  onAddPay,
  onDeletePay,
  onReceipt,
  onPayment,
  onExport,
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
  boq: BoqResponse["items"];
  boqLoading: boolean;
  subs: SubContractsResponse["items"];
  onAddPay: () => void;
  onDeletePay: (id: number) => void;
  onReceipt: () => void;
  onPayment: (subContractId?: number, subLabel?: string) => void;
  onExport: () => void;
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
            <Button variant="outline" size="icon" className="size-9" onClick={onExport} title="تصدير دفعات العميل والمقاولين إلى Excel" aria-label="تصدير كتل الدفعات">
              <Download className="size-4" />
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
              lines={m.client.lines}
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
          {m.blocks.map((b) => (
            <PayBlockCard
              key={b.id}
              title={`${b.name}${b.subCode ? ` (${b.subCode})` : ""} · ${b.itemsCount ? `بنود: ${b.itemsCount}` : "بلا بنود"} · قيمة العقد ${formatKWD(b.amount)} ${cur}${b.status ? ` · ${b.status}` : ""}`}
              titleTone={b.status === "ملغى" ? "text-status-danger" : ""}
              action={
                manager && b.status !== "ملغى" ? (
                  <Button
                    size="sm"
                    className="h-8 gap-1"
                    onClick={() => onPayment(b.id, b.name)}
                    title="صرف لمقاول الباطن — تختار الدفعة المستحقة بنفسك من داخل السند"
                  >
                    <Banknote className="size-3.5" />
                    ＋ سند صرف
                  </Button>
                ) : undefined
              }
            >
              {b.plan ? (
                <>
                  <UnifiedPayTable
                    clientLines={m.client.lines.filter((cl) => b.plan!.lines.some((sl) => (sl.sourceIds || []).includes(cl.id)))}
                    subLines={b.plan.lines}
                  />
                  <p className="text-xs text-muted-foreground">
                    الإجمالي {formatKWD(b.plan.planTotal)} {cur} · مسدَّد {formatKWD(b.paid)} · متبقٍ {formatKWD(Math.max(0, b.plan.planTotal - b.paid))}
                    {b.waiting > 0 ? ` · بانتظار تحصيل العميل ${formatKWD(b.waiting)}` : ""}
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  لا خطة دفعات على هذا العقد الباطن — أضفها من تفاصيل العقد الباطن.
                </p>
              )}
            </PayBlockCard>
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

/** غلاف كتلة دفعات (بلوك المكتبي _new_pay_block) */
function PayBlockCard({
  title,
  titleTone,
  action,
  children,
}: {
  title: string;
  titleTone?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className={`text-sm font-bold ${titleTone || ""}`}>{title}</h3>
        {action}
      </div>
      <div className="space-y-2">{children}</div>
    </Card>
  );
}

/** الجدول الموحّد — دفعات العميل مقابل خطوط الباطن المرتبطة بها على نفس السطر
 *  (مرجع المكتبي: ui/sub_pay_blocks.build_unified_table V9.1 — كل خط باطن يُسند
 *  إلى أول دفعة عميل من مصادره، وخطوط بلا مصدر تُلحق أسفل الجدول). */
function UnifiedPayTable({
  clientLines,
  subLines,
}: {
  clientLines: PayViewLine[];
  subLines: PayViewSubLine[];
}) {
  const order = new Map(clientLines.map((c, i) => [c.id, i] as const));
  const groups = new Map<number, PayViewSubLine[]>();
  const unassigned: PayViewSubLine[] = [];
  for (const sl of subLines) {
    const cands = (sl.sourceIds || []).filter((id) => order.has(id));
    if (cands.length === 0) {
      unassigned.push(sl);
      continue;
    }
    const parent = cands.reduce((a, b) =>
      (order.get(b) ?? Number.MAX_SAFE_INTEGER) < (order.get(a) ?? Number.MAX_SAFE_INTEGER) ? b : a
    );
    const arr = groups.get(parent);
    if (arr) arr.push(sl);
    else groups.set(parent, [sl]);
  }

  const cTot = clientLines.reduce((s, l) => s + (l.amountN || 0), 0);
  const cPaid = clientLines.reduce((s, l) => s + (l.covered || 0), 0);
  const sTot = subLines.reduce((s, l) => s + (l.amountN || 0), 0);
  const sPaid = subLines.reduce((s, l) => s + (l.covered || 0), 0);

  const rs = (n: number) => (n > 1 ? n : undefined);
  const clientCells = (l: PayViewLine, span: number) => (
    <>
      <TableCell rowSpan={rs(span)}>
        <div className="font-medium">{l.title}</div>
        {l.notes ? <div className="text-xs text-muted-foreground">{l.notes}</div> : null}
      </TableCell>
      <TableCell className="text-end font-bold tabular-nums" dir="ltr" rowSpan={rs(span)}>
        {formatKWD(l.amountN)}
      </TableCell>
      <TableCell className="text-end tabular-nums text-status-done" dir="ltr" rowSpan={rs(span)}>
        {formatKWD(l.covered)}
      </TableCell>
      <TableCell rowSpan={rs(span)}>
        <StatusBadge
          status={l.state}
          label={l.stateLabel || PAYMENT_STATUS_LABEL[l.state] || l.state}
          className="px-2 py-0.5 text-[11px]"
        />
      </TableCell>
    </>
  );
  const subCells = (l: PayViewSubLine) => (
    <>
      <TableCell>
        <span className="flex items-center gap-1.5 font-medium">
          {l.gated ? <Lock className="size-3 text-muted-foreground" aria-label="مقفلة بانتظار مصادرها" /> : null}
          {l.title}
        </span>
      </TableCell>
      <TableCell className="text-end tabular-nums" dir="ltr">
        {formatKWD(l.amountN)}
      </TableCell>
      <TableCell className="text-end tabular-nums text-status-done" dir="ltr">
        {formatKWD(l.covered)}
      </TableCell>
      <TableCell>
        <StatusBadge
          status={l.state}
          label={l.stateLabel || PAYMENT_STATUS_LABEL[l.state] || l.state}
          className="px-2 py-0.5 text-[11px]"
        />
      </TableCell>
    </>
  );
  const dashClient = (
    <TableCell colSpan={4} className="text-center text-muted-foreground">
      —
    </TableCell>
  );

  return (
    <>
      {/* جدول — الحاسوب */}
      <Card className="hidden overflow-hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead colSpan={4} className="text-center text-primary">
                دفعات العميل
              </TableHead>
              <TableHead colSpan={4} className="text-center">
                دفعات المقاول
              </TableHead>
            </TableRow>
            <TableRow>
              <TableHead>الدفعة</TableHead>
              <TableHead className="w-24 text-end">المبلغ</TableHead>
              <TableHead className="w-24 text-end">المسدّد</TableHead>
              <TableHead className="w-28">الحالة</TableHead>
              <TableHead>الدفعة</TableHead>
              <TableHead className="w-24 text-end">المبلغ</TableHead>
              <TableHead className="w-24 text-end">المسدّد</TableHead>
              <TableHead className="w-28">الحالة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clientLines.map((cl) => {
              const subs = groups.get(cl.id) || [];
              if (subs.length === 0) {
                return (
                  <TableRow key={`c${cl.id}`}>
                    {clientCells(cl, 1)}
                    {dashClient}
                  </TableRow>
                );
              }
              return subs.map((sl, k) => (
                <TableRow key={`c${cl.id}s${sl.id}`}>
                  {k === 0 ? clientCells(cl, subs.length) : null}
                  {subCells(sl)}
                </TableRow>
              ));
            })}
            {unassigned.map((sl) => (
              <TableRow key={`u${sl.id}`}>
                {dashClient}
                {subCells(sl)}
              </TableRow>
            ))}
            {clientLines.length === 0 && subLines.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                  لا خطوط دفعات بعد.
                </TableCell>
              </TableRow>
            )}
            {(clientLines.length > 0 || subLines.length > 0) && (
              <TableRow className="bg-muted/40 font-medium hover:bg-muted/40">
                <TableCell colSpan={4} className="text-xs tabular-nums" dir="ltr">
                  عميل: الإجمالي {formatKWD(cTot)} · المسدّد {formatKWD(cPaid)}
                </TableCell>
                <TableCell colSpan={4} className="text-xs tabular-nums" dir="ltr">
                  مقاول: الإجمالي {formatKWD(sTot)} · المسدّد {formatKWD(sPaid)}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* بطاقات — الموبايل */}
      <div className="space-y-2 md:hidden">
        {clientLines.map((cl) => {
          const subs = groups.get(cl.id) || [];
          return (
            <Card key={`m${cl.id}`} className="gap-1 p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{cl.title}</span>
                <StatusBadge
                  status={cl.state}
                  label={cl.stateLabel || PAYMENT_STATUS_LABEL[cl.state] || cl.state}
                  className="px-2 py-0.5 text-[10px]"
                />
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                <span className="tabular-nums" dir="ltr">
                  المبلغ: {formatKWD(cl.amountN)}
                </span>
                <span className="tabular-nums text-status-done" dir="ltr">
                  المسدّد: {formatKWD(cl.covered)}
                </span>
              </div>
              {subs.length > 0 && (
                <div className="mt-1 space-y-1 border-t pt-1.5">
                  {subs.map((sl) => (
                    <div
                      key={sl.id}
                      className="flex flex-wrap items-center justify-between gap-1.5 rounded-md border px-2 py-1 text-xs"
                    >
                      <span className="flex items-center gap-1 font-medium">
                        {sl.gated ? <Lock className="size-3 text-muted-foreground" /> : null}
                        {sl.title}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="tabular-nums" dir="ltr">
                          {formatKWD(sl.amountN)}
                        </span>
                        <StatusBadge
                          status={sl.state}
                          label={sl.stateLabel || PAYMENT_STATUS_LABEL[sl.state] || sl.state}
                          className="px-1.5 py-0 text-[10px]"
                        />
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
        {unassigned.map((sl) => (
          <Card key={`mu${sl.id}`} className="gap-1 p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="flex items-center gap-1 font-medium">
                {sl.gated ? <Lock className="size-3 text-muted-foreground" /> : null}
                {sl.title}
              </span>
              <StatusBadge
                status={sl.state}
                label={sl.stateLabel || PAYMENT_STATUS_LABEL[sl.state] || sl.state}
                className="px-2 py-0.5 text-[10px]"
              />
            </div>
            <p className="text-[10px] text-muted-foreground">بلا دفعة عميل مرتبطة</p>
            <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
              <span className="tabular-nums" dir="ltr">
                المبلغ: {formatKWD(sl.amountN)}
              </span>
              <span className="tabular-nums text-status-done" dir="ltr">
                المسدّد: {formatKWD(sl.covered)}
              </span>
            </div>
          </Card>
        ))}
        {clientLines.length === 0 && subLines.length === 0 && (
          <Card>
            <CardContent className="p-4 text-center text-sm text-muted-foreground">
              لا خطوط دفعات بعد.
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

function PlanTable({
  lines,
  manager,
  onDelete,
  readOnly,
  onAdd,
}: {
  lines: { id: number; title: string; dueDate: string; amountN: number; covered: number; remaining: number; state: string; stateLabel?: string; notes?: string }[];
  manager: boolean;
  onDelete: (id: number) => void;
  readOnly?: boolean;
  onAdd?: () => void;
}) {
  return (
    <>
      {/* جدول — الحاسوب */}
      <Card className="hidden overflow-hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>العنوان</TableHead>
              <TableHead className="w-28">الاستحقاق</TableHead>
              <TableHead className="w-28 text-end">المبلغ</TableHead>
              <TableHead className="w-28 text-end">المغطى</TableHead>
              <TableHead className="w-28 text-end">المتبقي</TableHead>
              <TableHead className="w-32">الحالة</TableHead>
              {manager && !readOnly && <TableHead className="w-16 text-center">حذف</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((ln) => (
              <TableRow key={ln.id}>
                <TableCell>
                  <div className="font-medium">{ln.title}</div>
                  {ln.notes ? <div className="text-xs text-muted-foreground">{ln.notes}</div> : null}
                </TableCell>
                <TableCell dir="ltr" className="tabular-nums">{fmtDate(ln.dueDate)}</TableCell>
                <TableCell className="text-end font-bold tabular-nums" dir="ltr">{formatKWD(ln.amountN)}</TableCell>
                <TableCell className="text-end tabular-nums text-status-done" dir="ltr">{formatKWD(ln.covered)}</TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">{formatKWD(ln.remaining)}</TableCell>
                <TableCell>
                  <StatusBadge
                    status={ln.state}
                    label={ln.stateLabel || PAYMENT_STATUS_LABEL[ln.state] || ln.state}
                    className="px-2 py-0.5 text-[11px]"
                  />
                </TableCell>
                {manager && !readOnly && (
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      onClick={() => onDelete(ln.id)}
                      aria-label="حذف الدفعة"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={manager && !readOnly ? 7 : 6} className="py-6 text-center text-sm text-muted-foreground">
                  لا دفعات في الخطة — المستحق هو كامل المتبقي من قيمة العقد.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* بطاقات — الموبايل */}
      <div className="space-y-2 md:hidden">
        {lines.map((ln) => (
          <Card key={ln.id} className="gap-1 p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium">{ln.title}</span>
              <StatusBadge
                status={ln.state}
                label={ln.stateLabel || PAYMENT_STATUS_LABEL[ln.state] || ln.state}
                className="px-2 py-0.5 text-[10px]"
              />
            </div>
            <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
              <span>الاستحقاق: {fmtDate(ln.dueDate)}</span>
              <span className="tabular-nums" dir="ltr">المبلغ: {formatKWD(ln.amountN)}</span>
              <span className="tabular-nums text-status-done" dir="ltr">المغطى: {formatKWD(ln.covered)}</span>
              <span className="tabular-nums" dir="ltr">المتبقي: {formatKWD(ln.remaining)}</span>
            </div>
            {ln.notes && <p className="text-xs text-muted-foreground">{ln.notes}</p>}
            {manager && !readOnly && (
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 text-destructive hover:text-destructive"
                  onClick={() => onDelete(ln.id)}
                >
                  <Trash2 className="size-3.5" />
                  حذف
                </Button>
              </div>
            )}
          </Card>
        ))}
        {lines.length === 0 && (
          <Card>
            <CardContent className="p-4 text-center text-sm text-muted-foreground">
              لا دفعات في الخطة — المستحق هو كامل المتبقي من قيمة العقد.
            </CardContent>
          </Card>
        )}
      </div>
      {manager && !readOnly && onAdd && (
        <div className="flex justify-end">
          <Button size="sm" className="h-9 gap-1.5" onClick={onAdd}>
            <Plus className="size-4" />
            إضافة دفعة
          </Button>
        </div>
      )}
    </>
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
