"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Banknote,
  FileDown,
  FileSpreadsheet,
  HandCoins,
  HardHat,
  Loader2,
  Printer,
  ScrollText,
  Users as UsersIcon,
  Wallet,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, getStoredToken } from "./api";
import { StatementTable } from "./StatementTable";
import { fetchBlobDownload } from "@/lib/download-blob";
import type {
  ContractStatementResponse,
  CustomerStatementResponse,
  CustomersResponse,
  StatementRow,
  StatementTarget,
  SubContractorsResponse,
  SubcontractorStatementResponse,
  User,
} from "./contrack-types";
import { errMessage } from "./contrack-types";
import { formatKWD } from "@/lib/format";

interface StatementViewProps {
  user: User;
  onAuthError: () => void;
  /** هدف مسبق (عقد/عميل/مقاول) — من تفاصيل العقد أو البحث الشامل */
  presetTarget?: StatementTarget | null;
  onConsumePreset?: () => void;
}

type FinCardDef = { label: string; value: number; icon: React.ComponentType<{ className?: string }>; tone?: string };

function FinCards({ cards }: { cards: FinCardDef[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Card key={c.label}>
            <CardContent className="flex items-center gap-3 p-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] text-muted-foreground">{c.label}</div>
                <div className={`truncate text-sm font-bold tabular-nums ${c.tone || ""}`} dir="ltr">
                  {formatKWD(c.value)}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function StatementView({ user: _user, onAuthError, presetTarget, onConsumePreset }: StatementViewProps) {
  const { toast } = useToast();

  const [kind, setKind] = React.useState<"customer" | "subcontractor">("customer");
  const [customerId, setCustomerId] = React.useState("");
  const [contractId, setContractId] = React.useState("all");
  const [subId, setSubId] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");

  // بحث العميل (select مع بحث)
  const [custSearch, setCustSearch] = React.useState("");
  const [dq, setDq] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDq(custSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [custSearch]);

  // هدف مسبق (تبويب كشف الحساب ⇒ «فتح في شاشة الكشوفات»)
  const [directContractId, setDirectContractId] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!presetTarget) return;
    if (presetTarget.kind === "contract") setDirectContractId(presetTarget.id);
    else if (presetTarget.kind === "customer") {
      setKind("customer");
      setCustomerId(String(presetTarget.id));
      setContractId("all");
    } else {
      setKind("subcontractor");
      setSubId(String(presetTarget.id));
    }
    onConsumePreset?.();
  }, [presetTarget, onConsumePreset]);

  // ===== قوائم المراجع =====
  const customersQuery = useQuery<CustomersResponse>({
    queryKey: ["customers", dq],
    queryFn: () => apiGet<CustomersResponse>(`/api/customers?q=${encodeURIComponent(dq)}`),
  });

  const customerDetailQuery = useQuery<{
    customer: { id: number; name: string };
    contracts: { id: number; contractNumber: string; contractName: string; status: string }[];
  }>({
    queryKey: ["customer", customerId, "brief"],
    queryFn: () => apiGet(`/api/customers/${customerId}`),
    enabled: kind === "customer" && customerId !== "" && directContractId === null,
  });

  const subsQuery = useQuery<SubContractorsResponse>({
    queryKey: ["subcontractors"],
    queryFn: () => apiGet<SubContractorsResponse>("/api/subcontractors"),
    enabled: kind === "subcontractor",
  });

  // ===== الاستعلام الفعلي للكشف =====
  const periodQs = React.useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return p.toString();
  }, [from, to]);

  // كشف العقد المحدد (اختيار عقد بعينه أو هدف مسبق)
  const effectiveContractId = directContractId ?? (kind === "customer" && contractId !== "all" ? Number(contractId) : null);
  const contractStatementQuery = useQuery<ContractStatementResponse>({
    queryKey: ["statement", "contract", effectiveContractId, periodQs],
    queryFn: () => apiGet<ContractStatementResponse>(`/api/statement/contract/${effectiveContractId}${periodQs ? `?${periodQs}` : ""}`),
    enabled: effectiveContractId !== null && !Number.isNaN(effectiveContractId),
  });

  // كشف العميل الشامل (كل العقود بأقسام)
  const customerStatementQuery = useQuery<CustomerStatementResponse>({
    queryKey: ["statement", "customer", customerId, periodQs],
    queryFn: () => {
      const extra = periodQs ? `?${periodQs}` : "";
      return apiGet<CustomerStatementResponse>(`/api/statement/customer/${customerId}${extra}`);
    },
    enabled: kind === "customer" && customerId !== "" && contractId === "all" && directContractId === null,
  });

  // كشف المقاول
  const subStatementQuery = useQuery<SubcontractorStatementResponse>({
    queryKey: ["statement", "subcontractor", subId, periodQs],
    queryFn: () => apiGet<SubcontractorStatementResponse>(`/api/statement/subcontractor/${subId}${periodQs ? `?${periodQs}` : ""}`),
    enabled: kind === "subcontractor" && subId !== "",
  });

  React.useEffect(() => {
    for (const e of [contractStatementQuery.error, customerStatementQuery.error, subStatementQuery.error]) {
      if (e instanceof ApiError && e.status === 401) onAuthError();
    }
  }, [contractStatementQuery.error, customerStatementQuery.error, subStatementQuery.error, onAuthError]);

  // ===== تركيب صفوف كشف العميل الشامل: قسم لكل عقد + مجموع العقد =====
  const customerSections = customerStatementQuery.data?.sections ?? [];
  const composedRows: StatementRow[] = React.useMemo(() => {
    const rows: StatementRow[] = [];
    for (const sec of customerSections) {
      rows.push({
        date: "",
        ref: sec.contract.contractNumber,
        desc: `${sec.contract.customerName} — عقد ${sec.contract.contractNumber}`,
        debit: 0,
        credit: 0,
        balance: 0,
        kind: "section",
      });
      rows.push(...(sec.rows ?? []));
      rows.push({
        date: "",
        ref: "",
        desc: `مجموع عقد ${sec.contract.contractNumber}`,
        debit: sec.subtotal?.debit ?? 0,
        credit: sec.subtotal?.credit ?? 0,
        balance: 0,
        kind: "subtotal",
      });
    }
    return rows;
  }, [customerSections]);

  const contractData = contractStatementQuery.data ?? null;
  const subData = subStatementQuery.data ?? null;

  const loading =
    (effectiveContractId !== null && contractStatementQuery.isLoading) ||
    (kind === "customer" && customerId !== "" && contractId === "all" && directContractId === null && customerStatementQuery.isLoading) ||
    (kind === "subcontractor" && subId !== "" && subStatementQuery.isLoading);

  const hasSelection =
    effectiveContractId !== null ||
    (kind === "customer" && customerId !== "" && contractId === "all") ||
    (kind === "subcontractor" && subId !== "");

  const selectedCustomerName =
    customerDetailQuery.data?.customer.name ||
    customersQuery.data?.customers.find((c) => String(c.id) === customerId)?.name ||
    "";

  const onPrint = () => {
    if (!hasSelection) {
      toast({ title: "اختر طرفًا أولًا", description: "حدد العميل/المقاول ثم اطبع الكشف" });
      return;
    }
    window.print();
  };

  // ===== المرحلة 8: PDF خادميًا (كشف العقد أو الكشف الشامل للعميل) =====
  const [pdfBusy, setPdfBusy] = React.useState(false);
  const pdfSupported =
    effectiveContractId !== null ||
    (kind === "customer" && customerId !== "" && contractId === "all" && directContractId === null);

  const onPdfExport = async () => {
    if (!pdfSupported || pdfBusy) return;
    const isContract = effectiveContractId !== null;
    const url = isContract
      ? `/api/statement/contract/${effectiveContractId}/pdf${periodQs ? `?${periodQs}` : ""}`
      : `/api/statement/customer/${customerId}/pdf${periodQs ? `?${periodQs}` : ""}`;
    const base = isContract
      ? `كشف حساب ${contractData?.contract?.contractNumber || effectiveContractId}`
      : `كشف حساب شامل ${selectedCustomerName || customerId}`;
    try {
      setPdfBusy(true);
      await fetchBlobDownload({ url, token: getStoredToken(), filename: `${base}.pdf` });
      toast({ title: "تم إنشاء PDF", description: "نُزّل ملف الكشف بنجاح" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      const status = (e as { status?: number }).status;
      if (status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر إنشاء PDF", description: errMessage(e) });
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* الترويسة */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileSpreadsheet className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">كشوف الحساب</h1>
            <p className="text-xs text-muted-foreground">
              الفواتير «للعلم» فقط ولا تخفض المديونية — المتبقي = القيمة الحالية − المحصّل
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 print-hidden">
          {pdfSupported && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              disabled={pdfBusy || loading || !hasSelection}
              onClick={onPdfExport}
            >
              {pdfBusy ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
              {pdfBusy ? "جارٍ إنشاء PDF…" : "▦ كشف PDF"}
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={onPrint}>
            <Printer className="size-4" />
            طباعة
          </Button>
        </div>
      </div>

      {/* الفلاتر */}
      <Card className="print-hidden">
        <CardContent className="space-y-3 p-3">
          {/* الطرف: عميل / مقاول */}
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { v: "customer", label: "عميل", icon: UsersIcon },
                { v: "subcontractor", label: "مقاول باطن", icon: HardHat },
              ] as const
            ).map((t) => {
              const Icon = t.icon;
              const active = kind === t.v;
              return (
                <Button
                  key={t.v}
                  type="button"
                  size="sm"
                  variant={active ? "secondary" : "ghost"}
                  className={`h-9 gap-1.5 ${active ? "font-semibold text-primary" : "text-muted-foreground"}`}
                  onClick={() => {
                    setKind(t.v);
                    setDirectContractId(null);
                    setContractId("all");
                  }}
                >
                  <Icon className="size-4" />
                  {t.label}
                </Button>
              );
            })}

            <div className="ms-auto flex flex-wrap items-end gap-2">
              <div className="w-36 space-y-1">
                <Label className="text-xs text-muted-foreground">من تاريخ</Label>
                <Input type="date" dir="ltr" className="h-9" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="w-36 space-y-1">
                <Label className="text-xs text-muted-foreground">إلى تاريخ</Label>
                <Input type="date" dir="ltr" className="h-9" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
          </div>

          {kind === "customer" ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">بحث عن عميل</Label>
                <Input
                  className="h-9"
                  placeholder="اسم / هاتف / كود…"
                  value={custSearch}
                  onChange={(e) => setCustSearch(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">العميل</Label>
                <Select
                  value={customerId}
                  onValueChange={(v) => {
                    setCustomerId(v);
                    setContractId("all");
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={customersQuery.isLoading ? "جارٍ التحميل…" : "اختر العميل"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {(customersQuery.data?.customers ?? []).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                        {c.customerCode ? ` — ${c.customerCode}` : ""}
                      </SelectItem>
                    ))}
                    {(customersQuery.data?.customers ?? []).length === 0 && (
                      <div className="px-3 py-4 text-center text-xs text-muted-foreground">لا نتائج مطابقة</div>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">العقد</Label>
                <Select
                  value={contractId}
                  onValueChange={setContractId}
                  disabled={customerId === "" || directContractId !== null}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="اختر العقد" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="all">كل العقود (كشف شامل)</SelectItem>
                    {(customerDetailQuery.data?.contracts ?? []).map((ct) => (
                      <SelectItem key={ct.id} value={String(ct.id)}>
                        {ct.contractNumber} — {ct.contractName || "بدون اسم"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">المقاول</Label>
                <Select value={subId} onValueChange={setSubId}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={subsQuery.isLoading ? "جارٍ التحميل…" : "اختر المقاول"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {((subsQuery.data?.subcontractors ?? subsQuery.data?.items ?? [])).map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name} — {s.subCode}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {directContractId !== null && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-dashed bg-primary/5 px-3 py-2 text-xs">
              <span>
                معروض كشف العقد محدد مسبقًا <span dir="ltr">#{directContractId}</span> — اختر عميلًا للتبديل.
              </span>
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={() => setDirectContractId(null)}>
                <X className="size-3.5" />
                إلغاء التحديد
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* المحتوى */}
      {!hasSelection ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <ScrollText className="size-8 text-muted-foreground/40" />
            <p className="text-sm font-medium">اختر عميلًا أو مقاولًا لعرض كشف الحساب</p>
            <p className="text-xs text-muted-foreground">
              كشف العقد يعمل دائمًا، وكشف العميل الشامل يجمع كل عقوده بأقسام مع مجموع لكل عقد.
            </p>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : effectiveContractId !== null ? (
        contractStatementQuery.isError ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-destructive">
              تعذر تحميل الكشف — {errMessage(contractStatementQuery.error)}
            </CardContent>
          </Card>
        ) : contractData ? (
          <div className="space-y-3">
            <FinCards
              cards={[
                { label: "القيمة الحالية", value: contractData.totals?.current ?? 0, icon: Wallet },
                { label: "المحصّل", value: contractData.totals?.collected ?? 0, icon: HandCoins },
                {
                  label: "المتبقي",
                  value: contractData.totals?.remaining ?? 0,
                  icon: Banknote,
                  tone: (contractData.totals?.remaining ?? 0) > 0.001 ? "text-status-warn" : "text-status-done",
                },
              ]}
            />
            {contractData.contract?.customerName && (
              <p className="text-xs text-muted-foreground">
                العميل: <span className="font-medium text-foreground">{contractData.contract.customerName}</span>
                {contractData.contract.contractNumber && (
                    <> — العقد <span className="font-medium text-foreground" dir="ltr">{contractData.contract.contractNumber}</span></>
                )}
                {selectedCustomerName && contractData.contract.customerName !== selectedCustomerName && ` · ${selectedCustomerName}`}
              </p>
            )}
            <StatementTable
              rows={contractData.rows ?? []}
              totals={contractData.totals ?? null}
              loading={contractStatementQuery.isLoading}
              emptyMessage="لا حركات على هذا العقد في هذه الفترة"
            />
          </div>
        ) : null
      ) : kind === "customer" ? (
        customerStatementQuery.isError ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-destructive">
              تعذر تحميل الكشف — {errMessage(customerStatementQuery.error)}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            <FinCards
              cards={[
                { label: "إجمالي المدين", value: customerStatementQuery.data?.totals?.debit ?? 0, icon: Wallet },
                { label: "إجمالي الدائن", value: customerStatementQuery.data?.totals?.credit ?? 0, icon: HandCoins },
                {
                  label: "المتبقي",
                  value: customerStatementQuery.data?.totals?.remaining ?? 0,
                  icon: Banknote,
                  tone: (customerStatementQuery.data?.totals?.remaining ?? 0) > 0.001 ? "text-status-warn" : "text-status-done",
                },
              ]}
            />
            {selectedCustomerName && (
              <p className="text-xs text-muted-foreground">
                الكشف الشامل للعميل: <span className="font-medium text-foreground">{selectedCustomerName}</span> —{" "}
                {customerSections.length} عقد/أقسام
              </p>
            )}
            <StatementTable
              rows={composedRows}
              totals={customerStatementQuery.data?.totals ?? null}
              loading={customerStatementQuery.isLoading}
              emptyMessage="لا عقود أو حركات لهذا العميل في هذه الفترة"
            />
          </div>
        )
      ) : subStatementQuery.isError ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">
            تعذر تحميل الكشف — {errMessage(subStatementQuery.error)}
          </CardContent>
        </Card>
      ) : (
        subData && (
          <div className="space-y-3">
            <FinCards
              cards={[
                { label: "إجمالي المدين (عقود الباطن)", value: subData.totals?.debit ?? 0, icon: Wallet },
                { label: "إجمالي الدائن (المنصرف)", value: subData.totals?.credit ?? 0, icon: HandCoins },
                {
                  label: "المتبقي للمقاول",
                  value: subData.totals?.remaining ?? 0,
                  icon: Banknote,
                  tone: (subData.totals?.remaining ?? 0) > 0.001 ? "text-status-warn" : "text-status-done",
                },
              ]}
            />
            <StatementTable
              rows={subData.rows ?? []}
              totals={subData.totals ?? null}
              loading={subStatementQuery.isLoading}
              emptyMessage="لا حركات على هذا المقاول في هذه الفترة"
            />
          </div>
        )
      )}
    </div>
  );
}
