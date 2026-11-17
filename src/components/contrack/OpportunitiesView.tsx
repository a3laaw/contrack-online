"use client";

/**
 * OpportunitiesView.tsx — شاشة «فرص البيع» ر3 (docs/opportunities-design.md §6):
 * بطاقة ملخص خط الأنابيب (مشتقاقية — G9) + جدول الفرص بفلاتر + حوار إنشاء/تعديل
 * بحرس المراحل المغلقة (د2) وسبب خسارة إلزامي (د3) + «إنشاء عميل من الفرصة» (د5) +
 * «إصدار عرض سعر» عبر معالج العروض القائم حرفيًا (لا شاشة عروض ثانية — G3/د4).
 * لوحة NOVA حصرًا + جوال 375 بلا تمرير أفقي + تذييل مثبت في الشل.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, FileText, MoreHorizontal, Pencil, Plus, RefreshCw, Target, Trash2, UserPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Dropdown } from "./dropdown";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { SearchableSelect } from "./SearchableSelect";
import { errMessage, isManagerRole, type User } from "./contrack-types";
import { formatKWD } from "@/lib/format";
import type { OpportunityQuotePreset } from "@/lib/opportunities-core";
import {
  OPPORTUNITY_LOST_REASONS,
  OPPORTUNITY_SOURCES,
  OPPORTUNITY_STAGES,
  opportunityAllowedTargets,
  opportunityStageBadgeClass,
} from "@/lib/opportunities-constants";

interface OpportunityRow {
  id: number;
  opportunityNumber: string;
  name: string;
  stage: string;
  expectedAmount: number;
  expectedCloseDate: string;
  source: string;
  lostReason: string;
  notes: string;
  customerId: number | null;
  quotationId: number | null;
  createdAt: string;
  customer: { id: number; name: string; customerCode: string } | null;
  quotation: { id: number; quotationNumber: string; status: string } | null;
}

interface OpportunitySummary {
  byStage: Record<string, number>;
  openExpected: number;
  closedCount: number;
  wonCount: number;
  lostCount: number;
  conversionRate: number;
}

interface OpportunityFormState {
  id?: number;
  number?: string;
  stage?: string;
  name: string;
  customerId: string;
  targetStage: string; // عند التعديل — "" = إبقاء المرحلة الحالية
  expectedAmount: string;
  expectedCloseDate: string;
  source: string;
  lostReason: string;
  notes: string;
}

const EMPTY_FORM: OpportunityFormState = {
  name: "",
  customerId: "",
  targetStage: "",
  expectedAmount: "0",
  expectedCloseDate: "",
  source: "",
  lostReason: "",
  notes: "",
};

interface OpportunitiesViewProps {
  user: User;
  onAuthError: () => void;
  /** ر3/د4 — إصدار عرض من الفرصة: الخادم يعيد الحمولة والشل يفتح معالج العروض القائم معبأً */
  onIssueQuote: (preset: OpportunityQuotePreset) => void;
}

export function OpportunitiesView({ user, onAuthError, onIssueQuote }: OpportunitiesViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);

  const [searchInput, setSearchInput] = React.useState("");
  const [q, setQ] = React.useState("");
  const [stageFilter, setStageFilter] = React.useState("الكل");
  const [form, setForm] = React.useState<OpportunityFormState | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<OpportunityRow | null>(null);
  // د5 — «إنشاء عميل من الفرصة»: حوار سريع يملأ الاسم من الفرصة ثم يربط فورًا
  const [quickCustomer, setQuickCustomer] = React.useState<OpportunityRow | null>(null);
  const [quickName, setQuickName] = React.useState("");
  const [quickPhone, setQuickPhone] = React.useState("");

  React.useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const handleError = React.useCallback(
    (e: unknown, fallback: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "خطأ", description: errMessage(e) || fallback });
    },
    [onAuthError, toast]
  );

  const listQuery = useQuery<{ opportunities: OpportunityRow[] }>({
    queryKey: ["opportunities", q, stageFilter],
    queryFn: () =>
      apiGet<{ opportunities: OpportunityRow[] }>(
        `/api/opportunities?q=${encodeURIComponent(q)}&stage=${encodeURIComponent(stageFilter)}`
      ),
  });
  const rows = React.useMemo(
    () => [...(listQuery.data?.opportunities ?? [])].sort((a, b) => b.id - a.id),
    [listQuery.data]
  );

  const summaryQuery = useQuery<{ summary: OpportunitySummary }>({
    queryKey: ["opportunities-summary"],
    queryFn: () => apiGet<{ summary: OpportunitySummary }>("/api/opportunities/summary"),
  });
  const summary = summaryQuery.data?.summary;

  const customersQuery = useQuery<{ customers: Array<{ id: number; name: string }> }>({
    queryKey: ["customers", ""],
    queryFn: () => apiGet<{ customers: Array<{ id: number; name: string }> }>("/api/customers?q="),
    enabled: form !== null,
  });
  const customers = customersQuery.data?.customers ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["opportunities"] });
    qc.invalidateQueries({ queryKey: ["opportunities-summary"] });
  };

  const saveMutation = useMutation({
    mutationFn: (f: OpportunityFormState) => {
      const shared = {
        name: f.name,
        customerId: f.customerId ? Number(f.customerId) : null,
        expectedAmount: Number(f.expectedAmount) || 0,
        expectedCloseDate: f.expectedCloseDate,
        source: f.source,
        notes: f.notes,
      };
      if (f.id) {
        const body: Record<string, unknown> = { ...shared };
        // المرحلة تُرسل عند التغيير حصرًا — حرس الخادم على الانتقالات المغلقة (د2)
        if (f.targetStage && f.stage && f.targetStage !== f.stage) {
          body.stage = f.targetStage;
          if (f.targetStage === "مفقودة") body.lostReason = f.lostReason;
        }
        return apiPatch(`/api/opportunities/${f.id}`, body);
      }
      return apiPost("/api/opportunities", shared); // الإنشاء يبدأ «جديدة» حصرًا (د2)
    },
    onSuccess: (d, f) => {
      invalidate();
      const num = (d as { opportunity?: { opportunityNumber?: string } })?.opportunity?.opportunityNumber || "";
      toast({
        title: f.id ? "تم تعديل الفرصة ✅" : "أُنشئت الفرصة ✅",
        description: num || undefined,
      });
      setForm(null);
    },
    onError: (e) => handleError(e, "تعذر حفظ الفرصة"),
  });

  // د4 — إصدار عرض من الفرصة: الخادم يعيد الحمولة (ويحرس المقفلة) ثم الشل يفتح المعالج معبأً
  const issueQuoteMutation = useMutation({
    mutationFn: (id: number) => apiPost<{ preset: OpportunityQuotePreset }>(`/api/opportunities/${id}/quotation`, {}),
    onSuccess: (d) => {
      onIssueQuote(d.preset);
    },
    onError: (e) => handleError(e, "تعذر تجهيز إصدار العرض"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/opportunities/${id}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "تم الحذف", description: "حُذفت الفرصة بنجاح" });
      setDeleteTarget(null);
    },
    onError: (e) => {
      setDeleteTarget(null);
      handleError(e, "تعذر حذف الفرصة");
    },
  });

  // د5 — إنشاء عميل من الفرصة: POST /api/customers القائم ثم ربط فوري بالفرصة
  const quickCustomerMutation = useMutation({
    mutationFn: async (row: OpportunityRow) => {
      const created = await apiPost<{ customer: { id: number } }>("/api/customers", {
        name: quickName.trim() || row.name,
        phone: quickPhone.trim(),
        notes: `أُنشئ من الفرصة ${row.opportunityNumber} — ر3 فرص البيع`,
      });
      const cid = created.customer?.id ?? 0;
      if (!cid) throw new Error("تعذر إنشاء العميل");
      return apiPatch(`/api/opportunities/${row.id}`, { customerId: cid });
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "أُنشئ العميل وارتبط بالفرصة ✅" });
      setQuickCustomer(null);
    },
    onError: (e) => handleError(e, "تعذر إنشاء العميل من الفرصة"),
  });

  const openCreate = () => setForm({ ...EMPTY_FORM });
  const openEdit = (row: OpportunityRow) =>
    setForm({
      id: row.id,
      number: row.opportunityNumber,
      stage: row.stage,
      name: row.name,
      customerId: row.customerId ? String(row.customerId) : "",
      targetStage: "",
      expectedAmount: String(row.expectedAmount ?? 0),
      expectedCloseDate: row.expectedCloseDate || "",
      source: row.source || "",
      lostReason: row.lostReason || "",
      notes: row.notes || "",
    });

  const openQuickCustomer = (row: OpportunityRow) => {
    setQuickCustomer(row);
    setQuickName(row.name);
    setQuickPhone("");
  };

  const formStage = form?.id ? (form.stage ?? "جديدة") : "";
  const targets = form?.id && formStage ? opportunityAllowedTargets(formStage) : [];
  const needsLostReason =
    !!form && form.targetStage === "مفقودة" && formStage !== "مفقودة";
  const showLostReason = needsLostReason || (!!form?.id && formStage === "مفقودة" && !!form?.number);

  const stageIsClosed = (s: string) => s === "مقبولة" || s === "مفقودة";

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 max-w-full">
      {/* الرأس */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-gold-tile">
            <Target className="size-5 text-brand-orange" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-foreground truncate">فرص البيع</h1>
            <p className="text-xs text-muted-foreground truncate">
              خط أنابيب الفرص قبل التسعير — الإصدار عبر معالج العروض القائم ومزامنة آلية عند القبول والرفض
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9" onClick={() => listQuery.refetch()} disabled={listQuery.isFetching}>
            <RefreshCw className={`size-4 ${listQuery.isFetching ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">تحديث</span>
          </Button>
          <Button size="sm" className="h-9 shadow-[0_2px_0_0_var(--brand-flame)] active:translate-y-[1px] active:shadow-none" onClick={openCreate}>
            <Plus className="size-4" /> فرصة جديدة
          </Button>
        </div>
      </div>

      {/* بطاقة الملخص — اشتقاقية بلا عدادات (G9) */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          {OPPORTUNITY_STAGES.map((s) => (
            <Badge key={s} variant="outline" className={`border-transparent ${opportunityStageBadgeClass(s)}`}>
              {s}: {summary?.byStage?.[s] ?? 0}
            </Badge>
          ))}
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
          <span className="text-xs text-muted-foreground">
            المفتوح المتوقع: <b className="text-foreground">{formatKWD(summary?.openExpected ?? 0)}</b>
          </span>
          <span className="text-xs text-muted-foreground">
            معدل التحويل: <b className="text-foreground">{Math.round((summary?.conversionRate ?? 0) * 100)}%</b>
          </span>
        </div>
      </div>

      {/* الفلاتر */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="بحث بالاسم أو العميل أو الملاحظات…"
          className="h-9 max-w-xs"
        />
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="الكل">كل المراحل</SelectItem>
            {OPPORTUNITY_STAGES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* الجدول */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="max-h-96 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">الرقم</TableHead>
                <TableHead>الفرصة</TableHead>
                <TableHead className="hidden md:table-cell">العميل</TableHead>
                <TableHead>المرحلة</TableHead>
                <TableHead className="text-left">المتوقع</TableHead>
                <TableHead className="hidden lg:table-cell">الإغلاق المتوقع</TableHead>
                <TableHead className="hidden lg:table-cell">العرض</TableHead>
                <TableHead className="w-14"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">جارِ التحميل…</TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    لا فرص بعد — ابدأ بفرصة جديدة وستُتتبع حتى عرض السعر وقبوله
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.opportunityNumber}</TableCell>
                    <TableCell className="max-w-[220px]">
                      <div className="font-medium truncate">{row.name}</div>
                      <div className="text-xs text-muted-foreground md:hidden truncate">
                        {row.customer?.name || "بلا عميل"}
                        {row.source ? ` · ${row.source}` : ""}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell max-w-[160px]">
                      {row.customer ? <span className="truncate block">{row.customer.name}</span> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`border-transparent ${opportunityStageBadgeClass(row.stage)}`}>
                        {row.stage}
                      </Badge>
                      {stageIsClosed(row.stage) && row.lostReason ? (
                        <div className="mt-1 text-xs text-muted-foreground">{row.lostReason}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-left font-mono text-xs whitespace-nowrap">{formatKWD(row.expectedAmount)}</TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground whitespace-nowrap">{row.expectedCloseDate || "—"}</TableCell>
                    <TableCell className="hidden lg:table-cell text-xs">
                      {row.quotation ? (
                        <span className="font-mono text-status-info">{row.quotation.quotationNumber}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Dropdown
                        align="start"
                        triggerLabel={`إجراءات الفرصة ${row.opportunityNumber}`}
                        trigger={
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-hover text-muted-foreground">
                            <MoreHorizontal className="size-4" />
                          </span>
                        }
                        items={[
                          { key: "edit", label: "تعديل", icon: Pencil, onSelect: () => openEdit(row) },
                          ...(stageIsClosed(row.stage)
                            ? []
                            : [{ key: "issue", label: "إصدار عرض سعر", icon: FileText, onSelect: () => issueQuoteMutation.mutate(row.id) }]),
                          ...(!row.customerId
                            ? [{ key: "mkcust", label: "إنشاء عميل من الفرصة", icon: UserPlus, onSelect: () => openQuickCustomer(row) }]
                            : []),
                          ...(manager && !row.quotationId
                            ? [{ key: "del", label: "حذف", icon: Trash2, danger: true, onSelect: () => setDeleteTarget(row) }]
                            : []),
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* حوار إنشاء/تعديل */}
      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.id ? `تعديل الفرصة ${form.number || ""}` : "فرصة جديدة"}</DialogTitle>
            <DialogDescription>
              {form?.id
                ? "المرحلة تتحرك ضمن الانتقالات المغلقة — والمقفلة لا تُعدَّل مرحلتها"
                : "الفرصة تبدأ «جديدة» وتتحرك عبر خط الأنابيب حتى العرض والقبول"}
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>اسم الفرصة *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="مثال: توريد وتشطيب مجمع تجاري"
                />
              </div>
              <div className="space-y-1.5">
                <Label>العميل (اختياري)</Label>
                <SearchableSelect
                  value={form.customerId}
                  onValueChange={(v) => setForm({ ...form, customerId: v })}
                  options={customers.map((c) => ({ value: String(c.id), label: c.name }))}
                  placeholder="اختر العميل"
                  searchPlaceholder="ابحث بالاسم…"
                  emptyText="لا نتائج مطابقة"
                />
                {!form.id && (
                  <p className="text-xs text-muted-foreground">
                    لا عميل بعد؟ أنشئ الفرصة أولًا ثم استخدم «إنشاء عميل من الفرصة» من قائمة السطر (د5).
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>المبلغ المتوقع (د.ك)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.001"
                    value={form.expectedAmount}
                    onChange={(e) => setForm({ ...form, expectedAmount: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>الإغلاق المتوقع</Label>
                  <Input
                    type="date"
                    value={form.expectedCloseDate}
                    onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>المصدر</Label>
                <Select value={form.source || "none"} onValueChange={(v) => setForm({ ...form, source: v === "none" ? "" : v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="بدون" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون</SelectItem>
                    {OPPORTUNITY_SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {form.id && (
                <div className="space-y-1.5">
                  <Label>المرحلة</Label>
                  {targets.length > 0 ? (
                    <Select
                      value={form.targetStage || form.stage || ""}
                      onValueChange={(v) => setForm({ ...form, targetStage: v === form.stage ? "" : v })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={form.stage || ""}>
                          {form.stage} (الحالية)
                        </SelectItem>
                        {targets.map((t) => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`border-transparent ${opportunityStageBadgeClass(form.stage || "")}`}>
                        {form.stage}
                      </Badge>
                      <span className="text-xs text-muted-foreground">مرحلة نهائية — لا تتحرك</span>
                    </div>
                  )}
                </div>
              )}
              {showLostReason && (
                <div className="space-y-1.5">
                  <Label>سبب الخسارة *</Label>
                  <Select value={form.lostReason || "none"} onValueChange={(v) => setForm({ ...form, lostReason: v === "none" ? "" : v })}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="اختر السبب" />
                    </SelectTrigger>
                    <SelectContent>
                      {OPPORTUNITY_LOST_REASONS.map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>ملاحظات</Label>
                <Textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="تفاصيل الفرصة، الشخص المسؤول، الخطوة التالية…"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>إلغاء</Button>
            <Button
              className="shadow-[0_2px_0_0_var(--brand-flame)] active:translate-y-[1px] active:shadow-none"
              disabled={saveMutation.isPending || !form?.name.trim() || (needsLostReason && !form?.lostReason)}
              onClick={() => form && saveMutation.mutate(form)}
            >
              {saveMutation.isPending ? "جارِ الحفظ…" : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* د5 — حوار إنشاء عميل من الفرصة */}
      <Dialog open={quickCustomer !== null} onOpenChange={(o) => !o && setQuickCustomer(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>إنشاء عميل من الفرصة</DialogTitle>
            <DialogDescription>
              {quickCustomer ? `من الفرصة ${quickCustomer.opportunityNumber} — يُربط بالفرصة فور الحفظ` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>اسم العميل</Label>
              <Input value={quickName} onChange={(e) => setQuickName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>الهاتف</Label>
              <Input value={quickPhone} onChange={(e) => setQuickPhone(e.target.value)} placeholder="اختياري" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickCustomer(null)}>إلغاء</Button>
            <Button
              disabled={quickCustomerMutation.isPending || !quickName.trim()}
              onClick={() => quickCustomer && quickCustomerMutation.mutate(quickCustomer)}
              className="shadow-[0_2px_0_0_var(--brand-flame)] active:translate-y-[1px] active:shadow-none"
            >
              <Building2 className="size-4" /> إنشاء وربط
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* حوار تأكيد الحذف */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>حذف الفرصة</DialogTitle>
            <DialogDescription>
              {deleteTarget ? `حذف ${deleteTarget.opportunityNumber} — ${deleteTarget.name}؟ لا يمكن التراجع.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? "جارِ الحذف…" : "حذف"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
