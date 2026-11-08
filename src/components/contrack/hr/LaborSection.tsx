"use client";

/**
 * LaborSection.tsx — HR-3 قسم «الأطقم والتكليفات» (docs/hr-3-design.md §7):
 * ثلاث مناطق بنمط الأقسام القائمة:
 *   1. الأطقم (تجميع تشغيلي — د6): إنشاء/تعديل/حذف + تكليف جماعي بعقد واحد يولّد تكليفًا لكل عضو.
 *   2. التكليفات (مرآة EngineerAssignment): فلاتر + إضافة/تعديل/إنهاء/حذف — سقف النسب ≤100% يفرضه الخادم (د7).
 *   3. توزيع شهر: اختيار دفعة غير مدفوعة ⇒ توليد آلي من التكليفات + شبكة تحرير + غير الموزع (د3/د5).
 * حوار التوزيع AllocationDialog مُصدَّر ليُعاد استخدامه من بطاقة المسير في HRView.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, DoorOpen, Loader2, Network, Pencil, Play, Plus, Trash2, Users } from "lucide-react";

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
import { apiDelete, apiGet, apiPatch, apiPost } from "../api";
import { errMessage } from "../contrack-types";
import { SearchableSelect } from "../SearchableSelect";
import { monthLabelAr, PAYROLL_BATCH_LABELS } from "@/lib/hr-constants";

// ==================== مساعدات محلية صغيرة (ذاتية — مرآة HRView) ====================

function fmtNum(n: number): string {
  return new Intl.NumberFormat("ar-KW", { maximumFractionDigits: 0 }).format(Math.round(n || 0));
}
function fmtMoney(n: number): string {
  return new Intl.NumberFormat("ar-KW", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(n || 0);
}
function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-3 py-2 text-start text-[11px] font-bold text-muted-foreground">{children}</th>;
}
function SectionCard({ icon: Icon, title, sub, action, children }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  sub?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Icon className="size-4 text-primary" />
        <span className="text-sm font-extrabold">{title}</span>
        {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
        {action && <div className="ms-auto">{action}</div>}
      </div>
      {children}
    </Card>
  );
}

// ==================== أنواع ====================

interface WorkTeamItem {
  id: number;
  name: string;
  active: boolean;
  notes: string;
  members: { employeeId: number; name: string; jobNumber: string; jobTitle: string; active: boolean }[];
}
interface AssignmentItem {
  id: number;
  employeeId: number;
  employeeName: string;
  jobNumber: string;
  jobTitle: string;
  contractId: number;
  contractNumber: string;
  contractName: string;
  role: string;
  allocationPct: number;
  startDate: string;
  endDate: string;
  status: string;
  notes: string;
}
interface PayrollBatchItem {
  id: number;
  batchNo: number;
  month: string;
  monthLabel: string;
  status: string;
  netTotal: number;
}
interface ContractOpt { id: number; contractNumber: string; contractName?: string; description?: string; status?: string; customerName?: string }

export type HRSectionCommon = {
  employeeOpts: { value: string; label: string }[];
  onErr: (e: unknown, title: string) => void;
  invalidate: () => void;
};

// ==================== القسم الرئيسي ====================

export function LaborSection({ employeeOpts, onErr, invalidate }: HRSectionCommon) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [teamEditor, setTeamEditor] = React.useState<{ open: boolean; editing: WorkTeamItem | null }>({ open: false, editing: null });
  const [bulkTarget, setBulkTarget] = React.useState<WorkTeamItem | null>(null);
  const [assignmentEditor, setAssignmentEditor] = React.useState<{ open: boolean; editing: AssignmentItem | null }>({ open: false, editing: null });
  const [statusTab, setStatusTab] = React.useState("سارية");
  const [filterEmployee, setFilterEmployee] = React.useState("");
  const [allocBatchId, setAllocBatchId] = React.useState("");
  const [allocDialog, setAllocDialog] = React.useState<{ batchId: number; label: string } | null>(null);

  React.useEffect(() => {
    const h = (e: Event) => {
      if ((e as CustomEvent).detail === "labor") setTeamEditor({ open: true, editing: null });
    };
    window.addEventListener("hr-add", h);
    return () => window.removeEventListener("hr-add", h);
  }, []);

  const teamsQuery = useQuery<{ teams: WorkTeamItem[] }>({
    queryKey: ["hr", "labor", "teams"],
    queryFn: () => apiGet<{ teams: WorkTeamItem[] }>("/api/hr/labor/teams"),
  });
  const assignmentsQuery = useQuery<{ assignments: AssignmentItem[] }>({
    queryKey: ["hr", "labor", "assignments", statusTab, filterEmployee],
    queryFn: () =>
      apiGet<{ assignments: AssignmentItem[] }>(
        `/api/hr/labor/assignments?status=${encodeURIComponent(statusTab)}${filterEmployee ? `&employeeId=${filterEmployee}` : ""}`
      ),
  });
  const batchesQuery = useQuery<{ batches: PayrollBatchItem[] }>({
    queryKey: ["hr", "payroll"],
    queryFn: () => apiGet<{ batches: PayrollBatchItem[] }>("/api/hr/payroll"),
  });
  const contractOptsQuery = useQuery<ContractOpt[]>({
    queryKey: ["contracts-lite-labor"],
    queryFn: () =>
      apiGet<{ contracts: ContractOpt[] }>("/api/contracts").then((r) =>
        (r.contracts ?? []).filter((c) => (c.status ? c.status !== "ملغى" && c.status !== "مسودة" : true))
      ),
  });

  const contractOpts = React.useMemo(
    () =>
      (contractOptsQuery.data ?? []).map((c) => ({
        value: String(c.id),
        label: `${c.contractNumber}${c.description || c.contractName ? ` — ${(c.description || c.contractName || "").slice(0, 28)}` : ""}`,
      })),
    [contractOptsQuery.data]
  );

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: ["hr", "labor"] });
    invalidate();
  };

  const deleteTeam = useMutation({
    mutationFn: (v: { id: number; name: string }) => apiDelete(`/api/hr/labor/teams/${v.id}?reason=${encodeURIComponent(`حذف الفريق ${v.name}`)}`),
    onSuccess: () => {
      refetchAll();
      toast({ title: "حُذف الفريق", description: "جُرفت عضوياته (بلا أثر مالي)" });
    },
    onError: (e) => onErr(e, "تعذر حذف الفريق"),
  });
  const deleteAssignment = useMutation({
    mutationFn: (v: { id: number; label: string }) => apiDelete(`/api/hr/labor/assignments/${v.id}?reason=${encodeURIComponent(`حذف تكليف ${v.label}`)}`),
    onSuccess: () => {
      refetchAll();
      toast({ title: "حُذف التكليف" });
    },
    onError: (e) => onErr(e, "تعذر حذف التكليف"),
  });
  const endAssignment = useMutation({
    mutationFn: (v: { id: number }) => apiPatch(`/api/hr/labor/assignments/${v.id}`, { status: "منتهية" }),
    onSuccess: () => {
      refetchAll();
      toast({ title: "أُنهي التكليف", description: "الحالة «منتهية» — التاريخ اليوم افتراضيًا" });
    },
    onError: (e) => onErr(e, "تعذر إنهاء التكليف"),
  });

  const teams = teamsQuery.data?.teams ?? [];
  const assignments = assignmentsQuery.data?.assignments ?? [];
  const batches = (batchesQuery.data?.batches ?? []).filter((b) => b.status === "draft" || b.status === "approved");
  const allocBatchOpts = batches.map((b) => ({
    value: String(b.id),
    label: `${b.monthLabel} — PR-${b.batchNo} · ${PAYROLL_BATCH_LABELS[b.status] ?? b.status}`,
  }));

  return (
    <div className="space-y-4">
      {/* ===== 1) الأطقم ===== */}
      <SectionCard
        icon={Users}
        title="أطقم العمل"
        sub="تجميع تشغيلي — توليد تكليفات جماعية (د6)"
        action={
          <Button size="sm" className="gap-1.5" onClick={() => setTeamEditor({ open: true, editing: null })}>
            <Plus className="size-4" /> فريق جديد
          </Button>
        }
      >
        {teamsQuery.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : teams.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">لا أطقم بعد — أنشئ فريقًا ثم كلفه بعقد ليتولد تكليف لكل عضو</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {teams.map((t) => (
              <div key={t.id} className="rounded-xl border p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{t.name}</span>
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    {t.active ? "نشط" : "موقوف"}
                  </Badge>
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums">
                    {fmtNum(t.members.length)} عضو
                  </Badge>
                </div>
                {t.members.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {t.members.map((m) => (
                      <span key={m.employeeId} className="rounded-full bg-muted px-2 py-0.5 text-[10px]">
                        {m.name}
                        {!m.active && " (موقوف)"}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-muted-foreground">بلا أعضاء</p>
                )}
                {t.notes && <p className="mt-2 line-clamp-1 text-[11px] text-muted-foreground">{t.notes}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setBulkTarget(t)}>
                    <Network className="size-3.5" /> تكليف جماعي
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setTeamEditor({ open: true, editing: t })}>
                    <Pencil className="size-3.5" /> تعديل
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-[11px] text-status-danger hover:text-status-danger"
                    onClick={() => deleteTeam.mutate({ id: t.id, name: t.name })}
                    disabled={deleteTeam.isPending}
                  >
                    <Trash2 className="size-3.5" /> حذف
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ===== 2) التكليفات ===== */}
      <SectionCard
        icon={DoorOpen}
        title="تكليفات الموظفين بالعقود"
        sub="النسبة الافتراضية عند توليد التوزيع — سقف سارية 100% (د7)"
        action={
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setAssignmentEditor({ open: true, editing: null })}
          >
            <Plus className="size-4" /> تكليف جديد
          </Button>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Tabs value={statusTab} onValueChange={setStatusTab}>
            <TabsList className="h-8">
              <TabsTrigger value="سارية" className="h-7 text-xs">سارية</TabsTrigger>
              <TabsTrigger value="منتهية" className="h-7 text-xs">منتهية</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="w-44">
            <SearchableSelect
              value={filterEmployee}
              onValueChange={setFilterEmployee}
              options={employeeOpts}
              placeholder="كل الموظفين"
              allowClear
              clearLabel="كل الموظفين"
            />
          </div>
        </div>
        {assignmentsQuery.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : assignments.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">لا تكليفات — كلف موظفًا بعقد ليمكن توزيع تكلفته عليه</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <Th>الموظف</Th>
                  <Th>العقد</Th>
                  <Th>الدور</Th>
                  <Th>النسبة</Th>
                  <Th>الفترة</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id} className="border-t">
                    <td className="px-3 py-2">
                      <div className="font-bold">{a.employeeName}</div>
                      <div className="text-[10px] text-muted-foreground" dir="ltr">{a.jobNumber}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-bold tabular-nums" dir="ltr">{a.contractNumber}</div>
                      <div className="line-clamp-1 text-[10px] text-muted-foreground">{a.contractName}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">{a.role || "—"}</td>
                    <td className="px-3 py-2">
                      <span className="tabular-nums font-bold">{a.allocationPct}%</span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground" dir="ltr">
                      {a.startDate || "—"} → {a.endDate || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {a.status === "سارية" && (
                          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => endAssignment.mutate({ id: a.id })} disabled={endAssignment.isPending}>
                            <ClipboardList className="size-3.5" /> إنهاء
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setAssignmentEditor({ open: true, editing: a })}>
                          <Pencil className="size-3.5" /> تعديل
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-[11px] text-status-danger hover:text-status-danger"
                          onClick={() => deleteAssignment.mutate({ id: a.id, label: `${a.employeeName} → ${a.contractNumber}` })}
                          disabled={deleteAssignment.isPending}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* ===== 3) توزيع شهر ===== */}
      <SectionCard icon={ClipboardList} title="توزيع تكلفة الشهر على العقود" sub="طبقة تحليلية بلا قيود (د1) — التجميد عند الدفع (د5)">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-full max-w-xs space-y-1.5">
            <Label>دفعة مسير (مسودة/معتمدة)</Label>
            <SearchableSelect
              value={allocBatchId}
              onValueChange={(v) => setAllocBatchId(v || "")}
              options={allocBatchOpts}
              placeholder="اختر الدفعة"
              allowClear
              clearLabel="إزالة الاختيار"
              loading={batchesQuery.isLoading}
            />
          </div>
          <Button
            size="sm"
            className="gap-1.5"
            disabled={!allocBatchId}
            onClick={() => {
              const b = batches.find((x) => String(x.id) === allocBatchId);
              if (b) setAllocDialog({ batchId: b.id, label: `${b.monthLabel} — PR-${b.batchNo}` });
            }}
          >
            <Play className="size-4" /> افتح محرر التوزيع
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          الدفعات المدفوعة تُقرأ فقط من حوار التوزيع — وتكلفة العمالة تظهر في تقرير الربحية ونظرة العقد من الدفعات المعتمدة/المدفوعة.
        </p>
      </SectionCard>

      {/* ===== الحوارات ===== */}
      <TeamDialog
        open={teamEditor.open}
        editing={teamEditor.editing}
        employeeOpts={employeeOpts}
        onClose={() => setTeamEditor({ open: false, editing: null })}
        onSaved={() => {
          setTeamEditor({ open: false, editing: null });
          refetchAll();
        }}
        onErr={onErr}
      />
      {bulkTarget && (
        <BulkAssignDialog
          team={bulkTarget}
          contractOpts={contractOpts}
          onClose={() => setBulkTarget(null)}
          onSaved={() => {
            setBulkTarget(null);
            refetchAll();
          }}
          onErr={onErr}
        />
      )}
      <AssignmentDialog
        key={`${assignmentEditor.editing?.id ?? "new"}-${assignmentEditor.open}`}
        open={assignmentEditor.open}
        editing={assignmentEditor.editing}
        employeeOpts={employeeOpts}
        contractOpts={contractOpts}
        onClose={() => setAssignmentEditor({ open: false, editing: null })}
        onSaved={() => {
          setAssignmentEditor({ open: false, editing: null });
          refetchAll();
        }}
        onErr={onErr}
      />
      <AllocationDialog
        open={!!allocDialog}
        batchId={allocDialog?.batchId ?? null}
        batchLabel={allocDialog?.label ?? ""}
        onClose={() => setAllocDialog(null)}
        onErr={onErr}
      />
    </div>
  );
}

// ==================== نافذة الفريق ====================

function TeamDialog({
  open,
  editing,
  employeeOpts,
  onClose,
  onSaved,
  onErr,
}: {
  open: boolean;
  editing: WorkTeamItem | null;
  employeeOpts: { value: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
  onErr: (e: unknown, t: string) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [memberIds, setMemberIds] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setNotes(editing?.notes ?? "");
      setMemberIds((editing?.members ?? []).map((m) => String(m.employeeId)));
    }
  }, [open, editing]);

  const save = useMutation({
    mutationFn: (v: { name: string; notes: string; employeeIds: number[] }) =>
      editing
        ? apiPatch(`/api/hr/labor/teams/${editing.id}`, v)
        : apiPost("/api/hr/labor/teams", v),
    onSuccess: () => {
      toast({ title: editing ? "حُدّث الفريق" : "أُنشئ الفريق" });
      onSaved();
    },
    onError: (e) => onErr(e, "تعذر حفظ الفريق"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "تعديل فريق" : "فريق جديد"}</DialogTitle>
          <DialogDescription>الاسم إلزامي وفريد — الأعضاء يُستبدلون كاملة عند الحفظ</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>اسم الفريق *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="طقم الموقع / فريق الحسابات…" />
          </div>
          <div className="space-y-1.5">
            <Label>الأعضاء</Label>
            <SearchableSelect
              value=""
              onValueChange={(v) => {
                if (v && !memberIds.includes(v)) setMemberIds((s) => [...s, v]);
              }}
              options={employeeOpts}
              placeholder="أضف موظفًا للفريق"
            />
            {memberIds.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {memberIds.map((id) => {
                  const opt = employeeOpts.find((o) => o.value === id);
                  return (
                    <span key={id} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]">
                      {opt?.label ?? id}
                      <button
                        type="button"
                        className="text-status-danger"
                        onClick={() => setMemberIds((s) => s.filter((x) => x !== id))}
                        aria-label={`إزالة ${opt?.label ?? id}`}
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>ملاحظات</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>إلغاء</Button>
          <Button onClick={() => save.mutate({ name: name.trim(), notes: notes.trim(), employeeIds: memberIds.map(Number) })} disabled={save.isPending || !name.trim()}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            {editing ? "حفظ التعديلات" : "إنشاء الفريق"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== نافذة التكليف الجماعي (فريق → عقد) ====================

function BulkAssignDialog({
  team,
  contractOpts,
  onClose,
  onSaved,
  onErr,
}: {
  team: WorkTeamItem;
  contractOpts: { value: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
  onErr: (e: unknown, t: string) => void;
}) {
  const { toast } = useToast();
  const [contractId, setContractId] = React.useState("");
  const [role, setRole] = React.useState("");
  const [pct, setPct] = React.useState("100");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");

  const assign = useMutation({
    mutationFn: async (employeeId: number) =>
      apiPost("/api/hr/labor/assignments", {
        employeeId,
        contractId: Number(contractId),
        role,
        allocationPct: Number(pct) || 100,
        startDate,
        endDate,
        notes: `تكليف جماعي — فريق ${team.name}`,
      }),
  });

  const submit = () => {
    const members = team.members.filter((m) => m.active);
    if (members.length === 0) {
      onErr(new Error("لا أعضاء نشطين في الفريق"), "تعذر التكليف الجماعي");
      return;
    }
    let failed = 0;
    let done = 0;
    const errors: string[] = [];
    (async () => {
      for (const m of members) {
        try {
          await assign.mutateAsync(m.employeeId);
          done++;
        } catch (e) {
          failed++;
          errors.push(`${m.name}: ${errMessage(e)}`);
        }
      }
      toast({
        title: `كُلف ${done} عضوًا`,
        description: failed > 0 ? `رُفض ${failed}: ${errors.slice(0, 3).join(" · ")}` : `تكليف لكل عضو بنفس النسبة`,
      });
      onSaved();
    })();
  };

  const pctNum = Number(pct);
  const pctOk = Number.isFinite(pctNum) && pctNum > 0 && pctNum <= 100;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>تكليف جماعي — {team.name}</DialogTitle>
          <DialogDescription>
            {team.members.filter((m) => m.active).length} عضوًا نشطًا — يتولد تكليف لكل عضو بنفس النسبة (سقف 100% يفرضه الخادم)
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>العقد *</Label>
            <SearchableSelect value={contractId} onValueChange={setContractId} options={contractOpts} placeholder="اختر العقد" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>الدور</Label>
              <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="فني / مشرف…" />
            </div>
            <div className="space-y-1.5">
              <Label>النسبة % *</Label>
              <Input type="number" min="1" max="100" step="1" value={pct} onChange={(e) => setPct(e.target.value)} dir="ltr" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>من (اختياري)</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>إلى (اختياري)</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={submit} disabled={assign.isPending || !contractId || !pctOk}>
            {assign.isPending && <Loader2 className="size-4 animate-spin" />}
            كلف الأعضاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== نافذة التكليف (فردي — إضافة/تعديل) ====================

function AssignmentDialog({
  open,
  editing,
  employeeOpts,
  contractOpts,
  onClose,
  onSaved,
  onErr,
}: {
  open: boolean;
  editing: AssignmentItem | null;
  employeeOpts: { value: string; label: string }[];
  contractOpts: { value: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
  onErr: (e: unknown, t: string) => void;
}) {
  const { toast } = useToast();
  const [employeeId, setEmployeeId] = React.useState("");
  const [contractId, setContractId] = React.useState("");
  const [role, setRole] = React.useState("");
  const [pct, setPct] = React.useState("100");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setEmployeeId(editing ? String(editing.employeeId) : "");
      setContractId(editing ? String(editing.contractId) : "");
      setRole(editing?.role ?? "");
      setPct(editing ? String(editing.allocationPct) : "100");
      setStartDate(editing?.startDate ?? "");
      setEndDate(editing?.endDate ?? "");
      setNotes(editing?.notes ?? "");
    }
  }, [open, editing]);

  const save = useMutation({
    mutationFn: (v: Record<string, unknown>) =>
      editing ? apiPatch(`/api/hr/labor/assignments/${editing.id}`, v) : apiPost("/api/hr/labor/assignments", v),
    onSuccess: () => {
      toast({ title: editing ? "حُدّث التكليف" : "سُجل التكليف" });
      onSaved();
    },
    onError: (e) => onErr(e, "تعذر حفظ التكليف"),
  });

  const pctNum = Number(pct);
  const pctOk = Number.isFinite(pctNum) && pctNum > 0 && pctNum <= 100;
  const canSave = editing ? !!contractId && pctOk : !!employeeId && !!contractId && pctOk;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "تعديل تكليف" : "تكليف جديد"}</DialogTitle>
          <DialogDescription>موظف × عقد × نسبة — سقف مجموع التكليفات السارية 100% (د7)</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>الموظف *</Label>
            {editing ? (
              <Input value={editing.employeeName} disabled />
            ) : (
              <SearchableSelect value={employeeId} onValueChange={setEmployeeId} options={employeeOpts} placeholder="اختر الموظف" />
            )}
          </div>
          <div className="space-y-1.5">
            <Label>العقد *</Label>
            <SearchableSelect value={contractId} onValueChange={setContractId} options={contractOpts} placeholder="اختر العقد" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>الدور</Label>
              <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="اختياري" />
            </div>
            <div className="space-y-1.5">
              <Label>النسبة % *</Label>
              <Input type="number" min="1" max="100" step="1" value={pct} onChange={(e) => setPct(e.target.value)} dir="ltr" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>من (اختياري)</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>إلى (اختياري)</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>ملاحظات</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>إلغاء</Button>
          <Button
            onClick={() =>
              save.mutate({
                ...(editing ? {} : { employeeId: Number(employeeId) }),
                contractId: Number(contractId),
                role: role.trim(),
                allocationPct: pctNum,
                startDate,
                endDate,
                notes: notes.trim(),
              })
            }
            disabled={save.isPending || !canSave}
          >
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            {editing ? "حفظ التعديلات" : "سجل التكليف"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== حوار توزيع التكلفة (يُعاد استخدامه من بطاقة المسير) ====================

export interface AllocationViewRow {
  id: number;
  employeeId: number;
  employeeName: string;
  jobNumber: string;
  contractId: number;
  contractNumber: string;
  contractName: string;
  sharePercent: number;
  snapMonthlyRate: number;
  amount: number;
  note: string;
}
export interface AllocationView {
  batch: { id: number; month: string; status: string; batchNo: number };
  editable: boolean;
  rows: AllocationViewRow[];
  employeesSummary: { employeeId: number; name: string; rate: number; allocated: number; unallocated: number }[];
  totals: { allocatedTotal: number; fullCostTotal: number; unallocatedTotal: number };
}

export function AllocationDialog({
  open,
  batchId,
  batchLabel,
  onClose,
  onErr,
}: {
  open: boolean;
  batchId: number | null;
  batchLabel: string;
  onClose: () => void;
  onErr: (e: unknown, t: string) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draftRows, setDraftRows] = React.useState<{ employeeId: number; contractId: number; sharePercent: number; note: string }[]>([]);
  const [addEmployee, setAddEmployee] = React.useState("");
  const [addContract, setAddContract] = React.useState("");
  const [addPct, setAddPct] = React.useState("100");

  const viewQuery = useQuery<AllocationView>({
    queryKey: ["hr", "labor", "allocations", batchId],
    queryFn: () => apiGet<AllocationView>(`/api/hr/labor/allocations?batchId=${batchId}`),
    enabled: open && batchId != null,
  });
  const view = viewQuery.data ?? null;
  const editable = view?.editable ?? false;

  // مزامنة المسودة مع الخادم عند كل فتح/تحديث ناجح
  React.useEffect(() => {
    if (view) {
      setDraftRows(view.rows.map((r) => ({ employeeId: r.employeeId, contractId: r.contractId, sharePercent: r.sharePercent, note: r.note })));
    }
  }, [view]);

  const contractOptsQuery = useQuery<ContractOpt[]>({
    queryKey: ["contracts-lite-labor"],
    queryFn: () =>
      apiGet<{ contracts: ContractOpt[] }>("/api/contracts").then((r) =>
        (r.contracts ?? []).filter((c) => (c.status ? c.status !== "ملغى" && c.status !== "مسودة" : true))
      ),
    enabled: open,
  });
  const contractOpts = React.useMemo(
    () =>
      (contractOptsQuery.data ?? []).map((c) => ({
        value: String(c.id),
        label: `${c.contractNumber}${c.description || c.contractName ? ` — ${(c.description || c.contractName || "").slice(0, 28)}` : ""}`,
      })),
    [contractOptsQuery.data]
  );

  const generate = useMutation({
    mutationFn: () => apiPost<{ created: number; skipped: { employeeId: number; name: string }[] }>("/api/hr/labor/allocations/generate", { batchId }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["hr", "labor", "allocations", batchId] });
      toast({
        title: `وُلد ${res.created} سطرًا من التكليفات`,
        description: res.skipped.length > 0 ? `غير موزعين (بلا تكليفات): ${res.skipped.map((s) => s.name).join("، ")}` : undefined,
      });
    },
    onError: (e) => onErr(e, "تعذر توليد التوزيع"),
  });

  const save = useMutation({
    mutationFn: () => apiPost<{ created: number }>("/api/hr/labor/allocations", { batchId, rows: draftRows }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["hr", "labor", "allocations", batchId] });
      toast({ title: "حُفظ التوزيع", description: `${res.created} سطرًا بلقطات جديدة لحظة الحفظ` });
    },
    onError: (e) => onErr(e, "تعذر حفظ التوزيع"),
  });

  const addRow = () => {
    const employeeId = Number(addEmployee);
    const contractId = Number(addContract);
    const pct = Number(addPct);
    if (!Number.isFinite(employeeId) || !Number.isFinite(contractId) || !(pct > 0 && pct <= 100)) return;
    const exists = draftRows.some((r) => r.employeeId === employeeId && r.contractId === contractId);
    if (exists) {
      setDraftRows((rows) => rows.map((r) => (r.employeeId === employeeId && r.contractId === contractId ? { ...r, sharePercent: pct } : r)));
    } else {
      setDraftRows((rows) => [...rows, { employeeId, contractId, sharePercent: pct, note: "" }]);
    }
    setAddEmployee("");
    setAddContract("");
    setAddPct("100");
  };

  const empName = (id: number) => view?.employeesSummary.find((e) => e.employeeId === id)?.name ?? `#${id}`;
  const contractLabel = (id: number) => {
    const opt = contractOpts.find((o) => Number(o.value) === id);
    return opt ? opt.label : `#${id}`;
  };
  const rateOf = (employeeId: number) => view?.employeesSummary.find((e) => e.employeeId === employeeId)?.rate ?? 0;
  const rowAmount = (r: { employeeId: number; sharePercent: number }) => Math.round(rateOf(r.employeeId) * (r.sharePercent / 100) * 1000) / 1000;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>توزيع تكلفة الشهر — {batchLabel}</DialogTitle>
          <DialogDescription>
            طبقة تحليلية بلا قيود — لقطة التكلفة تتجمد لحظة الحفظ (د5) ·{" "}
            {view?.batch ? `${monthLabelAr(view.batch.month)} · ${PAYROLL_BATCH_LABELS[view.batch.status] ?? view.batch.status}` : ""}
          </DialogDescription>
        </DialogHeader>

        {viewQuery.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : viewQuery.isError ? (
          <p className="py-6 text-center text-sm text-destructive">تعذر تحميل التوزيع — {errMessage(viewQuery.error)}</p>
        ) : !view ? null : (
          <div className="space-y-3">
            {/* المجاميع */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border p-2">
                <div className="text-[10px] text-muted-foreground">تكلفة الشهر الكاملة</div>
                <div className="text-sm font-extrabold tabular-nums">{fmtMoney(view.totals.fullCostTotal)}</div>
              </div>
              <div className="rounded-lg border p-2">
                <div className="text-[10px] text-muted-foreground">الموزع على العقود</div>
                <div className="text-sm font-extrabold tabular-nums text-status-done">{fmtMoney(view.totals.allocatedTotal)}</div>
              </div>
              <div className="rounded-lg border p-2">
                <div className="text-[10px] text-muted-foreground">غير الموزع</div>
                <div className={`text-sm font-extrabold tabular-nums ${view.totals.unallocatedTotal > 0.001 ? "text-status-warn" : ""}`}>
                  {fmtMoney(view.totals.unallocatedTotal)}
                </div>
              </div>
            </div>

            {/* أزرار */}
            {editable && (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => generate.mutate()} disabled={generate.isPending}>
                  {generate.isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                  توليد من التكليفات السارية
                </Button>
                <Badge variant="outline" className="h-6 px-2 text-[11px]">قابل للتحرير حتى الدفع</Badge>
              </div>
            )}
            {!editable && (
              <Badge className="h-6 bg-status-warn-bg px-2 text-[11px] text-status-warn">
                مجمّد للقراءة — الدفعة {PAYROLL_BATCH_LABELS[view.batch.status] ?? view.batch.status}
              </Badge>
            )}

            {/* إضافة سطر */}
            {editable && (
              <div className="grid grid-cols-1 gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_1fr_auto_auto]">
                <SearchableSelect
                  value={addEmployee}
                  onValueChange={setAddEmployee}
                  options={(view.employeesSummary ?? []).map((e) => ({ value: String(e.employeeId), label: `${e.name} (${fmtMoney(e.rate)})` }))}
                  placeholder="موظف الدفعة"
                />
                <SearchableSelect value={addContract} onValueChange={setAddContract} options={contractOpts} placeholder="العقد" />
                <Input
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={addPct}
                  onChange={(e) => setAddPct(e.target.value)}
                  dir="ltr"
                  className="w-20"
                  aria-label="نسبة السطر"
                />
                <Button size="sm" className="gap-1" onClick={addRow} disabled={!addEmployee || !addContract}>
                  <Plus className="size-4" /> أضف
                </Button>
              </div>
            )}

            {/* شبكة الأسطر */}
            {draftRows.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">لا أسطر توزيع — ولّد من التكليفات أو أضف سطرًا يدويًا</p>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-xl border">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                    <tr>
                      <Th>الموظف</Th>
                      <Th>العقد</Th>
                      <Th>النسبة</Th>
                      <Th>المبلغ (لقطة)</Th>
                      {editable && <Th />}
                    </tr>
                  </thead>
                  <tbody>
                    {draftRows.map((r, i) => (
                      <tr key={`${r.employeeId}-${r.contractId}`} className="border-t">
                        <td className="px-3 py-2 font-bold">{empName(r.employeeId)}</td>
                        <td className="px-3 py-2 text-xs">{contractLabel(r.contractId)}</td>
                        <td className="px-3 py-2">
                          {editable ? (
                            <Input
                              type="number"
                              min="1"
                              max="100"
                              step="1"
                              value={String(r.sharePercent)}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                setDraftRows((rows) => rows.map((x, xi) => (xi === i ? { ...x, sharePercent: Number.isFinite(v) ? v : x.sharePercent } : x)));
                              }}
                              dir="ltr"
                              className="h-8 w-20"
                            />
                          ) : (
                            <span className="tabular-nums font-bold">{r.sharePercent}%</span>
                          )}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{fmtMoney(editable ? rowAmount(r) : draftRowSnapshotAmount(view, r))}</td>
                        {editable && (
                          <td className="px-3 py-2 text-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-status-danger hover:text-status-danger"
                              onClick={() => setDraftRows((rows) => rows.filter((_, xi) => xi !== i))}
                              aria-label="حذف السطر"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ملخص الموظفين */}
            <details className="rounded-xl border p-3">
              <summary className="cursor-pointer text-xs font-bold">ملخص لكل موظف (التعرفة · الموزع · غير الموزع)</summary>
              <div className="mt-2 space-y-1">
                {view.employeesSummary.map((e) => (
                  <div key={e.employeeId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1 text-[11px]">
                    <span className="font-bold">{e.name}</span>
                    <span className="tabular-nums" dir="ltr">
                      {fmtMoney(e.rate)} · <span className="text-status-done">{fmtMoney(e.allocated)}</span>
                      {e.unallocated > 0.001 && <span className="text-status-warn"> · غير موزع {fmtMoney(e.unallocated)}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
          {editable && (
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />}
              حفظ التوزيع
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** مبلغ السطر من لقطة الخادم (وضع القراءة — النسبة الثابتة × لقطة التعرفة المخزنة) */
function draftRowSnapshotAmount(view: AllocationView, r: { employeeId: number; contractId: number; sharePercent: number }): number {
  const row = view.rows.find((x) => x.employeeId === r.employeeId && x.contractId === r.contractId);
  return row ? row.amount : 0;
}
