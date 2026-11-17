"use client";

/**
 * CustomerStatementPanel — ر2 «ملف العميل الموحّد» (قرار المالك):
 * كشف حساب العميل الشامل مضمّنًا داخل ملف العميل (تبويب «الكشف المالي») —
 * يجمّع كل عقود العميل بأقسام مع مجموع لكل عقد (نفس تركيب StatementView)
 * + فلاتر الفترة + PDF خادميًا — بدون قفز لشاشة الكشوفات.
 * القاعدة 5: الفواتير «للعلم» فقط ولا تخفض المديونية.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Banknote, CalendarRange, FileDown, HandCoins, Loader2, Printer, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, getStoredToken } from "./api";
import { fetchBlobDownload } from "@/lib/download-blob";
import { StatementTable } from "./StatementTable";
import type { CustomerStatementResponse } from "./contrack-types";
import { errMessage } from "./contrack-types";
import { formatKWD } from "@/lib/format";

type FinCardDef = { label: string; value: number; icon: React.ComponentType<{ className?: string }>; tone?: string };

/** بطاقات المؤشرات — نفس نمط شاشة الكشوفات */
function FinCards({ cards }: { cards: FinCardDef[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Card key={c.label}>
            <CardContent className="flex items-center gap-3 p-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-ink">
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

export function CustomerStatementPanel({
  customerId,
  customerName,
  onAuthError,
}: {
  customerId: number;
  customerName: string;
  onAuthError: () => void;
}) {
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [pdfBusy, setPdfBusy] = React.useState(false);
  const { toast } = useToast();

  const periodQs = React.useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return p.toString();
  }, [from, to]);

  const statementQuery = useQuery<CustomerStatementResponse>({
    queryKey: ["customer-file", customerId, "statement", periodQs],
    queryFn: () => {
      const extra = periodQs ? `?${periodQs}` : "";
      return apiGet<CustomerStatementResponse>(`/api/statement/customer/${customerId}${extra}`);
    },
  });

  // الكشف يأتي مدمجًا زمنيًا مع «إجمالي العقد» لكل عقد و«الإجمالي العام» — جاهز للعرض
  const rows = statementQuery.data?.rows ?? [];

  React.useEffect(() => {
    if (statementQuery.error instanceof ApiError && statementQuery.error.status === 401) onAuthError();
  }, [statementQuery.error, onAuthError]);

  const totals = statementQuery.data?.totals ?? null;

  const onPdfExport = async () => {
    if (pdfBusy) return;
    const base = `كشف حساب شامل ${customerName || customerId}`;
    try {
      setPdfBusy(true);
      await fetchBlobDownload({
        url: `/api/statement/customer/${customerId}/pdf${periodQs ? `?${periodQs}` : ""}`,
        token: getStoredToken(),
        filename: `${base}.pdf`,
      });
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
      {/* فلاتر الفترة + الإجراءات */}
      <Card className="print-hidden">
        <CardContent className="flex flex-wrap items-end justify-between gap-3 p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary-ink">
              <CalendarRange className="size-4" />
            </div>
            <div className="w-36 space-y-1">
              <Label className="text-xs text-muted-foreground">من تاريخ</Label>
              <Input type="date" dir="ltr" className="h-9" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="w-36 space-y-1">
              <Label className="text-xs text-muted-foreground">إلى تاريخ</Label>
              <Input type="date" dir="ltr" className="h-9" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            {(from || to) && (
              <Button variant="ghost" size="sm" className="h-9 gap-1" onClick={() => { setFrom(""); setTo(""); }}>
                إلغاء الفترة
              </Button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              disabled={pdfBusy || statementQuery.isLoading || rows.length === 0}
              onClick={onPdfExport}
            >
              {pdfBusy ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
              {pdfBusy ? "جارٍ إنشاء PDF…" : "▦ كشف PDF"}
            </Button>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => window.print()}>
              <Printer className="size-4" />
              طباعة
            </Button>
          </div>
        </CardContent>
      </Card>

      {statementQuery.isLoading ? (
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
      ) : statementQuery.isError ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">
            تعذر تحميل الكشف — {errMessage(statementQuery.error)}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <FinCards
            cards={[
              { label: "إجمالي المدين", value: totals?.debit ?? 0, icon: Wallet },
              { label: "إجمالي الدائن", value: totals?.credit ?? 0, icon: HandCoins },
              {
                label: "المتبقي",
                value: totals?.remaining ?? 0,
                icon: Banknote,
                tone: (totals?.remaining ?? 0) > 0.001 ? "text-status-warn" : "text-status-done",
              },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            الكشف الشامل للعميل: <span className="font-medium text-foreground">{customerName}</span> —{" "}
            {statementQuery.data?.contractsCount ?? 0} عقد
          </p>
          <StatementTable
            rows={rows}
            totals={totals}
            loading={statementQuery.isLoading}
            emptyMessage="لا عقود أو حركات لهذا العميل في هذه الفترة"
          />
        </div>
      )}
    </div>
  );
}
