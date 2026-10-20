"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "./api";
import { errMessage, isManagerRole, type User } from "./contrack-types";
import { formatKWD, round3 } from "@/lib/format";
import {
  cleanQuotationItems,
  QUOTATION_CUSTOMER_REQUIRED,
  QUOTATION_ITEMS_REQUIRED,
  QUOTATION_STATUSES,
  QUOTATION_STATUS_DEFAULT,
  quotationStatusBadgeClass,
  type QuotationRow,
} from "@/lib/quotes-core";
import type { CustomersResponse } from "./contrack-types";

/**
 * إدارة عروض الأسعار — بند 12 من المرحلة 9.
 * نطاق المكتبي موثق: لا شاشة ولا حوار لإدارة العروض (الدوال بلا مستدعٍ واجهة
 * والموضع الوحيد مركز نماذج Word يختار عرضًا كمصدر تعبئة) — فالإدارة هنا حوار
 * خفيف داخل شاشة العملاء (الحاضنة — بوابة screen_customers) كبنود المشاريع
 * والمجموعات، بلا بند شل ولا مفتاح مزايا (لا مفتاح للعروض بالمكتبي).
 * دورة الحالة: أي حالة من مجموعة العروض تصلح لأي أخرى (بلا مصفوفة انتقالات
 * بالمكتبي) — بأزرار الحالات المسموحة في القائمة عبر مسار الانتقال المخصص.
 */

interface QuotesManagerDialogProps {
  user: User;
  onAuthError: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export function QuotesManagerDialog({
  user,
  onAuthError,
  open,
  onOpenChange,
}: QuotesManagerDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);

  const [searchInput, setSearchInput] = React.useState("");
  const [q, setQ] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("الكل");
  const [form, setForm] = React.useState<QuoteFormState | null>(null); // null = القائمة
  const [deleteTarget, setDeleteTarget] = React.useState<QuotationRow | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // إغلاق النافذة يعيد الحالة للقائمة
  React.useEffect(() => {
    if (!open) {
      setForm(null);
      setDeleteTarget(null);
      setSearchInput("");
      setQ("");
      setStatusFilter("الكل");
    }
  }, [open]);

  const listQuery = useQuery<{ quotations: QuotationRow[] }>({
    queryKey: ["quotes", q, statusFilter],
    queryFn: () =>
      apiGet<{ quotations: QuotationRow[] }>(
        `/api/quotes?q=${encodeURIComponent(q)}&status=${encodeURIComponent(statusFilter)}`
      ),
    enabled: open,
  });

  // قائمة العملاء لمحدّد الحوار (العميل إلزامي كالمكتبي)
  const customersQuery = useQuery<CustomersResponse>({
    queryKey: ["customers", ""],
    queryFn: () => apiGet<CustomersResponse>("/api/customers?q="),
    enabled: open,
  });
  const customers = customersQuery.data?.customers ?? [];

  // قائمة المشاريع لمحدّد الحوار (العميل اختياري في المخطط المرجعي مع SET NULL)
  const projectsQuery = useQuery<{ projects: Array<{ id: number; customerId: number | null; name: string }> }>({
    queryKey: ["projects", ""],
    queryFn: () => apiGet<{ projects: Array<{ id: number; customerId: number | null; name: string }> }>("/api/projects?q="),
    enabled: open,
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
      const num =
        (d as { quotation?: { quotationNumber?: string } })?.quotation?.quotationNumber || "";
      toast({
        title: f.id ? "تم تعديل عرض السعر ✅" : "أُنشئ عرض السعر ✅",
        description: f.id ? (num || undefined) : num,
      });
      setForm(null);
    },
    onError: (e) => handleError(e, QUOTATION_ITEMS_REQUIRED),
  });

  const transitionMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiPost(`/api/quotes/${id}/transition`, { status }),
    onSuccess: (d) => {
      invalidate();
      const status =
        (d as { quotation?: { status?: string } })?.quotation?.status || "";
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

  const items = listQuery.data?.quotations ?? [];
  const rows = [...items].sort((a, b) => b.id - a.id);

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
    const next = form.items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    setForm({ ...form, items: next });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>🧾 عروض الأسعار</DialogTitle>
            <DialogDescription>
              عروض الأسعار للعملاء ببنودها — تُرقَّم آليًا QUO-0001 وتنتقل حالتها من القائمة.
            </DialogDescription>
          </DialogHeader>

          {form === null ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Input
                    className="h-9 max-w-56"
                    placeholder="بحث بالرقم أو العميل…"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                  />
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-9 w-32">
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
                    <span className={listQuery.isFetching ? "animate-spin" : ""}>⟳</span>
                  </Button>
                  <Button className="h-9 gap-1.5" onClick={openCreate}>
                    <Plus className="size-4" />
                    عرض جديد
                  </Button>
                </div>
              </div>

              <div className="max-h-96 overflow-y-auto rounded-lg border" dir="rtl">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>العرض</TableHead>
                      <TableHead className="w-32">العميل</TableHead>
                      <TableHead className="w-28">المشروع</TableHead>
                      <TableHead className="w-28">الحالة</TableHead>
                      <TableHead className="w-28 text-center">الإجمالي</TableHead>
                      <TableHead className="w-24">الصلاحية</TableHead>
                      <TableHead className="w-20 text-center">إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listQuery.isLoading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                          جارٍ التحميل…
                        </TableCell>
                      </TableRow>
                    ) : rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                          {q || statusFilter !== "الكل"
                            ? "لا نتائج مطابقة للبحث"
                            : "لا توجد عروض أسعار بعد — أضف أول عرض"}
                        </TableCell>
                      </TableRow>
                    ) : (
                      rows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>
                            <div className="font-medium" dir="ltr">{row.quotationNumber}</div>
                            {row.description && (
                              <div className="max-w-56 truncate text-xs text-muted-foreground" title={row.description}>
                                {row.description}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{row.customerName}</TableCell>
                          <TableCell className="text-sm">{row.projectName || "—"}</TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition-colors hover:opacity-80 ${quotationStatusBadgeClass(row.status)}`}
                                  aria-label={`تغيير حالة ${row.quotationNumber}`}
                                >
                                  {row.status || "—"}
                                  <ChevronDown className="size-3" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start">
                                <DropdownMenuLabel className="text-xs text-muted-foreground">
                                  تغيير الحالة
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {QUOTATION_STATUSES.filter((s) => s !== row.status).map((s) => (
                                  <DropdownMenuItem
                                    key={s}
                                    onClick={() => transitionMutation.mutate({ id: row.id, status: s })}
                                  >
                                    <span
                                      className={`inline-flex rounded-md px-2 py-0.5 text-xs ${quotationStatusBadgeClass(s)}`}
                                    >
                                      {s}
                                    </span>
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
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
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                onClick={() => openEdit(row)}
                                aria-label="تعديل"
                              >
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
            </div>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!form.customerId) {
                  toast({ variant: "destructive", title: "خطأ", description: QUOTATION_CUSTOMER_REQUIRED });
                  return;
                }
                const hasItem = form.items.some((it) => it.description.trim());
                if (!hasItem) {
                  toast({ variant: "destructive", title: "خطأ", description: QUOTATION_ITEMS_REQUIRED });
                  return;
                }
                saveMutation.mutate(form);
              }}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>العميل *</Label>
                  <Select
                    value={form.customerId}
                    onValueChange={(v) => setForm({ ...form, customerId: v, projectId: "" })}
                  >
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue placeholder="اختر العميل" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>المشروع</Label>
                  <Select
                    value={form.projectId || "none"}
                    onValueChange={(v) => setForm({ ...form, projectId: v === "none" ? "" : v })}
                  >
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue placeholder="— بدون مشروع —" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— بدون مشروع —</SelectItem>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                          onClick={() =>
                            setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })
                          }
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
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  onClick={() => setForm(null)}
                >
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

      {/* تأكيد الحذف — للمدير فقط (إضافة ويب: المكتبي بلا حذف عروض) */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>حذف عرض السعر؟</DialogTitle>
            <DialogDescription>
              سيُحذف العرض «{deleteTarget?.quotationNumber}» ببنوده ({deleteTarget?.itemsCount} بند)
              نهائيًا. لا يمكن التراجع.
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
    </>
  );
}
