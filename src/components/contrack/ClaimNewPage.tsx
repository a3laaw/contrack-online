"use client";

/**
 * صفحة «مطالبة جديدة» — تحويل نافذة المطالبة الجديدة في ClaimsView إلى صفحة كاملة.
 * نفس الحقول التسعة (الاتجاه/العميل/العقد/الباطن/بند الخطة/سند القبض/العنوان/المبلغ/الاستحقاق)
 * ونفس الاستعلامات والتحققات ومِلَك الإنشاء (POST /api/claims) حرفيًا — لا تغيير منطق أعمال.
 * لا مسار جديد — تُعرض مكان قائمة المطالبات عبر حالة داخلية.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

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
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPost } from "./api";
import { SearchableSelect } from "./SearchableSelect";
import type {
  ClaimRow,
  ContractsResponse,
  CustomerDetailResponse,
  PlanResponse,
  SubContractsResponse,
  VouchersResponse,
} from "./contrack-types";
import { errMessage } from "./contrack-types";
import { fmtDate, formatKWD } from "@/lib/format";

/** اتجاه المطالبة — مطابق لتعريف Dir في ClaimsView */
export type ClaimDirection = "out" | "in";

interface ClaimNewPageProps {
  /** التبويب النشط عند الفتح — يحدد اتجاه المطالبة الابتدائي */
  initialDir: ClaimDirection;
  onAuthError: () => void;
  /** بعد التسجيل الناجح — يعود لقائمة المطالبات */
  onSaved: () => void;
  /** إلغاء — يعود لقائمة المطالبات */
  onCancel: () => void;
}

export function ClaimNewPage({ initialDir, onAuthError, onSaved, onCancel }: ClaimNewPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // ===== الحقول (نفس حالات النافذة حرفيًا — تُهيأ عند التركيب من التبويب النشط) =====
  const [dir, setDir] = React.useState<ClaimDirection>(initialDir);
  const [customerId, setCustomerId] = React.useState("none");
  const [contractId, setContractId] = React.useState("none");
  const [subContractId, setSubContractId] = React.useState("none");
  const [custLineId, setCustLineId] = React.useState("none");
  const [voucherId, setVoucherId] = React.useState("none");
  const [title, setTitle] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");

  // ===== استعلامات مرجعية (نفس استعلامات النافذة بلا حرس open — الصفحة تُركَّب عند الفتح فقط) =====
  const customersQuery = useQuery<{ customers: { id: number; name: string }[] }>({
    queryKey: ["customers", ""],
    queryFn: () => apiGet<{ customers: { id: number; name: string }[] }>("/api/customers"),
    enabled: dir === "out",
  });

  const allContractsQuery = useQuery<ContractsResponse>({
    queryKey: ["contracts", "", ""],
    queryFn: () => apiGet<ContractsResponse>("/api/contracts"),
    enabled: dir === "in",
  });

  const custContractsQuery = useQuery<CustomerDetailResponse>({
    queryKey: ["customer", customerId],
    queryFn: () => apiGet<CustomerDetailResponse>(`/api/customers/${customerId}`),
    enabled: dir === "out" && customerId !== "none",
  });

  const contractIdNum = contractId !== "none" ? Number(contractId) : null;

  const subContractsQuery = useQuery<SubContractsResponse>({
    queryKey: ["sub-contracts", "contract", contractIdNum],
    queryFn: () => apiGet<SubContractsResponse>(`/api/sub-contracts?contractId=${contractIdNum}`),
    enabled: dir === "in" && contractIdNum !== null,
  });

  const planQuery = useQuery<PlanResponse>({
    queryKey: ["contract", contractIdNum, "plan"],
    queryFn: () => apiGet<PlanResponse>(`/api/contracts/${contractIdNum}/plan`),
    enabled: contractIdNum !== null,
  });
  const triggeredLines = (planQuery.data?.lines ?? []).filter((l) => !!l.triggeredAt);

  const receiptsQuery = useQuery<VouchersResponse>({
    queryKey: ["vouchers", `contractId=${contractIdNum}&vtype=receipt`],
    queryFn: () => apiGet<VouchersResponse>(`/api/vouchers?contractId=${contractIdNum}&vtype=receipt`),
    enabled: dir === "out" && contractIdNum !== null,
  });
  const receiptVouchers = (receiptsQuery.data?.items ?? []).filter((v) => !v.cancelled);
  const selectedVoucher = receiptVouchers.find((v) => String(v.id) === voucherId) ?? null;

  // ===== الإنشاء — نفس الـmutation حرفيًا =====
  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPost<{ item: ClaimRow }>("/api/claims", body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["claims"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: "سُجلت المطالبة", description: `رقم المطالبة: ${res.item?.claimNumber ?? ""}` });
      onSaved();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر تسجيل المطالبة", description: errMessage(e) });
    },
  });

  const submitNew = () => {
    if (contractId === "none") {
      toast({ variant: "destructive", title: "اختر العقد" });
      return;
    }
    if (dir === "in" && subContractId === "none") {
      toast({ variant: "destructive", title: "مطالبات المقاولين تتطلب اختيار العقد الباطن" });
      return;
    }
    if (!title.trim()) {
      toast({ variant: "destructive", title: "أدخل عنوان المطالبة" });
      return;
    }
    if (!(Number(amount) > 0)) {
      toast({ variant: "destructive", title: "أدخل مبلغًا أكبر من صفر" });
      return;
    }
    const body: Record<string, unknown> = {
      direction: dir,
      contractId: Number(contractId),
      title: title.trim(),
      amount: Number(amount),
    };
    if (dir === "in") body.subContractId = Number(subContractId);
    if (custLineId !== "none") body.custLineId = Number(custLineId);
    if (selectedVoucher) body.voucherRef = selectedVoucher.voucherNumber;
    if (dueDate) body.dueDate = dueDate;
    createMutation.mutate(body);
  };

  return (
    <div className="space-y-4">
      {/* ===== رأس الصفحة ===== */}
      <header>
        <nav aria-label="مسار التنقل" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>المحاسبة</span>
          <span aria-hidden="true">←</span>
          <span>المطالبات</span>
        </nav>
        <h1 className="mt-1 text-xl font-bold">مطالبة جديدة</h1>
        <p className="text-sm text-muted-foreground">
          سجّل مطالبة على عميل (لنا) أو من مقاول باطن (علينا) — CLM-#### عالمي.
        </p>
      </header>

      {/* ===== الحقول ===== */}
      <Card>
        <CardContent className="space-y-3 p-4 md:p-6">
          {/* الاتجاه */}
          <div className="flex gap-1.5 md:col-span-2 lg:col-span-3">
            {(["out", "in"] as ClaimDirection[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setDir(d);
                  setCustomerId("none");
                  setContractId("none");
                  setSubContractId("none");
                  setCustLineId("none");
                  setVoucherId("none");
                }}
                className={`flex-1 rounded-md border px-2.5 py-2 text-xs font-medium transition-colors ${
                  dir === d ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {d === "out" ? "مطالبتنا على العميل" : "مطالبة مقاول علينا"}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {/* العميل ثم عقده — اتجاه out */}
            {dir === "out" && (
              <>
                <div className="space-y-1.5">
                  <Label>العميل *</Label>
                  <SearchableSelect
                    value={customerId}
                    onValueChange={(v) => {
                      setCustomerId(v);
                      setContractId("none");
                      setCustLineId("none");
                      setVoucherId("none");
                    }}
                    options={[
                      { value: "none", label: "— اختر —" },
                      ...(customersQuery.data?.customers ?? []).map((cu) => ({ value: String(cu.id), label: cu.name })),
                    ]}
                    placeholder="اختر العميل"
                    searchPlaceholder="ابحث بالاسم…"
                    emptyText="لا نتائج مطابقة"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>العقد *</Label>
                  <SearchableSelect
                    value={contractId}
                    disabled={customerId === "none"}
                    onValueChange={(v) => {
                      setContractId(v);
                      setCustLineId("none");
                      setVoucherId("none");
                    }}
                    options={[
                      { value: "none", label: "— اختر —" },
                      ...(custContractsQuery.data?.contracts ?? [])
                        .filter((ct) => !["ملغى", "مغلق"].includes(ct.status))
                        .map((ct) => ({ value: String(ct.id), label: `${ct.contractNumber} — ${ct.contractName}` })),
                    ]}
                    placeholder="اختر العقد"
                    searchPlaceholder="ابحث برقم/اسم العقد…"
                    emptyText="لا نتائج مطابقة"
                  />
                </div>
              </>
            )}

            {/* العقد مباشرة — اتجاه in */}
            {dir === "in" && (
              <div className="space-y-1.5">
                <Label>العقد *</Label>
                <SearchableSelect
                  value={contractId}
                  onValueChange={(v) => {
                    setContractId(v);
                    setSubContractId("none");
                    setCustLineId("none");
                  }}
                  options={[
                    { value: "none", label: "— اختر —" },
                    ...(allContractsQuery.data?.contracts ?? [])
                      .filter((ct) => !["ملغى", "مغلق"].includes(ct.status))
                      .map((ct) => ({ value: String(ct.id), label: `${ct.contractNumber} — ${ct.customerName}` })),
                  ]}
                  placeholder="اختر العقد"
                  searchPlaceholder="ابحث برقم العقد أو العميل…"
                  emptyText="لا نتائج مطابقة"
                />
              </div>
            )}

            {/* عقد الباطن — إجباري في in */}
            {dir === "in" && (
              <div className="space-y-1.5">
                <Label>العقد الباطن *</Label>
                <SearchableSelect
                  value={subContractId}
                  disabled={contractId === "none"}
                  onValueChange={setSubContractId}
                  options={[
                    { value: "none", label: "— اختر —" },
                    ...(subContractsQuery.data?.items ?? []).map((s) => ({ value: String(s.id), label: `${s.subcontractor.name} — ${formatKWD(s.amount)}` })),
                  ]}
                  placeholder="اختر العقد الباطن"
                  searchPlaceholder="ابحث باسم المقاول…"
                  emptyText="لا نتائج مطابقة"
                />
              </div>
            )}

            {/* بند خطة مُثار اختياري */}
            <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
              <Label>بند الخطة المثار (اختياري)</Label>
              <SearchableSelect
                value={custLineId}
                onValueChange={setCustLineId}
                disabled={contractId === "none"}
                options={[
                  { value: "none", label: "بلا ربط ببند خطة" },
                  ...triggeredLines.map((l) => ({ value: String(l.id), label: `${l.title} — ${formatKWD(l.amountN)} — استحقاق ${fmtDate(l.dueDate)}` })),
                ]}
                placeholder="بلا ربط ببند خطة"
                searchPlaceholder="ابحث بعنوان البند…"
                emptyText="لا نتائج مطابقة"
              />
              {contractId !== "none" && planQuery.isSuccess && triggeredLines.length === 0 && (
                <p className="text-xs text-muted-foreground">لا بنود مثارة في خطة هذا العقد (الاستحقاق لم يُفعّل بعد).</p>
              )}
            </div>

            {/* سند القبض — اختياري في out */}
            {dir === "out" && (
              <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                <Label>سند القبض المرتبط (اختياري)</Label>
                <SearchableSelect
                  value={voucherId}
                  onValueChange={setVoucherId}
                  disabled={contractId === "none"}
                  options={[
                    { value: "none", label: "بلا سند مرتبط" },
                    ...receiptVouchers.map((v) => ({ value: String(v.id), label: `${v.voucherNumber} — ${formatKWD(v.amount)} — ${fmtDate(v.vdate)}` })),
                  ]}
                  placeholder="بلا سند مرتبط"
                  searchPlaceholder="ابحث برقم السند…"
                  emptyText="لا نتائج مطابقة"
                />
                {selectedVoucher && (
                  <p className="text-xs text-muted-foreground">
                    سقف السند: {formatKWD(selectedVoucher.amount)} — لا يجوز أن يتجاوز مبلغ المطالبة سقف السند غير المطالب به.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
              <Label>العنوان *</Label>
              <Input className="h-9" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: تأخر سداد الدفعة الثانية" />
            </div>
            <div className="space-y-1.5">
              <Label>المبلغ *</Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                dir="ltr"
                className="h-9"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.000"
              />
            </div>
            <div className="space-y-1.5">
              <Label>الاستحقاق (اختياري)</Label>
              <Input type="date" className="h-9" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== شريط الإجراءات السفلي ===== */}
      <div className="sticky bottom-0 z-30">
        <Card className="border bg-background/95 shadow-sm backdrop-blur">
          <CardContent className="flex items-center justify-end gap-2 p-2">
            <Button variant="outline" className="h-9" onClick={onCancel} disabled={createMutation.isPending}>
              إلغاء
            </Button>
            <Button className="h-9 gap-1.5" disabled={createMutation.isPending} onClick={submitNew}>
              {createMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              تسجيل المطالبة
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
