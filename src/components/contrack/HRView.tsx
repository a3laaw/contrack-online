"use client";

/**
 * HRView.tsx — شاشة موديول «الموارد البشرية» (HR-1):
 * خمسة أقسام يملكها تبويب الشل «الموارد البشرية» (nav-structure → section):
 *   الموظفون · الحضور · الإجازات · مسير الرواتب · سلف الموظفين
 * + بطاقات مؤشرات (ملخص /api/hr-summary) تظهر في كل الأقسام.
 * الموديول يظهر حصرًا للشركات التي فعّلته (navModules) — والإيقاف يرجع 403 برسالة عربية.
 * الأرصدة السنوية تأتي جاهزة من الخادم (balances) — لا تُعاد حسابيًا في العميل.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Banknote,
  CalendarCheck2,
  CalendarDays,
  Check,
  ChevronLeft,
  HandCoins,
  Loader2,
  Phone,
  Play,
  Plus,
  Power,
  PowerOff,
  Pencil,
  Search,
  Trash2,
  Undo2,
  Users,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "./api";
import { errMessage, type User } from "./contrack-types";
import { cn } from "@/lib/utils";
import { SearchableSelect } from "./SearchableSelect";
import {
  ATTENDANCE_STATUSES,
  attendanceLabel,
  EMPLOYEE_TYPES,
  HR_LEAVE_STATUSES,
  HR_LEAVE_TYPES,
  leaveDaysBetween,
  monthLabelAr,
  PAYMENT_BASES,
  PAYROLL_BATCH_LABELS,
  SICK_LEAVE_TIERS,
} from "@/lib/hr-constants";

// ==================== أنواع الـAPI ====================

interface HrSummaryResponse {
  activeEmployees: number;
  onLeaveNow: number;
  pendingLeaves: number;
  monthBatch: { id: number; month: string; monthLabel: string; status: string; netTotal: number; batchNo: number } | null;
  today: string;
  month: string;
}

interface HREmployee {
  id: number;
  name: string;
  phone: string;
  notes: string;
  active: boolean;
  jobNumber: string;
  employeeType: string;
  employeeTypeLabel: string;
  department: string;
  jobTitle: string;
  civilId: string;
  nationality: string;
  hireDate: string;
  salary: number;
  paymentBasis: string;
  paymentBasisLabel: string;
  dailyRate: number;
  paymentMethodId: number | null;
  paymentMethodName: string;
  advanceBalance: number;
  attendancesCount: number;
  leavesCount: number;
  payrollRecordsCount: number;
}

interface AttendanceRecord {
  id: number;
  employeeId: number;
  employeeName: string;
  jobTitle: string;
  workDate: string;
  month: string;
  status: string;
  statusLabel: string;
  checkIn: string;
  checkOut: string;
  note: string;
}

interface HRLeave {
  id: number;
  employeeId: number;
  employeeName: string;
  jobTitle: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  sickTier: number | null;
  decisionBy: string;
  decisionAt: string;
  decisionNote: string;
  month: string;
}

interface LeaveBalanceEntry {
  allowance: number;
  consumed: number;
  balance: number;
  probation: boolean;
}

interface PayrollBatchItem {
  id: number;
  batchNo: number;
  month: string;
  monthLabel: string;
  status: string;
  grossTotal: number;
  deductionTotal: number;
  advanceTotal: number;
  netTotal: number;
  recordsCount: number;
  journalEntryId: number | null;
  paymentVoucherId: number | null;
  generatedBy: string | null;
  approvedBy: string | null;
  cancelReason: string | null;
}

interface PayrollRecordItem {
  id: number;
  employeeId: number;
  snapName: string;
  snapJobTitle: string;
  snapBasisLabel: string;
  presentDays: number;
  absenceDays: number;
  baseAmount: number;
  absenceDeduction: number;
  advanceDeduction: number;
  netAmount: number;
  deductionVoucherId: number | null;
}

interface PayrollBatchDetail extends PayrollBatchItem {
  statusLabel: string;
  paidAt: string | null;
  cancelledAt: string | null;
  records: PayrollRecordItem[];
}

interface AdvanceEmployeeItem {
  id: number;
  name: string;
  phone: string;
  notes: string;
  active: boolean;
  advanced: number;
  recovered: number;
  deducted: number;
  balance: number;
  movements: number;
}

interface AdvanceEmployeesResponse {
  employees: AdvanceEmployeeItem[];
  totals: { advanced: number; recovered: number; deducted: number; balance: number };
}

interface AdvanceVoucherItem {
  id: number;
  voucherNumber: string;
  vtype: string;
  vtypeLabel: string;
  kind: string;
  kindLabel: string;
  vdate: string;
  amount: number;
  employeeId: number | null;
  employeeName: string;
  description: string;
  cancelled: boolean;
  cancelReason: string;
  cancelledAt: string | null;
}

interface PaymentMethodItem {
  id: number;
  name: string;
  isActive: boolean;
}

export type HRSection = "team" | "attendance" | "leaves" | "payroll" | "advances";

interface HRViewProps {
  user: User;
  onAuthError: () => void;
  section: HRSection;
  onSectionChange: (s: HRSection) => void;
}

// ==================== أدوات مساعدة ====================

function normSearch(s: string): string {
  return s.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
}

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function thisMonth(): string {
  return todayStr().slice(0, 7);
}

/** تنسيق الأرقام بالفواصل وثلاث منزلات — أرقام لاتينية للاتساق مع بقية الشاشات */
const numFmt = new Intl.NumberFormat("ar-KW-u-nu-latn", { maximumFractionDigits: 3 });
function fmtNum(n: number): string {
  return numFmt.format(Number.isFinite(n) ? n : 0);
}
function fmtMoney(n: number): string {
  return `${fmtNum(n)} د.ك`;
}

const ATT_TONE: Record<string, { text: string; bg: string }> = {
  present: { text: "text-status-done", bg: "bg-status-done-bg" },
  absent: { text: "text-status-danger", bg: "bg-status-danger-bg" },
  justified_absent: { text: "text-status-warn", bg: "bg-status-warn-bg" },
  leave: { text: "text-status-info", bg: "bg-status-info-bg" },
  holiday: { text: "text-muted-foreground", bg: "bg-muted" },
};

const LEAVE_STATUS_TONE: Record<string, { text: string; bg: string }> = {
  "معلقة": { text: "text-status-warn", bg: "bg-status-warn-bg" },
  "معتمدة": { text: "text-status-info", bg: "bg-status-info-bg" },
  "بدأت": { text: "text-status-done", bg: "bg-status-done-bg" },
  "منتهية": { text: "text-muted-foreground", bg: "bg-muted" },
  "مرفوضة": { text: "text-status-danger", bg: "bg-status-danger-bg" },
};

const BATCH_TONE: Record<string, { text: string; bg: string }> = {
  draft: { text: "text-status-warn", bg: "bg-status-warn-bg" },
  approved: { text: "text-status-info", bg: "bg-status-info-bg" },
  paid: { text: "text-status-done", bg: "bg-status-done-bg" },
  cancelled: { text: "text-muted-foreground", bg: "bg-muted" },
};

const KIND_TONE: Record<string, { text: string; bg: string }> = {
  grant: { text: "text-status-info", bg: "bg-status-info-bg" },
  return: { text: "text-status-done", bg: "bg-status-done-bg" },
  deduction: { text: "text-status-warn", bg: "bg-status-warn-bg" },
};

function StatusPill({ label, tone }: { label: string; tone: { text: string; bg: string } }) {
  return <Badge className={cn("h-5 px-1.5 text-[10px]", tone.bg, tone.text)}>{label}</Badge>;
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

function EmptyState({ icon: Icon, title, hint }: { icon: React.ComponentType<{ className?: string }>; title: string; hint: string }) {
  return (
    <Card className="p-10 text-center">
      <Icon className="mx-auto size-8 text-muted-foreground/50" />
      <p className="mt-2 text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </Card>
  );
}

function SkeletonRows({ h, n = 3 }: { h: string; n?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className={cn("w-full", h)} />
      ))}
    </div>
  );
}

/** رأس جدول سطح المكتب الجدولي */
function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-3 py-2 text-start text-[11px] font-semibold text-muted-foreground">{children}</th>;
}

const SECTION_META: { key: HRSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "team", label: "الموظفون", icon: Users },
  { key: "attendance", label: "الحضور", icon: CalendarCheck2 },
  { key: "leaves", label: "الإجازات", icon: CalendarDays },
  { key: "payroll", label: "المسير", icon: Banknote },
  { key: "advances", label: "السلف", icon: HandCoins },
];

// ==================== الشاشة الرئيسية ====================

export function HRView({ onAuthError, section, onSectionChange }: HRViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["hr"] });
  }, [qc]);

  const onErr = React.useCallback(
    (e: unknown, title: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title, description: errMessage(e) });
    },
    [onAuthError, toast]
  );

  // ===== البيانات المشتركة =====
  const summaryQuery = useQuery<HrSummaryResponse>({
    queryKey: ["hr", "summary"],
    queryFn: () => apiGet<HrSummaryResponse>("/api/hr/summary"),
  });
  const teamQuery = useQuery<{ employees: HREmployee[] }>({
    queryKey: ["hr", "team"],
    queryFn: () => apiGet<{ employees: HREmployee[] }>("/api/hr/team"),
  });
  const employees: HREmployee[] = teamQuery.data?.employees ?? [];

  const employeeOpts = React.useMemo(
    () => employees.map((e) => ({ value: String(e.id), label: e.jobTitle ? `${e.name} — ${e.jobTitle}` : e.name })),
    [employees]
  );
  const employeeOptsActive = React.useMemo(
    () =>
      employees
        .filter((e) => e.active)
        .map((e) => ({ value: String(e.id), label: e.jobTitle ? `${e.name} — ${e.jobTitle}` : e.name })),
    [employees]
  );
  const employeesReady = employees.some((e) => e.active);

  // ===== نافذة التأكيد الموحدة للحذف =====
  const [deleteTarget, setDeleteTarget] = React.useState<{ kind: string; id: number; label: string } | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (v: { kind: string; id: number }) =>
      apiDelete(`/api/hr/${v.kind}/${v.id}?reason=${encodeURIComponent("حذف من شاشة الموارد البشرية")}`),
    onSuccess: (_res, v) => {
      setDeleteTarget(null);
      invalidate();
      // فريق HR هو جدول الموظفين نفسه — مزامنة شاشات العهد/السلف
      if (v.kind === "team") {
        qc.invalidateQueries({ queryKey: ["employees"] });
        qc.invalidateQueries({ queryKey: ["employees-advances"] });
      }
      toast({ title: "تم الحذف بنجاح", description: LABELS_DELETE[v.kind] || "" });
    },
    onError: (e) => onErr(e, "تعذر الحذف"),
  });

  const kpis = summaryQuery.data;
  const batch = summaryQuery.data?.monthBatch ?? null;

  return (
    <div className="space-y-4">
      {/* العنوان والإضافة حسب القسم */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold tracking-tight sm:text-xl">الموارد البشرية</h1>
          <p className="text-xs text-muted-foreground">
            الموظفون وأسس أجورهم · الحضور اليومي · الإجازات بأرصدتها القانونية · مسير الرواتب · سلف الموظفين
          </p>
        </div>
        <SectionAction
          section={section}
          employeesReady={employeesReady}
          onNoEmployees={() => {
            toast({ title: "أضف موظفًا نشطًا أولًا", description: "هذا القسم يحتاج موظفين مسجلين" });
            onSectionChange("team");
          }}
        />
      </div>

      {/* المؤشرات */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summaryQuery.isLoading ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[76px] w-full" />)
        ) : (
          <>
            <KpiCard
              icon={Users}
              label="الموظفون النشطون"
              value={fmtNum(kpis?.activeEmployees ?? 0)}
              sub="قوة العمل الحالية"
              tone="text-status-done"
            />
            <KpiCard
              icon={CalendarCheck2}
              label="في إجازة اليوم"
              value={fmtNum(kpis?.onLeaveNow ?? 0)}
              sub="إجازات سارية اليوم"
              tone={(kpis?.onLeaveNow ?? 0) > 0 ? "text-status-info" : undefined}
            />
            <KpiCard
              icon={CalendarDays}
              label="إجازات معلقة"
              value={fmtNum(kpis?.pendingLeaves ?? 0)}
              sub={(kpis?.pendingLeaves ?? 0) > 0 ? "بانتظار القرار" : "بلا طلبات معلقة"}
              tone={(kpis?.pendingLeaves ?? 0) > 0 ? "text-status-warn" : undefined}
            />
            <KpiCard
              icon={Banknote}
              label="مسير الشهر الحالي"
              value={batch ? fmtMoney(batch.netTotal) : "—"}
              sub={
                batch
                  ? `PR-${batch.batchNo} · ${batch.monthLabel} · ${PAYROLL_BATCH_LABELS[batch.status] ?? batch.status}`
                  : "لم يُولَّد مسير لهذا الشهر"
              }
              tone={batch ? (BATCH_TONE[batch.status]?.text ?? undefined) : undefined}
            />
          </>
        )}
      </div>

      {/* تبويبات الأقسام (مرآة الشل للتنقل السريع داخل الشاشة) */}
      <Tabs value={section} onValueChange={(v) => onSectionChange(v as HRSection)}>
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
      {section === "team" && (
        <TeamSection
          teamQuery={teamQuery}
          onErr={onErr}
          invalidate={invalidate}
          setDeleteTarget={setDeleteTarget}
        />
      )}
      {section === "attendance" && (
        <AttendanceSection
          employeeOpts={employeeOpts}
          employeeOptsActive={employeeOptsActive}
          onErr={onErr}
          invalidate={invalidate}
          setDeleteTarget={setDeleteTarget}
        />
      )}
      {section === "leaves" && (
        <LeavesSection
          employeeOpts={employeeOpts}
          employeeOptsActive={employeeOptsActive}
          onErr={onErr}
          invalidate={invalidate}
          setDeleteTarget={setDeleteTarget}
        />
      )}
      {section === "payroll" && <PayrollSection onErr={onErr} invalidate={invalidate} setDeleteTarget={setDeleteTarget} />}
      {section === "advances" && <AdvancesSection onErr={onErr} invalidate={invalidate} />}

      {/* تأكيد الحذف الموحد */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-destructive">تأكيد الحذف</DialogTitle>
            <DialogDescription>
              سيُحذف «{deleteTarget?.label}» نهائيًا
              {deleteTarget?.kind === "team"
                ? " — إن كان للموظف تاريخ مالي (مسير أو سلف) سيرفض النظام الحذف وعليك إيقافه بدلًا منه"
                : deleteTarget?.kind === "payroll"
                  ? " — يُحذف المسير المسودة فقط، والاعتماد يوثق ولا يُحذف"
                  : ""}
              .
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteMutation.isPending}>
              تراجع
            </Button>
            <Button
              className="border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate({ kind: deleteTarget.kind, id: deleteTarget.id })}
            >
              {deleteMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              حذف نهائي
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const LABELS_DELETE: Record<string, string> = {
  team: "حُذف الموظف",
  attendance: "حُذف سجل الحضور",
  leaves: "حُذف طلب الإجازة",
  payroll: "حُذف مسير المسودة",
};

/** زر الإضافة أعلى الشاشة — يفتح نافذة القسم المعني عبر حدث مخصص بسيط */
function SectionAction({
  section,
  employeesReady,
  onNoEmployees,
}: {
  section: HRSection;
  employeesReady: boolean;
  onNoEmployees: () => void;
}) {
  const labels: Record<HRSection, string> = {
    team: "موظف جديد",
    attendance: "تسجيل حضور",
    leaves: "طلب إجازة",
    payroll: "توليد مسير",
    advances: "صرف سلفة",
  };
  return (
    <Button
      onClick={() => {
        if ((section === "attendance" || section === "leaves" || section === "advances") && !employeesReady) {
          onNoEmployees();
          return;
        }
        window.dispatchEvent(new CustomEvent("hr-add", { detail: section }));
      }}
      className="gap-1.5"
    >
      <Plus className="size-4" />
      {labels[section]}
    </Button>
  );
}

/** يفتح نافذة القسم عند إطلاق حدث «hr-add» — حالة كل قسم ذاتية */
function useAddEvent(section: HRSection, onOpen: () => void) {
  React.useEffect(() => {
    const h = (e: Event) => {
      if ((e as CustomEvent).detail === section) onOpen();
    };
    window.addEventListener("hr-add", h);
    return () => window.removeEventListener("hr-add", h);
  }, [section, onOpen]);
}

interface SectionCommon {
  onErr: (e: unknown, title: string) => void;
  invalidate: () => void;
  setDeleteTarget: (v: { kind: string; id: number; label: string } | null) => void;
}

// ==================== قسم الموظفون ====================

function TeamSection({ teamQuery, onErr, invalidate, setDeleteTarget }: SectionCommon & { teamQuery: { data?: { employees: HREmployee[] }; isLoading: boolean; isError: boolean; error: unknown } }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const employees = teamQuery.data?.employees ?? [];

  const [tab, setTab] = React.useState<string>("الكل");
  const [q, setQ] = React.useState("");

  const filtered = React.useMemo(() => {
    const needle = normSearch(q.trim());
    return employees.filter((e) => {
      if (tab === "نشط" && !e.active) return false;
      if (tab === "موقوف" && e.active) return false;
      if (needle && !normSearch(`${e.name} ${e.jobTitle} ${e.department} ${e.phone} ${e.civilId} ${e.jobNumber}`).includes(needle)) return false;
      return true;
    });
  }, [employees, tab, q]);

  // ===== إيقاف/تفعيل =====
  const toggleMutation = useMutation({
    mutationFn: (v: { id: number; active: boolean }) => apiPatch(`/api/hr/team/${v.id}`, { active: v.active }),
    onSuccess: (_r, v) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employees-advances"] });
      toast({ title: v.active ? "فُعّل الموظف" : "أُوقف الموظف", description: v.active ? "عاد لقوة العمل والمساير" : "لن يدخل في المساير القادمة حتى تفعيله" });
    },
    onError: (e) => onErr(e, "تعذر تغيير حالة الموظف"),
  });

  // ===== الإضافة/التعديل =====
  const [editor, setEditor] = React.useState<{ editing: HREmployee | null } | null>(null);
  useAddEvent("team", React.useCallback(() => setEditor({ editing: null }), [setEditor]));

  const saveMutation = useMutation({
    mutationFn: (v: { id?: number; data: Record<string, unknown> }) =>
      v.id ? apiPatch(`/api/hr/team/${v.id}`, v.data) : apiPost<{ employee: { id: number } }>("/api/hr/team", v.data),
    onSuccess: (_r, v) => {
      setEditor(null);
      invalidate();
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employees-advances"] });
      toast({ title: v.id ? "حُدّثت بيانات الموظف" : "أُضيف الموظف للفريق", description: v.id ? undefined : "أُسند له رقم وظيفي آلي" });
    },
    onError: (e) => onErr(e, "تعذر الحفظ"),
  });

  const activeCount = employees.filter((e) => e.active).length;

  return (
    <div className="space-y-3">
      {/* الفلاتر */}
      <Card className="gap-3 p-3 sm:p-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-9 w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="الكل">الكل ({employees.length})</TabsTrigger>
            <TabsTrigger value="نشط">نشط ({activeCount})</TabsTrigger>
            <TabsTrigger value="موقوف">موقوف ({employees.length - activeCount})</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالاسم/المسمى/القسم/الهاتف/الرقم المدني/الرقم الوظيفي…" className="ps-8" />
        </div>
      </Card>

      {/* القائمة */}
      {teamQuery.isLoading ? (
        <SkeletonRows h="h-16" />
      ) : teamQuery.isError ? (
        <Card className="p-8 text-center text-sm text-destructive">تعذر تحميل الفريق — {errMessage(teamQuery.error)}</Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title={employees.length === 0 ? "لا يوجد موظفون بعد" : "لا نتائج مطابقة للفلاتر"}
          hint={employees.length === 0 ? "ابدأ بإضافة أول موظف بزر «موظف جديد» — يُسند له رقم وظيفي آلي" : "جرّب تعديل البحث أو تبويب الحالة"}
        />
      ) : (
        <>
          {/* جدول سطح المكتب */}
          <div className="hidden overflow-hidden rounded-xl border md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <Th>الوظيفي</Th>
                  <Th>الموظف</Th>
                  <Th>النوع</Th>
                  <Th>الأجر</Th>
                  <Th>التعيين</Th>
                  <Th>رصيد السلف</Th>
                  <Th>الحالة</Th>
                  <Th>إجراءات</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} className={cn("border-t", !e.active && "opacity-60")}>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{e.jobNumber}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-bold">{e.name}</div>
                      {e.jobTitle && <div className="text-[11px] text-muted-foreground">{e.jobTitle}{e.department ? ` · ${e.department}` : ""}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{e.employeeTypeLabel}</Badge>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {e.paymentBasis === "daily" ? `${fmtMoney(e.dailyRate)} / يوم` : fmtMoney(e.salary)}
                      <div className="text-[10px] text-muted-foreground">{e.paymentBasisLabel}</div>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{e.hireDate || "—"}</td>
                    <td className={cn("px-3 py-2.5 tabular-nums", e.advanceBalance > 0 ? "font-bold text-status-danger" : "text-muted-foreground")}>
                      {fmtMoney(e.advanceBalance)}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill label={e.active ? "نشط" : "موقوف"} tone={e.active ? { text: "text-status-done", bg: "bg-status-done-bg" } : { text: "text-status-danger", bg: "bg-status-danger-bg" }} />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-0.5">
                        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" title="تعديل" onClick={() => setEditor({ editing: e })}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-foreground"
                          title={e.active ? "إيقاف" : "تفعيل"}
                          disabled={toggleMutation.isPending}
                          onClick={() => toggleMutation.mutate({ id: e.id, active: !e.active })}
                        >
                          {e.active ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                          title="حذف"
                          onClick={() => setDeleteTarget({ kind: "team", id: e.id, label: e.name })}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* بطاقات الجوال */}
          <div className="space-y-2 md:hidden">
            {filtered.map((e) => (
              <Card key={e.id} className={cn("p-3", !e.active && "opacity-70")}>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-primary-soft-foreground">
                    {e.name.trim().charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold">{e.name}</span>
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums">#{e.jobNumber}</Badge>
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{e.employeeTypeLabel}</Badge>
                      <StatusPill label={e.active ? "نشط" : "موقوف"} tone={e.active ? { text: "text-status-done", bg: "bg-status-done-bg" } : { text: "text-status-danger", bg: "bg-status-danger-bg" }} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      {e.jobTitle && <span>{e.jobTitle}{e.department ? ` · ${e.department}` : ""}</span>}
                      {e.phone && (
                        <span className="inline-flex items-center gap-1" dir="ltr">
                          <Phone className="size-3" />
                          {e.phone}
                        </span>
                      )}
                      <span className="tabular-nums">تعيين: {e.hireDate || "—"}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums">
                        {e.paymentBasis === "daily" ? `${fmtMoney(e.dailyRate)} / يوم` : fmtMoney(e.salary)}
                      </Badge>
                      {e.advanceBalance > 0 && (
                        <Badge className="h-5 bg-status-danger-bg px-1.5 text-[10px] tabular-nums text-status-danger">
                          سلفة معلقة: {fmtMoney(e.advanceBalance)}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" title="تعديل" onClick={() => setEditor({ editing: e })}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-foreground"
                      title={e.active ? "إيقاف" : "تفعيل"}
                      disabled={toggleMutation.isPending}
                      onClick={() => toggleMutation.mutate({ id: e.id, active: !e.active })}
                    >
                      {e.active ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      title="حذف"
                      onClick={() => setDeleteTarget({ kind: "team", id: e.id, label: e.name })}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <EmployeeDialog
        open={!!editor}
        editing={editor?.editing ?? null}
        pending={saveMutation.isPending}
        onClose={() => setEditor(null)}
        onSave={(data) => saveMutation.mutate({ id: editor?.editing?.id, data })}
      />
    </div>
  );
}

// ==================== نافذة الموظف (إضافة/تعديل) ====================

function EmployeeDialog({
  open,
  editing,
  pending,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: HREmployee | null;
  pending: boolean;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
}) {
  const [form, setForm] = React.useState({
    name: "",
    phone: "",
    department: "",
    jobTitle: "",
    nationality: "",
    civilId: "",
    hireDate: "",
    employeeType: "internal",
    paymentBasis: "monthly",
    salary: "",
    dailyRate: "",
    paymentMethodId: "",
    notes: "",
  });

  // وسائل الدفع — للربط برصيد السلف وسندات الصرف (القائمة لكل المستخدمين)
  const methodsQuery = useQuery<{ methods: PaymentMethodItem[] }>({
    queryKey: ["payment-methods"],
    queryFn: () => apiGet<{ methods: PaymentMethodItem[] }>("/api/payment-methods"),
    enabled: open,
  });
  const methodOpts = React.useMemo(
    () => (methodsQuery.data?.methods ?? []).filter((m) => m.isActive).map((m) => ({ value: String(m.id), label: m.name })),
    [methodsQuery.data]
  );

  React.useEffect(() => {
    if (open) {
      setForm({
        name: editing?.name ?? "",
        phone: editing?.phone ?? "",
        department: editing?.department ?? "",
        jobTitle: editing?.jobTitle ?? "",
        nationality: editing?.nationality ?? "",
        civilId: editing?.civilId ?? "",
        hireDate: editing?.hireDate ?? "",
        employeeType: editing?.employeeType ?? "internal",
        paymentBasis: editing?.paymentBasis ?? "monthly",
        salary: editing?.salary ? String(editing.salary) : "",
        dailyRate: editing?.dailyRate ? String(editing.dailyRate) : "",
        paymentMethodId: editing?.paymentMethodId ? String(editing.paymentMethodId) : "",
        notes: editing?.notes ?? "",
      });
    }
  }, [open, editing]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const civilOk = !form.civilId.trim() || /^\d{10}$/.test(form.civilId.trim());
  const isMonthly = form.paymentBasis === "monthly";

  const submit = () => {
    onSave({
      name: form.name,
      phone: form.phone,
      department: form.department,
      jobTitle: form.jobTitle,
      nationality: form.nationality,
      civilId: form.civilId.trim(),
      hireDate: form.hireDate,
      employeeType: form.employeeType,
      paymentBasis: form.paymentBasis,
      salary: isMonthly ? Number(form.salary) || 0 : 0,
      dailyRate: isMonthly ? 0 : Number(form.dailyRate) || 0,
      paymentMethodId: form.paymentMethodId ? Number(form.paymentMethodId) : null,
      notes: form.notes,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "تعديل موظف" : "موظف جديد"}</DialogTitle>
          <DialogDescription>الاسم إلزامي — الرقم الوظيفي يُسند آليًا والبقية تُكمل لاحقًا من نفس النافذة</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>الاسم *</Label>
            <Input value={form.name} onChange={set("name")} placeholder="الاسم الكامل" />
          </div>
          <div className="space-y-1.5">
            <Label>المسمى الوظيفي</Label>
            <Input value={form.jobTitle} onChange={set("jobTitle")} placeholder="محاسب / سكرتير / مساح…" />
          </div>
          <div className="space-y-1.5">
            <Label>القسم</Label>
            <Input value={form.department} onChange={set("department")} placeholder="الإدارة / الحسابات…" />
          </div>
          <div className="space-y-1.5">
            <Label>الرقم المدني</Label>
            <Input value={form.civilId} onChange={set("civilId")} placeholder="10 أرقام" dir="ltr" inputMode="numeric" />
            {!civilOk && <p className="text-[11px] text-status-danger">الرقم المدني يجب أن يكون 10 أرقام</p>}
          </div>
          <div className="space-y-1.5">
            <Label>الجنسية</Label>
            <Input value={form.nationality} onChange={set("nationality")} placeholder="كويتي / مصري / هندي…" />
          </div>
          <div className="space-y-1.5">
            <Label>الهاتف</Label>
            <Input value={form.phone} onChange={set("phone")} dir="ltr" inputMode="tel" />
          </div>
          <div className="space-y-1.5">
            <Label>تاريخ التعيين</Label>
            <Input type="date" value={form.hireDate} onChange={set("hireDate")} />
          </div>
          <div className="space-y-1.5">
            <Label>نوع الموظف *</Label>
            <SearchableSelect
              value={form.employeeType}
              onValueChange={(v) => setForm((f) => ({ ...f, employeeType: v || "internal" }))}
              options={EMPLOYEE_TYPES.map((t) => ({ value: t.value, label: t.label }))}
              placeholder="اختر النوع"
            />
          </div>
          <div className="space-y-1.5">
            <Label>أساس الأجر *</Label>
            <SearchableSelect
              value={form.paymentBasis}
              onValueChange={(v) => setForm((f) => ({ ...f, paymentBasis: v || "monthly" }))}
              options={PAYMENT_BASES.map((t) => ({ value: t.value, label: t.label }))}
              placeholder="اختر الأساس"
            />
          </div>
          {isMonthly ? (
            <div className="space-y-1.5">
              <Label>الراتب الشهري</Label>
              <Input type="number" min="0" step="0.001" value={form.salary} onChange={set("salary")} dir="ltr" placeholder="0.000" />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>الأجر اليومي</Label>
              <Input type="number" min="0" step="0.001" value={form.dailyRate} onChange={set("dailyRate")} dir="ltr" placeholder="0.000" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>وسيلة الدفع</Label>
            <SearchableSelect
              value={form.paymentMethodId}
              onValueChange={(v) => setForm((f) => ({ ...f, paymentMethodId: v }))}
              options={methodOpts}
              placeholder="بدون وسيلة محددة"
              allowClear
              clearLabel="إزالة الوسيلة"
              loading={methodsQuery.isLoading}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>ملاحظات</Label>
            <Input value={form.notes} onChange={set("notes")} placeholder="اختياري" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            إلغاء
          </Button>
          <Button onClick={submit} disabled={pending || !form.name.trim() || !civilOk}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {editing ? "حفظ التعديلات" : "إضافة الموظف"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== قسم الحضور ====================

function AttendanceSection({
  employeeOpts,
  employeeOptsActive,
  onErr,
  invalidate,
  setDeleteTarget,
}: SectionCommon & { employeeOpts: { value: string; label: string }[]; employeeOptsActive: { value: string; label: string }[] }) {
  const { toast } = useToast();

  const [month, setMonth] = React.useState(thisMonth());
  const [employeeFilter, setEmployeeFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("");

  const listQuery = useQuery<{ records: AttendanceRecord[] }>({
    queryKey: ["hr", "attendance", month, employeeFilter, statusFilter],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (month) sp.set("month", month);
      if (employeeFilter) sp.set("employeeId", employeeFilter);
      if (statusFilter) sp.set("status", statusFilter);
      const qs = sp.toString();
      return apiGet<{ records: AttendanceRecord[] }>(`/api/hr/attendance${qs ? `?${qs}` : ""}`);
    },
  });
  const records = listQuery.data?.records ?? [];

  const [editor, setEditor] = React.useState<{ editing: AttendanceRecord | null } | null>(null);
  useAddEvent("attendance", React.useCallback(() => setEditor({ editing: null }), [setEditor]));

  const saveMutation = useMutation({
    mutationFn: async (v: { id?: number; data: Record<string, unknown> }): Promise<{ updated: boolean }> => {
      if (v.id) {
        await apiPatch(`/api/hr/attendance/${v.id}`, v.data);
        return { updated: true };
      }
      await apiPost("/api/hr/attendance", v.data);
      return { updated: true };
    },
    onSuccess: (_r, v) => {
      setEditor(null);
      invalidate();
      toast({ title: v.id ? "حُدّث سجل الحضور" : "سُجل الحضور" });
    },
    onError: (e) => onErr(e, "تعذر الحفظ"),
  });

  const presentCount = records.filter((r) => r.status === "present").length;
  const absentCount = records.filter((r) => r.status === "absent").length;

  return (
    <div className="space-y-3">
      {/* الفلاتر */}
      <Card className="gap-3 p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr_1fr]">
          <div className="flex items-center gap-1.5">
            <Label className="shrink-0 text-xs text-muted-foreground">الشهر</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-[160px]" />
          </div>
          <SearchableSelect
            value={employeeFilter}
            onValueChange={setEmployeeFilter}
            options={employeeOpts}
            placeholder="كل الموظفين"
            allowClear
            clearLabel="إظهار الكل"
          />
          <SearchableSelect
            value={statusFilter}
            onValueChange={setStatusFilter}
            options={ATTENDANCE_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
            placeholder="كل الحالات"
            allowClear
            clearLabel="إظهار الكل"
          />
        </div>
        {records.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
            <Badge className="h-6 gap-1 bg-status-done-bg px-2 text-[11px] text-status-done">
              حاضر: <span className="font-bold tabular-nums">{presentCount}</span>
            </Badge>
            <Badge className="h-6 gap-1 bg-status-danger-bg px-2 text-[11px] text-status-danger">
              غياب غير مبرر: <span className="font-bold tabular-nums">{absentCount}</span>
            </Badge>
            <Badge variant="outline" className="h-6 px-2 text-[11px] tabular-nums">
              إجمالي السجلات: {records.length}
            </Badge>
          </div>
        )}
      </Card>

      {/* القائمة */}
      {listQuery.isLoading ? (
        <SkeletonRows h="h-14" />
      ) : listQuery.isError ? (
        <Card className="p-8 text-center text-sm text-destructive">تعذر تحميل الحضور — {errMessage(listQuery.error)}</Card>
      ) : records.length === 0 ? (
        <EmptyState
          icon={CalendarCheck2}
          title="لا سجلات حضور لهذا الشهر بالفلاتر الحالية"
          hint="سجل حضور اليوم لفريقك بزر «تسجيل حضور» — سجل واحد لكل موظف في اليوم"
        />
      ) : (
        <>
          {/* جدول سطح المكتب */}
          <div className="hidden overflow-hidden rounded-xl border md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <Th>التاريخ</Th>
                  <Th>الموظف</Th>
                  <Th>الحالة</Th>
                  <Th>الحضور / الانصراف</Th>
                  <Th>ملاحظة</Th>
                  <Th>إجراءات</Th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2.5 tabular-nums">{r.workDate}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-bold">{r.employeeName}</div>
                      {r.jobTitle && <div className="text-[11px] text-muted-foreground">{r.jobTitle}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill label={r.statusLabel || attendanceLabel(r.status)} tone={ATT_TONE[r.status] ?? ATT_TONE.holiday} />
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground" dir="ltr">
                      {r.checkIn || "—"} ← {r.checkOut || "—"}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2.5 text-[11px] text-muted-foreground">{r.note || "—"}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-0.5">
                        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" title="تعديل" onClick={() => setEditor({ editing: r })}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                          title="حذف"
                          onClick={() => setDeleteTarget({ kind: "attendance", id: r.id, label: `حضور ${r.employeeName} — ${r.workDate}` })}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* بطاقات الجوال */}
          <div className="space-y-2 md:hidden">
            {records.map((r) => (
              <Card key={r.id} className="p-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-9 shrink-0 flex-col items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
                    <span className="text-[10px] font-bold tabular-nums leading-none">{r.workDate.slice(8, 10)}</span>
                    <span className="text-[9px] leading-none opacity-80">{r.workDate.slice(0, 7)}</span>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold">{r.employeeName}</span>
                      <StatusPill label={r.statusLabel || attendanceLabel(r.status)} tone={ATT_TONE[r.status] ?? ATT_TONE.holiday} />
                    </div>
                    <p className="text-[11px] tabular-nums text-muted-foreground" dir="ltr">
                      {r.checkIn || "—"} ← {r.checkOut || "—"}
                    </p>
                    {r.note && <p className="text-[11px] text-muted-foreground">{r.note}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" title="تعديل" onClick={() => setEditor({ editing: r })}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      title="حذف"
                      onClick={() => setDeleteTarget({ kind: "attendance", id: r.id, label: `حضور ${r.employeeName} — ${r.workDate}` })}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <AttendanceDialog
        open={!!editor}
        editing={editor?.editing ?? null}
        employeeOpts={employeeOptsActive}
        pending={saveMutation.isPending}
        onClose={() => setEditor(null)}
        onSave={(data) => saveMutation.mutate({ id: editor?.editing?.id, data })}
      />
    </div>
  );
}

// ==================== نافذة الحضور (إضافة/تعديل) ====================

function AttendanceDialog({
  open,
  editing,
  employeeOpts,
  pending,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: AttendanceRecord | null;
  employeeOpts: { value: string; label: string }[];
  pending: boolean;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
}) {
  const [form, setForm] = React.useState({
    employeeId: "",
    workDate: todayStr(),
    status: "present",
    checkIn: "",
    checkOut: "",
    note: "",
  });

  React.useEffect(() => {
    if (open) {
      setForm({
        employeeId: editing ? String(editing.employeeId) : "",
        workDate: editing?.workDate || todayStr(),
        status: editing?.status || "present",
        checkIn: editing?.checkIn || "",
        checkOut: editing?.checkOut || "",
        note: editing?.note || "",
      });
    }
  }, [open, editing]);

  const submit = () => {
    if (editing) {
      // التعديل يغير الحالة والأوقات والملاحظة فقط — الموظف واليوم ثابتان
      onSave({ status: form.status, checkIn: form.checkIn, checkOut: form.checkOut, note: form.note });
    } else {
      onSave({
        employeeId: Number(form.employeeId) || 0,
        workDate: form.workDate,
        status: form.status,
        checkIn: form.checkIn,
        checkOut: form.checkOut,
        note: form.note,
      });
    }
  };

  const employeeLabel = editing ? employeeOpts.find((o) => o.value === String(editing.employeeId))?.label ?? editing.employeeName : "";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "تعديل سجل حضور" : "تسجيل حضور يوم"}</DialogTitle>
          <DialogDescription>سجل واحد لكل موظف في اليوم — التكرار يرفضه النظام فعدّل السجل الأصلي</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>الموظف *</Label>
            {editing ? (
              <Input value={employeeLabel} disabled />
            ) : (
              <SearchableSelect
                value={form.employeeId}
                onValueChange={(v) => setForm((f) => ({ ...f, employeeId: v }))}
                options={employeeOpts}
                placeholder="اختر الموظف"
                searchPlaceholder="ابحث بالاسم…"
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label>تاريخ اليوم *</Label>
            <Input type="date" value={form.workDate} onChange={(e) => setForm((f) => ({ ...f, workDate: e.target.value }))} disabled={!!editing} max={todayStr()} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>الحالة *</Label>
            <div className="flex flex-wrap gap-1.5">
              {ATTENDANCE_STATUSES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, status: s.value }))}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs transition-colors",
                    form.status === s.value ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>وقت الحضور</Label>
            <Input type="time" value={form.checkIn} onChange={(e) => setForm((f) => ({ ...f, checkIn: e.target.value }))} dir="ltr" />
          </div>
          <div className="space-y-1.5">
            <Label>وقت الانصراف</Label>
            <Input type="time" value={form.checkOut} onChange={(e) => setForm((f) => ({ ...f, checkOut: e.target.value }))} dir="ltr" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>ملاحظة</Label>
            <Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="مثال: مأمورية خارجية" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            إلغاء
          </Button>
          <Button onClick={submit} disabled={pending || (!editing && (!form.employeeId || !form.workDate))}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {editing ? "حفظ التعديلات" : "تسجيل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== قسم الإجازات ====================

function LeavesSection({
  employeeOpts,
  employeeOptsActive,
  onErr,
  invalidate,
  setDeleteTarget,
}: SectionCommon & { employeeOpts: { value: string; label: string }[]; employeeOptsActive: { value: string; label: string }[] }) {
  const { toast } = useToast();

  // الفلاتر: الموظف والنوع عبر الخادم — الحالة والبحث محليًا (عدّادات التبويبات)
  const [employeeFilter, setEmployeeFilter] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState("");
  const [tab, setTab] = React.useState<string>("الكل");
  const [q, setQ] = React.useState("");

  const listQuery = useQuery<{ leaves: HRLeave[]; balances: Record<string, LeaveBalanceEntry> }>({
    queryKey: ["hr", "leaves", employeeFilter, typeFilter],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (employeeFilter) sp.set("employeeId", employeeFilter);
      if (typeFilter) sp.set("type", typeFilter);
      const qs = sp.toString();
      return apiGet<{ leaves: HRLeave[]; balances: Record<string, LeaveBalanceEntry> }>(`/api/hr/leaves${qs ? `?${qs}` : ""}`);
    },
  });
  const leaves = listQuery.data?.leaves ?? [];
  const balances = listQuery.data?.balances ?? {};
  const today = todayStr();

  const filtered = React.useMemo(() => {
    const needle = normSearch(q.trim());
    return leaves.filter((l) => {
      if (tab !== "الكل" && l.status !== tab) return false;
      if (needle && !normSearch(`${l.employeeName} ${l.leaveType} ${l.decisionNote}`).includes(needle)) return false;
      return true;
    });
  }, [leaves, tab, q]);

  const [editor, setEditor] = React.useState<{ editing: HRLeave | null } | null>(null);
  const [rejectTarget, setRejectTarget] = React.useState<HRLeave | null>(null);
  useAddEvent("leaves", React.useCallback(() => setEditor({ editing: null }), [setEditor]));

  const saveMutation = useMutation({
    mutationFn: async (v: { id?: number; data: Record<string, unknown> }): Promise<{ updated: boolean }> => {
      if (v.id) {
        await apiPatch(`/api/hr/leaves/${v.id}`, { action: "edit", ...v.data });
        return { updated: true };
      }
      await apiPost("/api/hr/leaves", v.data);
      return { updated: true };
    },
    onSuccess: (_r, v) => {
      setEditor(null);
      invalidate();
      toast({ title: v.id ? "حُدّث الطلب" : "سُجل طلب الإجازة", description: v.id ? undefined : "بانتظار القرار من الاعتماد" });
    },
    onError: (e) => onErr(e, "تعذر الحفظ"),
  });

  const decideMutation = useMutation({
    mutationFn: (v: { id: number; action: "approve" | "reject" | "commence" | "return"; decisionNote?: string }) =>
      apiPatch<{ updated: boolean; status?: string }>(`/api/hr/leaves/${v.id}`, {
        action: v.action,
        ...(v.decisionNote ? { decisionNote: v.decisionNote } : {}),
      }),
    onSuccess: (_r, v) => {
      setRejectTarget(null);
      invalidate();
      toast({
        title:
          v.action === "approve"
            ? "اعتُمدت الإجازة"
            : v.action === "reject"
              ? "رُفضت الإجازة"
              : v.action === "commence"
                ? "بدأت الإجازة"
                : "عاد الموظف — انتهت الإجازة",
      });
    },
    onError: (e) => onErr(e, "تعذر تنفيذ الإجراء"),
  });

  const statusCount = (s: string) => leaves.filter((l) => l.status === s).length;

  // رصيد الموظف المفلتر — يأتي جاهزًا من الخادم (recount لا تخزين)
  const filterBalance = employeeFilter ? balances[employeeFilter] : undefined;

  return (
    <div className="space-y-3">
      {/* لافتة الرصيد السنوي للموظف المفلتر */}
      {employeeFilter && filterBalance && (
        <Card className="flex flex-wrap items-center gap-x-4 gap-y-1 border-status-info/30 bg-status-info-bg/40 p-3">
          <span className="text-xs font-bold">
            الرصيد السنوي: <span className="tabular-nums">{fmtNum(filterBalance.balance)}</span> / <span className="tabular-nums">{fmtNum(filterBalance.allowance)}</span> يوم
          </span>
          <span className="text-[11px] text-muted-foreground">
            المستهلك: {fmtNum(filterBalance.consumed)} يوم
            {filterBalance.probation ? " · أقل من 9 أشهر خدمة — لا استحقاق بعد (م70)" : ""}
          </span>
        </Card>
      )}

      {/* الفلاتر */}
      <Card className="gap-3 p-3 sm:p-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-9 w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="الكل">الكل ({leaves.length})</TabsTrigger>
            {HR_LEAVE_STATUSES.map((s) => (
              <TabsTrigger key={s} value={s}>
                {s} ({statusCount(s)})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_200px]">
          <div className="relative">
            <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالموظف/النوع/ملاحظة القرار…" className="ps-8" />
          </div>
          <SearchableSelect
            value={employeeFilter}
            onValueChange={setEmployeeFilter}
            options={employeeOpts}
            placeholder="كل الموظفين"
            allowClear
            clearLabel="إظهار الكل"
          />
        </div>
        <SearchableSelect
          value={typeFilter}
          onValueChange={setTypeFilter}
          options={HR_LEAVE_TYPES.map((t) => ({ value: t, label: t }))}
          placeholder="كل الأنواع"
          allowClear
          clearLabel="إظهار الكل"
        />
      </Card>

      {/* القائمة */}
      {listQuery.isLoading ? (
        <SkeletonRows h="h-20" />
      ) : listQuery.isError ? (
        <Card className="p-8 text-center text-sm text-destructive">تعذر تحميل الإجازات — {errMessage(listQuery.error)}</Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={leaves.length === 0 ? "لا طلبات إجازة بعد" : "لا نتائج مطابقة للفلاتر"}
          hint={leaves.length === 0 ? "سجل أول طلب بزر «طلب إجازة» — الأيام تُحسب آليًا شاملة الطرفين" : "جرّب تعديل البحث أو تبويب الحالة"}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((l) => {
            const tone = LEAVE_STATUS_TONE[l.status] || LEAVE_STATUS_TONE["معلقة"];
            const onVacation = (l.status === "معتمدة" || l.status === "بدأت") && l.startDate <= today && l.endDate >= today;
            const tier = l.leaveType === "مرضية" && l.sickTier != null ? SICK_LEAVE_TIERS[l.sickTier] : undefined;
            return (
              <Card key={l.id} className={cn("p-3 sm:p-4", (l.status === "مرفوضة" || l.status === "منتهية") && "opacity-70")}>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
                    <CalendarDays className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold">{l.employeeName}</span>
                      {l.jobTitle && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{l.jobTitle}</Badge>}
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{l.leaveType}</Badge>
                      <StatusPill label={l.status} tone={tone} />
                      {onVacation && <Badge className="h-5 bg-status-warn-bg px-1.5 text-[10px] text-status-warn">في إجازة الآن</Badge>}
                      {tier ? (
                        <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums">
                          شريحة {l.sickTier! + 1}: {tier.pct}%
                        </Badge>
                      ) : l.leaveType === "مرضية" && l.sickTier != null && l.sickTier < 0 ? (
                        <Badge className="h-5 bg-status-danger-bg px-1.5 text-[10px] text-status-danger">تجاوز السلّم القانوني</Badge>
                      ) : null}
                    </div>
                    <p className="text-[11px] tabular-nums text-muted-foreground">
                      {l.startDate} ← {l.endDate} · {l.days} {l.days === 1 ? "يوم" : "أيام"}
                    </p>
                    {l.status !== "معلقة" && l.decisionBy && (
                      <p className="text-[11px] text-muted-foreground">
                        القرار: {l.decisionBy} — {l.decisionAt}
                        {l.decisionNote ? ` · ${l.decisionNote}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {l.status === "معلقة" && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-status-done hover:text-status-done"
                          title="اعتماد"
                          disabled={decideMutation.isPending}
                          onClick={() => decideMutation.mutate({ id: l.id, action: "approve" })}
                        >
                          <Check className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-status-danger hover:text-status-danger"
                          title="رفض"
                          onClick={() => setRejectTarget(l)}
                        >
                          <X className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" title="تعديل" onClick={() => setEditor({ editing: l })}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                          title="حذف"
                          onClick={() => setDeleteTarget({ kind: "leaves", id: l.id, label: `إجازة ${l.employeeName}` })}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </>
                    )}
                    {l.status === "معتمدة" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-status-info hover:text-status-info"
                        title="بدء الإجازة"
                        disabled={decideMutation.isPending}
                        onClick={() => decideMutation.mutate({ id: l.id, action: "commence" })}
                      >
                        <Play className="size-4" />
                      </Button>
                    )}
                    {l.status === "بدأت" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-status-done hover:text-status-done"
                        title="إرجاع من الإجازة — إنهاء"
                        disabled={decideMutation.isPending}
                        onClick={() => decideMutation.mutate({ id: l.id, action: "return" })}
                      >
                        <Undo2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <LeaveDialog
        open={!!editor}
        editing={editor?.editing ?? null}
        employeeOpts={employeeOptsActive}
        balances={balances}
        pending={saveMutation.isPending}
        onClose={() => setEditor(null)}
        onSave={(data) => saveMutation.mutate({ id: editor?.editing?.id, data })}
      />

      {/* نافذة الرفض — السبب إلزامي ويوثق مع القرار */}
      <Dialog open={!!rejectTarget} onOpenChange={(v) => !v && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-status-danger">رفض طلب الإجازة</DialogTitle>
            <DialogDescription>
              رفض إجازة {rejectTarget?.leaveType} لـ{rejectTarget?.employeeName} — سبب الرفض إلزامي ويوثق مع القرار.
            </DialogDescription>
          </DialogHeader>
          <ReasonForm
            label="سبب الرفض *"
            placeholder="مثال: ضغط العمل في هذه الفترة"
            submitLabel="رفض الطلب"
            pending={decideMutation.isPending}
            onSubmit={(note) => rejectTarget && decideMutation.mutate({ id: rejectTarget.id, action: "reject", decisionNote: note })}
            onCancel={() => setRejectTarget(null)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ==================== نافذة سبب إلزامي (رفض / إلغاء) ====================

function ReasonForm({
  label,
  placeholder,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  label: string;
  placeholder: string;
  submitLabel: string;
  pending: boolean;
  onSubmit: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = React.useState("");
  return (
    <>
      <div className="space-y-1.5">
        <Label>{label}</Label>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholder} autoFocus />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          تراجع
        </Button>
        <Button
          className="border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80"
          disabled={pending || !note.trim()}
          onClick={() => onSubmit(note.trim())}
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

// ==================== نافذة الإجازة (إضافة/تعديل) ====================

function LeaveDialog({
  open,
  editing,
  employeeOpts,
  balances,
  pending,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: HRLeave | null;
  employeeOpts: { value: string; label: string }[];
  balances: Record<string, LeaveBalanceEntry>;
  pending: boolean;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
}) {
  const [form, setForm] = React.useState({
    employeeId: "",
    leaveType: "سنوية",
    startDate: "",
    endDate: "",
  });

  React.useEffect(() => {
    if (open) {
      setForm({
        employeeId: editing ? String(editing.employeeId) : "",
        leaveType: editing?.leaveType ?? "سنوية",
        startDate: editing?.startDate ?? "",
        endDate: editing?.endDate ?? "",
      });
    }
  }, [open, editing]);

  // النهاية تُملأ آليًا = البداية إن كانت فارغة أو أسبق منها
  const setStart = (v: string) =>
    setForm((f) => ({ ...f, startDate: v, endDate: !f.endDate || f.endDate < v ? v : f.endDate }));

  const days =
    form.startDate && form.endDate && form.endDate >= form.startDate ? leaveDaysBetween(form.startDate, form.endDate) : 0;

  // رصيد الموظف المختار — من خريطة الأرصدة الجاهزة من الخادم
  const selectedBalance = form.employeeId ? balances[form.employeeId] : undefined;
  const balanceShort = form.leaveType === "سنوية" && selectedBalance && days > 0 && days > selectedBalance.balance;

  const submit = () => {
    if (editing) {
      onSave({ leaveType: form.leaveType, startDate: form.startDate, endDate: form.endDate });
    } else {
      onSave({ employeeId: Number(form.employeeId) || 0, leaveType: form.leaveType, startDate: form.startDate, endDate: form.endDate });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "تعديل طلب إجازة" : "طلب إجازة جديد"}</DialogTitle>
          <DialogDescription>الأيام تُحسب آليًا شاملة الطرفين — شرائح المرضية تُحدد آليًا حسب المستهلك بالسنة</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>الموظف *</Label>
            <SearchableSelect
              value={form.employeeId}
              onValueChange={(v) => setForm((f) => ({ ...f, employeeId: v }))}
              options={employeeOpts}
              placeholder="اختر الموظف"
              searchPlaceholder="ابحث بالاسم…"
            />
          </div>
          {selectedBalance && (
            <div className="sm:col-span-2">
              <Badge className={cn("h-6 gap-1 px-2 text-[11px]", balanceShort ? "bg-status-danger-bg text-status-danger" : "bg-status-info-bg text-status-info")}>
                الرصيد السنوي: <span className="font-bold tabular-nums">{fmtNum(selectedBalance.balance)}</span> /{" "}
                <span className="tabular-nums">{fmtNum(selectedBalance.allowance)}</span> يوم
                {selectedBalance.probation ? " — أقل من 9 أشهر خدمة" : ""}
              </Badge>
            </div>
          )}
          <div className="space-y-1.5 sm:col-span-2">
            <Label>نوع الإجازة *</Label>
            <div className="flex flex-wrap gap-1.5">
              {HR_LEAVE_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, leaveType: t }))}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs transition-colors",
                    form.leaveType === t ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>من تاريخ *</Label>
            <Input type="date" value={form.startDate} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>إلى تاريخ *</Label>
            <Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} min={form.startDate || undefined} />
          </div>
          <div className="space-y-1.5">
            <Label>عدد الأيام</Label>
            <Input value={days > 0 ? `${days} ${days === 1 ? "يوم" : "أيام"}` : "—"} disabled dir="ltr" />
          </div>
          {balanceShort && (
            <p className="self-end text-[11px] text-status-danger sm:col-span-1">
              تنبيه: الرصيد السنوي لا يكفي — سيمنع النظام الاعتماد
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            إلغاء
          </Button>
          <Button onClick={submit} disabled={pending || !form.employeeId || !form.startDate || !form.endDate || form.endDate < form.startDate}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {editing ? "حفظ التعديلات" : "تسجيل الطلب"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== قسم المسير ====================

function PayrollSection({ onErr, invalidate, setDeleteTarget }: SectionCommon) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [generateOpen, setGenerateOpen] = React.useState(false);
  const [payTarget, setPayTarget] = React.useState<PayrollBatchDetail | null>(null);
  const [cancelTarget, setCancelTarget] = React.useState<PayrollBatchDetail | null>(null);
  useAddEvent("payroll", React.useCallback(() => setGenerateOpen(true), [setGenerateOpen]));

  const batchesQuery = useQuery<{ batches: PayrollBatchItem[] }>({
    queryKey: ["hr", "payroll"],
    queryFn: () => apiGet<{ batches: PayrollBatchItem[] }>("/api/hr/payroll"),
  });
  const batches = batchesQuery.data?.batches ?? [];

  const detailQuery = useQuery<{ batch: PayrollBatchDetail }>({
    queryKey: ["hr", "payroll", selectedId],
    queryFn: () => apiGet<{ batch: PayrollBatchDetail }>(`/api/hr/payroll/${selectedId}`),
    enabled: selectedId != null,
  });
  const detail = detailQuery.data?.batch ?? null;

  const afterFinancial = () => {
    invalidate();
    qc.invalidateQueries({ queryKey: ["journal-entries"] });
    qc.invalidateQueries({ queryKey: ["vouchers"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  // توليد مسير شهر
  const generateMutation = useMutation({
    mutationFn: (v: { month: string }) =>
      apiPost<{ batch: { id: number; batchNo: number; month: string; monthLabel: string }; excluded: { employeeId: number; name: string; reason: string }[] }>("/api/hr/payroll", { month: v.month }),
    onSuccess: (res) => {
      setGenerateOpen(false);
      invalidate();
      setSelectedId(res.batch.id);
      toast({ title: `ولّد المسير PR-${res.batch.batchNo}`, description: `${res.batch.monthLabel} — بانتظار الاعتماد` });
      if (res.excluded.length > 0) {
        toast({
          title: `موظفون مستثنون من المسير (${res.excluded.length})`,
          description: res.excluded.slice(0, 6).map((x) => `${x.name}: ${x.reason}`).join(" · "),
        });
      }
    },
    onError: (e) => onErr(e, "تعذر توليد المسير"),
  });

  // اعتماد (مدير فقط — الخطأ 403 يظهر برسالته العربية)
  const approveMutation = useMutation({
    mutationFn: (id: number) => apiPost<{ approved: boolean; entryId: number; entryNo: string | number }>(`/api/hr/payroll/${id}/approve`, {}),
    onSuccess: (res) => {
      afterFinancial();
      toast({ title: "اعتُمد المسير", description: `سُجل قيد الاعتماد رقم ${res.entryNo}` });
    },
    onError: (e) => onErr(e, "تعذر اعتماد المسير"),
  });

  // دفع (مدير فقط)
  const payMutation = useMutation({
    mutationFn: (v: { id: number; vdate: string; method: string }) =>
      apiPost<{ paid: boolean; voucherNumber: string; voucherId: number }>(`/api/hr/payroll/${v.id}/pay`, {
        vdate: v.vdate,
        ...(v.method ? { method: v.method } : {}),
      }),
    onSuccess: (res) => {
      setPayTarget(null);
      afterFinancial();
      toast({ title: "دُفع المسير", description: `سند الدفع رقم ${res.voucherNumber}` });
    },
    onError: (e) => onErr(e, "تعذر دفع المسير"),
  });

  // إلغاء موثق (مدير فقط — سبب إلزامي)
  const cancelMutation = useMutation({
    mutationFn: (v: { id: number; reason: string }) => apiPost<{ cancelled: boolean }>(`/api/hr/payroll/${v.id}/cancel`, { reason: v.reason }),
    onSuccess: () => {
      setCancelTarget(null);
      afterFinancial();
      toast({ title: "أُلغي المسير", description: "سُجل عكسي موثق في القيود" });
    },
    onError: (e) => onErr(e, "تعذر إلغاء المسير"),
  });

  // ===== تفاصيل مسير مختار =====
  if (selectedId != null) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSelectedId(null)}>
            <ArrowRight className="size-4" />
            كل المساير
          </Button>
        </div>

        {detailQuery.isLoading ? (
          <SkeletonRows h="h-24" n={4} />
        ) : detailQuery.isError ? (
          <Card className="p-8 text-center text-sm text-destructive">تعذر تحميل المسير — {errMessage(detailQuery.error)}</Card>
        ) : detail ? (
          <>
            {/* الرأس */}
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-extrabold tabular-nums" dir="ltr">
                  PR-{detail.batchNo}
                </span>
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{detail.monthLabel}</Badge>
                <StatusPill label={detail.statusLabel || PAYROLL_BATCH_LABELS[detail.status] || detail.status} tone={BATCH_TONE[detail.status] ?? BATCH_TONE.cancelled} />
                <span className="ms-auto text-[11px] text-muted-foreground">
                  {detail.generatedBy ? `ولّده: ${detail.generatedBy}` : ""}
                  {detail.approvedBy ? ` · اعتمده: ${detail.approvedBy}` : ""}
                  {detail.paidAt ? ` · دُفع: ${detail.paidAt.slice(0, 10)}` : ""}
                </span>
              </div>
              {detail.status === "paid" && detail.paymentVoucherId && (
                <div className="mt-2">
                  <Badge className="h-6 gap-1 bg-status-done-bg px-2 text-[11px] text-status-done">
                    سند الدفع #{detail.paymentVoucherId}
                  </Badge>
                </div>
              )}
              {detail.status === "cancelled" && (
                <p className="mt-2 text-[11px] text-status-danger">
                  سبب الإلغاء: {detail.cancelReason || "—"}
                  {detail.cancelledAt ? ` (${detail.cancelledAt.slice(0, 10)})` : ""}
                </p>
              )}
            </Card>

            {/* مجاميع المسير */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard icon={Banknote} label="إجمالي المستحقات" value={fmtMoney(detail.grossTotal)} />
              <KpiCard icon={X} label="خصومات الغياب" value={fmtMoney(detail.deductionTotal)} tone={detail.deductionTotal > 0 ? "text-status-warn" : undefined} />
              <KpiCard icon={HandCoins} label="خصم السلف" value={fmtMoney(detail.advanceTotal)} tone={detail.advanceTotal > 0 ? "text-status-warn" : undefined} />
              <KpiCard icon={Check} label="الصافي المدفوع" value={fmtMoney(detail.netTotal)} tone="text-status-done" sub={`${detail.records.length} موظفًا`} />
            </div>

            {/* شريط الإجراءات حسب الحالة */}
            <div className="flex flex-wrap items-center gap-2">
              {detail.status === "draft" && (
                <>
                  <Button disabled={approveMutation.isPending} onClick={() => approveMutation.mutate(detail.id)}>
                    {approveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                    اعتماد المسير (مدير)
                  </Button>
                  <Button
                    variant="outline"
                    className="border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80"
                    onClick={() => setDeleteTarget({ kind: "payroll", id: detail.id, label: `مسير ${detail.monthLabel} — PR-${detail.batchNo}` })}
                  >
                    <Trash2 className="size-4" />
                    حذف المسودة
                  </Button>
                </>
              )}
              {detail.status === "approved" && (
                <>
                  <Button disabled={payMutation.isPending} onClick={() => setPayTarget(detail)}>
                    {payMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Banknote className="size-4" />}
                    دفع المسير (مدير)
                  </Button>
                  <Button
                    variant="outline"
                    className="border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80"
                    onClick={() => setCancelTarget(detail)}
                  >
                    <X className="size-4" />
                    إلغاء المسير (مدير)
                  </Button>
                </>
              )}
              {detail.journalEntryId && (
                <Badge variant="outline" className="h-6 px-2 text-[11px] tabular-nums">
                  قيد الاعتماد #{detail.journalEntryId}
                </Badge>
              )}
            </div>

            {/* سجلات الموظفين */}
            {detail.records.length === 0 ? (
              <EmptyState icon={Banknote} title="بلا سجلات" hint="المسير لا يحتوي سجلات موظفين" />
            ) : (
              <>
                {/* جدول سطح المكتب */}
                <div className="hidden overflow-hidden rounded-xl border md:block">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <Th>الموظف</Th>
                        <Th>الأساس</Th>
                        <Th>حاضر / غياب</Th>
                        <Th>المستحق</Th>
                        <Th>خصم غياب</Th>
                        <Th>خصم سلف</Th>
                        <Th>الصافي</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.records.map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="px-3 py-2.5">
                            <div className="font-bold">{r.snapName}</div>
                            {r.snapJobTitle && <div className="text-[11px] text-muted-foreground">{r.snapJobTitle}</div>}
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{r.snapBasisLabel}</Badge>
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                            {fmtNum(r.presentDays)} / {fmtNum(r.absenceDays)}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums">{fmtMoney(r.baseAmount)}</td>
                          <td className={cn("px-3 py-2.5 tabular-nums", r.absenceDeduction > 0 ? "text-status-warn" : "text-muted-foreground")}>{fmtMoney(r.absenceDeduction)}</td>
                          <td className={cn("px-3 py-2.5 tabular-nums", r.advanceDeduction > 0 ? "text-status-warn" : "text-muted-foreground")}>{fmtMoney(r.advanceDeduction)}</td>
                          <td className="px-3 py-2.5 font-bold tabular-nums">{fmtMoney(r.netAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* بطاقات الجوال */}
                <div className="space-y-2 md:hidden">
                  {detail.records.map((r) => (
                    <Card key={r.id} className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-bold">{r.snapName}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {r.snapJobTitle ? `${r.snapJobTitle} · ` : ""}حاضر {fmtNum(r.presentDays)} / غياب {fmtNum(r.absenceDays)}
                          </p>
                        </div>
                        <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">{r.snapBasisLabel}</Badge>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px] tabular-nums">
                        <span className="text-muted-foreground">المستحق: <span className="text-foreground">{fmtMoney(r.baseAmount)}</span></span>
                        <span className="text-muted-foreground">خصم غياب: <span className={r.absenceDeduction > 0 ? "text-status-warn" : ""}>{fmtMoney(r.absenceDeduction)}</span></span>
                        <span className="text-muted-foreground">خصم سلف: <span className={r.advanceDeduction > 0 ? "text-status-warn" : ""}>{fmtMoney(r.advanceDeduction)}</span></span>
                        <span className="font-bold">الصافي: {fmtMoney(r.netAmount)}</span>
                      </div>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </>
        ) : null}
      </div>
    );
  }

  // ===== قائمة المساير =====
  return (
    <div className="space-y-3">
      {batchesQuery.isLoading ? (
        <SkeletonRows h="h-16" />
      ) : batchesQuery.isError ? (
        <Card className="p-8 text-center text-sm text-destructive">تعذر تحميل المساير — {errMessage(batchesQuery.error)}</Card>
      ) : batches.length === 0 ? (
        <EmptyState
          icon={Banknote}
          title="لا مساير رواتب بعد"
          hint="ولّد مسير الشهر بزر «توليد مسير» — لقطة مجمّدة لأجور الشهر تُعتمد ثم تُدفع"
        />
      ) : (
        <>
          {/* جدول سطح المكتب */}
          <div className="hidden overflow-hidden rounded-xl border md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <Th>المسير</Th>
                  <Th>الشهر</Th>
                  <Th>الحالة</Th>
                  <Th>المستحقات</Th>
                  <Th>الخصومات</Th>
                  <Th>خصم السلف</Th>
                  <Th>الصافي</Th>
                  <Th>السجلات</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setSelectedId(b.id)}>
                    <td className="px-3 py-2.5 font-bold tabular-nums" dir="ltr">
                      PR-{b.batchNo}
                    </td>
                    <td className="px-3 py-2.5">{b.monthLabel}</td>
                    <td className="px-3 py-2.5">
                      <StatusPill label={PAYROLL_BATCH_LABELS[b.status] ?? b.status} tone={BATCH_TONE[b.status] ?? BATCH_TONE.cancelled} />
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtMoney(b.grossTotal)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{fmtMoney(b.deductionTotal)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{fmtMoney(b.advanceTotal)}</td>
                    <td className="px-3 py-2.5 font-bold tabular-nums">{fmtMoney(b.netTotal)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{b.recordsCount}</td>
                    <td className="px-3 py-2.5">
                      <ChevronLeft className="size-4 text-muted-foreground" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* بطاقات الجوال */}
          <div className="space-y-2 md:hidden">
            {batches.map((b) => (
              <Card key={b.id} className="cursor-pointer p-3 transition-colors hover:bg-muted/40" onClick={() => setSelectedId(b.id)}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold tabular-nums" dir="ltr">
                    PR-{b.batchNo}
                  </span>
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{b.monthLabel}</Badge>
                  <StatusPill label={PAYROLL_BATCH_LABELS[b.status] ?? b.status} tone={BATCH_TONE[b.status] ?? BATCH_TONE.cancelled} />
                  <ChevronLeft className="ms-auto size-4 shrink-0 text-muted-foreground" />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px] tabular-nums">
                  <span className="text-muted-foreground">المستحقات: <span className="text-foreground">{fmtMoney(b.grossTotal)}</span></span>
                  <span className="text-muted-foreground">الخصومات: {fmtMoney(b.deductionTotal)}</span>
                  <span className="text-muted-foreground">خصم السلف: {fmtMoney(b.advanceTotal)}</span>
                  <span className="font-bold">الصافي: {fmtMoney(b.netTotal)}</span>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">{b.recordsCount} سجل موظف</p>
              </Card>
            ))}
          </div>
        </>
      )}

      <GenerateDialog
        open={generateOpen}
        batches={batches}
        pending={generateMutation.isPending}
        onClose={() => setGenerateOpen(false)}
        onGenerate={(month) => generateMutation.mutate({ month })}
      />

      {/* نافذة الدفع */}
      <Dialog open={!!payTarget} onOpenChange={(v) => !v && setPayTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>دفع المسير</DialogTitle>
            <DialogDescription>
              صرف صافي {payTarget ? fmtMoney(payTarget.netTotal) : ""} لـ{payTarget?.records.length ?? 0} موظفًا — ينشئ سند دفع ويقفل المسير.
            </DialogDescription>
          </DialogHeader>
          <PayForm
            pending={payMutation.isPending}
            onSubmit={(vdate, method) => payTarget && payMutation.mutate({ id: payTarget.id, vdate, method })}
            onCancel={() => setPayTarget(null)}
          />
        </DialogContent>
      </Dialog>

      {/* نافذة الإلغاء — السبب إلزامي */}
      <Dialog open={!!cancelTarget} onOpenChange={(v) => !v && setCancelTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-status-danger">إلغاء المسير</DialogTitle>
            <DialogDescription>
              إلغاء {cancelTarget ? `PR-${cancelTarget.batchNo} — ${cancelTarget.monthLabel}` : ""} بسلسلة قيود عكسية موثقة — السبب إلزامي.
            </DialogDescription>
          </DialogHeader>
          <ReasonForm
            label="سبب الإلغاء *"
            placeholder="مثال: خطأ في أيام الحضور — يُعاد التوليد بعد التصحيح"
            submitLabel="إلغاء المسير"
            pending={cancelMutation.isPending}
            onSubmit={(reason) => cancelTarget && cancelMutation.mutate({ id: cancelTarget.id, reason })}
            onCancel={() => setCancelTarget(null)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );

}

// ==================== نافذة توليد المسير ====================

function GenerateDialog({
  open,
  batches,
  pending,
  onClose,
  onGenerate,
}: {
  open: boolean;
  batches: PayrollBatchItem[];
  pending: boolean;
  onClose: () => void;
  onGenerate: (month: string) => void;
}) {
  const [month, setMonth] = React.useState(thisMonth());

  React.useEffect(() => {
    if (open) setMonth(thisMonth());
  }, [open]);

  const monthTaken = batches.some((b) => b.month === month && b.status !== "cancelled");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>توليد مسير رواتب شهر</DialogTitle>
          <DialogDescription>
            لقطة مجمّدة لأجور الموظفين النشطين: المستحق من الحضور والغياب، وخصم السلف تلقائيًا حتى سقف المستحق. الموظفون بلا راتب معرف يُستثنون وتظهر قائمتهم بعد التوليد.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>الشهر *</Label>
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          {monthTaken && <p className="text-[11px] text-status-warn">يوجد مسير نشط لشهر {monthLabelAr(month)} — ألغه أو احذف مسودته قبل إعادة التوليد</p>}
          {month && !monthTaken && <p className="text-[11px] text-muted-foreground">سيولَّد مسير {monthLabelAr(month)} بحالة «مسودة» — الاعتماد والدفع لاحقًا (للمدير)</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            إلغاء
          </Button>
          <Button onClick={() => onGenerate(month)} disabled={pending || !month || monthTaken}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            توليد المسير
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== نموذج الدفع ====================

function PayForm({
  pending,
  onSubmit,
  onCancel,
}: {
  pending: boolean;
  onSubmit: (vdate: string, method: string) => void;
  onCancel: () => void;
}) {
  const [vdate, setVdate] = React.useState(todayStr());
  const [method, setMethod] = React.useState("");
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>تاريخ الدفع *</Label>
          <Input type="date" value={vdate} onChange={(e) => setVdate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>وسيلة الدفع</Label>
          <SearchableSelect
            value={method}
            onValueChange={setMethod}
            options={[
              { value: "نقدي", label: "نقدي" },
              { value: "بنك", label: "بنك" },
            ]}
            placeholder="بدون تحديد"
            allowClear
            clearLabel="مسح الوسيلة"
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          تراجع
        </Button>
        <Button onClick={() => onSubmit(vdate, method)} disabled={pending || !vdate}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          دفع المسير
        </Button>
      </DialogFooter>
    </>
  );
}

// ==================== قسم السلف ====================

function AdvancesSection({ onErr, invalidate }: Omit<SectionCommon, "setDeleteTarget">) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [employeeFilter, setEmployeeFilter] = React.useState("");

  // فريق السلف — نفس نهاية العهد (screen_custody): 403 تعني بلا صلاحية
  const empQuery = useQuery<AdvanceEmployeesResponse>({
    queryKey: ["hr", "advances", "employees"],
    queryFn: () => apiGet<AdvanceEmployeesResponse>("/api/employees"),
  });
  const advanceEmployees = empQuery.data?.employees ?? [];
  const forbidden = empQuery.isError && empQuery.error instanceof ApiError && empQuery.error.status === 403;

  const movesQuery = useQuery<{ vouchers: AdvanceVoucherItem[]; balance?: number }>({
    queryKey: ["hr", "advances", "movements", employeeFilter],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (employeeFilter) sp.set("employeeId", employeeFilter);
      const qs = sp.toString();
      return apiGet<{ vouchers: AdvanceVoucherItem[]; balance?: number }>(`/api/employees/advances${qs ? `?${qs}` : ""}`);
    },
    enabled: !forbidden,
  });
  const movements = movesQuery.data?.vouchers ?? [];
  const filterBalance = employeeFilter && movesQuery.data?.balance != null ? movesQuery.data.balance : undefined;

  const [addOpen, setAddOpen] = React.useState(false);
  useAddEvent("advances", React.useCallback(() => setAddOpen(true), [setAddOpen]));

  const invalidateAdvances = () => {
    invalidate();
    qc.invalidateQueries({ queryKey: ["employees"] });
    qc.invalidateQueries({ queryKey: ["employees-advances"] });
    qc.invalidateQueries({ queryKey: ["advances-ledger"] });
    qc.invalidateQueries({ queryKey: ["advances-summary"] });
    qc.invalidateQueries({ queryKey: ["advances-ledger-individual"] });
    qc.invalidateQueries({ queryKey: ["advances-cancelled"] });
    qc.invalidateQueries({ queryKey: ["vouchers"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const addMutation = useMutation({
    mutationFn: (v: AdvanceMoveInput) =>
      apiPost<{ voucher: { voucherNumber?: string; balance?: number } }>("/api/employees/advances", {
        kind: v.kind,
        employeeId: v.employeeId,
        amount: v.amount,
        vdate: v.vdate,
        ...(v.method ? { method: v.method } : {}),
        description: v.description ?? "",
      }),
    onSuccess: (res, v) => {
      setAddOpen(false);
      invalidateAdvances();
      const kindLabel = ADVANCE_KINDS.find((k) => k.value === v.kind)?.label ?? "";
      toast({
        title: `${kindLabel} — سند ${res.voucher?.voucherNumber ?? ""}`,
        description: res.voucher?.balance != null ? `رصيد السلفة الحالي: ${fmtMoney(res.voucher.balance)}` : undefined,
      });
    },
    onError: (e) => onErr(e, "تعذر تسجيل الحركة"),
  });

  if (forbidden) {
    return (
      <EmptyState
        icon={HandCoins}
        title="شاشة السلف تحتاج صلاحية العهد والسلف"
        hint="حركات السلف تُقيد عبر سندات الخزينة — راسل المدير لمنح صلاحية «العهد والسلف» لحسابك"
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* ملخص إجمالي */}
      {empQuery.data?.totals && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard icon={HandCoins} label="إجمالي الصرف" value={fmtMoney(empQuery.data.totals.advanced)} tone="text-status-info" />
          <KpiCard icon={Undo2} label="ردود نقدية" value={fmtMoney(empQuery.data.totals.recovered)} tone="text-status-done" />
          <KpiCard icon={X} label="خصومات رواتب" value={fmtMoney(empQuery.data.totals.deducted)} tone="text-status-warn" />
          <KpiCard icon={Banknote} label="إجمالي المعلق" value={fmtMoney(empQuery.data.totals.balance)} tone={empQuery.data.totals.balance > 0 ? "text-status-danger" : undefined} />
        </div>
      )}

      {/* أرصدة الموظفين */}
      {empQuery.isLoading ? (
        <SkeletonRows h="h-14" />
      ) : empQuery.isError ? (
        <Card className="p-8 text-center text-sm text-destructive">تعذر تحميل أرصدة السلف — {errMessage(empQuery.error)}</Card>
      ) : advanceEmployees.length === 0 ? (
        <EmptyState icon={Users} title="لا موظفون في سجل العهد بعد" hint="أضف الموظفين من تبويب «الموظفون» في الموارد البشرية" />
      ) : (
        <>
          {/* جدول سطح المكتب */}
          <div className="hidden overflow-hidden rounded-xl border md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <Th>الموظف</Th>
                  <Th>صُرف</Th>
                  <Th>رُد نقدًا</Th>
                  <Th>خُصم من الراتب</Th>
                  <Th>الرصيد المعلق</Th>
                  <Th>حركات</Th>
                </tr>
              </thead>
              <tbody>
                {advanceEmployees.map((e) => (
                  <tr key={e.id} className={cn("border-t", !e.active && "opacity-60")}>
                    <td className="px-3 py-2.5 font-bold">{e.name}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtMoney(e.advanced)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{fmtMoney(e.recovered)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{fmtMoney(e.deducted)}</td>
                    <td className={cn("px-3 py-2.5 font-bold tabular-nums", e.balance > 0 ? "text-status-danger" : "text-status-done")}>{fmtMoney(e.balance)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{e.movements}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* بطاقات الجوال */}
          <div className="space-y-2 md:hidden">
            {advanceEmployees.map((e) => (
              <Card key={e.id} className={cn("p-3", !e.active && "opacity-70")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold">{e.name}</span>
                  <span className={cn("text-sm font-bold tabular-nums", e.balance > 0 ? "text-status-danger" : "text-status-done")}>{fmtMoney(e.balance)}</span>
                </div>
                <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-[11px] tabular-nums text-muted-foreground">
                  <span>صُرف: <span className="text-foreground">{fmtMoney(e.advanced)}</span></span>
                  <span>رُد: {fmtMoney(e.recovered)}</span>
                  <span>خُصم: {fmtMoney(e.deducted)}</span>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* سجل الحركات */}
      <Card className="gap-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold text-muted-foreground">سجل حركات السلف</p>
          <div className="w-full sm:w-[220px]">
            <SearchableSelect
              value={employeeFilter}
              onValueChange={setEmployeeFilter}
              options={advanceEmployees.map((e) => ({ value: String(e.id), label: e.name }))}
              placeholder="كل الموظفين"
              allowClear
              clearLabel="إظهار الكل"
            />
          </div>
        </div>
        {filterBalance != null && (
          <Badge className="h-6 bg-status-danger-bg px-2 text-[11px] tabular-nums text-status-danger">
            رصيد الموظف المفلتر: {fmtMoney(filterBalance)}
          </Badge>
        )}
      </Card>

      {movesQuery.isLoading ? (
        <SkeletonRows h="h-12" />
      ) : movesQuery.isError ? (
        <Card className="p-8 text-center text-sm text-destructive">تعذر تحميل الحركات — {errMessage(movesQuery.error)}</Card>
      ) : movements.length === 0 ? (
        <EmptyState icon={HandCoins} title="لا حركات سلف بالفلاتر الحالية" hint="صرف أول سلفة بزر «صرف سلفة» — أو اعرض الكل بمسح الفلتر" />
      ) : (
        <div className="space-y-2">
          {movements.map((m) => (
            <Card key={m.id} className={cn("p-3", m.cancelled && "opacity-60")}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-[11px] font-bold tabular-nums text-primary-soft-foreground" dir="ltr">
                  {m.voucherNumber}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold">{m.employeeName}</span>
                    <StatusPill label={m.kindLabel} tone={KIND_TONE[m.kind] ?? { text: "text-muted-foreground", bg: "bg-muted" }} />
                    {m.cancelled && <Badge className="h-5 bg-muted px-1.5 text-[10px] text-muted-foreground">ملغى</Badge>}
                    <span className="text-[11px] tabular-nums text-muted-foreground">{m.vdate}</span>
                  </div>
                  {m.description && <p className="text-[11px] text-muted-foreground">{m.description}</p>}
                  {m.cancelled && m.cancelReason && <p className="text-[11px] text-status-danger">سبب الإلغاء: {m.cancelReason}</p>}
                </div>
                <span className={cn("shrink-0 text-sm font-bold tabular-nums", m.kind === "grant" ? "text-status-info" : m.kind === "return" ? "text-status-done" : "text-status-warn")}>
                  {fmtMoney(m.amount)}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <AdvanceDialog
        open={addOpen}
        employeeOpts={advanceEmployees.filter((e) => e.active).map((e) => ({ value: String(e.id), label: e.name }))}
        pending={addMutation.isPending}
        onClose={() => setAddOpen(false)}
        onSave={(data) => addMutation.mutate(data)}
      />
    </div>
  );
}

const ADVANCE_KINDS: { value: string; label: string }[] = [
  { value: "grant", label: "سلفة" },
  { value: "return", label: "رد نقدي" },
  { value: "deduction", label: "خصم من راتب" },
];

interface AdvanceMoveInput {
  kind: string;
  employeeId: number;
  amount: number;
  vdate: string;
  method?: string;
  description?: string;
}

// ==================== نافذة حركة سلفة ====================

function AdvanceDialog({
  open,
  employeeOpts,
  pending,
  onClose,
  onSave,
}: {
  open: boolean;
  employeeOpts: { value: string; label: string }[];
  pending: boolean;
  onClose: () => void;
  onSave: (data: AdvanceMoveInput) => void;
}) {
  const [form, setForm] = React.useState({
    kind: "grant",
    employeeId: "",
    amount: "",
    vdate: todayStr(),
    method: "",
    description: "",
  });

  const methodsQuery = useQuery<{ methods: PaymentMethodItem[] }>({
    queryKey: ["payment-methods"],
    queryFn: () => apiGet<{ methods: PaymentMethodItem[] }>("/api/payment-methods"),
    enabled: open,
  });
  const methodOpts = React.useMemo(
    () => (methodsQuery.data?.methods ?? []).filter((m) => m.isActive).map((m) => ({ value: m.name, label: m.name })),
    [methodsQuery.data]
  );

  React.useEffect(() => {
    if (open) {
      setForm({ kind: "grant", employeeId: "", amount: "", vdate: todayStr(), method: "", description: "" });
    }
  }, [open]);

  const kindMeta: Record<string, { title: string; desc: string }> = {
    grant: { title: "صرف سلفة موظف", desc: "سند صرف يُقيد على «سلف موظفين» — يُخصم من مسير الرواتب تلقائيًا حتى سداده" },
    return: { title: "تسجيل رد نقدي", desc: "سند قبض يخفض رصيد السلفة نقدًا — بسقف قاطع على المتبقي" },
    deduction: { title: "خصم من الراتب", desc: "خصم غير نقدي يسدد السلفة من مسير الرواتب — بسقف قاطع على المتبقي" },
  };
  const meta = kindMeta[form.kind] ?? kindMeta.grant;
  const amount = Number(form.amount) || 0;

  const submit = () => {
    onSave({
      kind: form.kind,
      employeeId: Number(form.employeeId) || 0,
      amount,
      vdate: form.vdate,
      method: form.kind === "grant" ? form.method : undefined,
      description: form.description,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{meta.title}</DialogTitle>
          <DialogDescription>{meta.desc}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>نوع الحركة *</Label>
            <SearchableSelect
              value={form.kind}
              onValueChange={(v) => setForm((f) => ({ ...f, kind: v || "grant" }))}
              options={ADVANCE_KINDS}
              placeholder="اختر النوع"
            />
          </div>
          <div className="space-y-1.5">
            <Label>الموظف *</Label>
            <SearchableSelect
              value={form.employeeId}
              onValueChange={(v) => setForm((f) => ({ ...f, employeeId: v }))}
              options={employeeOpts}
              placeholder="اختر الموظف"
              searchPlaceholder="ابحث بالاسم…"
            />
          </div>
          <div className="space-y-1.5">
            <Label>المبلغ *</Label>
            <Input type="number" min="0" step="0.001" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} dir="ltr" placeholder="0.000" />
          </div>
          <div className="space-y-1.5">
            <Label>التاريخ *</Label>
            <Input type="date" value={form.vdate} onChange={(e) => setForm((f) => ({ ...f, vdate: e.target.value }))} />
          </div>
          {form.kind === "grant" && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>وسيلة الدفع</Label>
              <SearchableSelect
                value={form.method}
                onValueChange={(v) => setForm((f) => ({ ...f, method: v }))}
                options={methodOpts}
                placeholder="نقدي (افتراضي)"
                allowClear
                clearLabel="مسح الوسيلة"
                loading={methodsQuery.isLoading}
              />
            </div>
          )}
          <div className="space-y-1.5 sm:col-span-2">
            <Label>البيان</Label>
            <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="اختياري — مثال: سلفة ظروف اضطرارية" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            إلغاء
          </Button>
          <Button onClick={submit} disabled={pending || !form.employeeId || !(amount > 0) || !form.vdate}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            تسجيل الحركة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
