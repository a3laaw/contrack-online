"use client";

/**
 * ج3 — لوحة قيادة المشروع (docs/project-dashboard-design.md §9):
 * الواجهة الكاملة فوق مخرج ج2 حصرًا — GET /api/contracts/[id]/dashboard قراءةً
 * لا كتابة. تركيبها مطابقة نموذج المالك (§5 حرفيًا): بطاقة الرأس · التقدم
 * الإجمالي بأربعة أعمدة (مخطط/رسمي/ميداني + شارات SPI/CPI برؤيتين) · منحنى S
 * ثلاثي (مخطط + رسمي + ميداني — طبقة رابعة عن نموذجه) · الأقسام والفطيرة
 * بالأوزان المشتقة · المال بمكوّنات AC الثلاثة المعلنة · التحذيرات (EVM
 * الخمسة + م1 الثلاثة بنفس المحرك — لا لوحتان) · أعلى بنود التأخر · الطباعة
 * بنمط المستندات القائم (printDoc + doc-print-area).
 * التدريجية §6: بلا بنود ⇒ أصفار/null ببطاقات المال تعمل — رسالة لا انهيار.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Coins, Gauge, LayoutDashboard, Printer, RotateCcw, TrendingDown } from "lucide-react";
import { Cell, Pie, PieChart } from "recharts";
import { CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { apiGet } from "./api";
import { errMessage, type DashboardResponse, type EvmWarningDTO, type ForecastWarningDTO } from "./contrack-types";
import { formatKWD } from "@/lib/format";
import { printDoc } from "./doc-templates/print-doc";

/** منتقي as-of — نفس نمط م1 حرفيًا */
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const EVM_WARNING_ICON: Record<EvmWarningDTO["kind"], React.ComponentType<{ className?: string }>> = {
  spi_official: TrendingDown,
  spi_field: TrendingDown,
  cpi_official: Coins,
  cpi_field: Coins,
  delayed_items: CalendarClock,
};

const M1_WARNING_ICON: Record<ForecastWarningDTO["kind"], React.ComponentType<{ className?: string }>> = {
  late_billing: Coins,
  overrun: TrendingDown,
  stalled: CalendarClock,
};

const chartConfig = {
  plannedCum: { label: "المخطط", color: "var(--chart-4)" },
  officialCum: { label: "الرسمي", color: "var(--chart-1)" },
  fieldCum: { label: "الميداني", color: "var(--chart-2)" },
} satisfies ChartConfig;

const PIE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

/** نسبة مئوية للعرض — null ⇒ «—» */
function pct(n: number | null | undefined): string {
  return n == null ? "—" : `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })}٪`;
}

/** مؤشر EVM للعرض — null ⇒ «—» */
function idx(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** نغمة المؤشر وفق العتبة — null رمادي (§9.2: تحت العتبة warn، null رمادي) */
function idxTone(v: number | null | undefined, min: number): string {
  if (v == null) return "text-muted-foreground";
  return v < min ? "text-destructive" : "text-status-done";
}

/** شريط تقدم — عرضًا محدودًا [0,100] مع نغمة النسبة */
function Bar({ value, tone }: { value: number | null; tone: string }) {
  const w = value == null ? 0 : Math.min(100, Math.max(0, value));
  return (
    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted" role="presentation">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${w}%` }} />
    </div>
  );
}

export function EvmDashboardSection({ contractId }: { contractId: number }) {
  const [asOf, setAsOf] = React.useState<string | null>(null);
  const [asOfDraft, setAsOfDraft] = React.useState("");
  const historical = asOf !== null;

  const q = useQuery<DashboardResponse>({
    queryKey: ["contract", contractId, "dashboard", asOf ?? "live"],
    queryFn: () => apiGet<DashboardResponse>(`/api/contracts/${contractId}/dashboard${asOf ? `?asOf=${asOf}` : ""}`),
  });

  const evm = q.data?.evm;
  const header = evm?.header;
  const money = evm?.money;
  const divisions = evm?.divisions ?? [];
  const evmWarnings = evm?.warnings ?? [];
  const m1Warnings = q.data?.warnings ?? [];
  const delayedItems = evm?.delayedItems ?? [];
  const contract = q.data?.contract;

  // الفطيرة — أوزان مشتقة حصرًا (§4.5) — الأقسام بقيمة موجبة حصرًا
  const pieData = React.useMemo(
    () =>
      divisions
        .filter((d) => d.value > 0)
        .map((d) => ({ name: d.divisionName || d.divisionCode, value: d.value, weight: d.weightPct })),
    [divisions]
  );

  // العتبات الفعّالة من الاستجابة (ج3 §9.3) — مع افتراضي وقائي لو تعطلت استجابة قديمة
  const th = q.data?.thresholds ?? { spiMin: 0.95, cpiMin: 0.95, maxDelayDays: 7 };

  return (
    <Card className="print:shadow-none">
      <CardHeader className="p-0 pb-2 print:hidden">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-1.5">
            <LayoutDashboard className="size-4 text-primary-ink/70" aria-hidden />
            لوحة قيادة المشروع — EVM
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => printDoc()}
              aria-label="طباعة اللوحة"
            >
              <Printer className="size-3.5" />
              طباعة
            </Button>
            {historical ? (
              <>
                <Badge variant="warn" className="text-[11px]">وضع تاريخي — قراءة فقط</Badge>
                <Badge variant="outline" className="text-[11px] tabular-nums" dir="ltr">{asOf}</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => {
                    setAsOf(null);
                    setAsOfDraft("");
                  }}
                >
                  <RotateCcw className="size-3.5" />
                  العودة إلى الحاضر
                </Button>
              </>
            ) : (
              <>
                <Input
                  type="date"
                  className="h-8 w-40"
                  value={asOfDraft}
                  max={todayStr()}
                  aria-label="اللوحة كما كانت في تاريخ"
                  onChange={(e) => setAsOfDraft(e.target.value)}
                />
                <Button size="sm" variant="outline" className="h-8" disabled={!asOfDraft} onClick={() => setAsOf(asOfDraft)}>
                  كما كانت في…
                </Button>
              </>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {q.isLoading ? (
          <div className="space-y-2 p-3" aria-busy="true">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-56 w-full" />
          </div>
        ) : q.isError ? (
          <p className="p-3 text-sm text-destructive">{errMessage(q.error)}</p>
        ) : !evm ? (
          <p className="p-3 text-center text-sm text-muted-foreground">لا بيانات للوحة.</p>
        ) : (
          <div className="doc-print-area space-y-3 p-3">
            {/* ① بطاقة الرأس — §5.1: المشروع · المدة/المنقضي · البداية والإتمام المتوقع */}
            <div className="rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold">{contract?.contractName || "—"}</p>
                  <p className="text-[11px] text-muted-foreground">
                    عقد <span className="tabular-nums" dir="ltr">{contract?.contractNumber || "—"}</span>
                    {" · "}{contract?.customerName || "—"}
                  </p>
                </div>
                <Badge variant="outline" className="text-[11px] tabular-nums" dir="ltr">
                  {q.data?.mode === "historical" ? `asOf ${asOf}` : evm.today}
                </Badge>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div>
                  <div className="text-[10px] text-muted-foreground">المدة المخططة</div>
                  <div className="font-bold tabular-nums" dir="ltr">
                    {header?.durationDays == null ? "—" : `${header.durationDays} يومًا`}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">المنقضي</div>
                  <div className={`font-bold tabular-nums ${header?.elapsedPct != null && header.elapsedPct > 100 ? "text-warn-ink" : ""}`} dir="ltr">
                    {header?.elapsedDays == null ? "—" : `${header.elapsedDays} يومًا`}
                    {header?.elapsedPct != null ? ` (${pct(header.elapsedPct)})` : ""}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">البداية المخططة</div>
                  <div className="font-bold tabular-nums" dir="ltr">{header?.projectStart || "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">الإتمام المتوقع</div>
                  <div className="font-bold tabular-nums" dir="ltr">{header?.expectedFinish || "—"}</div>
                </div>
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                نهاية المخطط: <span className="tabular-nums" dir="ltr">{header?.plannedFinishMax || "—"}</span>
              </p>
            </div>

            {/* ② التقدم الإجمالي — أربعة أعمدة (§5.2) — PV% · رسمي% · ميداني% + شارات SPI/CPI برؤيتين */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">المخطط — PV</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-primary-ink" dir="ltr">{pct(evm.pvPct)}</p>
                <Bar value={evm.pvPct} tone="bg-chart-4" />
                <p className="mt-1 text-[10px] text-muted-foreground">{formatKWD(evm.pv)} من BAC</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">الرسمي — مستخلصات</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-primary-ink" dir="ltr">{pct(evm.evOfficialPct)}</p>
                <Bar value={evm.evOfficialPct} tone="bg-chart-1" />
                <p className="mt-1 text-[10px] text-muted-foreground">{formatKWD(evm.evOfficial)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">الميداني — تنفيذ يومي</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-primary-ink" dir="ltr">{pct(evm.evFieldPct)}</p>
                <Bar value={evm.evFieldPct} tone="bg-chart-2" />
                <p className="mt-1 text-[10px] text-muted-foreground">{formatKWD(evm.evField)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">المؤشرات — SPI / CPI</p>
                <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1.5 text-xs">
                  <div>
                    <div className="text-[10px] text-muted-foreground">SPI رسمي</div>
                    <div className={`font-bold tabular-nums ${idxTone(evm.spiOfficial, th.spiMin)}`} dir="ltr">{idx(evm.spiOfficial)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">SPI ميداني</div>
                    <div className={`font-bold tabular-nums ${idxTone(evm.spiField, th.spiMin)}`} dir="ltr">{idx(evm.spiField)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">CPI رسمي</div>
                    <div className={`font-bold tabular-nums ${idxTone(evm.cpiOfficial, th.cpiMin)}`} dir="ltr">{idx(evm.cpiOfficial)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">CPI ميداني</div>
                    <div className={`font-bold tabular-nums ${idxTone(evm.cpiField, th.cpiMin)}`} dir="ltr">{idx(evm.cpiField)}</div>
                  </div>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  EAC رسمي {idx(evm.eacOfficial)} · ميداني {idx(evm.eacField)}
                </p>
              </div>
            </div>

            {/* ③ منحنى S ثلاثي — مخطط + رسمي + ميداني تراكميًا (§5.3 — طبقة رابعة عن نموذجه) */}
            <div className="rounded-lg border p-3">
              <p className="text-xs font-bold">منحنى S — التراكمي الثلاثي (مخطط × رسمي × ميداني)</p>
              <p className="text-[10px] text-muted-foreground">BAC = {formatKWD(evm.bac)} — أرضية بنود الكميات الظاهرة (§8.2.1)</p>
              {evm.sCurve.length < 2 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  نقاط المنحنى تُشتق من نوافذ البنود وتواريخ التنفيذ والاعتمادات — تحتاج حركتين مؤرختين على الأقل.
                </p>
              ) : (
                <ChartContainer config={chartConfig} className="mt-2 h-56 w-full">
                  <LineChart data={evm.sCurve} margin={{ top: 8, left: 8, right: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(5)} tick={{ fontSize: 10 }} />
                    <YAxis
                      width={56}
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)}
                    />
                    <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="stepAfter" dataKey="plannedCum" stroke="var(--color-plannedCum)" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="officialCum" stroke="var(--color-officialCum)" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="fieldCum" stroke="var(--color-fieldCum)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ChartContainer>
              )}
            </div>

            {/* ④ الأقسام + الفطيرة — الأوزان مشتقة حصرًا قسم÷BAC (§5.4) */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <p className="mb-1.5 text-xs font-bold">تقدم الأقسام</p>
                {divisions.length === 0 ? (
                  <p className="rounded-lg border p-3 text-center text-xs text-muted-foreground">لا أقسام — بلا بنود ظاهرة.</p>
                ) : (
                  <div className="hidden max-h-96 overflow-y-auto rounded-lg border md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="sticky top-0 bg-card">القسم</TableHead>
                          <TableHead className="sticky top-0 bg-card text-center">الوزن</TableHead>
                          <TableHead className="sticky top-0 bg-card text-center">مخطط</TableHead>
                          <TableHead className="sticky top-0 bg-card text-center">ميداني</TableHead>
                          <TableHead className="sticky top-0 bg-card text-center">رسمي</TableHead>
                          <TableHead className="sticky top-0 bg-card text-center">متأخرون</TableHead>
                          <TableHead className="sticky top-0 bg-card text-center">أقصى تأخر</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {divisions.map((d) => (
                          <TableRow key={d.divisionCode || d.divisionName}>
                            <TableCell>
                              <span className="block text-xs font-bold">{d.divisionName || d.divisionCode || "—"}</span>
                              <span className="text-[10px] text-muted-foreground" dir="ltr">{formatKWD(d.value)}</span>
                            </TableCell>
                            <TableCell className="text-center text-xs tabular-nums" dir="ltr">{pct(d.weightPct)}</TableCell>
                            <TableCell className="text-center text-xs tabular-nums" dir="ltr">{pct(d.plannedPct)}</TableCell>
                            <TableCell className="text-center text-xs tabular-nums" dir="ltr">{pct(d.fieldPct)}</TableCell>
                            <TableCell className="text-center text-xs tabular-nums" dir="ltr">{pct(d.officialPct)}</TableCell>
                            <TableCell className={`text-center text-xs font-bold tabular-nums ${d.delayedCount > 0 ? "text-warn-ink" : ""}`} dir="ltr">
                              {d.delayedCount}
                            </TableCell>
                            <TableCell className={`text-center text-xs tabular-nums ${d.maxDelayDays > 0 ? "text-warn-ink" : "text-muted-foreground"}`} dir="ltr">
                              {d.maxDelayDays > 0 ? `${d.maxDelayDays} يومًا` : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {/* بطاقات الجوال — تناسق 390 بلا تمرير أفقي */}
                <div className="space-y-2 md:hidden">
                  {divisions.map((d) => (
                    <div key={d.divisionCode || d.divisionName} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 text-sm font-bold">{d.divisionName || d.divisionCode || "—"}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground" dir="ltr">وزن {pct(d.weightPct)}</span>
                      </div>
                      <div className="mt-2 grid grid-cols-4 gap-2 text-center text-xs">
                        <div>
                          <div className="text-[10px] text-muted-foreground">مخطط</div>
                          <div className="font-bold tabular-nums" dir="ltr">{pct(d.plannedPct)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground">ميداني</div>
                          <div className="font-bold tabular-nums" dir="ltr">{pct(d.fieldPct)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground">رسمي</div>
                          <div className="font-bold tabular-nums" dir="ltr">{pct(d.officialPct)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground">متأخرون</div>
                          <div className={`font-bold tabular-nums ${d.delayedCount > 0 ? "text-warn-ink" : ""}`} dir="ltr">{d.delayedCount}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-bold">فطيرة أوزان الأقسام</p>
                {pieData.length === 0 ? (
                  <p className="rounded-lg border p-3 text-center text-xs text-muted-foreground">لا أوزان — بلا بنود ظاهرة.</p>
                ) : (
                  <div className="rounded-lg border p-2">
                    <ChartContainer
                      config={Object.fromEntries(pieData.map((d, i) => [d.name, { label: d.name, color: PIE_COLORS[i % PIE_COLORS.length] }])) as ChartConfig}
                      className="mx-auto h-44 w-full"
                    >
                      <PieChart>
                        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                        <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={30} outerRadius={60} paddingAngle={2} strokeWidth={0} isAnimationActive={false}>
                          {pieData.map((d, i) => (
                            <Cell key={d.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ChartContainer>
                    <div className="mt-1 space-y-0.5 text-[10px] text-muted-foreground">
                      {pieData.map((d, i) => (
                        <p key={d.name} className="flex items-center gap-1.5">
                          <span className="inline-block size-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{d.name}</span>
                          <span className="tabular-nums" dir="ltr">{pct(d.weight)}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ⑤ المال — §5.5: المفوتر · المحصّل · المحتجز · AC بثلاثة مكوّناته · النقد · الحرق · السيولة */}
            <div className="rounded-lg border p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold">
                <Gauge className="size-4 text-muted-foreground" aria-hidden />
                المال — مشتق لحظيًا بلا أي إدخال يدوي
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-6">
                <div className="rounded-lg border p-2.5">
                  <div className="text-[10px] text-muted-foreground">المفوتر (معتمد)</div>
                  <div className="font-bold tabular-nums text-primary-ink" dir="ltr">{formatKWD(money?.billed ?? 0)}</div>
                </div>
                <div className="rounded-lg border p-2.5">
                  <div className="text-[10px] text-muted-foreground">المُحصّل (قبض)</div>
                  <div className="font-bold tabular-nums text-status-done" dir="ltr">{formatKWD(money?.collected ?? 0)}</div>
                </div>
                <div className="rounded-lg border p-2.5">
                  <div className="text-[10px] text-muted-foreground">المحتجز المعلق</div>
                  <div className="font-bold tabular-nums text-warn-ink" dir="ltr">{formatKWD(money?.retentionOutstanding ?? 0)}</div>
                </div>
                <div className="rounded-lg border p-2.5">
                  <div className="text-[10px] text-muted-foreground">AC — المصروفات الفعلية</div>
                  <div className="font-bold tabular-nums text-primary-ink" dir="ltr">{formatKWD(evm.ac)}</div>
                  <div className="text-[9px] text-muted-foreground">
                    سندات {formatKWD(evm.acBreakdown.vouchers)} · رواتب {formatKWD(evm.acBreakdown.labor)} · مواد {formatKWD(evm.acBreakdown.materials)}
                  </div>
                </div>
                <div className="rounded-lg border p-2.5">
                  <div className="text-[10px] text-muted-foreground">النقد المتبقي</div>
                  <div className={`font-bold tabular-nums ${(money?.cashRemaining ?? 0) < 0 ? "text-destructive" : "text-status-done"}`} dir="ltr">
                    {formatKWD(money?.cashRemaining ?? 0)}
                  </div>
                </div>
                <div className="rounded-lg border p-2.5">
                  <div className="text-[10px] text-muted-foreground">السيولة تمشي</div>
                  <div className="font-bold tabular-nums" dir="ltr">
                    {money?.runwayDays == null ? "—" : `${money.runwayDays} يومًا`}
                  </div>
                  <div className="text-[9px] text-muted-foreground" dir="ltr">
                    {money?.burnPerDay ? `حرق ${formatKWD(money.burnPerDay)}/يوم` : "—"}
                  </div>
                </div>
              </div>
            </div>

            {/* ⑥ التحذيرات — EVM الخمسة + م1 الثلاثة بنفس المحرك (§5.6 — لا لوحتان) */}
            <div className="space-y-2" role="list" aria-label="تحذيرات اللوحة">
              {evmWarnings.map((w) => {
                const Icon = EVM_WARNING_ICON[w.kind];
                return (
                  <div key={`evm-${w.kind}`} role="listitem" className="flex items-start gap-2 rounded-lg border border-warn-soft bg-warn-soft p-2.5 text-warn-ink">
                    <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-xs font-bold">{w.title}</p>
                      <p className="text-[11px] leading-relaxed opacity-90">{w.message}</p>
                    </div>
                  </div>
                );
              })}
              {m1Warnings.map((w) => {
                const Icon = M1_WARNING_ICON[w.kind];
                return (
                  <div key={`m1-${w.kind}-${w.boqItemId}`} role="listitem" className="flex items-start gap-2 rounded-lg border border-warn-soft bg-warn-soft p-2.5 text-warn-ink">
                    <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-xs font-bold">{w.title}</p>
                      <p className="text-[11px] leading-relaxed opacity-90">{w.message}</p>
                    </div>
                  </div>
                );
              })}
              {evmWarnings.length === 0 && m1Warnings.length === 0 && (
                <p className="text-center text-[11px] text-muted-foreground">لا تحذيرات — المؤشرات فوق العتبات والميدان يتقدم.</p>
              )}
            </div>

            {/* ⑦ أعلى بنود التأخر — غير المكتملة ميدانيًا حصرًا (§8.2.7) */}
            {delayedItems.length > 0 && (
              <div className="rounded-lg border p-3">
                <p className="text-xs font-bold">أعلى بنود التأخر — {delayedItems.length} بندًا غير مكتمل ميدانيًا بعد نافذته</p>
                <div className="mt-2 hidden max-h-96 overflow-y-auto rounded-lg border md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky top-0 bg-card">البند</TableHead>
                        <TableHead className="sticky top-0 bg-card text-center">نافذته انتهت</TableHead>
                        <TableHead className="sticky top-0 bg-card text-center">التأخر</TableHead>
                        <TableHead className="sticky top-0 bg-card text-center">التعاقدي</TableHead>
                        <TableHead className="sticky top-0 bg-card text-center">الميداني</TableHead>
                        <TableHead className="sticky top-0 bg-card text-center">الاكتمال</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {delayedItems.map((d) => (
                        <TableRow key={d.boqItemId}>
                          <TableCell>
                            <span className="block text-xs tabular-nums text-muted-foreground" dir="ltr">{d.itemNo}</span>
                            <span className="line-clamp-1 text-xs">{d.description}</span>
                          </TableCell>
                          <TableCell className="text-center text-xs tabular-nums" dir="ltr">{d.plannedFinish}</TableCell>
                          <TableCell className="text-center text-xs font-bold tabular-nums text-destructive" dir="ltr">{d.delayDays} يومًا</TableCell>
                          <TableCell className="text-center text-xs tabular-nums" dir="ltr">
                            {d.contractQty}
                            <span className="ms-1 text-[10px] text-muted-foreground">{d.unit}</span>
                          </TableCell>
                          <TableCell className="text-center text-xs tabular-nums" dir="ltr">
                            {d.fieldQty}
                            <span className="ms-1 text-[10px] text-muted-foreground">{d.unit}</span>
                          </TableCell>
                          <TableCell className="text-center text-xs tabular-nums" dir="ltr">{pct(d.fieldPct)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="mt-2 space-y-2 md:hidden">
                  {delayedItems.map((d) => (
                    <div key={d.boqItemId} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 text-sm font-bold">
                          <span className="me-1.5 tabular-nums text-muted-foreground" dir="ltr">{d.itemNo}</span>
                          {d.description}
                        </span>
                        <span className="shrink-0 text-sm font-bold tabular-nums text-destructive" dir="ltr">{d.delayDays} يومًا</span>
                      </div>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        نافذته انتهت <span className="tabular-nums" dir="ltr">{d.plannedFinish}</span>
                        {" · "}ميداني <span className="tabular-nums" dir="ltr">{d.fieldQty}/{d.contractQty} {d.unit}</span>
                        {" · "}{pct(d.fieldPct)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* التدريجية §6 — بلا بنود: رسالة لا انهيار (المال أعلاه اشتغل) */}
            {(q.data?.rows?.length ?? 0) === 0 && (
              <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                لا بنود ظاهرة لهذا العقد — المؤشرات الكمية أصفار والقسمة على صفر «—» والمال يشتغل من الحركات الفعلية (التدريجية §6).
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
