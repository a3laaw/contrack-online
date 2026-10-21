"use client";

/**
 * شاشة الفواتير — زر «فاتورة جديدة» يعرض صفحة كاملة (InvoiceNewPage) مكان القائمة بدل النافذة السابقة.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, FileStack, Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { InvoiceNewPage } from "./InvoiceNewPage";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiGet } from "./api";
import { SearchableSelect } from "./SearchableSelect";
import type {
  InvoiceItem,
  InvoicesResponse,
  User,
} from "./contrack-types";
import { errMessage, isManagerRole } from "./contrack-types";
import { fmtDate, formatKWD, round3 } from "@/lib/format";

interface InvoicesViewProps {
  user: User;
  onAuthError: () => void;
}

/** تطبيع بحثي بسيط (همزات/تاء مربوطة/ألف مقصورة) */
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

export function InvoicesView({ user, onAuthError }: InvoicesViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);

  // ===== البيانات =====
  const invoicesQuery = useQuery<InvoicesResponse>({
    queryKey: ["invoices"],
    queryFn: () => apiGet<InvoicesResponse>("/api/invoices"),
  });
  const items: InvoiceItem[] = invoicesQuery.data?.items ?? [];

  React.useEffect(() => {
    const e = invoicesQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [invoicesQuery.error, onAuthError]);

  // ===== مؤشرات =====
  const totalInvoiced = round3(items.reduce((s, i) => s + Number(i.amount || 0), 0));
  const lastInvoice = [...items].sort((a, b) =>
    (b.invoiceDate + b.invoiceNumber).localeCompare(a.invoiceDate + a.invoiceNumber)
  )[0] ?? null;

  // ===== الفلاتر (محلية — قائمة واحدة تغذي KPI والجدول معًا) =====
  const [q, setQ] = React.useState("");
  const [customerFilter, setCustomerFilter] = React.useState("all");
  const [contractFilter, setContractFilter] = React.useState("all");

  const customerOptions = (() => {
    const map = new Map<number, string>();
    for (const i of items) if (i.customer?.id) map.set(i.customer.id, i.customer.name);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "ar"));
  })();
  const contractOptions = (() => {
    const map = new Map<number, string>();
    for (const i of items) if (i.contract?.id) map.set(i.contract.id, i.contract.contractNumber);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "ar"));
  })();

  const filtered = items.filter((i) => {
    if (customerFilter !== "all" && String(i.customer?.id ?? "") !== customerFilter) return false;
    if (contractFilter !== "all" && String(i.contract?.id ?? "") !== contractFilter) return false;
    if (q.trim()) {
      const hay = normSearch(
        `${i.invoiceNumber} ${i.customer?.name ?? ""} ${i.contract?.contractNumber ?? ""} ${i.description ?? ""}`
      );
      if (!hay.includes(normSearch(q.trim()))) return false;
    }
    return true;
  });

  // ===== تفاصيل =====
  const [detailInvoice, setDetailInvoice] = React.useState<InvoiceItem | null>(null);

  // ===== حذف (مدير) =====
  const [deleteTarget, setDeleteTarget] = React.useState<InvoiceItem | null>(null);
  const [deleteError, setDeleteError] = React.useState("");

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/invoices/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["contract"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setDeleteTarget(null);
      toast({ title: "حُذفت الفاتورة", description: "أُعيد المبلغ إلى متبقي العقد القابل للفوترة" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      setDeleteError(errMessage(e));
      toast({ variant: "destructive", title: "تعذر حذف الفاتورة", description: errMessage(e) });
    },
  });

  // ===== فاتورة جديدة — صفحة كاملة بدل النافذة =====
  const [newPage, setNewPage] = React.useState<{ presetCustomerId: string | null } | null>(null);
  const openNew = () => {
    setNewPage({ presetCustomerId: customerFilter !== "all" ? customerFilter : null });
  };

  // صفحة «فاتورة جديدة» تُعرض مكان القائمة (بعد كل الـhooks — بلا مسار جديد)
  if (newPage) {
    return (
      <InvoiceNewPage
        onAuthError={onAuthError}
        invoices={items}
        presetCustomerId={newPage.presetCustomerId}
        onSaved={() => setNewPage(null)}
        onCancel={() => setNewPage(null)}
      />
    );
  }

  const renderRowActions = (inv: InvoiceItem) => (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs text-muted-foreground"
        onClick={() => setDetailInvoice(inv)}
      >
        <Eye className="size-3.5" />
        تفاصيل
      </Button>
      {manager && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 border-status-danger/40 px-2 text-xs text-status-danger hover:bg-status-danger-bg hover:text-status-danger"
          onClick={() => {
            setDeleteError("");
            setDeleteTarget(inv);
          }}
        >
          <Trash2 className="size-3.5" />
          حذف
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* العنوان */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-extrabold sm:text-xl">
            <FileStack className="size-5 text-primary" />
            الفواتير
          </h1>
          <p className="text-xs text-muted-foreground">
            فاتورة من قيمة العقد INV-#### — للعلم لا تخفض المديونية، ولا تتجاوز متبقي العقد القابل للفوترة.
          </p>
        </div>
        <Button size="sm" className="h-9 gap-1.5" onClick={openNew}>
          <Plus className="size-4" />
          فاتورة جديدة
        </Button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard
          icon={FileStack}
          label="إجمالي المفوتر"
          value={formatKWD(totalInvoiced)}
          sub={`${items.length} فاتورة`}
          tone="text-status-done"
        />
        <KpiCard
          icon={FileStack}
          label="عدد الفواتير"
          value={String(items.length)}
          sub={`${customerOptions.length} عميل · ${contractOptions.length} عقد`}
        />
        <KpiCard
          icon={FileStack}
          label="آخر فاتورة"
          value={lastInvoice ? lastInvoice.invoiceNumber : "—"}
          sub={
            lastInvoice
              ? `${fmtDate(lastInvoice.invoiceDate)} · ${formatKWD(lastInvoice.amount)} · ${lastInvoice.customer?.name ?? ""}`
              : "لا فواتير بعد"
          }
        />
      </div>

      {/* الفلاتر */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <SearchableSelect
          value={customerFilter}
          onValueChange={(v) => {
            setCustomerFilter(v);
            setContractFilter("all");
          }}
          options={[
            { value: "all", label: "كل العملاء" },
            ...customerOptions.map(([id, name]) => ({ value: String(id), label: name })),
          ]}
          placeholder="العميل"
          searchPlaceholder="ابحث بالاسم…"
          emptyText="لا نتائج مطابقة"
        />
        <Select value={contractFilter} onValueChange={setContractFilter}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="العقد" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل العقود</SelectItem>
            {contractOptions.map(([id, num]) => (
              <SelectItem key={id} value={String(id)}>
                {num}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="h-9"
          placeholder="بحث برقم الفاتورة/العميل/الوصف…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* القائمة */}
      {invoicesQuery.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : invoicesQuery.isError ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">
            تعذر تحميل الفواتير — {errMessage(invoicesQuery.error)}
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <FileStack className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">
              {items.length === 0 ? "لا فواتير بعد" : "لا نتائج مطابقة للفلاتر"}
            </p>
            <p className="text-xs text-muted-foreground">
              أصدر فاتورة من زر «فاتورة جديدة» — المتبقي للفواتير = القيمة الحالية − مفوتر العقد.
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
                    <TableHead className="text-start">الرقم</TableHead>
                    <TableHead className="text-start">التاريخ</TableHead>
                    <TableHead className="text-start">العميل</TableHead>
                    <TableHead className="text-start">العقد</TableHead>
                    <TableHead className="text-start">الوصف</TableHead>
                    <TableHead className="text-start">المبلغ</TableHead>
                    <TableHead className="text-start">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs font-bold">
                        {inv.invoiceNumber}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDate(inv.invoiceDate)}</TableCell>
                      <TableCell className="max-w-44">
                        <div className="truncate text-xs font-semibold" title={inv.customer?.name ?? ""}>
                          {inv.customer?.name ?? "—"}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {inv.contract?.contractNumber ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-48">
                        <div className="truncate text-xs text-muted-foreground" title={inv.description ?? ""}>
                          {inv.description || "—"}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs font-bold tabular-nums">
                        {formatKWD(inv.amount)}
                      </TableCell>
                      <TableCell>{renderRowActions(inv)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* موبايل */}
          <div className="space-y-2 md:hidden">
            {filtered.map((inv) => (
              <Card key={inv.id}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold">{inv.invoiceNumber}</span>
                    <span className="ms-auto text-sm font-bold tabular-nums">{formatKWD(inv.amount)}</span>
                  </div>
                  <div className="text-xs">
                    <span className="font-semibold">{inv.customer?.name ?? "—"}</span>
                    <span className="text-muted-foreground"> · {inv.contract?.contractNumber ?? "—"}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>{fmtDate(inv.invoiceDate)}</span>
                    {inv.description && <span className="truncate">{inv.description}</span>}
                  </div>
                  {renderRowActions(inv)}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* ===== حوار تفاصيل الفاتورة ===== */}
      <Dialog open={detailInvoice !== null} onOpenChange={(o) => !o && setDetailInvoice(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>فاتورة {detailInvoice?.invoiceNumber ?? ""}</DialogTitle>
            <DialogDescription>الفاتورة مستند للعلم — لا تخفض المديونية في كشف الحساب.</DialogDescription>
          </DialogHeader>
          {detailInvoice && (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
                <div>
                  <div className="text-muted-foreground">التاريخ</div>
                  <div className="font-bold">{fmtDate(detailInvoice.invoiceDate)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">المبلغ</div>
                  <div className="text-base font-extrabold tabular-nums text-status-done">
                    {formatKWD(detailInvoice.amount)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">العميل</div>
                  <div className="font-bold">{detailInvoice.customer?.name ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">العقد</div>
                  <div className="font-mono font-bold">{detailInvoice.contract?.contractNumber ?? "—"}</div>
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">الوصف</div>
                <div>{detailInvoice.description || "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">ملاحظات</div>
                <div className="whitespace-pre-wrap text-xs">{detailInvoice.notes || "—"}</div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ===== حوار حذف الفاتورة (مدير) ===== */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>حذف الفاتورة {deleteTarget?.invoiceNumber ?? ""}</DialogTitle>
            <DialogDescription>
              سيُحذف سطر الفاتورة ويعود مبلغها إلى متبقي العقد القابل للفوترة — لا يمكن التراجع.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/30 p-3 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">العميل / العقد</span>
              <span className="font-bold">
                {deleteTarget?.customer?.name ?? "—"} · {deleteTarget?.contract?.contractNumber ?? "—"}
              </span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground">المبلغ</span>
              <span className="font-extrabold tabular-nums">{formatKWD(deleteTarget?.amount ?? 0)}</span>
            </div>
          </div>
          {deleteError && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs font-semibold text-destructive">
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setDeleteTarget(null)}>
              رجوع
            </Button>
            <Button
              variant="destructive"
              className="h-9"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              حذف نهائي
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
