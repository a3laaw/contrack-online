"use client";

/**
 * ConsultingView.tsx — شاشة موديول «الاستشارات الهندسية» (خطة الأنشطة):
 * أربعة أقسام يملكها تبويب الشل «الاستشارات» (nav-structure → section):
 *   الفريق الهندسي · إسناد المشاريع (الربط HR↔العقود) · ساعات العمل · الإجازات
 * + رادار المواعيد (NOVA 4 — سلوتس مشتقة من إعدادات الدوام)
 * + بطاقات مؤشرات وتنبيه تراخيص (ملخص /api/consulting/summary) تظهر في كل الأقسام.
 * الموديول يظهر حصرًا للشركات التي فعّلته (navModules) — والإيقاف يخفي التبويب كله (تجميد).
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeAlert,
  CalendarDays,
  Check,
  Clock,
  FileStack,
  Loader2,
  Mail,
  Network,
  Pencil,
  Phone,
  Plus,
  Radar,
  Search,
  Timer,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ApiError, api as apiLite, apiDelete, apiGet, apiPatch, apiPost, apiPut, type ContractOption } from "./api";
import { errMessage, type User } from "./contrack-types";
import { cn } from "@/lib/utils";
import { SearchableSelect } from "./SearchableSelect";
import {
  REVISION_PENDING,
  canDecide,
  canDelete,
  canEdit,
} from "@/lib/consulting-revision-core";
import {
  ASSIGNMENT_ROLES,
  ENGINEER_SPECIALTIES,
  ENGINEER_STATUSES,
  LEAVE_TYPES,
  TIMESHEET_ACTIVITIES,
  licenseDaysLeft,
} from "@/lib/consulting-constants";
import { RADAR_SLOT_MINUTES } from "@/lib/consulting-radar-core";

// ==================== أنواع الـAPI ====================

interface EngineerItem {
  id: number;
  name: string;
  jobTitle: string;
  specialty: string;
  civilId: string;
  nationality: string;
  phone: string;
  email: string;
  licenseNo: string;
  licenseExpiry: string;
  hireDate: string;
  baseSalary: number;
  status: string;
  notes: string;
  assignmentsCount: number;
  timesheetsCount: number;
  leavesCount: number;
}

interface AssignmentItem {
  id: number;
  engineerId: number;
  engineerName: string;
  engineerSpecialty: string;
  contractId: number;
  contractNumber: string;
  contractName: string;
  contractStatus: string;
  customerName: string;
  role: string;
  allocationPct: number;
  startDate: string;
  endDate: string;
  status: string;
  notes: string;
}

interface TimesheetItem {
  id: number;
  engineerId: number;
  engineerName: string;
  contractId: number | null;
  contractNumber: string;
  contractName: string;
  customerName: string;
  workDate: string;
  hours: number;
  activity: string;
  notes: string;
}

interface TimesheetTotals {
  totalHours: number;
  byEngineer: { engineerId: number; name: string; hours: number }[];
  byContract: { contractId: number; label: string; hours: number }[];
  byActivity: { activity: string; hours: number }[];
}

interface LeaveItem {
  id: number;
  engineerId: number;
  engineerName: string;
  engineerSpecialty: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  reason: string;
  decisionBy: string;
  decisionAt: string;
  decisionNote: string;
}

interface SummaryResponse {
  kpis: {
    teamTotal: number;
    teamActive: number;
    monthHours: number;
    activeAssignments: number;
    pendingLeaves: number;
    onVacationNow: number;
  };
  expiring: {
    id: number;
    name: string;
    licenseNo: string;
    licenseExpiry: string;
    daysLeft: number;
    expired: boolean;
  }[];
}

interface RevisionItem {
  id: number;
  contractId: number;
  contractNumber: string;
  contractName: string;
  customerName: string;
  title: string;
  revNo: number;
  status: string;
  engineerId: number | null;
  engineerName: string | null;
  submittedAt: string;
  decidedAt: string;
  decidedBy: string;
  decisionNote: string;
  notes: string;
}

export type ConsultingSection = "team" | "assignments" | "timesheets" | "revisions" | "leaves" | "radar";

interface ConsultingViewProps {
  user: User;
  onAuthError: () => void;
  section: ConsultingSection;
  onSectionChange: (s: ConsultingSection) => void;
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

const ENGINEER_STATUS_TONE: Record<string, { text: string; bg: string }> = {
  "نشط": { text: "text-status-done", bg: "bg-status-done-bg" },
  "في إجازة": { text: "text-status-warn", bg: "bg-status-warn-bg" },
  "موقوف": { text: "text-status-danger", bg: "bg-status-danger-bg" },
  "منتهي الخدمة": { text: "text-muted-foreground", bg: "bg-muted" },
};

const LEAVE_STATUS_TONE: Record<string, { text: string; bg: string }> = {
  "معلقة": { text: "text-status-warn", bg: "bg-status-warn-bg" },
  "معتمدة": { text: "text-status-done", bg: "bg-status-done-bg" },
  "مرفوضة": { text: "text-status-danger", bg: "bg-status-danger-bg" },
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
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
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

const SECTION_META: { key: ConsultingSection; label: string }[] = [
  { key: "team", label: "الفريق الهندسي" },
  { key: "assignments", label: "إسناد المشاريع" },
  { key: "timesheets", label: "ساعات العمل" },
  { key: "revisions", label: "مراجعات المخططات" },
  { key: "leaves", label: "الإجازات" },
  { key: "radar", label: "رادار المواعيد" },
];

// ==================== الشاشة الرئيسية ====================

export function ConsultingView({ user, onAuthError, section, onSectionChange }: ConsultingViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  // مدة الخانة في الرادار تُضبط للمدير فقط (كإعدادات الزيارات)
  const isAdmin = user.role === "admin" || user.role === "developer";

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["consulting"] });
  }, [qc]);

  const onErr = React.useCallback(
    (e: unknown, title: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title, description: errMessage(e) });
    },
    [onAuthError, toast]
  );

  // ===== البيانات =====
  const summaryQuery = useQuery<SummaryResponse>({
    queryKey: ["consulting", "summary"],
    queryFn: () => apiGet<SummaryResponse>("/api/consulting/summary"),
  });
  const teamQuery = useQuery<{ engineers: EngineerItem[] }>({
    queryKey: ["consulting", "team"],
    queryFn: () => apiGet<{ engineers: EngineerItem[] }>("/api/consulting/team"),
  });
  const engineers: EngineerItem[] = teamQuery.data?.engineers ?? [];

  // خيارات العقود للاختيار (SearchableSelect) — من نهاية العقود الجاهزة
  const [contractOptions, setContractOptions] = React.useState<ContractOption[]>([]);
  React.useEffect(() => {
    let alive = true;
    apiLite
      .contracts()
      .then((rows) => alive && setContractOptions(rows))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const contractOpts = React.useMemo(
    () =>
      contractOptions.map((c) => ({
        value: String(c.id),
        label: `${c.contractNumber} — ${c.contractName || c.contractType}${c.customerName ? ` (${c.customerName})` : ""}`,
      })),
    [contractOptions]
  );
  const engineerOpts = React.useMemo(
    () =>
      engineers
        .filter((e) => e.status !== "منتهي الخدمة")
        .map((e) => ({ value: String(e.id), label: e.specialty ? `${e.name} — ${e.specialty}` : e.name })),
    [engineers]
  );

  // ===== نافذة التأكيد الموحدة للحذف =====
  const [deleteTarget, setDeleteTarget] = React.useState<{ kind: string; id: number; label: string } | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (v: { kind: string; id: number }) => apiDelete(`/api/consulting/${v.kind}/${v.id}`),
    onSuccess: (_res, v) => {
      setDeleteTarget(null);
      invalidate();
      toast({ title: "تم الحذف بنجاح", description: LABELS_DELETE[v.kind] || "" });
    },
    onError: (e) => onErr(e, "تعذر الحذف"),
  });

  const kpis = summaryQuery.data?.kpis;
  const expiring = summaryQuery.data?.expiring ?? [];

  return (
    <div className="space-y-4">
      {/* العنوان والإضافة حسب القسم */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold tracking-tight sm:text-xl">الاستشارات الهندسية</h1>
          <p className="text-xs text-muted-foreground">
            الفريق بتخصصاتهم وتراخيصهم · إسنادهم للمشاريع · ساعاتهم على المخططات والإشراف · الإجازات · رادار المواعيد
          </p>
        </div>
        <SectionAction section={section} engineersReady={engineers.length > 0} onNoEngineers={() => onSectionChange("team")} />
      </div>

      {/* المؤشرات */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summaryQuery.isLoading ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[76px] w-full" />)
        ) : (
          <>
            <KpiCard
              icon={UsersRound}
              label="الفريق الهندسي"
              value={`${kpis?.teamActive ?? 0} نشط`}
              sub={`من إجمالي ${kpis?.teamTotal ?? 0}`}
              tone="text-status-done"
            />
            <KpiCard icon={Timer} label="ساعات هذا الشهر" value={String(kpis?.monthHours ?? 0)} sub="مجموع الساعات المسجلة" />
            <KpiCard
              icon={Network}
              label="إسنادات سارية"
              value={String(kpis?.activeAssignments ?? 0)}
              sub="مهندسون مرتبطون بمشاريع"
              tone="text-status-info"
            />
            <KpiCard
              icon={CalendarDays}
              label="إجازات معلقة"
              value={String(kpis?.pendingLeaves ?? 0)}
              sub={(kpis?.onVacationNow ?? 0) > 0 ? `في إجازة الآن: ${kpis?.onVacationNow}` : "بلا طلبات بانتظار القرار"}
              tone={(kpis?.pendingLeaves ?? 0) > 0 ? "text-status-warn" : undefined}
            />
          </>
        )}
      </div>

      {/* تنبيه التراخيص */}
      {expiring.length > 0 && (
        <Card className="border-status-warn/40 bg-status-warn-bg/50 p-4">
          <div className="flex items-start gap-3">
            <BadgeAlert className="mt-0.5 size-5 shrink-0 text-status-warn" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-sm font-bold text-status-warn">تراخيص تحتاج انتباهًا</p>
              <div className="flex flex-wrap gap-1.5">
                {expiring.slice(0, 8).map((e) => (
                  <Badge key={e.id} variant="outline" className={cn("gap-1 text-[11px]", e.expired ? "border-status-danger/40 text-status-danger" : "text-status-warn")}>
                    {e.name}
                    <span className="tabular-nums opacity-80">
                      {e.expired ? "منتهٍ" : e.daysLeft === 0 ? "ينتهي اليوم" : `باقي ${e.daysLeft} يوم`}
                    </span>
                  </Badge>
                ))}
                {expiring.length > 8 && (
                  <Badge variant="outline" className="text-[11px] text-muted-foreground">
                    +{expiring.length - 8} أخرى
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                عضوية/ترخيص المهندس قارب الانتهاء — حدّثه من شاشة الفريق الهندسي
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* تبويبات الأقسام (مرآة الشل للتنقل السريع داخل الشاشة) */}
      <Tabs value={section} onValueChange={(v) => onSectionChange(v as ConsultingSection)}>
        <TabsList className="h-9 w-full justify-start overflow-x-auto sm:w-auto">
          {SECTION_META.map((s) => (
            <TabsTrigger key={s.key} value={s.key}>
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
          onAuthError={onAuthError}
          invalidate={invalidate}
          setDeleteTarget={setDeleteTarget}
        />
      )}
      {section === "assignments" && (
        <AssignmentsSection
          engineerOpts={engineerOpts}
          contractOpts={contractOpts}
          onErr={onErr}
          onAuthError={onAuthError}
          invalidate={invalidate}
          setDeleteTarget={setDeleteTarget}
        />
      )}
      {section === "timesheets" && (
        <TimesheetsSection
          engineerOpts={engineerOpts}
          contractOpts={contractOpts}
          onErr={onErr}
          onAuthError={onAuthError}
          invalidate={invalidate}
          setDeleteTarget={setDeleteTarget}
        />
      )}
      {section === "revisions" && (
        <RevisionsSection
          engineerOpts={engineerOpts}
          contractOpts={contractOpts}
          onErr={onErr}
          onAuthError={onAuthError}
          invalidate={invalidate}
          setDeleteTarget={setDeleteTarget}
        />
      )}
      {section === "leaves" && (
        <LeavesSection
          engineerOpts={engineerOpts}
          onErr={onErr}
          onAuthError={onAuthError}
          invalidate={invalidate}
          setDeleteTarget={setDeleteTarget}
        />
      )}
      {section === "radar" && (
        <RadarSection
          isAdmin={isAdmin}
          contractOpts={contractOpts}
          onErr={onErr}
          onAuthError={onAuthError}
          invalidate={invalidate}
          setDeleteTarget={setDeleteTarget}
        />
      )}

      {/* تأكيد الحذف الموحد */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-destructive">تأكيد الحذف</DialogTitle>
            <DialogDescription>
              سيُحذف «{deleteTarget?.label}» نهائيًا{deleteTarget?.kind === "engineer" ? " مع إسناداته وساعاته وإجازاته" : ""}.
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
  team: "حُذف المهندس",
  assignments: "حُذف الإسناد",
  timesheets: "حُذف سجل الساعات",
  revisions: "حُذفت دورة المراجعة",
  leaves: "حُذف طلب الإجازة",
};

/** زر الإضافة أعلى الشاشة — يفتح نافذة القسم المعني عبر حدث مخصص بسيط */
function SectionAction({
  section,
  engineersReady,
  onNoEngineers,
}: {
  section: ConsultingSection;
  engineersReady: boolean;
  onNoEngineers: () => void;
}) {
  const labels: Record<ConsultingSection, string> = {
    team: "مهندس جديد",
    assignments: "إسناد جديد",
    timesheets: "تسجيل ساعات",
    revisions: "دورة مراجعة جديدة",
    leaves: "طلب إجازة",
    radar: "حجز موعد",
  };
  return (
    <Button
      onClick={() => {
        if ((section === "assignments" || section === "timesheets" || section === "leaves" || section === "radar") && !engineersReady) {
          onNoEngineers();
          return;
        }
        window.dispatchEvent(new CustomEvent("consulting-add", { detail: section }));
      }}
      className="gap-1.5"
    >
      <Plus className="size-4" />
      {labels[section]}
    </Button>
  );
}

/** يفتح نافذة القسم عند إطلاق حدث «consulting-add» — حالة كل قسم ذاتية */
function useAddEvent(section: ConsultingSection, onOpen: () => void) {
  React.useEffect(() => {
    const h = (e: Event) => {
      if ((e as CustomEvent).detail === section) onOpen();
    };
    window.addEventListener("consulting-add", h);
    return () => window.removeEventListener("consulting-add", h);
  }, [section, onOpen]);
}

// ==================== قسم الفريق الهندسي ====================

interface SectionCommon {
  onErr: (e: unknown, title: string) => void;
  onAuthError: () => void;
  invalidate: () => void;
  setDeleteTarget: (v: { kind: string; id: number; label: string } | null) => void;
}

function TeamSection({
  teamQuery,
  onErr,
  onAuthError,
  invalidate,
  setDeleteTarget,
}: SectionCommon & { teamQuery: { data?: { engineers: EngineerItem[] }; isLoading: boolean; isError: boolean; error: unknown } }) {
  const { toast } = useToast();
  const engineers = teamQuery.data?.engineers ?? [];

  const [tab, setTab] = React.useState<string>("الكل");
  const [q, setQ] = React.useState("");

  const filtered = React.useMemo(() => {
    const needle = normSearch(q.trim());
    return engineers.filter((e) => {
      if (tab !== "الكل" && e.status !== tab) return false;
      if (needle && !normSearch(`${e.name} ${e.jobTitle} ${e.specialty} ${e.phone} ${e.civilId} ${e.licenseNo}`).includes(needle)) return false;
      return true;
    });
  }, [engineers, tab, q]);

  // ===== نافذة الإضافة/التعديل =====
  const [editor, setEditor] = React.useState<{ editing: EngineerItem | null } | null>(null);
  useAddEvent("team", React.useCallback(() => setEditor({ editing: null }), []));

  const saveMutation = useMutation({
    mutationFn: (v: { id?: number; data: Record<string, unknown> }) =>
      v.id ? apiPatch(`/api/consulting/team/${v.id}`, v.data) : apiPost("/api/consulting/team", v.data),
    onSuccess: (_r, v) => {
      setEditor(null);
      invalidate();
      toast({ title: v.id ? "حُدّثت بيانات المهندس" : "أُضيف المهندس للفريق" });
    },
    onError: (e) => onErr(e, "تعذر الحفظ"),
  });

  const statusCount = (s: string) => engineers.filter((e) => e.status === s).length;

  return (
    <div className="space-y-3">
      {/* الفلاتر */}
      <Card className="gap-3 p-3 sm:p-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-9 w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="الكل">الكل ({engineers.length})</TabsTrigger>
            {ENGINEER_STATUSES.map((s) => (
              <TabsTrigger key={s} value={s}>
                {s} ({statusCount(s)})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالاسم/التخصص/الهاتف/الرقم المدني/الترخيص…" className="ps-8" />
        </div>
      </Card>

      {/* القائمة */}
      {teamQuery.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : teamQuery.isError ? (
        <Card className="p-8 text-center text-sm text-destructive">تعذر تحميل الفريق — {errMessage(teamQuery.error)}</Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title={engineers.length === 0 ? "لا يوجد مهندسون بعد" : "لا نتائج مطابقة للفلاتر"}
          hint={engineers.length === 0 ? "ابدأ بإضافة أول مهندس بزر «مهندس جديد»" : "جرّب تعديل البحث أو تبويب الحالة"}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((e) => {
            const tone = ENGINEER_STATUS_TONE[e.status] || ENGINEER_STATUS_TONE["نشط"];
            const daysLeft = e.licenseExpiry ? licenseDaysLeft(e.licenseExpiry) : Number.MAX_SAFE_INTEGER;
            const licenseWarn = daysLeft <= 45;
            return (
              <Card key={e.id} className="p-3 sm:p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-primary-soft-foreground">
                    {e.name.trim().charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold">{e.name}</span>
                      {e.jobTitle && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{e.jobTitle}</Badge>}
                      {e.specialty && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{e.specialty}</Badge>}
                      <StatusPill label={e.status} tone={tone} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      {e.phone && (
                        <span className="inline-flex items-center gap-1" dir="ltr">
                          <Phone className="size-3" />
                          {e.phone}
                        </span>
                      )}
                      {e.email && (
                        <span className="inline-flex items-center gap-1" dir="ltr">
                          <Mail className="size-3" />
                          {e.email}
                        </span>
                      )}
                      {e.civilId && (
                        <span className="tabular-nums" dir="ltr">
                          رقم مدني: {e.civilId}
                        </span>
                      )}
                      {e.licenseNo && (
                        <span className={cn("inline-flex items-center gap-1", licenseWarn && "font-semibold text-status-warn")}>
                          ترخيص: {e.licenseNo}
                          {e.licenseExpiry && (
                            <span className="tabular-nums">
                              — ينتهي {e.licenseExpiry}
                              {licenseWarn && (daysLeft < 0 ? " (منتهٍ)" : daysLeft === 0 ? " (اليوم)" : ` (${daysLeft} يوم)`)}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">إسنادات: {e.assignmentsCount}</Badge>
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">ساعات: {e.timesheetsCount}</Badge>
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">إجازات: {e.leavesCount}</Badge>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" title="تعديل" onClick={() => setEditor({ editing: e })}>
                      <Pencil className="size-4" />
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
            );
          })}
        </div>
      )}

      {/* نافذة إضافة/تعديل مهندس */}
      <EngineerDialog
        open={!!editor}
        editing={editor?.editing ?? null}
        pending={saveMutation.isPending}
        onClose={() => setEditor(null)}
        onSave={(data) => saveMutation.mutate({ id: editor?.editing?.id, data })}
      />
    </div>
  );
}

// ==================== نافذة المهندس (إضافة/تعديل) ====================

function EngineerDialog({
  open,
  editing,
  pending,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: EngineerItem | null;
  pending: boolean;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
}) {
  const [form, setForm] = React.useState({
    name: "",
    jobTitle: "",
    specialty: "",
    civilId: "",
    nationality: "",
    phone: "",
    email: "",
    licenseNo: "",
    licenseExpiry: "",
    hireDate: "",
    baseSalary: "",
    status: "نشط",
    notes: "",
  });

  React.useEffect(() => {
    if (open) {
      setForm({
        name: editing?.name ?? "",
        jobTitle: editing?.jobTitle ?? "",
        specialty: editing?.specialty ?? "",
        civilId: editing?.civilId ?? "",
        nationality: editing?.nationality ?? "",
        phone: editing?.phone ?? "",
        email: editing?.email ?? "",
        licenseNo: editing?.licenseNo ?? "",
        licenseExpiry: editing?.licenseExpiry ?? "",
        hireDate: editing?.hireDate ?? "",
        baseSalary: editing?.baseSalary ? String(editing.baseSalary) : "",
        status: editing?.status ?? "نشط",
        notes: editing?.notes ?? "",
      });
    }
  }, [open, editing]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = () => {
    onSave({
      name: form.name,
      jobTitle: form.jobTitle,
      specialty: form.specialty,
      civilId: form.civilId,
      nationality: form.nationality,
      phone: form.phone,
      email: form.email,
      licenseNo: form.licenseNo,
      licenseExpiry: form.licenseExpiry,
      hireDate: form.hireDate,
      baseSalary: form.baseSalary === "" ? 0 : Number(form.baseSalary),
      status: form.status,
      notes: form.notes,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "تعديل مهندس" : "مهندس جديد"}</DialogTitle>
          <DialogDescription>الاسم إلزامي — والبقية تُكمل لاحقًا من نفس النافذة</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>الاسم *</Label>
            <Input value={form.name} onChange={set("name")} placeholder="الاسم الكامل" />
          </div>
          <div className="space-y-1.5">
            <Label>المسمى الوظيفي</Label>
            <Input value={form.jobTitle} onChange={set("jobTitle")} placeholder="مدير مشروع / مهندس تصميم…" />
          </div>
          <div className="space-y-1.5">
            <Label>التخصص الهندسي</Label>
            <SearchableSelect
              value={form.specialty}
              onValueChange={(v) => setForm((f) => ({ ...f, specialty: v }))}
              options={ENGINEER_SPECIALTIES.map((s) => ({ value: s, label: s }))}
              placeholder="اختر التخصص"
              allowClear
            />
          </div>
          <div className="space-y-1.5">
            <Label>الرقم المدني</Label>
            <Input value={form.civilId} onChange={set("civilId")} placeholder="10 أرقام" dir="ltr" inputMode="numeric" />
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
            <Label>البريد الإلكتروني</Label>
            <Input value={form.email} onChange={set("email")} dir="ltr" inputMode="email" />
          </div>
          <div className="space-y-1.5">
            <Label>رقم العضوية/الترخيص المهني</Label>
            <Input value={form.licenseNo} onChange={set("licenseNo")} dir="ltr" />
          </div>
          <div className="space-y-1.5">
            <Label>انتهاء الترخيص</Label>
            <Input type="date" value={form.licenseExpiry} onChange={set("licenseExpiry")} />
          </div>
          <div className="space-y-1.5">
            <Label>تاريخ التعيين</Label>
            <Input type="date" value={form.hireDate} onChange={set("hireDate")} />
          </div>
          <div className="space-y-1.5">
            <Label>الراتب الأساسي (استرشادي)</Label>
            <Input type="number" min="0" step="0.001" value={form.baseSalary} onChange={set("baseSalary")} dir="ltr" />
          </div>
          <div className="space-y-1.5">
            <Label>الحالة</Label>
            <SearchableSelect
              value={form.status}
              onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
              options={ENGINEER_STATUSES.map((s) => ({ value: s, label: s }))}
              placeholder="اختر الحالة"
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
          <Button onClick={submit} disabled={pending || !form.name.trim()}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {editing ? "حفظ التعديلات" : "إضافة المهندس"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== قسم إسناد المشاريع ====================

function AssignmentsSection({
  engineerOpts,
  contractOpts,
  onErr,
  invalidate,
  setDeleteTarget,
}: SectionCommon & { engineerOpts: { value: string; label: string }[]; contractOpts: { value: string; label: string }[] }) {
  const { toast } = useToast();

  const listQuery = useQuery<{ assignments: AssignmentItem[] }>({
    queryKey: ["consulting", "assignments"],
    queryFn: () => apiGet<{ assignments: AssignmentItem[] }>("/api/consulting/assignments"),
  });
  const assignments = listQuery.data?.assignments ?? [];

  const [tab, setTab] = React.useState<string>("الكل");
  const [q, setQ] = React.useState("");

  const filtered = React.useMemo(() => {
    const needle = normSearch(q.trim());
    return assignments.filter((a) => {
      if (tab !== "الكل" && a.status !== tab) return false;
      if (needle && !normSearch(`${a.engineerName} ${a.contractNumber} ${a.contractName} ${a.customerName} ${a.role}`).includes(needle)) return false;
      return true;
    });
  }, [assignments, tab, q]);

  const [editor, setEditor] = React.useState<{ editing: AssignmentItem | null } | null>(null);
  useAddEvent("assignments", React.useCallback(() => setEditor({ editing: null }), []));

  const saveMutation = useMutation({
    mutationFn: (v: { id?: number; data: Record<string, unknown> }) =>
      v.id ? apiPatch(`/api/consulting/assignments/${v.id}`, v.data) : apiPost("/api/consulting/assignments", v.data),
    onSuccess: (_r, v) => {
      setEditor(null);
      invalidate();
      toast({ title: v.id ? "حُدّث الإسناد" : "أُسند المهندس للمشروع" });
    },
    onError: (e) => onErr(e, "تعذر الحفظ"),
  });

  const endMutation = useMutation({
    mutationFn: (id: number) => apiPatch(`/api/consulting/assignments/${id}`, { status: "منتهية" }),
    onSuccess: () => {
      invalidate();
      toast({ title: "انتهى الإسناد", description: "بقيت ساعات المهندس محفوظة على المشروع" });
    },
    onError: (e) => onErr(e, "تعذر إنهاء الإسناد"),
  });

  const activeCount = assignments.filter((a) => a.status === "سارية").length;

  return (
    <div className="space-y-3">
      <Card className="gap-3 p-3 sm:p-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-9 w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="الكل">الكل ({assignments.length})</TabsTrigger>
            <TabsTrigger value="سارية">سارية ({activeCount})</TabsTrigger>
            <TabsTrigger value="منتهية">منتهية ({assignments.length - activeCount})</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالمهندس/العقد/العميل/الدور…" className="ps-8" />
        </div>
      </Card>

      {listQuery.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : listQuery.isError ? (
        <Card className="p-8 text-center text-sm text-destructive">تعذر تحميل الإسنادات — {errMessage(listQuery.error)}</Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Network}
          title={assignments.length === 0 ? "لا إسنادات بعد" : "لا نتائج مطابقة للفلاتر"}
          hint={assignments.length === 0 ? "اربط مهندسيك بالمشاريع بزر «إسناد جديد»" : "جرّب تعديل البحث أو تبويب الحالة"}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((a) => (
            <Card key={a.id} className={cn("p-3 sm:p-4", a.status === "منتهية" && "opacity-70")}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
                  <Network className="size-4" />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold">{a.engineerName}</span>
                    {a.role && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{a.role}</Badge>}
                    {a.allocationPct > 0 && (
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums">
                        إخصاص {a.allocationPct}%
                      </Badge>
                    )}
                    <StatusPill label={a.status} tone={a.status === "سارية" ? { text: "text-status-info", bg: "bg-status-info-bg" } : { text: "text-muted-foreground", bg: "bg-muted" }} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <span dir="ltr" className="font-semibold">{a.contractNumber}</span>
                    {a.contractName ? ` — ${a.contractName}` : ""}
                    {a.customerName ? ` · ${a.customerName}` : ""}
                  </p>
                  {(a.startDate || a.endDate) && (
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {a.startDate || "…"} ← {a.endDate || "مفتوح"}
                    </p>
                  )}
                  {a.notes && <p className="line-clamp-1 text-[11px] text-muted-foreground">{a.notes}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {a.status === "سارية" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-status-done hover:text-status-done"
                      title="إنهاء الإسناد"
                      disabled={endMutation.isPending}
                      onClick={() => endMutation.mutate(a.id)}
                    >
                      <Check className="size-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" title="تعديل" onClick={() => setEditor({ editing: a })}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive hover:text-destructive"
                    title="حذف"
                    onClick={() => setDeleteTarget({ kind: "assignments", id: a.id, label: `${a.engineerName} ← ${a.contractNumber}` })}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <AssignmentDialog
        open={!!editor}
        editing={editor?.editing ?? null}
        engineerOpts={engineerOpts}
        contractOpts={contractOpts}
        pending={saveMutation.isPending}
        onClose={() => setEditor(null)}
        onSave={(data) => saveMutation.mutate({ id: editor?.editing?.id, data })}
      />
    </div>
  );
}

function AssignmentDialog({
  open,
  editing,
  engineerOpts,
  contractOpts,
  pending,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: AssignmentItem | null;
  engineerOpts: { value: string; label: string }[];
  contractOpts: { value: string; label: string }[];
  pending: boolean;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
}) {
  const [form, setForm] = React.useState({
    engineerId: "",
    contractId: "",
    role: "",
    allocationPct: "",
    startDate: "",
    endDate: "",
    notes: "",
  });

  React.useEffect(() => {
    if (open) {
      setForm({
        engineerId: editing ? String(editing.engineerId) : "",
        contractId: editing ? String(editing.contractId) : "",
        role: editing?.role ?? "",
        allocationPct: editing?.allocationPct ? String(editing.allocationPct) : "",
        startDate: editing?.startDate ?? "",
        endDate: editing?.endDate ?? "",
        notes: editing?.notes ?? "",
      });
    }
  }, [open, editing]);

  const submit = () => {
    onSave({
      engineerId: Number(form.engineerId) || 0,
      contractId: Number(form.contractId) || 0,
      role: form.role,
      allocationPct: form.allocationPct === "" ? 0 : Number(form.allocationPct),
      startDate: form.startDate,
      endDate: form.endDate,
      notes: form.notes,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "تعديل إسناد" : "إسناد مهندس لمشروع"}</DialogTitle>
          <DialogDescription>نقطة الربط بين الفريق الهندسي والعقود — تظهر الساعات على المشروع</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>المهندس *</Label>
            <SearchableSelect
              value={form.engineerId}
              onValueChange={(v) => setForm((f) => ({ ...f, engineerId: v }))}
              options={engineerOpts}
              placeholder="اختر المهندس"
              searchPlaceholder="ابحث بالاسم…"
            />
          </div>
          <div className="space-y-1.5">
            <Label>العقد/المشروع *</Label>
            <SearchableSelect
              value={form.contractId}
              onValueChange={(v) => setForm((f) => ({ ...f, contractId: v }))}
              options={contractOpts}
              placeholder="اختر العقد"
              searchPlaceholder="ابحث برقم/اسم العقد…"
            />
          </div>
          <div className="space-y-1.5">
            <Label>الدور في المشروع</Label>
            <SearchableSelect
              value={form.role}
              onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}
              options={ASSIGNMENT_ROLES.map((r) => ({ value: r, label: r }))}
              placeholder="اختر الدور"
              allowClear
            />
          </div>
          <div className="space-y-1.5">
            <Label>نسبة الإخصاص %</Label>
            <Input type="number" min="0" max="100" step="5" value={form.allocationPct} onChange={(e) => setForm((f) => ({ ...f, allocationPct: e.target.value }))} dir="ltr" placeholder="مثال: 50" />
          </div>
          <div className="space-y-1.5">
            <Label>من تاريخ</Label>
            <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>إلى تاريخ</Label>
            <Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>ملاحظات</Label>
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="اختياري" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            إلغاء
          </Button>
          <Button onClick={submit} disabled={pending || !form.engineerId || !form.contractId}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {editing ? "حفظ التعديلات" : "إسناد"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== قسم ساعات العمل ====================

function TimesheetsSection({
  engineerOpts,
  contractOpts,
  onErr,
  invalidate,
  setDeleteTarget,
}: SectionCommon & { engineerOpts: { value: string; label: string }[]; contractOpts: { value: string; label: string }[] }) {
  const { toast } = useToast();

  const [month, setMonth] = React.useState(thisMonth());
  const [engineerFilter, setEngineerFilter] = React.useState("");
  const [q, setQ] = React.useState("");

  const listQuery = useQuery<{ entries: TimesheetItem[]; totals: TimesheetTotals }>({
    queryKey: ["consulting", "timesheets", month, engineerFilter],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (month) sp.set("month", month);
      if (engineerFilter) sp.set("engineerId", engineerFilter);
      const qs = sp.toString();
      return apiGet<{ entries: TimesheetItem[]; totals: TimesheetTotals }>(`/api/consulting/timesheets${qs ? `?${qs}` : ""}`);
    },
  });
  const entries = listQuery.data?.entries ?? [];
  const totals = listQuery.data?.totals;

  const filtered = React.useMemo(() => {
    const needle = normSearch(q.trim());
    if (!needle) return entries;
    return entries.filter((t) => normSearch(`${t.engineerName} ${t.contractNumber} ${t.contractName} ${t.activity} ${t.notes}`).includes(needle));
  }, [entries, q]);

  const [editor, setEditor] = React.useState<{ editing: TimesheetItem | null } | null>(null);
  useAddEvent("timesheets", React.useCallback(() => setEditor({ editing: null }), []));

  const saveMutation = useMutation({
    mutationFn: (v: { id?: number; data: Record<string, unknown> }) =>
      v.id ? apiPatch(`/api/consulting/timesheets/${v.id}`, v.data) : apiPost("/api/consulting/timesheets", v.data),
    onSuccess: (_r, v) => {
      setEditor(null);
      invalidate();
      toast({ title: v.id ? "حُدّث سجل الساعات" : "سُجلت الساعات" });
    },
    onError: (e) => onErr(e, "تعذر الحفظ"),
  });

  return (
    <div className="space-y-3">
      {/* الفلاتر + المجاميع */}
      <Card className="gap-3 p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr]">
          <div className="flex items-center gap-1.5">
            <Label className="shrink-0 text-xs text-muted-foreground">الشهر</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-[160px]" />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_220px]">
            <div className="relative">
              <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالمهندس/العقد/النشاط…" className="ps-8" />
            </div>
            <SearchableSelect
              value={engineerFilter}
              onValueChange={setEngineerFilter}
              options={engineerOpts}
              placeholder="كل المهندسين"
              allowClear
              clearLabel="إظهار الكل"
            />
          </div>
        </div>
        {totals && (
          <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
            <Badge className="h-6 gap-1 bg-primary-soft px-2 text-[11px] text-primary-soft-foreground">
              <Clock className="size-3" />
              المجموع: <span className="tabular-nums font-bold">{totals.totalHours}</span> ساعة
            </Badge>
            {totals.byActivity.slice(0, 5).map((a) => (
              <Badge key={a.activity} variant="outline" className="h-6 gap-1 text-[11px] tabular-nums">
                {a.activity}: {a.hours}
              </Badge>
            ))}
          </div>
        )}
      </Card>

      {/* توزيع الساعات على الفريق */}
      {totals && totals.byEngineer.length > 0 && (
        <Card className="p-3 sm:p-4">
          <p className="mb-2 text-xs font-bold text-muted-foreground">توزيع الساعات على الفريق{month ? ` — ${month}` : ""}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {totals.byEngineer.slice(0, 9).map((e) => {
              const pct = totals.totalHours > 0 ? Math.round((e.hours / totals.totalHours) * 100) : 0;
              return (
                <div key={e.engineerId} className="space-y-1 rounded-lg border p-2.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-semibold">{e.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{e.hours} س · {pct}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* القائمة */}
      {listQuery.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : listQuery.isError ? (
        <Card className="p-8 text-center text-sm text-destructive">تعذر تحميل الساعات — {errMessage(listQuery.error)}</Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Timer}
          title={entries.length === 0 ? "لا ساعات مسجلة لهذا الشهر" : "لا نتائج مطابقة للبحث"}
          hint={entries.length === 0 ? "سجل ساعات الفريق على المخططات والإشراف بزر «تسجيل ساعات»" : "جرّب تعديل البحث"}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => (
            <Card key={t.id} className="p-3 sm:p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex size-9 shrink-0 flex-col items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
                  <span className="text-sm font-bold tabular-nums leading-none">{t.hours}</span>
                  <span className="text-[9px] leading-none opacity-80">ساعة</span>
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold">{t.engineerName}</span>
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{t.activity}</Badge>
                    <span className="text-[11px] tabular-nums text-muted-foreground">{t.workDate}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {t.contractNumber ? (
                      <>
                        <span dir="ltr" className="font-semibold">{t.contractNumber}</span>
                        {t.contractName ? ` — ${t.contractName}` : ""}
                        {t.customerName ? ` · ${t.customerName}` : ""}
                      </>
                    ) : (
                      "ساعات غير مرتبطة بمشروع (إداري/عام)"
                    )}
                  </p>
                  {t.notes && <p className="line-clamp-1 text-[11px] text-muted-foreground">{t.notes}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" title="تعديل" onClick={() => setEditor({ editing: t })}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive hover:text-destructive"
                    title="حذف"
                    onClick={() => setDeleteTarget({ kind: "timesheets", id: t.id, label: `${t.engineerName} — ${t.workDate}` })}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <TimesheetDialog
        open={!!editor}
        editing={editor?.editing ?? null}
        engineerOpts={engineerOpts}
        contractOpts={contractOpts}
        pending={saveMutation.isPending}
        onClose={() => setEditor(null)}
        onSave={(data) => saveMutation.mutate({ id: editor?.editing?.id, data })}
      />
    </div>
  );
}

function TimesheetDialog({
  open,
  editing,
  engineerOpts,
  contractOpts,
  pending,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: TimesheetItem | null;
  engineerOpts: { value: string; label: string }[];
  contractOpts: { value: string; label: string }[];
  pending: boolean;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
}) {
  const [form, setForm] = React.useState({
    engineerId: "",
    contractId: "",
    workDate: todayStr(),
    hours: "",
    activity: "تصميم",
    notes: "",
  });

  React.useEffect(() => {
    if (open) {
      setForm({
        engineerId: editing ? String(editing.engineerId) : "",
        contractId: editing?.contractId ? String(editing.contractId) : "",
        workDate: editing?.workDate || todayStr(),
        hours: editing?.hours ? String(editing.hours) : "",
        activity: editing?.activity || "تصميم",
        notes: editing?.notes ?? "",
      });
    }
  }, [open, editing]);

  const submit = () => {
    onSave({
      engineerId: Number(form.engineerId) || 0,
      contractId: form.contractId || null,
      workDate: form.workDate,
      hours: Number(form.hours) || 0,
      activity: form.activity,
      notes: form.notes,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "تعديل سجل ساعات" : "تسجيل ساعات عمل"}</DialogTitle>
          <DialogDescription>ساعات المهندس على المخططات والإشراف — وربطها بالمشروع اختياري للساعات الإدارية</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>المهندس *</Label>
            <SearchableSelect
              value={form.engineerId}
              onValueChange={(v) => setForm((f) => ({ ...f, engineerId: v }))}
              options={engineerOpts}
              placeholder="اختر المهندس"
              searchPlaceholder="ابحث بالاسم…"
            />
          </div>
          <div className="space-y-1.5">
            <Label>العقد/المشروع</Label>
            <SearchableSelect
              value={form.contractId}
              onValueChange={(v) => setForm((f) => ({ ...f, contractId: v }))}
              options={contractOpts}
              placeholder="بدون مشروع (إداري)"
              allowClear
              clearLabel="إزالة المشروع"
            />
          </div>
          <div className="space-y-1.5">
            <Label>تاريخ العمل *</Label>
            <Input type="date" value={form.workDate} onChange={(e) => setForm((f) => ({ ...f, workDate: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>الساعات *</Label>
            <Input type="number" min="0.25" max="24" step="0.25" value={form.hours} onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))} dir="ltr" placeholder="مثال: 4.5" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>نوع النشاط *</Label>
            <div className="flex flex-wrap gap-1.5">
              {TIMESHEET_ACTIVITIES.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, activity: a }))}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs transition-colors",
                    form.activity === a
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>ملاحظات</Label>
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="مثال: مراجعة مخططات الدور المتكرر" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            إلغاء
          </Button>
          <Button onClick={submit} disabled={pending || !form.engineerId || !form.workDate || !(Number(form.hours) > 0)}>
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
  engineerOpts,
  onErr,
  invalidate,
  setDeleteTarget,
}: SectionCommon & { engineerOpts: { value: string; label: string }[] }) {
  const { toast } = useToast();

  const listQuery = useQuery<{ leaves: LeaveItem[] }>({
    queryKey: ["consulting", "leaves"],
    queryFn: () => apiGet<{ leaves: LeaveItem[] }>("/api/consulting/leaves"),
  });
  const leaves = listQuery.data?.leaves ?? [];
  const today = todayStr();

  const [tab, setTab] = React.useState<string>("الكل");
  const [q, setQ] = React.useState("");

  const filtered = React.useMemo(() => {
    const needle = normSearch(q.trim());
    return leaves.filter((l) => {
      if (tab !== "الكل" && l.status !== tab) return false;
      if (needle && !normSearch(`${l.engineerName} ${l.leaveType} ${l.reason}`).includes(needle)) return false;
      return true;
    });
  }, [leaves, tab, q]);

  const [editor, setEditor] = React.useState<{ editing: LeaveItem | null } | null>(null);
  const [rejectTarget, setRejectTarget] = React.useState<LeaveItem | null>(null);
  useAddEvent("leaves", React.useCallback(() => setEditor({ editing: null }), []));

  const saveMutation = useMutation({
    mutationFn: (v: { id?: number; data: Record<string, unknown> }) =>
      v.id ? apiPatch(`/api/consulting/leaves/${v.id}`, v.data) : apiPost("/api/consulting/leaves", v.data),
    onSuccess: (_r, v) => {
      setEditor(null);
      invalidate();
      toast({ title: v.id ? "حُدّث الطلب" : "سُجل طلب الإجازة", description: "بانتظار القرار من الاعتماد" });
    },
    onError: (e) => onErr(e, "تعذر الحفظ"),
  });

  const decideMutation = useMutation({
    mutationFn: (v: { id: number; action: "approve" | "reject"; decisionNote?: string }) =>
      apiPatch(`/api/consulting/leaves/${v.id}`, { action: v.action, decisionNote: v.decisionNote }),
    onSuccess: (_r, v) => {
      setRejectTarget(null);
      invalidate();
      toast({ title: v.action === "approve" ? "اعتُمدت الإجازة" : "رُفضت الإجازة" });
    },
    onError: (e) => onErr(e, "تعذر تنفيذ القرار"),
  });

  const pendingCount = leaves.filter((l) => l.status === "معلقة").length;

  return (
    <div className="space-y-3">
      <Card className="gap-3 p-3 sm:p-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-9 w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="الكل">الكل ({leaves.length})</TabsTrigger>
            <TabsTrigger value="معلقة">معلقة ({pendingCount})</TabsTrigger>
            <TabsTrigger value="معتمدة">معتمدة ({leaves.filter((l) => l.status === "معتمدة").length})</TabsTrigger>
            <TabsTrigger value="مرفوضة">مرفوضة ({leaves.filter((l) => l.status === "مرفوضة").length})</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالمهندس/النوع/السبب…" className="ps-8" />
        </div>
      </Card>

      {listQuery.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : listQuery.isError ? (
        <Card className="p-8 text-center text-sm text-destructive">تعذر تحميل الإجازات — {errMessage(listQuery.error)}</Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={leaves.length === 0 ? "لا طلبات إجازة بعد" : "لا نتائج مطابقة للفلاتر"}
          hint={leaves.length === 0 ? "سجل أول طلب بزر «طلب إجازة»" : "جرّب تعديل البحث أو تبويب الحالة"}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((l) => {
            const tone = LEAVE_STATUS_TONE[l.status] || LEAVE_STATUS_TONE["معلقة"];
            const onVacation = l.status === "معتمدة" && l.startDate <= today && l.endDate >= today;
            return (
              <Card key={l.id} className={cn("p-3 sm:p-4", l.status === "مرفوضة" && "opacity-70")}>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
                    <CalendarDays className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold">{l.engineerName}</span>
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{l.leaveType}</Badge>
                      <StatusPill label={l.status} tone={tone} />
                      {onVacation && <Badge className="h-5 bg-status-warn-bg px-1.5 text-[10px] text-status-warn">في إجازة الآن</Badge>}
                    </div>
                    <p className="text-[11px] tabular-nums text-muted-foreground">
                      {l.startDate} ← {l.endDate} · {l.days} {l.days === 1 ? "يوم" : "أيام"}
                    </p>
                    {l.reason && <p className="text-[11px] text-muted-foreground">السبب: {l.reason}</p>}
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
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      title="حذف"
                      onClick={() => setDeleteTarget({ kind: "leaves", id: l.id, label: `إجازة ${l.engineerName}` })}
                    >
                      <Trash2 className="size-4" />
                    </Button>
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
        engineerOpts={engineerOpts}
        pending={saveMutation.isPending}
        onClose={() => setEditor(null)}
        onSave={(data) => saveMutation.mutate({ id: editor?.editing?.id, data })}
      />

      {/* نافذة الرفض — السبب إلزامي */}
      <Dialog open={!!rejectTarget} onOpenChange={(v) => !v && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-status-danger">رفض طلب الإجازة</DialogTitle>
            <DialogDescription>
              رفض إجازة {rejectTarget?.engineerName} — سبب الرفض إلزامي ويوثق مع القرار.
            </DialogDescription>
          </DialogHeader>
          <RejectForm
            pending={decideMutation.isPending}
            onSubmit={(note) => rejectTarget && decideMutation.mutate({ id: rejectTarget.id, action: "reject", decisionNote: note })}
            onCancel={() => setRejectTarget(null)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RejectForm({
  pending,
  onSubmit,
  onCancel,
}: {
  pending: boolean;
  onSubmit: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = React.useState("");
  return (
    <>
      <div className="space-y-1.5">
        <Label>سبب الرفض *</Label>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: ضغط عمل على المشروع في هذه الفترة" autoFocus />
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
          رفض الطلب
        </Button>
      </DialogFooter>
    </>
  );
}

function LeaveDialog({
  open,
  editing,
  engineerOpts,
  pending,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: LeaveItem | null;
  engineerOpts: { value: string; label: string }[];
  pending: boolean;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
}) {
  const [form, setForm] = React.useState({
    engineerId: "",
    leaveType: "سنوية",
    startDate: "",
    endDate: "",
    reason: "",
  });

  React.useEffect(() => {
    if (open) {
      setForm({
        engineerId: editing ? String(editing.engineerId) : "",
        leaveType: editing?.leaveType ?? "سنوية",
        startDate: editing?.startDate ?? "",
        endDate: editing?.endDate ?? "",
        reason: editing?.reason ?? "",
      });
    }
  }, [open, editing]);

  const days =
    form.startDate && form.endDate && form.endDate >= form.startDate
      ? Math.round((new Date(`${form.endDate}T00:00:00`).getTime() - new Date(`${form.startDate}T00:00:00`).getTime()) / 86400000) + 1
      : 0;

  const submit = () => {
    onSave({
      engineerId: Number(form.engineerId) || 0,
      leaveType: form.leaveType,
      startDate: form.startDate,
      endDate: form.endDate,
      reason: form.reason,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "تعديل طلب إجازة" : "طلب إجازة جديد"}</DialogTitle>
          <DialogDescription>الأيام تُحسب تلقائيًا شاملة الطرفين — والاعتماد لاحقًا من هذا القسم</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>المهندس *</Label>
            <SearchableSelect
              value={form.engineerId}
              onValueChange={(v) => setForm((f) => ({ ...f, engineerId: v }))}
              options={engineerOpts}
              placeholder="اختر المهندس"
              searchPlaceholder="ابحث بالاسم…"
            />
          </div>
          <div className="space-y-1.5">
            <Label>نوع الإجازة *</Label>
            <div className="flex flex-wrap gap-1.5">
              {LEAVE_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, leaveType: t }))}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs transition-colors",
                    form.leaveType === t
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>عدد الأيام</Label>
            <Input value={days > 0 ? `${days} ${days === 1 ? "يوم" : "أيام"}` : "—"} disabled dir="ltr" />
          </div>
          <div className="space-y-1.5">
            <Label>من تاريخ *</Label>
            <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>إلى تاريخ *</Label>
            <Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>السبب</Label>
            <Input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="اختياري" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            إلغاء
          </Button>
          <Button onClick={submit} disabled={pending || !form.engineerId || !form.startDate || !form.endDate || form.endDate < form.startDate}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {editing ? "حفظ التعديلات" : "تسجيل الطلب"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== القسم الرابع: مراجعات المخططات (docs/revisions-ipc-design.md §1.4) ====================

const REVISION_STATUS_TONE: Record<string, { text: string; bg: string }> = {
  "بانتظار مراجعة": { text: "text-status-warn", bg: "bg-status-warn-bg" },
  "مقبول": { text: "text-status-done", bg: "bg-status-done-bg" },
  "معاد بتعديلات": { text: "text-status-danger", bg: "bg-status-danger-bg" },
};

function RevisionsSection({
  engineerOpts,
  contractOpts,
  onErr,
  invalidate,
  setDeleteTarget,
}: SectionCommon & {
  engineerOpts: { value: string; label: string }[];
  contractOpts: { value: string; label: string }[];
}) {
  const { toast } = useToast();

  const listQuery = useQuery<{ revisions: RevisionItem[]; summary: { pending: number; approved: number; returned: number; activeCycles: number } }>({
    queryKey: ["consulting", "revisions"],
    queryFn: () => apiGet("/api/consulting/revisions"),
  });
  const revisions = listQuery.data?.revisions ?? [];

  const [tab, setTab] = React.useState<string>("الكل");
  const [q, setQ] = React.useState("");

  const filtered = React.useMemo(() => {
    const needle = normSearch(q.trim());
    return revisions.filter((r) => {
      if (tab !== "الكل" && r.status !== tab) return false;
      if (needle && !normSearch(`${r.title} ${r.contractNumber} ${r.contractName} ${r.customerName} ${r.engineerName ?? ""}`).includes(needle)) return false;
      return true;
    });
  }, [revisions, tab, q]);

  const [editor, setEditor] = React.useState<{ editing: RevisionItem | null } | null>(null);
  const [returnTarget, setReturnTarget] = React.useState<RevisionItem | null>(null);
  useAddEvent("revisions", React.useCallback(() => setEditor({ editing: null }), []));

  const saveMutation = useMutation({
    mutationFn: (v: { id?: number; data: Record<string, unknown> }) =>
      v.id ? apiPatch(`/api/consulting/revisions/${v.id}`, v.data) : apiPost("/api/consulting/revisions", v.data),
    onSuccess: (_r, v) => {
      setEditor(null);
      invalidate();
      toast({ title: v.id ? "حُدّث الإصدار" : "سُجلت دورة المراجعة", description: "بانتظار قرار المراجعة" });
    },
    onError: (e) => onErr(e, "تعذر الحفظ"),
  });

  const decideMutation = useMutation({
    mutationFn: (v: { id: number; decision: "مقبول" | "معاد بتعديلات"; note?: string }) =>
      apiPatch(`/api/consulting/revisions/${v.id}`, { decision: v.decision, note: v.note }),
    onSuccess: (_r, v) => {
      setReturnTarget(null);
      invalidate();
      toast({ title: v.decision === "مقبول" ? "اعتُمد الإصدار" : "أُعيد الإصدار بتعديلات" });
    },
    onError: (e) => onErr(e, "تعذر تنفيذ القرار"),
  });

  const pendingCount = revisions.filter((r) => r.status === REVISION_PENDING).length;

  return (
    <div className="space-y-3">
      <Card className="gap-3 p-3 sm:p-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-9 w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="الكل">الكل ({revisions.length})</TabsTrigger>
            <TabsTrigger value="بانتظار مراجعة">بانتظار مراجعة ({pendingCount})</TabsTrigger>
            <TabsTrigger value="مقبول">مقبول ({revisions.filter((r) => r.status === "مقبول").length})</TabsTrigger>
            <TabsTrigger value="معاد بتعديلات">معاد بتعديلات ({revisions.filter((r) => r.status === "معاد بتعديلات").length})</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالمخطط/العقد/العميل/المهندس…" className="ps-8" />
        </div>
      </Card>

      {listQuery.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : listQuery.isError ? (
        <Card className="p-8 text-center text-sm text-destructive">تعذر تحميل المراجعات — {errMessage(listQuery.error)}</Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FileStack}
          title={revisions.length === 0 ? "لا دورات مراجعة بعد" : "لا نتائج مطابقة للفلاتر"}
          hint={revisions.length === 0 ? "سجل أول إصدار بزر «دورة مراجعة جديدة»" : "جرّب تعديل البحث أو تبويب الحالة"}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const tone = REVISION_STATUS_TONE[r.status] || REVISION_STATUS_TONE["بانتظار مراجعة"];
            const decidible = canDecide(r.status);
            const editable = canEdit(r.status);
            const deletable = canDelete(r.status);
            return (
              <Card key={r.id} className={cn("p-3 sm:p-4", r.status === "معاد بتعديلات" && "opacity-80")}>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
                    <FileStack className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="h-5 px-1.5 font-bold tabular-nums">V{r.revNo}</Badge>
                      <span className="text-sm font-bold">{r.title}</span>
                      <StatusPill label={r.status} tone={tone} />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {r.contractNumber}
                      {r.contractName ? ` — ${r.contractName}` : ""}
                      {r.customerName ? ` · ${r.customerName}` : ""}
                      {r.engineerName ? ` · بتحضير ${r.engineerName}` : ""}
                    </p>
                    <p className="text-[11px] tabular-nums text-muted-foreground">
                      رُفع: {r.submittedAt || "—"}
                      {!decidible && r.decidedAt ? ` · القرار: ${r.decidedBy} — ${r.decidedAt}` : ""}
                    </p>
                    {r.status === "معاد بتعديلات" && r.decisionNote && (
                      <p className="text-[11px] text-status-danger">التعديلات المطلوبة: {r.decisionNote}</p>
                    )}
                    {r.status === "مقبول" && r.decisionNote && (
                      <p className="text-[11px] text-muted-foreground">ملاحظة الاعتماد: {r.decisionNote}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {decidible && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-status-done hover:text-status-done"
                          title="اعتماد الإصدار"
                          disabled={decideMutation.isPending}
                          onClick={() => decideMutation.mutate({ id: r.id, decision: "مقبول" })}
                        >
                          <Check className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-status-danger hover:text-status-danger"
                          title="إرجاع بتعديلات"
                          onClick={() => setReturnTarget(r)}
                        >
                          <X className="size-4" />
                        </Button>
                      </>
                    )}
                    {editable && (
                      <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" title="تعديل" onClick={() => setEditor({ editing: r })}>
                        <Pencil className="size-4" />
                      </Button>
                    )}
                    {deletable && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        title="حذف"
                        onClick={() => setDeleteTarget({ kind: "revisions", id: r.id, label: `إصدار V${r.revNo} من «${r.title}»` })}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <RevisionDialog
        open={!!editor}
        editing={editor?.editing ?? null}
        engineerOpts={engineerOpts}
        contractOpts={contractOpts}
        pending={saveMutation.isPending}
        onClose={() => setEditor(null)}
        onSave={(data) => saveMutation.mutate({ id: editor?.editing?.id, data })}
      />

      {/* نافذة الإرجاع — التعديلات المطلوبة إلزامية */}
      <Dialog open={!!returnTarget} onOpenChange={(v) => !v && setReturnTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-status-danger">إرجاع إصدار بتعديلات</DialogTitle>
            <DialogDescription>
              إرجاع V{returnTarget?.revNo} من «{returnTarget?.title}» — التعديلات المطلوبة إلزامية وتوثق مع القرار.
            </DialogDescription>
          </DialogHeader>
          <RevisionReturnForm
            pending={decideMutation.isPending}
            onSubmit={(note) => returnTarget && decideMutation.mutate({ id: returnTarget.id, decision: "معاد بتعديلات", note })}
            onCancel={() => setReturnTarget(null)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RevisionReturnForm({
  pending,
  onSubmit,
  onCancel,
}: {
  pending: boolean;
  onSubmit: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = React.useState("");
  return (
    <>
      <div className="space-y-1.5">
        <Label>التعديلات المطلوبة *</Label>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: تعديل مواقع الفتحات وفق ملاحظات البلدية" autoFocus />
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
          إرجاع الإصدار
        </Button>
      </DialogFooter>
    </>
  );
}

function RevisionDialog({
  open,
  editing,
  engineerOpts,
  contractOpts,
  pending,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: RevisionItem | null;
  engineerOpts: { value: string; label: string }[];
  contractOpts: { value: string; label: string }[];
  pending: boolean;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
}) {
  const [form, setForm] = React.useState({
    contractId: "",
    title: "",
    engineerId: "",
    submittedAt: "",
    notes: "",
  });

  React.useEffect(() => {
    if (open) {
      setForm({
        contractId: editing ? String(editing.contractId) : "",
        title: editing?.title ?? "",
        engineerId: editing?.engineerId ? String(editing.engineerId) : "",
        submittedAt: editing?.submittedAt || todayStr(),
        notes: editing?.notes ?? "",
      });
    }
  }, [open, editing]);

  const submit = () => {
    onSave({
      ...(editing ? {} : { contractId: Number(form.contractId) || 0 }),
      title: form.title,
      engineerId: form.engineerId ? Number(form.engineerId) : null,
      submittedAt: form.submittedAt,
      notes: form.notes,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `تعديل الإصدار V${editing.revNo}` : "دورة مراجعة جديدة"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "التعديل قبل الحسم فقط — الرقم V يبقى كما هو والدورة لا تُنقل لعقد آخر"
              : "كل رفع إصدار لنفس المخطط يُرقَّم V تالٍ آليًا — والحسم (اعتماد/إرجاع) من القائمة"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>العقد/المشروع *</Label>
            <SearchableSelect
              value={form.contractId}
              onValueChange={(v) => setForm((f) => ({ ...f, contractId: v }))}
              options={contractOpts}
              placeholder="اختر العقد"
              searchPlaceholder="ابحث برقم العقد/الاسم/العميل…"
              disabled={!!editing}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>اسم المخطط/الوثيقة *</Label>
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="مثال: مخطط معماري — الدور الأول" />
          </div>
          <div className="space-y-1.5">
            <Label>مُعد الإصدار</Label>
            <SearchableSelect
              value={form.engineerId}
              onValueChange={(v) => setForm((f) => ({ ...f, engineerId: v === "none" ? "" : v }))}
              options={[{ value: "none", label: "— بلا تحديد —" }, ...engineerOpts]}
              placeholder="اختياري"
              searchPlaceholder="ابحث بالاسم…"
            />
          </div>
          <div className="space-y-1.5">
            <Label>تاريخ رفع الإصدار</Label>
            <Input type="date" value={form.submittedAt} onChange={(e) => setForm((f) => ({ ...f, submittedAt: e.target.value }))} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>ملاحظات</Label>
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="اختياري" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            إلغاء
          </Button>
          <Button onClick={submit} disabled={pending || !form.title.trim() || (!editing && !form.contractId)}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {editing ? "حفظ التعديلات" : "تسجيل الإصدار"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== القسم الخامس: رادار المواعيد (NOVA 4 — docs/consulting-radar-design.md) ====================
// شبكة اليوم: صفوف = خانات مشتقة من إعدادات دوام HR (hrWorkStart/hrWorkEnd) بخطوة مدة الخانة
// (uiPrefs.radar_slot_minutes)، والأعمدة = المهندسون النشطون — حجزٌ واحد لكل خانة،
// والعمود يعطَّل كليًا في يوم إجازة معتمدة، والتعارض خطأ صريح بلا force.

interface RadarCell {
  id: number;
  customerId: number | null;
  customerName: string;
  contractId: number | null;
  contractNumber: string;
  note: string;
  createdBy: string;
}

interface RadarResponse {
  date: string;
  config: { workStart: string; workEnd: string; slotMinutes: number };
  slots: string[];
  engineers: { id: number; name: string; specialty: string; jobTitle: string }[];
  cells: Record<string, Record<number, RadarCell>>;
  leaveEngineerIds: number[];
  total: number;
}

/** سياق نافذة الحجز: مهندس/خانة محددان من النقر على خلية — أو nullان للاختيار الحر من زر الإضافة */
interface RadarSlotCtx {
  engineerId: number | null;
  hourSlot: string | null;
}

function RadarSection({
  isAdmin,
  contractOpts,
  onErr,
  invalidate,
}: SectionCommon & { isAdmin: boolean; contractOpts: { value: string; label: string }[] }) {
  const { toast } = useToast();

  const [date, setDate] = React.useState(todayStr());
  const [slotCtx, setSlotCtx] = React.useState<RadarSlotCtx | null>(null);
  const [confirmFree, setConfirmFree] = React.useState<{ hourSlot: string; engineerId: number; label: string } | null>(null);

  const radarQuery = useQuery<RadarResponse>({
    queryKey: ["consulting", "radar", date],
    queryFn: () => apiGet<RadarResponse>(`/api/consulting/radar?date=${date}`),
  });
  const data = radarQuery.data;
  const engineers = data?.engineers ?? [];
  const slots = data?.slots ?? [];
  const cells = data?.cells ?? {};
  const leaveIds = data?.leaveEngineerIds ?? [];
  const cfg = data?.config;

  // خيارات العملاء للاختيار — من نهاية العملاء الجاهزة (كبقية الأقسام)
  const [customerOpts, setCustomerOpts] = React.useState<{ value: string; label: string }[]>([]);
  React.useEffect(() => {
    let alive = true;
    apiLite
      .customers("")
      .then((rows) => alive && setCustomerOpts(rows.map((c) => ({ value: String(c.id), label: c.name }))))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useAddEvent("radar", React.useCallback(() => setSlotCtx({ engineerId: null, hourSlot: null }), []));

  // ضبط مدة الخانة — للمدير فقط، والخانات تُعاد بناؤها من نطاق الدوام بعد الحفظ
  const configMutation = useMutation({
    mutationFn: (slotMinutes: number) => apiPut<{ slotMinutes: number }>("/api/consulting/radar/config", { slotMinutes }),
    onSuccess: () => {
      invalidate();
      toast({ title: "حُفظت مدة الخانة", description: "أُعيد بناء خانات النطاق وفق المدة الجديدة" });
    },
    onError: (e) => onErr(e, "تعذر حفظ الإعداد"),
  });

  const bookMutation = useMutation({
    mutationFn: (v: { engineerId: number; hourSlot: string; customerId: number | null; contractId: number | null; note: string }) =>
      apiPost("/api/consulting/radar", { appointmentDate: date, ...v }),
    onSuccess: () => {
      setSlotCtx(null);
      invalidate();
      toast({ title: "حُجز الموعد" });
    },
    onError: (e) => onErr(e, "تعذر الحجز"),
  });

  const freeMutation = useMutation({
    mutationFn: (v: { hourSlot: string; engineerId: number }) =>
      apiDelete<{ deleted: number }>(
        `/api/consulting/radar?appointmentDate=${date}&hourSlot=${encodeURIComponent(v.hourSlot)}&engineerId=${v.engineerId}`
      ),
    onSuccess: (r) => {
      setConfirmFree(null);
      invalidate();
      toast({ title: "فُرِّغت الخانة" });
    },
    onError: (e) => onErr(e, "تعذر التفريغ"),
  });

  const cellAt = (slot: string, engineerId: number): RadarCell | undefined => cells[slot]?.[engineerId];
  const ctxCell = slotCtx?.engineerId && slotCtx?.hourSlot ? cellAt(slotCtx.hourSlot, slotCtx.engineerId) ?? null : null;

  return (
    <div className="space-y-3">
      {/* الترويسة: التاريخ + شرائح الإعدادات المشتقة + مدة الخانة للمدير */}
      <Card className="gap-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>التاريخ</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value || todayStr())} className="w-44" />
            </div>
            <div className="flex flex-wrap items-center gap-1.5 pb-1.5">
              <Badge variant="secondary" className="gap-1 text-[11px]">
                <Clock className="size-3" />
                نطاق الدوام {cfg?.workStart ?? "—"}–{cfg?.workEnd ?? "—"}
              </Badge>
              <Badge variant="secondary" className="text-[11px]">مدة الخانة {cfg?.slotMinutes ?? "—"} دقيقة</Badge>
              <Badge variant="secondary" className="text-[11px] tabular-nums">{data?.total ?? 0} موعدًا</Badge>
              <Badge variant="secondary" className="text-[11px] tabular-nums">{engineers.length} مهندسًا</Badge>
            </div>
          </div>
          {isAdmin && (
            <div className="space-y-1.5">
              <Label>مدة الخانة (دقيقة)</Label>
              <Select
                value={String(cfg?.slotMinutes ?? 60)}
                onValueChange={(v) => configMutation.mutate(Number(v))}
                disabled={configMutation.isPending}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RADAR_SLOT_MINUTES.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          نطاق الدوام يُضبط من إعدادات الموارد البشرية — والخانات تُشتق منه بخطوة مدة الخانة
        </p>
      </Card>

      {/* شبكة الرادار */}
      {radarQuery.isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : radarQuery.isError ? (
        <Card className="p-8 text-center text-sm text-destructive">تعذر تحميل الرادار — {errMessage(radarQuery.error)}</Card>
      ) : engineers.length === 0 ? (
        <EmptyState
          icon={Radar}
          title="لا مهندسين نشطين"
          hint="أضف مهندسين من قسم «الفريق الهندسي» لتظهر أعمدة الرادار"
        />
      ) : (
        <Card className="p-0">
          <CardContent className="overflow-x-auto p-0">
            <div className="max-h-[70vh] overflow-y-auto">
              <Table className="min-w-[640px]">
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead className="w-16 text-center">الوقت</TableHead>
                    {engineers.map((e) => (
                      <TableHead key={e.id} className="min-w-36 text-center">
                        <div className="space-y-0.5">
                          <p className="text-xs font-bold">{e.name}</p>
                          {e.specialty && <p className="text-[10px] font-normal text-muted-foreground">{e.specialty}</p>}
                          {leaveIds.includes(e.id) && (
                            <Badge className="h-4 bg-status-warn-bg px-1 text-[9px] text-status-warn">في إجازة</Badge>
                          )}
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slots.map((s) => (
                    <TableRow key={s}>
                      <TableCell className="text-center font-mono text-xs tabular-nums text-muted-foreground">{s}</TableCell>
                      {engineers.map((e) => {
                        const onLeave = leaveIds.includes(e.id);
                        const cell = cellAt(s, e.id);
                        if (!cell) {
                          return (
                            <TableCell key={e.id} className="p-1">
                              <button
                                type="button"
                                disabled={onLeave}
                                onClick={() => setSlotCtx({ engineerId: e.id, hourSlot: s })}
                                className="flex min-h-14 w-full items-center justify-center rounded-md border border-dashed text-muted-foreground/50 transition-colors hover:border-primary/40 hover:bg-muted/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                                title={onLeave ? "المهندس في إجازة معتمدة هذا اليوم" : `حجز ${s} — ${e.name}`}
                              >
                                <Plus className="size-4" />
                              </button>
                            </TableCell>
                          );
                        }
                        return (
                          <TableCell key={e.id} className="p-1">
                            <div className="min-h-14 space-y-0.5 rounded-md bg-status-done-bg p-2 ring-1 ring-status-done/40">
                              <p className="truncate text-xs font-bold text-status-done" title={cell.customerName}>
                                {cell.customerName || "موعد بلا عميل"}
                              </p>
                              {cell.note && (
                                <p className="truncate text-[10px] text-status-done/80" title={cell.note}>
                                  {cell.note}
                                </p>
                              )}
                              {cell.contractNumber && (
                                <p className="truncate text-[10px] tabular-nums text-status-done/80">{cell.contractNumber}</p>
                              )}
                              <div className="flex items-center gap-0.5 pt-0.5">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-6 text-muted-foreground hover:text-foreground"
                                  title="تعديل الموعد"
                                  onClick={() => setSlotCtx({ engineerId: e.id, hourSlot: s })}
                                >
                                  <Pencil className="size-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-6 text-destructive hover:text-destructive"
                                  title="تفريغ الخانة"
                                  onClick={() => setConfirmFree({ hourSlot: s, engineerId: e.id, label: `${s} — ${e.name}` })}
                                >
                                  <Trash2 className="size-3" />
                                </Button>
                              </div>
                            </div>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <RadarBookingDialog
        open={!!slotCtx}
        ctx={slotCtx}
        cell={ctxCell}
        date={date}
        slots={slots}
        engineerOpts={engineers.map((e) => ({
          value: String(e.id),
          label: e.specialty ? `${e.name} — ${e.specialty}` : e.name,
        }))}
        customerOpts={customerOpts}
        contractOpts={contractOpts}
        pending={bookMutation.isPending}
        onClose={() => setSlotCtx(null)}
        onSave={(v) => bookMutation.mutate(v)}
      />

      {/* تأكيد التفريغ */}
      <Dialog open={!!confirmFree} onOpenChange={(v) => !v && setConfirmFree(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-destructive">تفريغ الخانة</DialogTitle>
            <DialogDescription>سيُحذف موعد «{confirmFree?.label}» من رادار يوم {date}.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmFree(null)} disabled={freeMutation.isPending}>
              تراجع
            </Button>
            <Button
              className="border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80"
              disabled={freeMutation.isPending}
              onClick={() => confirmFree && freeMutation.mutate({ hourSlot: confirmFree.hourSlot, engineerId: confirmFree.engineerId })}
            >
              {freeMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              تفريغ نهائي
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** نافذة حجز/تعديل موعد — المهندس والتاريخ والخانة نص ثابت عند الحجز من خلية، وقوائم اختيار من زر الإضافة */
function RadarBookingDialog({
  open,
  ctx,
  cell,
  date,
  slots,
  engineerOpts,
  customerOpts,
  contractOpts,
  pending,
  onClose,
  onSave,
}: {
  open: boolean;
  ctx: RadarSlotCtx | null;
  cell: RadarCell | null;
  date: string;
  slots: string[];
  engineerOpts: { value: string; label: string }[];
  customerOpts: { value: string; label: string }[];
  contractOpts: { value: string; label: string }[];
  pending: boolean;
  onClose: () => void;
  onSave: (v: { engineerId: number; hourSlot: string; customerId: number | null; contractId: number | null; note: string }) => void;
}) {
  const [form, setForm] = React.useState({ engineerId: "", hourSlot: "", customerId: "", contractId: "", note: "" });

  React.useEffect(() => {
    if (open && ctx) {
      setForm({
        engineerId: ctx.engineerId ? String(ctx.engineerId) : "",
        hourSlot: ctx.hourSlot || "",
        customerId: cell?.customerId ? String(cell.customerId) : "",
        contractId: cell?.contractId ? String(cell.contractId) : "",
        note: cell?.note ?? "",
      });
    }
  }, [open, ctx, cell]);

  const ctxEngineerName = engineerOpts.find((o) => o.value === form.engineerId)?.label || "";

  const submit = () => {
    onSave({
      engineerId: Number(form.engineerId) || 0,
      hourSlot: form.hourSlot,
      customerId: form.customerId ? Number(form.customerId) : null,
      contractId: form.contractId ? Number(form.contractId) : null,
      note: form.note,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{cell ? "تعديل الموعد" : "حجز موعد"}</DialogTitle>
          <DialogDescription>
            خانة واحدة لمهندس واحد — والموعد داخل نطاق دوام الشركة حصرًا (بلا تعارض ولا force).
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>المهندس *</Label>
            {ctx?.engineerId ? (
              <Input value={ctxEngineerName} disabled />
            ) : (
              <SearchableSelect
                value={form.engineerId}
                onValueChange={(v) => setForm((f) => ({ ...f, engineerId: v }))}
                options={engineerOpts}
                placeholder="اختر المهندس"
                searchPlaceholder="ابحث بالاسم…"
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label>التاريخ *</Label>
            <Input value={date} disabled dir="ltr" />
          </div>
          <div className="space-y-1.5">
            <Label>الخانة *</Label>
            {ctx?.hourSlot ? (
              <Input value={ctx.hourSlot} disabled dir="ltr" />
            ) : (
              <Select value={form.hourSlot} onValueChange={(v) => setForm((f) => ({ ...f, hourSlot: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الخانة" />
                </SelectTrigger>
                <SelectContent>
                  {slots.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>العميل</Label>
            <SearchableSelect
              value={form.customerId}
              onValueChange={(v) => setForm((f) => ({ ...f, customerId: v === "none" ? "" : v }))}
              options={[{ value: "none", label: "— بلا عميل —" }, ...customerOpts]}
              placeholder="اختياري"
              searchPlaceholder="ابحث بالاسم…"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>العقد</Label>
            <SearchableSelect
              value={form.contractId}
              onValueChange={(v) => setForm((f) => ({ ...f, contractId: v === "none" ? "" : v }))}
              options={[{ value: "none", label: "— بلا عقد —" }, ...contractOpts]}
              placeholder="اختياري"
              searchPlaceholder="ابحث برقم العقد/الاسم…"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>ملاحظة</Label>
            <Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="اختياري — مثال: زيارة موقع" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            إلغاء
          </Button>
          <Button onClick={submit} disabled={pending || !form.engineerId || !form.hourSlot}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {cell ? "حفظ التعديلات" : "حجز الموعد"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
