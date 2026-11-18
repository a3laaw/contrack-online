"use client";

/**
 * م1 — قسم «التنبؤ بالأعمال» في صفحة الدفعات (docs/daily-report-forecast-design.md §3.3/§9.3):
 * الرؤيتان المتقابلتان فوق القائم حصرًا — مؤشرات عليا (المستخلص القادم المتوقع ·
 * الفجوة الكلية · تغطية الرسمي للميداني) + جدول البنود (تعاقدي/ميداني/موثق/رسمي/فجوة)
 * + منحنى S (ميداني × رسمي تراكميًا ماليًا) + بطاقات التحذيرات الثلاثة المشتقة لحظيًا.
 * قراءة حصرًا من GET /api/contracts/[id]/forecast — لا مسارات كتابة، والمال يعبر
 * حصرًا عبر اعتماد موقّع (مقترحات لا أفعال — حراسة forecast-engine-vision §3).
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Banknote, Hourglass, RotateCcw, Sparkles, TrendingDown } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

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
import { errMessage } from "./contrack-types";
import type { ForecastResponse, ForecastWarningDTO } from "./contrack-types";
import { formatKWD } from "@/lib/format";

/** منتقي as-of — نفس نمط ز3 (افتح كما كان في…) */
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const WARNING_ICON: Record<ForecastWarningDTO["kind"], React.ComponentType<{ className?: string }>> = {
  late_billing: Banknote,
  overrun: TrendingDown,
  stalled: Hourglass,
};

const chartConfig = {
  fieldCum: { label: "الميداني", color: "var(--chart-2)" },
  officialCum: { label: "الرسمي", color: "var(--chart-1)" },
} satisfies ChartConfig;

/** صياغة رقم بإشارته للفجوة — الموجبة بلا + تكفي، والسالبة بإشارة النص */
function signed(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : `${n}`;
}

export function ForecastSection({ contractId }: { contractId: number }) {
  const [asOf, setAsOf] = React.useState<string | null>(null);
  const [asOfDraft, setAsOfDraft] = React.useState("");
  const historical = asOf !== null;

  const q = useQuery<ForecastResponse>({
    queryKey: ["contract", contractId, "forecast", asOf ?? "live"],
    queryFn: () => apiGet<ForecastResponse>(`/api/contracts/${contractId}/forecast${asOf ? `?asOf=${asOf}` : ""}`),
  });

  const t = q.data?.totals;
  const rows = q.data?.rows ?? [];
  const warnings = q.data?.warnings ?? [];
  const sCurve = q.data?.sCurve ?? [];

  return (
    <Card>
      <CardHeader className="p-0 pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-1.5">
            <Sparkles className="size-4 text-primary-ink/70" aria-hidden />
            التنبؤ بالأعمال — المصالحة
          </span>
          {historical ? (
            <span className="flex flex-wrap items-center gap-1.5">
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
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Input
                type="date"
                className="h-8 w-40"
                value={asOfDraft}
                max={todayStr()}
                aria-label="المصالحة كما كانت في تاريخ"
                onChange={(e) => setAsOfDraft(e.target.value)}
              />
              <Button size="sm" variant="outline" className="h-8" disabled={!asOfDraft} onClick={() => setAsOf(asOfDraft)}>
                كما كانت في…
              </Button>
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {q.isLoading ? (
          <div className="space-y-2 p-3" aria-busy="true">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : q.isError ? (
          <p className="p-3 text-sm text-destructive">{errMessage(q.error)}</p>
        ) : rows.length === 0 ? (
          <p className="p-3 text-center text-sm text-muted-foreground">
            لا بنود ظاهرة للمصالحة — أضف بنود مقايسة أو سجلات تنفيذ ثم عُد.
          </p>
        ) : (
          <div className="space-y-3 p-3">
            {/* ① المؤشرات العليا — §3.3: المتوقع القادم · الفجوة الكلية · التغطية */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">المستخلص القادم المتوقع</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-primary-ink" dir="ltr">
                  {formatKWD(t?.expectedNextIpc ?? 0)}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">فجوات موجبة: أعمال منفذة لم تُستخلص بعد</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">الفجوة الكلية (ميداني − رسمي)</p>
                <p
                  className={`mt-1 text-lg font-bold tabular-nums ${((t?.totalGapValue ?? 0) < 0 ? "text-destructive" : "")}`}
                  dir="ltr"
                >
                  {formatKWD(t?.totalGapValue ?? 0)}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  ميداني {formatKWD(t?.fieldAmount ?? 0)} · رسمي {formatKWD(t?.officialAmount ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">تغطية الرسمي للميداني</p>
                <p
                  className={`mt-1 text-lg font-bold tabular-nums ${
                    (t?.coveragePct ?? 0) > 100 ? "text-destructive" : (t?.coveragePct ?? 0) >= 95 ? "text-status-done" : "text-status-warn"
                  }`}
                  dir="ltr"
                >
                  {(t?.coveragePct ?? 0).toLocaleString("en-US", { maximumFractionDigits: 1 })}٪
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {(t?.coveragePct ?? 0) > 100 ? "فوترة تتجاوز الميدان — استباق مقلق" : "النقص = أعمال غير مستخلصة"}
                </p>
              </div>
            </div>

            {/* ② بطاقات التحذيرات الثلاثة — مشتقة لحظيًا لا مخزنة (§3.2) */}
            {warnings.length > 0 && (
              <div className="space-y-2" role="list" aria-label="تحذيرات التنبؤ">
                {warnings.map((w) => {
                  const Icon = WARNING_ICON[w.kind];
                  const tone =
                    w.kind === "stalled" || w.kind === "overrun"
                      ? "border-destructive/40 bg-destructive/5 text-destructive"
                      : "border-warn-soft bg-warn-soft text-warn-ink";
                  return (
                    <div key={`${w.kind}-${w.boqItemId}`} role="listitem" className={`flex items-start gap-2 rounded-lg border p-2.5 ${tone}`}>
                      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                      <div className="min-w-0">
                        <p className="text-xs font-bold">{w.title}</p>
                        <p className="text-[11px] leading-relaxed opacity-90">{w.message}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {warnings.length === 0 && (
              <p className="text-center text-[11px] text-muted-foreground">لا تحذيرات — الرؤيتان متوافقتان حاليًا.</p>
            )}

            {/* ③ منحنى S — الميداني × الرسمي تراكميًا ماليًا عبر الزمن */}
            <div className="rounded-lg border p-3">
              <p className="text-xs font-bold">منحنى S — التراكمي الميداني × الرسمي</p>
              {sCurve.length < 2 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  نقاط المنحنى تُشتق من تواريخ التنفيذ والاعتمادات — تحتاج حركتين مؤرختين على الأقل.
                </p>
              ) : (
                <ChartContainer config={chartConfig} className="mt-2 h-56 w-full">
                  <LineChart data={sCurve} margin={{ top: 8, left: 8, right: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(v: string) => v.slice(5)}
                      tick={{ fontSize: 10 }}
                      reversed={false}
                    />
                    <YAxis
                      width={56}
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)}
                    />
                    <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                    <Line type="monotone" dataKey="fieldCum" stroke="var(--color-fieldCum)" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="officialCum" stroke="var(--color-officialCum)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ChartContainer>
              )}
            </div>

            {/* ④ جدول البنود — الرؤيتان لكل بند (سطح المكتب) */}
            <div className="hidden md:block">
              <p className="mb-1.5 text-xs font-bold">الرؤيتان لكل بند</p>
              <div className="max-h-96 overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky top-0 bg-card">البند</TableHead>
                      <TableHead className="sticky top-0 bg-card text-center">التعاقدي</TableHead>
                      <TableHead className="sticky top-0 bg-card text-center">الميداني</TableHead>
                      <TableHead className="sticky top-0 bg-card text-center">الموثق</TableHead>
                      <TableHead className="sticky top-0 bg-card text-center">الرسمي</TableHead>
                      <TableHead className="sticky top-0 bg-card text-center">الفجوة</TableHead>
                      <TableHead className="sticky top-0 bg-card text-end">قيمة الفجوة</TableHead>
                      <TableHead className="sticky top-0 bg-card text-center">إنجاز متوقع</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.boqItemId}>
                        <TableCell>
                          <span className="block text-xs tabular-nums text-muted-foreground" dir="ltr">{r.itemNo}</span>
                          <span className="line-clamp-1 text-xs">{r.description}</span>
                        </TableCell>
                        <TableCell className="text-center text-xs tabular-nums" dir="ltr">{r.contractQty}</TableCell>
                        <TableCell className="text-center text-xs tabular-nums" dir="ltr">
                          {r.fieldQty}
                          <span className="ms-1 text-[10px] text-muted-foreground">{r.unit}</span>
                        </TableCell>
                        <TableCell className="text-center text-xs tabular-nums text-muted-foreground" dir="ltr">{r.documentedQty}</TableCell>
                        <TableCell className="text-center text-xs tabular-nums" dir="ltr">{r.officialQty}</TableCell>
                        <TableCell className={`text-center text-xs font-bold tabular-nums ${r.gapQty < 0 ? "text-destructive" : r.gapQty > 0 ? "text-warn-ink" : ""}`} dir="ltr">
                          {signed(r.gapQty)}
                        </TableCell>
                        <TableCell className={`text-end text-xs font-bold tabular-nums ${r.gapValue < 0 ? "text-destructive" : r.gapValue > 0 ? "text-primary-ink" : ""}`} dir="ltr">
                          {formatKWD(r.gapValue)}
                        </TableCell>
                        <TableCell className="text-center text-xs tabular-nums" dir="ltr">
                          {r.expectedFinish || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* بطاقات الجوال — تناسق 390 بلا تمرير أفقي (لمس 44px) */}
            <div className="space-y-2 md:hidden">
              <p className="text-xs font-bold">الرؤيتان لكل بند</p>
              {rows.map((r) => (
                <div key={r.boqItemId} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-sm font-bold">
                      <span className="me-1.5 tabular-nums text-muted-foreground" dir="ltr">{r.itemNo}</span>
                      {r.description}
                    </span>
                    <span className={`shrink-0 text-sm font-bold tabular-nums ${r.gapValue < 0 ? "text-destructive" : r.gapValue > 0 ? "text-primary-ink" : ""}`} dir="ltr">
                      {formatKWD(r.gapValue)}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-center text-xs">
                    <div>
                      <div className="text-[10px] text-muted-foreground">تعاقدي</div>
                      <div className="font-bold tabular-nums" dir="ltr">{r.contractQty}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">ميداني</div>
                      <div className="font-bold tabular-nums" dir="ltr">{r.fieldQty}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">موثق</div>
                      <div className="tabular-nums" dir="ltr">{r.documentedQty}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">رسمي</div>
                      <div className="font-bold tabular-nums" dir="ltr">{r.officialQty}</div>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    الفجوة{" "}
                    <span className={`font-bold tabular-nums ${r.gapQty < 0 ? "text-destructive" : ""}`} dir="ltr">
                      {signed(r.gapQty)} {r.unit}
                    </span>
                    {r.expectedFinish && (
                      <>
                        {" · "}إنجاز متوقع <span className="tabular-nums" dir="ltr">{r.expectedFinish}</span>
                      </>
                    )}
                  </p>
                </div>
              ))}
            </div>

            {/* حد م1 المعلن: مقترحات لا أفعال — التحويل إلى مسودة بند م2 بأمر المالك */}
            <p className="text-[11px] text-muted-foreground">
              مقترحات لا أفعال — تحويل الفجوات إلى مسودة مستخلص بند م2 (قرار المالك)، والمال يعبر حصرًا عبر اعتماد موقّع.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
