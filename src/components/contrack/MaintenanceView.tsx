"use client";

/**
 * MaintenanceView.tsx — شاشة موديول «الصيانة والتشغيل» (docs/maintenance-design.md §6):
 * ثلاثة أقسام يملكها تبويب الشل «الصيانة والتشغيل» (nav-structure → section):
 *   عقود الصيانة (بنوع موسوم — د2) · الجدول الوقائي (خطة تولّد أحداثها — د5) · أوامر العمل (MO — د3)
 * + بطاقات مؤشرات (ملخص /api/maintenance/summary) تظهر في كل الأقسام (د12).
 * الموديول تشغيلي صافٍ — صفر قيود: كل المال عبر محركات الفواتير والسندات والمخازن (§1).
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, FileSignature, NotebookPen, Wrench } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, apiGet } from "./api";
import { errMessage, type User } from "./contrack-types";
import { ContractsSection } from "./maintenance/ContractsSection";
import { ScheduleSection } from "./maintenance/ScheduleSection";
import { OrdersSection } from "./maintenance/OrdersSection";

// ==================== أنواع مشتركة ====================

export type MaintenanceSection = "contracts" | "schedule" | "orders";

export interface MaintenanceViewProps {
  user: User;
  onAuthError: () => void;
  section: MaintenanceSection;
  onSectionChange: (s: MaintenanceSection) => void;
  onOpenContract: (id: number) => void;
}

export interface MaintenanceKpis {
  openOrders: number;
  dueThisMonth: number;
  overdue: number;
  activeContracts: number;
  nextDue: string | null;
}

export interface MaintenanceContractRow {
  id: number;
  contractNumber: string;
  contractName: string;
  contractType: string;
  customerName: string;
  amount: number;
  status: string;
  startDate: string;
  endDate: string;
  plan: {
    id: number;
    name: string;
    intervalMonths: number;
    occurrencesCount: number;
    startDate: string;
    active: boolean;
  } | null;
  nextDue: string | null;
  openOrders: number;
  invoiced: number;
}

export interface ScheduleOccurrence {
  id: number;
  dueDate: string;
  skipped: boolean;
  note: string;
  status: string; // اشتقاقية — مجدولة/مفتوحة/منجزة/متخطاة
  workOrderId: number | null;
  workOrderNumber: string | null;
  workOrderStatus: string | null;
}

export interface SchedulePlanRow {
  id: number;
  contractId: number;
  contractNumber: string;
  contractName: string;
  customerName: string;
  name: string;
  intervalMonths: number;
  occurrencesCount: number;
  startDate: string;
  active: boolean;
  notes: string;
  occurrences: ScheduleOccurrence[];
}

export interface WorkOrderRow {
  id: number;
  docNumber: string;
  title: string;
  description: string;
  contractId: number;
  contractNumber: string;
  contractName: string;
  customerName: string;
  occurrenceId: number | null;
  occurrenceDue: string | null;
  technicianId: number | null;
  technicianName: string | null;
  scheduledDate: string;
  status: string;
  completedAt: string;
  completedNote: string;
  cancelReason: string;
  invoiceId: number | null;
  invoiceNumber: string | null;
  invoiceTotal: number | null;
  materialsDocId: number | null;
  materialsDocNumber: string | null;
  materialsTotal: number | null;
  notes: string;
  createdAt: string;
}

// ==================== مساعدات عرض مشتركة ====================

/** تنسيق الأرقام بالفواصل وثلاث منزلات — أرقام لاتينية للاتساق مع بقية الشاشات */
const numFmt = new Intl.NumberFormat("ar-KW-u-nu-latn", { maximumFractionDigits: 3 });
export function fmtNum(n: number): string {
  return numFmt.format(Number.isFinite(n) ? n : 0);
}
export function fmtMoney(n: number): string {
  return `${fmtNum(n)} د.ك`;
}

/** ألوان حالات أمر العمل (د4) وحالات الحدث الاشتقاقية (د6) */
export function statusTone(status: string): string {
  switch (status) {
    case "مفتوحة":
      return "bg-status-info-bg text-status-info";
    case "جارية":
      return "bg-status-warn-bg text-status-warn";
    case "منجزة":
      return "bg-status-done-bg text-status-done";
    case "ملغاة":
    case "متخطاة":
      return "bg-muted text-muted-foreground";
    case "مجدولة":
      return "bg-secondary text-secondary-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

// ==================== الشاشة الرئيسية ====================

const SECTION_META: { key: MaintenanceSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "contracts", label: "عقود الصيانة", icon: FileSignature },
  { key: "schedule", label: "الجدول الوقائي", icon: CalendarClock },
  { key: "orders", label: "أوامر العمل", icon: NotebookPen },
];

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

export function MaintenanceView({ user, onAuthError, section, onSectionChange, onOpenContract }: MaintenanceViewProps) {
  const kpisQuery = useQuery<MaintenanceKpis>({
    queryKey: ["maintenance", "summary"],
    queryFn: () => apiGet<MaintenanceKpis>("/api/maintenance/summary"),
  });

  const kpis = kpisQuery.data;
  const isAdmin = user?.role === "admin" || user?.role === "developer";

  return (
    <div className="space-y-4">
      {/* العنوان */}
      <div>
        <h1 className="text-lg font-extrabold tracking-tight sm:text-xl">الصيانة والتشغيل</h1>
        <p className="text-xs text-muted-foreground">
          عقود الصيانة الدورية · الجدول الوقائي المولّد · أوامر العمل بموادّها عبر المخازن وفوترتها بمحرك الفواتير
        </p>
      </div>

      {/* المؤشرات (د12 — من القوائم اشتقاقيًا) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpisQuery.isLoading ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[76px] w-full" />)
        ) : (
          <>
            <KpiCard icon={NotebookPen} label="أوامر مفتوحة" value={fmtNum(kpis?.openOrders ?? 0)} sub="مفتوحة + جارية" />
            <KpiCard icon={CalendarClock} label="مجدولة هذا الشهر" value={fmtNum(kpis?.dueThisMonth ?? 0)} sub={kpis?.nextDue ? `القادم: ${kpis.nextDue}` : "لا أحداث قادمة"} />
            <KpiCard
              icon={Wrench}
              label="متأخرة"
              value={fmtNum(kpis?.overdue ?? 0)}
              sub="أحداث تجاوزت موعدها"
              tone={(kpis?.overdue ?? 0) > 0 ? "text-status-warn" : undefined}
            />
            <KpiCard icon={FileSignature} label="عقود صيانة نشطة" value={fmtNum(kpis?.activeContracts ?? 0)} sub="أنواع موسومة صيانة" />
          </>
        )}
      </div>

      {/* تبويبات الأقسام (مرآة الشل للتنقل السريع داخل الشاشة) */}
      <Tabs value={section} onValueChange={(v) => onSectionChange(v as MaintenanceSection)}>
        <TabsList className="h-9 w-full justify-start overflow-x-auto sm:w-auto">
          {SECTION_META.map((s) => (
            <TabsTrigger key={s.key} value={s.key} className="gap-1.5">
              <s.icon className="size-3.5" />
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* محتوى القسم */}
      {section === "contracts" && <ContractsSection onAuthError={onAuthError} onOpenContract={onOpenContract} />}
      {section === "schedule" && <ScheduleSection onAuthError={onAuthError} />}
      {section === "orders" && <OrdersSection onAuthError={onAuthError} isAdmin={isAdmin} />}
    </div>
  );
}

/** مرآة onErr الموحدة — تُستخدم في كل الأقسام والحوارات */
export function useMaintenanceErr(onAuthError: () => void) {
  const [msg, setMsg] = React.useState<{ title: string; description: string } | null>(null);
  const describe = React.useCallback(
    (e: unknown): string => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      return errMessage(e);
    },
    [onAuthError]
  );
  return { describe, msg, setMsg };
}
