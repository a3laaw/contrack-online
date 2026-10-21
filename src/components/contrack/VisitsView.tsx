"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Loader2,
  ListPlus,
  Pencil,
  Plus,
  UserCheck,
  UserX,
  Users,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./api";
import { SearchableSelect } from "./SearchableSelect";
import type {
  CustomerDetailResponse,
  User,
  VisitCell,
  VisitFlatRow,
  VisitGridRow,
  VisitStaffMember,
  VisitsDayResponse,
  VisitsStaffResponse,
} from "./contrack-types";
import { errMessage } from "./contrack-types";
import { cn } from "@/lib/utils";

interface VisitsViewProps {
  user: User;
  onAuthError: () => void;
}

const NONE = "none";
const pad2 = (n: number) => String(n).padStart(2, "0");

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function weekdayAr(date: string): string {
  try {
    return new Date(`${date}T00:00:00`).toLocaleDateString("ar", { weekday: "long" });
  } catch {
    return "";
  }
}

/** ساعات افتراضية 08:00 → 16:00 كل ساعة (يُستخدم عند صمت الخلفي) */
function fallbackHours(): string[] {
  const out: string[] = [];
  for (let h = 8; h <= 16; h++) out.push(`${pad2(h)}:00`);
  return out;
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

// ==================== حوار حجز/تعديل خانة ====================

interface SlotDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  context: { visitDate: string; hourSlot: string; staffId: number; staffName: string } | null;
  existing: VisitCell | null;
  onAuthError: () => void;
  onSaved: () => void;
}

function SlotDialog({ open, onOpenChange, context, existing, onAuthError, onSaved }: SlotDialogProps) {
  const { toast } = useToast();
  const [customerId, setCustomerId] = React.useState(NONE);
  const [note, setNote] = React.useState("");
  const [formError, setFormError] = React.useState("");

  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      setFormError("");
      setCustomerId(existing?.customerId != null ? String(existing.customerId) : NONE);
      setNote(existing?.note || "");
    }
    wasOpen.current = open;
  }, [open, existing]);

  const customersQuery = useQuery<{ customers: { id: number; name: string }[] }>({
    queryKey: ["customers", ""],
    queryFn: () => apiGet<{ customers: { id: number; name: string }[] }>("/api/customers"),
    enabled: open,
  });

  // الحجز/التعديل: PUT ثم POST احتياطًا إن لم يُنفَّذ المسار
  const saveMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      try {
        return await apiPut("/api/visits", body);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 405)) {
          return apiPost("/api/visits", body);
        }
        throw e;
      }
    },
    onSuccess: () => {
      onOpenChange(false);
      onSaved();
      toast({ title: existing ? "حُدّثت الزيارة" : "حُجزت الخانة", description: context?.staffName });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      const msg = errMessage(e);
      setFormError(msg);
      toast({ variant: "destructive", title: "تعذر الحجز", description: msg });
    },
  });

  const submit = () => {
    if (!context) return;
    setFormError("");
    saveMutation.mutate({
      visitDate: context.visitDate,
      hourSlot: context.hourSlot,
      staffId: context.staffId,
      customerId: customerId !== NONE ? Number(customerId) : null,
      note: note.trim(),
      // تعديل خانة محجوزة أصلاً: الخلفي يطلب force=true للسماح بالتحديث فوق نفس الخانة
      // (بدون force يُرفض بالتعارض «الخانة محجوزة» — وهو المطلوب عند سباق حجز خانة جديدة)
      ...(existing ? { force: true } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "تعديل زيارة" : "حجز خانة"}</DialogTitle>
          <DialogDescription>
            {context ? `${weekdayAr(context.visitDate)} ${context.visitDate} — الساعة ${context.hourSlot} — ${context.staffName}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>العميل (اختياري)</Label>
            <SearchableSelect
              value={customerId}
              onValueChange={setCustomerId}
              options={[
                { value: NONE, label: "بدون عميل (خانة حجز عام)" },
                ...(customersQuery.data?.customers ?? []).map((c) => ({ value: String(c.id), label: c.name })),
              ]}
              placeholder="بدون عميل"
              searchPlaceholder="ابحث بالاسم…"
              emptyText="لا نتائج مطابقة"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="visit-note">ملاحظة</Label>
            <Input
              id="visit-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="مثال: زيارة موقع — أحضر المخططات"
            />
          </div>
          {formError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
              {formError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>
            إلغاء
          </Button>
          <Button onClick={submit} disabled={saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
            {existing ? "حفظ" : "حجز"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== حوار إدارة موظفي الزيارات ====================

interface StaffDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAuthError: () => void;
  onChanged: () => void;
}

function StaffDialog({ open, onOpenChange, onAuthError, onChanged }: StaffDialogProps) {
  const { toast } = useToast();
  const [nName, setNName] = React.useState("");
  const [nPhone, setNPhone] = React.useState("");
  const [formError, setFormError] = React.useState("");

  const staffQuery = useQuery<VisitsStaffResponse>({
    queryKey: ["visit-staff", "all"],
    queryFn: () => apiGet<VisitsStaffResponse>("/api/visits/staff"),
    enabled: open,
  });
  const staff: VisitStaffMember[] = React.useMemo(() => {
    const raw = staffQuery.data?.staff ?? staffQuery.data?.items ?? [];
    return [...raw].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.id - b.id);
  }, [staffQuery.data]);

  const addMutation = useMutation({
    mutationFn: (body: { name: string; phone?: string }) => apiPost("/api/visits/staff", body),
    onSuccess: () => {
      setNName("");
      setNPhone("");
      setFormError("");
      onChanged();
      toast({ title: "أُضيف الموظف" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      const msg = errMessage(e);
      setFormError(msg);
      toast({ variant: "destructive", title: "تعذر الإضافة", description: msg });
    },
  });

  const patchMutation = useMutation({
    mutationFn: (vars: { id: number; body: Record<string, unknown> }) =>
      apiPatch(`/api/visits/staff/${vars.id}`, vars.body),
    onSuccess: () => {
      onChanged();
      toast({ title: "حُدّث الموظف" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر التحديث", description: errMessage(e) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/visits/staff/${id}`),
    onSuccess: () => {
      onChanged();
      toast({ title: "حُذف الموظف" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      // «الموظف المستخدم يُعطَّل لا يُحذف» — رسالة الخلفية حرفيًا
      toast({ variant: "destructive", title: "تعذر الحذف", description: errMessage(e) });
    },
  });

  /** ترتيب: تبديل sort مع الجار (الأعلى = sort أصغر) */
  const reorder = (index: number, dir: -1 | 1) => {
    const neighbor = staff[index + dir];
    if (!neighbor) return;
    const me = staff[index];
    patchMutation.mutate({
      id: me.id,
      body: { sort: neighbor.sort ?? index + dir },
    });
  };

  const submitAdd = () => {
    setFormError("");
    if (!nName.trim()) {
      setFormError("أدخل اسم الموظف");
      return;
    }
    addMutation.mutate({ name: nName.trim(), phone: nPhone.trim() || undefined });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>موظفو الزيارات</DialogTitle>
          <DialogDescription>
            أعمدة جدول الزيارات — الموظف المستخدم في حجوزات يُعطَّل بدلًا من حذفه
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {staffQuery.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : staff.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">لا يوجد موظفون بعد</p>
          ) : (
            staff.map((s, i) => (
              <div
                key={s.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg border p-2",
                  !s.active && "opacity-60"
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {s.name}
                    {!s.active && (
                      <Badge variant="secondary" className="ms-2 h-5 px-1.5 text-[10px]">
                        معطّل
                      </Badge>
                    )}
                  </p>
                  {s.phone && <p className="text-[11px] text-muted-foreground" dir="ltr">{s.phone}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title="تحريك لأعلى"
                    disabled={i === 0 || patchMutation.isPending}
                    onClick={() => reorder(i, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title="تحريك لأسفل"
                    disabled={i === staff.length - 1 || patchMutation.isPending}
                    onClick={() => reorder(i, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("size-7", s.active ? "text-status-done" : "text-muted-foreground")}
                    title={s.active ? "تعطيل" : "تفعيل"}
                    disabled={patchMutation.isPending}
                    onClick={() => patchMutation.mutate({ id: s.id, body: { active: !s.active } })}
                  >
                    {s.active ? <UserCheck className="size-4" /> : <UserX className="size-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive hover:text-destructive"
                    title="حذف"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(s.id)}
                  >
                    ×
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <p className="text-xs font-semibold">إضافة موظف</p>
          <div className="grid grid-cols-2 gap-2">
            <Input value={nName} onChange={(e) => setNName(e.target.value)} placeholder="الاسم *" />
            <Input
              value={nPhone}
              onChange={(e) => setNPhone(e.target.value)}
              placeholder="الهاتف"
              dir="ltr"
            />
          </div>
          {formError && <p className="text-xs font-medium text-destructive">{formError}</p>}
          <Button size="sm" className="w-full gap-1.5" onClick={submitAdd} disabled={addMutation.isPending}>
            {addMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            إضافة
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ==================== الشاشة الرئيسية ====================

export function VisitsView({ onAuthError }: VisitsViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [date, setDate] = React.useState(todayStr());
  const [staffOpen, setStaffOpen] = React.useState(false);

  // ===== جدول اليوم =====
  const dayQuery = useQuery<VisitsDayResponse>({
    queryKey: ["visits", date],
    queryFn: () => apiGet<VisitsDayResponse>(`/api/visits?date=${date}`),
  });

  const hours = React.useMemo(
    () => (dayQuery.data?.hours?.length ? dayQuery.data.hours : fallbackHours()),
    [dayQuery.data]
  );

  const staffQuery = useQuery<VisitsStaffResponse>({
    queryKey: ["visit-staff", "all"],
    queryFn: () => apiGet<VisitsStaffResponse>("/api/visits/staff"),
  });
  const allStaff: VisitStaffMember[] = React.useMemo(() => {
    const raw = staffQuery.data?.staff ?? staffQuery.data?.items ?? [];
    return [...raw].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.id - b.id);
  }, [staffQuery.data]);

  // أعمدة الشبكة: موظفو اليوم من الخلفي، وإلا الموظفون النشطون من قائمة الموظفين
  const columns: VisitStaffMember[] = React.useMemo(() => {
    if (dayQuery.data?.staff?.length) return dayQuery.data.staff.filter((s) => s.active !== false);
    return allStaff.filter((s) => s.active);
  }, [dayQuery.data, allStaff]);

  // الشبكة — شكل مرن بالأولوية: grid صفوف جاهزة، ثم cells خريطة، ثم قائمة مسطّحة، وإلا شبكة فارغة
  const gridRows = React.useMemo(() => {
    const emptyRow = (h: string): VisitGridRow => {
      const cells: Record<string, VisitCell | null> = {};
      for (const s of columns) cells[String(s.id)] = null;
      return { hourSlot: h, cells };
    };
    const d = dayQuery.data;
    if (!d) return [] as { hourSlot: string; cells: Record<string, VisitCell | null> }[];
    if (d.grid?.length) return d.grid;
    if (d.cells) {
      return hours.map((h) => ({ hourSlot: h, cells: d.cells?.[h] ?? {} }));
    }
    const flat: VisitFlatRow[] = d.visits ?? d.items ?? [];
    if (flat.length) {
      return hours.map((h) => {
        const cells: Record<string, VisitCell | null> = {};
        for (const s of columns) cells[String(s.id)] = null;
        for (const it of flat) {
          if (it.hourSlot === h) cells[String(it.staffId)] = it as VisitCell;
        }
        return { hourSlot: h, cells };
      });
    }
    return hours.map(emptyRow);
  }, [dayQuery.data, hours, columns]);

  const cellAt = (hourSlot: string, staffId: number): VisitCell | null =>
    gridRows.find((r) => r.hourSlot === hourSlot)?.cells?.[String(staffId)] ?? null;

  React.useEffect(() => {
    const e = dayQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [dayQuery.error, onAuthError]);

  const invalidateVisits = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["visits"] });
    qc.invalidateQueries({ queryKey: ["visit-staff"] });
  }, [qc]);

  // ===== مؤشرات اليوم =====
  const totalSlots = columns.length * hours.length;
  const booked = gridRows.reduce(
    (acc, row) => acc + columns.filter((s) => row.cells?.[String(s.id)]).length,
    0
  );
  const withCustomer = gridRows.reduce(
    (acc, row) => acc + columns.filter((s) => row.cells?.[String(s.id)]?.customerId != null).length,
    0
  );

  // ===== الحجوزات =====
  const [slotCtx, setSlotCtx] = React.useState<{
    visitDate: string;
    hourSlot: string;
    staffId: number;
    staffName: string;
  } | null>(null);
  const [slotExisting, setSlotExisting] = React.useState<VisitCell | null>(null);

  const openBook = (hourSlot: string, s: VisitStaffMember) => {
    setSlotExisting(cellAt(hourSlot, s.id));
    setSlotCtx({ visitDate: date, hourSlot, staffId: s.id, staffName: s.name });
  };

  const unbookMutation = useMutation({
    mutationFn: (vars: { hourSlot: string; staffId: number }) => {
      const qs = `visitDate=${date}&hourSlot=${encodeURIComponent(vars.hourSlot)}&staffId=${vars.staffId}`;
      return apiDelete(`/api/visits?${qs}`);
    },
    onSuccess: () => {
      invalidateVisits();
      toast({ title: "فُرِّغت الخانة" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر التفريغ", description: errMessage(e) });
    },
  });

  const toTaskMutation = useMutation({
    mutationFn: (vars: { hourSlot: string; staffId: number }) =>
      apiPost<{ task?: { id: number; title?: string } }>("/api/visits/to-task", {
        visitDate: date,
        hourSlot: vars.hourSlot,
        staffId: vars.staffId,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      invalidateVisits();
      toast({
        title: "حُوّلت الزيارة إلى مهمة",
        description: res?.task?.title ? `المهمة: ${res.task.title}` : "أُنشئت مهمة «موعد» بمصدر جدول الزيارات",
      });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      // «الترحيل المكرر مرفوض» — رسالة الخلفية حرفيًا
      toast({ variant: "destructive", title: "تعذر الترحيل", description: errMessage(e) });
    },
  });

  return (
    <div className="space-y-4">
      {/* العنوان */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold tracking-tight sm:text-xl">جدول الزيارات</h1>
          <p className="text-xs text-muted-foreground">خانات ساعة × موظف — الخانة الواحدة عميل واحد</p>
        </div>
        <Button variant="outline" onClick={() => setStaffOpen(true)} className="gap-1.5">
          <Users className="size-4" />
          الموظفون
        </Button>
      </div>

      {/* المؤشرات */}
      <div className="grid grid-cols-3 gap-3">
        <KpiCard
          icon={CalendarDays}
          label="محجوزة"
          value={String(booked)}
          tone="text-status-done"
          sub={`من ${totalSlots} خانة`}
        />
        <KpiCard
          icon={Eraser}
          label="فارغة"
          value={String(Math.max(totalSlots - booked, 0))}
          tone="text-muted-foreground"
        />
        <KpiCard
          icon={Users}
          label="بالعميل"
          value={String(withCustomer)}
          tone="text-status-info"
          sub={booked - withCustomer > 0 ? `${booked - withCustomer} بلا عميل` : undefined}
        />
      </div>

      {/* اختيار التاريخ */}
      <Card className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="size-8" title="اليوم السابق" onClick={() => setDate(shiftDate(date, -1))}>
              <ChevronRight className="size-4" />
            </Button>
            <Input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="h-9 w-auto"
            />
            <Button variant="outline" size="icon" className="size-8" title="اليوم التالي" onClick={() => setDate(shiftDate(date, 1))}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setDate(todayStr())}>
              اليوم
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {weekdayAr(date)} — {date}
            {dayQuery.data?.warning && (
              <span className="ms-2 font-medium text-status-warn">{dayQuery.data.warning}</span>
            )}
          </p>
        </div>
      </Card>

      {/* شبكة الجدولة */}
      {dayQuery.isLoading || staffQuery.isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : dayQuery.isError ? (
        <Card className="p-8 text-center text-sm text-destructive">
          تعذر تحميل جدول اليوم — {errMessage(dayQuery.error)}
        </Card>
      ) : columns.length === 0 ? (
        <Card className="p-10 text-center">
          <Users className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm font-medium">لا يوجد موظفو زيارات نشطون</p>
          <p className="text-xs text-muted-foreground">أضف موظفين من زر «الموظفون» لتظهر أعمدة الجدول</p>
        </Card>
      ) : (
        <Card className="p-0">
          <CardContent className="overflow-x-auto p-0">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 text-center">الساعة</TableHead>
                  {columns.map((s) => (
                    <TableHead key={s.id} className="min-w-36 text-center">
                      {s.name}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {hours.map((h) => (
                  <TableRow key={h}>
                    <TableCell className="text-center font-mono text-xs tabular-nums text-muted-foreground">
                      {h}
                    </TableCell>
                    {columns.map((s) => {
                      const cell = cellAt(h, s.id);
                      if (!cell) {
                        return (
                          <TableCell key={s.id} className="p-1">
                            <button
                              type="button"
                              onClick={() => openBook(h, s)}
                              className="flex min-h-14 w-full items-center justify-center rounded-md border border-dashed text-muted-foreground/50 transition-colors hover:border-primary/40 hover:bg-muted/50 hover:text-primary"
                              title={`حجز ${h} — ${s.name}`}
                            >
                              <Plus className="size-4" />
                            </button>
                          </TableCell>
                        );
                      }
                      return (
                        <TableCell key={s.id} className="p-1">
                          <div className="min-h-14 space-y-0.5 rounded-md bg-status-done-bg p-2 ring-1 ring-status-done/40">
                            <p className="truncate text-xs font-bold text-status-done">
                              {cell.customerName || "حجز بلا عميل"}
                            </p>
                            {cell.note && (
                              <p className="truncate text-[10px] text-status-done/80" title={cell.note}>
                                {cell.note}
                              </p>
                            )}
                            {cell.taskId ? (
                              <Badge variant="outline" className="h-4 px-1 text-[9px] text-status-done">
                                مهمة مرتبطة
                              </Badge>
                            ) : null}
                            <div className="flex items-center gap-0.5 pt-0.5">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6 text-status-done hover:text-status-done"
                                title="تعديل"
                                onClick={() => openBook(h, s)}
                              >
                                <Pencil className="size-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6 text-muted-foreground hover:text-status-done"
                                title="تفريغ الخانة"
                                disabled={unbookMutation.isPending}
                                onClick={() => unbookMutation.mutate({ hourSlot: h, staffId: s.id })}
                              >
                                <Eraser className="size-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6 text-status-info hover:text-sky-900"
                                title={cell.taskId ? "مُرحّلة إلى مهمة مسبقًا" : "تحويل إلى مهمة"}
                                disabled={!!cell.taskId || toTaskMutation.isPending}
                                onClick={() => toTaskMutation.mutate({ hourSlot: h, staffId: s.id })}
                              >
                                <ListPlus className="size-3" />
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
          </CardContent>
        </Card>
      )}

      {/* حوار الحجز */}
      <SlotDialog
        open={!!slotCtx}
        onOpenChange={(v) => !v && setSlotCtx(null)}
        context={slotCtx}
        existing={slotExisting}
        onAuthError={onAuthError}
        onSaved={invalidateVisits}
      />

      {/* حوار الموظفين */}
      <StaffDialog
        open={staffOpen}
        onOpenChange={setStaffOpen}
        onAuthError={onAuthError}
        onChanged={invalidateVisits}
      />
    </div>
  );
}
