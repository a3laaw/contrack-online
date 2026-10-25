"use client";

/**
 * لوحة تحكم المطور (Task 98) — مركز حوكمة الشركات:
 * كروت إحصائية عامة + جدول الشركات (المساحة الرئيسية) مع الدخول بضغطة
 * (اضغط الشركة لتدخلها) + إضافة شركة بمديرها الأول + تعديل/تفعيل.
 * للمطور فقط — المسار الخلفي محروس بدور developer والواجهة كذلك.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Building2,
  FileSignature,
  Loader2,
  Plus,
  ShieldCheck,
  UserRound,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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

interface DevCompany {
  id: number;
  name: string;
  shortName: string;
  isActive: boolean;
  notes: string;
  createdAt: string;
  usersCount: number;
  contractsCount: number;
}

interface DevConsoleData {
  stats: {
    companiesCount: number;
    activeCompaniesCount: number;
    usersCount: number;
    latestCompanyName: string | null;
    latestCompanyAt: string | null;
  };
  companies: DevCompany[];
  currentCompanyId: number;
  homeCompanyId: number;
}

const EMPTY_FORM = {
  name: "",
  shortName: "",
  notes: "",
  adminUsername: "",
  adminPassword: "",
  adminFullName: "",
};

export function DevConsoleView({
  user,
  onAuthError,
  onBack,
}: {
  user: User;
  onAuthError: () => void;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<DevCompany | null>(null);
  const [form, setForm] = React.useState(EMPTY_FORM);

  const q = useQuery({
    queryKey: ["dev-console"],
    queryFn: () => apiGet<DevConsoleData>("/api/dev/console"),
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["dev-console"] });

  const createM = useMutation({
    mutationFn: () => apiPost("/api/companies", form),
    onSuccess: () => {
      toast({ description: `تم إنشاء شركة «${form.name}»${form.adminUsername ? " مع مديرها الأول" : ""}` });
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
      toast({ description: `جارٍ الدخول إلى «${q.data?.companies.find((c) => c.id === id)?.name ?? "الشركة"}»…` });
      setTimeout(() => window.location.reload(), 350);
    },
    onError: (e) => {
      if ((e as { status?: number }).status === 401) onAuthError();
      toast({ variant: "destructive", description: errMessage(e) });
    },
  });

  const data = q.data;
  const stats = data?.stats;

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
              اضغط على أي شركة للدخول إليها فورًا — بيانات كل شركة معزولة تمامًا
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => { setForm(EMPTY_FORM); setCreateOpen(true); }}>
            <Plus className="size-4" />
            شركة جديدة
          </Button>
          <Button size="sm" variant="outline" onClick={onBack}>
            <ArrowRight className="size-4" />
            رجوع إلى النظام
          </Button>
        </div>
      </div>

      {/* الكروت الإحصائية */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Building2 className="size-4" />
            <span className="text-xs">الشركات</span>
          </div>
          <p className="mt-2 text-2xl font-extrabold tabular-nums">{stats?.companiesCount ?? 0}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ShieldCheck className="size-4" />
            <span className="text-xs">فعّالة</span>
          </div>
          <p className="mt-2 text-2xl font-extrabold tabular-nums">{stats?.activeCompaniesCount ?? 0}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <UserRound className="size-4" />
            <span className="text-xs">المستخدمون</span>
          </div>
          <p className="mt-2 text-2xl font-extrabold tabular-nums">{stats?.usersCount ?? 0}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <FileSignature className="size-4" />
            <span className="text-xs">آخر شركة مضافة</span>
          </div>
          <p className="mt-2 truncate text-sm font-bold" title={stats?.latestCompanyName ?? ""}>
            {stats?.latestCompanyName || "—"}
          </p>
        </div>
      </div>

      {/* جدول الشركات — بلا سكرول داخلي، الصفحة تتمرر كسكرول واحد */}
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>الشركة</TableHead>
              <TableHead className="text-center">المستخدمون</TableHead>
              <TableHead className="text-center">العقود</TableHead>
              <TableHead className="text-center">الحالة</TableHead>
              <TableHead className="hidden md:table-cell">أُنشئت</TableHead>
              <TableHead className="text-left">إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.companies.map((c) => {
              const isCurrent = c.id === data.currentCompanyId;
              const canEnter = c.isActive && !isCurrent;
              return (
                <TableRow
                  key={c.id}
                  className={canEnter ? "cursor-pointer" : undefined}
                  onClick={canEnter ? () => enterM.mutate(c.id) : undefined}
                >
                  <TableCell className="text-xs text-muted-foreground tabular-nums">{c.id}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      {c.shortName && <span className="text-xs text-muted-foreground">({c.shortName})</span>}
                      {isCurrent && <Badge variant="secondary" className="text-[10px]">الحالية</Badge>}
                      {c.id === data.homeCompanyId && <Badge variant="outline" className="text-[10px]">شركتك</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-center tabular-nums">{c.usersCount}</TableCell>
                  <TableCell className="text-center tabular-nums">{c.contractsCount}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={c.isActive ? "default" : "outline"}>
                      {c.isActive ? "فعّالة" : "معطّلة"}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                    {new Date(c.createdAt).toLocaleDateString("ar")}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      {canEnter && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => enterM.mutate(c.id)}
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
                          setForm({ ...EMPTY_FORM, name: c.name, shortName: c.shortName, notes: c.notes });
                        }}
                      >
                        تعديل
                      </Button>
                      {c.id !== 1 && (
                        <Switch
                          checked={c.isActive}
                          onCheckedChange={(v) => updateM.mutate({ id: c.id, data: { isActive: v } })}
                          aria-label={`تفعيل ${c.name}`}
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

      {/* إنشاء شركة — مع مدير أول اختياري */}
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
            <DialogTitle>تعديل: {editTarget?.name}</DialogTitle>
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
              onClick={() => editTarget && updateM.mutate({ id: editTarget.id, data: { name: form.name, shortName: form.shortName, notes: form.notes } })}
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
