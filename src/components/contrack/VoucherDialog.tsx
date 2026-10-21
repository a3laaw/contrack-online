"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgeCheck, Banknote, Loader2, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPost } from "./api";
import { errMessage, isManagerRole } from "./contrack-types";
import { round3 } from "@/lib/format";
import type {
  ContractListItem,
  ContractsResponse,
  CustomerContractRow,
  CustomerDetailResponse,
  EmployeeDTO,
  ExpenseAccountDTO,
  PaymentLinkResponse,
  PaymentLinkValidateResult,
  PaymentMethodDTO,
  PayLinkLine,
  PaymentMethodsResponse,
  SubContractDetailResponse,
  SubContractsResponse,
  User,
  VoucherType,
} from "./contrack-types";
import { VOUCHER_TYPE_LABEL } from "./contrack-types";
import { formatKWD } from "@/lib/format";

export interface VoucherDialogPreset {
  vtype?: VoucherType;
  contractId?: number;
  contractNumber?: string;
  customerId?: number;
  customerName?: string;
  subContractId?: number;
  subLabel?: string;
  /** فتح قسم «باطن» ضمن الصرف معبأً مسبقًا */
  subMode?: boolean;
}

interface VoucherDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User;
  onAuthError: () => void;
  preset?: VoucherDialogPreset;
  onSaved?: () => void;
}

type PayKind = "expense" | "custody" | "subcontract" | "partner";

const VOUCHER_TYPES: VoucherType[] = ["receipt", "payment", "transfer", "custody_return", "salary_deduction"];
const ACCOUNT_OPTIONS = ["صندوق", "بنك"];

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** الرسوم البنكية المتوقعة من طريقة الدفع (حساب محلي توضيحي — الخلفي هو المرجع) */
function localBankFee(method: PaymentMethodDTO | null, amount: number): number {
  if (!method || amount <= 0) return 0;
  if (method.feeType === "percent") return round3((amount * Number(method.feeValue || 0)) / 100);
  if (method.feeType === "amount") return round3(Number(method.feeValue || 0));
  return 0;
}

export function VoucherDialog({ open, onOpenChange, user, onAuthError, preset, onSaved }: VoucherDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);

  const [vtype, setVtype] = React.useState<VoucherType>(preset?.vtype ?? "receipt");
  const [payKind, setPayKind] = React.useState<PayKind>(preset?.subMode ? "subcontract" : "expense");

  // حقول مشتركة
  const [amount, setAmount] = React.useState("");
  const [vdate, setVdate] = React.useState(todayStr());
  const [description, setDescription] = React.useState("");
  const [methodId, setMethodId] = React.useState("");
  const [chequeDueDate, setChequeDueDate] = React.useState("");

  // قبض
  const [customerId, setCustomerId] = React.useState<string>(preset?.customerId ? String(preset.customerId) : "none");
  const [contractId, setContractId] = React.useState<string>(preset?.contractId ? String(preset.contractId) : "none");
  const [links, setLinks] = React.useState<{ lineId: number; amount: string }[]>([]);
  const [overpay, setOverpay] = React.useState<{ message: string; remaining: number } | null>(null);

  // صرف — مصروف
  const [expParent, setExpParent] = React.useState("none");
  const [expChild, setExpChild] = React.useState("none");
  const [expAccountText, setExpAccountText] = React.useState("");
  const [expCustomerId, setExpCustomerId] = React.useState("none");
  const [expContractId, setExpContractId] = React.useState("none");

  // صرف — عهدة / إرجاع عهدة
  const [custodyAccountId, setCustodyAccountId] = React.useState("none");
  const [custodyText, setCustodyText] = React.useState("");

  // صرف — باطن
  const [subContractId, setSubContractId] = React.useState<string>(preset?.subContractId ? String(preset.subContractId) : "");
  const [subCapRemaining, setSubCapRemaining] = React.useState<number | null>(null);

  // صرف — شريك
  const [partnerName, setPartnerName] = React.useState("");

  // تحويل
  const [fromAccount, setFromAccount] = React.useState("");
  const [toAccount, setToAccount] = React.useState("");

  // خصم راتب
  const [employeeId, setEmployeeId] = React.useState("none");
  const [employeeText, setEmployeeText] = React.useState("");

  // ===== استعلامات مرجعية =====
  const methodsQuery = useQuery<PaymentMethodsResponse>({
    queryKey: ["payment-methods"],
    queryFn: () => apiGet<PaymentMethodsResponse>("/api/payment-methods"),
  });
  const methods = methodsQuery.data?.methods ?? [];
  const selectedMethod: PaymentMethodDTO | null = methods.find((m) => String(m.id) === methodId) ?? null;
  const isCheque = (selectedMethod?.name || "").includes("شيك");

  const customersQuery = useQuery<{ customers: { id: number; name: string }[] }>({
    queryKey: ["customers", ""],
    queryFn: () => apiGet<{ customers: { id: number; name: string }[] }>("/api/customers"),
    enabled: open && (vtype === "receipt" || (vtype === "payment" && payKind === "expense")),
  });

  const contractsQuery = useQuery<ContractsResponse>({
    queryKey: ["contracts", "", ""],
    queryFn: () => apiGet<ContractsResponse>("/api/contracts"),
    enabled: open && (vtype === "receipt" || (vtype === "payment" && payKind === "subcontract") || (vtype === "payment" && payKind === "expense")),
  });

  const custContractsQuery = useQuery<CustomerDetailResponse>({
    queryKey: ["customer", customerId],
    queryFn: () => apiGet<CustomerDetailResponse>(`/api/customers/${customerId}`),
    enabled: open && vtype === "receipt" && customerId !== "none" && !preset?.contractId,
  });

  const subContractsQuery = useQuery<SubContractsResponse>({
    queryKey: ["sub-contracts", "contract", contractId],
    queryFn: () => apiGet<SubContractsResponse>(`/api/sub-contracts?contractId=${contractId}`),
    enabled: open && vtype === "payment" && payKind === "subcontract" && contractId !== "none" && contractId !== "",
  });

  const subDetailQuery = useQuery<SubContractDetailResponse>({
    queryKey: ["sub-contract", subContractId],
    queryFn: () => apiGet<SubContractDetailResponse>(`/api/sub-contracts/${subContractId}`),
    enabled: open && !!subContractId,
  });

  // حسابات المصاريف (المسار قد لا يكون جاهزًا بعد ⇒ input نصي احتياطي)
  const expenseAccQuery = useQuery<ExpenseAccountDTO[]>({
    queryKey: ["expense-accounts"],
    queryFn: () => apiGet<ExpenseAccountDTO[]>("/api/expense-accounts"),
    enabled: open && (vtype === "payment" || vtype === "custody_return"),
    retry: false,
  });
  const expenseAccounts: ExpenseAccountDTO[] = expenseAccQuery.data ?? [];
  const expenseReady = expenseAccQuery.isSuccess && expenseAccounts.length > 0;
  const expRoots = expenseAccounts.filter((a) => !a.parentId);
  const expChildrenOf = (id: number) => expenseAccounts.filter((a) => a.parentId === id);
  const advanceAccounts = expenseAccounts.filter((a) => a.accountKind === "advance");

  const employeesQuery = useQuery<EmployeeDTO[]>({
    queryKey: ["employees"],
    queryFn: () => apiGet<EmployeeDTO[]>("/api/employees"),
    enabled: open && vtype === "salary_deduction",
    retry: false,
  });
  const employees: EmployeeDTO[] = employeesQuery.data ?? [];

  // خطوط الربط بالدفعات (قبض على عقد)
  const contractIdNum = preset?.contractId ?? (contractId !== "none" && contractId !== "" ? Number(contractId) : null);
  const payLinkQuery = useQuery<PaymentLinkResponse>({
    queryKey: ["payment-link", "receipt", contractIdNum],
    queryFn: () => apiGet<PaymentLinkResponse>(`/api/payment-link?contractId=${contractIdNum}&kind=receipt`),
    enabled: open && vtype === "receipt" && contractIdNum !== null,
    retry: false,
  });
  const payLines: PayLinkLine[] = payLinkQuery.data?.lines ?? [];
  const eligibleLines = payLines.filter((l) => l.eligible !== false && !l.gated);

  // ===== إعادة الضبط عند الفتح (preset في مرجع لتجنب إعادة الضبط مع كل إعادة رسم) =====
  const presetRef = React.useRef(preset);
  React.useEffect(() => {
    presetRef.current = preset;
  }, [preset]);
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      const p = presetRef.current;
      setVtype(p?.vtype ?? "receipt");
      setPayKind(p?.subMode ? "subcontract" : "expense");
      setAmount("");
      setVdate(todayStr());
      setDescription("");
      setMethodId("");
      setChequeDueDate("");
      setCustomerId(p?.customerId ? String(p.customerId) : "none");
      setContractId(p?.contractId ? String(p.contractId) : "none");
      setLinks([]);
      setOverpay(null);
      setExpParent("none");
      setExpChild("none");
      setExpAccountText("");
      setExpCustomerId("none");
      setExpContractId("none");
      setCustodyAccountId("none");
      setCustodyText("");
      setSubContractId(p?.subContractId ? String(p.subContractId) : "");
      setPartnerName("");
      setFromAccount("");
      setToAccount("");
      setEmployeeId("none");
      setEmployeeText("");
    }
    wasOpen.current = open;
  }, [open]);

  React.useEffect(() => {
    if (subDetailQuery.data?.item) setSubCapRemaining(subDetailQuery.data.item.capRemaining ?? subDetailQuery.data.item.remaining ?? null);
    else if (subContractsQuery.data && subContractId) {
      const row = subContractsQuery.data.items.find((i) => String(i.id) === subContractId);
      setSubCapRemaining(row ? row.remaining : null);
    }
  }, [subDetailQuery.data, subContractsQuery.data, subContractId]);

  // ===== الربط اليدوي =====
  const toggleLink = (lineId: number) => {
    setLinks((prev) => {
      if (prev.some((l) => l.lineId === lineId)) return prev.filter((l) => l.lineId !== lineId);
      return [...prev, { lineId, amount: "" }];
    });
  };
  const setLinkAmount = (lineId: number, amount: string) =>
    setLinks((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, amount } : l)));
  const linksTotal = round3(
    links.reduce((s, l) => {
      const line = eligibleLines.find((x) => x.id === l.lineId);
      const a = Number(l.amount || 0);
      return s + (a > 0 ? a : Math.min(Number(amount || 0), line?.room ?? line?.remaining ?? 0));
    }, 0)
  );

  // ===== التوزيع التلقائي =====
  const autoDistribute = async () => {
    if (!contractIdNum || !(Number(amount) > 0)) {
      toast({ variant: "destructive", title: "أكمل المبلغ والعقد أولًا" });
      return;
    }
    try {
      const res = await apiPost<PaymentLinkValidateResult>("/api/payment-link", {
        action: "validate",
        contractId: contractIdNum,
        kind: "receipt",
        amount: Number(amount),
      });
      if (res.suggested && res.suggested.length > 0) {
        setLinks(res.suggested.map((s) => ({ lineId: s.lineId, amount: String(s.amount) })));
        toast({ title: "تم التوزيع التلقائي", description: res.message || "وُزّع المبلغ على الدفعات المستحقة" });
      } else {
        toast({ title: "لا توزيع مطلوب", description: res.message || "لا خطوط مستحقة قابلة للتوزيع — سيغطي السند الفائض كدفعة مقدمة" });
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر التوزيع", description: errMessage(e) });
    }
  };

  // ===== بناء جسم الطلب حسب النوع =====
  const buildBody = (): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      vtype,
      vdate,
      amount: Number(amount || 0),
      description: description.trim(),
    };
    const method = selectedMethod?.name || "";
    if (method) base.method = method;
    if (isCheque && chequeDueDate) base.chequeDueDate = chequeDueDate;

    if (vtype === "receipt") {
      if (customerId !== "none") base.partyId = Number(customerId);
      base.partyType = customerId !== "none" ? "customer" : null;
      base.party = customerId !== "none" ? customersQuery.data?.customers.find((c) => String(c.id) === customerId)?.name : "";
      if (contractIdNum) base.contractId = contractIdNum;
      base.links = links
        .map((l) => {
          const line = eligibleLines.find((x) => x.id === l.lineId);
          const a = Number(l.amount || 0) > 0 ? Number(l.amount) : Math.min(Number(amount || 0), line?.room ?? line?.remaining ?? 0);
          return { lineId: l.lineId, kind: "receipt", amount: a };
        })
        .filter((l) => l.amount > 0);
    } else if (vtype === "payment") {
      if (payKind === "expense") {
        const child = expChild !== "none" ? expenseAccounts.find((a) => String(a.id) === expChild) : null;
        const parent = expParent !== "none" ? expenseAccounts.find((a) => String(a.id) === expParent) : null;
        base.expenseAccountId = child ? child.id : expParent !== "none" ? parent?.id : null;
        base.account = child?.name || parent?.name || expAccountText.trim();
        if (expCustomerId !== "none") {
          base.partyType = "customer";
          base.partyId = Number(expCustomerId);
        }
        if (expContractId !== "none") base.contractId = Number(expContractId);
      } else if (payKind === "custody") {
        const acc = custodyAccountId !== "none" ? advanceAccounts.find((a) => String(a.id) === custodyAccountId) : null;
        base.custodyAccountId = acc ? acc.id : null;
        base.account = acc?.name || custodyText.trim();
      } else if (payKind === "subcontract") {
        base.subContractId = Number(subContractId);
        base.partyType = "subcontractor";
        base.partyId = subDetailQuery.data?.item?.subcontractor?.id;
        base.party = subDetailQuery.data?.item?.subcontractor?.name;
      } else if (payKind === "partner") {
        base.partyType = "partner";
        base.party = partnerName.trim();
      }
    } else if (vtype === "transfer") {
      base.method = fromAccount;
      base.account = fromAccount;
      base.toAccount = toAccount;
    } else if (vtype === "custody_return") {
      const acc = custodyAccountId !== "none" ? advanceAccounts.find((a) => String(a.id) === custodyAccountId) : null;
      base.custodyAccountId = acc ? acc.id : null;
      base.account = acc?.name || custodyText.trim();
    } else if (vtype === "salary_deduction") {
      const emp = employees.find((e) => String(e.id) === employeeId);
      base.advanceEmployeeId = emp ? emp.id : null;
      base.employeeName = emp?.name || employeeText.trim();
      base.party = emp?.name || employeeText.trim();
    }
    return base;
  };

  const bodyValid = (): boolean => {
    if (!(Number(amount) > 0) || !vdate) return false;
    if (vtype === "transfer") return !!fromAccount && !!toAccount && fromAccount !== toAccount;
    if (vtype === "receipt") return true;
    if (vtype === "payment") {
      if (payKind === "expense") return (expChild !== "none" || expParent !== "none" || !!expAccountText.trim());
      if (payKind === "custody") return custodyAccountId !== "none" || !!custodyText.trim();
      if (payKind === "subcontract") return !!subContractId;
      if (payKind === "partner") return !!partnerName.trim();
    }
    if (vtype === "custody_return") return custodyAccountId !== "none" || !!custodyText.trim();
    if (vtype === "salary_deduction") return employeeId !== "none" || !!employeeText.trim();
    return true;
  };

  // ===== الإنشاء =====
  const createMutation = useMutation({
    mutationFn: ({ allowOverpay }: { allowOverpay: boolean }) => {
      const body = buildBody();
      if (allowOverpay) body.allowOverpay = true;
      return apiPost<{ item: { voucherNumber: string } }>("/api/vouchers", body);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      qc.invalidateQueries({ queryKey: ["payment-link"] });
      qc.invalidateQueries({ queryKey: ["sub-contracts"] });
      qc.invalidateQueries({ queryKey: ["sub-contract"] });
      qc.invalidateQueries({ queryKey: ["contract"] });
      qc.invalidateQueries({ queryKey: ["contracts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: "تم إنشاء السند", description: `رقم السند: ${(res as { voucher?: { voucherNumber?: string }; item?: { voucherNumber?: string } }).voucher?.voucherNumber ?? res.item?.voucherNumber ?? ""}` });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      if (e instanceof ApiError && e.status === 422 && e.overpay) {
        setOverpay({ message: e.message, remaining: 0 });
        return;
      }
      toast({ variant: "destructive", title: "تعذر إنشاء السند", description: errMessage(e) });
    },
  });

  const fee = vtype === "receipt" ? localBankFee(selectedMethod, Number(amount || 0)) : 0;
  const contractPreset = !!preset?.contractId;

  const receiptContracts: CustomerContractRow[] =
    (custContractsQuery.data?.contracts ?? []).filter((c) => !["ملغى", "مغلق"].includes(c.status));

  const subContracts = subContractsQuery.data?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>سند جديد</DialogTitle>
          <DialogDescription>سند القبض يربط بالدفعات تلقائيًا أو يدويًا، والصرف يُختار حسابه حسب النوع.</DialogDescription>
        </DialogHeader>

        {/* ===== اختيار النوع ===== */}
        <div className="flex flex-wrap gap-1.5">
          {VOUCHER_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setVtype(t)}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                vtype === t ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {VOUCHER_TYPE_LABEL[t]}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {/* ===== القبض ===== */}
          {vtype === "receipt" && (
            <>
              {!contractPreset && (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>العميل (اختياري)</Label>
                      <Select
                        value={customerId}
                        onValueChange={(v) => {
                          setCustomerId(v);
                          setContractId("none");
                        }}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="بدون عميل" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">بدون عميل</SelectItem>
                          {(customersQuery.data?.customers ?? []).map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>العقد</Label>
                      <Select value={contractId} onValueChange={setContractId} disabled={customerId === "none"}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder={customerId === "none" ? "بدون عقد" : "اختر العقد"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">بدون عقد</SelectItem>
                          {receiptContracts.map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>
                              {c.contractNumber} — {c.contractName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {customerId !== "none" && custContractsQuery.isLoading && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" /> جارٍ تحميل عقود العميل…
                    </p>
                  )}
                </>
              )}
              {contractPreset && (
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="secondary">عقد: {preset?.contractNumber}</Badge>
                  {preset?.customerName && <span className="text-muted-foreground">{preset.customerName}</span>}
                </div>
              )}

              {contractIdNum !== null && (
                <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">الربط بالدفعات</span>
                    <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={autoDistribute}>
                      <Wand2 className="size-3.5" />
                      توزيع تلقائي
                    </Button>
                  </div>
                  {payLinkQuery.isLoading ? (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" /> جارٍ تحميل خطوط الخطة…
                    </p>
                  ) : payLinkQuery.isError ? (
                    <p className="text-xs text-status-warn">تعذر تحميل خطوط الربط — سيُربط السند بالتغطية التلقائية FIFO.</p>
                  ) : eligibleLines.length === 0 ? (
                    <p className="text-xs text-muted-foreground">لا خطوط مستحقة قابلة للربط — الفائض يُسجل دفعة مقدمة.</p>
                  ) : (
                    <div className="max-h-44 space-y-1.5 overflow-y-auto pe-1">
                      {eligibleLines.map((l) => {
                        const checked = links.some((x) => x.lineId === l.id);
                        return (
                          <div key={l.id} className="rounded-md border bg-card p-2">
                            <div className="flex items-start gap-2">
                              <Checkbox className="mt-0.5" checked={checked} onCheckedChange={() => toggleLink(l.id)} />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                                  <span className="font-medium">{l.title}</span>
                                  <span className="tabular-nums text-muted-foreground" dir="ltr">
                                    متبقٍ {formatKWD(l.room ?? l.remaining)}
                                  </span>
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                  {l.dueDate?.slice(0, 10)} — {l.stateLabel || l.state}
                                </div>
                                {checked && (
                                  <Input
                                    className="mt-1 h-8"
                                    dir="ltr"
                                    type="number"
                                    min="0"
                                    step="0.001"
                                    placeholder={`مبلغ الربط (افتراضي ${formatKWD(Math.min(Number(amount || 0), l.room ?? l.remaining))})`}
                                    value={links.find((x) => x.lineId === l.id)?.amount ?? ""}
                                    onChange={(e) => setLinkAmount(l.id, e.target.value)}
                                  />
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {links.length > 0 && (
                    <p className="text-xs text-muted-foreground" dir="ltr">
                      Σ الربط: {formatKWD(linksTotal)} — سند: {formatKWD(Number(amount || 0))}
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {/* ===== الصرف ===== */}
          {vtype === "payment" && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {([
                  { k: "expense", label: "مصروف" },
                  { k: "custody", label: "عهدة" },
                  { k: "subcontract", label: "باطن" },
                  ...(manager ? [{ k: "partner", label: "شريك" }] : []),
                ] as { k: PayKind; label: string }[]).map((s) => (
                  <button
                    key={s.k}
                    type="button"
                    onClick={() => setPayKind(s.k)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                      payKind === s.k ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {payKind === "expense" && (
                <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  {expenseReady ? (
                    <>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>حساب رئيسي</Label>
                          <Select
                            value={expParent}
                            onValueChange={(v) => {
                              setExpParent(v);
                              setExpChild("none");
                            }}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="اختر" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">—</SelectItem>
                              {expRoots.map((a) => (
                                <SelectItem key={a.id} value={String(a.id)}>
                                  {a.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>حساب فرعي</Label>
                          <Select value={expChild} onValueChange={setExpChild} disabled={expParent === "none"}>
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder={expParent === "none" ? "—" : "اختر"} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">—</SelectItem>
                              {expChildrenOf(Number(expParent)).map((a) => (
                                <SelectItem key={a.id} value={String(a.id)}>
                                  {a.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-1.5">
                      <Label>اسم حساب المصروف</Label>
                      <Input className="h-9" placeholder="مثال: مصاريف كهرباء" value={expAccountText} onChange={(e) => setExpAccountText(e.target.value)} />
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>عميل تعرضية (اختياري)</Label>
                      <Select value={expCustomerId} onValueChange={setExpCustomerId}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {(customersQuery.data?.customers ?? []).map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>عقد اختياري</Label>
                      <Select value={expContractId} onValueChange={setExpContractId}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {(contractsQuery.data?.contracts ?? []).map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>
                              {c.contractNumber}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}

              {payKind === "custody" && (
                <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  {advanceAccounts.length > 0 ? (
                    <div className="space-y-1.5">
                      <Label>حساب العهدة</Label>
                      <Select value={custodyAccountId} onValueChange={setCustodyAccountId}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="اختر حساب عهدة" />
                        </SelectTrigger>
                        <SelectContent>
                          {advanceAccounts.map((a) => (
                            <SelectItem key={a.id} value={String(a.id)}>
                              {a.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Label>اسم حساب العهدة</Label>
                      <Input className="h-9" placeholder="عهدة عامة" value={custodyText} onChange={(e) => setCustodyText(e.target.value)} />
                    </div>
                  )}
                </div>
              )}

              {payKind === "subcontract" && (
                <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  {preset?.subContractId ? (
                    <Badge variant="secondary">عقد باطن: {preset.subLabel || `#${preset.subContractId}`}</Badge>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <Label>عقد العميل</Label>
                        <Select value={contractId} onValueChange={(v) => { setContractId(v); setSubContractId(""); }}>
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="اختر العقد" />
                          </SelectTrigger>
                          <SelectContent>
                            {(contractsQuery.data?.contracts ?? [])
                              .filter((c) => !["ملغى", "مغلق"].includes(c.status))
                              .map((c: ContractListItem) => (
                                <SelectItem key={c.id} value={String(c.id)}>
                                  {c.contractNumber} — {c.contractName}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {contractId !== "none" && (
                        <div className="space-y-1.5">
                          <Label>عقد الباطن</Label>
                          <Select value={subContractId} onValueChange={setSubContractId} disabled={subContractsQuery.isLoading}>
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder={subContractsQuery.isLoading ? "جارٍ التحميل…" : "اختر"} />
                            </SelectTrigger>
                            <SelectContent>
                              {subContracts.map((s) => (
                                <SelectItem key={s.id} value={String(s.id)}>
                                  {s.subcontractor.name} — متبقٍ {formatKWD(s.remaining)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </>
                  )}
                  {subContractId && subCapRemaining !== null && Number(amount) > subCapRemaining && (
                    <p className="flex items-start gap-1.5 rounded-md bg-status-warn-bg p-2 text-xs text-status-warn">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      تحذير: المبلغ يتجاوز سقف الصرف المتبقي ({formatKWD(subCapRemaining)}) — قد يتحول الفائض لدفعة مقدمة للمقاول.
                    </p>
                  )}
                  {subContractId && subCapRemaining !== null && (
                    <p className="text-xs text-muted-foreground" dir="ltr">
                      سقف الصرف المتبقي: {formatKWD(subCapRemaining)}
                    </p>
                  )}
                </div>
              )}

              {payKind === "partner" && (
                <div className="space-y-1.5">
                  <Label>اسم الطرف (شريك)</Label>
                  <Input className="h-9" value={partnerName} onChange={(e) => setPartnerName(e.target.value)} />
                </div>
              )}
            </>
          )}

          {/* ===== التحويل ===== */}
          {vtype === "transfer" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>من حساب</Label>
                <Select value={fromAccount} onValueChange={setFromAccount}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="اختر" />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_OPTIONS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                    {methods.map((m) => (
                      <SelectItem key={`m-${m.id}`} value={m.name}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>إلى حساب</Label>
                <Select value={toAccount} onValueChange={setToAccount}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="اختر" />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_OPTIONS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                    {methods.map((m) => (
                      <SelectItem key={`m-${m.id}`} value={m.name}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {fromAccount && toAccount && fromAccount === toAccount && (
                <p className="text-xs text-red-600 sm:col-span-2">يجب اختيار حسابين مختلفين (صندوق ≠ بنك).</p>
              )}
            </div>
          )}

          {/* ===== إرجاع عهدة / خصم راتب ===== */}
          {vtype === "custody_return" && (
            <div className="rounded-lg border bg-muted/30 p-3">
              {advanceAccounts.length > 0 ? (
                <div className="space-y-1.5">
                  <Label>حساب العهدة</Label>
                  <Select value={custodyAccountId} onValueChange={setCustodyAccountId}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="اختر حساب عهدة" />
                    </SelectTrigger>
                    <SelectContent>
                      {advanceAccounts.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">الإرجاع بسقف المتبقي — الخلفية ترفض التجاوز.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>اسم حساب العهدة</Label>
                  <Input className="h-9" placeholder="عهدة عامة" value={custodyText} onChange={(e) => setCustodyText(e.target.value)} />
                </div>
              )}
            </div>
          )}

          {vtype === "salary_deduction" && (
            <div className="rounded-lg border bg-muted/30 p-3">
              {employees.length > 0 ? (
                <div className="space-y-1.5">
                  <Label>الموظف</Label>
                  <Select value={employeeId} onValueChange={setEmployeeId}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="اختر الموظف" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map((e) => (
                        <SelectItem key={e.id} value={String(e.id)}>
                          {e.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>اسم الموظف</Label>
                  <Input className="h-9" value={employeeText} onChange={(e) => setEmployeeText(e.target.value)} />
                </div>
              )}
            </div>
          )}

          {/* ===== الحقول المشتركة ===== */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="vd-amount">المبلغ *</Label>
              <Input
                id="vd-amount"
                className="h-9"
                dir="ltr"
                type="number"
                min="0"
                step="0.001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vd-date">التاريخ *</Label>
              <Input id="vd-date" className="h-9" dir="ltr" type="date" value={vdate} onChange={(e) => setVdate(e.target.value)} />
            </div>
            {vtype !== "transfer" && (
              <div className="space-y-1.5">
                <Label>الطريقة</Label>
                <Select value={methodId} onValueChange={setMethodId}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="— نقد/أخرى —" />
                  </SelectTrigger>
                  <SelectContent>
                    {methods.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isCheque && (
              <div className="space-y-1.5">
                <Label htmlFor="vd-cheque">تاريخ استحقاق الشيك</Label>
                <Input id="vd-cheque" className="h-9" dir="ltr" type="date" value={chequeDueDate} onChange={(e) => setChequeDueDate(e.target.value)} />
              </div>
            )}
            <div className={"space-y-1.5 " + (vtype !== "transfer" && !isCheque ? "sm:col-span-2" : "")}>
              <Label htmlFor="vd-desc">البيان</Label>
              <Textarea id="vd-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>

          {/* رسوم بنكية متوقعة */}
          {vtype === "receipt" && fee > 0 && (
            <p className="flex items-center gap-1.5 rounded-md bg-status-info-bg p-2 text-xs text-status-info">
              <Banknote className="size-3.5 shrink-0" />
              سيُنشئ سند رسوم بنكية: {formatKWD(fee)} (PV ابن مرتبط بالسند)
            </p>
          )}

          {/* تأكيد السقف التحذيري (overpay 422) */}
          {overpay && (
            <div className="space-y-2 rounded-md border border-status-warn/40 bg-status-warn-bg p-3 text-sm">
              <p className="flex items-start gap-1.5 font-medium text-status-warn">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {overpay.message}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={createMutation.isPending}
                  onClick={() => createMutation.mutate({ allowOverpay: true })}
                >
                  <BadgeCheck className="size-3.5" />
                  نعم، سجّل زيادة كدفعة مقدمة
                </Button>
                <Button size="sm" variant="outline" className="h-8" onClick={() => setOverpay(null)}>
                  تراجع
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-9" onClick={() => onOpenChange(false)} disabled={createMutation.isPending}>
            إلغاء
          </Button>
          <Button className="h-9" disabled={createMutation.isPending || !bodyValid() || !!overpay} onClick={() => createMutation.mutate({ allowOverpay: false })}>
            {createMutation.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" /> جارٍ الحفظ…
              </>
            ) : (
              "حفظ السند"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
