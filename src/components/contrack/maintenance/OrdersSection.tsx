"use client";

/**
 * OrdersSection.tsx — قسم «أوامر العمل» (docs/maintenance-design.md §6 — د3/د4/د8/د9):
 * فلاتر + جدول MO بآلته المغلقة (مفتوحة⇒جارية⇒منجزة/ملغاة) + حوار التفاصيل:
 * صرف المواد بمحرك المخازن (إذن واحد — د8) · فاتورة الزيارة بعد الإنهاء حصرًا (د9)
 * · الإلغاء مرفوض ذو مستندات برسالة تسمّيها — المدير يلغيها من شاشتيها أولًا (د8).
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Boxes, Loader2, NotebookPen, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPatch, apiPost } from "../api";
import { fmtMoney, fmtNum, statusTone, type MaintenanceContractRow, type WorkOrderRow } from "../MaintenanceView";

interface Props {
  onAuthError: () => void;
  isAdmin: boolean;
}

interface Technician {
  id: number;
  name: string;
  phone: string;
}
interface WhRow {
  id: number;
  name: string;
  location: string;
  active: boolean;
}
interface ItemRow {
  id: number;
  name: string;
  unit: string;
  category: string;
  minQty: number;
  active: boolean;
}

const STATUS_FILTERS = ["", "مفتوحة", "جارية", "منجزة", "ملغاة"];

function StatusBadge({ status }: { status: string }) {
  return <Badge className={`h-5 px-1.5 text-[10px] ${statusTone(status)}`}>{status}</Badge>;
}

export function OrdersSection({ onAuthError, isAdmin }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const onErr = React.useCallback(
    (e: unknown, title: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title, description: (e as { message?: string })?.message || "خطأ غير متوقع" });
    },
    [onAuthError, toast]
  );

  const [filters, setFilters] = React.useState({ status: "", contractId: "", from: "", to: "" });
  const ordersQuery = useQuery<{ orders: WorkOrderRow[] }>({
    queryKey: ["maintenance", "orders", filters],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (filters.status) qs.set("status", filters.status);
      if (filters.contractId) qs.set("contractId", filters.contractId);
      if (filters.from) qs.set("from", filters.from);
      if (filters.to) qs.set("to", filters.to);
      const q = qs.toString();
      return apiGet<{ orders: WorkOrderRow[] }>(`/api/maintenance/orders${q ? `?${q}` : ""}`);
    },
  });
  const contractsQuery = useQuery<{ contracts: MaintenanceContractRow[] }>({
    queryKey: ["maintenance", "contracts"],
    queryFn: () => apiGet<{ contracts: MaintenanceContractRow[]; typeNames: string[] }>("/api/maintenance/contracts"),
    staleTime: 30_000,
  });

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["maintenance"] });
  }, [qc]);

  const orders = ordersQuery.data?.orders ?? [];
  const [detail, setDetail] = React.useState<WorkOrderRow | null>(null);

  return (
    <div className="space-y-3">
      {/* الفلاتر + الإنشاء */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <span className="text-[11px] text-muted-foreground">الحالة</span>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s || "الكل"}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <span className="text-[11px] text-muted-foreground">العقد</span>
          <select
            className="h-9 max-w-56 rounded-md border border-input bg-background px-2 text-sm"
            value={filters.contractId}
            onChange={(e) => setFilters({ ...filters, contractId: e.target.value })}
          >
            <option value="">كل العقود</option>
            {(contractsQuery.data?.contracts ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.contractNumber}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <span className="text-[11px] text-muted-foreground">من</span>
          <Input type="date" className="h-9 w-36" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </div>
        <div className="grid gap-1">
          <span className="text-[11px] text-muted-foreground">إلى</span>
          <Input type="date" className="h-9 w-36" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </div>
        <div className="ms-auto">
          <NewOrderDialog onDone={invalidate} onErr={onErr} />
        </div>
      </div>

      {/* الجدول — بلا تمرير أفقي على الموبايل (بطاقات مكدسة) */}
      {ordersQuery.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <Card className="p-4">
          <div className="py-6 text-center">
            <NotebookPen className="mx-auto size-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm font-medium">لا أوامر عمل</p>
            <p className="text-xs text-muted-foreground">افتح أمرًا من الجدول الوقائي أو مباشرة من الزر أعلاه</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {orders.map((w) => (
            <Card
              key={w.id}
              className="cursor-pointer gap-2 p-3 transition-colors hover:border-primary/40"
              onClick={() => setDetail(w)}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 font-mono text-xs font-bold">{w.docNumber}</span>
                  <span className="truncate text-sm font-semibold">{w.title}</span>
                  <StatusBadge status={w.status} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {w.materialsDocNumber && (
                    <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px]">
                      <Boxes className="size-3" /> {w.materialsDocNumber}
                    </Badge>
                  )}
                  {w.invoiceNumber && (
                    <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px]">
                      <Banknote className="size-3" /> {w.invoiceNumber}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                <span>
                  {w.contractNumber} — {w.customerName}
                </span>
                <span>مجدول: {w.scheduledDate || "—"}</span>
                {w.technicianName && <span>الفني: {w.technicianName}</span>}
                {w.materialsTotal != null && <span>المواد: {fmtMoney(w.materialsTotal)}</span>}
                {w.invoiceTotal != null && <span>الفاتورة: {fmtMoney(w.invoiceTotal)}</span>}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* حوار التفاصيل والعمليات */}
      <OrderDetailDialog
        order={detail}
        onClose={() => setDetail(null)}
        onDone={() => {
          setDetail(null);
          invalidate();
        }}
        onErr={onErr}
        isAdmin={isAdmin}
      />
    </div>
  );
}

// ==================== حوار إنشاء أمر مباشر (بلا حدث — د3) ====================

function NewOrderDialog({ onDone, onErr }: { onDone: () => void; onErr: (e: unknown, title: string) => void }) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ contractId: "", title: "", description: "", technicianId: "", scheduledDate: "", notes: "" });

  const contractsQuery = useQuery<{ contracts: MaintenanceContractRow[] }>({
    queryKey: ["maintenance", "contracts"],
    queryFn: () => apiGet<{ contracts: MaintenanceContractRow[]; typeNames: string[] }>("/api/maintenance/contracts"),
    enabled: open,
    staleTime: 30_000,
  });
  const techQuery = useQuery<{ technicians: Technician[] }>({
    queryKey: ["maintenance", "technicians"],
    queryFn: () => apiGet<{ technicians: Technician[] }>("/api/maintenance/technicians"),
    enabled: open,
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiPost<{ docNumber: string }>("/api/maintenance/orders", {
        contractId: Number(form.contractId),
        title: form.title,
        description: form.description,
        technicianId: Number(form.technicianId) || null,
        scheduledDate: form.scheduledDate,
        notes: form.notes,
      }),
    onSuccess: (r) => {
      setOpen(false);
      setForm({ contractId: "", title: "", description: "", technicianId: "", scheduledDate: "", notes: "" });
      onDone();
      toast({ title: `فُتح أمر العمل ${r.docNumber}` });
    },
    onError: (e) => onErr(e, "تعذر إنشاء الأمر"),
  });

  const activeContracts = (contractsQuery.data?.contracts ?? []).filter((c) => c.status === "نشط");

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <Plus className="size-4" />
        أمر عمل مباشر
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>أمر عمل مباشر</DialogTitle>
            <DialogDescription>على عقد صيانة نشط — بلا حدث وقائي (أوامر عرضية)</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>عقد الصيانة *</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={form.contractId}
                onChange={(e) => setForm({ ...form, contractId: e.target.value })}
              >
                <option value="">— اختر العقد —</option>
                {activeContracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.contractNumber} — {c.contractName || c.contractType}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>العنوان *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>الوصف</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>الفني</Label>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.technicianId}
                  onChange={(e) => setForm({ ...form, technicianId: e.target.value })}
                >
                  <option value="">— بلا فني —</option>
                  {(techQuery.data?.technicians ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label>تاريخ الجدولة *</Label>
                <Input type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>ملاحظات</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={createMutation.isPending}
              onClick={() => {
                if (!form.contractId) return toast({ variant: "destructive", title: "عقد الصيانة مطلوب" });
                if (!form.title.trim()) return toast({ variant: "destructive", title: "العنوان مطلوب" });
                if (!form.scheduledDate) return toast({ variant: "destructive", title: "تاريخ الجدولة مطلوب" });
                createMutation.mutate();
              }}
            >
              {createMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              إنشاء الأمر
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ==================== حوار التفاصيل: آلة الحالة + المواد + الفاتورة ====================

function OrderDetailDialog({
  order,
  onClose,
  onDone,
  onErr,
  isAdmin,
}: {
  order: WorkOrderRow | null;
  onClose: () => void;
  onDone: () => void;
  onErr: (e: unknown, title: string) => void;
  isAdmin: boolean;
}) {
  const { toast } = useToast();
  const [sub, setSub] = React.useState<"none" | "materials" | "invoice" | "cancel">("none");

  const statusMutation = useMutation({
    mutationFn: (v: { to: string; reason?: string; completedNote?: string }) =>
      apiPost(`/api/maintenance/orders/${order?.id}/status`, v),
    onSuccess: (_r, v) => {
      onDone();
      setSub("none");
      toast({ title: v.to === "ملغاة" ? "أُلغي الأمر" : v.to === "منجزة" ? "أُنهي الأمر" : "بدأ تنفيذ الأمر" });
    },
    onError: (e) => onErr(e, "تعذر تغيير الحالة"),
  });

  const w = order;
  const canStart = w?.status === "مفتوحة";
  const canComplete = w?.status === "مفتوحة" || w?.status === "جارية";
  const canCancel = (w?.status === "مفتوحة" || w?.status === "جارية") && isAdmin;
  const canMaterials = (w?.status === "مفتوحة" || w?.status === "جارية") && !w?.materialsDocId;
  const canInvoice = w?.status === "منجزة" && !w?.invoiceId;

  return (
    <Dialog open={!!w} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        {w && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{w.docNumber}</span>
                <StatusBadge status={w.status} />
              </DialogTitle>
              <DialogDescription>{w.title}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-[12px]">
              <p>
                <span className="text-muted-foreground">العقد: </span>
                <span className="font-semibold">
                  {w.contractNumber} — {w.contractName || w.customerName}
                </span>
              </p>
              {w.description && (
                <p>
                  <span className="text-muted-foreground">الوصف: </span>
                  {w.description}
                </p>
              )}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <span>
                  <span className="text-muted-foreground">الجدولة: </span>
                  {w.scheduledDate || "—"}
                </span>
                <span>
                  <span className="text-muted-foreground">من حدث: </span>
                  {w.occurrenceDue || "أمر مباشر"}
                </span>
                <span>
                  <span className="text-muted-foreground">الفني: </span>
                  {w.technicianName || "—"}
                </span>
                {w.status === "منجزة" && (
                  <span>
                    <span className="text-muted-foreground">الإنهاء: </span>
                    {w.completedAt}
                  </span>
                )}
                {w.status === "ملغاة" && (
                  <span className="col-span-2">
                    <span className="text-muted-foreground">سبب الإلغاء: </span>
                    {w.cancelReason}
                  </span>
                )}
              </div>
              {w.completedNote && (
                <p>
                  <span className="text-muted-foreground">ملاحظة الإنهاء: </span>
                  {w.completedNote}
                </p>
              )}
              {w.notes && (
                <p>
                  <span className="text-muted-foreground">ملاحظات: </span>
                  {w.notes}
                </p>
              )}
            </div>

            {/* المستندات المرتبطة */}
            <div className="flex flex-wrap gap-2 text-[11px]">
              {w.materialsDocNumber ? (
                <Badge variant="outline" className="gap-1">
                  <Boxes className="size-3" /> إذن الصرف {w.materialsDocNumber} — {fmtMoney(w.materialsTotal ?? 0)}
                </Badge>
              ) : (
                <span className="text-muted-foreground">بلا إذن صرف</span>
              )}
              {w.invoiceNumber ? (
                <Badge variant="outline" className="gap-1">
                  <Banknote className="size-3" /> فاتورة {w.invoiceNumber} — {fmtMoney(w.invoiceTotal ?? 0)}
                </Badge>
              ) : (
                <span className="text-muted-foreground">بلا فاتورة</span>
              )}
            </div>

            {/* أزرار الآلة المغلقة (د4) والبوابات (د8/د9) */}
            {w.status !== "منجزة" && w.status !== "ملغاة" && (
              <div className="flex flex-wrap gap-2">
                {canStart && (
                  <Button size="sm" variant="outline" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate({ to: "جارية" })}>
                    بدء التنفيذ
                  </Button>
                )}
                {canMaterials && (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setSub(sub === "materials" ? "none" : "materials")}>
                    <Boxes className="size-3.5" /> صرف مواد
                  </Button>
                )}
                {canComplete && (
                  <Button size="sm" className="gap-1.5" onClick={() => setSub(sub === "invoice" ? "none" : "invoice")}>
                    إنهاء الأمر
                  </Button>
                )}
                {canCancel && (
                  <Button size="sm" variant="destructive" onClick={() => setSub(sub === "cancel" ? "none" : "cancel")}>
                    إلغاء الأمر
                  </Button>
                )}
              </div>
            )}

            {/* لوحة صرف المواد (د8 — محرك المخازن حرفًا) */}
            {sub === "materials" && w && (
              <MaterialsPanel orderId={w.id} onDone={onDone} onErr={onErr} />
            )}

            {/* لوحة الإنهاء + الفاتورة (د9) */}
            {sub === "invoice" && w && (
              <CompleteInvoicePanel orderId={w.id} onDone={onDone} onErr={onErr} />
            )}

            {/* لوحة الإلغاء بسبب (د8) */}
            {sub === "cancel" && w && (
              <CancelPanel
                orderId={w.id}
                onDone={onDone}
                onErr={onErr}
                pending={statusMutation.isPending}
                submit={(reason) => statusMutation.mutate({ to: "ملغاة", reason })}
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ==================== لوحة صرف المواد ====================

function MaterialsPanel({
  orderId,
  onDone,
  onErr,
}: {
  orderId: number;
  onDone: () => void;
  onErr: (e: unknown, title: string) => void;
}) {
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [vdate, setVdate] = React.useState(today);
  const [warehouseId, setWarehouseId] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [lines, setLines] = React.useState<{ itemId: string; qty: string; note: string }[]>([{ itemId: "", qty: "", note: "" }]);

  const whQuery = useQuery<{ warehouses: WhRow[] }>({
    queryKey: ["warehouses", "warehouses"],
    queryFn: () => apiGet<{ warehouses: WhRow[] }>("/api/warehouses/warehouses"),
    staleTime: 60_000,
  });
  const itemsQuery = useQuery<{ items: ItemRow[] }>({
    queryKey: ["warehouses", "items"],
    queryFn: () => apiGet<{ items: ItemRow[] }>("/api/warehouses/items"),
    staleTime: 60_000,
  });

  React.useEffect(() => {
    const active = (whQuery.data?.warehouses ?? []).filter((x) => x.active);
    if (active.length > 0 && !warehouseId) setWarehouseId(String(active[0].id));
  }, [whQuery.data]);

  const issueMutation = useMutation({
    mutationFn: () =>
      apiPost<{ docNumber: string; totalAmount: number }>(`/api/maintenance/orders/${orderId}/materials`, {
        vdate,
        warehouseId: Number(warehouseId),
        notes,
        lines: lines
          .filter((l) => l.itemId && Number(l.qty) > 0)
          .map((l) => ({ itemId: Number(l.itemId), qty: Number(l.qty), note: l.note })),
      }),
    onSuccess: (r) => {
      onDone();
      toast({ title: `صُرفت المواد — إذن ${r.docNumber}`, description: `القيمة ${fmtMoney(r.totalAmount)} وقيد الصرف تلقائي` });
    },
    onError: (e) => onErr(e, "تعذر صرف المواد"),
  });

  const items = (itemsQuery.data?.items ?? []).filter((i) => i.active);

  return (
    <div className="grid gap-3 rounded-md border p-3">
      <p className="text-xs font-semibold">صرف مواد — إذن واحد للأمر (د8) بالمتوسط المرجحي الخادمي</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label>التاريخ</Label>
          <Input type="date" value={vdate} onChange={(e) => setVdate(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label>المستودع *</Label>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            {(whQuery.data?.warehouses ?? [])
              .filter((x) => x.active)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
        </div>
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_90px_1fr_32px] items-center gap-2">
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={l.itemId}
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))}
            >
              <option value="">— الصنف —</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                  {it.unit ? ` (${it.unit})` : ""}
                </option>
              ))}
            </select>
            <Input
              type="number"
              step="0.001"
              min="0"
              placeholder="الكمية"
              className="h-8 text-xs"
              value={l.qty}
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
            />
            <Input
              placeholder="ملاحظة السطر"
              className="h-8 text-xs"
              value={l.note}
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))}
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-1"
              onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [{ itemId: "", qty: "", note: "" }])}
            >
              ×
            </Button>
          </div>
        ))}
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={() => setLines([...lines, { itemId: "", qty: "", note: "" }])}>
          <Plus className="size-3" /> سطر آخر
        </Button>
      </div>
      <div className="grid gap-1.5">
        <Label>ملاحظات الإذن</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <Button
        size="sm"
        disabled={issueMutation.isPending}
        onClick={() => {
          if (!warehouseId) return toast({ variant: "destructive", title: "المستودع مطلوب" });
          if (!lines.some((l) => l.itemId && Number(l.qty) > 0))
            return toast({ variant: "destructive", title: "أضف صنفًا واحدًا على الأقل بكمية صحيحة" });
          issueMutation.mutate();
        }}
      >
        {issueMutation.isPending && <Loader2 className="size-4 animate-spin" />}
        صرف وقيد تلقائي
      </Button>
    </div>
  );
}

// ==================== لوحة الإنهاء + فاتورة الزيارة (د9) ====================

function CompleteInvoicePanel({
  orderId,
  onDone,
  onErr,
}: {
  orderId: number;
  onDone: () => void;
  onErr: (e: unknown, title: string) => void;
}) {
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [completedNote, setCompletedNote] = React.useState("");
  const [invoiceNow, setInvoiceNow] = React.useState(true);
  const [invoiceDate, setInvoiceDate] = React.useState(today);
  const [linePrice, setLinePrice] = React.useState("");
  const [description, setDescription] = React.useState("");

  // المقترح يُحسب خادميًا عند الإصدار: قيمة العقد ÷ زيارات الخطة — ويُقبل السعر المدخل إن قُدّم

  const completeMutation = useMutation({
    mutationFn: async () => {
      // 1) إنهاء الأمر (د4)
      await apiPost(`/api/maintenance/orders/${orderId}/status`, { to: "منجزة", completedNote });
      // 2) فاتورة الزيارة فورًا إن اختير (د9 — الإنهاء شرطها)
      if (invoiceNow) {
        return apiPost<{ invoiceNumber: string; total: number }>(`/api/maintenance/orders/${orderId}/invoice`, {
          invoiceDate,
          ...(linePrice ? { linePrice: Number(linePrice) } : {}),
          description,
        });
      }
      return null;
    },
    onSuccess: (r) => {
      onDone();
      toast({
        title: "أُنهي الأمر",
        description: r ? `أُصدرت الفاتورة ${r.invoiceNumber} بمبلغ ${fmtMoney(r.total)} — القبض بسند RV من المحاسبة` : "بلا فاتورة",
      });
    },
    onError: (e) => onErr(e, "تعذر إنهاء الأمر"),
  });

  return (
    <div className="grid gap-3 rounded-md border p-3">
      <p className="text-xs font-semibold">إنهاء الأمر — والفاتورة بعده حصرًا (د9)</p>
      <div className="grid gap-1.5">
        <Label>ملاحظة الإنهاء</Label>
        <Textarea rows={2} value={completedNote} onChange={(e) => setCompletedNote(e.target.value)} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={invoiceNow} onChange={(e) => setInvoiceNow(e.target.checked)} className="size-4" />
        إصدار فاتورة الزيارة فورًا (بمحرك الفواتير — سقف الفوترة يحمي)
      </label>
      {invoiceNow && (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>تاريخ الفاتورة</Label>
              <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>السعر (فارغ = المقترح)</Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                placeholder="قيمة العقد ÷ زيارات الخطة"
                value={linePrice}
                onChange={(e) => setLinePrice(e.target.value)}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            المقترح = قيمة العقد ÷ عدد زيارات الخطة (يُحسب خادميًا عند الإصدار — ويُقبل السعر المدخل إن قُدّم)
          </p>
          <div className="grid gap-1.5">
            <Label>وصف بند الفاتورة</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="أمر صيانة MO-xxxx — …" />
          </div>
        </div>
      )}
      <Button size="sm" disabled={completeMutation.isPending} onClick={() => completeMutation.mutate()}>
        {completeMutation.isPending && <Loader2 className="size-4 animate-spin" />}
        إنهاء {invoiceNow ? "وإصدار الفاتورة" : "بلا فاتورة"}
      </Button>
    </div>
  );
}

// ==================== لوحة الإلغاء بسبب (د8) ====================

function CancelPanel({
  orderId,
  onDone,
  onErr,
  pending,
  submit,
}: {
  orderId: number;
  onDone: () => void;
  onErr: (e: unknown, title: string) => void;
  pending: boolean;
  submit: (reason: string) => void;
}) {
  void onDone;
  void onErr;
  void orderId;
  const [reason, setReason] = React.useState("");
  return (
    <div className="grid gap-3 rounded-md border border-destructive/30 p-3">
      <p className="text-xs font-semibold text-destructive">إلغاء الأمر بسبب — ذو مستندات يرفض (ألغِها من شاشتيها أولًا — د8)</p>
      <div className="grid gap-1.5">
        <Label>سبب الإلغاء *</Label>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <Button
        size="sm"
        variant="destructive"
        disabled={pending}
        onClick={() => reason.trim() && submit(reason.trim())}
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        تأكيد الإلغاء
      </Button>
    </div>
  );
}
