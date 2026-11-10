"use client";

/**
 * شاشة الفواتير — Task 107 (منهج النواة الواحدة):
 * فاتورة ببنود تُصدر قيدًا آليًا (مدين ذمم العملاء / دائن إيراد العقود)،
 * وحالة السداد مشتقة من سندات القبض (تخصيص FIFO آلي) — لا حذف بل إلغاء بقيد عكسي.
 * فلاتر الخادم (حالة/عميل/عقد/بحث) + KPI + جدول سطح مكتب وبطاقات موبايل +
 * تفاصيل بالبنود وسندات السداد والقيد المرتبط (فتح القيود اليومية) + طباعة PDF برأس الشركة.
 * زر «فاتورة جديدة» يعرض صفحة كاملة (InvoiceNewPage) مكان القائمة.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Ban,
  Eye,
  FileStack,
  Loader2,
  Plus,
  Printer,
  ReceiptText,
  ScrollText,
  TriangleAlert,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPatch } from "./api";
import { SearchableSelect } from "./SearchableSelect";
import type {
  InvoiceDetailResponse,
  InvoiceRow,
  InvoiceStatus,
  InvoicesResponse,
  User,
} from "./contrack-types";
import { errMessage, isManagerRole } from "./contrack-types";
import { fmtDate, formatKWD, round3 } from "@/lib/format";

interface InvoicesViewProps {
  user: User;
  onAuthError: () => void;
  /** فتح القيد المرتبط في شاشة القيود اليومية (نمط Task 106) */
  onOpenJournal?: (entryNo: string) => void;
}

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  unpaid: "غير مسددة",
  partial: "جزئية",
  paid: "مسددة",
  void: "ملغاة",
};

const STATUS_BADGE_CLS: Record<InvoiceStatus, string> = {
  unpaid: "bg-status-warn-bg text-status-warn",
  partial: "bg-status-info-bg text-status-info",
  paid: "bg-status-done-bg text-status-done",
  void: "bg-muted text-muted-foreground",
};

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
        <Icon className="size-4 shrink-0 text-primary-ink/70" />
      </div>
      <p className={`text-base font-bold tabular-nums sm:text-lg ${tone || ""}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </Card>
  );
}

function StatusBadge({ status, legacy }: { status: InvoiceStatus; legacy?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge className={`border-0 ${STATUS_BADGE_CLS[status]}`}>{STATUS_LABEL[status]}</Badge>
      {legacy && <Badge className="border-0 bg-muted text-[10px] text-muted-foreground">مرحَّلة</Badge>}
    </span>
  );
}

export function InvoicesView({ user, onAuthError, onOpenJournal }: InvoicesViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);

  // ===== الفلاتر (خادمية عبر مفاتيح الاستعلام) =====
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [customerFilter, setCustomerFilter] = React.useState("all");
  const [contractFilter, setContractFilter] = React.useState("all");
  const [q, setQ] = React.useState("");

  const filtersQs = React.useMemo(() => {
    const p = new URLSearchParams();
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (customerFilter !== "all") p.set("customerId", customerFilter);
    if (contractFilter !== "all") p.set("contractId", contractFilter);
    if (q.trim()) p.set("q", q.trim());
    return p.toString();
  }, [statusFilter, customerFilter, contractFilter, q]);

  const invoicesQuery = useQuery<InvoicesResponse>({
    queryKey: ["invoices", filtersQs],
    queryFn: () => apiGet<InvoicesResponse>(`/api/invoices${filtersQs ? `?${filtersQs}` : ""}`),
  });

  React.useEffect(() => {
    const e = invoicesQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [invoicesQuery.error, onAuthError]);

  const allInvoices = invoicesQuery.data?.invoices ?? [];
  const items = allInvoices.filter((i) => i.status !== "void");
  const voided = allInvoices.filter((i) => i.status === "void");

  // خيارات العملاء/العقود من كل النتائج (بغض الفلتر نفسه لتظل متاحة)
  const allForOptions = useQuery<InvoicesResponse>({
    queryKey: ["invoices", "options-base"],
    queryFn: () => apiGet<InvoicesResponse>("/api/invoices"),
    staleTime: 60_000,
  });
  const optionRows = allForOptions.data?.invoices ?? [];
  const customerOptions = (() => {
    const map = new Map<number, string>();
    for (const i of optionRows) map.set(i.customerId, i.customerName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "ar"));
  })();
  const contractOptions = (() => {
    const map = new Map<number, string>();
    for (const i of optionRows) if (i.contractId && i.contractNumber) map.set(i.contractId, i.contractNumber);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "ar"));
  })();

  // ===== KPI (على نتائج الفلتر — الملغاة خارج الإجماليات) =====
  const totalInvoiced = round3(items.reduce((s, i) => s + i.total, 0));
  const totalPaid = round3(items.reduce((s, i) => s + i.paidAmount, 0));
  const totalOutstanding = round3(items.reduce((s, i) => s + i.remaining, 0));
  const lastInvoice = [...items].sort((a, b) =>
    (b.invoiceDate + String(b.invoiceNo)).localeCompare(a.invoiceDate + String(a.invoiceNo))
  )[0] ?? null;

  // ===== تفاصيل =====
  const [detailId, setDetailId] = React.useState<number | null>(null);
  const detailQuery = useQuery<InvoiceDetailResponse>({
    queryKey: ["invoice-detail", detailId],
    queryFn: () => apiGet<InvoiceDetailResponse>(`/api/invoices/${detailId}`),
    enabled: detailId !== null,
  });

  // ===== إلغاء (مدير) — بقيد عكسي =====
  const [voidTarget, setVoidTarget] = React.useState<InvoiceRow | null>(null);
  const [voidReason, setVoidReason] = React.useState("");
  const [voidError, setVoidError] = React.useState("");

  const voidMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      apiPatch(`/api/invoices/${id}?action=void`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["invoice-detail"] });
      qc.invalidateQueries({ queryKey: ["contract"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setVoidTarget(null);
      setVoidReason("");
      toast({
        title: "أُلغيت الفاتورة",
        description: "نُشر قيد عكسي مرتبط يصفِ أثرها من الأستاذ العام",
      });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      setVoidError(errMessage(e));
      toast({ variant: "destructive", title: "تعذر إلغاء الفاتورة", description: errMessage(e) });
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
        presetCustomerId={newPage.presetCustomerId}
        onSaved={() => setNewPage(null)}
        onCancel={() => setNewPage(null)}
      />
    );
  }

  const detail = detailQuery.data;
  const dInv = detail?.invoice;

  const renderRowActions = (inv: InvoiceRow) => (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs text-muted-foreground"
        onClick={() => setDetailId(inv.id)}
        aria-label={`تفاصيل الفاتورة ${inv.invoiceNumber}`}
      >
        <Eye className="size-3.5" />
        تفاصيل
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs text-muted-foreground"
        onClick={() => window.open(`/api/invoices/${inv.id}/pdf`, "_blank")}
        aria-label={`طباعة الفاتورة ${inv.invoiceNumber}`}
      >
        <Printer className="size-3.5" />
        طباعة
      </Button>
      {manager && inv.status !== "void" && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 border-status-danger/40 px-2 text-xs text-status-danger hover:bg-status-danger-bg hover:text-status-danger"
          onClick={() => {
            setVoidError("");
            setVoidReason("");
            setVoidTarget(inv);
          }}
        >
          <Ban className="size-3.5" />
          إلغاء
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
            <FileStack className="size-5 text-primary-ink" />
            الفواتير
          </h1>
          <p className="text-xs text-muted-foreground">
            فاتورة ببنود تُصدر قيدًا آليًا (ذمم/إيراد) — السداد عبر سندات القبض يحدّث حالتها آليًا.
          </p>
        </div>
        <Button size="sm" className="h-9 gap-1.5" onClick={openNew}>
          <Plus className="size-4" />
          فاتورة جديدة
        </Button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={FileStack}
          label="إجمالي المفوتر"
          value={formatKWD(totalInvoiced)}
          sub={`${items.length} فاتورة سارية`}
          tone="text-status-done"
        />
        <KpiCard icon={Wallet} label="المحصّل من الفواتير" value={formatKWD(totalPaid)} sub="من سندات القبض المرتبطة" />
        <KpiCard
          icon={ReceiptText}
          label="المتبقي على العملاء"
          value={formatKWD(totalOutstanding)}
          sub="صافي غير المسدد"
          tone={totalOutstanding > 0 ? "text-status-warn" : ""}
        />
        <KpiCard
          icon={BadgeCheck}
          label="آخر فاتورة"
          value={lastInvoice ? lastInvoice.invoiceNumber : "—"}
          sub={
            lastInvoice
              ? `${fmtDate(lastInvoice.invoiceDate)} · ${formatKWD(lastInvoice.total)} · ${lastInvoice.customerName}`
              : voided.length
                ? `الملغاة: ${voided.length}`
                : "لا فواتير بعد"
          }
        />
      </div>

      {/* الفلاتر */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <SearchableSelect
          value={statusFilter}
          onValueChange={setStatusFilter}
          options={[
            { value: "all", label: "كل الحالات" },
            { value: "unpaid", label: "غير مسددة" },
            { value: "partial", label: "مسددة جزئيًا" },
            { value: "paid", label: "مسددة" },
            { value: "void", label: "ملغاة" },
            { value: "legacy", label: "المرحَّلة (أرشيف)" },
          ]}
          placeholder="الحالة"
          searchPlaceholder="ابحث بالحالة…"
          emptyText="لا نتائج مطابقة"
        />
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
        <SearchableSelect
          value={contractFilter}
          onValueChange={setContractFilter}
          options={[
            { value: "all", label: "كل العقود" },
            ...contractOptions.map(([id, num]) => ({ value: String(id), label: num })),
          ]}
          placeholder="العقد"
          searchPlaceholder="ابحث برقم العقد…"
          emptyText="لا نتائج مطابقة"
        />
        <Input
          className="h-9"
          placeholder="بحث برقم الفاتورة/العميل/الوصف…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* القائمة */}
      {invoicesQuery.isLoading || allForOptions.isLoading ? (
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
      ) : allInvoices.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <FileStack className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">
              {filtersQs ? "لا نتائج مطابقة للفلاتر" : "لا فواتير بعد"}
            </p>
            <p className="text-xs text-muted-foreground">
              أصدر فاتورة ببنودها — تنشر قيدًا آليًا (مدين ذمم العملاء / دائن إيراد العقود).
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
                    <TableHead className="text-start">الصافي</TableHead>
                    <TableHead className="text-start">المسدد</TableHead>
                    <TableHead className="text-start">المتبقي</TableHead>
                    <TableHead className="text-start">الحالة</TableHead>
                    <TableHead className="text-start">القيد</TableHead>
                    <TableHead className="text-start">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allInvoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs font-bold">
                        {inv.invoiceNumber}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDate(inv.invoiceDate)}</TableCell>
                      <TableCell className="max-w-44">
                        <div className="truncate text-xs font-semibold" title={inv.customerName}>
                          {inv.customerName}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {inv.contractNumber ?? "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs font-bold tabular-nums">
                        {formatKWD(inv.total)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums text-status-done">
                        {formatKWD(inv.paidAmount)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums">
                        {formatKWD(inv.remaining)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={inv.status} legacy={inv.legacy} />
                      </TableCell>
                      <TableCell>
                        {inv.entryNo ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-full border border-primary/30 px-2 py-0.5 font-mono text-[11px] text-primary-ink hover:bg-primary/10"
                            onClick={() => onOpenJournal?.(String(inv.entryNo))}
                            aria-label={`فتح القيد رقم ${inv.entryNo}`}
                            title="فتح القيد في القيود اليومية"
                          >
                            <ScrollText className="size-3" />
                            <span dir="ltr">#{inv.entryNo}</span>
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
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
            {allInvoices.map((inv) => (
              <Card key={inv.id}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold">{inv.invoiceNumber}</span>
                    <StatusBadge status={inv.status} legacy={inv.legacy} />
                    <span className="ms-auto text-sm font-bold tabular-nums">{formatKWD(inv.total)}</span>
                  </div>
                  <div className="text-xs">
                    <span className="font-semibold">{inv.customerName}</span>
                    <span className="text-muted-foreground"> · {inv.contractNumber ?? "—"}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>{fmtDate(inv.invoiceDate)}</span>
                    <span>
                      مسدد <span className="tabular-nums text-status-done">{formatKWD(inv.paidAmount)}</span>
                    </span>
                    <span>
                      متبقي <span className="tabular-nums">{formatKWD(inv.remaining)}</span>
                    </span>
                    {inv.description && <span className="truncate">{inv.description}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {inv.entryNo && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-full border border-primary/30 px-2 py-0.5 text-[11px] text-primary-ink"
                        onClick={() => onOpenJournal?.(String(inv.entryNo))}
                        aria-label={`فتح القيد رقم ${inv.entryNo}`}
                      >
                        <ScrollText className="size-3" />
                        <span dir="ltr">قيد #{inv.entryNo}</span>
                      </button>
                    )}
                  </div>
                  {renderRowActions(inv)}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* ===== حوار تفاصيل الفاتورة ===== */}
      <Dialog open={detailId !== null} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              فاتورة {dInv?.invoiceNumber ?? ""}
              {dInv && <StatusBadge status={dInv.status} legacy={dInv.legacy} />}
            </DialogTitle>
            <DialogDescription>
              الإصدار ينشر قيدًا آليًا (مدين ذمم العملاء / دائن إيراد العقود) — والسداد عبر سندات القبض.
            </DialogDescription>
          </DialogHeader>
          {detailQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : detailQuery.isError || !dInv ? (
            <p className="py-4 text-center text-sm text-destructive">{errMessage(detailQuery.error)}</p>
          ) : (
            <div className="space-y-4 text-sm">
              {/* بطاقة المعلومات */}
              <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-3 text-xs sm:grid-cols-4">
                <div>
                  <div className="text-muted-foreground">العميل</div>
                  <div className="font-bold">{dInv.customerName}</div>
                  {dInv.customerCode && <div className="font-mono text-[10px] text-muted-foreground">{dInv.customerCode}</div>}
                </div>
                <div>
                  <div className="text-muted-foreground">العقد</div>
                  <div className="font-mono font-bold">{dInv.contractNumber ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">التاريخ / الاستحقاق</div>
                  <div className="font-bold">
                    {fmtDate(dInv.invoiceDate)}
                    {dInv.dueDate ? ` → ${fmtDate(dInv.dueDate)}` : ""}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">القيد المرتبط</div>
                  {detail.entry ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-mono font-bold text-primary-ink hover:underline"
                      onClick={() => {
                        setDetailId(null);
                        onOpenJournal?.(String(detail.entry!.entryNo));
                      }}
                    >
                      <ScrollText className="size-3" />
                      <span dir="ltr">#{detail.entry.entryNo}</span>
                      <span className="text-[10px] font-normal text-muted-foreground">
                        {detail.entry.status === "posted" ? "منشور" : detail.entry.status}
                      </span>
                    </button>
                  ) : (
                    <div className="font-bold text-muted-foreground">{dInv.legacy ? "أرشيفية" : "—"}</div>
                  )}
                </div>
              </div>

              {dInv.status === "void" && dInv.voidReason && (
                <p className="rounded-lg border border-status-danger/40 bg-status-danger-bg p-2 text-xs font-semibold text-status-danger">
                  أُلغيت — السبب: {dInv.voidReason}
                </p>
              )}

              {/* البنود */}
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">البيان</TableHead>
                      <TableHead className="text-start">الكمية</TableHead>
                      <TableHead className="text-start">السعر</TableHead>
                      <TableHead className="text-start">خصم%</TableHead>
                      <TableHead className="text-start">الإجمالي</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.items.map((it, i) => (
                      <TableRow key={it.id ?? i}>
                        <TableCell className="text-xs">{it.description}</TableCell>
                        <TableCell className="text-xs tabular-nums">{it.quantity}</TableCell>
                        <TableCell className="text-xs tabular-nums">{formatKWD(it.unitPrice)}</TableCell>
                        <TableCell className="text-xs tabular-nums">{it.discountPct || "—"}</TableCell>
                        <TableCell className="text-xs font-bold tabular-nums">{formatKWD(it.lineTotal)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* الإجماليات */}
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                {dInv.discountTotal > 0 && (
                  <div className="rounded-lg border bg-muted/30 p-2">
                    <div className="text-muted-foreground">قبل الخصم</div>
                    <div className="font-bold tabular-nums">{formatKWD(dInv.subtotal)}</div>
                  </div>
                )}
                {dInv.discountTotal > 0 && (
                  <div className="rounded-lg border bg-muted/30 p-2">
                    <div className="text-muted-foreground">الخصم</div>
                    <div className="font-bold tabular-nums text-status-danger">−{formatKWD(dInv.discountTotal)}</div>
                  </div>
                )}
                <div className="rounded-lg border bg-primary/5 p-2">
                  <div className="text-muted-foreground">الصافي</div>
                  <div className="text-sm font-extrabold tabular-nums text-primary-ink">{formatKWD(dInv.total)}</div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-2">
                  <div className="text-muted-foreground">المسدد</div>
                  <div className="font-bold tabular-nums text-status-done">{formatKWD(dInv.paidAmount)}</div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-2">
                  <div className="text-muted-foreground">المتبقي</div>
                  <div className="font-bold tabular-nums">{formatKWD(dInv.remaining)}</div>
                </div>
              </div>

              {/* سندات السداد */}
              <div>
                <h3 className="mb-1.5 text-xs font-bold text-primary-ink">
                  سندات السداد المرتبطة ({detail.payments.length})
                </h3>
                {detail.payments.length === 0 ? (
                  <p className="rounded-lg border bg-muted/20 p-2 text-xs text-muted-foreground">
                    لا سندات سداد مرتبطة بعد — يُخصص القبض آليًا FIFO عند تسجيل سندات القبض للعميل.
                  </p>
                ) : (
                  <div className="max-h-40 overflow-y-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-start">السند</TableHead>
                          <TableHead className="text-start">التاريخ</TableHead>
                          <TableHead className="text-start">الطريقة</TableHead>
                          <TableHead className="text-start">المبلغ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.payments.map((p) => (
                          <TableRow key={p.id} className={p.cancelled ? "opacity-50" : ""}>
                            <TableCell className="font-mono text-xs" dir="ltr">
                              {p.voucherNumber}
                              {p.cancelled && <span className="ms-1 text-[10px] text-muted-foreground">(ملغى)</span>}
                            </TableCell>
                            <TableCell className="text-xs">{fmtDate(p.vdate)}</TableCell>
                            <TableCell className="text-xs">{p.method || "—"}</TableCell>
                            <TableCell className="text-xs font-bold tabular-nums">{formatKWD(p.amount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {dInv.notes && (
                <div>
                  <div className="text-[11px] text-muted-foreground">ملاحظات</div>
                  <div className="whitespace-pre-wrap text-xs">{dInv.notes || "—"}</div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ===== حوار إلغاء الفاتورة (مدير) — بقيد عكسي ===== */}
      <Dialog open={voidTarget !== null} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-4 text-status-danger" />
              إلغاء الفاتورة {voidTarget?.invoiceNumber ?? ""}
            </DialogTitle>
            <DialogDescription>
              يُنشر قيد عكسي مرتبط يصفِ أثر الفاتورة من الأستاذ (ذمم/إيراد) — لا حذف نهائي، وسبب الإلغاء إلزامي.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/30 p-3 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">العميل / العقد</span>
              <span className="font-bold">
                {voidTarget?.customerName ?? "—"} · {voidTarget?.contractNumber ?? "—"}
              </span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground">الصافي</span>
              <span className="font-extrabold tabular-nums">{formatKWD(voidTarget?.total ?? 0)}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="void-reason" className="text-xs font-semibold">
              سبب الإلغاء *
            </label>
            <Textarea
              id="void-reason"
              rows={2}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="مثال: خطأ في الإصدار — تصحيح بالفاتورة الجديدة"
            />
          </div>
          {voidError && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs font-semibold text-destructive">
              {voidError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setVoidTarget(null)}>
              رجوع
            </Button>
            <Button
              variant="destructive"
              className="h-9"
              disabled={voidMutation.isPending || !voidReason.trim()}
              onClick={() => voidTarget && voidMutation.mutate({ id: voidTarget.id, reason: voidReason.trim() })}
            >
              {voidMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              إلغاء الفاتورة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
