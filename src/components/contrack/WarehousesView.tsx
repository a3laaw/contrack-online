"use client";

/**
 * WarehousesView.tsx — شاشة موديول «المخازن» (docs/warehouses-design.md §7):
 * ثلاثة أقسام يملكها تبويب الشل «المخازن» (nav-structure → section):
 *   الأصناف والمستودعات · أذون المخازن (إدخال/صرف/تحويل/جرد) · الأرصدة والتقارير
 * + بطاقات مؤشرات (ملخص /api/warehouses/summary) تظهر في كل الأقسام.
 * الموديول يظهر حصرًا للشركات التي فعّلته (navModules) — والإيقاف يرجع 403 برسالة عربية.
 * الأرصدة اشتقاقية من الخادم حصرًا (درس G9) — لا تُحسب في العميل أبدًا.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Boxes,
  ClipboardList,
  Package,
  PackagePlus,
  Warehouse,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, apiGet } from "./api";
import { errMessage, type User } from "./contrack-types";
import { ItemsSection } from "./warehouses/ItemsSection";
import { DocsSection } from "./warehouses/DocsSection";
import { BalancesSection } from "./warehouses/BalancesSection";

// ==================== أنواع مشتركة ====================

export type WarehousesSection = "items" | "docs" | "balances";

export interface WarehousesViewProps {
  user: User;
  onAuthError: () => void;
  section: WarehousesSection;
}

export interface WarehouseRow {
  id: number;
  name: string;
  location: string;
  active: boolean;
  notes: string;
  docCount: number;
}

export interface StockItemRow {
  id: number;
  name: string;
  unit: string;
  category: string;
  minQty: number;
  active: boolean;
  notes: string;
  lineCount: number;
}

export interface WhSummaryResponse {
  stockValue: number;
  activeItems: number;
  activeWarehouses: number;
  belowMin: number;
  docsThisMonth: number;
}

// ==================== مساعدات عرض ====================

/** تنسيق الأرقام بالفواصل وثلاث منزلات — أرقام لاتينية للاتساق مع بقية الشاشات */
const numFmt = new Intl.NumberFormat("ar-KW-u-nu-latn", { maximumFractionDigits: 3 });
export function fmtNum(n: number): string {
  return numFmt.format(Number.isFinite(n) ? n : 0);
}
export function fmtMoney(n: number): string {
  return `${fmtNum(n)} د.ك`;
}
/** منسق الكميات — إزالة الأصفار الزائدة (0.500 ⇒ 0.5) */
export function fmtQty(n: number): string {
  const v = Math.round(n * 1000) / 1000;
  return fmtNum(Object.is(v, -0) ? 0 : v);
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <Card className="gap-1 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="size-4 shrink-0 text-primary/70" />
      </div>
      <p className={`text-base font-bold tabular-nums sm:text-lg ${tone || ""}`}>{value}</p>
      {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
    </Card>
  );
}

// SECTION_META (مرآة الأقسام) أُزيلت — شريط التابات انتقل للشل ModuleTabsBar (docs/mobile-tabs-design.md)

// ==================== الشاشة الرئيسية ====================

export function WarehousesView({ user, onAuthError, section }: WarehousesViewProps) {
  const summaryQuery = useQuery<WhSummaryResponse>({
    queryKey: ["warehouses", "summary"],
    queryFn: () => apiGet<WhSummaryResponse>("/api/warehouses/summary"),
  });

  const kpis = summaryQuery.data;

  return (
    <div className="space-y-4">
      {/* العنوان */}
      <div>
        <h1 className="text-lg font-extrabold tracking-tight sm:text-xl">المخازن</h1>
        <p className="text-xs text-muted-foreground">
          الأصناف والمستودعات · أذون الإدخال والصرف والتحويل والجرد · الأرصدة الاشتقاقية وتكلفة المواد على العقود
        </p>
      </div>

      {/* المؤشرات */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summaryQuery.isLoading ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[76px] w-full" />)
        ) : (
          <>
            <KpiCard
              icon={Boxes}
              label="قيمة المخزون"
              value={fmtMoney(kpis?.stockValue ?? 0)}
              sub="بالمتوسط المرجح — كل المستودعات"
              tone="text-status-done"
            />
            <KpiCard icon={Package} label="أصناف نشطة" value={fmtNum(kpis?.activeItems ?? 0)} sub="قابلة للحركة" />
            <KpiCard icon={Warehouse} label="مستودعات نشطة" value={fmtNum(kpis?.activeWarehouses ?? 0)} sub="تقبل أذون جديدة" />
            <KpiCard
              icon={ClipboardList}
              label="أذون هذا الشهر"
              value={fmtNum(kpis?.docsThisMonth ?? 0)}
              sub={(kpis?.belowMin ?? 0) > 0 ? `${fmtNum(kpis?.belowMin ?? 0)} صنف تحت الحد الأدنى` : "لا أصناف تحت الحد الأدنى"}
              tone={(kpis?.belowMin ?? 0) > 0 ? "text-status-warn" : undefined}
            />
          </>
        )}
      </div>

      {/* شريط الأقسام انتقل للشل ModuleTabsBar (الهاتف فقط) — docs/mobile-tabs-design.md */}

      {/* محتوى القسم */}
      {section === "items" && <ItemsSection onAuthError={onAuthError} />}
      {section === "docs" && <DocsSection onAuthError={onAuthError} isAdmin={user?.role === "admin" || user?.role === "developer"} />}
      {section === "balances" && <BalancesSection onAuthError={onAuthError} />}
    </div>
  );
}

/** مرآة onErr الموحدة — تُستخدم في كل الأقسام والحوارات */
export function useWhErr(onAuthError: () => void) {
  const [msg, setMsg] = React.useState<{ title: string; description: string } | null>(null);
  // errMessage يوفر نص الخطأ — و401 يرفع باب المصادقة عبر onAuthError من المستدعي
  const describe = React.useCallback(
    (e: unknown): string => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      return errMessage(e);
    },
    [onAuthError]
  );
  return { describe, msg, setMsg };
}
