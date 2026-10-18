"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Banknote,
  Coins,
  HandCoins,
  TrendingUp,
  Wallet,
  AlertTriangle,
  FileText,
  Users as UsersIcon,
  History,
  RefreshCw,
  CalendarClock,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "./api";
import type { DashboardStats, User, ViewName } from "./contrack-types";
import { errMessage } from "./contrack-types";
import { formatKWD, fmtDateTime } from "@/lib/format";

interface DashboardViewProps {
  user: User;
  onAuthError: () => void;
  onNavigate: (view: ViewName) => void;
}

export function DashboardView({ user, onAuthError, onNavigate }: DashboardViewProps) {
  const statsQuery = useQuery<DashboardStats>({
    queryKey: ["dashboard"],
    queryFn: () => apiGet<DashboardStats>("/api/dashboard"),
    refetchInterval: 60_000,
  });

  const stats = statsQuery.data;

  if (statsQuery.isLoading) return <DashboardSkeleton />;

  if (statsQuery.isError || !stats) {
    return (
      <Card className="border-status-danger/40">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <AlertTriangle className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{errMessage(statsQuery.error)}</p>
          <Button variant="outline" size="sm" className="h-9" onClick={() => statsQuery.refetch()}>
            <RefreshCw className="size-4" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  const collectionPct =
    stats.totals.contractsValue > 0
      ? Math.min(100, (stats.totals.collected / stats.totals.contractsValue) * 100)
      : 0;

  const kpis: { label: string; value: string; icon: React.ElementType; tone?: string }[] = [
    { label: "قيمة العقود الحالية", value: formatKWD(stats.totals.contractsValue), icon: TrendingUp },
    { label: "المحصّل", value: formatKWD(stats.totals.collected), icon: HandCoins },
    { label: "المصروف", value: formatKWD(stats.totals.paidOut), icon: Banknote },
    { label: "المستحق الآن", value: formatKWD(stats.dueNow.total), icon: CalendarClock },
    { label: "العقود النشطة", value: String(stats.counts.contractsActive), icon: FileText },
    { label: "إجمالي العقود", value: String(stats.counts.contractsTotal), icon: FileText },
    { label: "العملاء", value: String(stats.counts.customers), icon: UsersIcon },
    { label: "قيمة الباطن", value: formatKWD(stats.totals.subAmount), icon: Wallet },
  ];

  return (
    <div className="space-y-4">
      {/* رأس الصفحة */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">لوحة المؤشرات</h1>
          <p className="text-sm text-muted-foreground">
            مرحبًا {user.fullName || user.username} — نظرة سريعة على الوضع المالي
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="size-9"
          onClick={() => statsQuery.refetch()}
          aria-label="تحديث"
        >
          <RefreshCw className={statsQuery.isFetching ? "size-4 animate-spin" : "size-4"} />
        </Button>
      </div>

      {/* بطاقات KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.label} className="p-4 gap-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{k.label}</span>
                <Icon className="size-4 text-primary/70" />
              </div>
              <div className="text-lg font-bold tabular-nums lg:text-xl" dir="ltr">
                {k.value}
              </div>
            </Card>
          );
        })}
      </div>

      {/* نسبة التحصيل الإجمالية */}
      <Card className="p-4 gap-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">نسبة التحصيل من قيمة العقود</span>
          <span className="tabular-nums text-muted-foreground" dir="ltr">
            {collectionPct.toFixed(1)}%
          </span>
        </div>
        <Progress value={collectionPct} />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* المستحق الآن حسب العميل */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Coins className="size-4 text-primary" />
              المستحق الآن حسب العميل
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            {stats.dueNow.byCustomer.length === 0 ? (
              <p className="px-6 py-4 text-sm text-muted-foreground">لا توجد مستحقات حالية.</p>
            ) : (
              <ul className="max-h-80 space-y-1 overflow-y-auto px-3">
                {stats.dueNow.byCustomer.map((row) => (
                  <li
                    key={row.customerId}
                    className="flex items-center justify-between gap-2 rounded-md px-3 py-2 hover:bg-muted/60"
                  >
                    <span className="truncate text-sm font-medium">{row.customerName}</span>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-primary" dir="ltr">
                      {formatKWD(row.dueNow)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* تنبيهات تعثّر التحصيل */}
        <Card className="border-status-danger/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-muted-foreground" />
              تنبيهات تعثّر التحصيل
              {stats.overdueCollections.length > 0 && (
                <Badge className="bg-status-danger-bg text-status-danger">
                  {stats.overdueCollections.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            {stats.overdueCollections.length === 0 ? (
              <p className="px-6 py-4 text-sm text-muted-foreground">لا توجد متأخرات — أحسنت!</p>
            ) : (
              <ul className="max-h-80 space-y-1 overflow-y-auto px-3">
                {stats.overdueCollections.map((row) => (
                  <li
                    key={row.contractId}
                    className="flex items-center justify-between gap-2 rounded-md px-3 py-2 hover:bg-status-danger-bg/60"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{row.customerName}</div>
                      <div className="text-xs text-muted-foreground" dir="ltr">
                        {row.contractNumber}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="destructive" className="text-[10px]">
                        متأخر {row.daysSince} يوم
                      </Badge>
                      <span className="text-sm font-bold tabular-nums text-status-danger" dir="ltr">
                        {formatKWD(row.remaining)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* آخر الأحداث */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4 text-primary" />
            آخر الأحداث
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-3">
          {stats.recentEvents.length === 0 ? (
            <p className="px-6 py-4 text-sm text-muted-foreground">لا أحداث بعد.</p>
          ) : (
            <ul className="max-h-96 space-y-0 overflow-y-auto px-3">
              {stats.recentEvents.map((ev) => (
                <li key={ev.id} className="flex items-start gap-3 rounded-md px-3 py-2 hover:bg-muted/60">
                  <div className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/60" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {ev.eventType}
                      </Badge>
                      {ev.contractNumber && (
                        <span className="text-xs text-muted-foreground" dir="ltr">
                          {ev.contractNumber}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm">{ev.description}</p>
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground" dir="ltr">
                    {fmtDateTime(ev.eventTime)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-16 rounded-xl" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}
