"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlarmClock,
  Banknote,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Eraser,
  Hourglass,
  Landmark,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  ScrollText,
  Settings2,
  Tags,
  Trash2,
  TriangleAlert,
  Upload,
  UserX,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiFetch, apiGet, apiPatch, apiPost } from "./api";
import type {
  GatewayBankLinesResponse,
  GatewayClearingRow,
  GatewayDailyClearingResponse,
  GatewayOpRow,
  GatewayOpsResponse,
  GatewayProfile,
  GatewayProfilesResponse,
  GatewaySummaryResponse,
  User,
  VouchersResponse,
} from "./contrack-types";
import {
  CLEARING_STATUS_BADGE,
  GATEWAY_STATUS_BADGE,
  GATEWAY_STATUS_LABEL,
  errMessage,
  isManagerRole,
} from "./contrack-types";
import { fmtDate, formatKWD, round3 } from "@/lib/format";
import { GatewayBankUploadPage } from "./GatewayBankUploadPage";
import { GatewayProfileEditPage } from "./GatewayProfileEditPage";
import { GatewayUploadPage } from "./GatewayUploadPage";

interface GatewayViewProps {
  user: User;
  onAuthError: () => void;
}

type GatewayTab = "ops" | "upload" | "clearing" | "bank" | "settings";

/** خيارات شريط الحالة: الكل/لنا/أخرى/غير مصنفة/موزعة — تُمرَّر كـ filter للخلفي */
const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "الكل" },
  { value: "mine", label: "لنا" },
  { value: "other", label: "أخرى" },
  { value: "unmarked", label: "غير مصنفة" },
  { value: "distributed", label: "موزعة" },
];

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function normSearch(s: string): string {
  return s.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <Card className="gap-1 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="size-4 shrink-0 text-primary/70" />
      </div>
      <p className={`text-base font-bold tabular-nums sm:text-lg ${tone || ""}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </Card>
  );
}

/** تحكم شرائحي بسيط (بدون Radix) — للفلاتر ذوات القيم الثابتة */
function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex h-9 w-full items-stretch overflow-x-auto rounded-md border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 whitespace-nowrap rounded px-2 text-xs font-medium transition-colors ${
            value === o.value
              ? "bg-background shadow-sm font-bold text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function statusBadge(status: string) {
  return (
    <Badge className={`${GATEWAY_STATUS_BADGE[status] || GATEWAY_STATUS_BADGE.unmarked} border-0 text-[10px]`}>
      {GATEWAY_STATUS_LABEL[status] || status}
    </Badge>
  );
}

/** لون رقم الفرق بالإشارة: ناقص (بنك أقل من المتوقع) أحمر / زيادة أصفر / مطابق أخضر */
function gapTone(gap: number): string {
  if (Math.abs(gap) <= 0.001) return "text-status-done";
  if (gap > 0) return "text-status-danger";
  return "text-status-warn";
}

export function GatewayView({ user, onAuthError }: GatewayViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);

  // ===== البيانات =====
  const summaryQuery = useQuery<GatewaySummaryResponse>({
    queryKey: ["gateway-summary"],
    queryFn: () => apiGet<GatewaySummaryResponse>("/api/gateway/summary"),
  });

  const profilesQuery = useQuery<GatewayProfilesResponse>({
    queryKey: ["gateway-profiles"],
    queryFn: () => apiGet<GatewayProfilesResponse>("/api/gateway/profiles"),
  });
  const profiles: GatewayProfile[] = profilesQuery.data?.profiles ?? [];
  const activeProfiles = profiles.filter((p) => p.isActive);

  // فلاتر تبويب العمليات
  const [tab, setTab] = React.useState<GatewayTab>("ops");

  // ===== الصفحات الكاملة الداخلية (تحل محل نوافذ الرفع/الإعدادات الكبرى — بلا مسارات جديدة) =====
  const [page, setPage] = React.useState<"upload" | "bank" | "profile" | null>(null);
  const [profileEditing, setProfileEditing] = React.useState<GatewayProfile | null>(null);
  const [fGateway, setFGateway] = React.useState("all");
  const [fStatus, setFStatus] = React.useState("all");
  const [q, setQ] = React.useState("");
  const [fFrom, setFFrom] = React.useState("");
  const [fTo, setFTo] = React.useState("");
  const [selected, setSelected] = React.useState<Set<number>>(new Set());

  const opsQuery = useQuery<GatewayOpsResponse>({
    queryKey: ["gateway-ops", { gateway: fGateway, filter: fStatus, q, from: fFrom, to: fTo }],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (fGateway !== "all") sp.set("gateway", fGateway);
      if (fStatus !== "all") sp.set("filter", fStatus);
      if (q.trim()) sp.set("q", q.trim());
      if (fFrom) sp.set("from", fFrom);
      if (fTo) sp.set("to", fTo);
      const qs = sp.toString();
      return apiGet<GatewayOpsResponse>(`/api/gateway/ops${qs ? `?${qs}` : ""}`);
    },
  });
  const ops: GatewayOpRow[] = opsQuery.data?.ops ?? [];

  // تبويب التصفية اليومية
  const [cFrom, setCFrom] = React.useState("");
  const [cTo, setCTo] = React.useState("");
  const [cGateway, setCGateway] = React.useState("all");
  const [expandedDay, setExpandedDay] = React.useState<string | null>(null);

  const clearingQuery = useQuery<GatewayDailyClearingResponse>({
    queryKey: ["gateway-clearing", { from: cFrom, to: cTo, gateway: cGateway }],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (cFrom) sp.set("from", cFrom);
      if (cTo) sp.set("to", cTo);
      if (cGateway !== "all") sp.set("gateway", cGateway);
      const qs = sp.toString();
      return apiGet<GatewayDailyClearingResponse>(`/api/gateway/daily-clearing${qs ? `?${qs}` : ""}`);
    },
    enabled: tab === "clearing",
  });
  const days: GatewayClearingRow[] = clearingQuery.data?.rows ?? [];

  // تبويب سطور البنك
  const bankQuery = useQuery<GatewayBankLinesResponse>({
    queryKey: ["gateway-bank-lines"],
    queryFn: () => apiGet<GatewayBankLinesResponse>("/api/gateway/bank-lines"),
    enabled: tab === "clearing",
  });
  const bankLines = bankQuery.data?.lines ?? [];

  const unmatchedQuery = useQuery<GatewayBankLinesResponse>({
    queryKey: ["gateway-unmatched-bank"],
    queryFn: () => apiGet<GatewayBankLinesResponse>("/api/gateway/unmatched-bank"),
    enabled: tab === "clearing",
  });
  const unmatched = unmatchedQuery.data?.lines ?? [];

  React.useEffect(() => {
    for (const e of [summaryQuery.error, profilesQuery.error, opsQuery.error]) {
      if (e instanceof ApiError && e.status === 401) onAuthError();
    }
  }, [summaryQuery.error, profilesQuery.error, opsQuery.error, onAuthError]);

  React.useEffect(() => {
    for (const e of [clearingQuery.error, bankQuery.error, unmatchedQuery.error]) {
      if (e instanceof ApiError && e.status === 401) onAuthError();
    }
  }, [clearingQuery.error, bankQuery.error, unmatchedQuery.error, onAuthError]);

  const invalidateAll = React.useCallback(() => {
    for (const k of [
      "gateway-ops",
      "gateway-summary",
      "gateway-clearing",
      "gateway-bank-lines",
      "gateway-unmatched-bank",
      "gateway-profiles",
      "other-balance",
      "other-opening",
      "other-due",
      "other-transfers",
      "other-ledger",
      "other-daily",
    ]) {
      qc.invalidateQueries({ queryKey: [k] });
    }
  }, [qc]);

  // ===== حوار التصنيف (سطري/جماعي) =====
  const [classifyOpen, setClassifyOpen] = React.useState(false);
  const [classifyIds, setClassifyIds] = React.useState<number[]>([]);
  const [classifyContext, setClassifyContext] = React.useState<GatewayOpRow | null>(null);
  const [classifyTarget, setClassifyTarget] = React.useState<"mine" | "other">("mine");
  const [classifyReceipt, setClassifyReceipt] = React.useState("");
  const [classifyManual, setClassifyManual] = React.useState("");
  const [classifyError, setClassifyError] = React.useState("");

  const openClassify = (rows: GatewayOpRow[]) => {
    const first = rows[0] ?? null;
    setClassifyIds(rows.map((r) => r.id));
    setClassifyContext(rows.length === 1 ? first : null);
    setClassifyTarget(first && first.status === "other" ? "other" : "mine");
    setClassifyReceipt(first?.receiptNo || "");
    setClassifyManual("");
    setClassifyError("");
    setClassifyOpen(true);
  };

  const receiptPhone = classifyContext?.phone ?? "";
  const receiptsQuery = useQuery<VouchersResponse>({
    queryKey: ["gateway-receipts", receiptPhone],
    queryFn: () => {
      const qs = receiptPhone ? `?vtype=receipt&q=${encodeURIComponent(receiptPhone)}` : "?vtype=receipt";
      return apiGet<VouchersResponse>(`/api/vouchers${qs}`);
    },
    enabled: classifyOpen && classifyTarget === "mine",
  });
  const receiptOptions = (receiptsQuery.data?.items ?? []).filter((v) => !v.cancelled);

  const classifyMutation = useMutation({
    mutationFn: (vars: { ids: number[]; status: string; receiptNo?: string }) =>
      apiPost("/api/gateway/ops/classify", vars),
    onSuccess: () => {
      invalidateAll();
      setClassifyOpen(false);
      setSelected(new Set());
      toast({ title: "حُفظ التصنيف", description: "تحديث حالة العمليات المختارة" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      setClassifyError(errMessage(e));
    },
  });

  const submitClassify = () => {
    if (classifyIds.length === 0) return;
    const receiptNo =
      classifyTarget === "mine" ? classifyManual.trim() || classifyReceipt || undefined : undefined;
    if (classifyTarget === "mine" && !receiptNo && classifyContext) {
      setClassifyError("تصنيف العملية «لنا» يتطلب رقم سند القبض المرتبط");
      return;
    }
    classifyMutation.mutate({ ids: classifyIds, status: classifyTarget, receiptNo });
  };

  // ===== توزيع/إرجاع =====
  const distributeMutation = useMutation({
    mutationFn: (ids: number[]) => apiPost("/api/gateway/ops/distribute", { ids }),
    onSuccess: () => {
      invalidateAll();
      setSelected(new Set());
      toast({ title: "تم التوزيع ◆", description: "اعتماد محاسبي للعمليات المحصلة المصنفة «لنا»" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر التوزيع", description: errMessage(e) });
    },
  });

  const undistributeMutation = useMutation({
    mutationFn: (ids: number[]) => apiPost("/api/gateway/ops/undistribute", { ids }),
    onSuccess: () => {
      invalidateAll();
      setSelected(new Set());
      toast({ title: "أُرجعت العمليات ↩", description: "عادت من التوزيع إلى التصنيف" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر الإرجاع", description: errMessage(e) });
    },
  });

  // ===== حذف عملية (مدير) =====
  const [deleteTarget, setDeleteTarget] = React.useState<GatewayOpRow | null>(null);
  const deleteOpMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/gateway/ops/${id}`),
    onSuccess: () => {
      invalidateAll();
      setDeleteTarget(null);
      toast({ title: "حُذفت العملية" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر الحذف", description: errMessage(e) });
    },
  });

  // ===== الإعدادات: profiles CRUD =====
  const [deleteProfile, setDeleteProfile] = React.useState<GatewayProfile | null>(null);

  const profileToggleMutation = useMutation({
    mutationFn: (vars: { id: number; isActive: boolean }) =>
      apiPatch(`/api/gateway/profiles/${vars.id}`, { isActive: vars.isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gateway-profiles"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      qc.invalidateQueries({ queryKey: ["gateway-profiles"] });
      toast({ variant: "destructive", title: "تعذر تغيير التفعيل", description: errMessage(e) });
    },
  });

  const profileDeleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/gateway/profiles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gateway-profiles"] });
      setDeleteProfile(null);
      toast({ title: "حُذفت البوابة" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر حذف البوابة", description: errMessage(e) });
    },
  });

  // ===== المسح الشامل (مدير) =====
  const [wipeOpen, setWipeOpen] = React.useState(false);
  const [wipeConfirm, setWipeConfirm] = React.useState("");
  const wipeMutation = useMutation({
    mutationFn: () => apiFetch("/api/gateway/wipe", { method: "DELETE", body: { confirm: "مسح البوابة" } }),
    onSuccess: () => {
      invalidateAll();
      setWipeOpen(false);
      setWipeConfirm("");
      toast({ title: "مُسحت بيانات البوابة", description: "أُنشئت نسخة احتياطية قبل المسح" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر المسح", description: errMessage(e) });
    },
  });

  // ===== الصفحات الكاملة الداخلية — تُعرض مكان شاشة القائمة (نفس نمط ContractEditPage) =====
  if (page === "upload") {
    return (
      <GatewayUploadPage
        onAuthError={onAuthError}
        activeProfiles={activeProfiles}
        invalidateAll={invalidateAll}
        onDone={() => {
          setPage(null);
          setTab("ops");
        }}
        onCancel={() => setPage(null)}
      />
    );
  }
  if (page === "bank") {
    return (
      <GatewayBankUploadPage
        onAuthError={onAuthError}
        onDone={() => setPage(null)}
        onCancel={() => setPage(null)}
      />
    );
  }
  if (page === "profile") {
    return (
      <GatewayProfileEditPage
        key={profileEditing?.id ?? "new"}
        onAuthError={onAuthError}
        editing={profileEditing}
        onSaved={() => {
          setProfileEditing(null);
          setPage(null);
        }}
        onCancel={() => {
          setProfileEditing(null);
          setPage(null);
        }}
      />
    );
  }

  // ===== مجاميع مساعدة =====
  const pendingT1 = summaryQuery.data?.pendingT1;
  const collectedToday = summaryQuery.data?.collectedToday;
  const totalAll = summaryQuery.data?.total;
  const late = summaryQuery.data?.late ?? [];
  const lateGap = round3(
    late.reduce((s, r) => s + Math.max(0, Number(r.expect || 0) - Number(r.bank_amount || 0)), 0)
  );

  const allSelected = ops.length > 0 && ops.every((o) => selected.has(o.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(ops.map((o) => o.id)));
  };
  const toggleOne = (id: number, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
  };
  const selectedIds = [...selected];

  const renderRowActions = (op: GatewayOpRow) => (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs text-muted-foreground"
        onClick={() => openClassify([op])}
      >
        <Tags className="size-3.5" />
        تصنيف
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        disabled={op.distributed}
        onClick={() => distributeMutation.mutate([op.id])}
      >
        توزيع
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        disabled={!op.distributed}
        onClick={() => undistributeMutation.mutate([op.id])}
      >
        <RotateCcw className="size-3.5" />
        إرجاع
      </Button>
      {manager && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 border-status-danger/40 px-2 text-xs text-status-danger hover:bg-status-danger-bg hover:text-status-danger"
          disabled={!!op.locked}
          title={op.locked ? "مقفلة (موزعة أو مسددة) — لا تُحذف" : undefined}
          onClick={() => setDeleteTarget(op)}
        >
          <Trash2 className="size-3.5" />
          حذف
        </Button>
      )}
    </div>
  );

  const renderMobileCard = (op: GatewayOpRow) => (
    <Card key={op.id}>
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={selected.has(op.id)}
            onCheckedChange={(v) => toggleOne(op.id, v === true)}
            aria-label={`تحديد عملية ${op.id}`}
          />
          <span className="text-sm font-bold tabular-nums">{formatKWD(op.amount)}</span>
          <span className="ms-auto">{statusBadge(op.status)}</span>
          {op.distributed && (
            <Badge className="border-0 bg-status-info-bg text-[10px] text-status-info">
              ◆ موزعة
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>{fmtDate(op.opDate)}</span>
          <span className="font-semibold">{op.gateway}</span>
          <span dir="ltr">{op.phone}</span>
          {op.customer && <span className="font-medium text-foreground">{op.customer}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {op.ref && <span className="font-mono">مرجع: {op.ref}</span>}
          {op.receiptNo && <span className="font-mono text-status-done">سند: {op.receiptNo}</span>}
          {op.gwPaid === 0 && <span className="text-status-warn">معلقة لدى البوابة</span>}
        </div>
        {renderRowActions(op)}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      {/* العنوان */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-extrabold sm:text-xl">
            <CreditCard className="size-5 text-primary" />
            البوابة المالية
          </h1>
          <p className="text-xs text-muted-foreground">
            مطابقة كشف بوابة الدفع بسندات القبض — ما يطابق عملاءنا «لنا» وما لا يظهر «للشركة الأخرى» (القاعدة 9).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" className="h-9 gap-1.5" onClick={() => setPage("upload")}>
            <Upload className="size-4" />
            رفع ملف تسديد
          </Button>
          {manager && (
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5 border-status-danger/40 text-status-danger hover:bg-status-danger-bg hover:text-status-danger"
              onClick={() => {
                setWipeConfirm("");
                setWipeOpen(true);
              }}
            >
              <Eraser className="size-4" />
              مسح شامل
            </Button>
          )}
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={Hourglass}
          label="معلقة T+1"
          value={pendingT1 ? `${pendingT1.count} عملية` : "—"}
          sub={pendingT1 ? formatKWD(pendingT1.amount) : undefined}
          tone="text-status-warn"
        />
        <KpiCard
          icon={Banknote}
          label="محصلة اليوم"
          value={collectedToday ? `${collectedToday.count} عملية` : "—"}
          sub={collectedToday ? formatKWD(collectedToday.amount) : undefined}
          tone="text-status-done"
        />
        <KpiCard
          icon={AlarmClock}
          label="متأخرة التسديد"
          value={`${late.length} يوم`}
          sub={late.length ? `${formatKWD(lateGap)} بلا مقابل بنكي` : summaryQuery.data?.lateLabel || "لا متأخرات"}
          tone={late.length ? "text-status-danger" : undefined}
        />
        <KpiCard
          icon={CreditCard}
          label="عدد عمليات لنا"
          value={totalAll ? String(totalAll.count) : "—"}
          sub={totalAll ? formatKWD(totalAll.amount) : "—"}
        />
      </div>

      {/* التبويبات */}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as GatewayTab)}
      >
        <TabsList className="h-auto w-full justify-start overflow-x-auto">
          <TabsTrigger value="ops" className="gap-1.5">
            <CreditCard className="size-4" />
            العمليات
            <Badge variant="secondary" className="ms-1 h-5 px-1.5 text-[10px]">
              {ops.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="upload" className="gap-1.5">
            <Upload className="size-4" />
            رفع ملف التسديد
          </TabsTrigger>
          <TabsTrigger value="clearing" className="gap-1.5">
            <ScrollText className="size-4" />
            التصفية اليومية
            <Badge variant="secondary" className="ms-1 h-5 px-1.5 text-[10px]">
              {days.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5">
            <Settings2 className="size-4" />
            الإعدادات
            <Badge variant="secondary" className="ms-1 h-5 px-1.5 text-[10px]">
              {profiles.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* ===== تبويب العمليات ===== */}
        <TabsContent value="ops" className="mt-3 space-y-3">
          <Card>
            <CardContent className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-5">
              <Select value={fGateway} onValueChange={setFGateway}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="البوابة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل البوابات</SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.name}>
                      {p.name}
                      {!p.isActive ? " (معطلة)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Segmented value={fStatus} onChange={setFStatus} options={STATUS_FILTERS} />
              <Input
                className="h-9"
                placeholder="بحث: هاتف/عميل/مرجع…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <Input type="date" className="h-9" value={fFrom} onChange={(e) => setFFrom(e.target.value)} aria-label="من تاريخ" />
              <Input type="date" className="h-9" value={fTo} onChange={(e) => setFTo(e.target.value)} aria-label="إلى تاريخ" />
            </CardContent>
          </Card>

          {/* شريط الإجراءات الجماعية */}
          {selected.size > 0 && (
            <Card className="sticky bottom-0 z-30 border-primary/40 bg-primary/5">
              <CardContent className="flex flex-wrap items-center gap-2 p-2.5">
                <span className="text-xs font-extrabold text-primary">المحدد: {selected.size}</span>
                <Button
                  size="sm"
                  className="h-8 gap-1"
                  onClick={() => openClassify(ops.filter((o) => selected.has(o.id)))}
                >
                  <Tags className="size-3.5" />
                  تصنيف كـ…
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={distributeMutation.isPending}
                  onClick={() => distributeMutation.mutate(selectedIds)}
                >
                  توزيع
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={undistributeMutation.isPending}
                  onClick={() => undistributeMutation.mutate(selectedIds)}
                >
                  <RotateCcw className="size-3.5" />
                  إرجاع
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" onClick={() => setSelected(new Set())}>
                  إلغاء التحديد
                </Button>
              </CardContent>
            </Card>
          )}

          {opsQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : opsQuery.isError ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-destructive">
                تعذر تحميل العمليات — {errMessage(opsQuery.error)}
              </CardContent>
            </Card>
          ) : ops.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                <CreditCard className="size-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">لا عمليات بوابة</p>
                <p className="text-xs text-muted-foreground">
                  ارفع ملف تسديد البوابة من تبويب «رفع ملف التسديد» لتحليل العمليات وتصنيفها آليًا.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* سطح المكتب */}
              <Card className="hidden md:block">
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8">
                          <Checkbox
                            checked={allSelected}
                            onCheckedChange={toggleAll}
                            aria-label="تحديد الكل"
                          />
                        </TableHead>
                        <TableHead className="text-start">التاريخ</TableHead>
                        <TableHead className="text-start">البوابة</TableHead>
                        <TableHead className="text-start">الهاتف</TableHead>
                        <TableHead className="text-start">العميل</TableHead>
                        <TableHead className="text-start">المبلغ</TableHead>
                        <TableHead className="text-start">المرجع</TableHead>
                        <TableHead className="text-start">الحالة</TableHead>
                        <TableHead className="text-start">السند</TableHead>
                        <TableHead className="text-start">التوزيع</TableHead>
                        <TableHead className="text-start">إجراءات</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ops.map((op) => (
                        <TableRow key={op.id}>
                          <TableCell>
                            <Checkbox
                              checked={selected.has(op.id)}
                              onCheckedChange={(v) => toggleOne(op.id, v === true)}
                              aria-label={`تحديد عملية ${op.id}`}
                            />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {fmtDate(op.opDate)}
                            {op.effectiveDate && (
                              <div className="text-[10px] text-muted-foreground">فعلي: {fmtDate(op.effectiveDate)}</div>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs font-semibold">{op.gateway}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs" dir="ltr">
                            {op.phone || "—"}
                          </TableCell>
                          <TableCell className="max-w-40">
                            <div className="truncate text-xs" title={op.customer ?? ""}>
                              {op.customer || "—"}
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs font-bold tabular-nums">
                            {formatKWD(op.amount)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap font-mono text-[11px]">{op.ref || "—"}</TableCell>
                          <TableCell>{statusBadge(op.status)}</TableCell>
                          <TableCell className="whitespace-nowrap font-mono text-[11px] text-status-done">
                            {op.receiptNo || "—"}
                          </TableCell>
                          <TableCell>
                            {op.distributed ? (
                              <span
                                className="inline-flex items-center gap-1 text-[11px] font-bold text-status-info"
                                title={op.distributedAt ? `بتاريخ ${fmtDate(op.distributedAt)}` : undefined}
                              >
                                <CheckCircle2 className="size-3.5" />
                                موزعة
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>{renderRowActions(op)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* موبايل */}
              <div className="space-y-2 md:hidden">{ops.map(renderMobileCard)}</div>
            </>
          )}
        </TabsContent>

        {/* ===== تبويب رفع ملف التسديد ===== */}
        <TabsContent value="upload" className="mt-3 space-y-3">
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <Upload className="size-8 text-primary/60" />
              <p className="text-sm font-semibold">رفع ملف تسديد بوابة الدفع</p>
              <p className="max-w-xl text-xs text-muted-foreground">
                الملف النصي (CSV/TSV بأي فاصل فاصلة/تاب/فاصلة منقوطة) يُحلل أعمدته (تاريخ، هاتف، مبلغ، مرجع) ثم
                تُطابق العمليات آليًا بسندات القبض: المطابق «لنا»، وغير المطابق «للشركة الأخرى». التثبيت تراكمي
                ولا يمس الموزَّع/المسدد.
              </p>
              <Button className="h-9 gap-1.5" onClick={() => setPage("upload")}>
                <Upload className="size-4" />
                فتح صفحة الرفع
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== تبويب التصفية اليومية ===== */}
        <TabsContent value="clearing" className="mt-3 space-y-3">
          <Card>
            <CardContent className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-3">
              <Input type="date" className="h-9" value={cFrom} onChange={(e) => setCFrom(e.target.value)} aria-label="من تاريخ" />
              <Input type="date" className="h-9" value={cTo} onChange={(e) => setCTo(e.target.value)} aria-label="إلى تاريخ" />
              <Select value={cGateway} onValueChange={setCGateway}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="البوابة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل البوابات</SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.name}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {clearingQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : clearingQuery.isError ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-destructive">
                تعذر تحميل التصفية اليومية — {errMessage(clearingQuery.error)}
              </CardContent>
            </Card>
          ) : days.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                <ScrollText className="size-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">لا أيام في الفترة المختارة</p>
                <p className="text-xs text-muted-foreground">
                  التصفية اليومية ثلاثية: مجموع البوابة × متوقع البنك (بعد العمولة) × سطور البنك الفعلية.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead className="text-start">اليوم</TableHead>
                      <TableHead className="text-start">البوابة</TableHead>
                      <TableHead className="text-start">سيستم</TableHead>
                      <TableHead className="text-start">بوابة</TableHead>
                      <TableHead className="text-start">عمولات</TableHead>
                      <TableHead className="text-start">متوقع للبنك</TableHead>
                      <TableHead className="text-start">بنك فعلي</TableHead>
                      <TableHead className="text-start">الفرق</TableHead>
                      <TableHead className="text-start">الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {days.map((d) => {
                      const rowKey = `${d.gateway}|${d.day}`;
                      const open = expandedDay === rowKey;
                      const gwTotal = round3(Number(d.g_mine || 0) + Number(d.g_other || 0));
                      const fees = round3(gwTotal - (Number(d.my_share || 0) + Number(d.other_share || 0)));
                      const gap = Number(d.gap ?? round3(Number(d.expect || 0) - Number(d.bank_amount || 0)));
                      return (
                        <React.Fragment key={rowKey}>
                          <TableRow
                            className="cursor-pointer"
                            onClick={() => setExpandedDay(open ? null : rowKey)}
                          >
                            <TableCell>
                              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs font-bold">
                              {fmtDate(d.day)}
                              {d.settle_date && (
                                <div className="text-[10px] text-muted-foreground">تسوية: {fmtDate(d.settle_date)}</div>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs font-semibold">{d.gateway}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs tabular-nums">{formatKWD(d.sys)}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs tabular-nums">
                              {formatKWD(gwTotal)}
                              <div className="text-[10px] text-muted-foreground">
                                لنا {formatKWD(d.g_mine)} · أخرى {formatKWD(d.g_other)}
                              </div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs tabular-nums text-status-warn">
                              {formatKWD(fees)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs font-semibold tabular-nums">
                              {formatKWD(d.expect)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs font-semibold tabular-nums">
                              {formatKWD(d.bank_amount)}
                            </TableCell>
                            <TableCell className={`whitespace-nowrap text-xs font-bold tabular-nums ${gapTone(gap)}`}>
                              {formatKWD(gap)}
                            </TableCell>
                            <TableCell>
                              <Badge className={`${CLEARING_STATUS_BADGE[d.status] || CLEARING_STATUS_BADGE.pending} border-0 text-[10px]`}>
                                {d.statusLabel || d.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                          {open && (
                            <TableRow className="hover:bg-transparent">
                              <TableCell colSpan={10} className="bg-muted/30 p-3">
                                <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                                  <div className="space-y-1">
                                    <div className="text-[11px] font-bold text-muted-foreground">سطر البنك</div>
                                    {Number(d.bank_amount || 0) === 0 ? (
                                      <p className="text-muted-foreground">لا إيداع بنكي مقابل هذا اليوم</p>
                                    ) : (
                                      <div className="flex flex-wrap items-center gap-3">
                                        <span className="font-mono">{fmtDate(d.bank_date)}</span>
                                        <span className="font-bold tabular-nums">{formatKWD(d.bank_amount)}</span>
                                        <span className="truncate text-muted-foreground">{d.bank_descr || "—"}</span>
                                      </div>
                                    )}
                                  </div>
                                  <div className="space-y-1">
                                    <div className="text-[11px] font-bold text-muted-foreground">تقسيم الصافي</div>
                                    <div className="flex flex-wrap gap-x-4">
                                      <span>
                                        نصيبنا: <span className="font-bold tabular-nums">{formatKWD(d.my_share)}</span>
                                      </span>
                                      <span>
                                        نصيب الأخرى:{" "}
                                        <span className="font-bold tabular-nums">{formatKWD(d.other_share)}</span>
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
                          {/* سطور البنك — قسم داخل التصفية اليومية */}
          <div className="space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              سطور الإيداعات من كشف الحساب البنكي — تُقارن بالمتوقع يوميًا في التصفية اليومية.
            </p>
            <Button size="sm" className="h-9 gap-1.5" onClick={() => setPage("bank")}>
              <Upload className="size-4" />
              رفع كشف بنك
            </Button>
          </div>

          {bankQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : bankQuery.isError ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-destructive">
                تعذر تحميل سطور البنك — {errMessage(bankQuery.error)}
              </CardContent>
            </Card>
          ) : bankLines.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                <Landmark className="size-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">لا سطور بنك بعد</p>
                <p className="text-xs text-muted-foreground">ارفع كشف الحساب (نص/CSV) لاستخراج الإيداعات تلقائيًا.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">التاريخ</TableHead>
                      <TableHead className="text-start">المبلغ</TableHead>
                      <TableHead className="text-start">الوصف</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bankLines.map((bl) => (
                      <TableRow key={bl.id}>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{fmtDate(bl.cdate)}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs font-bold tabular-nums">
                          {formatKWD(bl.amount)}
                        </TableCell>
                        <TableCell className="max-w-72">
                          <div className="truncate text-xs text-muted-foreground" title={bl.descr ?? ""}>
                            {bl.descr || "—"}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* غير المطابقة */}
          <Card>
            <CardContent className="space-y-2 p-3">
              <div className="flex items-center gap-2">
                <UserX className="size-4 text-status-warn" />
                <span className="text-sm font-bold">سطور بنك غير مربوطة</span>
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  {unmatched.length}
                </Badge>
              </div>
              {unmatchedQuery.isLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : unmatched.length === 0 ? (
                <p className="text-xs text-muted-foreground">كل سطور البنك مربوطة بأيام التصفية</p>
              ) : (
                <div className="space-y-1">
                  {unmatched.map((bl) => (
                    <div key={bl.id} className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-2 py-1.5 text-xs">
                      <span className="font-mono">{fmtDate(bl.cdate)}</span>
                      <span className="font-bold tabular-nums">{formatKWD(bl.amount)}</span>
                      <span className="truncate text-muted-foreground">{bl.descr || "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
                  </div>

</TabsContent>

        {/* ===== تبويب الإعدادات ===== */}
        <TabsContent value="settings" className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              إعدادات بوابات الدفع: الحساب البنكي وطرق الدفع والتأجيل T+N والعمولة وحد التحمّل وأيام التأخير.
            </p>
            <Button size="sm" className="h-9 gap-1.5" onClick={() => { setProfileEditing(null); setPage("profile"); }}>
              <Plus className="size-4" />
              بوابة جديدة
            </Button>
          </div>

          {profilesQuery.isLoading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-40 w-full" />
              ))}
            </div>
          ) : profilesQuery.isError ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-destructive">
                تعذر تحميل الإعدادات — {errMessage(profilesQuery.error)}
              </CardContent>
            </Card>
          ) : profiles.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                <Settings2 className="size-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">لا بوابات معرفة</p>
                <p className="text-xs text-muted-foreground">أضف بوابة (Hesabe/KNET…) لتستخدمها في رفع الملفات والتصفية.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {profiles.map((p) => (
                <Card key={p.id} className={!p.isActive ? "opacity-60" : undefined}>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-center gap-2">
                      <CreditCard className="size-4 text-primary/70" />
                      <span className="font-bold">{p.name}</span>
                      {!p.isActive && (
                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                          معطلة
                        </Badge>
                      )}
                      <div className="ms-auto flex items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                          onClick={() => { setProfileEditing(p); setPage("profile"); }}
                        >
                          <Pencil className="size-3.5" />
                          تعديل
                        </Button>
                        {manager && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 border-status-danger/40 px-2 text-xs text-status-danger hover:bg-status-danger-bg hover:text-status-danger"
                            onClick={() => setDeleteProfile(p)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="space-y-0.5 text-xs text-muted-foreground">
                      <div>
                        حساب بنكي: <span className="font-semibold text-foreground">{p.bankAccount || "—"}</span>
                      </div>
                      <div>
                        طرق الدفع: <span className="font-semibold text-foreground">{p.methods || "—"}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3">
                        <span>
                          تأجيل: <span className="font-semibold text-foreground">T+{p.lagDays ?? 0}</span>
                        </span>
                        <span>
                          عمولة/عملية: <span className="font-semibold text-foreground">{formatKWD(Number(p.feeFixed ?? 0))}</span>
                        </span>
                        <span>
                          تحمّل: <span className="font-semibold text-foreground">{Number(p.tolerance ?? 0)}</span>
                        </span>
                        <span>
                          تأخير: <span className="font-semibold text-foreground">{p.lateDays ?? 0} يوم</span>
                        </span>
                      </div>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-xs">
                      <Checkbox
                        checked={p.isActive}
                        onCheckedChange={(v) => profileToggleMutation.mutate({ id: p.id, isActive: v === true })}
                        aria-label={`تفعيل ${p.name}`}
                      />
                      مفعلة
                    </label>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ===== حوار التصنيف ===== */}
      <Dialog open={classifyOpen} onOpenChange={setClassifyOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              تصنيف {classifyContext ? "عملية" : `${classifyIds.length} عملية`}
            </DialogTitle>
            <DialogDescription>
              mine = لشركتنا (يتطلب سند قبض) · other = للشركة الأخرى. التصنيف اليدوي يعلّم الصف في الملفات القادمة.
            </DialogDescription>
          </DialogHeader>
          {classifyContext && (
            <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
              <div>
                <div className="text-muted-foreground">التاريخ</div>
                <div className="font-bold">{fmtDate(classifyContext.opDate)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">الهاتف</div>
                <div className="font-bold" dir="ltr">
                  {classifyContext.phone || "—"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">المبلغ</div>
                <div className="font-extrabold tabular-nums">{formatKWD(classifyContext.amount)}</div>
              </div>
            </div>
          )}
          <Segmented
            value={classifyTarget}
            onChange={(v) => setClassifyTarget(v === "other" ? "other" : "mine")}
            options={[
              { value: "mine", label: "لنا (mine)" },
              { value: "other", label: "شركة أخرى (other)" },
            ]}
          />
          {classifyTarget === "mine" && (
            <div className="space-y-2">
              <Label>سند القبض المرتبط</Label>
              <Select value={classifyReceipt || "none"} onValueChange={(v) => setClassifyReceipt(v === "none" ? "" : v)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={receiptsQuery.isFetching ? "جارٍ جلب السندات…" : "اختر السند"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون سند</SelectItem>
                  {classifyContext?.receiptNo && !receiptOptions.some((v) => v.voucherNumber === classifyContext.receiptNo) && (
                    <SelectItem value={classifyContext.receiptNo}>{classifyContext.receiptNo} (الحالي)</SelectItem>
                  )}
                  {receiptOptions.map((v) => (
                    <SelectItem key={v.id} value={v.voucherNumber}>
                      {v.voucherNumber} — {fmtDate(v.vdate)} — {formatKWD(v.amount)}
                      {v.partyName || v.party ? ` — ${v.partyName || v.party}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="space-y-1.5">
                <Label>أو رقم سند يدويًا</Label>
                <Input
                  className="h-9 ltr text-start"
                  placeholder="RV-0000"
                  value={classifyManual}
                  onChange={(e) => setClassifyManual(e.target.value)}
                />
              </div>
              {receiptsQuery.isError && (
                <p className="text-xs text-muted-foreground">
                  تعذر جلب سندات القبض — استخدم الإدخال اليدوي ({errMessage(receiptsQuery.error)})
                </p>
              )}
            </div>
          )}
          {classifyError && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs font-semibold text-destructive">
              {classifyError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setClassifyOpen(false)}>
              إلغاء
            </Button>
            <Button className="h-9" disabled={classifyMutation.isPending} onClick={submitClassify}>
              {classifyMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              حفظ التصنيف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== حذف بوابة ===== */}
      <Dialog open={deleteProfile !== null} onOpenChange={(o) => !o && setDeleteProfile(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>حذف البوابة {deleteProfile?.name ?? ""}</DialogTitle>
            <DialogDescription>لا يمكن التراجع — العمليات السابقة تبقى محفوظة باسمها.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setDeleteProfile(null)}>
              رجوع
            </Button>
            <Button
              className="h-9 border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80"
              disabled={profileDeleteMutation.isPending}
              onClick={() => deleteProfile && profileDeleteMutation.mutate(deleteProfile.id)}
            >
              {profileDeleteMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== حذف عملية ===== */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>حذف عملية البوابة</DialogTitle>
            <DialogDescription>
              حذف الصف نهائيًا من سجل العمليات — إذا كانت موزعة أرجعها أولًا. لا يمكن التراجع.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="rounded-lg border bg-muted/30 p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">التاريخ / البوابة</span>
                <span className="font-bold">
                  {fmtDate(deleteTarget.opDate)} · {deleteTarget.gateway}
                </span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-muted-foreground">الهاتف / المبلغ</span>
                <span className="font-extrabold tabular-nums" dir="ltr">
                  {deleteTarget.phone} · {formatKWD(deleteTarget.amount)}
                </span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setDeleteTarget(null)}>
              رجوع
            </Button>
            <Button
              className="h-9 border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80"
              disabled={deleteOpMutation.isPending}
              onClick={() => deleteTarget && deleteOpMutation.mutate(deleteTarget.id)}
            >
              {deleteOpMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              حذف نهائي
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== المسح الشامل (مدير) ===== */}
      <Dialog open={wipeOpen} onOpenChange={setWipeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Eraser className="size-5" />
              مسح بيانات البوابة الشامل
            </DialogTitle>
            <DialogDescription>
              يُنشئ نسخة احتياطية آلية ثم يمسح عمليات البوابة وتصنيفاتها وتوزيعها وسطور البنك. اكتب «مسح البوابة»
              حرفيًا للتأكيد.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-lg border border-status-warn/40 bg-status-warn-bg p-2 text-xs font-semibold text-status-warn">
            <Lock className="size-3.5 shrink-0" />
            لا يمس سندات العملاء ولا التسديدات المسددة للشركة الأخرى.
          </div>
          <Input
            className="h-9"
            placeholder="اكتب: مسح البوابة"
            value={wipeConfirm}
            onChange={(e) => setWipeConfirm(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setWipeOpen(false)}>
              إلغاء
            </Button>
            <Button
              className="h-9 border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80"
              disabled={wipeConfirm !== "مسح البوابة" || wipeMutation.isPending}
              onClick={() => wipeMutation.mutate()}
            >
              {wipeMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              مسح شامل
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
