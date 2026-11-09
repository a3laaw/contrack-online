"use client";

/**
 * ScheduleSection.tsx — قسم «الجدول الوقائي» (docs/maintenance-design.md §6 — د5/د6):
 * خطط التوليد بأحداثها وحالاتها الاشتقاقية (لا عمود حالة مخزن — G9) + شارة «متأخر»
 * + تخطي/إلغاء تخطي + «افتح أمر عمل» من الحدث + حوارات إنشاء/تعديل الخطة
 * (التعديل يحفظ المنجز والمتخطى ويعيد المعلق حصرًا — د5).
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CalendarOff, Loader2, Pencil, Plus } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPatch, apiPost } from "../api";
import { statusTone, type MaintenanceContractRow, type SchedulePlanRow } from "../MaintenanceView";

interface Props {
  onAuthError: () => void;
}

const PLAN_INTERVAL_OPTIONS = [
  { value: 1, label: "شهريًا" },
  { value: 2, label: "كل شهرين" },
  { value: 3, label: "ربع سنويًا" },
  { value: 6, label: "نصف سنويًا" },
  { value: 12, label: "سنويًا" },
];

function statusBadge(status: string) {
  return <Badge className={`h-5 px-1.5 text-[10px] ${statusTone(status)}`}>{status}</Badge>;
}

export function ScheduleSection({ onAuthError }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const onErr = React.useCallback(
    (e: unknown, title: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title, description: (e as { message?: string })?.message || "خطأ غير متوقع" });
    },
    [onAuthError, toast]
  );

  const plansQuery = useQuery<{ plans: SchedulePlanRow[] }>({
    queryKey: ["maintenance", "plans"],
    queryFn: () => apiGet<{ plans: SchedulePlanRow[] }>("/api/maintenance/plans"),
  });
  const contractsQuery = useQuery<{ contracts: MaintenanceContractRow[] }>({
    queryKey: ["maintenance", "contracts"],
    queryFn: () => apiGet<{ contracts: MaintenanceContractRow[]; typeNames: string[] }>("/api/maintenance/contracts"),
    staleTime: 30_000,
  });

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["maintenance"] });
  }, [qc]);

  // ===== إنشاء/تعديل خطة =====
  const [dlg, setDlg] = React.useState<{ mode: "new" | "edit"; plan?: SchedulePlanRow } | null>(null);
  const emptyForm = { contractId: "", name: "", intervalMonths: "1", occurrencesCount: "12", startDate: "", notes: "", active: true };
  const [form, setForm] = React.useState(emptyForm);

  const openNew = () => {
    setForm(emptyForm);
    setDlg({ mode: "new" });
  };
  const openEdit = (plan: SchedulePlanRow) => {
    setForm({
      contractId: String(plan.contractId),
      name: plan.name,
      intervalMonths: String(plan.intervalMonths),
      occurrencesCount: String(plan.occurrencesCount),
      startDate: plan.startDate,
      notes: plan.notes,
      active: plan.active,
    });
    setDlg({ mode: "edit", plan });
  };

  const saveMutation = useMutation<
    { kept: number; removed: number; created: number } | { id: number; occurrencesCount: number },
    Error,
    typeof form
  >({
    mutationFn: (v: typeof form) => {
      const isEdit = dlg?.mode === "edit";
      const payload = {
        contractId: Number(v.contractId),
        name: v.name,
        intervalMonths: Number(v.intervalMonths),
        occurrencesCount: Number(v.occurrencesCount),
        startDate: v.startDate,
        notes: v.notes,
        ...(isEdit ? { active: v.active } : {}),
      };
      return isEdit && dlg?.plan
        ? apiPatch<{ kept: number; removed: number; created: number }>(`/api/maintenance/plans/${dlg.plan.id}`, payload)
        : apiPost<{ id: number; occurrencesCount: number }>("/api/maintenance/plans", payload);
    },
    onSuccess: (r) => {
      setDlg(null);
      invalidate();
      if ("removed" in r) {
        toast({
          title: "حُفظ تعديل الخطة",
          description: `محفوظ ${r.kept} · محذوف معلق ${r.removed} · مولّد ${r.created} (د5)`,
        });
      } else {
        toast({ title: `أُنشئت الخطة ووُلّدت ${r.occurrencesCount} أحداثًا` });
      }
    },
    onError: (e) => onErr(e, "تعذر حفظ الخطة"),
  });

  // ===== تخطي/إلغاء تخطي (د6) =====
  const skipMutation = useMutation({
    mutationFn: (occId: number) => apiPost<{ skipped: boolean }>(`/api/maintenance/occurrences/${occId}/skip`),
    onSuccess: (r) => {
      invalidate();
      toast({ title: r.skipped ? "وُسم الحدث «متخطاة»" : "أُلغي تخطي الحدث" });
    },
    onError: (e) => onErr(e, "تعذر تخطي الحدث"),
  });

  const plans = plansQuery.data?.plans ?? [];
  const activeContracts = (contractsQuery.data?.contracts ?? []).filter((c) => c.status === "نشط" && !c.plan);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          خطة تولّد مواعيدها آليًا بمعايرة نهاية الشهر — التعديل يحفظ المنجز والمتخطى ويعيد المعلق حصرًا (د5)
        </p>
        <Button size="sm" onClick={openNew} className="gap-1.5">
          <Plus className="size-4" />
          خطة وقائية جديدة
        </Button>
      </div>

      {plansQuery.isLoading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <Card className="p-4">
          <div className="py-6 text-center">
            <CalendarOff className="mx-auto size-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm font-medium">لا خطط وقائية بعد</p>
            <p className="text-xs text-muted-foreground">أنشئ خطة على عقد صيانة نشط — فتولد زياراته آليًا</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {plans.map((p) => {
            const done = p.occurrences.filter((o) => o.status === "منجزة").length;
            const total = p.occurrences.length;
            return (
              <Card key={p.id} className="gap-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{p.name || "خطة وقائية"}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {p.contractNumber} — {p.contractName} · {p.customerName}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge className={`h-5 px-1.5 text-[10px] ${p.active ? "bg-status-done-bg text-status-done" : "bg-muted text-muted-foreground"}`}>
                      {p.active ? "نشطة" : "معطّلة"}
                    </Badge>
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                      {done} / {total} منجزة
                    </Badge>
                    <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={() => openEdit(p)}>
                      <Pencil className="size-3" />
                      تعديل
                    </Button>
                  </div>
                </div>
                {/* أحداث الخطة — القادم أولًا */}
                <div className="max-h-64 space-y-1.5 overflow-y-auto">
                  {p.occurrences.map((o) => {
                    const overdue = o.status === "مجدولة" && o.dueDate < new Date().toISOString().slice(0, 10);
                    return (
                      <div
                        key={o.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-2.5 py-1.5"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="font-mono text-[12px]">{o.dueDate}</span>
                          {overdue && (
                            <Badge className="h-5 bg-status-warn-bg px-1.5 text-[10px] text-status-warn">متأخر</Badge>
                          )}
                          {statusBadge(o.status)}
                          {o.workOrderNumber && (
                            <span className="truncate font-mono text-[11px] text-muted-foreground">{o.workOrderNumber}</span>
                          )}
                          {o.note && <span className="truncate text-[11px] text-muted-foreground">{o.note}</span>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {o.status === "مجدولة" && (
                            <OpenOrderDialog
                              contractId={p.contractId}
                              contractLabel={`${p.contractNumber} — ${p.contractName}`}
                              occurrenceId={o.id}
                              occurrenceDue={o.dueDate}
                              onDone={invalidate}
                              onErr={onErr}
                            />
                          )}
                          {(o.status === "مجدولة" || o.status === "متخطاة") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-[11px]"
                              disabled={skipMutation.isPending}
                              onClick={() => skipMutation.mutate(o.id)}
                            >
                              {skipMutation.isPending ? <Loader2 className="size-3 animate-spin" /> : <CalendarOff className="size-3" />}
                              {o.skipped ? "إلغاء التخطي" : "تخطي"}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* حوار إنشاء/تعديل الخطة */}
      <Dialog open={!!dlg} onOpenChange={(v) => !v && setDlg(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dlg?.mode === "edit" ? "تعديل الخطة الوقائية" : "خطة وقائية جديدة"}</DialogTitle>
            <DialogDescription>
              {dlg?.mode === "edit"
                ? "المنجز والمتخطى يُحفظان — والمعلق بلا أوامر يُعاد توليده من آخر ارتكاز (د5)"
                : "تولد الزيارات آليًا بمسافة الفاصل من تاريخ البداية"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {dlg?.mode === "new" && (
              <div className="grid gap-1.5">
                <Label>عقد الصيانة *</Label>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.contractId}
                  onChange={(e) => setForm({ ...form, contractId: e.target.value })}
                >
                  <option value="">— اختر العقد —</option>
                  {activeContracts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.contractNumber} — {c.contractName || c.contractType}
                    </option>
                  ))}
                </select>
                {activeContracts.length === 0 && (
                  <p className="text-[11px] text-status-warn">لا عقود صيانة نشطة بلا خطة — أنشئ العقد من قسم «عقود الصيانة»</p>
                )}
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>اسم الخطة</Label>
              <Input
                placeholder="زيارات 2025"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>الفاصل *</Label>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.intervalMonths}
                  onChange={(e) => setForm({ ...form, intervalMonths: e.target.value })}
                >
                  {PLAN_INTERVAL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label>عدد الزيارات (1..60) *</Label>
                <Input
                  type="number"
                  min="1"
                  max="60"
                  value={form.occurrencesCount}
                  onChange={(e) => setForm({ ...form, occurrencesCount: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>تاريخ البداية *</Label>
              <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </div>
            {dlg?.mode === "edit" && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  className="size-4"
                />
                الخطة نشطة (تعطيلها يوقف مؤشر «متأخر» لأحداثها)
              </label>
            )}
            <div className="grid gap-1.5">
              <Label>ملاحظات</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={saveMutation.isPending}
              onClick={() => {
                if (dlg?.mode === "new" && !form.contractId)
                  return toast({ variant: "destructive", title: "عقد الصيانة مطلوب" });
                if (!(Number(form.occurrencesCount) >= 1 && Number(form.occurrencesCount) <= 60))
                  return toast({ variant: "destructive", title: "عدد الزيارات بين 1 و 60" });
                if (!form.startDate) return toast({ variant: "destructive", title: "تاريخ البداية مطلوب" });
                saveMutation.mutate(form);
              }}
            >
              {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              حفظ الخطة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ==================== حوار فتح أمر عمل من حدث (د5/د3) ====================

interface Technician {
  id: number;
  name: string;
  phone: string;
}

function OpenOrderDialog({
  contractId,
  contractLabel,
  occurrenceId,
  occurrenceDue,
  onDone,
  onErr,
}: {
  contractId: number;
  contractLabel: string;
  occurrenceId: number;
  occurrenceDue: string;
  onDone: () => void;
  onErr: (e: unknown, title: string) => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [technicianId, setTechnicianId] = React.useState("");
  const [scheduledDate, setScheduledDate] = React.useState(occurrenceDue);

  const techQuery = useQuery<{ technicians: Technician[] }>({
    queryKey: ["maintenance", "technicians"],
    queryFn: () => apiGet<{ technicians: Technician[] }>("/api/maintenance/technicians"),
    enabled: open,
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiPost<{ docNumber: string }>("/api/maintenance/orders", {
        title,
        description,
        contractId,
        occurrenceId,
        technicianId: Number(technicianId) || null,
        scheduledDate,
      }),
    onSuccess: (r) => {
      setOpen(false);
      setTitle("");
      setDescription("");
      setTechnicianId("");
      onDone();
      toast({ title: `فُتح أمر العمل ${r.docNumber}` });
    },
    onError: (e) => onErr(e, "تعذر فتح أمر العمل"),
  });

  return (
    <>
      <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setOpen(true)}>
        <Plus className="size-3" />
        افتح أمر عمل
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>أمر عمل من الحدث الوقائي</DialogTitle>
            <DialogDescription>{contractLabel} — موعد الحدث {occurrenceDue}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>عنوان الأمر *</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="صيانة تكييف — زيارة دورية" />
            </div>
            <div className="grid gap-1.5">
              <Label>الوصف</Label>
              <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>الفني</Label>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={technicianId}
                  onChange={(e) => setTechnicianId(e.target.value)}
                >
                  <option value="">— بلا فني —</option>
                  {(techQuery.data?.technicians ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label>تاريخ الجدولة *</Label>
                <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={createMutation.isPending}
              onClick={() => {
                if (!title.trim()) return toast({ variant: "destructive", title: "عنوان الأمر مطلوب" });
                if (!scheduledDate) return toast({ variant: "destructive", title: "تاريخ الجدولة مطلوب" });
                createMutation.mutate();
              }}
            >
              {createMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              فتح الأمر
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
