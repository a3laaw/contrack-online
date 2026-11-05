"use client";

/**
 * شاشة «دفتر الأستاذ والميزان» — Task 108 (مخرجات المحاسبة من الأستاذ العام).
 * ثلاث تبويبات:
 *  1) دفتر الأستاذ: حركات أي حساب من القيود posted حصرًا برصيد جارٍ + فلاتر الأبعاد
 *     (فترة/عميل/عقد/باطن/مركز تكلفة) + تصدير CSV/Excel/PDF.
 *  2) ميزان المراجعة حتى تاريخ: تجميع بالـSQL حصرًا مع إظهار التوازن العام وملخص النوع
 *     ومركز التكلفة + تصدير CSV/Excel.
 *  3) أعمار الذمم 30/60/90+: للعملاء والباطن من الجانب التحليلي لسطور القيد بتسوية FIFO
 *     + تصدير CSV/Excel.
 * الشاشة قراءة فقط — لا تعيد الحساب المالي، تعرض ما يحسبه الخادم من الأستاذ.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  Download,
  FileSpreadsheet,
  Loader2,
  Printer,
  RefreshCw,
  Scale,
  Timer,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, getStoredToken } from "./api";
import { errMessage } from "./contrack-types";
import { fetchBlobDownload } from "@/lib/download-blob";
import { formatKWD } from "@/lib/format";
import { AGING_BUCKET_LABELS } from "@/lib/accounting-reports-core";

// ==================== الأنواع ====================

interface AccountLite {
  id: number;
  code: string;
  name: string;
  type: string;
  nature: string;
  isLeaf: boolean;
  allowPosting: boolean;
  isActive: boolean;
}

interface GlRow {
  entryNo: number;
  entryDate: string;
  description: string;
  lineDescription: string;
  debit: number;
  credit: number;
  sourceType: string;
  customerName?: string;
  contractNumber?: string;
  subcontractLabel?: string;
  costCenter?: string;
  balance: number;
  balanceSide: "debit" | "credit";
}

interface GlResponse {
  account: { id: number; code: string; name: string; nature: string; type: string };
  opening: number;
  rows: GlRow[];
  totals: { debit: number; credit: number };
  closing: number;
  closingSide: "debit" | "credit";
}

interface TbRow {
  accountId: number;
  code: string;
  name: string;
  type: string;
  net: number;
  opening: number;
  movementDr: number;
  movementCr: number;
}

interface TbResponse {
  asOf: string;
  rows: TbRow[];
  totals: { debit: number; credit: number; diff: number; balanced: boolean };
  byType: { type: string; label: string; net: number; count: number }[];
  byCost: { costCenter: string; debit: number; credit: number; net: number }[];
}

interface AgingRow {
  id: number;
  name: string;
  code: string;
  balance: number;
  direction: "debit" | "credit" | null;
  buckets: [number, number, number, number];
  oldestDays: number | null;
  lastActivity: string;
}

interface AgingResponse {
  kind: "customers" | "subcontractors";
  asOf: string;
  accountCodes: string[];
  rows: AgingRow[];
  totals: { balance: number; buckets: [number, number, number, number]; count: number };
  note: string;
}

interface FilterOptions {
  customers: { id: number; name: string; code: string }[];
  contracts: { id: number; label: string }[];
  subContracts: { id: number; label: string }[];
  costCenters: string[];
}

const ALL = "__all__";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const TB_TYPE_BADGE: Record<string, string> = {
  asset: "bg-status-done-bg text-status-done",
  liability: "bg-status-warn-bg text-status-warn",
  equity: "bg-muted text-foreground",
  revenue: "bg-status-done-bg text-status-done",
  expense: "bg-status-danger-bg text-status-danger",
};

/** تصفية حسابات العرض: أوراق مسموح نشرها — كما في القيود اليومية */
const displayableAccount = (a: AccountLite): boolean =>
  a.isActive && a.isLeaf && a.allowPosting;

export function LedgerView({ onAuthError }: { onAuthError: () => void }) {
  const { toast } = useToast();

  // ==================== خيارات الفلاتر المشتركة ====================
  const [accountFilter, setAccountFilter] = React.useState("");
  const optsQ = useQuery({
    queryKey: ["ledger-filter-options"],
    queryFn: async () => apiGet<FilterOptions>("/api/reports/ledger/filter-options"),
    staleTime: 60_000,
  });
  const accountsQ = useQuery({
    queryKey: ["accounts-for-ledger"],
    queryFn: async () => apiGet<{ accounts: AccountLite[] }>("/api/accounts"),
    staleTime: 60_000,
  });
  const displayAccounts = React.useMemo(
    () => (accountsQ.data?.accounts || []).filter(displayableAccount),
    [accountsQ.data]
  );

  React.useEffect(() => {
    const e1 = optsQ.error;
    const e2 = accountsQ.error;
    const e = e1 || e2;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [optsQ.error, accountsQ.error, onAuthError]);

  // ==================== التبويب النشط ====================
  const [tab, setTab] = React.useState("ledger");

  // ==================== تبويب دفتر الأستاذ ====================
  const [glAccount, setGlAccount] = React.useState("");
  const [glFrom, setGlFrom] = React.useState("");
  const [glTo, setGlTo] = React.useState("");
  const [glCustomer, setGlCustomer] = React.useState(ALL);
  const [glContract, setGlContract] = React.useState(ALL);
  const [glSub, setGlSub] = React.useState(ALL);
  const [glCost, setGlCost] = React.useState("");
  const [glExporting, setGlExporting] = React.useState<"csv" | "xlsx" | "pdf" | null>(null);

  const glQs = React.useCallback(() => {
    const p = new URLSearchParams();
    if (glAccount) p.set("accountId", glAccount);
    if (glFrom) p.set("from", glFrom);
    if (glTo) p.set("to", glTo);
    if (glCustomer !== ALL) p.set("customerId", glCustomer);
    if (glContract !== ALL) p.set("contractId", glContract);
    if (glSub !== ALL) p.set("subContractId", glSub);
    if (glCost.trim()) p.set("costCenter", glCost.trim());
    return p.toString();
  }, [glAccount, glFrom, glTo, glCustomer, glContract, glSub, glCost]);

  const glQ = useQuery({
    queryKey: ["ledger-general", glQs()],
    queryFn: async () => apiGet<GlResponse>(`/api/reports/ledger/general?${glQs()}`),
    enabled: !!glAccount,
  });

  React.useEffect(() => {
    if (glQ.error instanceof ApiError && glQ.error.status === 401) onAuthError();
  }, [glQ.error, onAuthError]);

  const onGlExport = async (fmt: "csv" | "xlsx" | "pdf") => {
    if (!glAccount) {
      toast({ title: "اختر الحساب أولًا", variant: "destructive" });
      return;
    }
    try {
      setGlExporting(fmt);
      if (fmt === "pdf") {
        await fetchBlobDownload({
          url: `/api/reports/ledger/general/pdf?${glQs()}`,
          token: getStoredToken(),
          filename: "دفتر-الأستاذ.pdf",
        });
      } else {
        await fetchBlobDownload({
          url: "/api/reports/export?format=" + fmt,
          method: "POST",
          token: getStoredToken(),
          body: { report: "general-ledger", params: Object.fromEntries(new URLSearchParams(glQs())) },
          filename: `دفتر-الأستاذ.${fmt === "xlsx" ? "xlsx" : "csv"}`,
        });
      }
      toast({ title: "تم التصدير", description: fmt === "pdf" ? "نُزّل ملف PDF بنجاح" : fmt === "xlsx" ? "نُزّل ملف Excel بنجاح" : "نُزّل ملف CSV بنجاح" });
    } catch (e) {
      if ((e as { status?: number }).status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر التصدير", description: errMessage(e) });
    } finally {
      setGlExporting(null);
    }
  };

  // ==================== تبويب ميزان المراجعة ====================
  const [tbAsOf, setTbAsOf] = React.useState(() => todayStr());
  const [tbExporting, setTbExporting] = React.useState<"csv" | "xlsx" | null>(null);

  const tbQ = useQuery({
    queryKey: ["ledger-trial-balance", tbAsOf],
    queryFn: async () => apiGet<TbResponse>(`/api/reports/ledger/trial-balance?asOf=${tbAsOf}`),
    enabled: tab === "trial" && /^\d{4}-\d{2}-\d{2}$/.test(tbAsOf),
  });

  React.useEffect(() => {
    if (tbQ.error instanceof ApiError && tbQ.error.status === 401) onAuthError();
  }, [tbQ.error, onAuthError]);

  const onTbExport = async (fmt: "csv" | "xlsx") => {
    try {
      setTbExporting(fmt);
      await fetchBlobDownload({
        url: "/api/reports/export?format=" + fmt,
        method: "POST",
        token: getStoredToken(),
        body: { report: "trial-balance", params: { asOf: tbAsOf } },
        filename: `ميزان-المراجعة-${tbAsOf}.${fmt}`,
      });
      toast({ title: "تم التصدير", description: fmt === "xlsx" ? "نُزّل ملف Excel بنجاح" : "نُزّل ملف CSV بنجاح" });
    } catch (e) {
      if ((e as { status?: number }).status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر التصدير", description: errMessage(e) });
    } finally {
      setTbExporting(null);
    }
  };

  // ==================== تبويب أعمار الذمم ====================
  const [agKind, setAgKind] = React.useState<"customers" | "subcontractors">("customers");
  const [agAsOf, setAgAsOf] = React.useState(() => todayStr());
  const [agExporting, setAgExporting] = React.useState<"csv" | "xlsx" | null>(null);

  const agQ = useQuery({
    queryKey: ["ledger-aging", agKind, agAsOf],
    queryFn: async () => apiGet<AgingResponse>(`/api/reports/ledger/aging?kind=${agKind}&asOf=${agAsOf}`),
    enabled: tab === "aging" && /^\d{4}-\d{2}-\d{2}$/.test(agAsOf),
  });

  React.useEffect(() => {
    if (agQ.error instanceof ApiError && agQ.error.status === 401) onAuthError();
  }, [agQ.error, onAuthError]);

  const onAgExport = async (fmt: "csv" | "xlsx") => {
    try {
      setAgExporting(fmt);
      await fetchBlobDownload({
        url: "/api/reports/export?format=" + fmt,
        method: "POST",
        token: getStoredToken(),
        body: { report: "aging", params: { kind: agKind, asOf: agAsOf } },
        filename: `أعمار-الذمم-${agAsOf}.${fmt}`,
      });
      toast({ title: "تم التصدير", description: fmt === "xlsx" ? "نُزّل ملف Excel بنجاح" : "نُزّل ملف CSV بنجاح" });
    } catch (e) {
      if ((e as { status?: number }).status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر التصدير", description: errMessage(e) });
    } finally {
      setAgExporting(null);
    }
  };

  const gl = glQ.data;
  const tb = tbQ.data;
  const ag = agQ.data;

  return (
    <div className="flex flex-col gap-4" dir="rtl">
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="ledger" className="gap-1.5">
              <BookOpen className="size-4" />
              دفتر الأستاذ
            </TabsTrigger>
            <TabsTrigger value="trial" className="gap-1.5">
              <Scale className="size-4" />
              ميزان المراجعة
            </TabsTrigger>
            <TabsTrigger value="aging" className="gap-1.5">
              <Timer className="size-4" />
              أعمار الذمم
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ==================== 1) دفتر الأستاذ ==================== */}
        <TabsContent value="ledger" className="mt-4 space-y-3">
          <Card>
            <CardContent className="flex flex-wrap items-end gap-2 p-3">
              <div className="w-56 space-y-1">
                <Label className="text-xs text-muted-foreground">الحساب *</Label>
                <Select
                  value={glAccount || ALL}
                  onValueChange={(v) => setGlAccount(v === ALL ? "" : v)}
                >
                  <SelectTrigger className="h-9" aria-label="اختيار الحساب">
                    <SelectValue placeholder="اختر الحساب…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={ALL}>— اختر الحساب —</SelectItem>
                    {displayAccounts.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.code} — {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-36 space-y-1">
                <Label className="text-xs text-muted-foreground">من تاريخ</Label>
                <Input type="date" dir="ltr" className="h-9" value={glFrom} onChange={(e) => setGlFrom(e.target.value)} />
              </div>
              <div className="w-36 space-y-1">
                <Label className="text-xs text-muted-foreground">إلى تاريخ</Label>
                <Input type="date" dir="ltr" className="h-9" value={glTo} onChange={(e) => setGlTo(e.target.value)} />
              </div>
              <div className="w-44 space-y-1">
                <Label className="text-xs text-muted-foreground">العميل</Label>
                <Select value={glCustomer} onValueChange={setGlCustomer}>
                  <SelectTrigger className="h-9" aria-label="فلتر العميل">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={ALL}>الكل</SelectItem>
                    {(optsQ.data?.customers || []).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-44 space-y-1">
                <Label className="text-xs text-muted-foreground">العقد</Label>
                <Select value={glContract} onValueChange={setGlContract}>
                  <SelectTrigger className="h-9" aria-label="فلتر العقد">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={ALL}>الكل</SelectItem>
                    {(optsQ.data?.contracts || []).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-44 space-y-1">
                <Label className="text-xs text-muted-foreground">عقد الباطن</Label>
                <Select value={glSub} onValueChange={setGlSub}>
                  <SelectTrigger className="h-9" aria-label="فلتر الباطن">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={ALL}>الكل</SelectItem>
                    {(optsQ.data?.subContracts || []).map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-36 space-y-1">
                <Label className="text-xs text-muted-foreground">مركز التكلفة</Label>
                <Input
                  className="h-9"
                  list="ledger-cost-centers"
                  value={glCost}
                  onChange={(e) => setGlCost(e.target.value)}
                  placeholder="الكل"
                  aria-label="فلتر مركز التكلفة"
                />
                <datalist id="ledger-cost-centers">
                  {(optsQ.data?.costCenters || []).map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              <div className="flex flex-1 items-center justify-end gap-2">
                <Button size="sm" variant="outline" className="h-9" onClick={() => glQ.refetch()} disabled={glQ.isFetching || !glAccount}>
                  <RefreshCw className={`size-4 ${glQ.isFetching ? "animate-spin" : ""}`} />
                </Button>
                <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => onGlExport("pdf")} disabled={!glAccount || glExporting !== null || glQ.isLoading}>
                  {glExporting === "pdf" ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
                  PDF
                </Button>
                <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => onGlExport("xlsx")} disabled={!glAccount || glExporting !== null || glQ.isLoading}>
                  {glExporting === "xlsx" ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
                  Excel
                </Button>
                <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => onGlExport("csv")} disabled={!glAccount || glExporting !== null || glQ.isLoading}>
                  {glExporting === "csv" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                  CSV
                </Button>
              </div>
            </CardContent>
          </Card>

          {!glAccount ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                اختر حسابًا من الدليل لعرض حركات دفتر الأستاذ.
              </CardContent>
            </Card>
          ) : glQ.isLoading ? (
            <Card>
              <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                جارٍ حساب الحركات من الأستاذ…
              </CardContent>
            </Card>
          ) : glQ.isError ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-destructive">
                تعذر تحميل دفتر الأستاذ — {errMessage(glQ.error)}
              </CardContent>
            </Card>
          ) : gl ? (
            <>
              {/* بطاقات الملخص */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Card className="p-3">
                  <p className="text-xs text-muted-foreground">رصيد أول الفترة</p>
                  <p className="mt-1 text-lg font-bold tabular-nums">{formatKWD(Math.abs(gl.opening))}</p>
                  <Badge variant="outline" className="mt-1 text-xs">
                    {gl.opening >= 0 ? "مدين" : "دائن"}
                  </Badge>
                </Card>
                <Card className="p-3">
                  <p className="text-xs text-muted-foreground">حركة المدين</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-status-done">{formatKWD(gl.totals.debit)}</p>
                </Card>
                <Card className="p-3">
                  <p className="text-xs text-muted-foreground">حركة الدائن</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-status-danger">{formatKWD(gl.totals.credit)}</p>
                </Card>
                <Card className="p-3">
                  <p className="text-xs text-muted-foreground">رصيد آخر الفترة</p>
                  <p className="mt-1 text-lg font-bold tabular-nums">{formatKWD(gl.closing)}</p>
                  <Badge variant="outline" className="mt-1 text-xs">
                    {gl.closingSide === "debit" ? "مدين" : "دائن"}
                  </Badge>
                </Card>
              </div>

              <Card className="p-0">
                <CardHeader className="border-b px-4 pb-2 pt-3">
                  <CardTitle className="text-sm font-bold">
                    {gl.account.code} — {gl.account.name}
                    <span className="mr-2 text-xs font-normal text-muted-foreground">
                      الحركات من القيود المنشورة حصرًا — {gl.rows.length} حركة
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="max-h-[56vh] overflow-auto rounded-b-md">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-muted">
                        <TableRow>
                          <TableHead className="w-24">التاريخ</TableHead>
                          <TableHead className="w-16">المرجع</TableHead>
                          <TableHead>البيان</TableHead>
                          <TableHead className="hidden md:table-cell">الأبعاد</TableHead>
                          <TableHead className="w-28 text-left">مدين</TableHead>
                          <TableHead className="w-28 text-left">دائن</TableHead>
                          <TableHead className="w-32 text-left">الرصيد</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {gl.rows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                              لا حركات مطابقة للفلاتر.
                            </TableCell>
                          </TableRow>
                        ) : (
                          gl.rows.map((r, i) => (
                            <TableRow key={`${r.entryNo}-${i}`}>
                              <TableCell className="text-xs">{r.entryDate}</TableCell>
                              <TableCell className="font-mono text-xs">#{r.entryNo}</TableCell>
                              <TableCell className="max-w-[260px] truncate text-xs" title={r.lineDescription || r.description}>
                                {r.lineDescription || r.description}
                              </TableCell>
                              <TableCell className="hidden max-w-[220px] truncate text-xs text-muted-foreground md:table-cell" title={[r.customerName, r.contractNumber, r.subcontractLabel, r.costCenter].filter(Boolean).join(" · ")}>
                                {[r.customerName, r.contractNumber ? `عقد ${r.contractNumber}` : "", r.subcontractLabel, r.costCenter ? `مركز: ${r.costCenter}` : ""].filter(Boolean).join(" · ") || "—"}
                              </TableCell>
                              <TableCell className="text-left text-xs tabular-nums">{r.debit ? formatKWD(r.debit) : "—"}</TableCell>
                              <TableCell className="text-left text-xs tabular-nums">{r.credit ? formatKWD(r.credit) : "—"}</TableCell>
                              <TableCell className="text-left text-xs font-semibold tabular-nums">
                                {formatKWD(r.balance)}
                                <span className={`mr-1 ${r.balanceSide === "debit" ? "text-status-done" : "text-status-danger"}`}>
                                  {r.balanceSide === "debit" ? "مدين" : "دائن"}
                                </span>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </TabsContent>

        {/* ==================== 2) ميزان المراجعة ==================== */}
        <TabsContent value="trial" className="mt-4 space-y-3">
          <Card>
            <CardContent className="flex flex-wrap items-end gap-2 p-3">
              <div className="w-40 space-y-1">
                <Label className="text-xs text-muted-foreground">حتى تاريخ</Label>
                <Input type="date" dir="ltr" className="h-9" value={tbAsOf} onChange={(e) => setTbAsOf(e.target.value)} />
              </div>
              <div className="flex-1">
                {tb && (
                  <Badge className={tb.totals.balanced ? "bg-status-done-bg text-status-done" : "bg-status-danger-bg text-status-danger"}>
                    {tb.totals.balanced ? `متوازن ✔ — الفارق ${tb.totals.diff.toFixed(3)}` : `غير متوازن ✖ — الفارق ${tb.totals.diff.toFixed(3)}`}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-9" onClick={() => tbQ.refetch()} disabled={tbQ.isFetching}>
                  <RefreshCw className={`size-4 ${tbQ.isFetching ? "animate-spin" : ""}`} />
                </Button>
                <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => onTbExport("xlsx")} disabled={tbExporting !== null || !tb}>
                  {tbExporting === "xlsx" ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
                  Excel
                </Button>
                <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => onTbExport("csv")} disabled={tbExporting !== null || !tb}>
                  {tbExporting === "csv" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                  CSV
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ملخص النوع */}
          {tb && tb.byType.length > 0 && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {tb.byType.map((t) => (
                <Card key={t.type} className="p-3">
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-xs text-muted-foreground">{t.label}</p>
                    <Badge variant="outline" className={`text-[10px] ${TB_TYPE_BADGE[t.type] || ""}`}>
                      {t.count} حساب
                    </Badge>
                  </div>
                  <p className="mt-1 text-base font-bold tabular-nums">{formatKWD(t.net)}</p>
                  <p className="text-[10px] text-muted-foreground">{t.net >= 0 ? "صافي مدين" : "صافي دائن"}</p>
                </Card>
              ))}
            </div>
          )}

          {!/^\d{4}-\d{2}-\d{2}$/.test(tbAsOf) ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">تاريخ الميزان مطلوب.</CardContent>
            </Card>
          ) : tbQ.isLoading ? (
            <Card>
              <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                جارٍ تجميع الأرصدة من الأستاذ بالـSQL…
              </CardContent>
            </Card>
          ) : tbQ.isError ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-destructive">
                تعذر تحميل الميزان — {errMessage(tbQ.error)}
              </CardContent>
            </Card>
          ) : tb ? (
            <>
              <Card className="p-0">
                <CardContent className="p-0">
                  <div className="max-h-[52vh] overflow-auto rounded-md">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-muted">
                        <TableRow>
                          <TableHead className="w-20">الكود</TableHead>
                          <TableHead>الحساب</TableHead>
                          <TableHead className="w-28 text-left">حركة مدين</TableHead>
                          <TableHead className="w-28 text-left">حركة دائن</TableHead>
                          <TableHead className="w-28 text-left">رصيد مدين</TableHead>
                          <TableHead className="w-28 text-left">رصيد دائن</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tb.rows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                              لا أرصدة حتى هذا التاريخ.
                            </TableCell>
                          </TableRow>
                        ) : (
                          tb.rows.map((r) => {
                            const dr = r.net >= 0 ? r.net : 0;
                            const cr = r.net < 0 ? -r.net : 0;
                            return (
                              <TableRow key={r.accountId}>
                                <TableCell className="font-mono text-xs">{r.code}</TableCell>
                                <TableCell className="text-xs">{r.name}</TableCell>
                                <TableCell className="text-left text-xs tabular-nums">{r.movementDr ? formatKWD(r.movementDr) : "—"}</TableCell>
                                <TableCell className="text-left text-xs tabular-nums">{r.movementCr ? formatKWD(r.movementCr) : "—"}</TableCell>
                                <TableCell className="text-left text-xs font-semibold tabular-nums text-status-done">{dr ? formatKWD(dr) : "—"}</TableCell>
                                <TableCell className="text-left text-xs font-semibold tabular-nums text-status-danger">{cr ? formatKWD(cr) : "—"}</TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                      <TableFooter>
                        <TableRow className="bg-muted font-semibold">
                          <TableCell colSpan={2}>الإجمالي</TableCell>
                          <TableCell className="text-left tabular-nums">{formatKWD(tb.totals.debit)}</TableCell>
                          <TableCell className="text-left tabular-nums">{formatKWD(tb.totals.credit)}</TableCell>
                          <TableCell className="text-left tabular-nums" colSpan={2}>
                            {tb.totals.balanced ? "متوازن ✔" : `فارق ${tb.totals.diff.toFixed(3)}`}
                          </TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              {/* مراكز التكلفة */}
              {tb.byCost.length > 0 && (
                <Card className="p-0">
                  <CardHeader className="border-b px-4 pb-2 pt-3">
                    <CardTitle className="text-sm font-bold">حركة مراكز التكلفة حتى التاريخ</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="max-h-60 overflow-auto">
                      <Table>
                        <TableHeader className="sticky top-0 bg-muted">
                          <TableRow>
                            <TableHead>مركز التكلفة</TableHead>
                            <TableHead className="w-32 text-left">مدين</TableHead>
                            <TableHead className="w-32 text-left">دائن</TableHead>
                            <TableHead className="w-32 text-left">الصافي</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {tb.byCost.map((c) => (
                            <TableRow key={c.costCenter}>
                              <TableCell className="text-xs">{c.costCenter}</TableCell>
                              <TableCell className="text-left text-xs tabular-nums">{formatKWD(c.debit)}</TableCell>
                              <TableCell className="text-left text-xs tabular-nums">{formatKWD(c.credit)}</TableCell>
                              <TableCell className="text-left text-xs font-semibold tabular-nums">{formatKWD(c.net)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : null}
        </TabsContent>

        {/* ==================== 3) أعمار الذمم ==================== */}
        <TabsContent value="aging" className="mt-4 space-y-3">
          <Card>
            <CardContent className="flex flex-wrap items-end gap-2 p-3">
              <div className="w-48 space-y-1">
                <Label className="text-xs text-muted-foreground">نوع الأعمار</Label>
                <Select value={agKind} onValueChange={(v) => setAgKind(v as "customers" | "subcontractors")}>
                  <SelectTrigger className="h-9" aria-label="نوع الأعمار">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customers">ذمم العملاء (112x)</SelectItem>
                    <SelectItem value="subcontractors">مستحقات الباطن (212x)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-40 space-y-1">
                <Label className="text-xs text-muted-foreground">حتى تاريخ</Label>
                <Input type="date" dir="ltr" className="h-9" value={agAsOf} onChange={(e) => setAgAsOf(e.target.value)} />
              </div>
              <div className="flex-1" />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-9" onClick={() => agQ.refetch()} disabled={agQ.isFetching}>
                  <RefreshCw className={`size-4 ${agQ.isFetching ? "animate-spin" : ""}`} />
                </Button>
                <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => onAgExport("xlsx")} disabled={agExporting !== null || !ag}>
                  {agExporting === "xlsx" ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
                  Excel
                </Button>
                <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => onAgExport("csv")} disabled={agExporting !== null || !ag}>
                  {agExporting === "csv" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                  CSV
                </Button>
              </div>
            </CardContent>
          </Card>

          {!/^\d{4}-\d{2}-\d{2}$/.test(agAsOf) ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">تاريخ الأعمار مطلوب.</CardContent>
            </Card>
          ) : agQ.isLoading ? (
            <Card>
              <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                جارٍ شيخوخة البنود المفتوحة بالتسوية FIFO…
              </CardContent>
            </Card>
          ) : agQ.isError ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-destructive">
                تعذر تحميل الأعمار — {errMessage(agQ.error)}
              </CardContent>
            </Card>
          ) : ag ? (
            <>
              {/* بطاقات الأعمار */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {AGING_BUCKET_LABELS.map((lbl, i) => (
                  <Card key={i} className="p-3">
                    <p className="text-xs text-muted-foreground">{lbl}</p>
                    <p className="mt-1 text-lg font-bold tabular-nums">{formatKWD(ag.totals.buckets[i])}</p>
                  </Card>
                ))}
              </div>

              <Card className="p-0">
                <CardHeader className="border-b px-4 pb-2 pt-3">
                  <CardTitle className="text-sm font-bold">
                    {ag.kind === "customers" ? "أعمار ذمم العملاء" : "أعمار مستحقات الباطن"}
                    <span className="mr-2 text-xs font-normal text-muted-foreground">
                      {ag.totals.count} طرف · الإجمالي {formatKWD(ag.totals.balance)}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="max-h-[52vh] overflow-auto rounded-b-md">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-muted">
                        <TableRow>
                          <TableHead>الاسم</TableHead>
                          <TableHead className="w-24">الكود</TableHead>
                          <TableHead className="w-28 text-left">الرصيد</TableHead>
                          <TableHead className="w-24 text-left">حتى 30</TableHead>
                          <TableHead className="w-24 text-left">31–60</TableHead>
                          <TableHead className="w-24 text-left">61–90</TableHead>
                          <TableHead className="w-24 text-left">+90</TableHead>
                          <TableHead className="w-24">آخر حركة</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ag.rows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                              لا أرصدة قائمة — كل البنود مسوّاة.
                            </TableCell>
                          </TableRow>
                        ) : (
                          ag.rows.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell className="max-w-[220px] truncate text-xs" title={r.name}>
                                {r.name}
                                {r.direction === "credit" && (
                                  <Badge variant="outline" className="mr-1 text-[10px]">
                                    رصيد معاكس
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="font-mono text-xs">{r.code || "—"}</TableCell>
                              <TableCell className="text-left text-xs font-semibold tabular-nums">{formatKWD(r.balance)}</TableCell>
                              {r.buckets.map((b, i) => (
                                <TableCell key={i} className={`text-left text-xs tabular-nums ${i === 3 && b > 0 ? "font-semibold text-status-danger" : ""}`}>
                                  {b ? formatKWD(Math.abs(b)) : "—"}
                                </TableCell>
                              ))}
                              <TableCell className="text-xs text-muted-foreground">{r.lastActivity || "—"}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                      <TableFooter>
                        <TableRow className="bg-muted font-semibold">
                          <TableCell colSpan={2}>الإجمالي</TableCell>
                          <TableCell className="text-left tabular-nums">{formatKWD(ag.totals.balance)}</TableCell>
                          {ag.totals.buckets.map((b, i) => (
                            <TableCell key={i} className="text-left tabular-nums">
                              {formatKWD(Math.max(0, b))}
                            </TableCell>
                          ))}
                          <TableCell>—</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                </CardContent>
                <CardContent className="px-4 pb-3 pt-2">
                  <p className="text-xs leading-relaxed text-muted-foreground">📝 {ag.note}</p>
                </CardContent>
              </Card>
            </>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
