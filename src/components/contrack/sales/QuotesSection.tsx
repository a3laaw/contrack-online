"use client";

/**
 * QuotesSection.tsx — قسم «عروض الأسعار» بشاشة كاملة (docs/sales-design.md §6 — د2):
 * يستهلك نفس API العروض القائم بلا أي تغيير (نفس آلة الحالات والترقيم QUO)، ويضيف
 * البيت المستقل: جدول كامل بفلاتر + حوار إنشاء/تعديل (مرآة حوار العملاء) +
 * «تحويل إلى فاتورة بيع» للمقبول/الجديد — أول مستدعٍ واجهة لمنطق التحويل.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, ChevronDown, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";

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
import { Dropdown } from "../dropdown";
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
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../api";
import { SearchableSelect } from "../SearchableSelect";
import { errMessage, isManagerRole, type User } from "../contrack-types";
import { formatKWD, round3 } from "@/lib/format";
import {
  cleanQuotationItems,
  QUOTATION_CUSTOMER_REQUIRED,
  QUOTATION_ITEMS_REQUIRED,
  QUOTATION_STATUSES,
  quotationStatusBadgeClass,
  type QuotationRow,
} from "@/lib/quotes-core";
import { quoteConvertible } from "@/lib/sales-core";
import { QUOTE_CONVERT_MARKER } from "@/lib/sales-constants";
import type { CustomersResponse } from "../contrack-types";

interface QuotesSectionProps {
  user: User;
  onAuthError: () => void;
  onOpenPos: () => void;
}

interface ItemFormRow {
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
}

interface QuoteFormState {
  id?: number;
  customerId: string;
  projectId: string; // "" = بدون مشروع
  description: string;
  validUntil: string;
  notes: string;
  items: ItemFormRow[];
}

const EMPTY_ITEM: ItemFormRow = { description: "", unit: "", quantity: "1", unitPrice: "0" };
const EMPTY_FORM: QuoteFormState = {
  customerId: "",
  projectId: "",
  description: "",
  validUntil: "",
  notes: "",
  items: [{ ...EMPTY_ITEM }],
};

export function QuotesSection({ user, onAuthError, onOpenPos }: QuotesSectionProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);

  const [searchInput, setSearchInput] = React.useState("");
  const [q, setQ] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("الكل");
  const [form, setForm] = React.useState<QuoteFormState | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<QuotationRow | null>(null);
  const [convertTarget, setConvertTarget] = React.useState<QuotationRow | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const listQuery = useQuery<{ quotations: QuotationRow[] }>({
    queryKey: ["quotes", q, statusFilter, "sales-view"],
    queryFn: () =>
      apiGet<{ quotations: QuotationRow[] }>(
        `/api/quotes?q=${encodeURIComponent(q)}&status=${encodeURIComponent(statusFilter)}`
      ),
  });

  const customersQuery = useQuery<CustomersResponse>({
    queryKey: ["customers", ""],
    queryFn: () => apiGet<CustomersResponse>("/api/customers?q="),
    enabled: form !== null,
  });
  const customers = customersQuery.data?.customers ?? [];

  const projectsQuery = useQuery<{ projects: Array<{ id: number; customerId: number | null; name: string }> }>({
    queryKey: ["projects", ""],
    queryFn: () =>
      apiGet<{ projects: Array<{ id: number; customerId: number | null; name: string }> }>("/api/projects?q="),
    enabled: form !== null,
  });
  const projects = React.useMemo(() => {
    const all = projectsQuery.data?.projects ?? [];
    const cid = form?.customerId ? Number(form.customerId) : 0;
    return cid ? all.filter((p) => p.customerId === cid) : all;
  }, [projectsQuery.data, form?.customerId]);

  const handleError = React.useCallback(
    (e: unknown, fallback: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "خطأ", description: errMessage(e) || fallback });
    },
    [onAuthError, toast]
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["quotes"] });
  };

  const itemsTotal = React.useMemo(() => {
    if (!form) return 0;
    return cleanQuotationItems(
      form.items.map((it) => ({
        description: it.description,
        unit: it.unit,
        quantity: Number(it.quantity) || 0,
        unitPrice: Number(it.unitPrice) || 0,
      }))
    ).reduce((s, it) => s + it.totalPrice, 0);
  }, [form]);

  const saveMutation = useMutation({
    mutationFn: (f: QuoteFormState) => {
      const body = {
        customerId: f.customerId ? Number(f.customerId) : null,
        projectId: f.projectId ? Number(f.projectId) : null,
        description: f.description,
        validUntil: f.validUntil,
        notes: f.notes,
        items: f.items.map((it) => ({
          description: it.description,
          unit: it.unit,
          quantity: Number(it.quantity) || 0,
          unitPrice: Number(it.unitPrice) || 0,
        })),
      };
      return f.id ? apiPut(`/api/quotes/${f.id}`, body) : apiPost("/api/quotes", body);
    },
    onSuccess: (d, f) => {
      invalidate();
      const num = (d as { quotation?: { quotationNumber?: string } })?.quotation?.quotationNumber || "";
      toast({ title: f.id ? "تم تعديل عرض السعر ✅" : "أُنشئ عرض السعر ✅", description: num || undefined });
      setForm(null);
    },
    onError: (e) => handleError(e, QUOTATION_ITEMS_REQUIRED),
  });

  const transitionMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiPost(`/api/quotes/${id}/transition`, { status }),
    onSuccess: (d) => {
      invalidate();
      const status = (d as { quotation?: { status?: string } })?.quotation?.status || "";
      toast({ title: "تم تحديث الحالة ✅", description: status });
    },
    onError: (e) => handleError(e, "تعذر تغيير الحالة"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/quotes/${id}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "تم الحذف", description: "حُذف عرض السعر بنجاح" });
      setDeleteTarget(null);
    },
    onError: (e) => {
      setDeleteTarget(null);
      handleError(e, "تعذر حذف عرض السعر");
    },
  });

  const convertMutation = useMutation({
    mutationFn: (id: number) => apiPost<{ invoiceNumber: string }>(`/api/quotes/${id}/convert`, {}),
    onSuccess: (d) => {
      invalidate();
      toast({
        title: "تم التحويل إلى فاتورة بيع ✅",
        description: `الفاتورة ${d.invoiceNumber} صدرت بلا عقد — تجدها في شاشة الفواتير`,
      });
      setConvertTarget(null);
    },
    onError: (e) => {
      setConvertTarget(null);
      handleError(e, "تعذر تحويل العرض");
    },
  });

  const rows = [...(listQuery.data?.quotations ?? [])].sort((a, b) => b.id - a.id);

  const openCreate = () => setForm({ ...EMPTY_FORM, items: [{ ...EMPTY_ITEM }] });
  const openEdit = (row: QuotationRow) =>
    setForm({
      id: row.id,
      customerId: String(row.customerId),
      projectId: row.projectId ? String(row.projectId) : "",
      description: row.description || "",
      validUntil: row.validUntil || "",
      notes: row.notes || "",
      items: (row.items && row.items.length > 0
        ? row.items.map((it) => ({
            description: it.description,
            unit: it.unit || "",
            quantity: String(it.quantity ?? 0),
            unitPrice: String(it.unitPrice ?? 0),
          }))
        : [{ ...EMPTY_ITEM }]),
    });

  const setItem = (idx: number, patch: Partial<ItemFormRow>) => {
    if (!form) return;
    setForm({ ...form, items: form.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) });
  };

  const alreadyConverted = (row: QuotationRow) => (row.notes || "").includes(QUOTE_CONVERT_MARKER);
  const convertible = (row: QuotationRow) => quoteConvertible(row.status) && !alreadyConverted(row);

  return (
    <div className="space-y-3">
      {/* الفلاتر والأزرار */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="h-9 max-w-56"
            placeholder="بحث بالرقم أو العميل…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="بحث في العروض"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-36" aria-label="فلتر الحالة">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="الكل">كل الحالات</SelectItem>
              {QUOTATION_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            onClick={() => listQuery.refetch()}
            aria-label="تحديث"
          >
            <RefreshCw className={`size-4 ${listQuery.isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button className="h-9 gap-1.5" onClick={openCreate}>
            <Plus className="size-4" />
            عرض جديد
          </Button>
        </div>
      </div>

      {/* الجدول الكامل */}
      <div className="max-h-[70vh] overflow-y-auto rounded-lg border" dir="rtl">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
              <TableHead>العرض</TableHead>
              <TableHead className="w-36">العميل</TableHead>
              <TableHead className="w-32">المشروع</TableHead>
              <TableHead className="w-24">الحالة</TableHead>
              <TableHead className="w-28 text-center">الإجمالي</TableHead>
              <TableHead className="w-28">الصلاحية</TableHead>
              <TableHead className="w-44 text-center">إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  جارٍ التحميل…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  {q || statusFilter !== "الكل" ? (
                    "لا نتائج مطابقة للبحث"
                  ) : (
                    <span>
                      لا توجد عروض أسعار بعد — أنشئ أول عرض، أو بيع فورًا من{" "}
                      <button type="button" className="font-medium text-primary-ink underline" onClick={onOpenPos}>
                        نقاط البيع
                      </button>
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="font-medium" dir="ltr">
                      {row.quotationNumber}
                    </div>
                    {row.description && (
                      <div className="max-w-56 truncate text-xs text-muted-foreground" title={row.description}>
                        {row.description}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{row.customerName}</TableCell>
                  <TableCell className="text-sm">{row.projectName || "—"}</TableCell>
                  <TableCell>
                    <Dropdown
                      align="start"
                      triggerLabel={`تغيير حالة ${row.quotationNumber}`}
                      minWidth={170}
                      trigger={
                        <>
                          {row.status || "—"}
                          <ChevronDown className="size-3" aria-hidden />
                        </>
                      }
                      triggerClassName={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition-colors hover:opacity-80 ${quotationStatusBadgeClass(row.status)}`}
                      items={QUOTATION_STATUSES.filter((s) => s !== row.status).map((s) => ({
                        key: s,
                        label: s,
                        onSelect: () => transitionMutation.mutate({ id: row.id, status: s }),
                      }))}
                    />
                  </TableCell>
                  <TableCell className="text-center text-sm tabular-nums" dir="ltr">
                    {formatKWD(row.totalAmount)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground" dir="ltr">
                    {row.validUntil || "—"}
                    <div>{row.itemsCount} بند</div>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      {convertible(row) && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1 text-xs"
                          onClick={() => setConvertTarget(row)}
                          aria-label={`تحويل ${row.quotationNumber} إلى فاتورة`}
                        >
                          <ArrowLeftRight className="size-3.5" />
                          تحويل لفاتورة
                        </Button>
                      )}
                      {alreadyConverted(row) && (
                        <Badge variant="secondary" className="text-[10px]">
                          مُحوَّل
                        </Badge>
                      )}
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(row)} aria-label="تعديل">
                        <Pencil className="size-4" />
                      </Button>
                      {manager && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(row)}
                          aria-label="حذف"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* حوار الإنشاء/التعديل — مرآة حوار العملاء بشاشة كاملة */}
      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>{form?.id ? `تعديل العرض ${""}` : "عرض سعر جديد"}</DialogTitle>
            <DialogDescription>
              تُرقَّم آليًا QUO-#### — بنود بوصف وكمية وسعر، والحالة تُدار من القائمة.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!form.customerId) {
                  toast({ variant: "destructive", title: "خطأ", description: QUOTATION_CUSTOMER_REQUIRED });
                  return;
                }
                if (!form.items.some((it) => it.description.trim())) {
                  toast({ variant: "destructive", title: "خطأ", description: QUOTATION_ITEMS_REQUIRED });
                  return;
                }
                saveMutation.mutate(form);
              }}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>العميل *</Label>
                  <SearchableSelect
                    value={form.customerId}
                    onValueChange={(v) => setForm({ ...form, customerId: v, projectId: "" })}
                    options={customers.map((c) => ({ value: String(c.id), label: c.name }))}
                    placeholder="اختر العميل"
                    searchPlaceholder="ابحث بالاسم…"
                    emptyText="لا نتائج مطابقة"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>المشروع</Label>
                  <SearchableSelect
                    value={form.projectId || "none"}
                    onValueChange={(v) => setForm({ ...form, projectId: v === "none" ? "" : v })}
                    options={[
                      { value: "none", label: "— بدون مشروع —" },
                      ...projects.map((p) => ({ value: String(p.id), label: p.name })),
                    ]}
                    placeholder="— بدون مشروع —"
                    searchPlaceholder="ابحث باسم المشروع…"
                    emptyText="لا نتائج مطابقة"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>وصف العرض</Label>
                  <Input
                    className="h-9"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>صالح حتى</Label>
                  <Input
                    type="date"
                    className="h-9"
                    value={form.validUntil}
                    onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>البنود *</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1"
                    onClick={() => setForm({ ...form, items: [...form.items, { ...EMPTY_ITEM }] })}
                  >
                    <Plus className="size-3.5" />
                    بند
                  </Button>
                </div>
                <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border p-2">
                  {form.items.map((it, idx) => {
                    const lineTotal = round3((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0));
                    return (
                      <div key={idx} className="flex flex-wrap items-end gap-2">
                        <div className="min-w-40 flex-1 space-y-1">
                          <Input
                            className="h-9"
                            placeholder={`وصف البند ${idx + 1}`}
                            value={it.description}
                            onChange={(e) => setItem(idx, { description: e.target.value })}
                          />
                        </div>
                        <div className="w-20 space-y-1">
                          <Input
                            className="h-9"
                            placeholder="الوحدة"
                            value={it.unit}
                            onChange={(e) => setItem(idx, { unit: e.target.value })}
                          />
                        </div>
                        <div className="w-24 space-y-1">
                          <Input
                            type="number"
                            min="0"
                            step="0.001"
                            className="h-9"
                            placeholder="الكمية"
                            dir="ltr"
                            value={it.quantity}
                            onChange={(e) => setItem(idx, { quantity: e.target.value })}
                          />
                        </div>
                        <div className="w-28 space-y-1">
                          <Input
                            type="number"
                            min="0"
                            step="0.001"
                            className="h-9"
                            placeholder="السعر"
                            dir="ltr"
                            value={it.unitPrice}
                            onChange={(e) => setItem(idx, { unitPrice: e.target.value })}
                          />
                        </div>
                        <div className="w-24 pb-1 text-center text-sm tabular-nums" dir="ltr" title="إجمالي البند">
                          {formatKWD(lineTotal)}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-9 text-destructive hover:text-destructive"
                          disabled={form.items.length === 1}
                          onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })}
                          aria-label="إزالة البند"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
                <div className="text-left text-sm font-medium">
                  الإجمالي: <span className="tabular-nums" dir="ltr">{formatKWD(itemsTotal)}</span> د.ك
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>ملاحظات</Label>
                <Textarea
                  className="min-h-16"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>

              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" className="h-9" onClick={() => setForm(null)}>
                  إلغاء
                </Button>
                <Button type="submit" className="h-9" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? "جارٍ الحفظ…" : form.id ? "حفظ التعديل" : "إنشاء العرض"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* تأكيد التحويل إلى فاتورة بيع */}
      <Dialog open={convertTarget !== null} onOpenChange={(o) => !o && setConvertTarget(null)}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>تحويل العرض إلى فاتورة بيع؟</DialogTitle>
            <DialogDescription>
              سيصدر الفاتورة <span dir="ltr">{convertTarget?.quotationNumber}</span> ببنود العرض بخصم صفري، بلا عقد
              — تجدها في شاشة الفواتير. ويُوسم العرض بملاحظة التحويل ولا يتحول مرة أخرى.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setConvertTarget(null)}>
              إلغاء
            </Button>
            <Button
              className="h-9"
              disabled={convertMutation.isPending}
              onClick={() => convertTarget && convertMutation.mutate(convertTarget.id)}
            >
              {convertMutation.isPending ? "جارٍ التحويل…" : "تحويل"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأكيد الحذف — للمدير فقط */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>حذف عرض السعر؟</DialogTitle>
            <DialogDescription>
              سيُحذف العرض «{deleteTarget?.quotationNumber}» ببنوده ({deleteTarget?.itemsCount} بند) نهائيًا. لا يمكن
              التراجع.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setDeleteTarget(null)}>
              إلغاء
            </Button>
            <Button
              className="h-9 border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? "جارٍ الحذف…" : "حذف"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
