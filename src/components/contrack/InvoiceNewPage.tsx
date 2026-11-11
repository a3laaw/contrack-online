"use client";

/**
 * «فاتورة جديدة» — صفحة كاملة (بدل النافذة السابقة) — Task 107:
 * العميل إجباري والعقد اختياري (بدون عقد = فاتورة خدمات مباشرة)، محرر بنود
 * (وصف/كمية/سعر/خصم%) بإجماليات حية محصلة على الرأس، تاريخ/استحقاق، ملاحظات.
 * الإصدار ينشر قيدًا آليًا (مدين ذمم العملاء / دائن إيراد العقود) داخل معاملة واحدة.
 * تُعرض مكان شاشة الفواتير (بلا مسار جديد)، والشريط السفلي sticky.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, ScrollText, Trash2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPost } from "./api";
import { SearchableSelect } from "./SearchableSelect";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ContractDetailResponse,
  CustomerDetailResponse,
  CustomersResponse,
  InvoicesResponse,
} from "./contrack-types";
import { errMessage } from "./contrack-types";
import { formatKWD, round3 } from "@/lib/format";

interface InvoiceNewPageProps {
  onAuthError: () => void;
  /** عميل محدد مسبقًا من فلتر الشاشة */
  presetCustomerId?: string | null;
  /** بعد الإصدار الناجح — تُغلق الصفحة من الشاشة المستدعية */
  onSaved?: () => void;
  /** العودة لقائمة الفواتير */
  onCancel: () => void;
}

interface DraftItem {
  description: string;
  quantity: string;
  unitPrice: string;
  discountPct: string;
}

const EMPTY_ITEM: DraftItem = { description: "", quantity: "1", unitPrice: "", discountPct: "0" };

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const num = (s: string): number => {
  const n = Number(String(s).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

const r3 = (n: number): number => round3(n);

export function InvoiceNewPage({ onAuthError, presetCustomerId, onSaved, onCancel }: InvoiceNewPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // ===== الرأس =====
  const [nCustomerId, setNCustomerId] = React.useState(presetCustomerId ?? "none");
  const [nContractId, setNContractId] = React.useState("none"); // none = بدون عقد
  const [nDate, setNDate] = React.useState(todayStr());
  const [nDueDate, setNDueDate] = React.useState("");
  const [nDescription, setNDescription] = React.useState("");
  const [nNotes, setNNotes] = React.useState("");
  const [newError, setNewError] = React.useState("");

  // ===== البنود =====
  const [items, setItems] = React.useState<DraftItem[]>([{ ...EMPTY_ITEM, description: "" }]);

  const totals = React.useMemo(() => {
    let subtotal = 0;
    let total = 0;
    for (const it of items) {
      const q = num(it.quantity);
      const p = num(it.unitPrice);
      const d = Math.min(100, Math.max(0, num(it.discountPct)));
      const gross = r3(q * p);
      subtotal = r3(subtotal + gross);
      total = r3(total + r3(gross * (1 - d / 100)));
    }
    return { subtotal, discountTotal: r3(subtotal - total), total };
  }, [items]);

  const customersQuery = useQuery<CustomersResponse>({
    queryKey: ["customers", ""],
    queryFn: () => apiGet<CustomersResponse>("/api/customers"),
  });
  const nCustomers = (customersQuery.data?.customers ?? []).map((c) => ({ id: c.id, name: c.name }));

  const nCustomerIdNum = nCustomerId !== "none" ? Number(nCustomerId) : null;
  const custContractsQuery = useQuery<CustomerDetailResponse>({
    queryKey: ["customer", nCustomerIdNum],
    queryFn: () => apiGet<CustomerDetailResponse>(`/api/customers/${nCustomerIdNum}`),
    enabled: nCustomerIdNum !== null,
  });
  const nContracts = (custContractsQuery.data?.contracts ?? []).filter((c) => c.status !== "ملغى");

  const nContractIdNum = nContractId !== "none" ? Number(nContractId) : null;
  const contractDetailQuery = useQuery<ContractDetailResponse>({
    queryKey: ["contract", nContractIdNum],
    queryFn: () => apiGet<ContractDetailResponse>(`/api/contracts/${nContractIdNum}`),
    enabled: nContractIdNum !== null,
    retry: false,
  });
  const nCurrent = contractDetailQuery.data ? Number(contractDetailQuery.data.current || 0) : null;
  // المرحلة (أ) — الدفعة المقدمة على العقد (للاسترداد التقديري)
  const nAdvance = contractDetailQuery.data?.contract?.advanceAmount ?? 0;
  const nAdvancePct = contractDetailQuery.data?.contract?.advanceRecoveryPct ?? 0;

  // المفوتر سابقًا على هذا العقد (لغير الملغاة) — تنبيه السقف قبل الرفض الخادمي
  const contractInvoicesQuery = useQuery<InvoicesResponse>({
    queryKey: ["invoices", nContractIdNum ? `contractId=${nContractIdNum}` : "__none__"],
    queryFn: () => apiGet<InvoicesResponse>(`/api/invoices?contractId=${nContractIdNum}`),
    enabled: nContractIdNum !== null,
  });
  const nInvoiced = round3(
    (contractInvoicesQuery.data?.invoices ?? [])
      .filter((i) => i.status !== "void")
      .reduce((s, i) => s + i.total, 0)
  );
  const nRemaining = nCurrent !== null ? round3(nCurrent - nInvoiced) : null;
  const nExceeds = nRemaining !== null && totals.total > nRemaining + 0.001;

  // ===== المرحلة (أ) — المحتجزات والدفعة المقدمة (docs/retention-subipc-advance-design.md §5.1)
  const [nRetentionRate, setNRetentionRate] = React.useState("0");
  const retentionRateNum = Math.min(25, Math.max(0, num(nRetentionRate)));
  const retentionAmount = round3((totals.total * retentionRateNum) / 100);
  const advanceRecoveryEstimate = round3(Math.min((totals.total * nAdvancePct) / 100, nAdvance));
  const netDue = round3(totals.total - retentionAmount);

  // ===== الإصدار — ينشر القيد الآلي داخل المعاملة =====
  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPost<{ invoice?: { invoiceNumber?: string; entryNo?: number } }>("/api/invoices", body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["contract"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onSaved?.();
      toast({
        title: "صدرت الفاتورة",
        description: `${res.invoice?.invoiceNumber ?? ""} — قيد آلي #${res.invoice?.entryNo ?? ""} (مدين ذمم / دائن إيراد)`,
      });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      setNewError(errMessage(e));
      toast({ variant: "destructive", title: "رُفضت الفاتورة", description: errMessage(e) });
    },
  });

  const updateItem = (idx: number, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const submitNew = () => {
    if (nCustomerId === "none") {
      toast({ variant: "destructive", title: "اختر العميل" });
      return;
    }
    if (!nDate) {
      toast({ variant: "destructive", title: "حدد تاريخ الفاتورة" });
      return;
    }
    const clean = items.filter((it) => it.description.trim() && num(it.quantity) > 0 && num(it.unitPrice) > 0);
    if (clean.length === 0) {
      toast({ variant: "destructive", title: "أضف بندًا واحدًا على الأقل (وصف + كمية + سعر)" });
      return;
    }
    if (!(totals.total > 0)) {
      toast({ variant: "destructive", title: "صافي الفاتورة يجب أن يكون أكبر من صفر" });
      return;
    }
    setNewError("");
    createMutation.mutate({
      customerId: Number(nCustomerId),
      contractId: nContractIdNum ?? undefined,
      invoiceDate: nDate,
      dueDate: nDueDate || undefined,
      description: nDescription.trim() || undefined,
      notes: nNotes.trim() || undefined,
      retentionRate: nContractIdNum !== null ? retentionRateNum : undefined,
      items: clean.map((it) => ({
        description: it.description.trim(),
        quantity: num(it.quantity),
        unitPrice: num(it.unitPrice),
        discountPct: num(it.discountPct),
      })),
    });
  };

  return (
    <div className="space-y-4">
      {/* ===== رأس الصفحة ===== */}
      <div>
        <p className="text-xs text-muted-foreground">المحاسبة ← الفواتير</p>
        <h1 className="text-xl font-bold">فاتورة جديدة</h1>
        <p className="text-sm text-muted-foreground">
          العميل إجباري والعقد اختياري — الإصدار ينشر قيدًا آليًا متوازنًا: مدين ذمم العملاء (1121) / دائن إيراد العقود (4100).
        </p>
      </div>

      {/* ===== رأس الفاتورة ===== */}
      <Card>
        <CardContent className="p-4 md:p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">العميل *</Label>
              <SearchableSelect
                value={nCustomerId}
                onValueChange={(v) => {
                  setNCustomerId(v);
                  setNContractId("none");
                }}
                options={nCustomers.map((c) => ({ value: String(c.id), label: c.name }))}
                placeholder="اختر العميل"
                searchPlaceholder="ابحث بالاسم…"
                emptyText="لا نتائج مطابقة"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">العقد (اختياري)</Label>
              <Select
                value={nContractId}
                onValueChange={setNContractId}
                disabled={nCustomerId === "none"}
              >
                <SelectTrigger className="h-9">
                  <SelectValue
                    placeholder={nCustomerId === "none" ? "اختر عميلًا أولًا" : "بدون عقد / اختر العقد"}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون عقد</SelectItem>
                  {nContracts.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.contractNumber} — {c.contractName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">تاريخ الفاتورة *</Label>
              <Input type="date" className="h-9" value={nDate} onChange={(e) => setNDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">تاريخ الاستحقاق</Label>
              <Input type="date" className="h-9" value={nDueDate} onChange={(e) => setNDueDate(e.target.value)} />
            </div>
            <div className="space-y-1.5 md:col-span-1 lg:col-span-2">
              <Label className="text-xs">وصف عام</Label>
              <Input
                className="h-9"
                placeholder="مثال: المستخلص رقم 2 — أعمال الحفر"
                value={nDescription}
                onChange={(e) => setNDescription(e.target.value)}
              />
            </div>

            {/* بطاقة السقف — عند الربط بعقد */}
            {nContractIdNum !== null && (
              <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-center text-xs md:col-span-2 lg:col-span-3">
                <div>
                  <div className="text-muted-foreground">القيمة الحالية</div>
                  <div className="font-mono font-bold tabular-nums" dir="ltr">
                    {nCurrent !== null ? formatKWD(nCurrent) : "…"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">المفوتر سابقًا</div>
                  <div className="font-mono font-bold tabular-nums" dir="ltr">
                    {formatKWD(nInvoiced)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">المتبقي للفواتير</div>
                  <div
                    className={`font-mono font-extrabold tabular-nums ${
                      nRemaining !== null && nRemaining < -0.001 ? "text-status-danger" : "text-status-done"
                    }`}
                    dir="ltr"
                  >
                    {nRemaining !== null ? formatKWD(nRemaining) : "…"}
                  </div>
                </div>
              </div>
            )}
            {nExceeds && (
              <p className="flex items-center gap-1.5 rounded-lg border border-status-warn/40 bg-status-warn-bg p-2 text-xs font-semibold text-status-warn md:col-span-2 lg:col-span-3">
                <TriangleAlert className="size-3.5 shrink-0" />
                الصافي يتجاوز المتبقي من العقد ({formatKWD(nRemaining ?? 0)}) — سيُرفض من الخادم
              </p>
            )}

            {/* المرحلة (أ) — المحتجزات والدفعة المقدمة (فقط مع عقد — المفهوم تعاقدي) */}
            {nContractIdNum !== null && (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3 md:col-span-2 lg:col-span-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Label className="text-xs">نسبة المحتجزات %</Label>
                  <div className="flex items-center gap-1">
                    {[0, 5, 10].map((p) => (
                      <Button
                        key={p}
                        type="button"
                        variant={retentionRateNum === p ? "default" : "outline"}
                        size="sm"
                        className="h-7 px-2.5"
                        onClick={() => setNRetentionRate(String(p))}
                      >
                        {p}%
                      </Button>
                    ))}
                  </div>
                  <Input
                    className="h-8 w-24 ltr text-start"
                    dir="ltr"
                    inputMode="decimal"
                    value={nRetentionRate}
                    onChange={(e) => setNRetentionRate(e.target.value)}
                  />
                  <span className="text-xs text-muted-foreground">
                    المحتجز: <span className="font-bold tabular-nums" dir="ltr">{formatKWD(retentionAmount)}</span> — يُحجز في 1122 ويُفرج عنه لاحقًا من صفحة الدفعات
                  </span>
                </div>
                {nAdvance > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    الدفعة المقدمة على العقد {formatKWD(nAdvance)} بنسبة استرداد {nAdvancePct}% — سيُسترد تقديريًا من هذا المستخلص{" "}
                    <span className="font-bold tabular-nums" dir="ltr">{formatKWD(advanceRecoveryEstimate)}</span> (اللقطة النهائية خادمية)
                  </p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ===== محرر البنود ===== */}
      <Card>
        <CardContent className="space-y-3 p-4 md:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">بنود الفاتورة</h2>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              onClick={() => setItems((prev) => [...prev, { ...EMPTY_ITEM }])}
            >
              <Plus className="size-3.5" />
              بند
            </Button>
          </div>

          {/* سطح المكتب */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="p-2 text-start font-semibold">البيان</th>
                  <th className="w-24 p-2 text-start font-semibold">الكمية</th>
                  <th className="w-32 p-2 text-start font-semibold">سعر الوحدة</th>
                  <th className="w-20 p-2 text-start font-semibold">خصم%</th>
                  <th className="w-32 p-2 text-start font-semibold">الإجمالي</th>
                  <th className="w-10 p-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => {
                  const gross = r3(num(it.quantity) * num(it.unitPrice));
                  const lineTotal = r3(gross * (1 - Math.min(100, Math.max(0, num(it.discountPct))) / 100));
                  return (
                    <tr key={idx} className="border-b">
                      <td className="p-1">
                        <Input
                          className="h-8"
                          placeholder="وصف البند…"
                          value={it.description}
                          onChange={(e) => updateItem(idx, { description: e.target.value })}
                        />
                      </td>
                      <td className="p-1">
                        <Input
                          className="h-8 ltr text-start"
                          dir="ltr"
                          inputMode="decimal"
                          value={it.quantity}
                          onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                        />
                      </td>
                      <td className="p-1">
                        <Input
                          className="h-8 ltr text-start"
                          dir="ltr"
                          inputMode="decimal"
                          value={it.unitPrice}
                          onChange={(e) => updateItem(idx, { unitPrice: e.target.value })}
                        />
                      </td>
                      <td className="p-1">
                        <Input
                          className="h-8 ltr text-start"
                          dir="ltr"
                          inputMode="decimal"
                          value={it.discountPct}
                          onChange={(e) => updateItem(idx, { discountPct: e.target.value })}
                        />
                      </td>
                      <td className="p-2 font-bold tabular-nums" dir="ltr">
                        {formatKWD(lineTotal)}
                      </td>
                      <td className="p-1 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-status-danger"
                          disabled={items.length === 1}
                          onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                          aria-label="إزالة البند"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* موبايل */}
          <div className="space-y-3 md:hidden">
            {items.map((it, idx) => {
              const gross = r3(num(it.quantity) * num(it.unitPrice));
              const lineTotal = r3(gross * (1 - Math.min(100, Math.max(0, num(it.discountPct))) / 100));
              return (
                <div key={idx} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-muted-foreground">بند {idx + 1}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-status-danger"
                      disabled={items.length === 1}
                      onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                      aria-label="إزالة البند"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  <Input
                    className="h-9"
                    placeholder="وصف البند…"
                    value={it.description}
                    onChange={(e) => updateItem(idx, { description: e.target.value })}
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-[10px] text-muted-foreground">الكمية</Label>
                      <Input
                        className="h-9 ltr text-start"
                        dir="ltr"
                        inputMode="decimal"
                        value={it.quantity}
                        onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">السعر</Label>
                      <Input
                        className="h-9 ltr text-start"
                        dir="ltr"
                        inputMode="decimal"
                        value={it.unitPrice}
                        onChange={(e) => updateItem(idx, { unitPrice: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">خصم%</Label>
                      <Input
                        className="h-9 ltr text-start"
                        dir="ltr"
                        inputMode="decimal"
                        value={it.discountPct}
                        onChange={(e) => updateItem(idx, { discountPct: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="text-end text-xs font-bold tabular-nums" dir="ltr">
                    {formatKWD(lineTotal)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* الإجماليات الحية — المرحلة (أ): قبل الخصم · الخصم · الإجمالي المفوتر · المحتجزات · المطلوب نقدًا */}
          <div
            className={`grid gap-2 rounded-lg border bg-muted/30 p-3 text-center text-xs ${
              nContractIdNum !== null && retentionAmount > 0 ? "grid-cols-2 md:grid-cols-5" : "grid-cols-3"
            }`}
          >
            <div>
              <div className="text-muted-foreground">قبل الخصم</div>
              <div className="font-mono font-bold tabular-nums" dir="ltr">{formatKWD(totals.subtotal)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">الخصم</div>
              <div className="font-mono font-bold tabular-nums text-status-danger" dir="ltr">
                −{formatKWD(totals.discountTotal)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">الإجمالي المفوتر</div>
              <div className="font-mono font-extrabold tabular-nums text-primary-ink" dir="ltr">
                {formatKWD(totals.total)}
              </div>
            </div>
            {nContractIdNum !== null && retentionAmount > 0 && (
              <>
                <div>
                  <div className="text-muted-foreground">المحتجزات ({retentionRateNum}%)</div>
                  <div className="font-mono font-bold tabular-nums text-status-warn" dir="ltr">
                    {formatKWD(retentionAmount)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">المطلوب نقدًا</div>
                  <div className="font-mono font-extrabold tabular-nums text-primary-ink" dir="ltr">
                    {formatKWD(netDue)}
                  </div>
                </div>
              </>
            )}
          </div>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ScrollText className="size-3.5 shrink-0" />
            عند الإصدار: قيد posted متوازن آليًا — مدين ذمم العملاء / دائن إيراد العقود، والإلغاء لاحقًا بقيد عكسي مرتبط.
          </p>

          <div className="space-y-1.5">
            <Label className="text-xs">ملاحظات</Label>
            <Textarea rows={2} value={nNotes} onChange={(e) => setNNotes(e.target.value)} />
          </div>

          {newError && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs font-semibold text-destructive">
              {newError}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ===== شريط الإجراءات السفلي ===== */}
      <div className="sticky bottom-0 z-30">
        <Card className="border bg-background/95 shadow-sm backdrop-blur">
          <CardContent className="flex items-center justify-end gap-2 p-2">
            <Button variant="outline" className="h-9" onClick={onCancel} disabled={createMutation.isPending}>
              إلغاء
            </Button>
            <Button className="h-9" disabled={createMutation.isPending} onClick={submitNew}>
              {createMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              إصدار الفاتورة
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
