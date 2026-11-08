"use client";

/**
 * HRView.tsx — شاشة موديول «الموارد البشرية» (HR-1 + HR-2):
 * ثمانية أقسام يملكها تبويب الشل «الموارد البشرية» (nav-structure → section):
 *   الموظفون · الحضور (باستيراد البصمة وجدول الدوام) · الإجازات · الأذونات · مسير الرواتب · سلف الموظفين · نهاية الخدمة · التقارير
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
  ClipboardList,
  Clock,
  DoorOpen,
  HandCoins,
  Loader2,
  Network,
  Phone,
  Play,
  Plus,
  Power,
  PowerOff,
  Pencil,
  Printer,
  Search,
  Timer,
  Trash2,
  Undo2,
  Upload,
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
// HR-3 — قسم الأطقم والتكليفات + حوار توزيع التكلفة (يُعاد استخدامه من بطاقة المسير)
import { LaborSection, AllocationDialog, type AllocationView } from "./hr/LaborSection";

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
  monthlyCostRate: number;
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
  lateMinutes: number;
  earlyLeaveMinutes: number;
  source: string;
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
  snapSickDays: number;
  snapLateMinutes: number;
  baseAmount: number;
  absenceDeduction: number;
  sickDeduction: number;
  lateDeduction: number;
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

export type HRSection = "team" | "attendance" | "leaves" | "permissions" | "payroll" | "advances" | "eos" | "labor" | "reports";

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
  { key: "permissions", label: "الأذونات", icon: Timer },
  { key: "payroll", label: "المسير", icon: Banknote },
  { key: "advances", label: "السلف", icon: HandCoins },
  { key: "eos", label: "نهاية الخدمة", icon: DoorOpen },
  { key: "labor", label: "الأطقم والتكليفات", icon: Network },
  { key: "reports", label: "التقارير", icon: ClipboardList },
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
            الموظفون وأسس أجورهم · الحضور والبصمة · الإجازات والأذونات · مسير الرواتب · السلف · نهاية الخدمة والتقارير
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
      {section === "permissions" && (
        <PermissionsSection employeeOpts={employeeOptsActive} onErr={onErr} invalidate={invalidate} setDeleteTarget={setDeleteTarget} />
      )}
      {section === "payroll" && <PayrollSection onErr={onErr} invalidate={invalidate} setDeleteTarget={setDeleteTarget} />}
      {section === "advances" && <AdvancesSection onErr={onErr} invalidate={invalidate} />}
      {section === "eos" && <EosSection employeeOptsActive={employeeOptsActive} onErr={onErr} invalidate={invalidate} />}
      {section === "labor" && <LaborSection employeeOpts={employeeOpts} onErr={onErr} invalidate={invalidate} />}
      {section === "reports" && <ReportsSection employeeOpts={employeeOpts} onErr={onErr} />}

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
  permissions: "حُذف طلب الإذن",
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
    permissions: "طلب إذن",
    payroll: "توليد مسير",
    advances: "صرف سلفة",
    eos: "توثيق نهاية خدمة",
    labor: "فريق جديد",
    reports: "تقرير ملف موظف",
  };
  return (
    <Button
      onClick={() => {
        if ((section === "attendance" || section === "leaves" || section === "permissions" || section === "advances") && !employeesReady) {
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

/** أقسام بلا حذف (نهاية الخدمة) — لا تحتاج setDeleteTarget */
interface SectionCommonPartial {
  onErr: (e: unknown, title: string) => void;
  invalidate: () => void;
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
    monthlyCostRate: "",
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
        monthlyCostRate: editing?.monthlyCostRate ? String(editing.monthlyCostRate) : "",
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
      monthlyCostRate: Number(form.monthlyCostRate) || 0,
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
            <Label>التكلفة الشهرية على الشركة</Label>
            <Input
              type="number"
              min="0"
              step="0.001"
              value={form.monthlyCostRate}
              onChange={set("monthlyCostRate")}
              dir="ltr"
              placeholder="افتراضي: الأجر الأساسي"
            />
            <p className="text-[10px] text-muted-foreground">HR-3 — أساس توزيع تكلفة العمالة على العقود (د2)</p>
          </div>
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
  const [importOpen, setImportOpen] = React.useState(false);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
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
      {/* HR-2 — شريط البصمة وجدول الدوام */}
      <Card className="flex flex-wrap items-center gap-2 p-3 sm:p-4">
        <span className="text-xs font-bold">البصمة والدوام</span>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setImportOpen(true)}>
          <Upload className="size-3.5" />
          استيراد بصمة
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setScheduleOpen(true)}>
          <Clock className="size-3.5" />
          جدول الدوام
        </Button>
        <span className="text-[11px] text-muted-foreground">دقائق التأخير/الانصراف تُحسب آليًا من الجدول — والاستيراد لا يلمس الأيام اليدوية</span>
      </Card>
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
                      {(r.lateMinutes > 0 || r.earlyLeaveMinutes > 0) && (
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          {r.lateMinutes > 0 && <Badge className="h-5 bg-status-warn-bg px-1.5 text-[10px] text-status-warn">متأخر {r.lateMinutes}د</Badge>}
                          {r.earlyLeaveMinutes > 0 && <Badge className="h-5 bg-status-warn-bg px-1.5 text-[10px] text-status-warn">انصراف مبكر {r.earlyLeaveMinutes}د</Badge>}
                        </span>
                      )}
                      {r.source === "import" && <Badge variant="outline" className="mt-0.5 h-5 px-1.5 text-[10px]">بصمة مستوردة</Badge>}
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
                      {r.lateMinutes > 0 ? ` · متأخر ${r.lateMinutes}د` : ""}
                      {r.earlyLeaveMinutes > 0 ? ` · انصراف مبكر ${r.earlyLeaveMinutes}د` : ""}
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

      {/* HR-2 — نافذة استيراد البصمة */}
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onErr={onErr} invalidate={invalidate} />
      {/* HR-2 — نافذة جدول الدوام */}
      <ScheduleDialog open={scheduleOpen} onClose={() => setScheduleOpen(false)} onErr={onErr} invalidate={invalidate} />
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
  const [allocTarget, setAllocTarget] = React.useState<PayrollBatchDetail | null>(null);
  useAddEvent("payroll", React.useCallback(() => setGenerateOpen(true), [setGenerateOpen]));

  // HR-3 — تغطية توزيع التكلفة للمسير المختار (شارة بالرأس + زر في شريط الإجراءات)
  const allocViewQuery = useQuery<AllocationView>({
    queryKey: ["hr", "labor", "allocations", selectedId],
    queryFn: () => apiGet<AllocationView>(`/api/hr/labor/allocations?batchId=${selectedId}`),
    enabled: selectedId != null,
  });
  const allocView = allocViewQuery.data ?? null;

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
              {allocView && (
                <Badge variant="outline" className="h-6 gap-1 px-2 text-[11px] tabular-nums">
                  <Network className="size-3" />
                  التوزيع: {fmtMoney(allocView.totals.allocatedTotal)} من {fmtMoney(allocView.totals.fullCostTotal)}
                </Badge>
              )}
              <Button variant="outline" className="gap-1.5" onClick={() => setAllocTarget(detail)}>
                <Network className="size-4" />
                توزيع التكلفة
              </Button>
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
                        <Th>خصم مرضية</Th>
                        <Th>خصم تأخير</Th>
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
                          <td className={cn("px-3 py-2.5 tabular-nums", r.sickDeduction > 0 ? "text-status-warn" : "text-muted-foreground")} title={r.snapSickDays > 0 ? `${r.snapSickDays} يوم مرضي` : undefined}>{fmtMoney(r.sickDeduction)}</td>
                          <td className={cn("px-3 py-2.5 tabular-nums", r.lateDeduction > 0 ? "text-status-warn" : "text-muted-foreground")} title={r.snapLateMinutes > 0 ? `${r.snapLateMinutes} دقيقة مجردة` : undefined}>{fmtMoney(r.lateDeduction)}</td>
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
                        <span className="text-muted-foreground">خصم مرضية: <span className={r.sickDeduction > 0 ? "text-status-warn" : ""}>{fmtMoney(r.sickDeduction)}</span></span>
                        <span className="text-muted-foreground">خصم تأخير: <span className={r.lateDeduction > 0 ? "text-status-warn" : ""}>{fmtMoney(r.lateDeduction)}</span></span>
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
        <AllocationDialog
          open={!!allocTarget}
          batchId={allocTarget?.id ?? null}
          batchLabel={allocTarget ? `${allocTarget.monthLabel} — PR-${allocTarget.batchNo}` : ""}
          onClose={() => setAllocTarget(null)}
          onErr={onErr}
        />
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

// ==================== HR-2 — نافذة جدول الدوام ====================

function ScheduleDialog({ open, onClose, onErr, invalidate }: { open: boolean; onClose: () => void; onErr: (e: unknown, t: string) => void; invalidate: () => void }) {
  const { toast } = useToast();
  const q = useQuery<{ schedule: { start: string; end: string; graceMinutes: number }; workHoursPerDay: number }>({
    queryKey: ["hr", "schedule"],
    queryFn: () => apiGet("/api/hr/schedule"),
    enabled: open,
  });
  const [form, setForm] = React.useState({ start: "08:00", end: "17:00", graceMinutes: 15 });
  React.useEffect(() => {
    if (q.data) setForm(q.data.schedule);
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => apiPutRaw("/api/hr/schedule", form),
    onSuccess: () => {
      invalidate();
      onClose();
      toast({ title: "حُفظ جدول الدوام", description: "دقائق الحضور الجديدة تُحسب بالجدول المحدّث" });
    },
    onError: (e) => onErr(e, "تعذر حفظ الجدول"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>جدول الدوام الرسمي</DialogTitle>
          <DialogDescription>
            أساس حساب دقائق التأخير والانصراف المبكر — ساعات اليوم: {q.data ? q.data.workHoursPerDay : "—"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">البداية</Label>
            <Input type="time" value={form.start} onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} dir="ltr" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">النهاية</Label>
            <Input type="time" value={form.end} onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} dir="ltr" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">السماحية (دقيقة)</Label>
            <Input
              type="number"
              min={0}
              max={120}
              value={form.graceMinutes}
              onChange={(e) => setForm((f) => ({ ...f, graceMinutes: Number(e.target.value) }))}
              dir="ltr"
            />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          التأخير داخل السماحية لا يُخصم. الإذن المعتمد يعفي دقائقه المعلنة. الباقي يُخصم بساعة العمل: الأساسي ÷ 30 ÷ ساعات اليوم (د3).
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** PUT مساعد — apiPatch يُستخدم للتعديلات المحددة، والجدول PUT كامل */
async function apiPutRaw(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(j.error || "تعذر الطلب", res.status);
  }
  return res.json();
}

// ==================== HR-2 — نافذة استيراد البصمة ====================

interface ImportPreviewRow {
  line: number;
  jobNumber: string;
  workDate: string;
  employeeName: string;
  checkIn: string;
  checkOut: string;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  note: string;
  action: "create" | "update" | "skip_manual" | "skip_leave" | "rejected";
  reason: string;
}

const IMPORT_ACTION_LABELS: Record<string, { label: string; cls: string }> = {
  create: { label: "جديد", cls: "bg-status-done-bg text-status-done" },
  update: { label: "تحديث", cls: "bg-status-info-bg text-status-info" },
  skip_manual: { label: "يدوي محمي", cls: "bg-muted text-muted-foreground" },
  skip_leave: { label: "إجازة", cls: "bg-status-info-bg text-status-info" },
  rejected: { label: "مرفوض", cls: "bg-status-danger-bg text-status-danger" },
};

function ImportDialog({ open, onClose, onErr, invalidate }: { open: boolean; onClose: () => void; onErr: (e: unknown, t: string) => void; invalidate: () => void }) {
  const { toast } = useToast();
  const [text, setText] = React.useState("");
  const [fileName, setFileName] = React.useState("");
  const [preview, setPreview] = React.useState<{ totals: Record<string, number>; rows: ImportPreviewRow[]; rejected: { line: number; reason: string }[] } | null>(null);

  const reset = () => {
    setText("");
    setFileName("");
    setPreview(null);
  };

  const onFile = async (f: File | null) => {
    if (!f) return;
    setFileName(f.name);
    const t = await f.text();
    setText(t);
    setPreview(null);
  };

  const previewMutation = useMutation({
    mutationFn: () => apiPost<{ preview: boolean; totals: Record<string, number>; rows: ImportPreviewRow[]; rejected: { line: number; reason: string }[] }>("/api/hr/attendance/import", { mode: "preview", text }),
    onSuccess: (r) => setPreview({ totals: r.totals, rows: r.rows, rejected: r.rejected }),
    onError: (e) => onErr(e, "تعذر تحليل الملف"),
  });

  const commitMutation = useMutation({
    mutationFn: () => apiPost<{ committed: boolean; created: number; updated: number; skippedManual: number; skippedLeave: number; rejectedLines: number }>("/api/hr/attendance/import", { mode: "commit", text }),
    onSuccess: (r) => {
      invalidate();
      onClose();
      reset();
      toast({
        title: `ثُبتت الحضور: ${r.created} جديد · ${r.updated} تحديث`,
        description: `يدوي محمي: ${r.skippedManual} · إجازة: ${r.skippedLeave} · مرفوض: ${r.rejectedLines}`,
      });
    },
    onError: (e) => onErr(e, "تعذر تثبيت الاستيراد"),
  });

  const totals = preview?.totals;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>استيراد بصمة الحضور</DialogTitle>
          <DialogDescription>
            قالب CSV/TXT: <span dir="ltr" className="font-mono text-[11px]">jobNumber,YYYY-MM-DD,in,out,in2,out2</span> — الدمج يأخذ أقدم دخول وأحدث خروج
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input type="file" accept=".csv,.txt,.dat" onChange={(e) => onFile(e.target.files?.[0] ?? null)} className="h-9 flex-1" dir="ltr" />
            {fileName && <Badge variant="outline" className="h-6 text-[11px]">{fileName}</Badge>}
          </div>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
            }}
            rows={4}
            dir="ltr"
            placeholder={"1001,2026-11-01,08:05,17:00\n1001,2026-11-02,08:10,16:45,16:50,17:10"}
            className="w-full rounded-lg border bg-background p-2 font-mono text-[11px]"
          />

          {totals && (
            <div className="flex flex-wrap gap-1.5">
              <Badge className="h-6 bg-status-done-bg text-[11px] text-status-done">جديد: {totals.create}</Badge>
              <Badge className="h-6 bg-status-info-bg text-[11px] text-status-info">تحديث: {totals.update}</Badge>
              <Badge className="h-6 bg-muted text-[11px] text-muted-foreground">يدوي محمي: {totals.skippedManual}</Badge>
              <Badge className="h-6 bg-status-info-bg text-[11px] text-status-info">إجازة: {totals.skippedLeave}</Badge>
              <Badge className="h-6 bg-status-danger-bg text-[11px] text-status-danger">مرفوض: {totals.rejectedLines}</Badge>
            </div>
          )}

          {preview && preview.rows.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-lg border" dir="ltr">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-muted/60">
                  <tr>
                    <th className="px-2 py-1.5 text-start">#</th>
                    <th className="px-2 py-1.5 text-start">الوظيفي</th>
                    <th className="px-2 py-1.5 text-start">التاريخ</th>
                    <th className="px-2 py-1.5 text-start">دخول←خروج</th>
                    <th className="px-2 py-1.5 text-start">التأخير</th>
                    <th className="px-2 py-1.5 text-start">الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 100).map((r) => {
                    const a = IMPORT_ACTION_LABELS[r.action];
                    return (
                      <tr key={`${r.line}`} className="border-t">
                        <td className="px-2 py-1 tabular-nums text-muted-foreground">{r.line}</td>
                        <td className="px-2 py-1 tabular-nums">{r.jobNumber}</td>
                        <td className="px-2 py-1 tabular-nums">{r.workDate}</td>
                        <td className="px-2 py-1 tabular-nums">{r.checkIn || "—"}←{r.checkOut || "—"}</td>
                        <td className="px-2 py-1 tabular-nums">{r.lateMinutes > 0 ? `${r.lateMinutes}د` : "—"}</td>
                        <td className="px-2 py-1">
                          <span className={cn("rounded px-1.5 py-0.5 text-[10px]", a.cls)}>{a.label}</span>
                          {r.reason && <span className="ms-1 text-[10px] text-muted-foreground">{r.reason}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); reset(); }}>
            إغلاق
          </Button>
          <Button variant="outline" onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending || !text.trim()}>
            {previewMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            معاينة
          </Button>
          <Button onClick={() => commitMutation.mutate()} disabled={commitMutation.isPending || !preview || (totals?.create ?? 0) + (totals?.update ?? 0) === 0}>
            {commitMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            تثبيت
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== HR-2 — قسم الأذونات ====================

interface HRPermission {
  id: number;
  employeeId: number;
  employeeName: string;
  jobTitle: string;
  permDate: string;
  kind: string;
  kindLabel: string;
  minutes: number;
  reason: string;
  status: string;
  decisionBy: string;
  decisionAt: string;
  decisionNote: string;
}

const PERM_STATUS_TONE: Record<string, { text: string; bg: string }> = {
  "معلقة": { text: "text-status-warn", bg: "bg-status-warn-bg" },
  "معتمدة": { text: "text-status-info", bg: "bg-status-info-bg" },
  "مرفوضة": { text: "text-status-danger", bg: "bg-status-danger-bg" },
};

function PermissionsSection({
  employeeOpts,
  onErr,
  invalidate,
  setDeleteTarget,
}: SectionCommon & { employeeOpts: { value: string; label: string }[] }) {
  const { toast } = useToast();

  const [monthFilter, setMonthFilter] = React.useState(thisMonth());
  const [tab, setTab] = React.useState<string>("الكل");
  const [q, setQ] = React.useState("");

  const listQuery = useQuery<{ permissions: HRPermission[] }>({
    queryKey: ["hr", "permissions", monthFilter],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (monthFilter) sp.set("month", monthFilter);
      const qs = sp.toString();
      return apiGet<{ permissions: HRPermission[] }>(`/api/hr/permissions${qs ? `?${qs}` : ""}`);
    },
  });
  const permissions = listQuery.data?.permissions ?? [];

  const filtered = React.useMemo(() => {
    const needle = normSearch(q.trim());
    return permissions.filter((p) => {
      if (tab !== "الكل" && p.status !== tab) return false;
      if (needle && !normSearch(`${p.employeeName} ${p.reason} ${p.kindLabel}`).includes(needle)) return false;
      return true;
    });
  }, [permissions, tab, q]);

  const [editor, setEditor] = React.useState(false);
  const [rejectTarget, setRejectTarget] = React.useState<HRPermission | null>(null);
  const [rejectNote, setRejectNote] = React.useState("");
  useAddEvent("permissions", React.useCallback(() => setEditor(true), [setEditor]));

  const saveMutation = useMutation({
    mutationFn: (v: Record<string, unknown>) => apiPost("/api/hr/permissions", v),
    onSuccess: () => {
      setEditor(false);
      invalidate();
      toast({ title: "سُجل طلب الإذن", description: "بانتظار القرار" });
    },
    onError: (e) => onErr(e, "تعذر الحفظ"),
  });

  const decideMutation = useMutation({
    mutationFn: (v: { id: number; action: "approve" | "reject"; decisionNote?: string }) =>
      apiPatch(`/api/hr/permissions/${v.id}`, { action: v.action, ...(v.decisionNote ? { decisionNote: v.decisionNote } : {}) }),
    onSuccess: (_r, v) => {
      setRejectTarget(null);
      setRejectNote("");
      invalidate();
      toast({ title: v.action === "approve" ? "اعتُمد الإذن — يعفي دقائقه من الخصم" : "رُفض الإذن" });
    },
    onError: (e) => onErr(e, "تعذر تنفيذ الإجراء"),
  });

  const statusCount = (s: string) => permissions.filter((p) => p.status === s).length;

  return (
    <div className="space-y-3">
      <Card className="gap-3 p-3 sm:p-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-9 w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="الكل">الكل ({permissions.length})</TabsTrigger>
            {["معلقة", "معتمدة", "مرفوضة"].map((s) => (
              <TabsTrigger key={s} value={s}>
                {s} ({statusCount(s)})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr]">
          <div className="flex items-center gap-1.5">
            <Label className="shrink-0 text-xs text-muted-foreground">الشهر</Label>
            <Input type="month" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="h-9 w-40" dir="ltr" />
          </div>
          <div className="relative">
            <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالموظف/العلة…" className="ps-8" />
          </div>
        </div>
      </Card>

      {listQuery.isLoading ? (
        <SkeletonRows h="h-14" />
      ) : listQuery.isError ? (
        <Card className="p-8 text-center text-sm text-destructive">تعذر تحميل الأذونات — {errMessage(listQuery.error)}</Card>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Timer} title="لا أذونات بهذا الشهر بالفلاتر الحالية" hint="الأذونات المعتمدة تعفي دقائقها من الخصم الدقائقي في المسير" />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <Th>التاريخ</Th>
                  <Th>الموظف</Th>
                  <Th>النوع</Th>
                  <Th>المدة</Th>
                  <Th>العلة</Th>
                  <Th>الحالة</Th>
                  <Th>إجراءات</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="px-3 py-2.5 tabular-nums">{p.permDate}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-bold">{p.employeeName}</div>
                      {p.jobTitle && <div className="text-[11px] text-muted-foreground">{p.jobTitle}</div>}
                    </td>
                    <td className="px-3 py-2.5">{p.kindLabel}</td>
                    <td className="px-3 py-2.5 tabular-nums">{p.minutes} دقيقة</td>
                    <td className="max-w-[200px] truncate px-3 py-2.5 text-[11px] text-muted-foreground" title={p.reason}>{p.reason}</td>
                    <td className="px-3 py-2.5">
                      <StatusPill label={p.status} tone={PERM_STATUS_TONE[p.status] ?? PERM_STATUS_TONE["معلقة"]} />
                      {p.status === "مرفوضة" && p.decisionNote && (
                        <div className="mt-0.5 text-[10px] text-muted-foreground">السبب: {p.decisionNote}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-0.5">
                        {p.status === "معلقة" && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-status-done hover:text-status-done"
                              title="اعتماد"
                              onClick={() => decideMutation.mutate({ id: p.id, action: "approve" })}
                            >
                              <Check className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-status-danger hover:text-status-danger"
                              title="رفض"
                              onClick={() => setRejectTarget(p)}
                            >
                              <X className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-destructive hover:text-destructive"
                              title="حذف المعلق"
                              onClick={() => setDeleteTarget({ kind: "permissions", id: p.id, label: `إذن ${p.employeeName} — ${p.permDate}` })}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </>
                        )}
                        {p.status !== "معلقة" && <span className="text-[10px] text-muted-foreground">قرار: {p.decisionBy || "—"}</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {filtered.map((p) => (
              <Card key={p.id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold">{p.employeeName}</span>
                      <StatusPill label={p.status} tone={PERM_STATUS_TONE[p.status] ?? PERM_STATUS_TONE["معلقة"]} />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {p.permDate} · {p.kindLabel} · {p.minutes} دقيقة
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">{p.reason}</p>
                  </div>
                  {p.status === "معلقة" && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button variant="ghost" size="icon" className="size-8 text-status-done hover:text-status-done" title="اعتماد" onClick={() => decideMutation.mutate({ id: p.id, action: "approve" })}>
                        <Check className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8 text-status-danger hover:text-status-danger" title="رفض" onClick={() => setRejectTarget(p)}>
                        <X className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* نافذة طلب إذن */}
      <PermissionDialog open={editor} employeeOpts={employeeOpts} pending={saveMutation.isPending} onClose={() => setEditor(false)} onSave={(v) => saveMutation.mutate(v)} />

      {/* نافذة الرفض بقرار موثق */}
      <Dialog open={!!rejectTarget} onOpenChange={(v) => !v && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>رفض الإذن</DialogTitle>
            <DialogDescription>سبب الرفض إلزامي — يوثق مع القرار (نمط الإجازات)</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">سبب الرفض *</Label>
            <Input value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="مثال: الضغط التشغيلي في هذا التوقيت" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>تراجع</Button>
            <Button
              variant="destructive"
              disabled={!rejectNote.trim() || decideMutation.isPending}
              onClick={() => rejectTarget && decideMutation.mutate({ id: rejectTarget.id, action: "reject", decisionNote: rejectNote.trim() })}
            >
              {decideMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
              رفض موثق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PermissionDialog({
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
  onSave: (v: Record<string, unknown>) => void;
}) {
  const [form, setForm] = React.useState({ employeeId: "", permDate: todayStr(), kind: "late", minutes: 30, reason: "" });
  React.useEffect(() => {
    if (open) setForm({ employeeId: "", permDate: todayStr(), kind: "late", minutes: 30, reason: "" });
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>طلب إذن تأخير / انصراف مبكر</DialogTitle>
          <DialogDescription>الإذن المعتمد يعفي دقائقه المعلنة من الخصم الدقائقي (د3)</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">الموظف *</Label>
            <SearchableSelect value={form.employeeId} onValueChange={(v) => setForm((f) => ({ ...f, employeeId: v }))} options={employeeOpts} placeholder="اختر الموظف" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">التاريخ *</Label>
              <Input type="date" value={form.permDate} onChange={(e) => setForm((f) => ({ ...f, permDate: e.target.value }))} dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">النوع</Label>
              <SearchableSelect
                value={form.kind}
                onValueChange={(v) => setForm((f) => ({ ...f, kind: v }))}
                options={[
                  { value: "late", label: "تأخير صباحي" },
                  { value: "early", label: "انصراف مبكر" },
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">المدة (دقيقة) *</Label>
              <Input type="number" min={5} max={240} value={form.minutes} onChange={(e) => setForm((f) => ({ ...f, minutes: Number(e.target.value) }))} dir="ltr" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">العلة *</Label>
            <Input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="سبب الإذن — إلزامي" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button disabled={pending || !form.employeeId || !form.reason.trim()} onClick={() => onSave(form)}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            تسجيل الطلب
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== HR-2 — قسم نهاية الخدمة ====================

const EOS_SCENARIOS_LOCAL = [
  "انتهاء عقد",
  "استقالة",
  "فصل (م41)",
  "انصراف (م44)",
  "وفاة",
  "زواج",
  "ولادة",
  "اتفاق الطرفين",
] as const;

interface HRTermination {
  id: number;
  employeeId: number;
  employeeName: string;
  jobNumber: string;
  jobTitle: string;
  endDate: string;
  scenario: string;
  serviceYears: number;
  wageAtEnd: number;
  eosAmount: number;
  leaveEncashment: number;
  total: number;
  status: string;
  entryId: number | null;
  decidedBy: string;
  decidedAt: string;
  notes: string;
  cancelReason: string;
}

const TERM_STATUS_TONE: Record<string, { text: string; bg: string }> = {
  "محسوبة": { text: "text-status-warn", bg: "bg-status-warn-bg" },
  "مستقرة": { text: "text-status-done", bg: "bg-status-done-bg" },
};

function EosSection({
  employeeOptsActive,
  onErr,
  invalidate,
}: SectionCommonPartial & { employeeOptsActive: { value: string; label: string }[] }) {
  const { toast } = useToast();

  const listQuery = useQuery<{ terminations: HRTermination[] }>({
    queryKey: ["hr", "eos"],
    queryFn: () => apiGet<{ terminations: HRTermination[] }>("/api/hr/eos"),
  });
  const terminations = listQuery.data?.terminations ?? [];

  const [editor, setEditor] = React.useState(false);
  useAddEvent("eos", React.useCallback(() => setEditor(true), [setEditor]));

  const settleMutation = useMutation({
    mutationFn: (v: { id: number }) => apiPost<{ settled: boolean; total: number; entryNo: number }>(`/api/hr/eos/${v.id}/settle`, {}),
    onSuccess: (r) => {
      invalidate();
      toast({ title: "استقرت التسوية — الموظف مُعطّل", description: `قيد #${r.entryNo} — الإجمالي ${fmtMoney(r.total)} · الدفع عبر PV من 2160` });
    },
    onError: (e) => onErr(e, "تعذر الاستقرار"),
  });

  const cancelMutation = useMutation({
    mutationFn: (v: { id: number; reason: string }) => apiDelete(`/api/hr/eos/${v.id}?reason=${encodeURIComponent(v.reason)}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "أُلغى التوثيق المحسوب" });
    },
    onError: (e) => onErr(e, "تعذر الإلغاء"),
  });

  const [cancelTarget, setCancelTarget] = React.useState<HRTermination | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");

  return (
    <div className="space-y-3">
      <Card className="p-3 sm:p-4">
        <p className="text-xs text-muted-foreground">
          حاسبة نهاية الخدمة بقانون العمل الكويتي 6/2010: م53 كامل المكافأة (نصف شهر أول 5 سنوات + شهر كامل بعدها — سقف 18 شهرًا) · م51 سلالم الاستقالة (3/5/10) ·
          م41 الفصل للسبب = صفر · م44 الانصراف المشروع = كامل — مع بدل الإجازات غير المستهلكة (الأساسي ÷ 26). الاستقرار يقيد التسوية ويعطل الموظف — الدفع بعدها بسند PV من 2160.
        </p>
      </Card>

      {listQuery.isLoading ? (
        <SkeletonRows h="h-16" />
      ) : listQuery.isError ? (
        <Card className="p-8 text-center text-sm text-destructive">تعذر تحميل السجل — {errMessage(listQuery.error)}</Card>
      ) : terminations.length === 0 ? (
        <EmptyState icon={DoorOpen} title="لا توثيقات نهاية خدمة" hint="وثّق نهاية خدمة موظف بزر «توثيق نهاية خدمة» — تُحسب الحسبة قبل التوثيق" />
      ) : (
        <div className="space-y-2">
          {terminations.map((t) => (
            <Card key={t.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold">{t.employeeName}</span>
                    {t.jobNumber && <Badge variant="outline" className="h-5 text-[10px] tabular-nums">{t.jobNumber}</Badge>}
                    <StatusPill label={t.status} tone={TERM_STATUS_TONE[t.status] ?? TERM_STATUS_TONE["محسوبة"]} />
                    <Badge variant="outline" className="h-5 text-[10px]">{t.scenario}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground sm:grid-cols-4">
                    <span>النهاية: <span className="tabular-nums">{t.endDate}</span></span>
                    <span>الخدمة: <span className="tabular-nums">{fmtNum(t.serviceYears)} سنة</span></span>
                    <span>المكافأة: <span className="tabular-nums">{fmtMoney(t.eosAmount)}</span></span>
                    <span>بدل الإجازات: <span className="tabular-nums">{fmtMoney(t.leaveEncashment)}</span></span>
                  </div>
                  <p className="text-[11px] font-bold text-foreground">الإجمالي المستحق: <span className="tabular-nums">{fmtMoney(t.total)}</span></p>
                  {t.entryId && <p className="text-[11px] text-muted-foreground">قيد التسوية: #{t.entryId} — الدفع بسند PV من 2160</p>}
                </div>
                {t.status === "محسوبة" && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button size="sm" className="gap-1.5" onClick={() => settleMutation.mutate({ id: t.id })} disabled={settleMutation.isPending}>
                      {settleMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                      استقرار وقيد
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => setCancelTarget(t)}>
                      <X className="size-3.5" />
                      إلغاء
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <EosDialog open={editor} employeeOpts={employeeOptsActive} onClose={() => setEditor(false)} invalidate={invalidate} onErr={onErr} />

      {/* إلغاء توثيق محسوب */}
      <Dialog open={!!cancelTarget} onOpenChange={(v) => !v && setCancelTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>إلغاء التوثيق المحسوب</DialogTitle>
            <DialogDescription>التوثيق «محسوبة» بلا أثر مالي — سبب الإلغاء إلزامي</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">السبب *</Label>
            <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>تراجع</Button>
            <Button
              variant="destructive"
              disabled={!cancelReason.trim()}
              onClick={() => cancelTarget && cancelMutation.mutate({ id: cancelTarget.id, reason: cancelReason.trim() })}
            >
              إلغاء التوثيق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface EosCalcResult {
  years: number;
  fullGratuity: number;
  capped: boolean;
  fractionApplied: number;
  gratuity: number;
  leaveEncashment: number;
  total: number;
  leaveBalance: number;
}

function EosDialog({
  open,
  employeeOpts,
  onClose,
  invalidate,
  onErr,
}: {
  open: boolean;
  employeeOpts: { value: string; label: string }[];
  onClose: () => void;
  invalidate: () => void;
  onErr: (e: unknown, t: string) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = React.useState({ employeeId: "", endDate: todayStr(), scenario: "استقالة", agreementAmount: "", notes: "" });
  const [calc, setCalc] = React.useState<EosCalcResult | null>(null);

  React.useEffect(() => {
    if (open) {
      setForm({ employeeId: "", endDate: todayStr(), scenario: "استقالة", agreementAmount: "", notes: "" });
      setCalc(null);
    }
  }, [open]);

  const previewMutation = useMutation({
    mutationFn: () =>
      apiPost<{ calc: EosCalcResult }>("/api/hr/eos/preview", {
        employeeId: Number(form.employeeId),
        endDate: form.endDate,
        scenario: form.scenario,
        agreementAmount: form.scenario === "اتفاق الطرفين" && form.agreementAmount ? Number(form.agreementAmount) : undefined,
      }),
    onSuccess: (r) => setCalc(r.calc),
    onError: (e) => onErr(e, "تعذر الحساب"),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiPost("/api/hr/eos", {
        employeeId: Number(form.employeeId),
        endDate: form.endDate,
        scenario: form.scenario,
        agreementAmount: form.scenario === "اتفاق الطرفين" && form.agreementAmount ? Number(form.agreementAmount) : undefined,
        notes: form.notes,
      }),
    onSuccess: () => {
      invalidate();
      onClose();
      toast({ title: "وُثّقت نهاية الخدمة (محسوبة)", description: "راجع الحسبة ثم استقرها بقيد التسوية" });
    },
    onError: (e) => onErr(e, "تعذر التوثيق"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>توثيق نهاية خدمة</DialogTitle>
          <DialogDescription>الحسبة نقية بالقانون 6/2010 — ورصيد الإجازات يُعاد حسابه لحظة النهاية</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">الموظف *</Label>
            <SearchableSelect value={form.employeeId} onValueChange={(v) => { setForm((f) => ({ ...f, employeeId: v })); setCalc(null); }} options={employeeOpts} placeholder="اختر الموظف" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">تاريخ النهاية *</Label>
              <Input type="date" value={form.endDate} onChange={(e) => { setForm((f) => ({ ...f, endDate: e.target.value })); setCalc(null); }} dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">السيناريو *</Label>
              <SearchableSelect
                value={form.scenario}
                onValueChange={(v) => { setForm((f) => ({ ...f, scenario: v })); setCalc(null); }}
                options={EOS_SCENARIOS_LOCAL.map((s) => ({ value: s, label: s }))}
              />
            </div>
          </div>
          {form.scenario === "اتفاق الطرفين" && (
            <div className="space-y-1.5">
              <Label className="text-xs">مبلغ الاتفاق (اتركه فارغًا للكامل)</Label>
              <Input type="number" min={0} value={form.agreementAmount} onChange={(e) => { setForm((f) => ({ ...f, agreementAmount: e.target.value })); setCalc(null); }} dir="ltr" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">ملاحظات</Label>
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>

          <Button variant="outline" className="w-full gap-1.5" onClick={() => previewMutation.mutate()} disabled={!form.employeeId || previewMutation.isPending}>
            {previewMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            احسب قبل التوثيق
          </Button>

          {calc && (
            <Card className="space-y-1 bg-muted/30 p-3 text-[12px]">
              <div className="flex justify-between"><span className="text-muted-foreground">سنوات الخدمة</span><span className="font-bold tabular-nums">{fmtNum(calc.years)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">المكافأة الكاملة (م53{calc.capped ? " — ضُرب السقف" : ""})</span><span className="tabular-nums">{fmtMoney(calc.fullGratuity)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">النسبة المطبقة حسب السيناريو</span><span className="tabular-nums">{fmtNum(Math.round(calc.fractionApplied * 1000) / 10)}%</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">مكافأة مستحقة</span><span className="font-bold tabular-nums">{fmtMoney(calc.gratuity)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">بدل الإجازات (رصيد {fmtNum(calc.leaveBalance)} يوم ÷ 26)</span><span className="tabular-nums">{fmtMoney(calc.leaveEncashment)}</span></div>
              <div className="flex justify-between border-t pt-1 text-sm"><span className="font-bold">الإجمالي</span><span className="font-extrabold tabular-nums">{fmtMoney(calc.total)}</span></div>
            </Card>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button disabled={!form.employeeId || !calc || createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            توثيق (محسوبة)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== HR-2 — قسم التقارير ====================

interface EmployeeReport {
  employee: {
    id: number; name: string; jobNumber: string; employeeType: string; department: string; jobTitle: string;
    civilId: string; nationality: string; hireDate: string; phone: string; active: boolean;
    salary: number; paymentBasis: string; dailyRate: number; monthlyCostRate: number; paymentMethod: string;
  };
  annualBalance: { allowance: number; consumed: number; balance: number; probation: boolean };
  advanceRemaining: number;
  attendanceByMonth: { month: string; present: number; absent: number; justified: number; leave: number; holiday: number; lateMinutes: number; early: number }[];
  leaves: { id: number; leaveType: string; startDate: string; endDate: string; days: number; status: string; decisionNote: string }[];
  permissions: { id: number; permDate: string; kind: string; minutes: number; reason: string; status: string }[];
  payroll: { month: string; batchNo: number; batchStatus: string; baseAmount: number; absenceDeduction: number; sickDeduction: number; lateDeduction: number; advanceDeduction: number; netAmount: number }[];
  terminations: { id: number; endDate: string; scenario: string; serviceYears: number; eosAmount: number; leaveEncashment: number; total: number; status: string; entryId: number | null }[];
  // HR-3 — التكليفات وسجل تغييرات الملف (د9)
  assignments: { id: number; contractNumber: string; contractName: string; role: string; allocationPct: number; startDate: string; endDate: string; status: string }[];
  auditTrail: { id: number; field: string; fieldLabel: string; oldValue: string; newValue: string; editedBy: string; editedAt: string }[];
}

interface AttendanceMatrix {
  month: string;
  monthLabel: string;
  days: string[];
  rows: {
    employeeId: number;
    name: string;
    jobNumber: string;
    jobTitle: string;
    cells: ({ status: string; statusLabel: string; lateMinutes: number } | null)[];
    totals: { present: number; absent: number; justified: number; leave: number; holiday: number; lateMinutes: number };
  }[];
}

const MATRIX_CELL: Record<string, string> = {
  present: "bg-status-done-bg text-status-done",
  absent: "bg-status-danger-bg text-status-danger",
  justified_absent: "bg-status-warn-bg text-status-warn",
  leave: "bg-status-info-bg text-status-info",
  holiday: "bg-muted text-muted-foreground",
};

function ReportsSection({ employeeOpts, onErr }: { employeeOpts: { value: string; label: string }[]; onErr: (e: unknown, t: string) => void }) {
  const [tab, setTab] = React.useState<"employee" | "attendance">("employee");
  const [employeeId, setEmployeeId] = React.useState("");
  const [month, setMonth] = React.useState(thisMonth());

  const empQuery = useQuery<EmployeeReport>({
    queryKey: ["hr", "report-employee", employeeId],
    queryFn: () => apiGet<EmployeeReport>(`/api/hr/reports/employee?id=${employeeId}`),
    enabled: !!employeeId,
  });
  const matrixQuery = useQuery<AttendanceMatrix>({
    queryKey: ["hr", "report-attendance", month],
    queryFn: () => apiGet<AttendanceMatrix>(`/api/hr/reports/attendance?month=${month}`),
    enabled: tab === "attendance",
  });

  const r = empQuery.data;

  const print = () => window.print();

  return (
    <div className="space-y-3">
      <Card className="gap-3 p-3 sm:p-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "employee" | "attendance")}>
          <TabsList className="h-9">
            <TabsTrigger value="employee">ملف موظف</TabsTrigger>
            <TabsTrigger value="attendance">حضور شهري مجمّع</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
          {tab === "employee" ? (
            <>
              <div className="min-w-[220px] flex-1">
                <SearchableSelect value={employeeId} onValueChange={setEmployeeId} options={employeeOpts} placeholder="اختر الموظف لعرض ملفه" allowClear clearLabel="بلا اختيار" />
              </div>
              {r && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={print}>
                  <Printer className="size-3.5" />
                  طباعة
                </Button>
              )}
            </>
          ) : (
            <>
              <Label className="text-xs text-muted-foreground">الشهر</Label>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-40" dir="ltr" />
              {matrixQuery.data && matrixQuery.data.rows.length > 0 && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={print}>
                  <Printer className="size-3.5" />
                  طباعة
                </Button>
              )}
            </>
          )}
        </div>
      </Card>

      {tab === "employee" && (
        !employeeId ? (
          <EmptyState icon={ClipboardList} title="اختر موظفًا لعرض ملفه" hint="الملف يجمع البيانات والرصيد والحضور والإجازات والأذونات والمساير والسلف ونهاية الخدمة" />
        ) : empQuery.isLoading ? (
          <SkeletonRows h="h-20" />
        ) : empQuery.isError ? (
          <Card className="p-8 text-center text-sm text-destructive">تعذر تحميل التقرير — {errMessage(empQuery.error)}</Card>
        ) : !r ? null : (
          <div className="space-y-3">
            {/* بطاقة الملف */}
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-extrabold">{r.employee.name}</span>
                {r.employee.jobNumber && <Badge variant="outline" className="h-5 text-[10px] tabular-nums">{r.employee.jobNumber}</Badge>}
                <Badge variant="outline" className="h-5 text-[10px]">{r.employee.employeeType === "external" ? "خارجي" : "داخلي"}</Badge>
                <Badge variant="outline" className="h-5 text-[10px]">{r.employee.active ? "نشط" : "موقوف"}</Badge>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-muted-foreground sm:grid-cols-4">
                <span>الوظيفة: {r.employee.jobTitle || "—"}</span>
                <span>القسم: {r.employee.department || "—"}</span>
                <span>التعيين: <span className="tabular-nums">{r.employee.hireDate || "—"}</span></span>
                <span>المدني: <span className="tabular-nums">{r.employee.civilId || "—"}</span></span>
                <span>{r.employee.paymentBasis === "daily" ? "الأجر اليومي" : "الراتب الأساسي"}: <span className="tabular-nums font-bold">{fmtMoney(r.employee.paymentBasis === "daily" ? r.employee.dailyRate : r.employee.salary)}</span></span>
                <span>طريقة الدفع: {r.employee.paymentMethod || "—"}</span>
                <span>رصيد السلفة: <span className="tabular-nums font-bold">{fmtMoney(r.advanceRemaining)}</span></span>
                <span>الهاتف: <span className="tabular-nums" dir="ltr">{r.employee.phone || "—"}</span></span>
              </div>
            </Card>

            {/* الرصيد السنوي */}
            <Card className="flex flex-wrap items-center gap-x-6 gap-y-1 p-4">
              <span className="text-sm font-bold">الرصيد السنوي {r.annualBalance.probation ? "(فترة تجربة — بلا استحقاق بعد)" : ""}</span>
              <span className="text-xs text-muted-foreground">الاستحقاق: <span className="tabular-nums font-bold text-foreground">{fmtNum(r.annualBalance.allowance)}</span> يوم</span>
              <span className="text-xs text-muted-foreground">المستهلك: <span className="tabular-nums">{fmtNum(r.annualBalance.consumed)}</span></span>
              <span className="text-xs text-muted-foreground">المتبقي: <span className="tabular-nums font-bold text-foreground">{fmtNum(r.annualBalance.balance)}</span></span>
            </Card>

            {/* الحضور بالشهور */}
            <Card className="p-4">
              <p className="mb-2 text-sm font-bold">الحضور بالشهور (آخر 12)</p>
              {r.attendanceByMonth.length === 0 ? (
                <p className="text-xs text-muted-foreground">بلا سجلات حضور</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead className="bg-muted/50">
                      <tr>
                        <Th>الشهر</Th><Th>حاضر</Th><Th>غياب</Th><Th>مبرر</Th><Th>إجازة</Th><Th>عطلة</Th><Th>تأخير (د)</Th><Th>انصراف (د)</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.attendanceByMonth.map((m) => (
                        <tr key={m.month} className="border-t">
                          <td className="px-3 py-1.5 tabular-nums">{m.month}</td>
                          <td className="px-3 py-1.5 tabular-nums">{m.present}</td>
                          <td className="px-3 py-1.5 tabular-nums">{m.absent}</td>
                          <td className="px-3 py-1.5 tabular-nums">{m.justified}</td>
                          <td className="px-3 py-1.5 tabular-nums">{m.leave}</td>
                          <td className="px-3 py-1.5 tabular-nums">{m.holiday}</td>
                          <td className="px-3 py-1.5 tabular-nums">{m.lateMinutes}</td>
                          <td className="px-3 py-1.5 tabular-nums">{m.early}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* المساير */}
            <Card className="p-4">
              <p className="mb-2 text-sm font-bold">سجلات المساير (آخر 36)</p>
              {r.payroll.length === 0 ? (
                <p className="text-xs text-muted-foreground">بلا سجلات مسير</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead className="bg-muted/50">
                      <tr>
                        <Th>الشهر</Th><Th>المسير</Th><Th>الأساسي</Th><Th>غياب</Th><Th>مرضية</Th><Th>تأخير</Th><Th>سلف</Th><Th>الصافي</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.payroll.map((p, i) => (
                        <tr key={`${p.month}-${i}`} className="border-t">
                          <td className="px-3 py-1.5 tabular-nums">{p.month}</td>
                          <td className="px-3 py-1.5 tabular-nums">PR-{p.batchNo}</td>
                          <td className="px-3 py-1.5 tabular-nums">{fmtNum(p.baseAmount)}</td>
                          <td className="px-3 py-1.5 tabular-nums text-status-danger">{fmtNum(p.absenceDeduction)}</td>
                          <td className="px-3 py-1.5 tabular-nums text-status-warn">{fmtNum(p.sickDeduction)}</td>
                          <td className="px-3 py-1.5 tabular-nums text-status-warn">{fmtNum(p.lateDeduction)}</td>
                          <td className="px-3 py-1.5 tabular-nums text-status-info">{fmtNum(p.advanceDeduction)}</td>
                          <td className="px-3 py-1.5 font-bold tabular-nums">{fmtNum(p.netAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* الإجازات والأذونات */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Card className="p-4">
                <p className="mb-2 text-sm font-bold">الإجازات ({r.leaves.length})</p>
                <div className="max-h-52 space-y-1.5 overflow-y-auto">
                  {r.leaves.length === 0 ? <p className="text-xs text-muted-foreground">بلا إجازات</p> : r.leaves.map((l) => (
                    <div key={l.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-[12px]">
                      <span>{l.leaveType} — <span className="tabular-nums">{l.startDate}</span> ← <span className="tabular-nums">{l.endDate}</span> ({fmtNum(l.days)} يوم)</span>
                      <StatusPill label={l.status} tone={LEAVE_STATUS_TONE[l.status] ?? LEAVE_STATUS_TONE["معلقة"]} />
                    </div>
                  ))}
                </div>
              </Card>
              <Card className="p-4">
                <p className="mb-2 text-sm font-bold">الأذونات ({r.permissions.length})</p>
                <div className="max-h-52 space-y-1.5 overflow-y-auto">
                  {r.permissions.length === 0 ? <p className="text-xs text-muted-foreground">بلا أذونات</p> : r.permissions.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-[12px]">
                      <span className="tabular-nums">{p.permDate} · {p.kind === "late" ? "تأخير" : "انصراف"} {p.minutes}د</span>
                      <StatusPill label={p.status} tone={PERM_STATUS_TONE[p.status] ?? PERM_STATUS_TONE["معلقة"]} />
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {/* نهاية الخدمة */}
            {r.terminations.length > 0 && (
              <Card className="p-4">
                <p className="mb-2 text-sm font-bold">نهاية الخدمة</p>
                <div className="space-y-1.5">
                  {r.terminations.map((t) => (
                    <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-[12px]">
                      <span>{t.scenario} — <span className="tabular-nums">{t.endDate}</span> · {fmtNum(t.serviceYears)} سنة · الإجمالي <span className="font-bold tabular-nums">{fmtMoney(t.total)}</span></span>
                      <div className="flex items-center gap-1.5">
                        <StatusPill label={t.status} tone={TERM_STATUS_TONE[t.status] ?? TERM_STATUS_TONE["محسوبة"]} />
                        {t.entryId && <span className="text-[10px] text-muted-foreground">قيد #{t.entryId}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* HR-3 — التكليفات */}
            {r.assignments.length > 0 && (
              <Card className="p-4">
                <p className="mb-2 text-sm font-bold">التكليفات بالعقود</p>
                <div className="space-y-1.5">
                  {r.assignments.map((a) => (
                    <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-[12px]">
                      <span className="tabular-nums" dir="ltr">{a.contractNumber}</span>
                      <span className="text-muted-foreground">{a.contractName}</span>
                      <span>{a.role ? `${a.role} · ` : ""}<span className="font-bold tabular-nums">{a.allocationPct}%</span></span>
                      <span className="text-[10px] tabular-nums text-muted-foreground" dir="ltr">
                        {a.startDate || "—"} → {a.endDate || "—"} · {a.status}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  التكلفة الشهرية على الشركة: {fmtMoney(r.employee.monthlyCostRate > 0 ? r.employee.monthlyCostRate : r.employee.paymentBasis === "monthly" ? r.employee.salary : r.employee.dailyRate)}
                </p>
              </Card>
            )}

            {/* HR-3 — سجل تغييرات الملف (د9 — آخر 100 تصاعديًا) */}
            {r.auditTrail.length > 0 && (
              <Card className="p-4">
                <p className="mb-2 text-sm font-bold">سجل تغييرات الملف</p>
                <div className="space-y-1">
                  {r.auditTrail.map((l) => (
                    <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-[11px]">
                      <span className="font-bold">{l.fieldLabel}</span>
                      <span className="tabular-nums text-muted-foreground">
                        «{l.oldValue}» ← <span className="text-status-done font-bold">«{l.newValue}»</span>
                      </span>
                      <span className="text-[10px] text-muted-foreground">{l.editedBy} · {l.editedAt}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )
      )}

      {tab === "attendance" && (
        matrixQuery.isLoading ? (
          <SkeletonRows h="h-20" />
        ) : matrixQuery.isError ? (
          <Card className="p-8 text-center text-sm text-destructive">تعذر تحميل المصفوفة — {errMessage(matrixQuery.error)}</Card>
        ) : !matrixQuery.data || matrixQuery.data.rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title="بلا موظفين نشطين أو بلا سجلات لهذا الشهر" hint="المصفوفة تعرض موظفي الشل النشطين × أيام الشهر" />
        ) : (
          <Card className="overflow-x-auto p-4">
            <p className="mb-2 text-sm font-bold">مصفوفة الحضور — {matrixQuery.data.monthLabel}</p>
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50">
                <tr>
                  <Th>الموظف</Th>
                  {matrixQuery.data.days.map((d) => (
                    <th key={d} className="px-1 py-2 text-center text-[10px] tabular-nums text-muted-foreground">{d.slice(8)}</th>
                  ))}
                  <Th>ح/غ/ت</Th>
                </tr>
              </thead>
              <tbody>
                {matrixQuery.data.rows.map((row) => (
                  <tr key={row.employeeId} className="border-t">
                    <td className="whitespace-nowrap px-2 py-1.5 font-bold">{row.name}</td>
                    {row.cells.map((c, i) => (
                      <td key={i} className="px-0.5 py-1">
                        <span className={cn("flex h-6 w-6 items-center justify-center rounded text-[9px] font-bold tabular-nums", c ? MATRIX_CELL[c.status] : "bg-muted/40 text-muted-foreground/40")}>
                          {c ? (c.status === "present" ? "✓" : c.status === "absent" ? "✗" : c.status === "leave" ? "إ" : c.status === "holiday" ? "ع" : "م") : "·"}
                        </span>
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-2 py-1.5 text-[10px] tabular-nums text-muted-foreground">
                      {row.totals.present}/{row.totals.absent}/{row.totals.justified}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
              <span>✓ حاضر</span><span>✗ غياب غير مبرر</span><span>م غياب مبرر</span><span>إ إجازة</span><span>ع عطلة</span><span>· بلا سجل</span>
            </div>
          </Card>
        )
      )}
    </div>
  );
}
