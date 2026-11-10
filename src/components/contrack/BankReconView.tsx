"use client";

/**
 * شاشة «التسوية البنكية» — Task 113.
 * مطابقة بنود كشوف البنك المستوردة (bank_lines) مع حركات حساب البنك في الأستاذ العام:
 *  • تبويب بنود كشف غير مسجلة → نشر سريع (قيد متوازن عبر المحرك الموحد — يتبع وضع الاعتماد)
 *  • تبويب بنود دفتر عالقة (شيكات لم تُصرف/إيداعات لم تظهر)
 *  • تبويب الأزواج المطابقة
 *  • تقرير الفوارق PDF/CSV/Excel + إقفال موثق (مدير فقط — يُرفض مع أي فرق غير مفسَّر)
 * المعادلة: رصيد الكشف − رصيد الدفتر = بنود الكشف غير المسجلة − بنود الدفتر العالقة.
 */

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Link2,
  Loader2,
  Lock,
  Printer,
  RefreshCw,
  TriangleAlert,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPost, getStoredToken } from "./api";
import { errMessage } from "./contrack-types";
import { fetchBlobDownload } from "@/lib/download-blob";
import { formatKWD } from "@/lib/format";
import { parseStatementText } from "@/lib/bank-recon-core";

// ==================== الأنواع ====================

interface BankSideLineDto { id: number; cdate: string; amount: number; descr: string }
interface GlSideLineDto { id: number; entryId: number; entryNo: number; entryDate: string; description: string; amount: number }
interface PairDto { bank: BankSideLineDto; gl: GlSideLineDto; diff: number; dayGap: number }

interface ReconTotalsDto {
  bankLinesCount: number; glLinesCount: number; matchedCount: number;
  bankOnlyCount: number; bankOnlySum: number;
  glOnlyCount: number; glOnlySum: number;
  statementBalance: number; bookBalance: number;
  gap: number; explained: number; unexplained: number;
}

interface ReconResponse {
  pairs: PairDto[];
  bankOnly: BankSideLineDto[];
  glOnly: GlSideLineDto[];
  totals: ReconTotalsDto;
  account: { id: number; code: string; name: string };
  mappedKeys: string[];
  statementLinesCount: number;
  closedRecord: { id: number; asOf: string; statementBalance: number; bookBalance: number; closedBy: string; closedAt: string; unexplained: number } | null;
}

interface AccountDto { id: number; code: string; name: string; type: string }
interface KeyDto { bankKey: string; linesCount: number; lastDate: string; accountId: number | null; accountCode: string; accountName: string }
interface ClosedDto {
  id: number; accountCode: string; accountName: string; accountId: number; asOf: string;
  statementBalance: number; bookBalance: number;
  bankOnlyCount: number; bankOnlyTotal: number; glOnlyCount: number; glOnlyTotal: number;
  closedBy: string; closedAt: string;
}

interface OptionsResponse {
  bankAccounts: AccountDto[];
  counterpartAccounts: AccountDto[];
  keys: KeyDto[];
  closed: ClosedDto[];
}

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function BankReconView({
  user,
  onAuthError,
}: {
  user: { role: string; username: string };
  onAuthError: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isAdmin = user.role === "admin" || user.role === "developer";

  const [accountId, setAccountId] = React.useState("");
  const [asOf, setAsOf] = React.useState(todayStr());
  const [statementBalance, setStatementBalance] = React.useState("");
  const [tolerance, setTolerance] = React.useState("0");
  const [windowDays, setWindowDays] = React.useState("15");
  const [counterpart, setCounterpart] = React.useState("");
  const [exporting, setExporting] = React.useState<"csv" | "xlsx" | "pdf" | null>(null);
  const [postingId, setPostingId] = React.useState<number | null>(null);
  const [mapOpen, setMapOpen] = React.useState(false);
  const [closeOpen, setCloseOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  const balanceNum = Number(statementBalance);
  const canCompute = !!accountId && /^\d{4}-\d{2}-\d{2}$/.test(asOf) && statementBalance.trim() !== "" && Number.isFinite(balanceNum);

  const optsQ = useQuery({
    queryKey: ["bank-recon-options"],
    queryFn: () => apiGet<OptionsResponse>("/api/reports/bank-reconciliation/options"),
  });

  React.useEffect(() => {
    if (optsQ.error instanceof ApiError && optsQ.error.status === 401) onAuthError();
  }, [optsQ.error, onAuthError]);

  const qs = React.useCallback(() => {
    const p = new URLSearchParams();
    p.set("bankAccountId", accountId);
    p.set("asOf", asOf);
    p.set("statementBalance", String(balanceNum));
    p.set("tolerance", tolerance);
    p.set("window", windowDays);
    return p.toString();
  }, [accountId, asOf, balanceNum, tolerance, windowDays]);

  const reconQ = useQuery({
    queryKey: ["bank-recon", qs()],
    queryFn: () => apiGet<ReconResponse>(`/api/reports/bank-reconciliation?${qs()}`),
    enabled: canCompute,
  });

  React.useEffect(() => {
    if (reconQ.error instanceof ApiError && reconQ.error.status === 401) onAuthError();
  }, [reconQ.error, onAuthError]);

  const t = reconQ.data?.totals;

  // ==================== النشر السريع ====================
  const onQuickPost = async (bankLineId: number) => {
    if (!counterpart) {
      toast({ variant: "destructive", title: "اختر الحساب المقابل أولًا", description: "مثل مصروف رسوم بنكية 5260 أو أي حساب ورقة مناسب." });
      return;
    }
    try {
      setPostingId(bankLineId);
      const res = await apiPost<{ message: string; draft: boolean; entryNo: number }>(
        "/api/reports/bank-reconciliation/quick-post",
        { bankLineId, counterpartAccountId: Number(counterpart) }
      );
      toast({ title: res.draft ? "حُفظت مسودة" : "نُشر القيد", description: res.message });
      await qc.invalidateQueries({ queryKey: ["bank-recon"] });
      await qc.invalidateQueries({ queryKey: ["bank-recon-options"] });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر النشر", description: errMessage(e) });
    } finally {
      setPostingId(null);
    }
  };

  // ==================== الإقفال الموثق ====================
  const onClose = async () => {
    try {
      const res = await apiPost<{ message: string }>("/api/reports/bank-reconciliation/close", {
        bankAccountId: Number(accountId),
        asOf,
        statementBalance: balanceNum,
        tolerance: Number(tolerance),
        window: Number(windowDays),
      });
      toast({ title: "أُقفلت التسوية", description: res.message });
      setCloseOpen(false);
      await qc.invalidateQueries({ queryKey: ["bank-recon"] });
      await qc.invalidateQueries({ queryKey: ["bank-recon-options"] });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر الإقفال", description: errMessage(e) });
    }
  };

  // ==================== التصدير ====================
  const onExport = async (fmt: "csv" | "xlsx" | "pdf") => {
    if (!canCompute) return;
    try {
      setExporting(fmt);
      if (fmt === "pdf") {
        await fetchBlobDownload({
          url: `/api/reports/bank-reconciliation/pdf?${qs()}`,
          token: getStoredToken(),
          filename: `تسوية-بنكية-${asOf}.pdf`,
        });
      } else {
        await fetchBlobDownload({
          url: "/api/reports/export?format=" + fmt,
          method: "POST",
          token: getStoredToken(),
          body: {
            report: "bank-reconciliation",
            params: {
              bankAccountId: accountId,
              asOf,
              statementBalance: String(balanceNum),
              tolerance,
              window: windowDays,
            },
          },
          filename: `تسوية-بنكية-${asOf}.${fmt}`,
        });
      }
      toast({ title: "تم التصدير", description: fmt === "pdf" ? "نُزّل تقرير الفوارق PDF" : fmt === "xlsx" ? "نُزّل Excel" : "نُزّل CSV" });
    } catch (e) {
      if ((e as { status?: number }).status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر التصدير", description: errMessage(e) });
    } finally {
      setExporting(null);
    }
  };

  const accLabel = (a: AccountDto) => `${a.code} — ${a.name}`;
  const selectedAccount = optsQ.data?.bankAccounts.find((a) => String(a.id) === accountId);

  return (
    <div className="flex min-h-screen flex-col gap-4 p-4 md:p-6">
      {/* الترويسة */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="h-6 w-6 text-primary-ink" aria-hidden />
          <div>
            <h1 className="text-xl font-bold md:text-2xl">التسوية البنكية وتقرير الفوارق</h1>
            <p className="text-xs text-muted-foreground md:text-sm">
              مطابقة كشوف البنك المستوردة مع حركات الأستاذ — رصيد الكشف − رصيد الدفتر = بنود الكشف غير المسجلة − بنود الدفتر العالقة
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <FileSpreadsheet className="ml-1 h-4 w-4" aria-hidden /> استيراد كشف
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMapOpen(true)}>
            <Link2 className="ml-1 h-4 w-4" aria-hidden /> ربط الكشوف ({optsQ.data?.keys.filter((k) => !k.accountId).length ?? 0} غير مربوط)
          </Button>
          <Button variant="outline" size="sm" onClick={() => { optsQ.refetch(); reconQ.refetch(); }} disabled={optsQ.isFetching || reconQ.isFetching}>
            {optsQ.isFetching || reconQ.isFetching ? <Loader2 className="ml-1 h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="ml-1 h-4 w-4" aria-hidden />}
            تحديث
          </Button>
        </div>
      </div>

      {/* أدوات التحكم */}
      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1.5">
            <Label htmlFor="br-acc">حساب البنك (111x)</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="br-acc" aria-label="حساب البنك">
                <SelectValue placeholder="اختر حساب البنك" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {(optsQ.data?.bankAccounts ?? []).map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>{accLabel(a)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="br-date">حتى تاريخ</Label>
            <Input id="br-date" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="br-bal">رصيد الكشف عند التاريخ (سحب بالسالب)</Label>
            <Input id="br-bal" type="number" step="0.001" inputMode="decimal" placeholder="مثال: 51606.600" value={statementBalance} onChange={(e) => setStatementBalance(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="br-tol">تسامح المبلغ</Label>
            <Select value={tolerance} onValueChange={setTolerance}>
              <SelectTrigger id="br-tol" aria-label="تسامح المبلغ">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">تام (0.000)</SelectItem>
                <SelectItem value="0.001">فلس واحد (0.001)</SelectItem>
                <SelectItem value="0.100">100 فلس (0.100)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="br-win">نافذة التاريخ (يوم)</Label>
            <Select value={windowDays} onValueChange={setWindowDays}>
              <SelectTrigger id="br-win" aria-label="نافذة التاريخ">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["0", "3", "7", "15", "30", "60"].map((w) => (
                  <SelectItem key={w} value={w}>{w === "0" ? "بنفس اليوم" : `± ${w} يوم`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* بطاقات المعادلة */}
      {t && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">رصيد كشف البنك</p>
              <p className="mt-1 text-lg font-bold md:text-xl">{formatKWD(t.statementBalance)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">رصيد الدفتر (الأستاذ)</p>
              <p className="mt-1 text-lg font-bold md:text-xl">{formatKWD(t.bookBalance)}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {selectedAccount ? `${selectedAccount.code} · افتتاحي + حركات منشورة` : ""}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">الفرق (كشف − دفتر)</p>
              <p className="mt-1 text-lg font-bold md:text-xl">{formatKWD(t.gap)}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">مُفسَّر: {formatKWD(t.explained)}</p>
            </CardContent>
          </Card>
          <Card className={t.unexplained === 0 ? "border-emerald-300" : "border-red-300"}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">الفرق غير المفسَّر</p>
              <p className={`mt-1 flex items-center gap-1.5 text-lg font-bold md:text-xl ${t.unexplained === 0 ? "text-emerald-600" : "text-red-600"}`}>
                {t.unexplained === 0 ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <TriangleAlert className="h-5 w-5" aria-hidden />}
                {formatKWD(t.unexplained)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* شريط التصدير والإقفال */}
      {reconQ.data && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => onExport("pdf")} disabled={exporting !== null}>
            {exporting === "pdf" ? <Loader2 className="ml-1 h-4 w-4 animate-spin" aria-hidden /> : <Printer className="ml-1 h-4 w-4" aria-hidden />} تقرير الفوارق PDF
          </Button>
          <Button size="sm" variant="outline" onClick={() => onExport("csv")} disabled={exporting !== null}>
            {exporting === "csv" ? <Loader2 className="ml-1 h-4 w-4 animate-spin" aria-hidden /> : <Download className="ml-1 h-4 w-4" aria-hidden />} CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => onExport("xlsx")} disabled={exporting !== null}>
            {exporting === "xlsx" ? <Loader2 className="ml-1 h-4 w-4 animate-spin" aria-hidden /> : <FileSpreadsheet className="ml-1 h-4 w-4" aria-hidden />} Excel
          </Button>
          <Button
            size="sm"
            onClick={() => setCloseOpen(true)}
            disabled={!isAdmin || t?.unexplained !== 0}
            title={!isAdmin ? "الإقفال محصور بالمدير" : t?.unexplained !== 0 ? "سوِّ الفرق غير المفسَّر أولًا" : "إقفال موثق بالسجل"}
          >
            <Lock className="ml-1 h-4 w-4" aria-hidden /> إقفال موثق
          </Button>
          {reconQ.data.closedRecord && (
            <Badge variant="secondary" className="gap-1">
              <Lock className="h-3 w-3" aria-hidden /> مُقفل لهذا التاريخ بواسطة {reconQ.data.closedRecord.closedBy}
            </Badge>
          )}
        </div>
      )}

      {/* التبويبات */}
      <Tabs defaultValue="bank-only" className="flex-1">
        <TabsList className="flex w-full flex-wrap">
          <TabsTrigger value="bank-only">
            بنود كشف غير مسجلة {t ? `(${t.bankOnlyCount})` : ""}
          </TabsTrigger>
          <TabsTrigger value="gl-only">
            بنود دفتر عالقة {t ? `(${t.glOnlyCount})` : ""}
          </TabsTrigger>
          <TabsTrigger value="pairs">
            الأزواج المطابقة {t ? `(${t.matchedCount})` : ""}
          </TabsTrigger>
          <TabsTrigger value="closed">سجل الإقفالات ({optsQ.data?.closed.length ?? 0})</TabsTrigger>
        </TabsList>

        {/* بنود الكشف غير المسجلة */}
        <TabsContent value="bank-only" className="space-y-3">
          <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="space-y-1.5 min-w-56 flex-1">
              <Label htmlFor="br-counter">الحساب المقابل للنشر السريع</Label>
              <Select value={counterpart} onValueChange={setCounterpart}>
                <SelectTrigger id="br-counter" aria-label="الحساب المقابل">
                  <SelectValue placeholder="اختر الحساب المقابل (مصروف/ذمم/أخرى)" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {(optsQ.data?.counterpartAccounts ?? []).map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>{accLabel(a)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="max-w-md text-xs text-muted-foreground">
              إيداع (+) ← مدين البنك / دائن المقابل · سحب (−) ← مدين المقابل / دائن البنك. يتبع وضع الاعتماد إن كان مفعّلًا (مسودة للمحاسبين).
            </p>
          </div>
          <div className="max-h-96 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">التاريخ</TableHead>
                  <TableHead>البيان</TableHead>
                  <TableHead className="w-24">الاتجاه</TableHead>
                  <TableHead className="w-36 text-left">المبلغ (د.ك)</TableHead>
                  <TableHead className="w-32">إجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reconQ.isLoading && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center">
                      <Loader2 className="ml-2 inline h-4 w-4 animate-spin" aria-hidden /> يجري الحساب…
                    </TableCell>
                  </TableRow>
                )}
                {reconQ.data && reconQ.data.bankOnly.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      ✓ كل بنود الكشف حتى هذا التاريخ مسجلة في الدفتر
                    </TableCell>
                  </TableRow>
                )}
                {reconQ.data?.bankOnly.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap">{l.cdate}</TableCell>
                    <TableCell className="max-w-72 truncate">{l.descr || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={l.amount > 0 ? "default" : "destructive"}>{l.amount > 0 ? "إيداع" : "سحب"}</Badge>
                    </TableCell>
                    <TableCell className={`text-left font-mono tabular-nums ${l.amount < 0 ? "text-red-600" : ""}`}>{formatKWD(l.amount)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="secondary" onClick={() => onQuickPost(l.id)} disabled={postingId !== null}>
                        {postingId === l.id ? <Loader2 className="ml-1 h-4 w-4 animate-spin" aria-hidden /> : <Zap className="ml-1 h-4 w-4" aria-hidden />}
                        تسوية سريعة
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* بنود الدفتر العالقة */}
        <TabsContent value="gl-only" className="space-y-3">
          <p className="text-xs text-muted-foreground">
            حركات منشورة على حساب البنك لم تظهر في الكشف — شيكات صادرة لم تُصرف أو إيداعات عالقة. لا تُقيد — تُتابع حتى ظهورها بالكشف القادم.
          </p>
          <div className="max-h-96 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">القيد</TableHead>
                  <TableHead className="w-28">التاريخ</TableHead>
                  <TableHead>البيان</TableHead>
                  <TableHead className="w-36 text-left">المبلغ (د.ك)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reconQ.data && reconQ.data.glOnly.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">✓ لا بنود عالقة — الدفتر مطابق للكشف</TableCell>
                  </TableRow>
                )}
                {reconQ.data?.glOnly.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono">#{l.entryNo}</TableCell>
                    <TableCell className="whitespace-nowrap">{l.entryDate}</TableCell>
                    <TableCell className="max-w-80 truncate">{l.description || "—"}</TableCell>
                    <TableCell className={`text-left font-mono tabular-nums ${l.amount < 0 ? "text-red-600" : ""}`}>{formatKWD(l.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* الأزواج المطابقة */}
        <TabsContent value="pairs" className="space-y-3">
          <div className="max-h-96 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">تاريخ الكشف</TableHead>
                  <TableHead>بيان الكشف ↔ القيد</TableHead>
                  <TableHead className="w-28">فرق الأيام</TableHead>
                  <TableHead className="w-36 text-left">المبلغ (د.ك)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reconQ.data && reconQ.data.pairs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">لا أزواج مطابقة — راجع النافذة والتسامح</TableCell>
                  </TableRow>
                )}
                {reconQ.data?.pairs.map((p) => (
                  <TableRow key={`${p.bank.id}-${p.gl.id}`}>
                    <TableCell className="whitespace-nowrap">{p.bank.cdate}</TableCell>
                    <TableCell className="max-w-96 truncate">
                      {p.bank.descr || "—"} <span className="text-muted-foreground">↔ قيد #{p.gl.entryNo}</span>
                    </TableCell>
                    <TableCell>
                      {p.dayGap === 0 ? <Badge variant="secondary">بنفس اليوم</Badge> : <Badge variant="outline">{p.dayGap > 0 ? `+${p.dayGap}` : p.dayGap} يوم</Badge>}
                    </TableCell>
                    <TableCell className="text-left font-mono tabular-nums">{formatKWD(p.bank.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* سجل الإقفالات */}
        <TabsContent value="closed" className="space-y-3">
          <div className="max-h-96 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">الحساب</TableHead>
                  <TableHead className="w-28">حتى تاريخ</TableHead>
                  <TableHead className="w-36 text-left">رصيد الكشف</TableHead>
                  <TableHead className="w-36 text-left">رصيد الدفتر</TableHead>
                  <TableHead className="w-24">بنود معلقة</TableHead>
                  <TableHead className="w-28">بواسطة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(optsQ.data?.closed.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">لا إقفالات بعد — أقفل أول تسوية بعد تصفير الفوارق</TableCell>
                  </TableRow>
                )}
                {optsQ.data?.closed.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap">{c.accountCode} {c.accountName}</TableCell>
                    <TableCell className="whitespace-nowrap">{c.asOf}</TableCell>
                    <TableCell className="text-left font-mono tabular-nums">{formatKWD(c.statementBalance)}</TableCell>
                    <TableCell className="text-left font-mono tabular-nums">{formatKWD(c.bookBalance)}</TableCell>
                    <TableCell>{c.bankOnlyCount + c.glOnlyCount}</TableCell>
                    <TableCell>{c.closedBy}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* حوار ربط الكشوف */}
      <BankMapDialog open={mapOpen} onOpenChange={setMapOpen} isAdmin={isAdmin} onAuthError={onAuthError} />

      {/* حوار استيراد كشف */}
      <ImportStatementDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        knownKeys={optsQ.data?.keys.map((k) => k.bankKey) ?? []}
        onAuthError={onAuthError}
      />

      {/* حوار تأكيد الإقفال */}
      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>إقفال التسوية موثقًا</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>سيُسجل إقفال تسوية <b>{selectedAccount?.name}</b> حتى <b>{asOf}</b> برصيد كشف <b>{formatKWD(balanceNum)}</b>.</p>
            <p className="text-muted-foreground">الإقفال يُرفض مع أي فرق غير مفسَّر، ويُحفظ في السجل مع لقطة الفوارق للتدقيق (يمكن إعادة الإقفال لنفس التاريخ ليحل مكانه).</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseOpen(false)}>إلغاء</Button>
            <Button onClick={onClose}><Lock className="ml-1 h-4 w-4" aria-hidden /> إقفال</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ==================== حوار ربط كشوف البنك ====================

function BankMapDialog({
  open, onOpenChange, isAdmin, onAuthError,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; isAdmin: boolean; onAuthError: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [savingKey, setSavingKey] = React.useState<string | null>(null);

  const optsQ = useQuery({
    queryKey: ["bank-recon-options"],
    queryFn: () => apiGet<OptionsResponse>("/api/reports/bank-reconciliation/options"),
    enabled: open,
  });

  const accounts = optsQ.data?.counterpartAccounts ?? [];

  const onSave = async (bankKey: string, accountId: string) => {
    try {
      setSavingKey(bankKey);
      await apiPost("/api/reports/bank-reconciliation/mappings", { bankKey, accountId: Number(accountId) });
      toast({ title: "تم الربط", description: `رُبط «${bankKey}» بالحساب المختار.` });
      await qc.invalidateQueries({ queryKey: ["bank-recon-options"] });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر الربط", description: errMessage(e) });
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>ربط كشوف البنك بحسابات الدليل</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          كل مفتاح كشف (من عمود حساب البنك عند الاستيراد) يُربط مرة واحدة بحساب بنك ورقي في الدليل — بعدها تظهر بنوده في التسوية. {isAdmin ? "" : "العرض فقط — الربط محصور بالمدير."}
        </p>
        <div className="max-h-96 overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>مفتاح الكشف</TableHead>
                <TableHead className="w-24">البنود</TableHead>
                <TableHead className="w-32">آخر تاريخ</TableHead>
                <TableHead className="w-64">حساب الدليل</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(optsQ.data?.keys.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    لا كشوف مستوردة بعد — استورد كشفًا من شاشة البوابة المالية أولًا
                  </TableCell>
                </TableRow>
              )}
              {optsQ.data?.keys.map((k) => (
                <TableRow key={k.bankKey}>
                  <TableCell className="font-mono text-xs">{k.bankKey || "(افتراضي)"}</TableCell>
                  <TableCell>{k.linesCount}</TableCell>
                  <TableCell className="whitespace-nowrap">{k.lastDate || "—"}</TableCell>
                  <TableCell>
                    <Select
                      value={k.accountId ? String(k.accountId) : ""}
                      onValueChange={(v) => onSave(k.bankKey, v)}
                      disabled={!isAdmin || savingKey === k.bankKey}
                    >
                      <SelectTrigger aria-label={`ربط ${k.bankKey}`} className="h-8">
                        <SelectValue placeholder={isAdmin ? "اختر حسابًا…" : "غير مربوط"} />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {accounts.map((a) => (
                          <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ==================== حوار استيراد كشف بنك ====================

function ImportStatementDialog({
  open, onOpenChange, knownKeys, onAuthError,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; knownKeys: string[]; onAuthError: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [bankKey, setBankKey] = React.useState("");
  const [text, setText] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const parsed = React.useMemo(() => parseStatementText(text), [text]);

  const onSave = async () => {
    if (!bankKey.trim()) {
      toast({ variant: "destructive", title: "أدخل مفتاح كشف البنك", description: "رقم الحساب البنكي كما يظهر في كشفك — يُربط لاحقًا بحساب الدليل." });
      return;
    }
    if (!parsed.lines.length) {
      toast({ variant: "destructive", title: "لا بنود مفهومة", description: "سطر لكل بند: تاريخ,مبلغ,بيان — السحب بإشارة سالبة أو بين أقواس." });
      return;
    }
    try {
      setSaving(true);
      const res = await apiPost<{ message: string }>("/api/reports/bank-reconciliation/import", { bankKey: bankKey.trim(), text });
      toast({ title: "تم الاستيراد", description: res.message });
      onOpenChange(false);
      setText("");
      await qc.invalidateQueries({ queryKey: ["bank-recon-options"] });
      await qc.invalidateQueries({ queryKey: ["bank-recon"] });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر الاستيراد", description: errMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>استيراد كشف بنك (لصق نص / CSV)</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="br-import-key">مفتاح كشف البنك (رقم الحساب البنكي)</Label>
            <Input
              id="br-import-key"
              value={bankKey}
              onChange={(e) => setBankKey(e.target.value)}
              placeholder="مثال: KW81NBOK000000000000123456789"
              list="br-known-keys"
            />
            <datalist id="br-known-keys">
              {knownKeys.map((k) => <option key={k} value={k} />)}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="br-import-text">نص الكشف — سطر لكل بند: تاريخ,مبلغ,بيان</Label>
            <textarea
              id="br-import-text"
              className="h-40 w-full rounded-md border bg-background p-2 font-mono text-xs"
              placeholder={"2026-03-01,1000.500,إيداع عميل\n2026-03-02,-45.250,رسوم بنكية\n05/03/2026,(90),عمولة تحويل"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              الأعمدة بفاصلة أو Tab · السحب بإشارة سالبة أو بين أقواس · يُقبل تاريخ يوم/شهر/سنة أو العكس · الأسطر غير المفهومة تُتخطى ولا تُخمَّن.
            </p>
          </div>
          {text.trim() && (
            <div className={`rounded-lg border p-3 text-sm ${parsed.lines.length ? "bg-muted/40" : "border-red-300 bg-red-50"}`}>
              {parsed.lines.length ? (
                <>
                  <p className="font-semibold">معاينة: {parsed.lines.length} بندًا مفهومًا{parsed.skipped ? ` — تُتخطى ${parsed.skipped}` : ""}</p>
                  <div className="mt-1 max-h-32 overflow-y-auto font-mono text-xs text-muted-foreground">
                    {parsed.lines.slice(0, 8).map((l, i) => (
                      <div key={i}>{l.cdate} · {l.amount > 0 ? "+" : ""}{l.amount.toFixed(3)} · {l.descr || "—"}</div>
                    ))}
                    {parsed.lines.length > 8 && <div>… و{parsed.lines.length - 8} آخرين</div>}
                  </div>
                </>
              ) : (
                <p className="text-red-600">لا سطور مفهومة — تأكد من وجود عمود تاريخ وعمود مبلغ في كل سطر.</p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={onSave} disabled={saving || !parsed.lines.length}>
            {saving ? <Loader2 className="ml-1 h-4 w-4 animate-spin" aria-hidden /> : <Download className="ml-1 h-4 w-4" aria-hidden />}
            استيراد ({parsed.lines.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
