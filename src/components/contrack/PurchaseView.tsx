"use client";

/**
 * PurchaseView.tsx — شل «الشراء» ر4 بلوحتين (docs/purchase-design.md §6 — د1):
 * • «أوامر الشراء»: بطاقة ملخص اشتقاقية + جدول الأوامر بحالاتها المغلقة (د3) + حوار
 *   إنشاء/تعديل (مسودة فقط) + «استلام» يولّد إذن إدخال آليًا عبر دالة المخازن (د4) +
 *   «سند صرف مورد» عبر محرك السندات القائم (د6) + طباعة PDF خادمية (د8) + الإلغاء.
 * • «الموردون»: جدول وحوار إنشاء/تعديل + كشف مختصر (أوامر + سندات).
 * صنف الأمر مخزني إلزامي (د2 — G7) — والموديول يفترض تفعيل المخازن (مصدر الأصناف).
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban, FileDown, MoreHorizontal, PackageCheck, Pencil, Plus, Printer, RefreshCw, ShoppingCart, Trash2, Truck,
} from "lucide-react";

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
import { poAllowedTargets, poStatusBadgeClass, PO_STATUSES } from "@/lib/purchase-constants";

export type PurchaseSection = "orders" | "suppliers";

interface PoItemRow {
  id: number;
  itemId: number;
  qty: number;
  receivedQty: number;
  unitPrice: number;
  amount: number;
  item: { id: number; name: string; unit: string } | null;
}

interface OrderRow {
  id: number;
  poNumber: string;
  orderDate: string;
  expectedDate: string;
  status: string;
  totalAmount: number;
  receivedAmount: number;
  notes: string;
  supplierId: number;
  contractId: number | null;
  supplier: { id: number; name: string; supplierCode: string } | null;
  items: { id: number; qty: number; receivedQty: number }[];
}

interface SupplierRow {
  id: number;
  supplierCode: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  crNumber: string;
  active: boolean;
  notes: string;
  ordersCount: number;
  ordersValue: number;
}

interface PurchaseSummary {
  openCount: number;
  openValue: number;
  receivedValue: number;
  activeSuppliers: number;
}

interface PurchaseViewProps {
  user: User;
  onAuthError: () => void;
  section: PurchaseSection;
}

// ===== بنود حوار الأمر =====
interface OrderItemFormRow {
  itemId: string;
  qty: string;
  unitPrice: string;
}

interface OrderFormState {
  id?: number;
  number?: string;
  supplierId: string;
  orderDate: string;
  expectedDate: string;
  status: string; // عند الإنشاء: مسودة|مرسل للمورد — عند التعديل انتقال مسودة فقط
  items: OrderItemFormRow[];
  notes: string;
}

const EMPTY_ORDER_FORM: OrderFormState = {
  supplierId: "",
  orderDate: new Date().toISOString().slice(0, 10),
  expectedDate: "",
  status: "مسودة",
  items: [{ itemId: "", qty: "1", unitPrice: "0" }],
  notes: "",
};

export function PurchaseView({ user, onAuthError, section }: PurchaseViewProps) {
  return section === "suppliers" ? (
    <SuppliersSection user={user} onAuthError={onAuthError} />
  ) : (
    <OrdersSection user={user} onAuthError={onAuthError} />
  );
}

// ============================================================
// لوحة «أوامر الشراء»
// ============================================================

function OrdersSection({ user, onAuthError }: { user: User; onAuthError: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);

  const [searchInput, setSearchInput] = React.useState("");
  const [q, setQ] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("الكل");
  const [form, setForm] = React.useState<OrderFormState | null>(null);
  const [receiveTarget, setReceiveTarget] = React.useState<OrderRow | null>(null);
  const [receiveLines, setReceiveLines] = React.useState<Record<number, string>>({}); // poItemId → qty
  const [receiveWarehouse, setReceiveWarehouse] = React.useState("");
  const [receiveDate, setReceiveDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [payTarget, setPayTarget] = React.useState<OrderRow | null>(null);
  const [payAmount, setPayAmount] = React.useState("");
  const [payDate, setPayDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = React.useState("نقداً");
  const [payAccountId, setPayAccountId] = React.useState("");
  const [cancelTarget, setCancelTarget] = React.useState<OrderRow | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<OrderRow | null>(null);

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

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    qc.invalidateQueries({ queryKey: ["purchase-summary"] });
    qc.invalidateQueries({ queryKey: ["purchase-suppliers"] });
  };

  const listQuery = useQuery<{ orders: OrderRow[] }>({
    queryKey: ["purchase-orders", q, statusFilter],
    queryFn: () =>
      apiGet<{ orders: OrderRow[] }>(
        `/api/purchase/orders?q=${encodeURIComponent(q)}&status=${encodeURIComponent(statusFilter)}`
      ),
  });
  const rows = React.useMemo(() => [...(listQuery.data?.orders ?? [])].sort((a, b) => b.id - a.id), [listQuery.data]);

  const summaryQuery = useQuery<{ summary: PurchaseSummary }>({
    queryKey: ["purchase-summary"],
    queryFn: () => apiGet<{ summary: PurchaseSummary }>("/api/purchase/summary"),
  });
  const summary = summaryQuery.data?.summary;

  const suppliersQuery = useQuery<{ suppliers: SupplierRow[] }>({
    queryKey: ["purchase-suppliers", ""],
    queryFn: () => apiGet<{ suppliers: SupplierRow[] }>("/api/purchase/suppliers?q="),
    enabled: form !== null,
  });
  const suppliers = React.useMemo(() => (suppliersQuery.data?.suppliers ?? []).filter((s) => s.active), [suppliersQuery.data]);

  const itemsQuery = useQuery<{ items: { id: number; name: string; unit: string; active: boolean }[] }>({
    queryKey: ["stock-items", ""],
    queryFn: () => apiGet<{ items: { id: number; name: string; unit: string; active: boolean }[] }>("/api/warehouses/items"),
    enabled: form !== null,
  });
  const stockItems = React.useMemo(() => (itemsQuery.data?.items ?? []).filter((it) => it.active), [itemsQuery.data]);

  const warehousesQuery = useQuery<{ warehouses: { id: number; name: string; active: boolean }[] }>({
    queryKey: ["warehouses", ""],
    queryFn: () => apiGet<{ warehouses: { id: number; name: string; active: boolean }[] }>("/api/warehouses/warehouses"),
    enabled: receiveTarget !== null,
  });
  const warehouses = React.useMemo(() => (warehousesQuery.data?.warehouses ?? []).filter((w) => w.active), [warehousesQuery.data]);

  const accountsQuery = useQuery<{ accounts: { id: number; name: string; type: string; isLeaf: boolean; allowPosting: boolean; isActive: boolean }[] }>({
    queryKey: ["accounts-all", ""],
    queryFn: () => apiGet<{ accounts: { id: number; name: string; type: string; isLeaf: boolean; allowPosting: boolean; isActive: boolean }[] }>("/api/accounts"),
    enabled: payTarget !== null,
  });
  const expenseAccounts = React.useMemo(
    () =>
      (accountsQuery.data?.accounts ?? []).filter(
        (a) => a.type === "expense" && a.isLeaf && a.allowPosting && a.isActive
      ),
    [accountsQuery.data]
  );

  const orderTotal = React.useMemo(() => {
    if (!form) return 0;
    return form.items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
  }, [form]);

  const saveMutation = useMutation({
    mutationFn: (f: OrderFormState) => {
      const shared = {
        supplierId: Number(f.supplierId) || null,
        orderDate: f.orderDate,
        expectedDate: f.expectedDate,
        notes: f.notes,
        items: f.items.map((it) => ({
          itemId: Number(it.itemId) || 0,
          qty: Number(it.qty) || 0,
          unitPrice: Number(it.unitPrice) || 0,
        })),
      };
      if (f.id) return apiPatch(`/api/purchase/orders/${f.id}`, shared);
      return apiPost("/api/purchase/orders", { ...shared, status: f.status });
    },
    onSuccess: (d, f) => {
      invalidate();
      const num = (d as { order?: { poNumber?: string } })?.order?.poNumber || "";
      toast({ title: f.id ? "تم تعديل أمر الشراء ✅" : "أُنشئ أمر الشراء ✅", description: num || undefined });
      setForm(null);
    },
    onError: (e) => handleError(e, "تعذر حفظ أمر الشراء"),
  });

  const sendMutation = useMutation({
    mutationFn: (id: number) => apiPatch(`/api/purchase/orders/${id}`, { status: "مرسل للمورد" }),
    onSuccess: (d) => {
      invalidate();
      const num = (d as { order?: { poNumber?: string } })?.order?.poNumber || "";
      toast({ title: "أُرسل الأمر للمورد ✅", description: `${num} — جاهز للاستلام`, });
    },
    onError: (e) => handleError(e, "تعذر إرسال الأمر"),
  });

  const openReceive = (row: OrderRow) => {
    setReceiveTarget(row);
    setReceiveLines({});
    setReceiveWarehouse("");
    setReceiveDate(new Date().toISOString().slice(0, 10));
  };

  // تفصيل الأمر لحوار الاستلام — أسماء الأصناف والمطلوب/المستلم السطري
  const receiveDetailQuery = useQuery<{
    order: { status: string; items: { id: number; qty: number; receivedQty: number; item: { name: string } | null }[] };
  }>({
    queryKey: ["purchase-order-detail", receiveTarget?.id ?? 0],
    queryFn: () => apiGet(`/api/purchase/orders/${receiveTarget?.id}`),
    enabled: receiveTarget !== null,
  });

  // د4 — الاستلام: كميات سطرية، الزيادة ترفضها الخادمة برسالتها — والحالة والقيمة اشتقاقيان (G9)
  const receiveMutation = useMutation({
    mutationFn: (row: OrderRow) => {
      const lines = Object.entries(receiveLines)
        .map(([poItemId, v]) => ({ poItemId: Number(poItemId), qty: Number(v) || 0 }))
        .filter((l) => l.qty > 0);
      return apiPost(`/api/purchase/orders/${row.id}/receive`, {
        vdate: receiveDate,
        warehouseId: Number(receiveWarehouse) || 0,
        lines,
      });
    },
    onSuccess: (d) => {
      invalidate();
      const r = (d as { received?: { docNumber?: string; status?: string } })?.received;
      toast({
        title: "تم الاستلام ✅",
        description: `أُنشئ إذن الإدخال ${r?.docNumber || ""} — حالة الأمر الآن «${r?.status || ""}»`,
      });
      setReceiveTarget(null);
    },
    onError: (e) => handleError(e, "تعذر الاستلام"),
  });

  // د6 — سند صرف مورد عبر محرك السندات القائم (قاعدة payment_expense كما هي + partyType/supplierId)
  const payMutation = useMutation({
    mutationFn: (row: OrderRow) =>
      apiPost("/api/vouchers", {
        vtype: "payment",
        amount: Number(payAmount) || 0,
        vdate: payDate,
        method: payMethod,
        party: row.supplier?.name || "",
        partyType: "supplier",
        supplierId: row.supplierId,
        accountId: Number(payAccountId) || 0,
        description: `سداد أمر شراء ${row.poNumber}`,
      }),
    onSuccess: (d) => {
      invalidate();
      const num = (d as { voucher?: { voucherNumber?: string } })?.voucher?.voucherNumber || "";
      toast({ title: "سند صرف المورد صدر ✅", description: num ? `السند ${num}` : undefined });
      setPayTarget(null);
    },
    onError: (e) => handleError(e, "تعذر إصدار سند الصرف"),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => apiPost(`/api/purchase/orders/${id}/cancel`, {}),
    onSuccess: () => {
      invalidate();
      toast({ title: "أُلغي الأمر ✅" });
      setCancelTarget(null);
    },
    onError: (e) => {
      setCancelTarget(null);
      handleError(e, "تعذر إلغاء الأمر");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/purchase/orders/${id}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "تم الحذف", description: "حُذف أمر الشراء بنجاح" });
      setDeleteTarget(null);
    },
    onError: (e) => {
      setDeleteTarget(null);
      handleError(e, "تعذر حذف الأمر");
    },
  });

  const openCreate = () => setForm({ ...EMPTY_ORDER_FORM, items: [{ itemId: "", qty: "1", unitPrice: "0" }] });
  const openEdit = (row: OrderRow) => {
    // التعديل الكامل مسودة فقط (د3) — جلب التفصيل لبنوده
    apiGet<{ order: { supplierId: number; orderDate: string; expectedDate: string; notes: string; items: { itemId: number; qty: number; unitPrice: number }[] } }>(
      `/api/purchase/orders/${row.id}`
    )
      .then((d) => {
        setForm({
          id: row.id,
          number: row.poNumber,
          supplierId: String(d.order.supplierId),
          orderDate: d.order.orderDate || new Date().toISOString().slice(0, 10),
          expectedDate: d.order.expectedDate || "",
          status: row.status,
          items:
            d.order.items.length > 0
              ? d.order.items.map((it) => ({ itemId: String(it.itemId), qty: String(it.qty), unitPrice: String(it.unitPrice) }))
              : [{ itemId: "", qty: "1", unitPrice: "0" }],
          notes: d.order.notes || "",
        });
      })
      .catch((e) => handleError(e, "تعذر جلب تفاصيل الأمر"));
  };

  const formIsDraft = !!form?.id && form.status === "مسودة";
  const canReceive = (row: OrderRow) => row.status === "مرسل للمورد" || row.status === "جزئي";
  const receivedPct = (row: OrderRow) => {
    const ordered = row.items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
    const received = row.items.reduce((s, it) => s + (Number(it.receivedQty) || 0), 0);
    return ordered > 0 ? Math.min(100, Math.round((received / ordered) * 100)) : 0;
  };

  const receiveRows = receiveDetailQuery.data?.order?.items ?? [];

  return (
    <div className="space-y-4 max-w-full">
      {/* الرأس */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-9" onClick={() => listQuery.refetch()} disabled={listQuery.isFetching}>
            <RefreshCw className={`size-4 ${listQuery.isFetching ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">تحديث</span>
          </Button>
          <Button size="sm" className="h-9 shadow-[0_2px_0_0_var(--brand-flame)] active:translate-y-[1px] active:shadow-none" onClick={openCreate}>
            <Plus className="size-4" /> أمر شراء
          </Button>
        </div>
      </div>

      {/* بطاقة الملخص — اشتقاقية بلا عدادات (G9) */}
      <div className="rounded-xl border bg-card p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <span>أوامر مفتوحة: <b className="text-foreground">{summary?.openCount ?? 0}</b></span>
        <span>قيمتها: <b className="text-foreground">{formatKWD(summary?.openValue ?? 0)}</b></span>
        <span>قيمة المستلم الكلية: <b className="text-foreground">{formatKWD(summary?.receivedValue ?? 0)}</b></span>
        <span>موردون نشطون: <b className="text-foreground">{summary?.activeSuppliers ?? 0}</b></span>
      </div>

      {/* الفلاتر */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="بحث برقم الأمر أو المورد…"
          className="h-9 max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="الكل">كل الحالات</SelectItem>
            {PO_STATUSES.map((s) => (
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
                <TableHead>المورد</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="text-left">القيمة</TableHead>
                <TableHead className="hidden md:table-cell text-left">المستلم</TableHead>
                <TableHead className="hidden lg:table-cell">التاريخ</TableHead>
                <TableHead className="w-14"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">جارِ التحميل…</TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    لا أوامر بعد — أنشئ أمر شراء بمواد من المخازن ثم أرسله للمورد واستلمه
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.poNumber}</TableCell>
                    <TableCell className="max-w-[180px]"><span className="font-medium truncate block">{row.supplier?.name || "—"}</span></TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`border-transparent ${poStatusBadgeClass(row.status)}`}>{row.status}</Badge>
                    </TableCell>
                    <TableCell className="text-left font-mono text-xs whitespace-nowrap">{formatKWD(row.totalAmount)}</TableCell>
                    <TableCell className="hidden md:table-cell text-left">
                      <span className="font-mono text-xs">{receivedPct(row)}%</span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground whitespace-nowrap">{row.orderDate}</TableCell>
                    <TableCell>
                      <Dropdown
                        align="start"
                        triggerLabel={`إجراءات الأمر ${row.poNumber}`}
                        trigger={
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-hover text-muted-foreground">
                            <MoreHorizontal className="size-4" />
                          </span>
                        }
                        items={[
                          ...(row.status === "مسودة"
                            ? [
                                { key: "edit", label: "تعديل", icon: Pencil, onSelect: () => openEdit(row) },
                                { key: "send", label: "إرسال للمورد", icon: ShoppingCart, onSelect: () => sendMutation.mutate(row.id) },
                              ]
                            : []),
                          ...(canReceive(row)
                            ? [{ key: "receive", label: "استلام", icon: PackageCheck, onSelect: () => openReceive(row) }]
                            : []),
                          ...(row.status !== "ملغى" && row.status !== "مسودة"
                            ? [{ key: "pay", label: "سند صرف مورد", icon: Truck, onSelect: () => { setPayTarget(row); setPayAmount(""); setPayMethod("نقداً"); setPayAccountId(""); } }]
                            : []),
                          ...(row.status !== "مسودة" && row.status !== "ملغى"
                            ? [{ key: "pdf", label: "طباعة الأمر (PDF)", icon: FileDown, onSelect: () => window.open(`/api/purchase/orders/${row.id}/pdf`, "_blank") }]
                            : []),
                          ...(manager && row.status === "مسودة"
                            ? [{ key: "del", label: "حذف", icon: Trash2, danger: true, onSelect: () => setDeleteTarget(row) }]
                            : []),
                          ...(row.status === "مسودة" || row.status === "مرسل للمورد"
                            ? [{ key: "cancel", label: "إلغاء الأمر", icon: Ban, danger: true, onSelect: () => setCancelTarget(row) }]
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

      {/* حوار إنشاء/تعديل الأمر — التعديل على المسودة حصرًا (د3) */}
      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.id ? `تعديل الأمر ${form.number || ""}` : "أمر شراء جديد"}</DialogTitle>
            <DialogDescription>
              بنود بأصناف مخزنية إلزامية (د2) بكمية وسعر لقطة — الإنشاء «مسودة» أو «مرسل للمورد» مباشرة، والاستلام يرفع «جزئي/مستلم» آليًا
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>المورد *</Label>
                <SearchableSelect
                  value={form.supplierId}
                  onValueChange={(v) => setForm({ ...form, supplierId: v })}
                  options={suppliers.map((s) => ({ value: String(s.id), label: `${s.name} (${s.supplierCode})` }))}
                  placeholder="اختر المورد"
                  searchPlaceholder="ابحث بالاسم…"
                  emptyText="لا موردين — أضف موردًا من لسان «الموردون»"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>تاريخ الأمر</Label>
                  <Input type="date" value={form.orderDate} onChange={(e) => setForm({ ...form, orderDate: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>التسليم المتوقع</Label>
                  <Input type="date" value={form.expectedDate} onChange={(e) => setForm({ ...form, expectedDate: e.target.value })} />
                </div>
              </div>
              {/* البنود — صنف مخزني إلزامي (د2) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>بنود الأمر *</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7"
                    onClick={() => setForm({ ...form, items: [...form.items, { itemId: "", qty: "1", unitPrice: "0" }] })}
                    disabled={!formIsDraft && !!form.id}
                  >
                    <Plus className="size-3.5" /> بند
                  </Button>
                </div>
                {form.items.map((it, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_80px_100px_32px] gap-2 items-end">
                    <div className="space-y-1">
                      {idx === 0 && <Label className="text-xs">الصنف</Label>}
                      <SearchableSelect
                        value={it.itemId}
                        onValueChange={(v) => {
                          const item = stockItems.find((s) => String(s.id) === v);
                          const items = [...form.items];
                          items[idx] = { ...it, itemId: v, unitPrice: item ? it.unitPrice : it.unitPrice };
                          setForm({ ...form, items });
                        }}
                        options={stockItems.map((s) => ({ value: String(s.id), label: `${s.name}${s.unit ? ` — ${s.unit}` : ""}` }))}
                        placeholder="اختر الصنف المخزني"
                        searchPlaceholder="ابحث بالاسم…"
                        emptyText="لا أصناف — فعّل المخازن وأضف الأصناف أولًا"
                      />
                    </div>
                    <div className="space-y-1">
                      {idx === 0 && <Label className="text-xs">الكمية</Label>}
                      <Input type="number" min="0" step="0.001" value={it.qty} onChange={(e) => {
                        const items = [...form.items];
                        items[idx] = { ...it, qty: e.target.value };
                        setForm({ ...form, items });
                      }} />
                    </div>
                    <div className="space-y-1">
                      {idx === 0 && <Label className="text-xs">سعر الوحدة</Label>}
                      <Input type="number" min="0" step="0.001" value={it.unitPrice} onChange={(e) => {
                        const items = [...form.items];
                        items[idx] = { ...it, unitPrice: e.target.value };
                        setForm({ ...form, items });
                      }} />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 text-danger"
                      disabled={(!!form.id && !formIsDraft) || form.items.length === 1}
                      onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
                <div className="text-xs text-muted-foreground text-left font-mono">الإجمالي: {formatKWD(orderTotal)}</div>
              </div>
              {form.id && !formIsDraft && (
                <div className="rounded-lg border border-status-warn bg-status-warn-bg px-3 py-2 text-xs text-warn-ink">
                  التعديل متاح على الأمر في حالة «مسودة» فقط — هذا الأمر في حالة «{form.status}»؛ استخدم «استلام» أو «إلغاء».
                </div>
              )}
              <div className="space-y-1.5">
                <Label>ملاحظات</Label>
                <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>إلغاء</Button>
            <Button
              className="shadow-[0_2px_0_0_var(--brand-flame)] active:translate-y-[1px] active:shadow-none"
              disabled={
                saveMutation.isPending ||
                !form?.supplierId ||
                form?.items.some((it) => !it.itemId || (Number(it.qty) || 0) <= 0) ||
                (!!form?.id && !formIsDraft)
              }
              onClick={() => form && saveMutation.mutate(form)}
            >
              {saveMutation.isPending ? "جارِ الحفظ…" : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* حوار الاستلام — يولّد إذن إدخال آليًا عبر دالة المخازن (د4) */}
      <Dialog open={receiveTarget !== null} onOpenChange={(o) => !o && setReceiveTarget(null)}>
        <DialogContent className="sm:max-w-xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>استلام {receiveTarget?.poNumber || ""}</DialogTitle>
            <DialogDescription>
              كميات سطرية لا تتجاوز المطلوب (د4) — الحفظ يولّد إذن إدخال ائتماني آليًا بلقطة سعر الأمر ويُرحَّل قيده فورًا
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>المستودع *</Label>
                <SearchableSelect
                  value={receiveWarehouse}
                  onValueChange={setReceiveWarehouse}
                  options={warehouses.map((w) => ({ value: String(w.id), label: w.name }))}
                  placeholder="اختر المستودع"
                  searchPlaceholder="ابحث…"
                  emptyText="لا مستودعات"
                />
              </div>
              <div className="space-y-1.5">
                <Label>تاريخ الاستلام</Label>
                <Input type="date" value={receiveDate} onChange={(e) => setReceiveDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>الكميات المستلمة الآن</Label>
              {receiveRows.map((it) => {
                const ordered = Number(it.qty) || 0;
                const received = Number(it.receivedQty) || 0;
                const remaining = Math.max(0, ordered - received);
                if (remaining <= 0) {
                  return (
                    <div key={it.id} className="flex items-center justify-between rounded-lg border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
                      <span className="truncate">{it.item?.name}</span>
                      <span>مكتمل — المستلم {received} / {ordered}</span>
                    </div>
                  );
                }
                return (
                  <div key={it.id} className="grid grid-cols-[1fr_110px] gap-2 items-end rounded-lg border p-2">
                    <div>
                      <div className="text-sm font-medium truncate">{it.item?.name}</div>
                      <div className="text-xs text-muted-foreground">
                        المطلوب {ordered} · المستلم {received} · الباقي {remaining}
                      </div>
                    </div>
                    <Input
                      type="number"
                      min="0"
                      max={remaining}
                      step="0.001"
                      value={receiveLines[it.id] ?? ""}
                      placeholder="الكمية"
                      onChange={(e) => setReceiveLines({ ...receiveLines, [it.id]: e.target.value })}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveTarget(null)}>إلغاء</Button>
            <Button
              className="shadow-[0_2px_0_0_var(--brand-flame)] active:translate-y-[1px] active:shadow-none"
              disabled={
                receiveMutation.isPending ||
                !receiveWarehouse ||
                Object.values(receiveLines).every((v) => (Number(v) || 0) <= 0)
              }
              onClick={() => receiveTarget && receiveMutation.mutate(receiveTarget)}
            >
              <PackageCheck className="size-4" /> {receiveMutation.isPending ? "جارِ الاستلام…" : "تأكيد الاستلام"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* حوار سند صرف المورد — محرك السندات القائم (د6) */}
      <Dialog open={payTarget !== null} onOpenChange={(o) => !o && setPayTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>سند صرف مورد</DialogTitle>
            <DialogDescription>
              {payTarget ? `للمورد ${payTarget.supplier?.name || ""} على الأمر ${payTarget.poNumber} — يصدر عبر محرك السندات القائم` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>المبلغ (د.ك) *</Label>
                <Input type="number" min="0" step="0.001" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>التاريخ</Label>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>وسيلة الدفع</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="نقداً">نقداً (الصندوق)</SelectItem>
                  <SelectItem value="تحويل بنكي">تحويل بنكي (البنك)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>حساب المصروف (مدين) *</Label>
              <SearchableSelect
                value={payAccountId}
                onValueChange={setPayAccountId}
                options={expenseAccounts.map((a) => ({ value: String(a.id), label: a.name }))}
                placeholder="اختر حساب المصروف"
                searchPlaceholder="ابحث…"
                emptyText="لا حسابات مصروف"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)}>إلغاء</Button>
            <Button
              className="shadow-[0_2px_0_0_var(--brand-flame)] active:translate-y-[1px] active:shadow-none"
              disabled={payMutation.isPending || (Number(payAmount) || 0) <= 0 || !payAccountId}
              onClick={() => payTarget && payMutation.mutate(payTarget)}
            >
              {payMutation.isPending ? "جارِ الإصدار…" : "إصدار السند"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* حوارا التأكيد */}
      <Dialog open={cancelTarget !== null} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>إلغاء أمر الشراء</DialogTitle>
            <DialogDescription>
              {cancelTarget ? `إلغاء ${cancelTarget.poNumber}؟ لا يُستلم بعده ولن يظهر في المفتوح.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>رجوع</Button>
            <Button variant="destructive" disabled={cancelMutation.isPending} onClick={() => cancelTarget && cancelMutation.mutate(cancelTarget.id)}>
              {cancelMutation.isPending ? "جارِ الإلغاء…" : "إلغاء الأمر"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>حذف أمر الشراء</DialogTitle>
            <DialogDescription>
              {deleteTarget ? `حذف ${deleteTarget.poNumber}؟ مسودة بلا أثر — لا يمكن التراجع.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}>
              {deleteMutation.isPending ? "جارِ الحذف…" : "حذف"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// لوحة «الموردون»
// ============================================================

interface SupplierFormState {
  id?: number;
  number?: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  crNumber: string;
  active: boolean;
  notes: string;
}

const EMPTY_SUPPLIER_FORM: SupplierFormState = { name: "", phone: "", email: "", address: "", crNumber: "", active: true, notes: "" };

function SuppliersSection({ user, onAuthError }: { user: User; onAuthError: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);
  const [searchInput, setSearchInput] = React.useState("");
  const [q, setQ] = React.useState("");
  const [form, setForm] = React.useState<SupplierFormState | null>(null);
  const [detail, setDetail] = React.useState<SupplierRow | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<SupplierRow | null>(null);

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

  const listQuery = useQuery<{ suppliers: SupplierRow[] }>({
    queryKey: ["purchase-suppliers", q],
    queryFn: () => apiGet<{ suppliers: SupplierRow[] }>(`/api/purchase/suppliers?q=${encodeURIComponent(q)}`),
  });
  const rows = React.useMemo(() => [...(listQuery.data?.suppliers ?? [])].sort((a, b) => a.name.localeCompare(b.name, "ar")), [listQuery.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["purchase-suppliers"] });
    qc.invalidateQueries({ queryKey: ["purchase-summary"] });
  };

  const saveMutation = useMutation({
    mutationFn: (f: SupplierFormState) => {
      const shared = {
        name: f.name,
        phone: f.phone,
        email: f.email,
        address: f.address,
        crNumber: f.crNumber,
        active: f.active,
        notes: f.notes,
      };
      return f.id ? apiPatch(`/api/purchase/suppliers/${f.id}`, shared) : apiPost("/api/purchase/suppliers", shared);
    },
    onSuccess: (d, f) => {
      invalidate();
      const num = (d as { supplier?: { supplierCode?: string } })?.supplier?.supplierCode || "";
      toast({ title: f.id ? "تم تعديل المورد ✅" : "أُنشئ المورد ✅", description: num || undefined });
      setForm(null);
    },
    onError: (e) => handleError(e, "تعذر حفظ المورد"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/purchase/suppliers/${id}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "تم الحذف", description: "حُذف المورد بنجاح" });
      setDeleteTarget(null);
    },
    onError: (e) => {
      setDeleteTarget(null);
      handleError(e, "تعذر حذف المورد");
    },
  });

  const openEdit = (row: SupplierRow) =>
    setForm({
      id: row.id,
      number: row.supplierCode,
      name: row.name,
      phone: row.phone || "",
      email: row.email || "",
      address: row.address || "",
      crNumber: row.crNumber || "",
      active: row.active,
      notes: row.notes || "",
    });

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="بحث بالاسم أو الهاتف أو الكود…"
          className="h-9 max-w-xs"
        />
        <Button size="sm" className="h-9 shadow-[0_2px_0_0_var(--brand-flame)] active:translate-y-[1px] active:shadow-none" onClick={() => setForm({ ...EMPTY_SUPPLIER_FORM })}>
          <Plus className="size-4" /> مورد جديد
        </Button>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="max-h-96 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">الكود</TableHead>
                <TableHead>المورد</TableHead>
                <TableHead className="hidden md:table-cell">الهاتف</TableHead>
                <TableHead className="hidden lg:table-cell text-left">الأوامر</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="w-14"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">جارِ التحميل…</TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    لا موردين بعد — أضف أول مورد لتبدأ أوامر الشراء
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} className="cursor-pointer" onClick={() => setDetail(row)}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.supplierCode}</TableCell>
                    <TableCell className="max-w-[200px]"><span className="font-medium truncate block">{row.name}</span></TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground font-mono" dir="ltr">{row.phone || "—"}</TableCell>
                    <TableCell className="hidden lg:table-cell text-left text-xs whitespace-nowrap">
                      {row.ordersCount} أمر · {formatKWD(row.ordersValue)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={row.active ? "border-transparent bg-status-done-bg text-status-done" : "border-transparent bg-status-danger-bg text-status-danger"}>
                        {row.active ? "نشط" : "موقوف"}
                      </Badge>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Dropdown
                        align="start"
                        triggerLabel={`إجراءات المورد ${row.supplierCode}`}
                        trigger={
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-hover text-muted-foreground">
                            <MoreHorizontal className="size-4" />
                          </span>
                        }
                        items={[
                          { key: "edit", label: "تعديل", icon: Pencil, onSelect: () => openEdit(row) },
                          ...(manager && row.ordersCount === 0
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

      {/* حوار إنشاء/تعديل مورد */}
      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-md max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.id ? `تعديل المورد ${form.number || ""}` : "مورد جديد"}</DialogTitle>
            <DialogDescription>كود المورد يُرقَّم آليًا SUP-#### — والاسم فريد لكل شركة</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>اسم المورد *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>الهاتف</Label>
                  <Input dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>السجل التجاري</Label>
                  <Input dir="ltr" value={form.crNumber} onChange={(e) => setForm({ ...form, crNumber: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>البريد</Label>
                <Input dir="ltr" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>العنوان</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                <Label>نشط</Label>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, active: !form.active })}
                  className={`h-5 w-9 rounded-full transition-colors ${form.active ? "bg-status-done" : "bg-muted"}`}
                  aria-pressed={form.active}
                >
                  <span className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${form.active ? "translate-x-[-18px]" : "translate-x-[2px]"}`} />
                </button>
              </div>
              <div className="space-y-1.5">
                <Label>ملاحظات</Label>
                <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>إلغاء</Button>
            <Button
              className="shadow-[0_2px_0_0_var(--brand-flame)] active:translate-y-[1px] active:shadow-none"
              disabled={saveMutation.isPending || !form?.name.trim()}
              onClick={() => form && saveMutation.mutate(form)}
            >
              {saveMutation.isPending ? "جارِ الحفظ…" : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* كشف المورد المختصر — أوامره وسنداته (د6) */}
      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail ? `${detail.supplierCode} — ${detail.name}` : ""}</DialogTitle>
            <DialogDescription>كشف مختصر: أوامر الشراء وسندات الصرف المرتبطة (د6)</DialogDescription>
          </DialogHeader>
          {detail && <SupplierDetail supplierId={detail.id} onAuthError={onAuthError} />}
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>حذف المورد</DialogTitle>
            <DialogDescription>
              {deleteTarget ? `حذف ${deleteTarget.supplierCode} — ${deleteTarget.name}؟ لا يمكن التراجع.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}>
              {deleteMutation.isPending ? "جارِ الحذف…" : "حذف"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** كشف المورد: أوامر الشراء + سندات الصرف — استعلام على التفصيل القائم */
function SupplierDetail({ supplierId, onAuthError }: { supplierId: number; onAuthError: () => void }) {
  const detailQuery = useQuery<{
    supplier: {
      purchaseOrders: { id: number; poNumber: string; orderDate: string; status: string; totalAmount: number; receivedAmount: number }[];
      vouchers: { id: number; voucherNumber: string; vtype: string; vdate: string; amount: number; description: string; cancelled: boolean }[];
    };
  }>({
    queryKey: ["purchase-supplier-detail", supplierId],
    queryFn: () => apiGet(`/api/purchase/suppliers/${supplierId}`),
  });

  React.useEffect(() => {
    if (detailQuery.error instanceof ApiError && detailQuery.error.status === 401) onAuthError();
  }, [detailQuery.error, onAuthError]);

  if (detailQuery.isLoading) return <div className="py-6 text-center text-sm text-muted-foreground">جارِ التحميل…</div>;
  const orders = detailQuery.data?.supplier?.purchaseOrders ?? [];
  const vouchers = detailQuery.data?.supplier?.vouchers ?? [];

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-bold mb-2">أوامر الشراء ({orders.length})</div>
        <div className="max-h-44 overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الرقم</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="text-left">القيمة</TableHead>
                <TableHead className="text-left">المستلم</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="py-4 text-center text-xs text-muted-foreground">لا أوامر</TableCell></TableRow>
              ) : (
                orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-xs">{o.poNumber}</TableCell>
                    <TableCell><Badge variant="outline" className={`border-transparent ${poStatusBadgeClass(o.status)}`}>{o.status}</Badge></TableCell>
                    <TableCell className="text-left font-mono text-xs">{formatKWD(o.totalAmount)}</TableCell>
                    <TableCell className="text-left font-mono text-xs">{formatKWD(o.receivedAmount)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      <div>
        <div className="text-sm font-bold mb-2">سندات الصرف ({vouchers.filter((v) => !v.cancelled).length})</div>
        <div className="max-h-44 overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>السند</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead className="text-left">المبلغ</TableHead>
                <TableHead>الوصف</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vouchers.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="py-4 text-center text-xs text-muted-foreground">لا سندات</TableCell></TableRow>
              ) : (
                vouchers.map((v) => (
                  <TableRow key={v.id} className={v.cancelled ? "opacity-50" : ""}>
                    <TableCell className="font-mono text-xs">{v.voucherNumber}{v.cancelled ? " (ملغى)" : ""}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{v.vdate}</TableCell>
                    <TableCell className="text-left font-mono text-xs">{formatKWD(v.amount)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">{v.description}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
