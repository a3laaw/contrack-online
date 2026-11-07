"use client";

/**
 * لوحة تحكم المطور — مركز إدارة SaaS (Task 115):
 * ثلاث تبويبات فوق عزل Task 85 القائم:
 *   • الشركات — الجدول القائم (دخول بضغطة/تعديل/تفعيل) + إنشاء يدوي مع اشتراك اختياري
 *   • طلبات الانضمام — طابور التسجيل الذاتي: اعتماد (إنشاء شركة+مدير+اشتراك تجريبي) أو رفض بسبب موثق
 *   • الاشتراكات — حالة كل شركة الفعلية (تجربة/نشط/مجمّد/منتهي) مع تجديد/تغيير خطة/تجميد/تشغيل
 * المسار الخلفي محروس بدور developer حصريًا — الواجهة كذلك.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Snowflake,
  UserRound,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import type { User } from "./contrack-types";
import { errMessage } from "./contrack-types";
import { apiGet, apiPatch, apiPost, setStoredToken } from "./api";
import {
  SAAS_STATUS_LABELS,
  renewEndsAt,
  type SaasEffectiveStatus,
} from "@/lib/saas-core";

// ===== أنواع بيانات /api/dev/saas =====

interface SaasPlan {
  id: number;
  code: string;
  name: string;
  durationDays: number;
  maxUsers: number;
  maxDivisions: number;
  priceMonthly: number;
}

interface SaasRequest {
  id: number;
  companyName: string;
  shortName: string;
  contactName: string;
  phone: string;
  email: string;
  activity: string;
  requestedUsername: string;
  adminFullName: string;
  status: "pending" | "approved" | "rejected";
  rejectionReason: string;
  createdCompanyId: number | null;
  processedBy: string;
  processedAt: string | null;
  createdAt: string;
}

interface SaasSubInfo {
  id: number;
  status: string;
  effective: SaasEffectiveStatus;
  planCode: string;
  planName: string;
  startsAt: string;
  endsAt: string | null;
  daysLeft: number | null;
  notes: string;
}

interface SaasCompanySub {
  companyId: number;
  companyName: string;
  shortName: string;
  isActive: boolean;
  usersCount: number;
  contractsCount: number;
  subscription: SaasSubInfo | null;
}

interface SaasData {
  stats: {
    pendingRequests: number;
    companiesCount: number;
    trial: number;
    active: number;
    frozen: number;
    expired: number;
    cancelled: number;
    none: number;
  };
  plans: SaasPlan[];
  requests: SaasRequest[];
  subscriptions: SaasCompanySub[];
}

// ===== شارة الحالة الفعلية =====

function StatusBadge({ status }: { status: SaasEffectiveStatus }) {
  const cls: Record<SaasEffectiveStatus, string> = {
    active: "bg-emerald-600 text-white border-transparent",
    trial: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40",
    frozen: "bg-muted text-muted-foreground border-border",
    expired: "bg-destructive text-destructive-foreground border-transparent",
    cancelled: "bg-muted text-muted-foreground border-border line-through",
    none: "bg-transparent text-muted-foreground border-dashed",
  };
  return (
    <Badge variant="outline" className={`text-[11px] ${cls[status]}`}>
      {SAAS_STATUS_LABELS[status]}
    </Badge>
  );
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("ar");
}

const EMPTY_FORM = {
  name: "",
  shortName: "",
  notes: "",
  adminUsername: "",
  adminPassword: "",
  adminFullName: "",
  planCode: "", // فارغ = بلا اشتراك (كالسابق تمامًا)
};

export function DevConsoleView({
  user,
  onAuthError,
}: {
  user: User;
  onAuthError: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<SaasCompanySub | null>(null);
  const [form, setForm] = React.useState(EMPTY_FORM);

  const q = useQuery({
    queryKey: ["dev-saas"],
    queryFn: () => apiGet<SaasData>("/api/dev/saas"),
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["dev-saas"] });

  const createM = useMutation({
    mutationFn: () =>
      apiPost("/api/companies", { ...form, planCode: form.planCode || undefined }),
    onSuccess: () => {
      toast({
        description: `تم إنشاء شركة «${form.name}»${form.planCode ? " مع اشتراكها" : ""}${form.adminUsername ? " ومديرها الأول" : ""}`,
      });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      invalidate();
    },
    onError: (e) => {
      if ((e as { status?: number }).status === 401) onAuthError();
      toast({ variant: "destructive", description: errMessage(e) });
    },
  });

  const updateM = useMutation({
    mutationFn: (v: { id: number; data: Record<string, unknown> }) =>
      apiPatch(`/api/companies/${v.id}`, v.data),
    onSuccess: () => {
      toast({ description: "تم حفظ تعديلات الشركة" });
      setEditTarget(null);
      invalidate();
    },
    onError: (e) => {
      if ((e as { status?: number }).status === 401) onAuthError();
      toast({ variant: "destructive", description: errMessage(e) });
    },
  });

  // الدخول لشركة = إعادة إصدار الجلسة بسياقها ثم تحديث كامل (نمط Task 85)
  const enterM = useMutation({
    mutationFn: (id: number) => apiPost<{ token: string }>("/api/companies/switch", { companyId: id }),
    onSuccess: (_res, id) => {
      setStoredToken(_res.token);
      toast({
        description: `جارٍ الدخول إلى «${q.data?.subscriptions.find((c) => c.companyId === id)?.companyName ?? "الشركة"}»…`,
      });
      setTimeout(() => window.location.reload(), 350);
    },
    onError: (e) => {
      if ((e as { status?: number }).status === 401) onAuthError();
      toast({ variant: "destructive", description: errMessage(e) });
    },
  });

  const data = q.data;
  const stats = data?.stats;
  const companies = data?.subscriptions ?? [];
  const activeCompanies = companies.filter((c) => c.isActive).length;
  const usersTotal = companies.reduce((s, c) => s + c.usersCount, 0);
  const latest = companies.length ? companies[companies.length - 1] : null;

  if (q.isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <Skeleton className="h-9 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (q.isError || !data) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-sm text-destructive">{q.error ? errMessage(q.error) : "لا بيانات"}</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* الترويسة */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-primary-soft-foreground">لوحة تحكم المطور</h1>
            <p className="text-xs text-muted-foreground">
              مركز إدارة المنصة — الشركات وطلبات الانضمام والاشتراكات، وبيانات كل شركة معزولة تمامًا
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => { setForm(EMPTY_FORM); setCreateOpen(true); }}>
          <Plus className="size-4" />
          شركة جديدة
        </Button>
      </div>

      {/* الكروت الإحصائية */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Building2 className="size-4" />
            <span className="text-xs">الشركات</span>
          </div>
          <p className="mt-2 text-2xl font-extrabold tabular-nums">{stats?.companiesCount ?? 0}</p>
          <p className="text-[11px] text-muted-foreground">{activeCompanies} فعّالة</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ClipboardList className="size-4" />
            <span className="text-xs">طلبات معلقة</span>
          </div>
          <p className="mt-2 text-2xl font-extrabold tabular-nums">{stats?.pendingRequests ?? 0}</p>
          <p className="text-[11px] text-muted-foreground">بانتظار الموافقة</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CreditCard className="size-4" />
            <span className="text-xs">اشتراكات نشطة</span>
          </div>
          <p className="mt-2 text-2xl font-extrabold tabular-nums">
            {(stats?.active ?? 0) + (stats?.trial ?? 0)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {(stats?.trial ?? 0)} تجربة · {(stats?.frozen ?? 0)} مجمّد · {(stats?.expired ?? 0)} منتهي
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <UserRound className="size-4" />
            <span className="text-xs">المستخدمون</span>
          </div>
          <p className="mt-2 truncate text-sm font-bold" title={latest?.companyName ?? ""}>
            {usersTotal} مستخدمًا
          </p>
          <p className="text-[11px] text-muted-foreground truncate">
            آخر إضافة: {latest?.companyName || "—"}
          </p>
        </div>
      </div>

      {/* التبويبات */}
      <Tabs defaultValue="companies" dir="rtl">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="companies" className="gap-1.5">
            <Building2 className="size-3.5" />
            الشركات
          </TabsTrigger>
          <TabsTrigger value="requests" className="gap-1.5">
            <ClipboardList className="size-3.5" />
            طلبات الانضمام
            {(stats?.pendingRequests ?? 0) > 0 && (
              <span className="ms-1 rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground tabular-nums">
                {stats?.pendingRequests}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="subscriptions" className="gap-1.5">
            <CreditCard className="size-3.5" />
            الاشتراكات
          </TabsTrigger>
        </TabsList>

        {/* ===== تبويب الشركات ===== */}
        <TabsContent value="companies" className="space-y-4">
          <div className="rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>الشركة</TableHead>
                  <TableHead className="text-center">المستخدمون</TableHead>
                  <TableHead className="text-center">العقود</TableHead>
                  <TableHead className="text-center">الاشتراك</TableHead>
                  <TableHead className="text-center">الحالة</TableHead>
                  <TableHead className="text-left">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((c) => {
                  const isCurrent = c.companyId === user.companyId;
                  const canEnter = c.isActive && !isCurrent;
                  return (
                    <TableRow
                      key={c.companyId}
                      className={canEnter ? "cursor-pointer" : undefined}
                      onClick={canEnter ? () => enterM.mutate(c.companyId) : undefined}
                    >
                      <TableCell className="text-xs text-muted-foreground tabular-nums">{c.companyId}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{c.companyName}</span>
                          {c.shortName && <span className="text-xs text-muted-foreground">({c.shortName})</span>}
                          {isCurrent && <Badge variant="secondary" className="text-[10px]">الحالية</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-center tabular-nums">{c.usersCount}</TableCell>
                      <TableCell className="text-center tabular-nums">{c.contractsCount}</TableCell>
                      <TableCell className="text-center">
                        {c.subscription ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-xs font-medium">{c.subscription.planName}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {c.subscription.daysLeft == null
                                ? "دائم"
                                : c.subscription.daysLeft >= 0
                                  ? `متبقي ${c.subscription.daysLeft} يومًا`
                                  : `انتهى منذ ${Math.abs(c.subscription.daysLeft)} يومًا`}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={c.isActive ? "default" : "outline"}>
                          {c.isActive ? "فعّالة" : "معطّلة"}
                        </Badge>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          {canEnter && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => enterM.mutate(c.companyId)}
                              disabled={enterM.isPending}
                            >
                              {enterM.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                              دخول
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditTarget(c);
                              setForm({
                                ...EMPTY_FORM,
                                name: c.companyName,
                                shortName: c.shortName,
                                notes: "",
                              });
                            }}
                          >
                            تعديل
                          </Button>
                          {c.companyId !== 1 && (
                            <Switch
                              checked={c.isActive}
                              onCheckedChange={(v) =>
                                updateM.mutate({ id: c.companyId, data: { isActive: v } })
                              }
                              aria-label={`تفعيل ${c.companyName}`}
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ===== تبويب طلبات الانضمام ===== */}
        <TabsContent value="requests">
          <RequestsTab data={data} onAuthError={onAuthError} onChanged={invalidate} />
        </TabsContent>

        {/* ===== تبويب الاشتراكات ===== */}
        <TabsContent value="subscriptions">
          <SubscriptionsTab data={data} onAuthError={onAuthError} onChanged={invalidate} />
        </TabsContent>
      </Tabs>

      {/* إنشاء شركة — مع مدير أول اختياري واشتراك اختياري */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>شركة جديدة</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="dc-name">اسم الشركة *</Label>
              <Input
                id="dc-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="مثال: شركة النخبة للمقاولات"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="dc-short">اختصار (اختياري)</Label>
                <Input id="dc-short" value={form.shortName} onChange={(e) => setForm((f) => ({ ...f, shortName: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dc-full">اسم المدير (اختياري)</Label>
                <Input id="dc-full" value={form.adminFullName} onChange={(e) => setForm((f) => ({ ...f, adminFullName: e.target.value }))} placeholder="مدير" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dc-plan">خطة الاشتراك (اختياري)</Label>
              <Select
                value={form.planCode || "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, planCode: v === "none" ? "" : v }))}
              >
                <SelectTrigger id="dc-plan">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون اشتراك (كالشركات اليدوية السابقة)</SelectItem>
                  {(data?.plans ?? []).map((p) => (
                    <SelectItem key={p.code} value={p.code}>
                      {p.name} — {p.durationDays === 0 ? "دائم" : `${p.durationDays} يومًا`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dc-notes">ملاحظات (اختياري)</Label>
              <Textarea id="dc-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>

            <div className="rounded-lg border bg-primary-soft/50 p-3 space-y-2.5">
              <p className="text-xs font-semibold text-primary-soft-foreground">
                مدير الشركة الأول (اختياري) — يُنشأ حساب admin جاهز لتسليم الشركة فورًا
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="dc-admin-user" className="text-xs">اسم المستخدم</Label>
                  <Input
                    id="dc-admin-user"
                    dir="ltr"
                    value={form.adminUsername}
                    onChange={(e) => setForm((f) => ({ ...f, adminUsername: e.target.value }))}
                    placeholder="admin"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dc-admin-pass" className="text-xs">كلمة المرور</Label>
                  <Input
                    id="dc-admin-pass"
                    dir="ltr"
                    type="password"
                    value={form.adminPassword}
                    onChange={(e) => setForm((f) => ({ ...f, adminPassword: e.target.value }))}
                    placeholder="6 أحرف على الأقل"
                    autoComplete="new-password"
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>إلغاء</Button>
            <Button
              onClick={() => createM.mutate()}
              disabled={!form.name.trim() || createM.isPending}
            >
              {createM.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  جارٍ الإنشاء…
                </>
              ) : (
                "إنشاء"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تعديل شركة */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>تعديل: {editTarget?.companyName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="dc-e-name">اسم الشركة</Label>
              <Input id="dc-e-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dc-e-short">اختصار</Label>
              <Input id="dc-e-short" value={form.shortName} onChange={(e) => setForm((f) => ({ ...f, shortName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dc-e-notes">ملاحظات</Label>
              <Textarea id="dc-e-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>إلغاء</Button>
            <Button
              onClick={() =>
                editTarget &&
                updateM.mutate({ id: editTarget.companyId, data: { name: form.name, shortName: form.shortName, notes: form.notes } })
              }
              disabled={!form.name.trim() || updateM.isPending}
            >
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// تبويب طلبات الانضمام
// ============================================================

function RequestsTab({
  data,
  onAuthError,
  onChanged,
}: {
  data: SaasData;
  onAuthError: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [filter, setFilter] = React.useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [approveTarget, setApproveTarget] = React.useState<SaasRequest | null>(null);
  const [rejectTarget, setRejectTarget] = React.useState<SaasRequest | null>(null);

  const filtered = React.useMemo(() => {
    const list = data.requests;
    return filter === "all" ? list : list.filter((r) => r.status === filter);
  }, [data.requests, filter]);

  const approveM = useMutation({
    mutationFn: (v: { id: number; username: string; planCode: string }) =>
      apiPost<{ message: string }>(`/api/dev/requests/${v.id}/approve`, {
        username: v.username,
        planCode: v.planCode,
      }),
    onSuccess: (res) => {
      toast({ description: res.message });
      setApproveTarget(null);
      onChanged();
    },
    onError: (e) => {
      if ((e as { status?: number }).status === 401) onAuthError();
      toast({ variant: "destructive", description: errMessage(e) });
    },
  });

  const rejectM = useMutation({
    mutationFn: (v: { id: number; reason: string }) =>
      apiPost<{ message: string }>(`/api/dev/requests/${v.id}/reject`, { reason: v.reason }),
    onSuccess: (res) => {
      toast({ description: res.message });
      setRejectTarget(null);
      onChanged();
    },
    onError: (e) => {
      if ((e as { status?: number }).status === 401) onAuthError();
      toast({ variant: "destructive", description: errMessage(e) });
    },
  });

  const counts = {
    pending: data.requests.filter((r) => r.status === "pending").length,
    approved: data.requests.filter((r) => r.status === "approved").length,
    rejected: data.requests.filter((r) => r.status === "rejected").length,
    all: data.requests.length,
  };

  const chip = (key: typeof filter, label: string, n: number) => (
    <Button
      key={key}
      size="sm"
      variant={filter === key ? "default" : "outline"}
      className="h-8 gap-1.5"
      onClick={() => setFilter(key)}
    >
      {label}
      <span className="rounded-full bg-black/10 dark:bg-white/10 px-1.5 text-[10px] tabular-nums">{n}</span>
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {chip("pending", "قيد الانتظار", counts.pending)}
        {chip("approved", "المعتمدة", counts.approved)}
        {chip("rejected", "المرفوضة", counts.rejected)}
        {chip("all", "الكل", counts.all)}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
          {filter === "pending"
            ? "لا طلبات معلقة حاليًا — طلبات التسجيل الذاتي من شاشة الدخول تظهر هنا"
            : "لا يوجد ما يطابق هذا التصنيف"}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <div key={r.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Building2 className="size-4 text-muted-foreground" />
                    <span className="font-bold">{r.companyName}</span>
                    {r.shortName && <span className="text-xs text-muted-foreground">({r.shortName})</span>}
                    <StatusBadge
                      status={
                        r.status === "pending"
                          ? "frozen" // رمادي محايد — الحالة تُقرأ من النص أدناه
                          : r.status === "approved"
                            ? "active"
                            : "cancelled"
                      }
                    />
                    {r.status === "pending" && <span className="text-[11px] text-amber-700 dark:text-amber-400">قيد المراجعة</span>}
                    {r.status === "rejected" && (
                      <span className="text-[11px] text-muted-foreground">السبب: {r.rejectionReason}</span>
                    )}
                    {r.status === "approved" && r.createdCompanyId && (
                      <span className="text-[11px] text-muted-foreground">أُنشئت شركة #{r.createdCompanyId}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>مسؤول التواصل: <span className="font-medium text-foreground">{r.contactName}</span></span>
                    {r.phone && <span dir="ltr" className="tabular-nums">{r.phone}</span>}
                    {r.email && <span dir="ltr">{r.email}</span>}
                    {r.activity && <span>النشاط: {r.activity}</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>اسم المستخدم المطلوب: <span dir="ltr" className="font-mono">{r.requestedUsername}</span></span>
                    <span>قدِّم: {fmtDate(r.createdAt)}</span>
                    {r.processedBy && <span>عُولج بواسطة: {r.processedBy}</span>}
                  </div>
                </div>
                {r.status === "pending" && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => setApproveTarget(r)}
                      className="gap-1.5"
                    >
                      <CheckCircle2 className="size-4" />
                      موافقة
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRejectTarget(r)}
                      className="gap-1.5 text-destructive hover:text-destructive"
                    >
                      <XCircle className="size-4" />
                      رفض
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* نافذة الموافقة */}
      <ApproveDialog
        target={approveTarget}
        plans={data.plans}
        pending={approveM.isPending}
        onClose={() => setApproveTarget(null)}
        onConfirm={(username, planCode) =>
          approveTarget && approveM.mutate({ id: approveTarget.id, username, planCode })
        }
      />

      {/* نافذة الرفض */}
      <RejectDialog
        target={rejectTarget}
        pending={rejectM.isPending}
        onClose={() => setRejectTarget(null)}
        onConfirm={(reason) => rejectTarget && rejectM.mutate({ id: rejectTarget.id, reason })}
      />
    </div>
  );
}

function ApproveDialog({
  target,
  plans,
  pending,
  onClose,
  onConfirm,
}: {
  target: SaasRequest | null;
  plans: SaasPlan[];
  pending: boolean;
  onClose: () => void;
  onConfirm: (username: string, planCode: string) => void;
}) {
  const [username, setUsername] = React.useState("");
  const [planCode, setPlanCode] = React.useState("trial");

  React.useEffect(() => {
    if (target) {
      setUsername(target.requestedUsername);
      setPlanCode("trial");
    }
  }, [target]);

  const plan = plans.find((p) => p.code === planCode);

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>اعتماد طلب: {target?.companyName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
            <p>سيتم فور الاعتماد: إنشاء الشركة مع البذر الكامل (شجرة حسابات وقواعد قيد) · إنشاء حساب المدير · تفعيل الاشتراك المختار.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="apr-user">اسم مستخدم المدير</Label>
            <Input
              id="apr-user"
              dir="ltr"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="apr-plan">خطة الاشتراك الأولية</Label>
            <Select value={planCode} onValueChange={setPlanCode}>
              <SelectTrigger id="apr-plan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.code} value={p.code}>
                    {p.name} — {p.durationDays === 0 ? "دائم" : `${p.durationDays} يومًا`} · حتى {p.maxUsers} مستخدمين
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {plan && (
              <p className="text-[11px] text-muted-foreground">
                ينتهي: {plan.durationDays === 0 ? "بلا انتهاء (دائم)" : fmtDate(new Date(Date.now() + plan.durationDays * 86400000).toISOString())}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button
            onClick={() => onConfirm(username.trim(), planCode)}
            disabled={pending || username.trim().length < 3}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            اعتماد وإنشاء الشركة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({
  target,
  pending,
  onClose,
  onConfirm,
}: {
  target: SaasRequest | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  React.useEffect(() => {
    if (target) setReason("");
  }, [target]);
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>رفض طلب: {target?.companyName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="rej-reason">سبب الرفض (يُوثق في السجل) *</Label>
          <Textarea
            id="rej-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="مثال: البيانات غير مكتملة — نرجو إعادة التقديم برقم الهاتف الصحيح"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(reason.trim())}
            disabled={pending || reason.trim().length < 3}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
            رفض الطلب
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// تبويب الاشتراكات
// ============================================================

function SubscriptionsTab({
  data,
  onAuthError,
  onChanged,
}: {
  data: SaasData;
  onAuthError: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [renewTarget, setRenewTarget] = React.useState<SaasCompanySub | null>(null);
  const [planTarget, setPlanTarget] = React.useState<SaasCompanySub | null>(null);

  const subM = useMutation({
    mutationFn: (v: Record<string, unknown>) =>
      apiPost<{ message: string }>("/api/dev/subscriptions", v),
    onSuccess: (res) => {
      toast({ description: res.message });
      onChanged();
    },
    onError: (e) => {
      if ((e as { status?: number }).status === 401) onAuthError();
      toast({ variant: "destructive", description: errMessage(e) });
    },
  });

  const rows = data.subscriptions;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الشركة</TableHead>
              <TableHead>الخطة</TableHead>
              <TableHead className="text-center">الحالة</TableHead>
              <TableHead className="hidden md:table-cell text-center">الانتهاء</TableHead>
              <TableHead className="text-center">المتبقي</TableHead>
              <TableHead className="text-left">إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => {
              const sub = c.subscription;
              const effective = sub?.effective ?? "none";
              const isPermanent = !!sub && sub.endsAt == null;
              return (
                <TableRow key={c.companyId}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{c.companyName}</span>
                      <span className="text-[11px] text-muted-foreground">
                        #{c.companyId} · {c.usersCount} مستخدمين
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{sub ? sub.planName : "—"}</TableCell>
                  <TableCell className="text-center">
                    <StatusBadge status={effective} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-center text-xs text-muted-foreground">
                    {sub ? (isPermanent ? "دائم" : fmtDate(sub.endsAt)) : "—"}
                  </TableCell>
                  <TableCell className="text-center text-xs tabular-nums">
                    {sub
                      ? sub.daysLeft == null
                        ? "∞"
                        : sub.daysLeft >= 0
                          ? `${sub.daysLeft} يومًا`
                          : `-${Math.abs(sub.daysLeft)}`
                      : "—"}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {!sub ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={subM.isPending}
                          onClick={() => subM.mutate({ companyId: c.companyId, action: "assign", planCode: "trial" })}
                          className="gap-1.5"
                        >
                          <PlayCircle className="size-3.5" />
                          تعيين تجربة
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={subM.isPending || isPermanent}
                            title={isPermanent ? "الخطة دائمة بلا حاجة للتجديد" : "تجديد/تمديد المدة"}
                            onClick={() => setRenewTarget(c)}
                            className="gap-1.5"
                          >
                            <RefreshCw className="size-3.5" />
                            تجديد
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={subM.isPending}
                            onClick={() => setPlanTarget(c)}
                            className="gap-1.5"
                          >
                            <CalendarClock className="size-3.5" />
                            الخطة
                          </Button>
                          {sub.status === "frozen" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={subM.isPending}
                              onClick={() => subM.mutate({ companyId: c.companyId, action: "unfreeze" })}
                              className="gap-1.5"
                            >
                              <PlayCircle className="size-3.5" />
                              تشغيل
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={subM.isPending || sub.status === "cancelled"}
                              onClick={() => subM.mutate({ companyId: c.companyId, action: "freeze" })}
                              className="gap-1.5"
                            >
                              <Snowflake className="size-3.5" />
                              تجميد
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        «بدون اشتراك» = الشركات اليدوية القديمة — سلوكها كما كان تمامًا حتى تعيين اشتراك لها. الحالة «منتهي» تُشتق تلقائيًا من انتهاء المدة.
      </p>

      {/* نافذة التجديد */}
      <RenewDialog
        target={renewTarget}
        pending={subM.isPending}
        onClose={() => setRenewTarget(null)}
        onConfirm={(days) =>
          renewTarget && subM.mutate({ companyId: renewTarget.companyId, action: "renew", days })
        }
      />

      {/* نافذة تغيير الخطة */}
      <ChangePlanDialog
        target={planTarget}
        plans={data.plans}
        pending={subM.isPending}
        onClose={() => setPlanTarget(null)}
        onConfirm={(planCode) =>
          planTarget && subM.mutate({ companyId: planTarget.companyId, action: "change_plan", planCode })
        }
      />
    </div>
  );
}

function RenewDialog({
  target,
  pending,
  onClose,
  onConfirm,
}: {
  target: SaasCompanySub | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (days: number) => void;
}) {
  const [days, setDays] = React.useState("30");
  React.useEffect(() => {
    if (target) setDays("30");
  }, [target]);

  const n = Number(days);
  const valid = Number.isFinite(n) && n > 0 && n <= 3650;
  const sub = target?.subscription ?? null;
  const currentEnd = sub?.endsAt ? new Date(sub.endsAt) : null;
  const preview =
    valid && currentEnd
      ? renewEndsAt(currentEnd, n).toLocaleDateString("ar")
      : valid
        ? renewEndsAt(null, n).toLocaleDateString("ar")
        : null;

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>تجديد اشتراك: {target?.companyName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            النهاية الحالية: {sub?.endsAt ? fmtDate(sub.endsAt) : "—"}
            {" · "}الحالة: {sub ? SAAS_STATUS_LABELS[sub.effective] : "—"}
          </div>
          <div className="flex flex-wrap gap-2">
            {[30, 90, 180, 365].map((d) => (
              <Button
                key={d}
                size="sm"
                variant={days === String(d) ? "default" : "outline"}
                className="h-8"
                onClick={() => setDays(String(d))}
              >
                {d === 365 ? "سنة" : `${d} يوم`}
              </Button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rn-days">أو عدد أيام مخصص (1–3650)</Label>
            <Input
              id="rn-days"
              dir="ltr"
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>
          {preview && (
            <p className="text-xs text-muted-foreground">
              الانتهاء الجديد: <span className="font-bold text-foreground">{preview}</span>
              {" — "}التمديد من نهاية الاشتراك الحالي إن كانت مستقبلًا (لا فقدان أيام بالتجديد المبكر)
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button
            onClick={() => valid && onConfirm(n)}
            disabled={pending || !valid}
            className="gap-1.5"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <PauseCircle className="size-4" />}
            تجديد
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangePlanDialog({
  target,
  plans,
  pending,
  onClose,
  onConfirm,
}: {
  target: SaasCompanySub | null;
  plans: SaasPlan[];
  pending: boolean;
  onClose: () => void;
  onConfirm: (planCode: string) => void;
}) {
  const [planCode, setPlanCode] = React.useState("");
  React.useEffect(() => {
    if (target) setPlanCode(target.subscription?.planCode ?? "");
  }, [target]);
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>تغيير خطة: {target?.companyName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cp-plan">الخطة الجديدة</Label>
            <Select value={planCode} onValueChange={setPlanCode}>
              <SelectTrigger id="cp-plan">
                <SelectValue placeholder="اختر الخطة" />
              </SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.code} value={p.code}>
                    {p.name} — {p.durationDays === 0 ? "دائم" : `${p.durationDays} يومًا`}
                    {target?.subscription?.planCode === p.code ? " (الحالية)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              خطة دائمة ⇒ يُلغى تاريخ الانتهاء · خطة مؤقتة على اشتراك دائم ⇒ تبدأ مدتها من الآن · مؤقت→مؤقت يبقي نهاية المدة الحالية (التجديد يعدّل المدة).
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button
            onClick={() => planCode && onConfirm(planCode)}
            disabled={pending || !planCode || planCode === target?.subscription?.planCode}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            تغيير
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
