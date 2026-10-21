"use client";

/**
 * صفحة المقاول الكاملة (Task 63) — بدل حوار «تفاصيل المقاول» الصغير (max-w-lg):
 * ترويسة بيانات المقاول وإجمالياته، ثم لكل عقد باطن لديه الكشف الموحّد المشترك
 * (SubcontractorLedger: بنود + دفعات العميل مقابل دفعاته) — نفس المكوّن حرفيًا
 * المعروض في ملف العميل → تفاصيل العقد → «الدفعات والمقاولون»، فالجدول واحد
 * والبيانات واحدة من مصدرها (/api/subcontractors/[id]/ledger بنفس منطق pay-view).
 * تُفتح من شاشة مقاولي الباطن بالنقر على المقاول — استبدال في نفس المستوى.
 */

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, HardHat, Phone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, apiGet } from "./api";
import { errMessage, isManagerRole } from "./contrack-types";
import type { SubcontractorLedgerResponse, User } from "./contrack-types";
import { formatKWD, statusBadgeClass } from "@/lib/format";
import { SubcontractorLedger } from "./SubcontractorLedger";
import { SubContractDialog } from "./SubContractDialog";
import { VoucherPage } from "./VoucherPage";

interface SubcontractorFilePageProps {
  subcontractorId: number;
  user: User;
  onAuthError: () => void;
  onClose: () => void;
}

export function SubcontractorFilePage({ subcontractorId, user, onAuthError, onClose }: SubcontractorFilePageProps) {
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);

  const ledgerQuery = useQuery<SubcontractorLedgerResponse>({
    queryKey: ["subcontractor-ledger", subcontractorId],
    queryFn: () => apiGet<SubcontractorLedgerResponse>(`/api/subcontractors/${subcontractorId}/ledger`),
  });

  React.useEffect(() => {
    const e = ledgerQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [ledgerQuery.error, onAuthError]);

  // تفاصيل/إدارة عقد باطن (البنود وخطة الدفعات) — الحوار المعتمد نفسه
  const [openSubId, setOpenSubId] = React.useState<number | null>(null);
  // الصرف على الباطن — صفحة سند كاملة
  const [payPage, setPayPage] = React.useState<{ subContractId: number; subLabel?: string } | null>(null);

  const invalidateLedger = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["subcontractor-ledger", subcontractorId] });
    qc.invalidateQueries({ queryKey: ["sub-contracts"] });
    qc.invalidateQueries({ queryKey: ["subcontractors"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }, [qc, subcontractorId]);

  if (payPage) {
    return (
      <VoucherPage
        user={user}
        onAuthError={onAuthError}
        mode="payment"
        preset={{ vtype: "payment", subMode: true, subContractId: payPage.subContractId }}
        onSaved={() => {
          invalidateLedger();
          setPayPage(null);
        }}
        onCancel={() => setPayPage(null)}
      />
    );
  }

  const d = ledgerQuery.data;

  return (
    <div className="space-y-4">
      {/* الترويسة */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" className="size-9 shrink-0" onClick={onClose} aria-label="عودة لمقاولي الباطن">
            <ArrowRight className="size-4" />
          </Button>
          <div className="flex items-center gap-2.5">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <HardHat className="size-6" />
            </div>
            <div>
              <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold leading-tight">
                {d ? d.item.name : "…"}
                {d?.item.subCode ? (
                  <span className="text-sm font-normal text-muted-foreground" dir="ltr">
                    {d.item.subCode}
                  </span>
                ) : null}
              </h1>
              <p className="text-sm text-muted-foreground">كشف المقاول — البنود والدفعات لكل عقوده الباطنة</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {d?.item.activity ? <Badge variant="outline">{d.item.activity}</Badge> : null}
          {d?.item.phone ? (
            <Badge variant="outline" className="gap-1" dir="ltr">
              <Phone className="size-3" />
              {d.item.phone}
            </Badge>
          ) : null}
        </div>
      </div>

      {/* الإجماليات */}
      {d && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <FinCell label="عقود باطنة" value={String(d.totals.contractsCount)} hint={`نشطة: ${d.totals.activeCount}`} />
          <FinCell label="إجمالي القيمة" value={formatKWD(d.totals.totalAmount)} />
          <FinCell label="المنصرف (مسدَّد)" value={formatKWD(d.totals.totalPaid)} tone="text-status-done" />
          <FinCell label="المتبقي" value={formatKWD(d.totals.totalRemaining)} tone="text-status-warn" />
          <FinCell
            label="بانتظار تحصيل العميل"
            value={formatKWD(d.totals.totalWaiting)}
            tone={d.totals.totalWaiting > 0 ? "text-status-info" : ""}
            hideZero
          />
        </div>
      )}

      {/* الكتل — لكل عقد باطن كشفه الموحّد */}
      {ledgerQuery.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : ledgerQuery.error ? (
        <Card>
          <CardContent className="p-4 text-center text-sm text-destructive">تعذر تحميل كشف المقاول — {errMessage(ledgerQuery.error)}</CardContent>
        </Card>
      ) : d && d.blocks.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            لا عقود باطنة لهذا المقاول — تُنشأ من داخل تفاصيل عقد العميل («مقاولو الباطن»).
          </CardContent>
        </Card>
      ) : (
        d && (
          <div className="space-y-4">
            {d.blocks.map((b) => (
              <div key={b.id} className="space-y-1.5">
                {/* سياق الكتلة: العقد والعميل الذي يعيش فيه هذا العقد الباطن */}
                <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground" dir="ltr">
                    {b.contractNumber}
                  </span>
                  <span>· عميل العقد: {b.customerName}</span>
                  {b.startDate ? <span dir="ltr">· {b.startDate}{b.endDate ? ` ← ${b.endDate}` : ""}</span> : null}
                  <Badge className={`text-[10px] ${statusBadgeClass(b.status || "")}`}>{b.status || "—"}</Badge>
                </div>
                <SubcontractorLedger
                  name={d.item.name}
                  subCode={d.item.subCode}
                  amount={b.amount}
                  status={b.status}
                  items={b.items}
                  itemsTotal={b.itemsTotal}
                  clientLines={b.clientLines}
                  subLines={b.plan?.lines ?? []}
                  planTotal={b.plan?.planTotal ?? 0}
                  paid={b.paid}
                  waiting={b.waiting}
                  manager={manager}
                  onPay={() => setPayPage({ subContractId: b.id, subLabel: `${d.item.name} — ${b.contractNumber}` })}
                  onManageItems={() => setOpenSubId(b.id)}
                />
              </div>
            ))}
          </div>
        )
      )}

      {/* إدارة البنود وخطة الدفعات — الحوار المعتمد نفسه (تعديل البنود يبقى من هنا) */}
      <SubContractDialog
        subContractId={openSubId}
        onOpenChange={(o) => {
          if (!o) {
            setOpenSubId(null);
            invalidateLedger();
          }
        }}
        user={user}
        onAuthError={onAuthError}
        onPay={() => {
          const id = openSubId;
          setOpenSubId(null);
          if (id !== null) setPayPage({ subContractId: id });
        }}
      />
    </div>
  );
}

/** خلية إجماليات صغيرة في ترويسة الصفحة */
function FinCell({ label, value, hint, tone, hideZero }: { label: string; value: string; hint?: string; tone?: string; hideZero?: boolean }) {
  const zero = value === "0.000" || value === "0";
  return (
    <Card className="gap-0.5 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-base font-bold tabular-nums ${tone || ""}`} dir="ltr">
        {hideZero && zero ? "—" : value}
      </div>
      {hint ? <div className="text-[10px] text-muted-foreground">{hint}</div> : null}
    </Card>
  );
}
