"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { SearchableSelect } from "./SearchableSelect";
import { errMessage, isManagerRole, type User } from "./contrack-types";
import { statusBadgeClass } from "@/lib/format";
import {
  PROJECT_NAME_REQUIRED,
  PROJECT_STATUSES,
  PROJECT_STATUS_DEFAULT,
  projectPeriodLabel,
  type ProjectRow,
} from "@/lib/projects-core";
import type { CustomersResponse } from "./contrack-types";

/**
 * إدارة المشاريع — بند 11 من المرحلة 9.
 * نطاق المكتبي موثق: لا شاشة مستقلة ولا حوار للمشاريع (العقد هو المشروع)،
 * فالإدارة هنا حوار خفيف داخل شاشة العملاء (الحاضنة — بوابة screen_customers)
 * يظهر بمفتاح المزايا «المشاريع» كما تظهر بطاقة العداد المكتبية،
 * بنصوص التحقق المكتبية الحرفية وبلا أي حقول مال.
 */

interface ProjectsManagerDialogProps {
  user: User;
  onAuthError: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ProjectFormState {
  id?: number;
  name: string;
  customerId: string; // "" = بدون عميل
  location: string;
  startDate: string;
  endDate: string;
  status: string;
  description: string;
}

const EMPTY_FORM: ProjectFormState = {
  name: "",
  customerId: "",
  location: "",
  startDate: "",
  endDate: "",
  status: PROJECT_STATUS_DEFAULT,
  description: "",
};

export function ProjectsManagerDialog({
  user,
  onAuthError,
  open,
  onOpenChange,
}: ProjectsManagerDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);

  const [searchInput, setSearchInput] = React.useState("");
  const [q, setQ] = React.useState("");
  const [form, setForm] = React.useState<ProjectFormState | null>(null); // null = القائمة
  const [deleteTarget, setDeleteTarget] = React.useState<ProjectRow | null>(null);

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
    }
  }, [open]);

  const listQuery = useQuery<{ projects: ProjectRow[] }>({
    queryKey: ["projects", q],
    queryFn: () => apiGet<{ projects: ProjectRow[] }>(`/api/projects?q=${encodeURIComponent(q)}`),
    enabled: open,
  });

  // قائمة العملاء لمحدّد الحوار (العميل اختياري في المخطط المرجعي)
  const customersQuery = useQuery<CustomersResponse>({
    queryKey: ["customers", ""],
    queryFn: () => apiGet<CustomersResponse>("/api/customers?q="),
    enabled: open,
  });
  const customers = customersQuery.data?.customers ?? [];
  const customerName = (id: number | null) =>
    id ? (customers.find((c) => c.id === id)?.name ?? "") : "";

  const handleError = React.useCallback(
    (e: unknown, fallback: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "خطأ", description: errMessage(e) || fallback });
    },
    [onAuthError, toast]
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const saveMutation = useMutation({
    mutationFn: (f: ProjectFormState) => {
      const body = {
        name: f.name,
        customerId: f.customerId ? Number(f.customerId) : null,
        location: f.location,
        startDate: f.startDate,
        endDate: f.endDate,
        status: f.status,
        description: f.description,
      };
      return f.id ? apiPut(`/api/projects/${f.id}`, body) : apiPost("/api/projects", body);
    },
    onSuccess: (_d, f) => {
      invalidate();
      toast({
        title: f.id ? "تم تعديل المشروع ✅" : "أُنشئ المشروع ✅",
        description: f.name,
      });
      setForm(null);
    },
    onError: (e) => handleError(e, PROJECT_NAME_REQUIRED),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/projects/${id}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "تم الحذف", description: "حُذف المشروع بنجاح" });
      setDeleteTarget(null);
    },
    onError: (e) => {
      setDeleteTarget(null);
      handleError(e, "تعذر حذف المشروع");
    },
  });

  const items = listQuery.data?.projects ?? [];
  const rows = [...items].sort((a, b) => b.id - a.id);

  const openCreate = () =>
    setForm({ ...EMPTY_FORM, customerId: "", status: PROJECT_STATUS_DEFAULT });
  const openEdit = (p: ProjectRow) =>
    setForm({
      id: p.id,
      name: p.name,
      customerId: p.customerId ? String(p.customerId) : "",
      location: p.location || "",
      startDate: p.startDate || "",
      endDate: p.endDate || "",
      status: p.status || PROJECT_STATUS_DEFAULT,
      description: p.description || "",
    });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>🏗 المشاريع</DialogTitle>
            <DialogDescription>
              مشاريع العملاء — تُربط بها سندات الصرف، وبطاقة «عدد المشاريع» في الرئيسية تتبعها.
            </DialogDescription>
          </DialogHeader>

          {form === null ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Input
                  className="h-9 max-w-56"
                  placeholder="بحث بالاسم أو العميل…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
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
                    مشروع جديد
                  </Button>
                </div>
              </div>

              <div className="max-h-96 overflow-y-auto rounded-lg border" dir="rtl">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>الاسم</TableHead>
                      <TableHead className="w-32">العميل</TableHead>
                      <TableHead className="w-24">الحالة</TableHead>
                      <TableHead className="w-40">الموقع / المدة</TableHead>
                      <TableHead className="w-16 text-center">السندات</TableHead>
                      <TableHead className="w-20 text-center">إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listQuery.isLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                          جارٍ التحميل…
                        </TableCell>
                      </TableRow>
                    ) : rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                          {q ? "لا نتائج مطابقة للبحث" : "لا توجد مشاريع بعد — أضف أول مشروع"}
                        </TableCell>
                      </TableRow>
                    ) : (
                      rows.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>
                            <div className="font-medium">{p.name}</div>
                            {p.description && (
                              <div className="max-w-64 truncate text-xs text-muted-foreground" title={p.description}>
                                {p.description}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{p.customerName || "—"}</TableCell>
                          <TableCell>
                            <span
                              className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${statusBadgeClass(p.status)}`}
                            >
                              {p.status || "—"}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            <div className="truncate">{p.location || "—"}</div>
                            <div dir="ltr" className="tabular-nums">{projectPeriodLabel(p)}</div>
                          </TableCell>
                          <TableCell className="text-center text-sm tabular-nums">
                            {p.vouchersCount ?? 0}
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                onClick={() => openEdit(p)}
                                aria-label="تعديل"
                              >
                                <Pencil className="size-4" />
                              </Button>
                              {manager && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 text-destructive hover:text-destructive"
                                  onClick={() => setDeleteTarget(p)}
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
                if (!form.name.trim()) {
                  toast({ variant: "destructive", title: "خطأ", description: PROJECT_NAME_REQUIRED });
                  return;
                }
                saveMutation.mutate(form);
              }}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>اسم المشروع *</Label>
                  <Input
                    className="h-9"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>العميل</Label>
                  <SearchableSelect
                    value={form.customerId}
                    onValueChange={(v) => setForm({ ...form, customerId: v === "none" ? "" : v })}
                    options={[
                      { value: "none", label: "— بدون عميل —" },
                      ...customers.map((c) => ({ value: String(c.id), label: c.name })),
                    ]}
                    placeholder="— بدون عميل —"
                    searchPlaceholder="ابحث بالاسم…"
                    emptyText="لا نتائج مطابقة"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>الموقع</Label>
                  <Input
                    className="h-9"
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>الحالة</Label>
                  <Select
                    value={form.status}
                    onValueChange={(v) => setForm({ ...form, status: v })}
                  >
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROJECT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>تاريخ البداية</Label>
                  <Input
                    type="date"
                    className="h-9"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>تاريخ النهاية</Label>
                  <Input
                    type="date"
                    className="h-9"
                    value={form.endDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>الوصف</Label>
                <Textarea
                  className="min-h-16"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
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
                  {saveMutation.isPending ? "جارٍ الحفظ…" : form.id ? "حفظ التعديل" : "إنشاء المشروع"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* تأكيد الحذف — الحارس المكتبي: الارتباط بسندات يمنع الحذف من الخادم */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>حذف المشروع؟</DialogTitle>
            <DialogDescription>
              سيُحذف المشروع «{deleteTarget?.name}
              » نهائيًا. إن كان مرتبطًا بسندات سيرفض النظام الحذف مع إظهار السبب.
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
