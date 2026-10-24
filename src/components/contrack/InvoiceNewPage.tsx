"use client";

/**
 * «فاتورة جديدة» — صفحة كاملة (بدل النافذة السابقة في InvoicesView — 6 حقول):
 * نفس الحقول والاستعلامات والتحقق والـpayload والـinvalidations والـtoasts حرفيًا،
 * مع بطاقة «القيمة الحالية / المفوتر سابقًا / المتبقي للفواتير» وتحذير التجاوز كما هما.
 * تُعرض مكان شاشة الفواتير (بلا مسار جديد)، والشريط السفلي sticky: زر أساسي واحد (إصدار الفاتورة) + إلغاء outline.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, TriangleAlert } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPost } from "./api";
import { SearchableSelect } from "./SearchableSelect";
import type {
  ContractDetailResponse,
  CustomerDetailResponse,
  CustomersResponse,
  InvoiceItem,
} from "./contrack-types";
import { errMessage } from "./contrack-types";
import { formatKWD, round3 } from "@/lib/format";

interface InvoiceNewPageProps {
  onAuthError: () => void;
  /** قائمة الفواتير من الشاشة المستدعية (مخزون ["invoices"] نفسه) لحساب «المفوتر سابقًا» — كما في النافذة */
  invoices: InvoiceItem[];
  /** عميل محدد مسبقًا من فلتر الشاشة (كما كان في openNew) */
  presetCustomerId?: string | null;
  /** بعد الإصدار الناجح — تُغلق الصفحة من الشاشة المستدعية */
  onSaved?: () => void;
  /** العودة لقائمة الفواتير */
  onCancel: () => void;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function InvoiceNewPage({
  onAuthError,
  invoices,
  presetCustomerId,
  onSaved,
  onCancel,
}: InvoiceNewPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // الصفحة تُركَّب عند الفتح فقط — التهيئة مباشرة (نفس تهيئة فتح النافذة السابقة حرفيًا)
  const [nCustomerId, setNCustomerId] = React.useState(presetCustomerId ?? "none");
  const [nContractId, setNContractId] = React.useState("none");
  const [nDate, setNDate] = React.useState(todayStr());
  const [nAmount, setNAmount] = React.useState("");
  const [nDescription, setNDescription] = React.useState("");
  const [nNotes, setNNotes] = React.useState("");
  const [newError, setNewError] = React.useState("");

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
  const nContracts = (custContractsQuery.data?.contracts ?? []).filter(
    (c) => c.status !== "ملغى"
  );

  const nContractIdNum = nContractId !== "none" ? Number(nContractId) : null;
  const contractDetailQuery = useQuery<ContractDetailResponse>({
    queryKey: ["contract", nContractIdNum],
    queryFn: () => apiGet<ContractDetailResponse>(`/api/contracts/${nContractIdNum}`),
    enabled: nContractIdNum !== null,
    retry: false,
  });
  const nCurrent = contractDetailQuery.data ? Number(contractDetailQuery.data.current || 0) : null;
  const nInvoiced = round3(
    invoices
      .filter((i) => i.contract?.id === nContractIdNum)
      .reduce((s, i) => s + Number(i.amount || 0), 0)
  );
  const nRemaining = nCurrent !== null ? round3(nCurrent - nInvoiced) : null;
  const nExceeds = nRemaining !== null && Number(nAmount) > nRemaining + 0.001;

  // ===== نفس إصدار النافذة السابقة حرفيًا (نفس الـpayload والـinvalidations والـtoasts) =====
  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiPost<{ item?: InvoiceItem }>("/api/invoices", body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["contract"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onSaved?.();
      toast({ title: "صدرت الفاتورة", description: `رقم الفاتورة: ${res.item?.invoiceNumber ?? ""}` });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      // رسائل الحرجتين حرفيًا: «الفاتورة يجب أن تخص عميل العقد» / «تتجاوز المتبقي (X)»
      setNewError(errMessage(e));
      toast({ variant: "destructive", title: "رُفضت الفاتورة", description: errMessage(e) });
    },
  });

  const submitNew = () => {
    if (nCustomerId === "none") {
      toast({ variant: "destructive", title: "اختر العميل" });
      return;
    }
    if (nContractId === "none") {
      toast({ variant: "destructive", title: "اختر العقد" });
      return;
    }
    if (!nDate) {
      toast({ variant: "destructive", title: "حدد تاريخ الفاتورة" });
      return;
    }
    if (!(Number(nAmount) > 0)) {
      toast({ variant: "destructive", title: "أدخل مبلغًا أكبر من صفر" });
      return;
    }
    setNewError("");
    createMutation.mutate({
      customerId: Number(nCustomerId),
      contractId: Number(nContractId),
      invoiceDate: nDate,
      amount: Number(nAmount),
      description: nDescription.trim() || undefined,
      notes: nNotes.trim() || undefined,
    });
  };

  return (
    <div className="space-y-4">
      {/* ===== رأس الصفحة ===== */}
      <div>
        <p className="text-xs text-muted-foreground">المحاسبة ← الفواتير</p>
        <h1 className="text-xl font-bold">فاتورة جديدة</h1>
        <p className="text-sm text-muted-foreground">
          العميل والعقد إجباريان — الفاتورة لا تتجاوز المتبقي: القيمة الحالية − مفوتر العقد.
        </p>
      </div>

      {/* ===== الحقول — نفس حقول النافذة السابقة كلها ===== */}
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
              <Label className="text-xs">العقد *</Label>
              <Select value={nContractId} onValueChange={setNContractId} disabled={nCustomerId === "none"}>
                <SelectTrigger className="h-9">
                  <SelectValue
                    placeholder={nCustomerId === "none" ? "اختر عميلًا أولًا" : "اختر العقد"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {nContracts.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.contractNumber} — {c.contractName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* بطاقة الأرقام — نفس حسابات النافذة حرفيًا */}
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
                      nRemaining !== null && nRemaining < -0.001
                        ? "text-status-danger"
                        : "text-status-done"
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
                المبلغ يتجاوز المتبقي ({formatKWD(nRemaining ?? 0)}) — سيُرفض من الخلفي
              </p>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">تاريخ الفاتورة *</Label>
              <Input type="date" className="h-9" value={nDate} onChange={(e) => setNDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">المبلغ *</Label>
              <Input
                className="h-9 ltr text-start"
                dir="ltr"
                inputMode="decimal"
                value={nAmount}
                onChange={(e) => setNAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">الوصف</Label>
              <Input
                className="h-9"
                placeholder="مثال: دفعة أولى — قيمة العقد"
                value={nDescription}
                onChange={(e) => setNDescription(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
              <Label className="text-xs">ملاحظات</Label>
              <Textarea rows={2} value={nNotes} onChange={(e) => setNNotes(e.target.value)} />
            </div>
          </div>

          {newError && (
            <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs font-semibold text-destructive">
              {newError}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ===== شريط الإجراءات السفلي — زر أساسي واحد + إلغاء outline ===== */}
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
