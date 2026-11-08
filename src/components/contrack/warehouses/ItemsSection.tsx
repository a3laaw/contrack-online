"use client";

/**
 * ItemsSection.tsx — قسم «الأصناف والمستودعات» لموديول المخازن (§7):
 * بطاقتان — المستودعات والأصناف — بيانات أساسية بحذف ممنوع لمن له حركة (التعطيل هو البديل).
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Package, Plus, Power, PowerOff, Pencil, Trash2, Warehouse } from "lucide-react";

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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "../api";
import { cn } from "@/lib/utils";
import type { StockItemRow, WarehouseRow } from "../WarehousesView";

interface Props {
  onAuthError: () => void;
}

const ACTIVE_TONE = { text: "text-status-done", bg: "bg-status-done-bg" };
const INACTIVE_TONE = { text: "text-muted-foreground", bg: "bg-muted" };

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("px-3 py-2 text-start text-[11px] font-semibold text-muted-foreground", className)}>{children}</th>;
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2 text-[13px]", className)}>{children}</td>;
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <Badge className={cn("h-5 px-1.5 text-[10px]", active ? ACTIVE_TONE.bg : INACTIVE_TONE.bg, active ? ACTIVE_TONE.text : INACTIVE_TONE.text)}>
      {active ? "نشط" : "موقوف"}
    </Badge>
  );
}

function EmptyState({ icon: Icon, title, hint }: { icon: React.ComponentType<{ className?: string }>; title: string; hint: string }) {
  return (
    <div className="py-8 text-center">
      <Icon className="mx-auto size-8 text-muted-foreground/50" />
      <p className="mt-2 text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

// ==================== القسم ====================

export function ItemsSection({ onAuthError }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const onErr = React.useCallback(
    (e: unknown, title: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title, description: (e as { message?: string })?.message || "خطأ غير متوقع" });
    },
    [onAuthError, toast]
  );

  const warehousesQuery = useQuery<{ warehouses: WarehouseRow[] }>({
    queryKey: ["warehouses", "warehouses"],
    queryFn: () => apiGet<{ warehouses: WarehouseRow[] }>("/api/warehouses/warehouses"),
  });
  const itemsQuery = useQuery<{ items: StockItemRow[] }>({
    queryKey: ["warehouses", "items"],
    queryFn: () => apiGet<{ items: StockItemRow[] }>("/api/warehouses/items"),
  });

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["warehouses"] });
  }, [qc]);

  // ===== المستودعات =====
  const [whDialog, setWhDialog] = React.useState<{ mode: "new" | "edit"; row?: WarehouseRow } | null>(null);
  const whMutation = useMutation({
    mutationFn: (v: { mode: "new" | "edit"; id?: number; name: string; location: string; notes: string; active?: boolean }) =>
      v.mode === "new"
        ? apiPost("/api/warehouses/warehouses", { name: v.name, location: v.location, notes: v.notes })
        : apiPatch(`/api/warehouses/warehouses/${v.id}`, { name: v.name, location: v.location, notes: v.notes, active: v.active }),
    onSuccess: (_r, v) => {
      setWhDialog(null);
      invalidate();
      toast({ title: v.mode === "new" ? "أُنشئ المستودع" : "حُفظ تعديل المستودع" });
    },
    onError: (e) => onErr(e, "تعذر حفظ المستودع"),
  });
  const whDelete = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/warehouses/warehouses/${id}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "حُذف المستودع" });
    },
    onError: (e) => onErr(e, "تعذر الحذف"),
  });

  // ===== الأصناف =====
  const [itemDialog, setItemDialog] = React.useState<{ mode: "new" | "edit"; row?: StockItemRow } | null>(null);
  const itemMutation = useMutation({
    mutationFn: (
      v: { mode: "new" | "edit"; id?: number; name: string; unit: string; category: string; minQty: number; notes: string; active?: boolean }
    ) =>
      v.mode === "new"
        ? apiPost("/api/warehouses/items", { name: v.name, unit: v.unit, category: v.category, minQty: v.minQty, notes: v.notes })
        : apiPatch(`/api/warehouses/items/${v.id}`, {
            name: v.name,
            unit: v.unit,
            category: v.category,
            minQty: v.minQty,
            notes: v.notes,
            active: v.active,
          }),
    onSuccess: (_r, v) => {
      setItemDialog(null);
      invalidate();
      toast({ title: v.mode === "new" ? "أُنشئ الصنف" : "حُفظ تعديل الصنف" });
    },
    onError: (e) => onErr(e, "تعذر حفظ الصنف"),
  });
  const itemDelete = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/warehouses/items/${id}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "حُذف الصنف" });
    },
    onError: (e) => onErr(e, "تعذر الحذف"),
  });

  const warehouses = warehousesQuery.data?.warehouses ?? [];
  const items = itemsQuery.data?.items ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* المستودعات */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Warehouse className="size-4 text-primary/70" />
            المستودعات
          </h2>
          <Button size="sm" className="h-8 gap-1" onClick={() => setWhDialog({ mode: "new" })}>
            <Plus className="size-3.5" />
            مستودع جديد
          </Button>
        </div>
        {warehousesQuery.isLoading ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="mb-2 h-9 w-full" />)
        ) : warehouses.length === 0 ? (
          <EmptyState icon={Warehouse} title="لا مستودعات بعد" hint="أضف أول مستودع لتبدأ أذون الحركة" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px]">
              <thead>
                <tr className="border-b">
                  <Th>الاسم</Th>
                  <Th>الموقع</Th>
                  <Th>أذون</Th>
                  <Th>الحالة</Th>
                  <Th className="w-20">إجراءات</Th>
                </tr>
              </thead>
              <tbody>
                {warehouses.map((w) => (
                  <tr key={w.id} className="border-b last:border-0 hover:bg-muted/40">
                    <Td className="font-medium">{w.name}</Td>
                    <Td className="text-muted-foreground">{w.location || "—"}</Td>
                    <Td className="tabular-nums">{w.docCount}</Td>
                    <Td>
                      <StatusPill active={w.active} />
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => setWhDialog({ mode: "edit", row: w })} aria-label="تعديل">
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-status-danger"
                          onClick={() => whDelete.mutate(w.id)}
                          disabled={whDelete.isPending}
                          aria-label="حذف"
                        >
                          {whDelete.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* الأصناف */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Package className="size-4 text-primary/70" />
            الأصناف
          </h2>
          <Button size="sm" className="h-8 gap-1" onClick={() => setItemDialog({ mode: "new" })}>
            <Plus className="size-3.5" />
            صنف جديد
          </Button>
        </div>
        {itemsQuery.isLoading ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="mb-2 h-9 w-full" />)
        ) : items.length === 0 ? (
          <EmptyState icon={Package} title="لا أصناف بعد" hint="أضف أصناف المواد التي تتعامل بها" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead>
                <tr className="border-b">
                  <Th>الصنف</Th>
                  <Th>الوحدة</Th>
                  <Th>الفئة</Th>
                  <Th>الحد الأدنى</Th>
                  <Th>حركة</Th>
                  <Th>الحالة</Th>
                  <Th className="w-20">إجراءات</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b last:border-0 hover:bg-muted/40">
                    <Td className="font-medium">{it.name}</Td>
                    <Td className="text-muted-foreground">{it.unit || "—"}</Td>
                    <Td className="text-muted-foreground">{it.category || "—"}</Td>
                    <Td className="tabular-nums">{it.minQty > 0 ? it.minQty : "—"}</Td>
                    <Td className="tabular-nums">{it.lineCount}</Td>
                    <Td>
                      <StatusPill active={it.active} />
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => setItemDialog({ mode: "edit", row: it })} aria-label="تعديل">
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-status-danger"
                          onClick={() => itemDelete.mutate(it.id)}
                          disabled={itemDelete.isPending}
                          aria-label="حذف"
                        >
                          {itemDelete.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* حوار المستودع */}
      <WhDialog
        state={whDialog}
        pending={whMutation.isPending}
        onClose={() => setWhDialog(null)}
        onSubmit={(v) => whMutation.mutate(v)}
      />
      {/* حوار الصنف */}
      <ItemDialog
        state={itemDialog}
        pending={itemMutation.isPending}
        onClose={() => setItemDialog(null)}
        onSubmit={(v) => itemMutation.mutate(v)}
      />
    </div>
  );
}

// ==================== حوارات البيانات الأساسية ====================

function WhDialog({
  state,
  pending,
  onClose,
  onSubmit,
}: {
  state: { mode: "new" | "edit"; row?: WarehouseRow } | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (v: { mode: "new" | "edit"; id?: number; name: string; location: string; notes: string; active?: boolean }) => void;
}) {
  const [name, setName] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [active, setActive] = React.useState(true);
  React.useEffect(() => {
    if (state) {
      setName(state.row?.name ?? "");
      setLocation(state.row?.location ?? "");
      setNotes(state.row?.notes ?? "");
      setActive(state.row ? state.row.active : true);
    }
  }, [state]);
  if (!state) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{state.mode === "new" ? "مستودع جديد" : `تعديل المستودع: ${state.row?.name}`}</DialogTitle>
          <DialogDescription>اسم المستودع فريد — ذو الأذون لا يُحذف بل يوقف</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="wh-name">الاسم *</Label>
            <Input id="wh-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="مستودع المشروعات" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-loc">الموقع</Label>
            <Input id="wh-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="المنطقة الصناعية — الشبدانية" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-notes">ملاحظات</Label>
            <Input id="wh-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {state.mode === "edit" && (
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="flex items-center gap-2 text-sm">
                {active ? <Power className="size-4 text-status-done" /> : <PowerOff className="size-4 text-muted-foreground" />}
                <span>{active ? "نشط — يقبل أذون جديدة" : "موقوف — بلا أذون جديدة"}</span>
              </div>
              <Switch checked={active} onCheckedChange={setActive} aria-label="تفعيل المستودع" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            onClick={() => onSubmit({ mode: state.mode, id: state.row?.id, name: name.trim(), location: location.trim(), notes: notes.trim(), active })}
            disabled={pending || !name.trim()}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ItemDialog({
  state,
  pending,
  onClose,
  onSubmit,
}: {
  state: { mode: "new" | "edit"; row?: StockItemRow } | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (v: { mode: "new" | "edit"; id?: number; name: string; unit: string; category: string; minQty: number; notes: string; active?: boolean }) => void;
}) {
  const [name, setName] = React.useState("");
  const [unit, setUnit] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [minQty, setMinQty] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [active, setActive] = React.useState(true);
  React.useEffect(() => {
    if (state) {
      setName(state.row?.name ?? "");
      setUnit(state.row?.unit ?? "");
      setCategory(state.row?.category ?? "");
      setMinQty(state.row && state.row.minQty > 0 ? String(state.row.minQty) : "");
      setNotes(state.row?.notes ?? "");
      setActive(state.row ? state.row.active : true);
    }
  }, [state]);
  if (!state) return null;
  const minQtyNum = Number(minQty) || 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{state.mode === "new" ? "صنف جديد" : `تعديل الصنف: ${state.row?.name}`}</DialogTitle>
          <DialogDescription>الوحدة نص للعرض (كيس/م/كجم…) — ذو الحركة لا يُحذف بل يوقف</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="it-name">الاسم *</Label>
            <Input id="it-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="إسمنت بورتلاندي" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="it-unit">الوحدة</Label>
              <Input id="it-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="كيس" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="it-cat">الفئة</Label>
              <Input id="it-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="مواد بناء" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="it-min">الحد الأدنى للتنبيه</Label>
            <Input id="it-min" type="number" min="0" step="0.001" value={minQty} onChange={(e) => setMinQty(e.target.value)} placeholder="0 = بلا تنبيه" />
            <p className="text-[11px] text-muted-foreground">شارة تحذير عرض فقط عند نزول الرصيد إلى هذا الحد أو تحته</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="it-notes">ملاحظات</Label>
            <Input id="it-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {state.mode === "edit" && (
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="flex items-center gap-2 text-sm">
                {active ? <Power className="size-4 text-status-done" /> : <PowerOff className="size-4 text-muted-foreground" />}
                <span>{active ? "نشط — يقبل الحركة" : "موقوف — بلا حركة جديدة"}</span>
              </div>
              <Switch checked={active} onCheckedChange={setActive} aria-label="تفعيل الصنف" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            onClick={() => onSubmit({ mode: state.mode, id: state.row?.id, name: name.trim(), unit: unit.trim(), category: category.trim(), minQty: minQtyNum, notes: notes.trim(), active })}
            disabled={pending || !name.trim() || minQtyNum < 0}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
