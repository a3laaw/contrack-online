"use client";

/**
 * شاشة العقود — زر «عقد جديد» (وأي فتح بعميل محدد مسبقًا من شاشة العملاء) يعرض
 * صفحة «عقد جديد» الكاملة (ContractNewPage) مكان القائمة بدل النافذة السابقة.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Plus,
  Search,
  RefreshCw,
  FileText,
  CalendarDays,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFeatureFlags } from "./FeatureFlagsProvider";
import { GapsDialog } from "./GapsDialog";
import { ContractNewPage } from "./ContractNewPage";
import { apiGet } from "./api";
import type { ContractsResponse, User } from "./contrack-types";
import { CONTRACT_STATUSES, errMessage } from "./contrack-types";
import { formatKWD, fmtDate, statusBadgeClass } from "@/lib/format";

interface ContractsViewProps {
  user: User;
  onAuthError: () => void;
  onOpenContract: (id: number) => void;
  /** عميل محدد مسبقًا عند القدوم من شاشة العملاء */
  presetCustomerId?: number | null;
  onConsumePreset?: () => void;
}

const STATUS_FILTERS = ["الكل", ...CONTRACT_STATUSES] as const;

export function ContractsView({
  user,
  onAuthError,
  onOpenContract,
  presetCustomerId,
  onConsumePreset,
}: ContractsViewProps) {
  const { enabled: featureEnabled } = useFeatureFlags();
  const [gapsOpen, setGapsOpen] = React.useState(false);
  const manager = user.role === "admin" || user.role === "developer";

  const [searchInput, setSearchInput] = React.useState("");
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<string>("الكل");

  React.useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const statusParam = status === "الكل" ? "" : status;
  const listQuery = useQuery<ContractsResponse>({
    queryKey: ["contracts", q, statusParam],
    queryFn: () =>
      apiGet<ContractsResponse>(
        `/api/contracts?q=${encodeURIComponent(q)}&status=${encodeURIComponent(statusParam)}`
      ),
  });

  // ===== عقد جديد — صفحة كاملة بدل النافذة =====
  const [createPage, setCreatePage] = React.useState<{ presetCustomerId?: number | null } | null>(null);

  // فتح الصفحة مع عميل محدد مسبقًا (كما كان فتح المعالج سابقًا)
  React.useEffect(() => {
    if (presetCustomerId) {
      setCreatePage({ presetCustomerId });
      onConsumePreset?.();
    }
  }, [presetCustomerId, onConsumePreset]);

  const items = listQuery.data?.contracts ?? [];

  // صفحة «عقد جديد» تُعرض مكان القائمة (بعد كل الـhooks — بلا مسار جديد)
  if (createPage) {
    return (
      <ContractNewPage
        onAuthError={onAuthError}
        presetCustomerId={createPage.presetCustomerId}
        onSaved={() => setCreatePage(null)}
        onCancel={() => setCreatePage(null)}
        onOpenContract={onOpenContract}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* تقرير الفروقات — V3.2 (ج) */}
      <GapsDialog
        open={gapsOpen}
        onOpenChange={setGapsOpen}
        onOpenContract={onOpenContract}
      />
      {/* الرأس */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">العقود</h1>
          <p className="text-sm text-muted-foreground">متابعة العقود وقيمها الحالية وتحصيلها</p>
        </div>
        <div className="flex items-center gap-2">
          {/* ⚠️ الفروقات — المرجع: contract_hub.py:80–89 (مفتاح contract_gaps) */}
          {featureEnabled("contract_gaps") && (
            <Button
              variant="outline"
              className="h-9 gap-1.5"
              title="عقود تختلف قيمتها عن خطتها/بنودها"
              onClick={() => setGapsOpen(true)}
            >
              ⚠️ الفروقات
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            onClick={() => listQuery.refetch()}
            aria-label="تحديث"
          >
            <RefreshCw className={listQuery.isFetching ? "size-4 animate-spin" : "size-4"} />
          </Button>
          {manager && (
            <Button
              className="h-9 gap-1.5"
              onClick={() => setCreatePage({})}
            >
              <Plus className="size-4" />
              عقد جديد
            </Button>
          )}
        </div>
      </div>

      {/* الفلاتر */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-10 ps-9"
            placeholder="بحث برقم/اسم العقد أو العميل…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-10 w-full sm:w-44">
            <SelectValue placeholder="الحالة" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* القائمة */}
      {listQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : listQuery.isError ? (
        <Card className="border-status-danger/40">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {errMessage(listQuery.error)}
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <FileText className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {q || statusParam ? "لا عقود مطابقة للفلاتر" : "لا عقود بعد — أنشئ أول عقد"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((ct) => {
            const pct = ct.current > 0 ? Math.min(100, (ct.collected / ct.current) * 100) : 0;
            const remaining = (ct.current ?? 0) - (ct.collected ?? 0);
            return (
              <Card
                key={ct.id}
                className="cursor-pointer gap-2 p-4 transition-colors hover:border-primary/50 hover:shadow-sm"
                onClick={() => onOpenContract(ct.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">{ct.contractName || "عقد بلا اسم"}</div>
                    <div className="text-xs text-muted-foreground" dir="ltr">
                      {ct.contractNumber}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium ${statusBadgeClass(ct.status)}`}>
                    {ct.status}
                  </span>
                </div>

                <div className="space-y-0.5 text-xs text-muted-foreground">
                  <div className="truncate">العميل: {ct.customerName || "—"}</div>
                  <div className="truncate">النوع: {ct.contractType || "—"}</div>
                  <div className="flex items-center gap-1">
                    <CalendarDays className="size-3" />
                    {fmtDate(ct.contractDate)}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 text-sm">
                  <div>
                    <div className="text-[11px] text-muted-foreground">القيمة الحالية</div>
                    <div className="font-bold tabular-nums text-primary" dir="ltr">
                      {formatKWD(ct.current ?? ct.amount)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">المحصّل</div>
                    <div className="font-bold tabular-nums" dir="ltr">
                      {formatKWD(ct.collected)}
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <Progress value={pct} />
                  <div className="flex justify-between text-[11px] text-muted-foreground">
                    <span dir="ltr">{pct.toFixed(0)}%</span>
                    <span>
                      المتبقي:{" "}
                      <span className="tabular-nums" dir="ltr">
                        {formatKWD(remaining)}
                      </span>
                    </span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
