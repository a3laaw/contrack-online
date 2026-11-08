"use client";

/**
 * PosSection.tsx — قسم «نقاط البيع» (docs/sales-design.md §6 — د3):
 * شاشة بيع سريع واحدة: مستودع البيع + عميل (افتراضي «نقدي») + شبكة أسطر
 * (بحث صنف يملأ الوحدة والتكلفة / سطر حر) + خصم% للسطر + وسيلة دفع فورية
 * ⇒ «إتمام البيع» بمعاملة واحدة: فاتورة + سند قبض آلي + إذن صرف مخزني آلي.
 * التكلفة (المتوسط المرجحي) ظاهرة مع تحذير بيع تحت التكلفة — توست غير مانع (د9).
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgePlus, Printer, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPost } from "../api";
import { SearchableSelect } from "../SearchableSelect";
import { errMessage } from "../contrack-types";
import { formatKWD } from "@/lib/format";
import { POS_PAY_METHODS, POS_PAY_METHOD_LABELS, POS_STATUS_LABELS, fmtQty } from "@/lib/sales-constants";
import { cleanPosLines, posLineTotal } from "@/lib/sales-core";
import type { CustomersResponse } from "../contrack-types";

interface PosSectionProps {
  onAuthError: () => void;
  onOpenQuotes: () => void;
}

interface PosCatalogItem {
  id: number;
  name: string;
  unit: string;
  category: string;
  qty: number;
  wac: number;
}

interface PosCatalogResponse {
  warehouses: { id: number; name: string; location: string }[];
  defaultWarehouseId: number;
  items: PosCatalogItem[];
  cashCustomerId: number | null;
  cashCustomerName: string;
  todayDate: string;
  todaySales: {
    count: number;
    total: number;
    invoices: {
      id: number;
      invoiceNumber: string;
      customerName: string;
      total: number;
      paidAmount: number;
      status: string;
      saleDocNumbers: string[];
    }[];
  };
}

interface PosSaleResult {
  invoiceId: number;
  invoiceNumber: string;
  total: number;
  voucherNumber: string | null;
  issueDocNumber: string | null;
  underCost: { name: string; price: number; wac: number }[];
}

interface PosLine {
  key: number;
  itemId: number | null;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  wac: number;
  qtyAvail: number;
}

let lineKeySeq = 1;
const newKey = () => lineKeySeq++;

export function PosSection({ onAuthError, onOpenQuotes }: PosSectionProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [warehouseId, setWarehouseId] = React.useState<number>(0);
  const [customerId, setCustomerId] = React.useState<string>("");
  const [payNow, setPayNow] = React.useState(true);
  const [payMethod, setPayMethod] = React.useState<string>(POS_PAY_METHODS[0]);
  const [notes, setNotes] = React.useState("");
  const [lines, setLines] = React.useState<PosLine[]>([]);
  const [lastSale, setLastSale] = React.useState<PosSaleResult | null>(null);

  const catalogQuery = useQuery<PosCatalogResponse>({
    queryKey: ["sales", "pos", warehouseId],
    queryFn: () =>
      apiGet<PosCatalogResponse>(`/api/sales/pos?warehouseId=${warehouseId}&date=${new Date().toISOString().slice(0, 10)}`),
  });

  // أول تحميل: ثبّت المستودع الافتراضي والعميل النقدي
  React.useEffect(() => {
    const d = catalogQuery.data;
    if (!d) return;
    if (!warehouseId && d.defaultWarehouseId) setWarehouseId(d.defaultWarehouseId);
    if (!customerId && d.cashCustomerId) setCustomerId(String(d.cashCustomerId));
  }, [catalogQuery.data, warehouseId, customerId]);

  const customersQuery = useQuery<CustomersResponse>({
    queryKey: ["customers", ""],
    queryFn: () => apiGet<CustomersResponse>("/api/customers?q="),
  });
  const customers = customersQuery.data?.customers ?? [];
  const isCashCustomer =
    customerId === String(catalogQuery.data?.cashCustomerId ?? -1) || (!customerId && !!catalogQuery.data?.cashCustomerId);

  const handleError = React.useCallback(
    (e: unknown, fallback: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "خطأ", description: errMessage(e) || fallback });
    },
    [onAuthError, toast]
  );

  const items = catalogQuery.data?.items ?? [];
  const itemById = React.useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // ===== الأسطر =====
  const addItemLine = (itemIdStr: string) => {
    const it = itemById.get(Number(itemIdStr));
    if (!it) return;
    setLines((prev) => [
      ...prev,
      {
        key: newKey(),
        itemId: it.id,
        description: it.name,
        unit: it.unit,
        quantity: "1",
        unitPrice: it.wac ? String(it.wac) : "",
        discountPct: "0",
        wac: it.wac,
        qtyAvail: it.qty,
      },
    ]);
  };

  const addFreeLine = () => {
    setLines((prev) => [
      ...prev,
      { key: newKey(), itemId: null, description: "", unit: "", quantity: "1", unitPrice: "", discountPct: "0", wac: 0, qtyAvail: 0 },
    ]);
  };

  const patchLine = (key: number, patch: Partial<PosLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (key: number) => setLines((prev) => prev.filter((l) => l.key !== key));

  const saleLines = React.useMemo(
    () =>
      cleanPosLines(
        lines.map((l) => ({
          itemId: l.itemId ?? undefined,
          description: l.description,
          quantity: Number(l.quantity) || 0,
          unitPrice: Number(l.unitPrice) || 0,
          discountPct: Number(l.discountPct) || 0,
          itemName: l.itemId ? itemById.get(l.itemId)?.name : undefined,
        }))
      ),
    [lines, itemById]
  );
  const total = React.useMemo(
    () => saleLines.reduce((s, l) => s + posLineTotal(l.quantity, l.unitPrice, l.discountPct), 0),
    [saleLines]
  );

  const sellMutation = useMutation({
    mutationFn: () =>
      apiPost<PosSaleResult>("/api/sales/pos", {
        warehouseId,
        customerId: customerId ? Number(customerId) : null,
        payNow,
        payMethod,
        payAccount: "",
        notes,
        lines: lines.map((l) => ({
          ...(l.itemId ? { itemId: l.itemId } : {}),
          description: l.description,
          quantity: Number(l.quantity) || 0,
          unitPrice: Number(l.unitPrice) || 0,
          discountPct: Number(l.discountPct) || 0,
        })),
      }),
    onSuccess: (res) => {
      // تحذير البيع تحت التكلفة — غير مانع (د9) يظهر مع نجاح البيع
      if (res.underCost && res.underCost.length > 0) {
        toast({
          title: "تنبيه: بيع تحت التكلفة",
          description: `${res.underCost.map((u) => `${u.name} (${u.price} < ${u.wac})`).join(" · ")}`,
        });
      }
      const parts = [`الفاتورة ${res.invoiceNumber}`];
      if (res.voucherNumber) parts.push(`سند القبض ${res.voucherNumber}`);
      if (res.issueDocNumber) parts.push(`إذن الصرف ${res.issueDocNumber}`);
      toast({ title: `تم إتمام البيع ✅ — ${formatKWD(res.total)}`, description: parts.join(" · ") });
      setLastSale(res);
      setLines([]);
      setNotes("");
      qc.invalidateQueries({ queryKey: ["sales", "pos"] });
    },
    onError: (e) => handleError(e, "تعذر إتمام البيع"),
  });

  const onSubmit = () => {
    if (!warehouseId) {
      toast({ variant: "destructive", title: "خطأ", description: "مستودع البيع مطلوب — أضف مستودعًا من المخازن أولًا" });
      return;
    }
    if (saleLines.length === 0) {
      toast({ variant: "destructive", title: "خطأ", description: "أضف بندًا واحدًا على الأقل للبيع" });
      return;
    }
    if (!payNow && isCashCustomer) {
      toast({
        variant: "destructive",
        title: "خطأ",
        description: "البيع الآجل يتطلب عميلًا مسمّى — العميل النقدي (نقاط البيع) يُقبض فورًا",
      });
      return;
    }
    sellMutation.mutate();
  };

  const today = catalogQuery.data?.todaySales;

  return (
    <div className="space-y-4">
      {/* شريط مبيعات اليوم */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-xs text-muted-foreground">مبيعات اليوم ({catalogQuery.data?.todayDate ?? ""})</p>
            {catalogQuery.isLoading ? (
              <Skeleton className="mt-1 h-6 w-32" />
            ) : (
              <p className="text-base font-bold tabular-nums sm:text-lg">
                {formatKWD(today?.total ?? 0)} <span className="text-xs font-normal text-muted-foreground">د.ك</span>
                <span className="ms-2 text-xs font-normal text-muted-foreground">
                  ({today?.count ?? 0} فاتورة)
                </span>
              </p>
            )}
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-1.5 overflow-hidden">
            {(today?.invoices ?? []).slice(0, 4).map((inv) => (
              <span
                key={inv.id}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]"
                title={`${inv.customerName} — ${POS_STATUS_LABELS[inv.status] ?? inv.status}`}
              >
                <span dir="ltr">{inv.invoiceNumber}</span>
                <span className="tabular-nums text-muted-foreground" dir="ltr">
                  {formatKWD(inv.total)}
                </span>
                {inv.status === "void" && <span className="text-status-danger">ملغاة</span>}
              </span>
            ))}
            {(today?.invoices.length ?? 0) === 0 && !catalogQuery.isLoading && (
              <span className="text-xs text-muted-foreground">
                لا مبيعات اليوم بعد —{" "}
                <button type="button" className="font-medium text-primary underline" onClick={onOpenQuotes}>
                  أو جهّز عرض سعر
                </button>
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* الأسطر */}
        <Card className="lg:col-span-2">
          <CardContent className="space-y-3 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>مستودع البيع</Label>
                <Select
                  value={warehouseId ? String(warehouseId) : undefined}
                  onValueChange={(v) => setWarehouseId(Number(v))}
                >
                  <SelectTrigger aria-label="مستودع البيع">
                    <SelectValue placeholder="اختر المستودع" />
                  </SelectTrigger>
                  <SelectContent>
                    {(catalogQuery.data?.warehouses ?? []).map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>العميل (الافتراضي: نقدي)</Label>
                <SearchableSelect
                  value={customerId}
                  onValueChange={setCustomerId}
                  options={[
                    ...(catalogQuery.data?.cashCustomerId
                      ? [
                          {
                            value: String(catalogQuery.data.cashCustomerId),
                            label: catalogQuery.data.cashCustomerName || "عميل نقدي — نقاط البيع",
                          },
                        ]
                      : []),
                    ...customers
                      .filter((c) => String(c.id) !== String(catalogQuery.data?.cashCustomerId ?? ""))
                      .map((c) => ({ value: String(c.id), label: c.name })),
                  ]}
                  placeholder="عميل نقدي — نقاط البيع"
                  searchPlaceholder="ابحث بالاسم…"
                  emptyText="لا نتائج مطابقة"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-44 flex-1">
                <SearchableSelect
                  value="add-item"
                  onValueChange={(v) => {
                    if (v !== "add-item") addItemLine(v);
                  }}
                  options={[
                    { value: "add-item", label: "＋ أضف صنفًا من المخازن…" },
                    ...items
                      .filter((it) => !lines.some((l) => l.itemId === it.id))
                      .map((it) => ({
                        value: String(it.id),
                        label: `${it.name}${it.unit ? ` (${it.unit})` : ""}${it.qty > 0 ? ` — متاح ${fmtQty(it.qty)}` : ""}`,
                      })),
                  ]}
                  placeholder="ابحث عن صنف بالاسم…"
                  searchPlaceholder="ابحث بالاسم…"
                  emptyText="لا أصناف مطابقة — أضف الأصناف من شاشة المخازن"
                />
              </div>
              <Button variant="outline" className="h-9 gap-1.5" onClick={addFreeLine} type="button">
                <BadgePlus className="size-4" />
                سطر حر
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-9"
                onClick={() => catalogQuery.refetch()}
                aria-label="تحديث الكتالوج"
                type="button"
              >
                <RefreshCw className={`size-4 ${catalogQuery.isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>

            {/* شبكة الأسطر — مكدسة على الموبايل */}
            <div className="space-y-2">
              {lines.length === 0 && (
                <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                  لا أسطر بعد — ابحث عن صنف بالأعلى أو أضف سطرًا حرًا
                </p>
              )}
              {lines.map((l) => {
                const q = Number(l.quantity) || 0;
                const p = Number(l.unitPrice) || 0;
                const d = Number(l.discountPct) || 0;
                const lineTotal = posLineTotal(q, p, d);
                const underCost = l.itemId && l.wac > 0 && p < l.wac - 0.001;
                return (
                  <div key={l.key} className="rounded-lg border p-2.5">
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-36 flex-1 space-y-1">
                        <Input
                          className="h-9"
                          placeholder={l.itemId ? "الوصف" : "وصف السطر الحر *"}
                          value={l.description}
                          onChange={(e) => patchLine(l.key, { description: e.target.value })}
                          aria-label="وصف السطر"
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
                          value={l.quantity}
                          onChange={(e) => patchLine(l.key, { quantity: e.target.value })}
                          aria-label="الكمية"
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
                          value={l.unitPrice}
                          onChange={(e) => patchLine(l.key, { unitPrice: e.target.value })}
                          aria-label="سعر الوحدة"
                        />
                      </div>
                      <div className="w-20 space-y-1">
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          className="h-9"
                          placeholder="خصم%"
                          dir="ltr"
                          value={l.discountPct}
                          onChange={(e) => patchLine(l.key, { discountPct: e.target.value })}
                          aria-label="نسبة الخصم"
                        />
                      </div>
                      <div className="w-24 pb-1 text-center text-sm font-medium tabular-nums" dir="ltr">
                        {formatKWD(lineTotal)}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9 text-destructive hover:text-destructive"
                        onClick={() => removeLine(l.key)}
                        aria-label="إزالة السطر"
                        type="button"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    {l.itemId && (
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        {`متاح: ${fmtQty(l.qtyAvail)}${l.unit ? ` ${l.unit}` : ""} · التكلفة (المتوسط المرجحي): ${formatKWD(l.wac)}`}
                        {underCost && <span className="ms-2 font-medium text-status-warn">تحت التكلفة!</span>}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-sm text-muted-foreground">الإجمالي</span>
              <span className="text-lg font-bold tabular-nums" dir="ltr">
                {formatKWD(total)} د.ك
              </span>
            </div>
          </CardContent>
        </Card>

        {/* الدفع */}
        <Card className="h-fit">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <Label className="text-sm">سداد فوري</Label>
                <p className="text-[11px] text-muted-foreground">سند قبض آلي يخصص FIFO على الفاتورة</p>
              </div>
              <Switch checked={payNow} onCheckedChange={setPayNow} aria-label="سداد فوري" />
            </div>

            <div className="space-y-1.5">
              <Label>وسيلة الدفع</Label>
              <Select value={payMethod} onValueChange={setPayMethod} disabled={!payNow}>
                <SelectTrigger aria-label="وسيلة الدفع">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POS_PAY_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {POS_PAY_METHOD_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!payNow && (
                <p className="text-[11px] text-status-warn">
                  بيع آجل — يتطلب عميلًا مسمّى (النقدي يُقبض فورًا)، ويُسدد لاحقًا من شاشة الفواتير
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>ملاحظة</Label>
              <Input
                className="h-9"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="اختياري"
                aria-label="ملاحظة البيع"
              />
            </div>

            <Button
              className="h-11 w-full gap-1.5 text-base"
              onClick={onSubmit}
              disabled={sellMutation.isPending}
            >
              {sellMutation.isPending ? "جارٍ إتمام البيع…" : `إتمام البيع — ${formatKWD(total)} د.ك`}
            </Button>

            {lastSale && (
              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">آخر بيع</p>
                <p className="text-sm font-medium" dir="ltr">
                  {lastSale.invoiceNumber} · {formatKWD(lastSale.total)}
                </p>
                <p className="text-[11px] text-muted-foreground" dir="ltr">
                  {lastSale.voucherNumber ? `سند ${lastSale.voucherNumber}` : "بيع آجل بلا سند"}
                  {lastSale.issueDocNumber ? ` · إذن صرف ${lastSale.issueDocNumber}` : ""}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-full gap-1.5"
                  onClick={() => window.open(`/api/invoices/${lastSale.invoiceId}/pdf`, "_blank")}
                  type="button"
                >
                  <Printer className="size-3.5" />
                  طباعة الإيصال
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
