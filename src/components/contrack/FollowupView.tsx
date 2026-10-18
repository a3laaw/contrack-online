"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  ChevronLeft,
  ClipboardList,
  HandCoins,
  RefreshCw,
  TimerReset,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet } from "./api";
import type { FollowupResponse, User } from "./contrack-types";
import { errMessage } from "./contrack-types";
import { formatKWD, fmtDate } from "@/lib/format";

interface FollowupViewProps {
  user: User;
  onAuthError: () => void;
  onOpenContract: (contractId: number) => void;
}

function daysLabel(n: number | undefined | null): string {
  const v = Number(n ?? 0);
  return `${v} ${v === 1 ? "يوم" : v === 2 ? "يومين" : v <= 10 ? "أيام" : "يومًا"}`;
}

/** صف قابل للنقر يفتح العقد */
function Row({
  onClick,
  title,
  subtitle,
  trailing,
  badge,
  badgeClass,
}: {
  onClick?: () => void;
  title: React.ReactNode;
  subtitle: React.ReactNode;
  trailing: React.ReactNode;
  badge: string;
  badgeClass: string;
}) {
  const interactive = typeof onClick === "function";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      className={`flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-start transition-colors ${
        interactive ? "cursor-pointer hover:border-primary/40 hover:bg-accent/50" : "cursor-default"
      }`}
    >
      <Badge className={`${badgeClass} shrink-0 whitespace-nowrap`}>{badge}</Badge>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
          <span dir="ltr">{title}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {subtitle}
        </div>
      </div>
      <div className="shrink-0 text-end">{trailing}</div>
      {interactive && <ChevronLeft className="size-4 shrink-0 text-muted-foreground/60" />}
    </button>
  );
}

export function FollowupView({ user: _user, onAuthError, onOpenContract }: FollowupViewProps) {
  const { toast } = useToast();

  const followQuery = useQuery<FollowupResponse>({
    queryKey: ["followup"],
    queryFn: () => apiGet<FollowupResponse>("/api/followup"),
  });

  React.useEffect(() => {
    const e = followQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [followQuery.error, onAuthError]);

  const data = followQuery.data;

  const sections: {
    key: string;
    title: string;
    desc: string;
    icon: React.ComponentType<{ className?: string }>;
    count: number;
    badgeClass: string;
    cardClass: string;
    empty: string;
    content: React.ReactNode[];
  }[] = [
    {
      key: "dueNow",
      title: "المستحق الآن",
      desc: "دفعات استحقاقها اليوم أو قبله (صارم: بلا تخطٍ أو انتظار مرحلة)",
      icon: HandCoins,
      count: data?.dueNow?.length ?? 0,
      badgeClass: "bg-status-danger-bg text-status-danger",
      cardClass: "bg-red-500/10 text-status-danger",
      empty: "لا مستحقات سارية اليوم — أحسنت",
      content: (data?.dueNow ?? []).map((r, i) => (
        <Row
          key={`d-${i}`}
          onClick={r.contractId != null ? () => onOpenContract(r.contractId as number) : undefined}
          title={r.contractNumber}
          subtitle={
            <>
              <span>{r.customerName}</span>
              {r.title && <span>· {r.title}</span>}
              {r.daysDiff != null && Number(r.daysDiff) !== 0 && <span>· متأخر {daysLabel(Math.abs(Number(r.daysDiff)))}</span>}
            </>
          }
          badge={r.daysDiff != null && Number(r.daysDiff) > 0 ? `متأخر ${daysLabel(Number(r.daysDiff))}` : "مستحق اليوم"}
          badgeClass="bg-status-danger-bg text-status-danger"
          trailing={
            <div>
              <div className="text-sm font-bold tabular-nums text-status-danger" dir="ltr">
                {formatKWD(r.remaining)}
              </div>
              <div className="text-[10px] text-muted-foreground">المتبقي</div>
            </div>
          }
        />
      )),
    },
    {
      key: "overdueCollections",
      title: "تعثر التحصيل",
      desc: "عقود عليها متبقٍ ومر على آخر قبض مدة طويلة",
      icon: AlertTriangle,
      count: data?.overdueCollections?.length ?? 0,
      badgeClass: "bg-status-warn-bg text-status-warn",
      cardClass: "bg-orange-500/10 text-status-warn",
      empty: "لا تعثر في التحصيل",
      content: (data?.overdueCollections ?? []).map((r, i) => (
        <Row
          key={`o-${i}`}
          onClick={r.contractId != null ? () => onOpenContract(r.contractId as number) : undefined}
          title={r.contractNumber}
          subtitle={
            <>
              <span>{r.customerName}</span>
              {r.lastReceiptDate ? (
                <span>· آخر قبض: {fmtDate(r.lastReceiptDate)}</span>
              ) : (
                <span>· بلا أي قبض</span>
              )}
            </>
          }
          badge={`منذ ${daysLabel(r.daysSince)}`}
          badgeClass="bg-status-warn-bg text-status-warn"
          trailing={
            <div>
              <div className="text-sm font-bold tabular-nums text-status-warn" dir="ltr">
                {formatKWD(r.remaining)}
              </div>
              <div className="text-[10px] text-muted-foreground">المتبقي</div>
            </div>
          }
        />
      )),
    },
    {
      key: "expiring",
      title: "عقود تنتهي قريبًا",
      desc: "حسب أيام التنبيه المضبوطة في الإعدادات",
      icon: CalendarClock,
      count: data?.expiring?.length ?? 0,
      badgeClass: "bg-status-warn-bg text-status-warn",
      cardClass: "bg-amber-500/10 text-status-warn",
      empty: "لا عقود على وشك الانتهاء",
      content: (data?.expiring ?? []).map((r, i) => (
        <Row
          key={`e-${i}`}
          onClick={r.contractId != null ? () => onOpenContract(r.contractId as number) : undefined}
          title={r.contractNumber}
          subtitle={
            <>
              <span>{r.customerName}</span>
              <span>· ينتهي: {fmtDate(r.endDate)}</span>
            </>
          }
          badge={`باقي ${daysLabel(r.daysLeft)}`}
          badgeClass="bg-status-warn-bg text-status-warn"
          trailing={
            <div className="text-[11px] text-muted-foreground" dir="ltr">
              {fmtDate(r.endDate)}
            </div>
          }
        />
      )),
    },
    {
      key: "nearBaseEnd",
      title: "إشراف قرب نهاية الأساس",
      desc: "عقود إشراف اقترب انتهاء مدتها الأساسية (قبل التمديد)",
      icon: TimerReset,
      count: data?.nearBaseEnd?.length ?? 0,
      badgeClass: "bg-status-info-bg text-status-info",
      cardClass: "bg-sky-500/10 text-status-info",
      empty: "لا إشراف قارب على نهاية الأساس",
      content: (data?.nearBaseEnd ?? []).map((r, i) => (
        <Row
          key={`b-${i}`}
          onClick={r.contractId != null ? () => onOpenContract(r.contractId as number) : undefined}
          title={r.contractNumber}
          subtitle={
            <>
              <span>نهاية الأساس: {fmtDate(r.baseEnd)}</span>
            </>
          }
          badge={`باقي ${daysLabel(r.daysLeft)}`}
          badgeClass="bg-status-info-bg text-status-info"
          trailing={
            <div className="text-[11px] text-muted-foreground" dir="ltr">
              {fmtDate(r.baseEnd)}
            </div>
          }
        />
      )),
    },
  ];

  return (
    <div className="space-y-4">
      {/* الترويسة */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ClipboardList className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">المتابعة</h1>
            <p className="text-xs text-muted-foreground">المستحقات وتعثر التحصيل والانتهاءات — كل صف يفتح عقده</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          disabled={followQuery.isRefetching}
          onClick={() => followQuery.refetch()}
        >
          <RefreshCw className={`size-4 ${followQuery.isRefetching ? "animate-spin" : ""}`} />
          تحديث
        </Button>
      </div>

      {/* بطاقات العد */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {followQuery.isLoading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
          : sections.map((s) => {
              const Icon = s.icon;
              return (
                <Card key={s.key}>
                  <CardContent className="flex items-center gap-3 p-3">
                    <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${s.cardClass}`}>
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-lg font-extrabold tabular-nums leading-none">{s.count}</div>
                      <div className="mt-1 truncate text-[11px] text-muted-foreground">{s.title}</div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
      </div>

      {/* الأقسام */}
      {followQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : followQuery.isError ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">
            تعذر تحميل المتابعة — {errMessage(followQuery.error)}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {sections.map((s) => (
            <section key={s.key} className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold">{s.title}</h2>
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tabular-nums">
                  {s.count}
                </Badge>
                <span className="hidden truncate text-xs text-muted-foreground sm:inline">— {s.desc}</span>
              </div>
              {s.content.length === 0 ? (
                <p className="rounded-lg border border-dashed bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
                  {s.empty}
                </p>
              ) : (
                <div className="space-y-2">{s.content}</div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
