"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Layers, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiGet, apiPost } from "./api";
import { SearchableSelect } from "./SearchableSelect";
import { errMessage, isManagerRole, type User } from "./contrack-types";
import { formatKWD, statusBadgeClass } from "@/lib/format";

interface ContractGroupsViewProps {
  user: User;
  onAuthError: () => void;
}

// ===== أنواع (مطابقة لعقد الـAPI) =====

interface GroupTotals {
  currentTotal: number;
  collectedTotal: number;
  paidTotal: number;
  subsTotal: number;
  costTotal: number;
  profitTotal: number;
  margin: number;
}

interface GroupRow {
  id: number;
  groupNumber: string;
  groupName: string;
  notes: string;
  status: string;
  customerId: number;
  customerName: string;
  contractsCount: number;
  createdBy: string;
  createdAt: string;
  totals: GroupTotals;
}

interface GroupsResponse {
  groups: GroupRow[];
}

interface GroupContractRow {
  id: number;
  contractNumber: string;
  contractName: string;
  contractType: string;
  status: string;
  amount: number;
  customerName: string;
}

interface GroupDetailResponse {
  group: GroupRow;
  contracts: GroupContractRow[];
  totals: GroupTotals;
}

interface CustomerOption {
  id: number;
  customerCode: string;
  name: string;
}

interface ContractListRow {
  id: number;
  contractNumber: string;
  contractName: string;
  contractType: string;
  status: string;
  amount: number;
}

/** رؤوس الجدول الرئيسي — عربية كما في المواصفة */
const HEADS = [
  "رقم المجموعة",
  "اسم المجموعة",
  "العميل",
  "عدد العقود",
  "القيمة الحالية",
  "المحصّل",
  "المنصرف",
  "التكلفة",
  "الربح",
  "الهامش ٪",
  "إجراءات",
];

const MoneyCells = ({ t }: { t: GroupTotals }) => (
  <>
    <TableCell className="whitespace-nowrap text-start tabular-nums">{formatKWD(t.currentTotal)}</TableCell>
    <TableCell className="whitespace-nowrap text-start tabular-nums">{formatKWD(t.collectedTotal)}</TableCell>
    <TableCell className="whitespace-nowrap text-start tabular-nums">{formatKWD(t.paidTotal)}</TableCell>
    <TableCell className="whitespace-nowrap text-start tabular-nums">{formatKWD(t.costTotal)}</TableCell>
  </>
);

// ===================================================================
// شاشة مجموعات العقود — المرجع الحرفي: contract_group_service.py (المكتبي)
// ===================================================================

export function ContractGroupsView({ user, onAuthError }: ContractGroupsViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const adminOnly = isManagerRole(user.role);

  const [customerId, setCustomerId] = React.useState<string>("all");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [viewId, setViewId] = React.useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<GroupRow | null>(null);

  const groupsQuery = useQuery<GroupsResponse>({
    queryKey: ["contract-groups", customerId],
    queryFn: () =>
      apiGet<GroupsResponse>(`/api/contract-groups${customerId !== "all" ? `?customerId=${customerId}` : ""}`),
  });

  const customersQuery = useQuery<{ customers: CustomerOption[] }>({
    queryKey: ["customers-groups-picker"],
    queryFn: () => apiGet<{ customers: CustomerOption[] }>("/api/customers"),
  });

  React.useEffect(() => {
    const e = groupsQuery.error || customersQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [groupsQuery.error, customersQuery.error, onAuthError]);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["contract-groups"] });
  };

  const fail = React.useCallback(
    (e: unknown, title: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title, description: errMessage(e) });
    },
    [onAuthError, toast]
  );

  const groups: GroupRow[] = groupsQuery.data?.groups ?? [];

  return (
    <div className="space-y-4" dir="rtl">
      {/* الترويسة */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Layers className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">🗂 مجموعات العقود</h1>
            <p className="text-xs text-muted-foreground">
              ضمّن عقود عميل واحد في مجموعة واعرض ربحيتها المجملة كما في المكتبي
            </p>
          </div>
        </div>
      </div>

      {/* شريط الأدوات: فلتر العميل + التحديث + إنشاء */}
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-sm">العميل</Label>
        <Select value={customerId} onValueChange={setCustomerId}>
          <SelectTrigger className="h-9 w-full max-w-64 gap-2 sm:w-64">
            <SelectValue placeholder="كل العملاء" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="all">كل العملاء</SelectItem>
            {(customersQuery.data?.customers ?? []).map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name} — {c.customerCode}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          onClick={refreshAll}
          disabled={groupsQuery.isFetching}
        >
          <RefreshCw className={`size-4 ${groupsQuery.isFetching ? "animate-spin" : ""}`} />
          ↻ تحديث
        </Button>
        <div className="hidden flex-1 sm:block" />
        <Button size="sm" className="h-9 gap-1.5" onClick={() => setCreateOpen(true)}>
          ＋ مجموعة جديدة
        </Button>
      </div>

      {/* جدول المجموعات */}
      <Card className="p-0">
        <CardContent className="p-2 sm:p-3">
          {groupsQuery.isLoading ? (
            <div className="space-y-2 p-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              لا مجموعات عقود بعد — اضغط «＋ مجموعة جديدة» لضم عقدين أو أكثر لعميل واحد.
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted">
                  <TableRow>
                    {HEADS.map((h, i) => (
                      <TableHead key={i} className={`whitespace-nowrap ${i >= 4 && i <= 9 ? "text-start" : ""}`}>
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell className="whitespace-nowrap font-medium" dir="ltr">
                        {g.groupNumber}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span>{g.groupName}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusBadgeClass(g.status)}`}>
                            {g.status}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{g.customerName}</TableCell>
                      <TableCell className="tabular-nums">{g.contractsCount}</TableCell>
                      <MoneyCells t={g.totals} />
                      <TableCell
                        className={`whitespace-nowrap text-start font-bold tabular-nums ${
                          g.totals.profitTotal < -0.001 ? "text-status-danger" : "text-status-done"
                        }`}
                      >
                        {formatKWD(g.totals.profitTotal)}
                      </TableCell>
                      <TableCell
                        className={`whitespace-nowrap text-start font-bold tabular-nums ${
                          g.totals.profitTotal < -0.001 ? "text-status-danger" : "text-status-done"
                        }`}
                      >
                        {g.totals.margin.toFixed(1)}٪
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1 px-2"
                            onClick={() => setViewId(g.id)}
                            aria-label={`عرض المجموعة ${g.groupNumber}`}
                          >
                            <Eye className="size-4" />
                            👁 عرض
                          </Button>
                          {adminOnly && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1 px-2 text-status-danger hover:text-status-danger"
                              onClick={() => setDeleteTarget(g)}
                              aria-label={`حذف المجموعة ${g.groupNumber}`}
                            >
                              <Trash2 className="size-4" />
                              🗑 حذف
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* نافذة الإنشاء */}
      <CreateGroupDialog
        open={createOpen}
        onOpenChange={(v) => {
          setCreateOpen(v);
          if (v) refreshAll();
        }}
        onCreated={refreshAll}
        onFail={fail}
      />

      {/* نافذة العرض */}
      <ViewGroupDialog groupId={viewId} onClose={() => setViewId(null)} onAuthError={onAuthError} />

      {/* نافذة تأكيد الحذف */}
      <DeleteGroupDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refreshAll}
        onFail={fail}
      />
    </div>
  );
}

// ==================== نافذة الإنشاء ====================

function CreateGroupDialog({
  open,
  onOpenChange,
  onCreated,
  onFail,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
  onFail: (e: unknown, title: string) => void;
}) {
  const { toast } = useToast();
  const [customerId, setCustomerId] = React.useState<string>("");
  const [groupName, setGroupName] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [selected, setSelected] = React.useState<Set<number>>(new Set());

  const customersQuery = useQuery<{ customers: CustomerOption[] }>({
    queryKey: ["customers-groups-picker"],
    queryFn: () => apiGet<{ customers: CustomerOption[] }>("/api/customers"),
  });

  const contractsQuery = useQuery<{ contracts: ContractListRow[] }>({
    queryKey: ["contract-groups", "customer-contracts", customerId],
    queryFn: () => apiGet<{ contracts: ContractListRow[] }>(`/api/contracts?customerId=${customerId}`),
    enabled: open && !!customerId,
  });

  // العقود القابلة للضم — الملغى مستبعد كالمكتبي
  const selectable: ContractListRow[] = React.useMemo(
    () => (contractsQuery.data?.contracts ?? []).filter((c) => c.status !== "ملغى"),
    [contractsQuery.data]
  );

  const reset = () => {
    setCustomerId("");
    setGroupName("");
    setNotes("");
    setSelected(new Set());
  };

  const createMut = useMutation({
    mutationFn: (payload: { customerId: number; groupName: string; contractIds: number[]; notes: string }) =>
      apiPost<{ group: { id: number; groupNumber: string; groupName: string } }>("/api/contract-groups", payload),
    onSuccess: (res) => {
      toast({ title: "أُنشئت المجموعة ✅", description: `${res.group.groupNumber} — ${res.group.groupName}` });
      reset();
      onOpenChange(false);
      onCreated();
    },
    onError: (e) => onFail(e, "تعذر إنشاء المجموعة"),
  });

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSubmit = !!customerId && selected.size >= 2 && groupName.trim().length > 0 && !createMut.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>＋ مجموعة جديدة</DialogTitle>
          <DialogDescription>
            اختر عميلًا ثم عقدين أو أكثر من عقوده (الملغى مستبعد) — ربط تنظيمي لا يغيّر العقود ماليًا.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>العميل *</Label>
            <SearchableSelect
              value={customerId || ""}
              onValueChange={(v) => {
                setCustomerId(v);
                setSelected(new Set());
              }}
              options={(customersQuery.data?.customers ?? []).map((c) => ({
                value: String(c.id),
                label: `${c.name} — ${c.customerCode}`,
              }))}
              placeholder="اختر العميل"
              searchPlaceholder="ابحث بالاسم أو الكود…"
              emptyText="لا نتائج مطابقة"
              allowClear
              clearLabel="إلغاء تحديد العميل"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>عقود العميل *</Label>
              <span className="text-xs text-muted-foreground">
                المحدد: {selected.size} {selected.size < 2 ? "(يلزم عقدين على الأقل)" : ""}
              </span>
            </div>
            {!customerId ? (
              <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
                اختر العميل أولًا لتظهر عقوده.
              </p>
            ) : contractsQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : selectable.length === 0 ? (
              <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
                لا عقود قابلة للضم لهذا العميل (الملغى مستبعد).
              </p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
                {selectable.map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={selected.has(c.id)}
                      onCheckedChange={() => toggle(c.id)}
                      aria-label={`اختيار العقد ${c.contractNumber}`}
                    />
                    <span className="whitespace-nowrap font-medium" dir="ltr">
                      {c.contractNumber}
                    </span>
                    <span className="flex-1 truncate">
                      — {c.contractName || "بدون اسم"}
                    </span>
                    <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                      ({formatKWD(c.amount)})
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>اسم المجموعة *</Label>
            <Input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="مثال: حزمة مشروع الخيران"
            />
          </div>

          <div className="space-y-1.5">
            <Label>ملاحظات</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="اختياري"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createMut.isPending}>
            إلغاء
          </Button>
          <Button onClick={() => createMut.mutate({ customerId: Number(customerId), groupName: groupName.trim(), contractIds: [...selected], notes })} disabled={!canSubmit}>
            {createMut.isPending ? "جارٍ الإنشاء…" : "إنشاء المجموعة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== نافذة العرض ====================

function ViewGroupDialog({
  groupId,
  onClose,
  onAuthError,
}: {
  groupId: number | null;
  onClose: () => void;
  onAuthError: () => void;
}) {
  const detailQuery = useQuery<GroupDetailResponse>({
    queryKey: ["contract-groups", groupId, "detail"],
    queryFn: () => apiGet<GroupDetailResponse>(`/api/contract-groups/${groupId}`),
    enabled: groupId !== null,
  });

  React.useEffect(() => {
    const e = detailQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [detailQuery.error, onAuthError]);

  const g = detailQuery.data?.group ?? null;
  const contracts = detailQuery.data?.contracts ?? [];
  const t = detailQuery.data?.totals;

  const profitColor = t && t.profitTotal < -0.001 ? "text-status-danger" : "text-status-done";

  return (
    <Dialog open={groupId !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>👁 المجموعة {g ? `${g.groupNumber} — ${g.groupName}` : ""}</DialogTitle>
          <DialogDescription>
            {g ? (
              <span className="flex flex-wrap items-center gap-2">
                <span>العميل: {g.customerName}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusBadgeClass(g.status)}`}>
                  {g.status}
                </span>
                <span>· أنشأها {g.createdBy || "—"} في {g.createdAt}</span>
                {g.notes ? <span className="block">📝 {g.notes}</span> : null}
              </span>
            ) : (
              "…"
            )}
          </DialogDescription>
        </DialogHeader>

        {detailQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : (
          <>
            <div className="max-h-64 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted">
                  <TableRow>
                    {["رقم العقد", "الاسم", "النوع", "الحالة", "المبلغ"].map((h, i) => (
                      <TableHead key={i} className={`whitespace-nowrap ${i === 4 ? "text-start" : ""}`}>
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contracts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                        لا عقود ضمن هذه المجموعة.
                      </TableCell>
                    </TableRow>
                  ) : (
                    contracts.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="whitespace-nowrap font-medium" dir="ltr">
                          {c.contractNumber}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{c.contractName || "بدون اسم"}</TableCell>
                        <TableCell className="whitespace-nowrap">{c.contractType}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusBadgeClass(c.status)}`}>
                            {c.status}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-start tabular-nums">
                          {formatKWD(c.amount)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {t && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <TotalsCard caption="القيمة الحالية" value={formatKWD(t.currentTotal)} bg="bg-status-info-bg" fg="text-status-info" />
                <TotalsCard caption="المحصّل" value={formatKWD(t.collectedTotal)} bg="bg-status-done-bg" fg="text-status-done" />
                <TotalsCard caption="المنصرف" value={formatKWD(t.paidTotal)} bg="bg-status-warn-bg" fg="text-status-warn" />
                <TotalsCard caption="التكلفة" value={formatKWD(t.costTotal)} bg="bg-secondary" fg="text-secondary-foreground" />
                <TotalsCard caption="الربح" value={formatKWD(t.profitTotal)} bg="bg-status-done-bg" fg={profitColor} strong />
                <TotalsCard caption="الهامش" value={`${t.margin.toFixed(1)}٪`} bg="bg-status-done-bg" fg={profitColor} strong />
                <TotalsCard caption="التزامات الباطن" value={formatKWD(t.subsTotal)} bg="bg-status-warn-bg" fg="text-status-warn" />
                <TotalsCard caption="عدد العقود" value={String(g?.contractsCount ?? contracts.length)} bg="bg-muted" fg="text-foreground" />
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TotalsCard({
  caption,
  value,
  bg,
  fg,
  strong,
}: {
  caption: string;
  value: string;
  bg: string;
  fg: string;
  strong?: boolean;
}) {
  return (
    <div className={`rounded-xl px-3 py-2.5 ${bg}`}>
      <div className={`text-xs font-bold ${fg}`}>{caption}</div>
      <div className={`mt-0.5 tabular-nums ${fg} ${strong ? "text-lg font-black" : "text-base font-bold"}`}>
        {value}
      </div>
    </div>
  );
}

// ==================== نافذة تأكيد الحذف (إضافة ويب — للمدير فقط) ====================

function DeleteGroupDialog({
  target,
  onClose,
  onDeleted,
  onFail,
}: {
  target: GroupRow | null;
  onClose: () => void;
  onDeleted: () => void;
  onFail: (e: unknown, title: string) => void;
}) {
  const { toast } = useToast();

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiDelete<{ ok: boolean; id: number }>(`/api/contract-groups/${id}`),
    onSuccess: () => {
      toast({ title: "تم حذف المجموعة ✅", description: "لم يُحذف أي عقد — الربط التنظيمي فقط." });
      onClose();
      onDeleted();
    },
    onError: (e) => onFail(e, "تعذر حذف المجموعة"),
  });

  return (
    <Dialog open={target !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>🗑 حذف المجموعة</DialogTitle>
          <DialogDescription>
            {target ? `هل تريد حذف المجموعة ${target.groupNumber}؟ لن يُحذف أي عقد.` : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={deleteMut.isPending}>
            إلغاء
          </Button>
          <Button
            variant="destructive"
            onClick={() => target && deleteMut.mutate(target.id)}
            disabled={deleteMut.isPending || !target}
          >
            {deleteMut.isPending ? "جارٍ الحذف…" : "حذف المجموعة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
