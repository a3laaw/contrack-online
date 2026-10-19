"use client";

/**
 * تقارير العُهد السبعة — مرآة CustodyReportsWidget المكتبي (ui/custody_center.py:797+):
 * التصفيات المجمع · أرصدة العهد · كشف موظف · تفصيلي بالحركة · الملخص الشهري
 * · كشف عهدة (طباعة) · العهد المعلقة — بنفس الأعمدة ونصوص الإجماليات حرفيًا.
 * طباعة PDF/Excel المكتبية ⇒ تصدير CSV خادمي بنفس الصفوف (PDF خادميًا في المرحلة 8).
 */

import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";

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
import { Checkbox } from "@/components/ui/checkbox";
import { ApiError, getStoredToken } from "./api";
import type { CustodyAccountItem } from "./contrack-types";
import { errMessage } from "./contrack-types";
import { fmtDate } from "@/lib/format";

type ReportKind = "summary" | "balances" | "employee" | "detailed" | "monthly" | "handovers" | "open";

const SUB_TABS: { kind: ReportKind; label: string }[] = [
  { kind: "summary", label: "📊 التصفيات المجمع" },
  { kind: "balances", label: "💰 أرصدة العهد" },
  { kind: "employee", label: "🧾 كشف موظف" },
  { kind: "detailed", label: "📄 تفصيلي بالحركة" },
  { kind: "monthly", label: "📅 الملخص الشهري" },
  { kind: "handovers", label: "🧾 كشف عهدة (طباعة)" },
  { kind: "open", label: "⏳ العهد المعلقة" },
];

const fmt3 = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const money = (v: number | null | undefined) => (Math.abs(Number(v) || 0) < 0.0005 ? "" : fmt3(v));

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function todayLocal(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ==================== أنواع الاستجابات ====================

interface DetailLine { voucherNumber: string; vdate: string; party: string; expenseAccount: string; amount: number; description: string }
interface SummaryGroup { ref: string; vdate: string; custodyAccountId: number | null; custodyAccount: string; lines: number; total: number; description: string; details: DetailLine[] }
interface BalanceRow { accountId: number; account: string; handed: number; spent: number; returned: number; balance: number; handedCount: number; spentCount: number; returnedCount: number; settlements: number }
interface LedgerLine { id: number; voucherNumber: string; vdate: string; description: string; party: string; expenseAccountSnapshot: string; contractNumber: string; amount: number }
interface LedgerRow { kind: "handover" | "return" | "settlement"; ref: string; voucherId: number | null; vdate: string; description: string; in: number; out: number; balance: number; details: LedgerLine[]; detailsCount: number; custodyAccountId: number | null; custodyAccount: string }
interface DetailedRow { vdate: string; ref: string; account: string; custodyAccountId: number | null; type: string; description: string; party: string; expense: string; customer: string; in: number; out: number; balance: number }
interface MonthlyRow { month: string; account: string; opening: number; handed: number; spent: number; returned: number; closing: number }
interface HandoverRow { id: number; ref: string; vdate: string; party: string; description: string; amount: number; method: string; notes: string; custodyAccountId: number | null; custodyAccount: string }
interface OpenRow { accountId: number; account: string; balance: number; handed: number; spent: number; returned: number; oldest: string; days: number; handovers: number }

interface ReportResponse {
  kind: ReportKind;
  title: string;
  heads: string[];
  rowsCount: number;
  data: unknown;
}

// ==================== المكوّن ====================

interface CustodyReportsProps {
  accounts: CustodyAccountItem[];
  onAuthError: () => void;
}

export function CustodyReports({ accounts, onAuthError }: CustodyReportsProps) {
  const [sub, setSub] = React.useState<ReportKind>("summary");
  const [from, setFrom] = React.useState(todayLocal()); // التصفيات المجمع: اليوم (افتراضي المكتبي)
  const [to, setTo] = React.useState(todayLocal());
  const [accId, setAccId] = React.useState<string>("all");
  const [showDetails, setShowDetails] = React.useState(true);
  const [daysMin, setDaysMin] = React.useState(30);

  // الافتراضيات المكتبية لبقية التبويبات: من = اليوم−12 شهرًا
  React.useEffect(() => {
    if (sub !== "summary") {
      setFrom((f) => f || monthsAgo(12));
      setTo((t) => t || todayLocal());
    }
  }, [sub]);

  const params = new URLSearchParams({ kind: sub });
  if (sub !== "open") {
    params.set("from", from);
    params.set("to", to);
  }
  if (sub !== "balances" && sub !== "open" && accId !== "all") params.set("accountId", accId);
  if (sub === "open" && accId !== "all") params.set("accountId", accId);

  const q = useQuery({
    queryKey: ["custody-reports", sub, from, to, accId, showDetails],
    queryFn: async () => {
      try {
        return await fetchJson<ReportResponse>(`/api/custody/reports?${params.toString()}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) onAuthError();
        throw e;
      }
    },
    enabled: sub !== "employee" || accId !== "all",
    placeholderData: keepPreviousData,
  });

  const [downloading, setDownloading] = React.useState(false);
  const downloadCsv = async () => {
    setDownloading(true);
    try {
      const token = getStoredToken();
      const res = await fetch(`/api/custody/reports?${params.toString()}&format=csv`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
      if (res.status === 401) {
        onAuthError();
        return;
      }
      if (!res.ok) throw new Error(`فشل التصدير (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `تقرير-العهد-${sub}-${todayLocal()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // أخطاء التنزيل غير حرجة — تُهمل بصمت
    } finally {
      setDownloading(false);
    }
  };

  const accOptions = React.useMemo(
    () => accounts.map((a) => ({ id: a.id, name: a.fullPath || a.name })),
    [accounts]
  );

  return (
    <div className="space-y-3">
      <Tabs value={sub} onValueChange={(v) => setSub(v as ReportKind)}>
        <TabsList className="h-auto w-full justify-start overflow-x-auto">
          {SUB_TABS.map((t) => (
            <TabsTrigger key={t.kind} value={t.kind} className="gap-1 whitespace-nowrap">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* شريط الفلاتر المشترك */}
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {sub === "summary" ? null : (
            <div className="space-y-1">
              <Label className="text-xs">من</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40 dir-ltr" dir="ltr" />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">إلى</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" dir="ltr" />
          </div>
          {sub !== "balances" && sub !== "open" ? (
            <div className="space-y-1">
              <Label className="text-xs">العهدة</Label>
              <Select value={accId} onValueChange={setAccId}>
                <SelectTrigger className="h-9 w-56">
                  <SelectValue placeholder="كل العهد" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل العهد</SelectItem>
                  {accOptions.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {sub === "summary" ? (
            <label className="flex items-center gap-2 pb-1 text-sm">
              <Checkbox checked={showDetails} onCheckedChange={(v) => setShowDetails(v === true)} />
              إظهار البنود
            </label>
          ) : null}
          {sub === "open" ? (
            <div className="space-y-1">
              <Label className="text-xs">أقدم من (يوم)</Label>
              <Input
                type="number"
                min={0}
                max={3650}
                value={daysMin}
                onChange={(e) => setDaysMin(Math.max(0, Math.min(3650, Number(e.target.value) || 0)))}
                className="h-9 w-28"
                dir="ltr"
              />
            </div>
          ) : null}
          <div className="grow" />
          <Button size="sm" variant="outline" onClick={downloadCsv} disabled={downloading} className="gap-1.5">
            <Download className="size-4" />
            تصدير CSV
          </Button>
        </div>

        {sub === "open" ? (
          <p className="mt-2 text-xs text-muted-foreground">
            المعلقة = رصيد موجب ما زال لدى الموظف · الأيام من أقدم تسليم
          </p>
        ) : null}

        <div className="mt-2">
          {q.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : q.isError ? (
            <Card>
              <CardContent className="py-6 text-center text-sm text-destructive">
                تعذر تحميل التقرير — {errMessage(q.error)}
              </CardContent>
            </Card>
          ) : sub === "employee" && accId === "all" ? (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                اختر العهدة من القائمة أعلاه لعرض الكشف
              </CardContent>
            </Card>
          ) : (
            <ReportTable kind={sub} data={q.data} showDetails={showDetails} daysMin={daysMin} />
          )}
        </div>
      </Tabs>
    </div>
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const token = getStoredToken();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: "include",
  });
  if (res.status === 401) throw new ApiError("انتهت الجلسة — أعد تسجيل الدخول", 401);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error || `فشل الطلب (${res.status})`, res.status);
  }
  return (await res.json()) as T;
}

// ==================== جداول التقارير ====================

function TotalsLine({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-extrabold">{children}</p>;
}

function DataTable({ heads, children }: { heads: string[]; children: React.ReactNode }) {
  return (
    <div className="max-h-[60vh] overflow-auto rounded-md border">
      <Table>
        <TableHeader className="sticky top-0 bg-muted">
          <TableRow>
            {heads.map((h) => (
              <TableHead key={h} className="whitespace-nowrap">
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
}

const NumCell = ({ v, className = "" }: { v: number | null | undefined; className?: string }) => (
  <TableCell className={`text-end dir-ltr ${className}`} dir="ltr">
    {money(v)}
  </TableCell>
);

function ReportTable({
  kind,
  data,
  showDetails,
  daysMin,
}: {
  kind: ReportKind;
  data: ReportResponse | undefined;
  showDetails: boolean;
  daysMin: number;
}) {
  if (!data) return null;

  if (kind === "summary") {
    const rows = (data.data as SummaryGroup[]) || [];
    const total = rows.reduce((s, g) => s + g.total, 0);
    const accs = new Set(rows.map((g) => g.custodyAccount || "—"));
    const subtotals: { acc: string; lines: number; total: number }[] = [];
    if (accs.size >= 2) {
      const m = new Map<string, { lines: number; total: number }>();
      for (const g of rows) {
        const k = g.custodyAccount || "—";
        const e = m.get(k) || { lines: 0, total: 0 };
        e.lines += g.lines;
        e.total += g.total;
        m.set(k, e);
      }
      for (const acc of [...m.keys()].sort()) subtotals.push({ acc, ...m.get(acc)! });
    }
    return (
      <div className="space-y-2">
        <TotalsLine>
          التصفيات: {rows.length} · الإجمالي: {fmt3(total)} د.ك
        </TotalsLine>
        <DataTable heads={["المرجع", "التاريخ", "العهدة", "البنود", "الإجمالي", "البيان"]}>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                لا تصفيات في الفترة
              </TableCell>
            </TableRow>
          ) : (
            <>
              {rows.map((g) => {
                const acc = g.custodyAccount || "—";
                return (
                  <React.Fragment key={g.ref}>
                    <TableRow>
                      <TableCell className="font-medium">{g.ref}</TableCell>
                      <TableCell dir="ltr" className="text-end">{fmtDate(g.vdate)}</TableCell>
                      <TableCell>{acc}</TableCell>
                      <TableCell className="text-center">{g.lines}</TableCell>
                      <NumCell v={g.total} />
                      <TableCell className="max-w-[24rem] whitespace-normal">{g.description}</TableCell>
                    </TableRow>
                    {showDetails
                      ? g.details.map((d, i) => (
                          <TableRow key={`${g.ref}-${i}`} className="bg-muted/40 text-xs">
                            <TableCell>↳ {d.voucherNumber}</TableCell>
                            <TableCell dir="ltr" className="text-end">{fmtDate(d.vdate)}</TableCell>
                            <TableCell>{acc}</TableCell>
                            <TableCell className="text-center">
                              {d.expenseAccount} · {d.party}
                            </TableCell>
                            <NumCell v={d.amount} />
                            <TableCell className="whitespace-normal">{d.description}</TableCell>
                          </TableRow>
                        ))
                      : null}
                  </React.Fragment>
                );
              })}
              {subtotals.map((s) => (
                <TableRow key={`st-${s.acc}`} className="font-bold">
                  <TableCell colSpan={3}>إجمالي: {s.acc}</TableCell>
                  <TableCell className="text-center">{s.lines}</TableCell>
                  <NumCell v={s.total} className="font-bold" />
                  <TableCell />
                </TableRow>
              ))}
            </>
          )}
        </DataTable>
      </div>
    );
  }

  if (kind === "balances") {
    const rows = (data.data as BalanceRow[]) || [];
    const th = rows.reduce((s, r) => s + r.handed, 0);
    const ts = rows.reduce((s, r) => s + r.spent, 0);
    return (
      <div className="space-y-2">
        <TotalsLine>
          العهد: {rows.length} · المُسلَّم: {fmt3(th)} · المُنفَق: {fmt3(ts)} · المتبقي: {fmt3(th - ts)} د.ك
        </TotalsLine>
        <DataTable heads={["العهدة", "المُسلَّم", "المُنفَق", "الرصيد", "تسليمات", "بنود منصرف"]}>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                لا عهد في الفترة
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.accountId}>
                <TableCell>{r.account || "—"}</TableCell>
                <NumCell v={r.handed} />
                <NumCell v={r.spent} />
                <NumCell
                  v={r.balance}
                  className={r.balance < -0.005 ? "font-bold text-red-800" : Math.abs(r.balance) <= 0.005 ? "text-slate-500" : ""}
                />
                <TableCell className="text-center">{r.handedCount || ""}</TableCell>
                <TableCell className="text-center">{r.spentCount || ""}</TableCell>
              </TableRow>
            ))
          )}
        </DataTable>
      </div>
    );
  }

  if (kind === "employee") {
    const payload = data.data as { rows: LedgerRow[]; totals: { in: number; out: number; balance: number }; accountName?: string } | null;
    const rows = payload?.rows || [];
    const t = payload?.totals || { in: 0, out: 0, balance: 0 };
    return (
      <div className="space-y-2">
        <TotalsLine>
          {payload?.accountName || "—"} · الحركات: {rows.length} · الوارد: {fmt3(t.in)} · المنصرف: {fmt3(t.out)} · الرصيد: {fmt3(t.balance)} د.ك
        </TotalsLine>
        <DataTable heads={["التاريخ", "المرجع", "البيان", "وارد", "منصرف", "الرصيد"]}>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                لا حركات في الفترة
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r, i) => (
              <TableRow key={`${r.ref}-${r.voucherId ?? "g"}-${i}`}>
                <TableCell dir="ltr" className="text-end">{fmtDate(r.vdate)}</TableCell>
                <TableCell>{r.ref}</TableCell>
                <TableCell className="max-w-[26rem] whitespace-normal">{r.description}</TableCell>
                <NumCell v={r.in} />
                <NumCell v={r.out} />
                <NumCell v={r.balance} />
              </TableRow>
            ))
          )}
        </DataTable>
      </div>
    );
  }

  if (kind === "detailed") {
    const payload = data.data as { rows: DetailedRow[]; totals: { in: number; out: number; balance: number } } | null;
    const rows = payload?.rows || [];
    const t = payload?.totals || { in: 0, out: 0, balance: 0 };
    return (
      <div className="space-y-2">
        <TotalsLine>
          عدد الحركات: {rows.length} · الوارد: {fmt3(t.in)} · المنصرف: {fmt3(t.out)} · الرصيد: {fmt3(t.balance)} د.ك
        </TotalsLine>
        <DataTable
          heads={["التاريخ", "المرجع", "العهدة", "نوع الحركة", "البيان", "المستلم / المورد", "حساب المصروف", "العميل / العقد", "وارد", "منصرف", "الرصيد"]}
        >
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={11} className="py-6 text-center text-muted-foreground">
                لا حركات في الفترة
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r, i) => (
              <TableRow key={`${r.ref}-${i}`}>
                <TableCell dir="ltr" className="text-end">{fmtDate(r.vdate)}</TableCell>
                <TableCell>{r.ref}</TableCell>
                <TableCell>{r.account}</TableCell>
                <TableCell>{r.type}</TableCell>
                <TableCell className="max-w-[20rem] whitespace-normal">{r.description}</TableCell>
                <TableCell>{r.party}</TableCell>
                <TableCell>{r.expense}</TableCell>
                <TableCell>{r.customer}</TableCell>
                <NumCell v={r.in} />
                <NumCell v={r.out} />
                <NumCell v={r.balance} />
              </TableRow>
            ))
          )}
        </DataTable>
      </div>
    );
  }

  if (kind === "monthly") {
    const payload = data.data as { rows: MonthlyRow[]; totals: { handed: number; spent: number; returned: number } } | null;
    const rows = payload?.rows || [];
    const t = payload?.totals || { handed: 0, spent: 0, returned: 0 };
    return (
      <div className="space-y-2">
        <TotalsLine>
          عدد الصفوف: {rows.length} · تسليم: {fmt3(t.handed)} · صرف: {fmt3(t.spent)} · مرتجع: {fmt3(t.returned)} د.ك
        </TotalsLine>
        <DataTable heads={["الشهر", "العهدة", "رصيد أول المدة", "تسليم", "صرف (تصفية)", "مرتجع", "رصيد آخر المدة"]}>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                لا حركة شهرية في الفترة
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r, i) => (
              <TableRow key={`${r.account}-${r.month}-${i}`}>
                <TableCell dir="ltr" className="text-end">{r.month}</TableCell>
                <TableCell>{r.account}</TableCell>
                <NumCell v={r.opening} />
                <NumCell v={r.handed} />
                <NumCell v={r.spent} />
                <NumCell v={r.returned} />
                <NumCell v={r.closing} />
              </TableRow>
            ))
          )}
        </DataTable>
      </div>
    );
  }

  if (kind === "handovers") {
    const rows = (data.data as HandoverRow[]) || [];
    const total = rows.reduce((s, h) => s + h.amount, 0);
    return (
      <div className="space-y-2">
        <TotalsLine>
          عدد العهد المسلّمة: {rows.length} · إجمالي التسليم: {fmt3(total)} د.ك
        </TotalsLine>
        <DataTable heads={["التاريخ", "رقم العهدة", "العهدة (الحساب)", "المستلم", "المبلغ", "البيان", "طريقة الدفع"]}>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                لا عهد مسلّمة في الفترة
              </TableCell>
            </TableRow>
          ) : (
            rows.map((h) => (
              <TableRow key={h.id}>
                <TableCell dir="ltr" className="text-end">{fmtDate(h.vdate)}</TableCell>
                <TableCell className="font-medium">{h.ref}</TableCell>
                <TableCell>{h.custodyAccount || ""}</TableCell>
                <TableCell>{h.party || ""}</TableCell>
                <NumCell v={h.amount} />
                <TableCell className="max-w-[24rem] whitespace-normal">{h.description || ""}</TableCell>
                <TableCell>{h.method || ""}</TableCell>
              </TableRow>
            ))
          )}
        </DataTable>
      </div>
    );
  }

  // open — العهد المعلقة
  const all = (data.data as OpenRow[]) || [];
  const rows = daysMin > 0 ? all.filter((r) => r.days >= daysMin) : all;
  const tot = rows.reduce((s, r) => s + r.balance, 0);
  return (
    <div className="space-y-2">
      <TotalsLine>
        العهد المعلقة: {rows.length} · إجمالي المفتوح: {fmt3(tot)} د.ك
      </TotalsLine>
      <DataTable heads={["العهدة", "الرصيد المفتوح", "المُسلَّم", "المُنفَق", "أقدم تسليم", "الأيام", "تسليمات"]}>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
              لا عهد معلقة
            </TableCell>
          </TableRow>
        ) : (
          rows.map((r) => (
            <TableRow key={r.accountId}>
              <TableCell>{r.account || "—"}</TableCell>
              <NumCell v={r.balance} />
              <NumCell v={r.handed} />
              <NumCell v={r.spent} />
              <TableCell dir="ltr" className="text-end">{r.oldest || "—"}</TableCell>
              <TableCell className="text-center">{r.days}</TableCell>
              <TableCell className="text-center">{r.handovers}</TableCell>
            </TableRow>
          ))
        )}
      </DataTable>
    </div>
  );
}
