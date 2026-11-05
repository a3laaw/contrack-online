"use client";

/**
 * شاشة «دليل الحسابات» — Task 102/103 (المحاسبة الكاملة).
 * تبويبان:
 *  1) الدليل: شجرة قابلة للطي بأكواد وأرصدة افتتاحية، إضافة/تعديل/إيقاف/حذف
 *     (منع حذف النظامي أو ذي الفروع أو المربوط)، وبذر الدليل الكويتي القياسي.
 *  2) خريطة XBRL: ربط الأوراق بعناصر taxonomy الكويتي/IFRS — هدف التوافق الأساسي
 *     مع التقديم الإلكتروني لوزارة التجارة والصناعة.
 *  Task 105 — تاب «جسر المصروفات» أُسقط: شجرة المصروفات القديمة دُمجت آليًا في
 *  الدليل الموحد (Account) ولا جسر بعد الآن.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  Layers3,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "./api";
import type { AccountDTO, ChartAccountsResponse } from "./contrack-types";
import { errMessage } from "./contrack-types";
import { formatKWD } from "@/lib/format";
import { checkOpeningBalance } from "@/lib/accounting-core";

const TYPE_LABEL: Record<string, string> = {
  asset: "أصول",
  liability: "التزامات",
  equity: "حقوق ملكية",
  revenue: "إيرادات",
  expense: "مصروفات",
};

const TYPE_BADGE: Record<string, string> = {
  asset: "bg-status-info-bg text-status-info",
  liability: "bg-status-warn-bg text-status-warn",
  equity: "bg-status-done-bg text-status-done",
  revenue: "bg-status-done-bg text-status-done",
  expense: "bg-status-danger-bg text-status-danger",
};

interface AccountForm {
  id?: number;
  code: string;
  name: string;
  type: string;
  parentId: number | null;
  openingBalance: string;
  openingDirection: "debit" | "credit";
  xbrlElement: string;
  notes: string;
  allowPosting: boolean;
  isSystem?: boolean;
}

export function ChartOfAccountsView({ onAuthError }: { onAuthError: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const accQuery = useQuery<ChartAccountsResponse, Error>({
    queryKey: ["accounts"],
    queryFn: async () => apiGet<ChartAccountsResponse>("/api/accounts"),
    retry: false,
  });
  const accounts: AccountDTO[] = accQuery.data?.accounts ?? [];
  const byId = React.useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const childrenOf = React.useMemo(() => {
    const m = new Map<number, AccountDTO[]>();
    for (const a of accounts) {
      if (a.parentId != null) {
        if (!m.has(a.parentId)) m.set(a.parentId, []);
        m.get(a.parentId)!.push(a);
      }
    }
    return m;
  }, [accounts]);
  const roots = React.useMemo(() => accounts.filter((a) => a.parentId == null), [accounts]);
  const leaves = React.useMemo(() => accounts.filter((a) => a.isLeaf), [accounts]);

  // ===== توازن الأرصدة الافتتاحية (Task 103) =====
  const openingCheck = React.useMemo(
    () =>
      checkOpeningBalance(
        accounts.map((a) => ({
          code: a.code,
          name: a.name,
          type: a.type as never,
          nature: a.nature as never,
          openingBalance: a.openingBalance,
        }))
      ),
    [accounts]
  );

  const fail = React.useCallback(
    (e: unknown, title: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title, description: errMessage(e) });
    },
    [onAuthError, toast]
  );
  const refresh = () => qc.invalidateQueries({ queryKey: ["accounts"] });

  // ===== بحث الشجرة =====
  const [search, setSearch] = React.useState("");
  const matchesSearch = React.useCallback(
    (a: AccountDTO): boolean => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return a.code.includes(q) || a.name.toLowerCase().includes(q) || a.xbrlElement.toLowerCase().includes(q);
    },
    [search]
  );
  /** هل له سليل مطابق للبحث؟ (لعرض الأب ولا فقدان السياق) — ترافرز تكراري بلا مرجع ذاتي */
  const descendantMatches = React.useCallback(
    (id: number): boolean => {
      const stack = [...(childrenOf.get(id) ?? [])];
      while (stack.length) {
        const cur = stack.pop()!;
        if (matchesSearch(cur)) return true;
        stack.push(...(childrenOf.get(cur.id) ?? []));
      }
      return false;
    },
    [childrenOf, matchesSearch]
  );

  // ===== حالة الطي =====
  const [collapsed, setCollapsed] = React.useState<Record<number, boolean>>({});
  const toggleCollapse = (id: number) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };
  const expandAll = () => setCollapsed({});
  const collapseAll = () => {
    const next: Record<number, boolean> = {};
    for (const a of accounts) if ((childrenOf.get(a.id)?.length ?? 0) > 0) next[a.id] = true;
    setCollapsed(next);
  };

  // ===== البذر =====
  const seedMutation = useMutation({
    mutationFn: () => apiPost<{ seeded: boolean; count: number }>("/api/accounts/seed"),
    onSuccess: (res) => {
      toast({ title: `تم بذر الدليل الكويتي القياسي — ${res.count} حسابًا` });
      refresh();
    },
    onError: (e) => fail(e, "تعذر البذر"),
  });

  // ===== إضافة/تعديل =====
  const [form, setForm] = React.useState<AccountForm | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<AccountDTO | null>(null);
  const [deleteReason, setDeleteReason] = React.useState("");

  const openAdd = (parent: AccountDTO | null) => {
    const type = parent?.type ?? "asset";
    const prefix = type === "liability" ? "2" : type === "equity" ? "3" : type === "revenue" ? "4" : type === "expense" ? "5" : "1";
    setForm({
      code: parent ? "" : `${prefix}900`,
      name: "",
      type,
      parentId: parent?.id ?? null,
      openingBalance: "0",
      openingDirection: "debit",
      xbrlElement: "",
      notes: "",
      allowPosting: true,
      isSystem: false,
    });
  };

  const openEdit = (a: AccountDTO) => {
    setForm({
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      parentId: a.parentId,
      openingBalance: String(Math.abs(a.openingBalance)),
      openingDirection: a.openingBalance < 0 ? "credit" : "debit",
      xbrlElement: a.xbrlElement,
      notes: a.notes,
      allowPosting: a.allowPosting,
      isSystem: a.isSystem,
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form) return null;
      if (form.id) {
        return apiPatch(`/api/accounts/${form.id}`, {
          name: form.name.trim(),
          notes: form.notes,
          allowPosting: form.allowPosting,
          openingBalance: form.openingDirection === "credit" ? -Math.abs(Number(form.openingBalance) || 0) : Math.abs(Number(form.openingBalance) || 0),
          xbrlElement: form.xbrlElement.trim(),
        });
      }
      return apiPost("/api/accounts", {
        code: form.code.trim(),
        name: form.name.trim(),
        type: form.type,
        nature: undefined, // تُشتق من النوع (الاستثناء عبر التعديل لا الإضافة)
        parentId: form.parentId,
        xbrlElement: form.xbrlElement.trim(),
        notes: form.notes,
      });
    },
    onSuccess: () => {
      toast({ title: form?.id ? "تم حفظ التعديلات" : "تمت إضافة الحساب" });
      setForm(null);
      refresh();
    },
    onError: (e) => fail(e, form?.id ? "تعذر الحفظ" : "تعذر الإضافة"),
  });

  const toggleMutation = useMutation({
    mutationFn: (a: AccountDTO) => apiPatch(`/api/accounts/${a.id}`, { isActive: !a.isActive }),
    onSuccess: () => {
      toast({ title: "تم التبديل" });
      refresh();
    },
    onError: (e) => fail(e, "تعذر التبديل"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/accounts/${id}`),
    onSuccess: () => {
      toast({ title: "تم حذف الحساب" });
      setDeleteTarget(null);
      refresh();
    },
    onError: (e) => fail(e, "تعذر الحذف"),
  });

  // ===== سطر شجري واحد =====
  const renderRow = (a: AccountDTO, depth: number): React.ReactNode => {
    const kids = childrenOf.get(a.id) ?? [];
    const hasKids = kids.length > 0;
    const isCollapsed = !!collapsed[a.id];
    const visibleSelfOrChild = matchesSearch(a) || descendantMatches(a.id);
    if (!visibleSelfOrChild) return null;
    const ob = a.openingBalance;
    return (
      <React.Fragment key={a.id}>
        <div
          className={`flex items-center gap-2 border-b px-2 py-1.5 text-sm transition-colors hover:bg-accent/50 ${
            a.isActive ? "" : "opacity-50"
          }`}
          style={{ paddingInlineStart: `${depth * 20 + 8}px` }}
        >
          {hasKids ? (
            <button
              type="button"
              onClick={() => toggleCollapse(a.id)}
              className="shrink-0 rounded p-0.5 hover:bg-accent"
              aria-label={isCollapsed ? `توسيع ${a.name}` : `طي ${a.name}`}
            >
              {isCollapsed ? <ChevronLeft className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
            </button>
          ) : (
            <span className="inline-block w-5 shrink-0" />
          )}
          <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{a.code}</span>
          <span className={`min-w-0 flex-1 truncate font-medium ${a.isActive ? "" : "line-through"}`} title={a.notes || a.name}>
            {a.name}
          </span>
          <Badge variant="outline" className={`shrink-0 text-[11px] ${TYPE_BADGE[a.type] ?? ""}`}>
            {TYPE_LABEL[a.type] ?? a.type}
          </Badge>
          {a.nature === "credit" && a.type === "asset" && (
            <Badge variant="outline" className="shrink-0 bg-status-warn-bg text-[11px] text-status-warn" title="حساب مخالف (مجمع داخل الأصول)">
              مخالف دائن
            </Badge>
          )}
          {!a.isLeaf && <span className="shrink-0 text-[11px] text-muted-foreground">إجمالي</span>}
          {a.isSystem && <Badge variant="outline" className="shrink-0 bg-muted text-[11px] text-muted-foreground">نظامي</Badge>}
          {a.xbrlElement && (
            <Badge variant="outline" className="hidden shrink-0 bg-status-info-bg font-mono text-[11px] text-status-info sm:inline-flex" title={`خريطة XBRL: ${a.xbrlElement}`}>
              XBRL
            </Badge>
          )}
          <span className="hidden w-28 shrink-0 text-end font-mono text-xs md:block">
            {ob !== 0 ? (
              <span className={ob >= 0 ? "" : "text-destructive"}>
                {formatKWD(Math.abs(ob))} {ob >= 0 ? "مدين" : "دائن"}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="إضافة حساب فرعي" onClick={() => openAdd(a)}>
              <Plus className="size-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="تعديل" onClick={() => openEdit(a)}>
              <Pencil className="size-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title={a.isActive ? "إيقاف" : "تفعيل"} onClick={() => toggleMutation.mutate(a)}>
              <RefreshCw className="size-3.5" />
            </Button>
            {!a.isSystem && (
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" title="حذف" onClick={() => { setDeleteTarget(a); setDeleteReason(""); }}>
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
        {hasKids && !isCollapsed && kids.map((k) => renderRow(k, depth + 1))}
      </React.Fragment>
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">دليل الحسابات — أرضية المحاسبة الكاملة</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            الشجرة الكاملة للأصول والالتزامات وحقوق الملكية والإيرادات والمصروفات — بنفس أقسام القوائم المالية
            الكويتية (القرار 44/2016)، وكل حساب يحمل خريطته لعناصر XBRL للتوافق مع التقديم الإلكتروني
            لوزارة التجارة والصناعة. القيود المزدوجة تُبنى فوق هذا الدليل في المرحلة التالية.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline" className="h-6">{accounts.length} حسابًا</Badge>
          <Badge variant="outline" className="h-6">{leaves.length} ورقة تستقبل القيود</Badge>
          <Badge variant="outline" className="h-6">{leaves.filter((l) => l.xbrlElement).length} ورقة موصولة بـXBRL</Badge>
          {openingCheck.balanced ? (
            <Badge className="h-6 bg-status-done-bg text-status-done">الأرصدة الافتتاحية متوازنة ✓</Badge>
          ) : (
            <Badge variant="destructive" className="h-6">
              فرق الأرصدة الافتتاحية: {formatKWD(openingCheck.diff)} د.ك
            </Badge>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="tree" dir="rtl">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="tree">الدليل</TabsTrigger>
          <TabsTrigger value="xbrl">خريطة XBRL</TabsTrigger>
        </TabsList>

        {/* ============ تبويب الدليل ============ */}
        <TabsContent value="tree" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-56">
              <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 ps-8"
                placeholder="بحث بالكود أو الاسم أو عنصر XBRL…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button variant="outline" size="sm" className="h-9" onClick={expandAll}>توسيع الكل</Button>
            <Button variant="outline" size="sm" className="h-9" onClick={collapseAll}>طي الكل</Button>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => openAdd(null)}>
              <Plus className="size-4" /> حساب رئيسي
            </Button>
            <Button size="sm" className="h-9 gap-1.5" disabled={seedMutation.isPending} onClick={() => seedMutation.mutate()}>
              <Sparkles className="size-4" />
              {seedMutation.isPending ? "جارٍ البذر…" : "بذر الدليل الكويتي"}
            </Button>
          </div>

          {accQuery.isLoading ? (
            <div className="space-y-2 rounded-lg border p-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-8 rounded bg-muted animate-pulse" />
              ))}
            </div>
          ) : accQuery.isError ? (
            <div className="rounded-lg border p-8 text-center text-sm text-destructive">
              تعذر تحميل الدليل — {errMessage(accQuery.error)}
              <div className="mt-2">
                <Button size="sm" variant="outline" onClick={() => accQuery.refetch()}>إعادة المحاولة</Button>
              </div>
            </div>
          ) : accounts.length === 0 ? (
            <div className="rounded-lg border p-8 text-center">
              <Layers3 className="mx-auto size-10 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">دليل الشركة فارغ</p>
              <p className="mt-1 text-xs text-muted-foreground">
                انقر «بذر الدليل الكويتي» لتوليد دليل مقاولات قياسي كامل بخريطة XBRL جاهزة.
              </p>
              <Button size="sm" className="mt-3 gap-1.5" disabled={seedMutation.isPending} onClick={() => seedMutation.mutate()}>
                <Sparkles className="size-4" /> بذر الدليل الكويتي
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border">
              <div className="flex items-center gap-2 border-b bg-muted/40 px-2 py-2 text-[11px] font-medium text-muted-foreground">
                <span className="w-5" />
                <span className="w-16">الكود</span>
                <span className="flex-1">الحساب</span>
                <span className="hidden w-28 text-end md:block">الرصيد الافتتاحي</span>
                <span className="w-28 shrink-0">الإجراءات</span>
              </div>
              <div className="max-h-[480px] overflow-y-auto">
                {roots.map((r) => renderRow(r, 0))}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ============ تبويب خريطة XBRL ============ */}
        <XbrlTab accounts={leaves} fail={fail} />

        {/* ============ حوار إضافة/تعديل حساب ============ */}
        <Dialog open={form !== null} onOpenChange={(v) => !v && setForm(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-base">
                {form?.id ? `تعديل الحساب — ${form.code} ${form.name}` : form?.parentId ? `إضافة حساب فرعي تحت ${byId.get(form.parentId)?.name ?? ""}` : "إضافة حساب رئيسي"}
              </DialogTitle>
              <DialogDescription>
                النوع يُشتق من الأب حصرًا، وطبيعة الرصيد تُشتق من النوع تلقائيًا.
              </DialogDescription>
            </DialogHeader>
            {form && (
              <div className="space-y-3">
                {!form.id && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="acc-code">كود الحساب:*</Label>
                      <Input id="acc-code" className="h-9 font-mono" placeholder="مثال: 5270" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>النوع (موروث)</Label>
                      <Input className="h-9 bg-muted" value={TYPE_LABEL[form.type] ?? form.type} disabled />
                    </div>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="acc-name">اسم الحساب:*</Label>
                  <Input id="acc-name" className="h-9" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                {form.id != null && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>الرصيد الافتتاحي (د.ك)</Label>
                      <Input className="h-9 font-mono" inputMode="decimal" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>الاتجاه</Label>
                      <Select value={form.openingDirection} onValueChange={(v) => setForm({ ...form, openingDirection: v as "debit" | "credit" })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="debit">مدين</SelectItem>
                          <SelectItem value="credit">دائن</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="acc-xbrl">خريطة XBRL (عنصر الـtaxonomy)</Label>
                  <Input
                    id="acc-xbrl"
                    className="h-9 font-mono text-xs"
                    dir="ltr"
                    placeholder="ifrs-full:… أو kw:…"
                    value={form.xbrlElement}
                    onChange={(e) => setForm({ ...form, xbrlElement: e.target.value })}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    بصيغة namespace:عنصر — تُستخدم في توليد القوائم الموسومة لبوابة وزارة التجارة (XBRL الكويتي).
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="acc-notes">ملاحظات</Label>
                  <Input id="acc-notes" className="h-9" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
                {form.id != null && (
                  <div className="flex items-center justify-between rounded-lg border p-2.5">
                    <div>
                      <span className="text-sm">يستقبل قيودًا</span>
                      <p className="text-[11px] text-muted-foreground">العُقد (الأوراق) فقط هي التي تستقبل القيود في المرحلة التالية</p>
                    </div>
                    <Switch checked={form.allowPosting} onCheckedChange={(v) => setForm({ ...form, allowPosting: v })} />
                  </div>
                )}
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button variant="outline" className="h-9" onClick={() => setForm(null)} disabled={saveMutation.isPending}>إلغاء</Button>
              <Button className="h-9" disabled={saveMutation.isPending || !form?.name.trim() || (!form?.id && !form?.code.trim())} onClick={() => saveMutation.mutate()}>
                {saveMutation.isPending ? "جارٍ الحفظ…" : "حفظ"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* حوار تأكيد الحذف */}
        <Dialog open={deleteTarget !== null} onOpenChange={(v) => !v && setDeleteTarget(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base">حذف الحساب — {deleteTarget?.code} {deleteTarget?.name}</DialogTitle>
              <DialogDescription>
                يُسمح بحذف الحسابات غير النظامية التي بلا فروع ولا ربط بشجرة المصروفات فقط.
                الحساب النظامي المُبذَّر يُوقف بدلًا من حذفه.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="acc-del-reason">سبب الحذف (يُسجل في التدقيق):*</Label>
              <Input id="acc-del-reason" className="h-9" value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} />
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" className="h-9" onClick={() => setDeleteTarget(null)} disabled={deleteMutation.isPending}>إلغاء</Button>
              <Button
                variant="destructive"
                className="h-9"
                disabled={deleteMutation.isPending || !deleteReason.trim()}
                onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              >
                {deleteMutation.isPending ? "جارٍ الحذف…" : "حذف نهائي"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Tabs>
    </div>
  );
}

// ============================================================
// تبويب خريطة XBRL — ربط الأوراق بعناصر الـtaxonomy (تعديل جماعي)
// ============================================================

function XbrlTab({ accounts, fail }: { accounts: AccountDTO[]; fail: (e: unknown, t: string) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [edits, setEdits] = React.useState<Record<number, string>>({});
  const [filter, setFilter] = React.useState<"all" | "mapped" | "unmapped">("all");

  const dirty = Object.keys(edits).length;
  const mappedCount = accounts.filter((a) => (edits[a.id] ?? a.xbrlElement)).filter((a) => (edits[a.id] ?? a.xbrlElement) !== "").length;

  const rows = accounts.filter((a) => {
    const val = edits[a.id] ?? a.xbrlElement;
    if (filter === "mapped") return val !== "";
    if (filter === "unmapped") return val === "";
    return true;
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const entries = Object.entries(edits);
      for (const [id, value] of entries) {
        await apiPatch(`/api/accounts/${id}`, { xbrlElement: value.trim() });
      }
      return entries.length;
    },
    onSuccess: (n) => {
      toast({ title: `حُفظت خريطة XBRL — ${n} حسابًا` });
      setEdits({});
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (e) => fail(e, "تعذر حفظ الخريطة"),
  });

  return (
    <TabsContent value="xbrl" className="space-y-3">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="h-6">{mappedCount} من {accounts.length} ورقة موصولة</Badge>
            <span className="text-muted-foreground">
              الهدف: كل ورقة تحمل عنصرها في الـtaxonomy الكويتي (IFRS + امتداد kw: للعناصر الخاصة كالزكاة والمحتجزات).
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="mapped">الموصولة فقط</SelectItem>
                <SelectItem value="unmapped">غير الموصولة</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" className="h-9 gap-1.5" disabled={saveMutation.isPending || dirty === 0} onClick={() => saveMutation.mutate()}>
              <Link2 className="size-4" />
              {saveMutation.isPending ? "جارٍ الحفظ…" : `حفظ التغييرات (${dirty})`}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">الكود</TableHead>
              <TableHead className="min-w-44">الحساب</TableHead>
              <TableHead className="min-w-64">عنصر XBRL (namespace:element)</TableHead>
              <TableHead className="w-24 text-center">الحالة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">لا حسابات في هذا الفلتر</TableCell>
              </TableRow>
            ) : (
              rows.map((a) => {
                const val = edits[a.id] ?? a.xbrlElement;
                const changed = edits[a.id] !== undefined && edits[a.id] !== a.xbrlElement;
                return (
                  <TableRow key={a.id} className={changed ? "bg-primary/5" : ""}>
                    <TableCell className="font-mono text-xs">{a.code}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{a.name}</TableCell>
                    <TableCell>
                      <Input
                        className="h-8 font-mono text-xs"
                        dir="ltr"
                        value={val}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [a.id]: e.target.value }))}
                        placeholder="ifrs-full:… / kw:…"
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      {val ? (
                        <Badge className="bg-status-done-bg text-status-done">موصول</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-status-warn-bg text-status-warn">غير موصول</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </TabsContent>
  );
}
