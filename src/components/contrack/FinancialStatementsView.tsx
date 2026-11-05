"use client";

/**
 * شاشة «القوائم المالية» — Task 110 — الصيغة الكويتية الموحدة (القرار الوزاري 44/2016).
 * أربع قوائم تُبنى حصرًا من الأستاذ العام (قيود posted + افتتاحي الحسابات):
 *  1) المركز المالي — أصول / التزامات / حقوق ملكية + نتيجة السنة الجارية، فحص توازن إلزامي
 *  2) قائمة الدخل الشامل — إيرادات الفترة ومصروفاتها ونتيجتها
 *  3) التغيرات في حقوق الملكية — افتتاحي → حركة → نتيجة → إقفال
 *  4) التدفقات النقدية — تشغيلية/استثمارية/تمويلية من الأطراف المقابلة لقيود النقد
 * شاشة قراءة فقط: تعرض ما يحسبه الخادم، وتصدّر CSV/Excel وتبعث طباعة PDF عبر الخادم
 * (الطباعة النهائية محجوبة عند فشل فحوص التوازن — تُتاح كمسودة فقط).
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Landmark,
  Loader2,
  Printer,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
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
import type {
  BalanceSheetResult,
  CashFlowResult,
  EquityChangesResult,
  FsStatementKind,
  IncomeStatementResult,
  StatementsChecks,
} from "@/lib/financial-statements-core";

// ==================== الأنواع ====================

interface FsResponse {
  asOf: string;
  from: string;
  income: IncomeStatementResult;
  balanceSheet: BalanceSheetResult;
  equity: EquityChangesResult;
  cashflow: CashFlowResult;
  checks: StatementsChecks;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const TAB_PERM_OK = true; // الشاشة نفسها خلف صلاحيتها — القوائم الأربع تحت نفس المفتاح

export function FinancialStatementsView({ onAuthError }: { onAuthError: () => void }) {
  const { toast } = useToast();

  // ==================== أدوات التحكم المشتركة ====================
  const [asOf, setAsOf] = React.useState(() => todayStr());
  const [from, setFrom] = React.useState(() => `${todayStr().slice(0, 4)}-01-01`);
  const [tab, setTab] = React.useState("bs");
  const [exporting, setExporting] = React.useState<"csv" | "xlsx" | "pdf" | null>(null);

  const qs = React.useCallback(() => {
    const p = new URLSearchParams();
    p.set("asOf", asOf);
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) p.set("from", from);
    return p.toString();
  }, [asOf, from]);

  const fsQ = useQuery({
    queryKey: ["financial-statements", qs()],
    queryFn: async () => apiGet<FsResponse>(`/api/reports/financial-statements?${qs()}`),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(asOf) && TAB_PERM_OK,
  });

  React.useEffect(() => {
    if (fsQ.error instanceof ApiError && fsQ.error.status === 401) onAuthError();
  }, [fsQ.error, onAuthError]);

  // ==================== التصدير (PDF مسار خاص — CSV/Excel عبر سجل التقارير) ====================
  const kind = tab as FsStatementKind;
  const onExport = async (fmt: "csv" | "xlsx" | "pdf") => {
    if (!fsQ.data) return;
    try {
      setExporting(fmt);
      if (fmt === "pdf") {
        await fetchBlobDownload({
          url: `/api/reports/financial-statements/pdf?kind=${kind}&${qs()}`,
          token: getStoredToken(),
          filename: `القائمة-المالية-${kind}-${asOf}.pdf`,
        });
      } else {
        await fetchBlobDownload({
          url: "/api/reports/export?format=" + fmt,
          method: "POST",
          token: getStoredToken(),
          body: { report: "financial-statements", params: Object.fromEntries(new URLSearchParams(qs()) as any) },
          filename: `القائمة-المالية-${kind}-${asOf}.${fmt}`,
        });
      }
      toast({ title: "تم التصدير", description: fmt === "pdf" ? "نُزّل ملف PDF بنجاح" : fmt === "xlsx" ? "نُزّل ملف Excel بنجاح" : "نُزّل ملف CSV بنجاح" });
    } catch (e) {
      if ((e as { status?: number }).status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر التصدير", description: errMessage(e) });
    } finally {
      setExporting(null);
    }
  };

  const data = fsQ.data;
  const loading = fsQ.isFetching;
  const kindLabel: Record<FsStatementKind, string> = {
    bs: "المركز المالي",
    is: "قائمة الدخل",
    eq: "حقوق الملكية",
    cf: "التدفقات النقدية",
  };

  return (
    <main className="space-y-6">
      {/* ==================== الترويسة والتحكم ==================== */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Landmark className="h-6 w-6 text-primary" aria-hidden="true" />
            القوائم المالية
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            الصيغة الكويتية الموحدة (القرار الوزاري 44/2016) — تُبنى حصرًا من الأستاذ العام بلا أي إدخال يدوي، مع فحوص توازن موثقة قبل الطباعة.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => fsQ.refetch()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          تحديث
        </Button>
      </div>

      {/* ==================== بطاقات الفحوص ==================== */}
      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <CheckCard label="ميزان المراجعة" passed={data.checks.trialBalanced} detail="مجموع الأرصدة = 0" />
          <CheckCard label="المركز المالي" passed={data.balanceSheet.balanced} detail={`فرق ${formatKWD(data.balanceSheet.diff)}`} />
          <CheckCard label="التدفقات ↔ النقد" passed={data.cashflow.reconciles} detail={`فرق ${formatKWD(data.cashflow.diff)}`} />
          <CheckCard label="حقوق الملكية" passed={data.equity.consistent} detail="افتتاحي + حركة + نتيجة = إقفال" />
        </div>
      )}
      {data && !data.checks.allPassed && data.checks.notes.length > 0 && (
        <Card className="border-status-danger/40 bg-status-danger-bg/40">
          <CardContent className="flex flex-col gap-1 p-4 text-sm text-status-danger">
            {data.checks.notes.map((n, i) => (
              <div key={i} className="flex items-center gap-2">
                <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                {n}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ==================== فلاتر التاريخ + التصدير ==================== */}
      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="fs-asof">حتى تاريخ (إقفال القوائم)</Label>
            <Input id="fs-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fs-from">بداية فترة الدخل/الحركة</Label>
            <Input id="fs-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2 lg:justify-end">
            <Button size="sm" variant="outline" onClick={() => onExport("csv")} disabled={!data || exporting !== null}>
              {exporting === "csv" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => onExport("xlsx")} disabled={!data || exporting !== null}>
              {exporting === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              Excel
            </Button>
            <Button size="sm" variant="outline" onClick={() => onExport("pdf")} disabled={!data || exporting !== null}>
              {exporting === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              طباعة PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {!data && loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="ml-2 h-5 w-5 animate-spin" aria-hidden="true" /> جاري بناء القوائم من الأستاذ…
        </div>
      )}

      {data && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
            <TabsTrigger value="bs">المركز المالي</TabsTrigger>
            <TabsTrigger value="is">قائمة الدخل</TabsTrigger>
            <TabsTrigger value="eq">حقوق الملكية</TabsTrigger>
            <TabsTrigger value="cf">التدفقات النقدية</TabsTrigger>
          </TabsList>

          {/* ==================== المركز المالي ==================== */}
          <TabsContent value="bs" className="space-y-4">
            <StatementMeta
              title="قائمة المركز المالي"
              period={`حتى ${data.asOf}`}
              balanced={data.balanceSheet.balanced}
              note="الأصول = الالتزامات + حقوق الملكية (تشمل نتيجة السنة الجارية غير المقفلة)"
            />
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[46%]">البند</TableHead>
                    <TableHead className="text-center">الأصول (مدين)</TableHead>
                    <TableHead className="text-center">الالتزامات (دائن)</TableHead>
                    <TableHead className="text-center">حقوق الملكية (دائن)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <SectionRow title="الأصول" colSpan={3} />
                  {data.balanceSheet.assets.lines.map((l) => (
                    <StatementRow key={`a-${l.code}`} code={l.code} name={l.name} amount={l.amount} col={0} />
                  ))}
                  <TotalRow label="إجمالي الأصول" amount={data.balanceSheet.totalAssets} col={0} />
                  <SectionRow title="الالتزامات" colSpan={3} />
                  {data.balanceSheet.liabilities.lines.map((l) => (
                    <StatementRow key={`l-${l.code}`} code={l.code} name={l.name} amount={l.amount} col={1} />
                  ))}
                  <TotalRow label="إجمالي الالتزامات" amount={data.balanceSheet.liabilities.total} col={1} />
                  <SectionRow title="حقوق الملكية" colSpan={3} />
                  {data.balanceSheet.equity.lines.map((l, i) => (
                    <StatementRow key={`e-${l.code}-${i}`} code={l.code} name={l.name} amount={l.amount} col={2} computed={l.computed} />
                  ))}
                  <TotalRow label="إجمالي حقوق الملكية (مع النتيجة)" amount={data.balanceSheet.equityWithResult} col={2} />
                  <TableRow className="bg-primary text-primary-foreground font-bold">
                    <TableCell className="text-right">إجمالي الالتزامات وحقوق الملكية</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-center">{formatKWD(data.balanceSheet.totalLiabilitiesEquity)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* ==================== قائمة الدخل ==================== */}
          <TabsContent value="is" className="space-y-4">
            <StatementMeta
              title="قائمة الدخل الشامل"
              period={`${data.from} ← ${data.asOf}`}
              balanced
              note={data.income.netResult >= 0 ? `صافي ربح الفترة ${formatKWD(data.income.netResult)}` : `صافي خسارة الفترة ${formatKWD(-data.income.netResult)}`}
            />
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60%]">البند</TableHead>
                    <TableHead className="text-center">المبلغ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <SectionRow title="الإيرادات" colSpan={1} />
                  {data.income.revenue.lines.map((l) => (
                    <StatementRow key={`r-${l.code}`} code={l.code} name={l.name} amount={l.amount} col={0} credit />
                  ))}
                  <TotalRow label="إجمالي الإيرادات" amount={data.income.revenue.total} col={0} credit />
                  {data.income.expenses.map((sec) => (
                    <React.Fragment key={`sec-${sec.title}`}>
                      <SectionRow title={sec.title} colSpan={1} />
                      {sec.lines.map((l) => (
                        <StatementRow key={`x-${l.code}`} code={l.code} name={l.name} amount={l.amount} col={0} />
                      ))}
                      <TotalRow label={`إجمالي ${sec.title}`} amount={sec.total} col={0} />
                    </React.Fragment>
                  ))}
                  <TotalRow label="إجمالي المصروفات" amount={data.income.expensesTotal} col={0} />
                  <TableRow className="bg-primary text-primary-foreground font-bold">
                    <TableCell className="text-right">{data.income.netResult >= 0 ? "صافي الربح للفترة" : "صافي الخسارة للفترة"}</TableCell>
                    <TableCell className="text-center">{formatKWD(Math.abs(data.income.netResult))}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* ==================== حقوق الملكية ==================== */}
          <TabsContent value="eq" className="space-y-4">
            <StatementMeta
              title="قائمة التغيرات في حقوق الملكية"
              period={`${data.from} ← ${data.asOf}`}
              balanced={data.equity.consistent}
              note="افتتاحي + حركة الفترة + نتيجة الفترة = الإقفال"
            />
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[36%]">الحساب</TableHead>
                    <TableHead className="text-center">افتتاحي</TableHead>
                    <TableHead className="text-center">زيادة</TableHead>
                    <TableHead className="text-center">نقصان</TableHead>
                    <TableHead className="text-center">إقفال</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.equity.rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">لا توجد حسابات حقوق ملكية بأرصدة</TableCell>
                    </TableRow>
                  )}
                  {data.equity.rows.map((r) => (
                    <TableRow key={`eq-${r.code}`}>
                      <TableCell className="text-right">
                        <span className="font-mono text-xs text-muted-foreground">{r.code}</span> {r.name}
                      </TableCell>
                      <TableCell className="text-center">{formatKWD(r.opening)}</TableCell>
                      <TableCell className="text-center text-status-done">{r.increase ? formatKWD(r.increase) : "—"}</TableCell>
                      <TableCell className="text-center text-status-danger">{r.decrease ? formatKWD(r.decrease) : "—"}</TableCell>
                      <TableCell className="text-center font-semibold">{formatKWD(r.closing)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/60 font-semibold">
                    <TableCell className="text-right">نتيجة الفترة (من قائمة الدخل)</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell className={`text-center ${data.equity.netResult >= 0 ? "text-status-done" : "text-status-danger"}`}>
                      {formatKWD(data.equity.netResult)}
                    </TableCell>
                  </TableRow>
                  <TableRow className="bg-primary text-primary-foreground font-bold">
                    <TableCell className="text-right">حقوق الملكية بعد النتيجة</TableCell>
                    <TableCell className="text-center">{formatKWD(data.equity.openingTotal)}</TableCell>
                    <TableCell className="text-center">{formatKWD(data.equity.movementNet)}</TableCell>
                    <TableCell />
                    <TableCell className="text-center">{formatKWD(data.equity.closingTotal)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* ==================== التدفقات النقدية ==================== */}
          <TabsContent value="cf" className="space-y-4">
            <StatementMeta
              title="قائمة التدفقات النقدية"
              period={`${data.from} ← ${data.asOf}`}
              balanced={data.cashflow.reconciles}
              note={`حسابات النقد ${data.cashflow.cashAccounts.join(" · ") || "—"} — من الأطراف المقابلة لقيود النقد (تحويلات نقد↔نقد مستثناة)`}
            />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniCard label="صافي التشغيلية" value={data.cashflow.totals.operating} />
              <MiniCard label="صافي الاستثمارية" value={data.cashflow.totals.investing} />
              <MiniCard label="صافي التمويلية" value={data.cashflow.totals.financing} />
              <MiniCard label="التغير في النقد" value={data.cashflow.cashDelta} accent />
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[46%]">البند</TableHead>
                    <TableHead className="text-center">وارد</TableHead>
                    <TableHead className="text-center">منصرف</TableHead>
                    <TableHead className="text-center">الصافي</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <CfSection label="الأنشطة التشغيلية" rows={data.cashflow.operating} total={data.cashflow.totals.operating} />
                  <CfSection label="الأنشطة الاستثمارية" rows={data.cashflow.investing} total={data.cashflow.totals.investing} />
                  <CfSection label="الأنشطة التمويلية" rows={data.cashflow.financing} total={data.cashflow.totals.financing} />
                  {data.cashflow.unclassified.length > 0 && (
                    <CfSection label="غير مصنف (يتطلب ضبط التصنيف في دليل الحسابات)" rows={data.cashflow.unclassified} total={data.cashflow.totals.unclassified} warn />
                  )}
                  <TableRow className="bg-primary text-primary-foreground font-bold">
                    <TableCell className="text-right">صافي التغير في النقد</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-center">{formatKWD(data.cashflow.totals.net)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-right text-muted-foreground">النقد افتتاحي الفترة</TableCell>
                    <TableCell colSpan={3} className="text-center">{formatKWD(data.cashflow.openingCash)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-right text-muted-foreground">النقد إقفالي الفترة</TableCell>
                    <TableCell colSpan={3} className="text-center font-semibold">{formatKWD(data.cashflow.closingCash)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      )}

      {!TAB_PERM_OK && null}
      <p className="pb-2 text-center text-xs text-muted-foreground">
        القوائم المولدة تتحقق آليًا من توازن الأستاذ قبل الطباعة — الطباعة النهائية محجوبة عند أي فشل (تُتاح كمسودة من مسار PDF عبر force=1).
      </p>
    </main>
  );
}

// ==================== عناصر العرض المساعدة ====================

function CheckCard({ label, passed, detail }: { label: string; passed: boolean; detail: string }) {
  return (
    <Card className={passed ? "border-status-done/40" : "border-status-danger/50"}>
      <CardContent className="flex items-center gap-3 p-4">
        {passed ? (
          <CheckCircle2 className="h-8 w-8 shrink-0 text-status-done" aria-hidden="true" />
        ) : (
          <TriangleAlert className="h-8 w-8 shrink-0 text-status-danger" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{label}</div>
          <div className="truncate text-xs text-muted-foreground">{passed ? "ناجح ✓" : detail}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-bold ${accent ? "text-primary" : value >= 0 ? "text-status-done" : "text-status-danger"}`}>
        {formatKWD(value)}
      </div>
    </Card>
  );
}

function StatementMeta({ title, period, balanced, note }: { title: string; period: string; balanced: boolean; note: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="text-xs text-muted-foreground">{note}</p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline">{period}</Badge>
        <Badge className={balanced ? "bg-status-done-bg text-status-done" : "bg-status-danger-bg text-status-danger"}>
          {balanced ? "متوازن ✓" : "غير متوازن!"}
        </Badge>
      </div>
    </div>
  );
}

function SectionRow({ title, colSpan }: { title: string; colSpan: number }) {
  return (
    <TableRow className="bg-muted/70">
      <TableCell className="font-bold text-primary" colSpan={1}>
        {title}
      </TableCell>
      <TableCell colSpan={colSpan} />
    </TableRow>
  );
}

function StatementRow({
  code,
  name,
  amount,
  col,
  credit,
  computed,
}: {
  code: string;
  name: string;
  amount: number;
  /** 0=عمود الأصول/المبلغ · 1=الالتزامات · 2=حقوق الملكية */
  col: 0 | 1 | 2;
  credit?: boolean;
  computed?: boolean;
}) {
  const cells = [
    <TableCell key="c0" className="text-center" />,
    <TableCell key="c1" className="text-center" />,
    <TableCell key="c2" className="text-center" />,
  ];
  cells[col] = <TableCell className={`text-center ${computed ? "italic" : ""}`}>{formatKWD(amount)}</TableCell>;
  return (
    <TableRow className="hover:bg-muted/40">
      <TableCell className="text-right">
        {code ? <span className="font-mono text-xs text-muted-foreground">{code}</span> : null} {name}
        {computed ? <span className="mr-1 text-xs text-muted-foreground">(محسوبة)</span> : null}
      </TableCell>
      {cells}
    </TableRow>
  );
}

function TotalRow({ label, amount, col, credit }: { label: string; amount: number; col: 0 | 1 | 2; credit?: boolean }) {
  const cells = [
    <TableCell key="c0" className="text-center" />,
    <TableCell key="c1" className="text-center" />,
    <TableCell key="c2" className="text-center font-bold" />,
  ];
  cells[col] = (
    <TableCell className={`text-center font-bold ${credit !== undefined ? (credit ? "text-status-done" : "") : ""}`}>
      {formatKWD(amount)}
    </TableCell>
  );
  return (
    <TableRow className="border-t-2 border-primary/50 bg-muted/40 font-semibold">
      <TableCell className="text-right">{label}</TableCell>
      {cells}
    </TableRow>
  );
}

function CfSection({ label, rows, total, warn }: { label: string; rows: CashFlowResult["operating"]; total: number; warn?: boolean }) {
  return (
    <>
      <TableRow className={warn ? "bg-status-warn-bg/60" : "bg-muted/70"}>
        <TableCell className={`font-bold ${warn ? "text-status-warn" : "text-primary"}`} colSpan={1}>
          {label}
        </TableCell>
        <TableCell colSpan={3} />
      </TableRow>
      {rows.length === 0 && (
        <TableRow>
          <TableCell className="text-muted-foreground" colSpan={4}>
            &nbsp;&nbsp;— لا حركة مصنفة —
          </TableCell>
        </TableRow>
      )}
      {rows.map((r) => (
        <TableRow key={`cf-${r.code}`} className="hover:bg-muted/40">
          <TableCell className="text-right">
            <span className="font-mono text-xs text-muted-foreground">{r.code}</span> {r.name}
          </TableCell>
          <TableCell className="text-center text-status-done">{r.inflow ? formatKWD(r.inflow) : "—"}</TableCell>
          <TableCell className="text-center text-status-danger">{r.outflow ? formatKWD(r.outflow) : "—"}</TableCell>
          <TableCell className="text-center font-semibold">{formatKWD(r.net)}</TableCell>
        </TableRow>
      ))}
      <TableRow className="bg-muted/40 font-semibold">
        <TableCell className="text-right">صافي {label}</TableCell>
        <TableCell />
        <TableCell />
        <TableCell className="text-center">{formatKWD(total)}</TableCell>
      </TableRow>
    </>
  );
}
