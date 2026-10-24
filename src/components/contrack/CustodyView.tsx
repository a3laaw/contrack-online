"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpToLine,
  BarChart3,
  BookOpen,
  ClipboardCheck,
  Eye,
  HandCoins,
  Loader2,
  Plus,
  Settings2,
  Undo2,
  Wallet,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiFetch, apiGet, apiPost } from "./api";
import { SearchableSelect } from "./SearchableSelect";
import type {
  CustodyAccountItem,
  CustodyAccountsResponse,
  CustodyLedgerResponse,
  CustodySettlementDetailResponse,
  CustodySettlementItem,
  CustodySettlementsResponse,
  CustodyOverviewResponse,
  CustomerDetailResponse,
  CustomersResponse,
  ExpenseAccountDTO,
  PaymentMethodsResponse,
  User,
} from "./contrack-types";
import {
  CUSTODY_KIND_BADGE,
  CUSTODY_KIND_LABEL,
  VOUCHER_TYPE_BADGE,
  VOUCHER_TYPE_LABEL,
  errMessage,
  isManagerRole,
} from "./contrack-types";
import { fmtDate, formatKWD, round3 } from "@/lib/format";
import { CustodyAccountsPage } from "./CustodyAccountsPage";
import { CustodyReports } from "./CustodyReports";

interface CustodyViewProps {
  user: User;
  onAuthError: () => void;
}

type CustodyTab = "accounts" | "settlements" | "ledger" | "reports";

const DEAD_CONTRACT_STATUSES = new Set(["ملغى"]);

/** بنود التصفية تُربط بحساب مصروف فعلي (لا بحسابات العهد advance) */
const LEDGER_KINDS = ["handover", "settlement", "return"] as const;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** لون الرصيد حسب الإشارة: موجب teal / سالب أحمر تحذيري / صفر رمادي */
function balanceTone(v: number): string {
  if (v > 0.001) return "text-status-done";
  if (v < -0.001) return "text-status-danger";
  return "text-muted-foreground";
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

// ==================== بند تصفية (سطر متعدد) ====================

interface SettleLineForm {
  expParent: string;
  expChild: string;
  expText: string;
  customerId: string;
  contractId: string;
  amount: string;
  description: string;
}

const emptySettleLine = (): SettleLineForm => ({
  expParent: "none",
  expChild: "none",
  expText: "",
  customerId: "none",
  contractId: "none",
  amount: "",
  description: "",
});

/** سطر بند تصفية: حساب مصروف (شجرة أب/ابن) + عميل/عقد اختياريان + مبلغ + وصف */
function SettleLineRow({
  index,
  line,
  onChange,
  onRemove,
  expenseAccounts,
  expenseReady,
  customers,
}: {
  index: number;
  line: SettleLineForm;
  onChange: (patch: Partial<SettleLineForm>) => void;
  onRemove: () => void;
  expenseAccounts: ExpenseAccountDTO[];
  expenseReady: boolean;
  customers: { id: number; name: string }[];
}) {
  const customerIdNum = line.customerId !== "none" ? Number(line.customerId) : null;
  const custContractsQuery = useQuery<CustomerDetailResponse>({
    queryKey: ["customer", customerIdNum],
    queryFn: () => apiGet<CustomerDetailResponse>(`/api/customers/${customerIdNum}`),
    enabled: customerIdNum !== null,
  });
  const custContracts = (custContractsQuery.data?.contracts ?? []).filter(
    (c) => !DEAD_CONTRACT_STATUSES.has(c.status)
  );

  const roots = expenseAccounts.filter((a) => !a.parentId);
  const childrenOf = (id: number) => expenseAccounts.filter((a) => a.parentId === id);
  const children = line.expParent !== "none" ? childrenOf(Number(line.expParent)) : [];

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold">بند {index + 1}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
          onClick={onRemove}
        >
          <XCircle className="size-3.5" />
          حذف البند
        </Button>
      </div>
      {expenseReady ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-[11px]">حساب المصروف (أب) *</Label>
            <Select
              value={line.expParent}
              onValueChange={(v) => onChange({ expParent: v, expChild: "none" })}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="اختر الأب" />
              </SelectTrigger>
              <SelectContent>
                {roots.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">الحساب الفرعي</Label>
            <Select
              value={line.expChild}
              onValueChange={(v) => onChange({ expChild: v })}
              disabled={children.length === 0}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder={children.length === 0 ? "بلا فروع" : "اختر الفرعي"} />
              </SelectTrigger>
              <SelectContent>
                {children.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <Label className="text-[11px]">اسم حساب المصروف *</Label>
          <Input
            className="h-9"
            placeholder="مثال: مصروفات مواد بناء"
            value={line.expText}
            onChange={(e) => onChange({ expText: e.target.value })}
          />
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-[11px]">العميل (اختياري)</Label>
          <SearchableSelect
            value={line.customerId}
            onValueChange={(v) => onChange({ customerId: v, contractId: "none" })}
            options={[
              { value: "none", label: "بلا عميل" },
              ...customers.map((c) => ({ value: String(c.id), label: c.name })),
            ]}
            placeholder="بلا عميل"
            searchPlaceholder="ابحث بالاسم…"
            emptyText="لا نتائج مطابقة"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">العقد (اختياري)</Label>
          <SearchableSelect
            value={line.contractId}
            onValueChange={(v) => onChange({ contractId: v })}
            disabled={line.customerId === "none"}
            options={[
              { value: "none", label: "بلا عقد" },
              ...custContracts.map((c) => ({ value: String(c.id), label: `${c.contractNumber} — ${c.contractName}` })),
            ]}
            placeholder={line.customerId === "none" ? "اختر عميلًا أولًا" : "بلا عقد"}
            searchPlaceholder="ابحث برقم/اسم العقد…"
            emptyText="لا نتائج مطابقة"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-[11px]">المبلغ *</Label>
          <Input
            className="h-9 ltr text-start"
            inputMode="decimal"
            value={line.amount}
            onChange={(e) => onChange({ amount: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">البيان</Label>
          <Input
            className="h-9"
            placeholder="وصف البند (فارغ ⇒ تلقائي «العميل — المصروف»)"
            value={line.description}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

export function CustodyView({ user, onAuthError }: CustodyViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);

  // ===== البيانات =====
  const accountsQuery = useQuery<CustodyAccountsResponse>({
    queryKey: ["custody-accounts"],
    queryFn: () => apiGet<CustodyAccountsResponse>("/api/custody/accounts"),
  });
  const overviewQuery = useQuery<CustodyOverviewResponse>({
    queryKey: ["custody-overview"],
    queryFn: () => apiGet<CustodyOverviewResponse>("/api/custody/overview"),
  });
  const settlementsQuery = useQuery<CustodySettlementsResponse>({
    queryKey: ["custody-settlements"],
    queryFn: () => apiGet<CustodySettlementsResponse>("/api/custody/settlements"),
  });

  React.useEffect(() => {
    const e = accountsQuery.error ?? overviewQuery.error ?? settlementsQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [accountsQuery.error, overviewQuery.error, settlementsQuery.error, onAuthError]);

  // تسطيح شجرة الحسابات (items + children)
  const flatAccounts: CustodyAccountItem[] = [];
  const walk = (list: CustodyAccountItem[]) => {
    for (const a of list) {
      flatAccounts.push(a);
      if (a.children?.length) walk(a.children);
    }
  };
  walk(accountsQuery.data?.items ?? []);
  const activeAccounts = flatAccounts.filter((a) => a.isActive);

  // ===== بطاقات علوية =====
  const overviewItems = overviewQuery.data?.items ?? [];
  const totalBalance = overviewItems.length
    ? round3(overviewItems.reduce((s, i) => s + Number(i.balance || 0), 0))
    : round3(activeAccounts.reduce((s, a) => s + Number(a.balance || 0), 0));
  const custodyCount = overviewItems.length || activeAccounts.length;
  const settlements = [...(settlementsQuery.data?.items ?? [])].sort((a, b) =>
    (b.vdate + b.ref).localeCompare(a.vdate + a.ref)
  );
  const lastSettlement = settlements[0] ?? null;

  // ===== التبويبات =====
  const [tab, setTab] = React.useState<CustodyTab>("accounts");

  // ===== دفتر الحركة =====
  const [lAccount, setLAccount] = React.useState("none");
  const [lFrom, setLFrom] = React.useState("");
  const [lTo, setLTo] = React.useState("");
  const [lKind, setLKind] = React.useState("all");
  const lAccountNum = lAccount !== "none" ? Number(lAccount) : null;

  const ledgerParams = new URLSearchParams();
  if (lAccountNum !== null) ledgerParams.set("accountId", String(lAccountNum));
  if (lFrom) ledgerParams.set("from", lFrom);
  if (lTo) ledgerParams.set("to", lTo);
  if (lKind !== "all") ledgerParams.set("kind", lKind);

  const ledgerQuery = useQuery<CustodyLedgerResponse>({
    queryKey: ["custody-ledger", lAccountNum, lFrom, lTo, lKind],
    queryFn: () => apiGet<CustodyLedgerResponse>(`/api/custody/ledger?${ledgerParams.toString()}`),
    enabled: tab === "ledger" && lAccountNum !== null,
  });
  const ledgerRows = ledgerQuery.data?.rows ?? [];
  // الرصيد التراكمي: من الخلفي إن وُجد وإلا محليًا (handover + / settlement − / return −)
  const ledgerComputed = ledgerRows.reduce<{ row: (typeof ledgerRows)[number]; running: number }[]>(
    (acc, r) => {
      const prev = acc.length ? acc[acc.length - 1].running : 0;
      const sign = r.kind === "handover" ? 1 : -1;
      const bal =
        typeof r.balance === "number" ? r.balance : round3(prev + sign * Number(r.amount || 0));
      acc.push({ row: r, running: bal });
      return acc;
    },
    []
  );
  const ledgerAccount = flatAccounts.find((a) => a.id === lAccountNum) ?? null;

  const openLedgerFor = (accountId: number) => {
    setLAccount(String(accountId));
    setTab("ledger");
  };

  // ===== تسليم عهدة (سند صرف بلا حساب مصروف) =====
  const [handoverTarget, setHandoverTarget] = React.useState<CustodyAccountItem | null>(null);
  const [hAmount, setHAmount] = React.useState("");
  const [hDate, setHDate] = React.useState("");
  const [hDesc, setHDesc] = React.useState("");
  const [handoverError, setHandoverError] = React.useState("");

  const handoverMutation = useMutation({
    mutationFn: (vars: { custodyAccountId: number; account: string; amount: number; vdate: string; description?: string }) =>
      apiPost<{ voucher?: { voucherNumber?: string }; item?: { voucherNumber?: string } }>(
        "/api/vouchers",
        {
          vtype: "payment",
          custodyAccountId: vars.custodyAccountId,
          account: vars.account,
          amount: vars.amount,
          vdate: vars.vdate,
          description: vars.description,
        }
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["custody-accounts"] });
      qc.invalidateQueries({ queryKey: ["custody-overview"] });
      qc.invalidateQueries({ queryKey: ["custody-ledger"] });
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setHandoverTarget(null);
      toast({
        title: "سُلّمت العهدة",
        description: `سند: ${res.voucher?.voucherNumber ?? res.item?.voucherNumber ?? "PV"}`,
      });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      setHandoverError(errMessage(e));
      toast({ variant: "destructive", title: "تعذر تسليم العهدة", description: errMessage(e) });
    },
  });

  const openHandover = (acc: CustodyAccountItem) => {
    setHAmount("");
    setHDate(todayStr());
    setHDesc("");
    setHandoverError("");
    setHandoverTarget(acc);
  };

  const submitHandover = () => {
    if (!handoverTarget) return;
    if (!(Number(hAmount) > 0)) {
      toast({ variant: "destructive", title: "أدخل مبلغًا أكبر من صفر" });
      return;
    }
    if (!hDate) {
      toast({ variant: "destructive", title: "حدد تاريخ التسليم" });
      return;
    }
    setHandoverError("");
    handoverMutation.mutate({
      custodyAccountId: handoverTarget.id,
      account: handoverTarget.name,
      amount: Number(hAmount),
      vdate: hDate,
      description: hDesc.trim() || undefined,
    });
  };

  // ===== إرجاع عهدة (CV بسقف المتبقي — بلا أثر إيرادي ولا رسوم) =====
  const [returnTarget, setReturnTarget] = React.useState<CustodyAccountItem | null>(null);
  const [rAmount, setRAmount] = React.useState("");
  const [rDate, setRDate] = React.useState("");
  const [rMethod, setRMethod] = React.useState("none");
  const [returnError, setReturnError] = React.useState("");

  const methodsQuery = useQuery<PaymentMethodsResponse>({
    queryKey: ["payment-methods"],
    queryFn: () => apiGet<PaymentMethodsResponse>("/api/payment-methods"),
    enabled: returnTarget !== null,
  });
  const methods = (methodsQuery.data?.methods ?? []).filter((m) => m.isActive);

  const returnMutation = useMutation({
    mutationFn: (vars: { custodyAccountId: number; amount: number; vdate: string; method?: string }) =>
      apiPost<{ item?: { voucherNumber?: string }; voucherNumber?: string }>("/api/custody/returns", {
        vdate: vars.vdate,
        custodyAccountId: vars.custodyAccountId,
        amount: vars.amount,
        method: vars.method,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["custody-accounts"] });
      qc.invalidateQueries({ queryKey: ["custody-overview"] });
      qc.invalidateQueries({ queryKey: ["custody-ledger"] });
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setReturnTarget(null);
      toast({
        title: "سُجل إرجاع العهدة",
        description: `سند: ${res.item?.voucherNumber ?? res.voucherNumber ?? "CV"}`,
      });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      // «يتجاوز متبقي العهدة» تُعرض حرفيًا
      setReturnError(errMessage(e));
      toast({ variant: "destructive", title: "رُفض الإرجاع", description: errMessage(e) });
    },
  });

  const openReturn = (acc: CustodyAccountItem) => {
    setRAmount("");
    setRDate(todayStr());
    setRMethod("none");
    setReturnError("");
    setReturnTarget(acc);
  };

  const submitReturn = () => {
    if (!returnTarget) return;
    if (!(Number(rAmount) > 0)) {
      toast({ variant: "destructive", title: "أدخل مبلغًا أكبر من صفر" });
      return;
    }
    if (!rDate) {
      toast({ variant: "destructive", title: "حدد تاريخ الإرجاع" });
      return;
    }
    setReturnError("");
    returnMutation.mutate({
      custodyAccountId: returnTarget.id,
      amount: Number(rAmount),
      vdate: rDate,
      method: rMethod !== "none" ? rMethod : undefined,
    });
  };

  // ===== تصفية جديدة (توزيع مبلغ سبق صرفه — بلا method) =====
  const [settleOpen, setSettleOpen] = React.useState(false);
  const [sAccountId, setSAccountId] = React.useState("none");
  const [sVdate, setSVdate] = React.useState("");
  const [sDescription, setSDescription] = React.useState("");
  const [sLines, setSLines] = React.useState<SettleLineForm[]>([emptySettleLine()]);
  const [settleError, setSettleError] = React.useState("");

  const settlePresetRef = React.useRef<string | null>(null);
  const wasSettleOpen = React.useRef(false);
  const openSettle = (accountId?: number) => {
    settlePresetRef.current = accountId ? String(accountId) : null;
    setSettleOpen(true);
  };
  React.useEffect(() => {
    if (settleOpen && !wasSettleOpen.current) {
      setSAccountId(settlePresetRef.current ?? "none");
      setSVdate(todayStr());
      setSDescription("");
      setSLines([emptySettleLine()]);
      setSettleError("");
      settlePresetRef.current = null;
    }
    wasSettleOpen.current = settleOpen;
  }, [settleOpen]);

  const expenseAccQuery = useQuery<ExpenseAccountDTO[]>({
    queryKey: ["expense-accounts"],
    queryFn: () => apiGet<ExpenseAccountDTO[]>("/api/expense-accounts"),
    enabled: settleOpen,
    retry: false,
  });
  const expenseAccounts: ExpenseAccountDTO[] = expenseAccQuery.data ?? [];
  const expenseReady = expenseAccQuery.isSuccess && expenseAccounts.length > 0;

  const customersQuery = useQuery<CustomersResponse>({
    queryKey: ["customers", ""],
    queryFn: () => apiGet<CustomersResponse>("/api/customers"),
    enabled: settleOpen,
  });
  const customers = (customersQuery.data?.customers ?? []).map((c) => ({ id: c.id, name: c.name }));

  // حسابات العهدة المتاحة للتصفية (غير المصفّى — رصيد موجب)
  const settleCandidates = activeAccounts.filter((a) => Number(a.balance || 0) > 0.001);
  const settleAccount =
    sAccountId !== "none"
      ? flatAccounts.find((a) => String(a.id) === sAccountId) ?? null
      : null;
  const sAvailable = settleAccount ? Number(settleAccount.balance || 0) : 0;
  const sTotal = round3(
    sLines.reduce((sum, l) => sum + (Number(l.amount) > 0 ? Number(l.amount) : 0), 0)
  );
  const sAfter = round3(sAvailable - sTotal);

  const settleMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiPost<{ ref?: string; groupRef?: string }>("/api/custody/settlements", body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["custody-accounts"] });
      qc.invalidateQueries({ queryKey: ["custody-overview"] });
      qc.invalidateQueries({ queryKey: ["custody-settlements"] });
      qc.invalidateQueries({ queryKey: ["custody-ledger"] });
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setSettleOpen(false);
      toast({ title: "سُجلت التصفية", description: `المرجع: ${res.ref ?? res.groupRef ?? "PAY-GRP"}` });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      // رفض الخلفية يُعرض حرفيًا داخل الحوار
      setSettleError(errMessage(e));
      toast({ variant: "destructive", title: "رُفضت التصفية", description: errMessage(e) });
    },
  });

  const submitSettle = () => {
    if (sAccountId === "none") {
      toast({ variant: "destructive", title: "اختر حساب العهدة" });
      return;
    }
    if (!sVdate) {
      toast({ variant: "destructive", title: "حدد تاريخ التصفية" });
      return;
    }
    const filled = sLines.filter((l) => Number(l.amount) > 0);
    if (filled.length === 0) {
      toast({ variant: "destructive", title: "أضف بندًا واحدًا على الأقل بمبلغ أكبر من صفر" });
      return;
    }
    for (let i = 0; i < filled.length; i++) {
      const l = filled[i];
      const hasAccount = expenseReady
        ? l.expChild !== "none" || l.expParent !== "none"
        : !!l.expText.trim();
      if (!hasAccount) {
        toast({ variant: "destructive", title: `البند ${i + 1}: حساب المصروف إلزامي` });
        return;
      }
    }
    setSettleError("");
    settleMutation.mutate({
      vdate: sVdate,
      custodyAccountId: Number(sAccountId),
      description: sDescription.trim() || undefined,
      lines: filled.map((l) => {
        const child = l.expChild !== "none" ? expenseAccounts.find((a) => String(a.id) === l.expChild) : null;
        const parent = l.expParent !== "none" ? expenseAccounts.find((a) => String(a.id) === l.expParent) : null;
        const expenseAccountId = child ? child.id : parent ? parent.id : null;
        return {
          expenseAccountId,
          expenseAccountName: expenseAccountId === null ? l.expText.trim() : undefined,
          customerId: l.customerId !== "none" ? Number(l.customerId) : undefined,
          contractId: l.contractId !== "none" ? Number(l.contractId) : undefined,
          amount: Number(l.amount),
          description: l.description.trim() || undefined,
        };
      }),
    });
  };

  // ===== تفاصيل تصفية =====
  const [detailRef, setDetailRef] = React.useState<string | null>(null);
  const detailQuery = useQuery<CustodySettlementDetailResponse>({
    queryKey: ["custody-settlement", detailRef],
    queryFn: () => apiGet<CustodySettlementDetailResponse>(`/api/custody/settlements/${detailRef}`),
    enabled: detailRef !== null,
  });

  // ===== إلغاء تصفية (مدير — بسبب إلزامي) =====
  const [cancelTarget, setCancelTarget] = React.useState<CustodySettlementItem | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");
  const [cancelError, setCancelError] = React.useState("");

  const cancelMutation = useMutation({
    mutationFn: (vars: { ref: string; reason: string }) =>
      apiFetch<{ restored?: boolean }>(`/api/custody/settlements/${vars.ref}`, {
        method: "DELETE",
        body: { reason: vars.reason },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custody-accounts"] });
      qc.invalidateQueries({ queryKey: ["custody-overview"] });
      qc.invalidateQueries({ queryKey: ["custody-settlements"] });
      qc.invalidateQueries({ queryKey: ["custody-ledger"] });
      qc.invalidateQueries({ queryKey: ["custody-settlement"] });
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setCancelTarget(null);
      toast({ title: "أُلغيت التصفية", description: "رُجعت بنود التصفية وأُلغيت سنداتها" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      setCancelError(errMessage(e));
      toast({ variant: "destructive", title: "تعذر إلغاء التصفية", description: errMessage(e) });
    },
  });

  const submitCancel = () => {
    if (!cancelTarget) return;
    if (!cancelReason.trim()) {
      toast({ variant: "destructive", title: "أدخل سبب الإلغاء" });
      return;
    }
    setCancelError("");
    cancelMutation.mutate({ ref: cancelTarget.ref, reason: cancelReason.trim() });
  };

  // ===== صفحة «إدارة حسابات العهدة» (بدل النافذة) — مدير =====
  const [accountsPage, setAccountsPage] = React.useState(false);

  // ===== بطاقة حساب عهدة =====
  const renderAccountCard = (acc: CustodyAccountItem) => {
    const balance = Number(acc.balance || 0);
    return (
      <Card key={acc.id} className={acc.isActive ? "" : "opacity-60"}>
        <CardContent className="space-y-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold">{acc.name}</div>
              {acc.fullPath && acc.fullPath !== acc.name && (
                <div className="truncate text-[11px] text-muted-foreground" title={acc.fullPath}>
                  {acc.fullPath}
                </div>
              )}
            </div>
            {!acc.isActive && (
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                معطّل
              </Badge>
            )}
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">الرصيد الحالي</div>
            <div className={`text-xl font-extrabold tabular-nums ${balanceTone(balance)}`}>
              {formatKWD(balance)}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>مُسلَّم: {formatKWD(acc.handed)}</span>
            <span>مُصروف: {formatKWD(acc.spent)}</span>
            <span>مرتجع: {formatKWD(acc.returned)}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              disabled={!acc.isActive}
              onClick={() => openLedgerFor(acc.id)}
            >
              <BookOpen className="size-3.5" />
              دفتر الحركة
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 border-status-warn/40 px-2 text-xs text-status-warn hover:bg-status-warn-bg hover:text-status-warn"
              disabled={!acc.isActive}
              onClick={() => openHandover(acc)}
            >
              <ArrowUpToLine className="size-3.5" />
              تسليم
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 border-status-done/40 px-2 text-xs text-status-done hover:bg-status-done-bg hover:text-status-done"
              disabled={!acc.isActive || balance <= 0.001}
              onClick={() => openReturn(acc)}
            >
              <Undo2 className="size-3.5" />
              إرجاع
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 border-status-info/40 px-2 text-xs text-status-info hover:bg-status-info-bg hover:text-status-info"
              disabled={!acc.isActive || balance <= 0.001}
              onClick={() => openSettle(acc.id)}
            >
              <ClipboardCheck className="size-3.5" />
              تصفية
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderSettlementActions = (s: CustodySettlementItem) => (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs text-muted-foreground"
        onClick={() => setDetailRef(s.ref)}
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
            setCancelReason("");
            setCancelError("");
            setCancelTarget(s);
          }}
        >
          <XCircle className="size-3.5" />
          إلغاء
        </Button>
      )}
    </div>
  );

  // صفحة «إدارة حسابات العهدة» تُعرض مكان الشاشة مباشرة (لا نافذة) — بعد كل الـhooks
  if (accountsPage) {
    return <CustodyAccountsPage onAuthError={onAuthError} onCancel={() => setAccountsPage(false)} />;
  }

  return (
    <div className="space-y-4">
      {/* العنوان */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-extrabold sm:text-xl">
            <Wallet className="size-5 text-primary" />
            العُهد
          </h1>
          <p className="text-xs text-muted-foreground">
            العهدة = حساب advance والرصيد محسوب (مُسلَّم − مُصروف − مرتجع) — التصفية توزّع مبلغًا سبق صرفه ولا تصرف نقدًا جديدًا.
          </p>
        </div>
        {manager && (
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setAccountsPage(true)}>
            <Settings2 className="size-4" />
            إدارة الحسابات
          </Button>
        )}
      </div>

      {/* البطاقات العلوية */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard
          icon={Wallet}
          label="إجمالي الأرصدة لدى العُهد"
          value={formatKWD(totalBalance)}
          sub="مُسلَّم − مُصروف − مرتجع"
          tone={balanceTone(totalBalance)}
        />
        <KpiCard
          icon={HandCoins}
          label="عدد العُهد"
          value={String(custodyCount)}
          sub={`${activeAccounts.length} حساب نشط`}
        />
        <KpiCard
          icon={ClipboardCheck}
          label="آخر تصفية"
          value={lastSettlement ? lastSettlement.ref : "—"}
          sub={
            lastSettlement
              ? `${fmtDate(lastSettlement.vdate)} · ${formatKWD(lastSettlement.total)} · ${lastSettlement.linesCount} بنود`
              : "لا تصفيات بعد"
          }
        />
      </div>

      {/* التبويبات */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as CustodyTab)}>
        <TabsList className="h-auto w-full justify-start overflow-x-auto">
          <TabsTrigger value="accounts" className="gap-1.5">
            <Wallet className="size-4" />
            الحسابات
            <Badge variant="secondary" className="ms-1 h-5 px-1.5 text-[10px]">
              {activeAccounts.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="settlements" className="gap-1.5">
            <ClipboardCheck className="size-4" />
            التصفيات
            <Badge variant="secondary" className="ms-1 h-5 px-1.5 text-[10px]">
              {settlements.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="ledger" className="gap-1.5">
            <BookOpen className="size-4" />
            السجل
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-1.5">
            <BarChart3 className="size-4" />
            التقارير
          </TabsTrigger>
        </TabsList>

        {/* ===== الحسابات ===== */}
        <TabsContent value="accounts" className="mt-3 space-y-3">
            {accountsQuery.isLoading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-44 w-full" />
                ))}
              </div>
            ) : accountsQuery.isError ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-destructive">
                  تعذر تحميل حسابات العهدة — {errMessage(accountsQuery.error)}
                </CardContent>
              </Card>
            ) : activeAccounts.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                  <Wallet className="size-8 text-muted-foreground/50" />
                  <p className="text-sm font-medium">لا حسابات عهدة نشطة</p>
                  <p className="text-xs text-muted-foreground">
                    العهدة حساب في شجرة حسابات المصاريف بنوع advance — أنشئها من «إدارة الحسابات».
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {activeAccounts.map(renderAccountCard)}
                {manager &&
                  flatAccounts
                    .filter((a) => !a.isActive)
                    .map(renderAccountCard)}
              </div>
            )}
        </TabsContent>

        {/* ===== التصفيات ===== */}
        <TabsContent value="settlements" className="mt-3 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" className="h-9 gap-1.5" onClick={() => openSettle()}>
              <Plus className="size-4" />
              تصفية جديدة
            </Button>
          </div>
          {settlementsQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : settlementsQuery.isError ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-destructive">
                تعذر تحميل التصفيات — {errMessage(settlementsQuery.error)}
              </CardContent>
            </Card>
          ) : settlements.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                <ClipboardCheck className="size-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">لا تصفيات بعد</p>
                <p className="text-xs text-muted-foreground">
                  التصفية توزّع رصيد عهدة على بنود مصروف (كل بند سند صرف مستقل تحت مرجع PAY-GRP موحّد).
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
                        <TableHead className="text-start">المرجع</TableHead>
                        <TableHead className="text-start">التاريخ</TableHead>
                        <TableHead className="text-start">العهدة</TableHead>
                        <TableHead className="text-start">الإجمالي</TableHead>
                        <TableHead className="text-start">عدد البنود</TableHead>
                        <TableHead className="text-start">البيان</TableHead>
                        <TableHead className="text-start">إجراءات</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {settlements.map((s) => (
                        <TableRow key={s.ref}>
                          <TableCell className="whitespace-nowrap font-mono text-xs font-bold">{s.ref}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs">{fmtDate(s.vdate)}</TableCell>
                          <TableCell className="text-xs font-semibold">{s.custodyName}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs font-bold tabular-nums">
                            {formatKWD(s.total)}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums">{s.linesCount}</TableCell>
                          <TableCell className="max-w-48">
                            <div className="truncate text-xs text-muted-foreground" title={s.description ?? ""}>
                              {s.description || "—"}
                            </div>
                          </TableCell>
                          <TableCell>{renderSettlementActions(s)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              {/* موبايل */}
              <div className="space-y-2 md:hidden">
                {settlements.map((s) => (
                  <Card key={s.ref}>
                    <CardContent className="space-y-2 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold">{s.ref}</span>
                        <span className="ms-auto text-sm font-bold tabular-nums">{formatKWD(s.total)}</span>
                      </div>
                      <div className="text-xs">
                        <span className="font-semibold">{s.custodyName}</span>
                        <span className="text-muted-foreground"> · {fmtDate(s.vdate)} · {s.linesCount} بنود</span>
                      </div>
                      {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                      {renderSettlementActions(s)}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        {/* ===== السجل (دفتر الحركة) ===== */}
        <TabsContent value="ledger" className="mt-3 space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Select value={lAccount} onValueChange={setLAccount}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="حساب العهدة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">اختر حساب العهدة</SelectItem>
                {flatAccounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.fullPath || a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="date" className="h-9" aria-label="من تاريخ" value={lFrom} onChange={(e) => setLFrom(e.target.value)} />
            <Input type="date" className="h-9" aria-label="إلى تاريخ" value={lTo} onChange={(e) => setLTo(e.target.value)} />
            <Select value={lKind} onValueChange={setLKind}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="نوع الحركة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحركات</SelectItem>
                {LEDGER_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {CUSTODY_KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {lAccountNum === null ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                <BookOpen className="size-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">اختر حساب عهدة لعرض دفتر حركته</p>
                <p className="text-xs text-muted-foreground">
                  الدفتر يجمع التسليم والتصفية والإرجاع برصيد تراكمي — أو افتحه من زر «دفتر الحركة» في بطاقة العهدة.
                </p>
              </CardContent>
            </Card>
          ) : ledgerQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : ledgerQuery.isError ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-destructive">
                تعذر تحميل دفتر الحركة — {errMessage(ledgerQuery.error)}
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                <span className="text-xs text-muted-foreground">
                  {ledgerAccount?.fullPath || ledgerAccount?.name} · {ledgerComputed.length} حركة
                </span>
                <span className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">الرصيد:</span>
                  <span className={`font-extrabold tabular-nums ${balanceTone(ledgerQuery.data?.balance ?? 0)}`}>
                    {formatKWD(ledgerQuery.data?.balance ?? 0)}
                  </span>
                </span>
              </div>
              {ledgerComputed.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center text-sm text-muted-foreground">
                    لا حركات مطابقة للفلاتر
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
                            <TableHead className="text-start">السند</TableHead>
                            <TableHead className="text-start">الحركة</TableHead>
                            <TableHead className="text-start">التاريخ</TableHead>
                            <TableHead className="text-start">المبلغ</TableHead>
                            <TableHead className="text-start">الرصيد التراكمي</TableHead>
                            <TableHead className="text-start">المرجع</TableHead>
                            <TableHead className="text-start">البيان</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ledgerComputed.map(({ row, running: bal }) => {
                            const sign = row.kind === "handover" ? "+" : "−";
                            return (
                              <TableRow key={`${row.voucherId}-${row.voucherNumber}`}>
                                <TableCell>
                                  <Badge
                                    className={`border-transparent font-mono text-[11px] ${VOUCHER_TYPE_BADGE[row.vtype] ?? ""}`}
                                  >
                                    {row.voucherNumber}
                                  </Badge>
                                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                                    {VOUCHER_TYPE_LABEL[row.vtype] ?? row.vtype}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge className={`border-transparent text-[11px] ${CUSTODY_KIND_BADGE[row.kind] ?? ""}`}>
                                    {CUSTODY_KIND_LABEL[row.kind] ?? row.kind}
                                  </Badge>
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-xs">{fmtDate(row.vdate)}</TableCell>
                                <TableCell
                                  className={`whitespace-nowrap text-xs font-bold tabular-nums ${
                                    row.kind === "handover"
                                      ? "text-status-done"
                                      : "text-status-danger"
                                  }`}
                                >
                                  {sign} {formatKWD(row.amount)}
                                </TableCell>
                                <TableCell className={`whitespace-nowrap text-xs font-bold tabular-nums ${balanceTone(bal)}`}>
                                  {formatKWD(bal)}
                                </TableCell>
                                <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                                  {row.groupRef || "—"}
                                </TableCell>
                                <TableCell className="max-w-52">
                                  <div className="truncate text-xs" title={row.description ?? ""}>
                                    {row.description || "—"}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                  {/* موبايل */}
                  <div className="space-y-2 md:hidden">
                    {ledgerComputed.map(({ row, running: bal }) => (
                      <Card key={`${row.voucherId}-${row.voucherNumber}`}>
                        <CardContent className="space-y-1.5 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className={`border-transparent font-mono text-[11px] ${VOUCHER_TYPE_BADGE[row.vtype] ?? ""}`}>
                              {row.voucherNumber}
                            </Badge>
                            <Badge className={`border-transparent text-[11px] ${CUSTODY_KIND_BADGE[row.kind] ?? ""}`}>
                              {CUSTODY_KIND_LABEL[row.kind] ?? row.kind}
                            </Badge>
                            <span className="ms-auto text-sm font-bold tabular-nums">
                              {row.kind === "handover" ? "+" : "−"} {formatKWD(row.amount)}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                            <span>{fmtDate(row.vdate)}</span>
                            <span>
                              الرصيد: <span className={`font-bold tabular-nums ${balanceTone(bal)}`}>{formatKWD(bal)}</span>
                            </span>
                            {row.groupRef && <span className="font-mono">{row.groupRef}</span>}
                          </div>
                          {row.description && <p className="text-xs">{row.description}</p>}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </TabsContent>

        {/* ===== التقارير السبعة (مرآة مركز العهد المكتبي) ===== */}
        <TabsContent value="reports" className="mt-3 space-y-3">
          <CustodyReports accounts={activeAccounts} onAuthError={onAuthError} />
        </TabsContent>
      </Tabs>

      {/* ===== حوار تسليم عهدة ===== */}
      <Dialog open={handoverTarget !== null} onOpenChange={(o) => !o && setHandoverTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>تسليم عهدة — {handoverTarget?.name ?? ""}</DialogTitle>
            <DialogDescription>
              سند صرف يخرج نقدًا من الخزينة إلى ذمة العهدة (بلا حساب مصروف).
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>التاريخ *</Label>
                <Input type="date" className="h-9" value={hDate} onChange={(e) => setHDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>المبلغ *</Label>
                <Input
                  className="h-9 ltr text-start"
                  inputMode="decimal"
                  value={hAmount}
                  onChange={(e) => setHAmount(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>البيان</Label>
              <Input
                className="h-9"
                placeholder="مثال: تسليم عهدة مشتريات"
                value={hDesc}
                onChange={(e) => setHDesc(e.target.value)}
              />
            </div>
          </div>
          {handoverError && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs font-semibold text-destructive">
              {handoverError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setHandoverTarget(null)}>
              إلغاء
            </Button>
            <Button className="h-9" disabled={handoverMutation.isPending} onClick={submitHandover}>
              {handoverMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              تسليم
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== حوار إرجاع عهدة ===== */}
      <Dialog open={returnTarget !== null} onOpenChange={(o) => !o && setReturnTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>إرجاع عهدة — {returnTarget?.name ?? ""}</DialogTitle>
            <DialogDescription>
              سند CV يدخل المتبقي إلى الخزينة بلا أثر إيرادي ولا رسوم — المبلغ المرفوض إن تجاوز المتبقي.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">
            المتبقي المتاح للإرجاع:{" "}
            <span className={`font-extrabold tabular-nums ${balanceTone(Number(returnTarget?.balance || 0))}`}>
              {formatKWD(returnTarget?.balance ?? 0)}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>التاريخ *</Label>
                <Input type="date" className="h-9" value={rDate} onChange={(e) => setRDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>المبلغ *</Label>
                <Input
                  className="h-9 ltr text-start"
                  inputMode="decimal"
                  value={rAmount}
                  onChange={(e) => setRAmount(e.target.value)}
                />
              </div>
            </div>
            {Number(rAmount) > Number(returnTarget?.balance || 0) + 0.001 && (
              <p className="rounded-lg border border-status-warn/40 bg-status-warn-bg p-2 text-xs font-semibold text-status-warn">
                المبلغ يتجاوز المتبقي ({formatKWD(returnTarget?.balance ?? 0)}) — سيُرفض من الخلفي
              </p>
            )}
            <div className="space-y-1.5">
              <Label>الطريقة (اختياري)</Label>
              <Select value={rMethod} onValueChange={setRMethod}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="بدون" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون</SelectItem>
                  {methods.map((m) => (
                    <SelectItem key={m.id} value={m.name}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {returnError && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs font-semibold text-destructive">
              {returnError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setReturnTarget(null)}>
              إلغاء
            </Button>
            <Button className="h-9" disabled={returnMutation.isPending} onClick={submitReturn}>
              {returnMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              إرجاع
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== حوار تصفية جديدة ===== */}
      <Dialog open={settleOpen} onOpenChange={setSettleOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>تصفية عهدة</DialogTitle>
            <DialogDescription>
              توزيع رصيد سبق صرفه على بنود مصروف — لا يصرف نقدًا جديدًا ولا يحتاج طريقة دفع (القاعدة 8).
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>حساب العهدة *</Label>
              <Select value={sAccountId} onValueChange={setSAccountId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="اختر العهدة" />
                </SelectTrigger>
                <SelectContent>
                  {settleCandidates.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name} — متاح {formatKWD(a.balance)}
                    </SelectItem>
                  ))}
                  {settleAccount && !settleCandidates.some((a) => a.id === settleAccount.id) && (
                    <SelectItem value={String(settleAccount.id)}>
                      {settleAccount.name} — متاح {formatKWD(settleAccount.balance)}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>تاريخ التصفية *</Label>
              <Input type="date" className="h-9" value={sVdate} onChange={(e) => setSVdate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>بيان عام (اختياري)</Label>
            <Input
              className="h-9"
              placeholder="يُوسم على سندات البنود: تصفية عهدة من حساب: …"
              value={sDescription}
              onChange={(e) => setSDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold">بنود التصفية</span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => setSLines((prev) => [...prev, emptySettleLine()])}
              >
                <Plus className="size-3.5" />
                إضافة بند
              </Button>
            </div>
            {sLines.map((l, i) => (
              <SettleLineRow
                key={i}
                index={i}
                line={l}
                onChange={(patch) =>
                  setSLines((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)))
                }
                onRemove={() =>
                  setSLines((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))
                }
                expenseAccounts={expenseAccounts}
                expenseReady={expenseReady}
                customers={customers}
              />
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-center text-xs">
            <div>
              <div className="text-muted-foreground">إجمالي البنود</div>
              <div className="font-extrabold tabular-nums">{formatKWD(sTotal)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">المتاح بالعهدة</div>
              <div className="font-extrabold tabular-nums">{formatKWD(sAvailable)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">الرصيد بعد التصفية</div>
              <div className={`font-extrabold tabular-nums ${balanceTone(sAfter)}`}>{formatKWD(sAfter)}</div>
            </div>
          </div>
          {sAfter < -0.001 && (
            <p className="rounded-lg border border-status-warn/40 bg-status-warn-bg p-2 text-xs font-semibold text-status-warn">
              تجاوز الرصيد تحذيري فقط — يُحفظ والرصيد السالب يظهر أحمر
            </p>
          )}
          {settleError && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs font-semibold text-destructive">
              {settleError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setSettleOpen(false)}>
              إلغاء
            </Button>
            <Button className="h-9" disabled={settleMutation.isPending} onClick={submitSettle}>
              {settleMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              حفظ التصفية
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== حوار تفاصيل التصفية ===== */}
      <Dialog open={detailRef !== null} onOpenChange={(o) => !o && setDetailRef(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>تصفية {detailQuery.data?.item.ref ?? detailRef}</DialogTitle>
            <DialogDescription>
              بنود المجموعة — كل بند سند صرف مستقل تحت المرجع نفسه.
            </DialogDescription>
          </DialogHeader>
          {detailQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : detailQuery.isError ? (
            <p className="py-4 text-center text-sm text-destructive">
              تعذر تحميل التفاصيل — {errMessage(detailQuery.error)}
            </p>
          ) : detailQuery.data ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-3 text-xs sm:grid-cols-4">
                <div>
                  <div className="text-muted-foreground">التاريخ</div>
                  <div className="font-bold">{fmtDate(detailQuery.data.item.vdate)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">العهدة</div>
                  <div className="font-bold">{detailQuery.data.item.custodyName}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">الإجمالي</div>
                  <div className="font-extrabold tabular-nums">{formatKWD(detailQuery.data.item.total)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">عدد البنود</div>
                  <div className="font-bold tabular-nums">{detailQuery.data.item.linesCount}</div>
                </div>
              </div>
              {detailQuery.data.item.description && (
                <p className="text-xs text-muted-foreground">{detailQuery.data.item.description}</p>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الحساب</TableHead>
                    <TableHead className="text-start">العميل / العقد</TableHead>
                    <TableHead className="text-start">البيان</TableHead>
                    <TableHead className="text-start">المبلغ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailQuery.data.lines.map((l, i) => (
                    <TableRow key={l.id ?? `${l.voucherId ?? i}`}>
                      <TableCell className="text-xs font-semibold">{l.expenseAccountName ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        <div>{l.customerName ?? "—"}</div>
                        {l.contractNumber && (
                          <div className="text-[11px] text-muted-foreground">{l.contractNumber}</div>
                        )}
                      </TableCell>
                      <TableCell className="max-w-40">
                        <div className="truncate text-xs" title={l.description ?? ""}>
                          {l.description || "—"}
                        </div>
                        {l.voucherNumber && (
                          <div className="font-mono text-[10px] text-muted-foreground">{l.voucherNumber}</div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs font-bold tabular-nums">
                        {formatKWD(l.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ===== حوار إلغاء تصفية (مدير) ===== */}
      <Dialog open={cancelTarget !== null} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>إلغاء التصفية {cancelTarget?.ref ?? ""}</DialogTitle>
            <DialogDescription>
              تُلغى سندات بنود المجموعة وتُعاد القيمة إلى رصيد العهدة — السبب إلزامي ويُوثَّق.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>سبب الإلغاء *</Label>
            <Textarea rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </div>
          {cancelError && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs font-semibold text-destructive">
              {cancelError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setCancelTarget(null)}>
              رجوع
            </Button>
            <Button
              variant="destructive"
              className="h-9"
              disabled={cancelMutation.isPending || !cancelReason.trim()}
              onClick={submitCancel}
            >
              {cancelMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              تأكيد الإلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
