"use client";

/**
 * الشاشة الموحدة «المراحل والدفعات» — قرار المالك (2026-01):
 * «أنواع العقود ومراحل العمل والدفعات كلها في صفحة واحدة — صف العقد أمامه عمود مراحل العمل،
 *  اختيار المرحلة يُظهر عمود الدفعة المرتبطة».
 *
 * التدفق: كل صف = عقد (بنوعه وعميله وقيمته) ← عمود «مراحل العمل» قائمة منسدلة بمراحل العقد
 * ← عند الاختيار يظهر عمود «الدفعات المرتبطة» بسطور الخطة المربوطة بهذه المرحلة
 * (المبلغ · الاستحقاق · المسدد · الحالة) مع إجراءات المدير: ربط دفعة موجودة / إضافة دفعة
 * للمرحلة / فك الربط — كلها عبر مسارات خطة الدفعات القائمة (بلا جداول جديدة).
 * البيانات: GET /api/contracts/stage-payments — والكتابة PATCH/POST خطة العقد.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Loader2, Plus, Search, Unlink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPatch, apiPost } from "./api";
import { errMessage, type User } from "./contrack-types";
import { SearchableSelect } from "./SearchableSelect";
import { formatKWD, fmtDate, statusBadgeClass, todayStr } from "@/lib/format";

// ===== أنواع الـAPI — عقد GET /api/contracts/stage-payments =====
interface SpStage {
  id: number;
  name: string;
  payPct: number;
  payKind: string;
  sortOrder: number;
  isSkipped: boolean;
  endDate: string;
}
interface SpPayment {
  id: number;
  title: string;
  amount: number;
  dueDate: string;
  stageId: number | null;
  triggeredAt: string;
  notes: string;
  paid: number;
}
interface SpContract {
  id: number;
  contractNumber: string;
  contractName: string;
  contractType: string;
  status: string;
  customerName: string;
  amount: number;
  stages: SpStage[];
  payments: SpPayment[];
}
interface SpResponse {
  contracts: SpContract[];
}

interface StagePaymentsViewProps {
  user: User;
  onAuthError: () => void;
}

export function StagePaymentsView({ user, onAuthError }: StagePaymentsViewProps) {
  const { toast } = useToast();
  const manager = user.role === "admin" || user.role === "developer";

  const onFail = React.useCallback(
    (e: unknown, title: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title, description: errMessage(e) });
    },
    [onAuthError, toast]
  );

  const dataQuery = useQuery<SpResponse>({
    queryKey: ["stage-payments"],
    queryFn: () => apiGet<SpResponse>("/api/contracts/stage-payments"),
  });

  // فلاتر العرض — بحث حر + نوع العقد + الحالة
  const [q, setQ] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState("all");
  const [statusFilter, setStatusFilter] = React.useState("all");

  // المرحلة المختارة لكل عقد: contractId → stageId كسلسلة ("" = بلا اختيار)
  const [stagePick, setStagePick] = React.useState<Record<number, string>>({});

  const contracts = dataQuery.data?.contracts ?? [];

  const types = React.useMemo(
    () => Array.from(new Set(contracts.map((c) => c.contractType).filter(Boolean))).sort(),
    [contracts]
  );
  const statuses = React.useMemo(
    () => Array.from(new Set(contracts.map((c) => c.status).filter(Boolean))),
    [contracts]
  );

  const norm = React.useCallback((s: string) => s.toLowerCase().replace(/\s+/g, " ").trim(), []);
  const filtered = React.useMemo(() => {
    const nq = norm(q);
    return contracts.filter((c) => {
      if (typeFilter !== "all" && c.contractType !== typeFilter) return false;
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (!nq) return true;
      const hay = norm(`${c.contractNumber} ${c.contractName} ${c.customerName} ${c.contractType}`);
      return hay.includes(nq);
    });
  }, [contracts, q, typeFilter, statusFilter, norm]);

  const setPick = React.useCallback((contractId: number, stageId: string) => {
    setStagePick((prev) => ({ ...prev, [contractId]: stageId }));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold whitespace-nowrap">المراحل والدفعات</h1>
        <span className="hidden xl:inline text-xs text-muted-foreground">
          كل عقد أمامه مراحله — اختر مرحلة فتظهر دفعاتها المرتبطة، واربط دفعة جديدة أو موجودة بالمرحلة مباشرة
        </span>
      </div>

      {/* شريط الفلاتر — بحث + نوع العقد + الحالة */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            className="h-10 ps-9"
            placeholder="بحث برقم العقد أو الاسم أو العميل…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="بحث في العقود"
          />
        </div>
        <div className="flex gap-2">
          <SearchableSelect
            value={typeFilter}
            onValueChange={setTypeFilter}
            options={[
              { value: "all", label: "كل الأنواع" },
              ...types.map((t) => ({ value: t, label: t })),
            ]}
            placeholder="نوع العقد"
            searchPlaceholder="ابحث عن نوع…"
            allowClear={false}
            className="w-full sm:w-44"
            aria-label="فلتر نوع العقد"
          />
          <SearchableSelect
            value={statusFilter}
            onValueChange={setStatusFilter}
            options={[
              { value: "all", label: "كل الحالات" },
              ...statuses.map((s) => ({ value: s, label: s })),
            ]}
            placeholder="الحالة"
            searchPlaceholder="ابحث عن حالة…"
            allowClear={false}
            className="w-full sm:w-40"
            aria-label="فلتر حالة العقد"
          />
        </div>
      </div>

      {dataQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : dataQuery.isError ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            تعذر تحميل العقود — حاول تحديث الصفحة
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {contracts.length === 0
              ? "لا توجد عقود بعد — أضف عقدًا من شاشة العقود أولًا"
              : "لا توجد عقود مطابقة للفلاتر الحالية"}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* سطح المكتب — جدول موحد: العقد ← مراحله ← دفعات المرحلة */}
          <div className="hidden lg:block rounded-xl border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start w-[26%]">العقد</TableHead>
                  <TableHead className="text-start w-[12%]">النوع</TableHead>
                  <TableHead className="text-start w-[14%]">العميل</TableHead>
                  <TableHead className="text-start w-[10%]">القيمة</TableHead>
                  <TableHead className="text-start w-[16%]">مراحل العمل</TableHead>
                  <TableHead className="text-start w-[22%]">الدفعات المرتبطة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.id} className="align-top">
                    <ContractCell contract={c} />
                    <TableCell>
                      <Badge variant="secondary" className="max-w-36 truncate font-normal" title={c.contractType}>
                        {c.contractType || "غير محدد"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.customerName}</TableCell>
                    <TableCell className="numeric font-semibold" dir="ltr">{formatKWD(c.amount)}</TableCell>
                    <TableCell>
                      <StageSelect contract={c} value={stagePick[c.id] ?? ""} onPick={setPick} />
                    </TableCell>
                    <TableCell>
                      <PaymentsForStage
                        contract={c}
                        stageId={stagePick[c.id] ?? ""}
                        manager={manager}
                        onFail={onFail}
                        compact
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* الجوال — بطاقة لكل عقد بنفس التدفق */}
          <div className="lg:hidden space-y-3">
            {filtered.map((c) => (
              <Card key={c.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm" dir="ltr">{c.contractNumber}</span>
                        <Badge className={`border-0 text-xs ${statusBadgeClass(c.status)}`}>{c.status}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{c.contractName || "—"}</p>
                    </div>
                    <span className="numeric text-sm font-bold whitespace-nowrap" dir="ltr">{formatKWD(c.amount)}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <Badge variant="secondary" className="font-normal">{c.contractType || "غير محدد"}</Badge>
                    <span className="text-muted-foreground">{c.customerName}</span>
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-muted-foreground">مراحل العمل</span>
                    <StageSelect contract={c} value={stagePick[c.id] ?? ""} onPick={setPick} />
                  </div>
                  <PaymentsForStage
                    contract={c}
                    stageId={stagePick[c.id] ?? ""}
                    manager={manager}
                    onFail={onFail}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* ملخص سفلي */}
      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {filtered.length} عقد — اختر مرحلة من عمود «مراحل العمل» لتظهر دفعاتها في العمود المجاور
        </p>
      )}
    </div>
  );
}

// ====================================================================
// خلية العقد — الرقم والاسم والحالة
// ====================================================================
function ContractCell({ contract }: { contract: SpContract }) {
  return (
    <TableCell>
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-sm whitespace-nowrap" dir="ltr">{contract.contractNumber}</span>
          <Badge className={`border-0 text-xs ${statusBadgeClass(contract.status)}`}>{contract.status}</Badge>
        </div>
        <p className="text-xs text-muted-foreground line-clamp-1" title={contract.contractName}>
          {contract.contractName || "—"}
        </p>
      </div>
    </TableCell>
  );
}

// ====================================================================
// عمود مراحل العمل — قائمة منسدلة بمراحل العقد (الاسم + نسبة الدفع)
// ====================================================================
function StageSelect({
  contract,
  value,
  onPick,
}: {
  contract: SpContract;
  value: string;
  onPick: (contractId: number, stageId: string) => void;
}) {
  const options = React.useMemo(
    () =>
      contract.stages.map((s, i) => ({
        value: String(s.id),
        label:
          `${i + 1}. ${s.name}` +
          (s.payPct > 0 ? ` — ${Number(s.payPct)}%` : "") +
          (s.isSkipped ? " (متخطاة)" : ""),
      })),
    [contract.stages]
  );

  if (contract.stages.length === 0) {
    return <span className="text-xs text-muted-foreground">بلا مراحل مسجلة</span>;
  }
  return (
    <SearchableSelect
      value={value}
      onValueChange={(v) => onPick(contract.id, v)}
      options={options}
      placeholder="اختر مرحلة…"
      searchPlaceholder="ابحث عن مرحلة…"
      emptyText="لا مراحل"
      aria-label={`مراحل العمل للعقد ${contract.contractNumber}`}
    />
  );
}

// ====================================================================
// عمود الدفعات المرتبطة — يظهر عند اختيار مرحلة:
// سطور الخطة المربوطة بها + ربط دفعة موجودة / إضافة دفعة / فك الربط (مدير)
// ====================================================================
function PaymentsForStage({
  contract,
  stageId,
  manager,
  onFail,
  compact = false,
}: {
  contract: SpContract;
  stageId: string;
  manager: boolean;
  onFail: (e: unknown, title: string) => void;
  compact?: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [linkOpen, setLinkOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [addTitle, setAddTitle] = React.useState("");
  const [addAmount, setAddAmount] = React.useState("");
  const [addDue, setAddDue] = React.useState(todayStr());

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["stage-payments"] });
    qc.invalidateQueries({ queryKey: ["contracts"] });
    qc.invalidateQueries({ queryKey: ["contract"] });
  }, [qc]);

  // فك ربط الدفعة عن المرحلة (stageId=null) — نفس مسار تعديل الخطة
  const unlinkMutation = useMutation({
    mutationFn: (lineId: number) =>
      apiPatch(`/api/contracts/${contract.id}/plan/${lineId}`, { stageId: null }),
    onSuccess: () => {
      invalidate();
      toast({ title: "تم فك ربط الدفعة عن المرحلة" });
    },
    onError: (e: unknown) => onFail(e, "تعذر فك الربط"),
  });

  // ربط دفعة موجودة بالمرحلة المختارة
  const linkMutation = useMutation({
    mutationFn: ({ lineId, stageId }: { lineId: number; stageId: string }) =>
      apiPatch(`/api/contracts/${contract.id}/plan/${lineId}`, { stageId: Number(stageId) }),
    onSuccess: () => {
      invalidate();
      setLinkOpen(false);
      toast({ title: "تم ربط الدفعة بالمرحلة" });
    },
    onError: (e: unknown) => onFail(e, "تعذر ربط الدفعة"),
  });

  // إضافة دفعة جديدة مربوطة بالمرحلة مباشرة (سقف مجموع الخطة محروس بالخادم)
  const addMutation = useMutation({
    mutationFn: () => {
      const amount = Number(addAmount);
      if (!addTitle.trim()) throw new Error("عنوان الدفعة مطلوب");
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("قيمة الدفعة يجب أن تكون أكبر من صفر");
      if (!addDue) throw new Error("تاريخ الاستحقاق مطلوب");
      return apiPost(`/api/contracts/${contract.id}/plan`, {
        title: addTitle.trim(),
        amount,
        dueDate: addDue,
        stageId: Number(stageId),
      });
    },
    onSuccess: () => {
      invalidate();
      setAddOpen(false);
      setAddTitle("");
      setAddAmount("");
      toast({ title: "أُضيفت الدفعة وارتبطت بالمرحلة" });
    },
    onError: (e: unknown) => onFail(e, "تعذر إضافة الدفعة"),
  });

  const stage = contract.stages.find((s) => String(s.id) === stageId);

  // بلا مرحلة مختارة — تلميح هادئ
  if (!stage) {
    return (
      <p className="text-xs text-muted-foreground">
        {contract.stages.length === 0 ? "—" : "اختر مرحلة لعرض دفعاتها"}
      </p>
    );
  }

  const linked = contract.payments.filter((p) => p.stageId === stage.id);
  const linkable = contract.payments.filter((p) => p.stageId !== stage.id);
  const linkedSum = linked.reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-2">
      {linked.length === 0 ? (
        <p className="text-xs text-muted-foreground">لا توجد دفعات مربوطة بهذه المرحلة</p>
      ) : (
        <div className={compact ? "space-y-1.5 max-h-56 overflow-y-auto pe-1" : "space-y-1.5"}>
          {linked.map((p) => {
            const paidUp = p.paid >= p.amount - 0.0005;
            const triggered = p.triggeredAt !== "";
            return (
              <div
                key={p.id}
                className="rounded-lg border bg-muted/40 px-2.5 py-1.5 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold truncate">{p.title}</span>
                  {manager && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0"
                      aria-label={`فك ربط الدفعة ${p.title} عن المرحلة ${stage.name}`}
                      title="فك الربط عن المرحلة"
                      disabled={unlinkMutation.isPending}
                      onClick={() => unlinkMutation.mutate(p.id)}
                    >
                      {unlinkMutation.isPending && unlinkMutation.variables === p.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Unlink className="size-3.5" />
                      )}
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                  <span className="numeric font-semibold text-foreground" dir="ltr">{formatKWD(p.amount)}</span>
                  <span>استحقاق: <span className="numeric" dir="ltr">{fmtDate(p.dueDate)}</span></span>
                  {p.paid > 0 && (
                    <span className="text-emerald-700 dark:text-emerald-400">
                      مسدد: <span className="numeric" dir="ltr">{formatKWD(p.paid)}</span>
                    </span>
                  )}
                  <Badge
                    className={`border-0 text-[10px] px-1.5 ${
                      paidUp
                        ? "bg-status-done-bg text-status-done"
                        : triggered
                        ? "bg-status-info-bg text-status-info"
                        : "bg-secondary text-secondary-foreground"
                    }`}
                  >
                    {paidUp ? "مسددة" : triggered ? "مستحقة" : "مجدولة"}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="numeric text-[11px] text-muted-foreground" dir="ltr">
          Σ {formatKWD(linkedSum)}
        </span>
        {manager && (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setLinkOpen(true)}
              disabled={linkable.length === 0}
              title={linkable.length === 0 ? "كل دفعات العقد مربوطة بهذه المرحلة" : undefined}
            >
              <Link2 className="size-3.5" aria-hidden />
              ربط دفعة
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => {
                setAddDue(todayStr());
                setAddOpen(true);
              }}
            >
              <Plus className="size-3.5" aria-hidden />
              إضافة
            </Button>
          </div>
        )}
      </div>

      {/* حوار ربط دفعة موجودة بالمرحلة */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>ربط دفعة بالمرحلة — {stage.name}</DialogTitle>
            <DialogDescription>
              دفعات العقد {contract.contractNumber} غير المربوطة بهذه المرحلة — اختر واحدة لربطها
              {linkable.length === 0 ? " (لا يوجد ما يمكن ربطه)" : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto space-y-1.5 pe-1">
            {linkable.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                كل دفعات هذا العقد مربوطة بالمرحلة المختارة بالفعل
              </p>
            ) : (
              linkable.map((p) => {
                const currentStage = contract.stages.find((s) => s.id === p.stageId);
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-semibold truncate">{p.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        <span className="numeric font-semibold text-foreground" dir="ltr">{formatKWD(p.amount)}</span>
                        {" · استحقاق "}
                        <span className="numeric" dir="ltr">{fmtDate(p.dueDate)}</span>
                        {currentStage ? ` · مربوطة حاليًا بـ«${currentStage.name}»` : " · بلا مرحلة"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="h-8 shrink-0 text-xs"
                      disabled={linkMutation.isPending}
                      onClick={() => linkMutation.mutate({ lineId: p.id, stageId })}
                    >
                      {linkMutation.isPending && linkMutation.variables?.lineId === p.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        "ربط"
                      )}
                    </Button>
                  </div>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-10" onClick={() => setLinkOpen(false)}>
              إغلاق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* حوار إضافة دفعة جديدة مربوطة بالمرحلة */}
      <Dialog open={addOpen} onOpenChange={(o) => !o && setAddOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>إضافة دفعة للمرحلة — {stage.name}</DialogTitle>
            <DialogDescription>
              الدفعة الجديدة ستدخل خطة العقد {contract.contractNumber} مربوطة بهذه المرحلة مباشرة
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor={`sp-title-${contract.id}`}>عنوان الدفعة</Label>
              <Input
                id={`sp-title-${contract.id}`}
                className="h-10"
                placeholder="مثال: الدفعة الثانية"
                value={addTitle}
                onChange={(e) => setAddTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`sp-amount-${contract.id}`}>المبلغ (د.ك)</Label>
              <Input
                id={`sp-amount-${contract.id}`}
                type="number"
                step="0.001"
                min="0"
                className="h-10 numeric text-start"
                dir="ltr"
                value={addAmount}
                onChange={(e) => setAddAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`sp-due-${contract.id}`}>تاريخ الاستحقاق</Label>
              <Input
                id={`sp-due-${contract.id}`}
                type="date"
                className="h-10 numeric text-start"
                dir="ltr"
                value={addDue}
                onChange={(e) => setAddDue(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-10" onClick={() => setAddOpen(false)}>
              إلغاء
            </Button>
            <Button
              className="h-10 gap-2"
              disabled={addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              {addMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              إضافة وربط
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
