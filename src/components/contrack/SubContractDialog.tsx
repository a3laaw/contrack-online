"use client";

/**
 * نافذة تفاصيل عقد الباطن + مكونات مشتركة قابلة لإعادة الاستخدام.
 * تفكيك شكلي فقط: المنطق (استعلامات/mutations/تحققات) كله في هوك useSubContractDetail
 * والمكونات العرضية مشتركة بين النافذة وصفحة «عقد باتن جديد» (SubContractNewPage) — بلا أي تغيير منطق.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Banknote,
  Ban,
  Loader2,
  Lock,
  Plus,
  Trash2,
  Wallet,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./api";
import { errMessage, isManagerRole } from "./contrack-types";
import type {
  BoqResponse,
  PlanResponse,
  SubContractDetailResponse,
  SubContractItemsResponse,
  SubPayBlocksResponse,
  SubPlanLine,
  User,
  VouchersResponse,
} from "./contrack-types";
import { fmtDate, formatKWD } from "@/lib/format";
import { SubDeleteDialog } from "./SubDeleteDialog";
import { StatusBadge } from "./StatusBadge";

interface SubContractDialogProps {
  subContractId: number | null;
  onOpenChange: (open: boolean) => void;
  user: User;
  onAuthError: () => void;
  /** صرف على هذا الباطن — صفحة سند كاملة تفتحها الشاشة الأم (بلا نوافذ داخلية) */
  onPay: () => void;
}

export interface DraftItem {
  key: string;
  boqItemId?: number | null;
  description: string;
  qty: string;
  unitPrice: string;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ===================================================================
// الهوك المشترك: كل استعلامات ومنطق تفاصيل عقد الباطن (حرفيًا كما كانت بالنافذة)
// ===================================================================
export function useSubContractDetail(subContractId: number | null, user: User, onAuthError: () => void) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);

  const open = subContractId !== null;

  const detailQuery = useQuery<SubContractDetailResponse>({
    queryKey: ["sub-contract", subContractId],
    queryFn: () => apiGet<SubContractDetailResponse>(`/api/sub-contracts/${subContractId}`),
    enabled: open,
  });
  const item = detailQuery.data?.item ?? null;

  const itemsQuery = useQuery<SubContractItemsResponse>({
    queryKey: ["sub-contract", subContractId, "items"],
    queryFn: () => apiGet<SubContractItemsResponse>(`/api/sub-contracts/${subContractId}/items`),
    enabled: open,
  });

  const payBlocksQuery = useQuery<SubPayBlocksResponse>({
    queryKey: ["sub-contract", subContractId, "pay-blocks"],
    queryFn: () => apiGet<SubPayBlocksResponse>(`/api/sub-contracts/${subContractId}/pay-blocks`),
    enabled: open,
  });

  const vouchersQuery = useQuery<VouchersResponse>({
    queryKey: ["vouchers", `partyType=subcontractor&partyId=${item?.subcontractor?.id ?? ""}`],
    queryFn: () =>
      apiGet<VouchersResponse>(
        `/api/vouchers?partyType=subcontractor&partyId=${item?.subcontractor?.id ?? ""}`
      ),
    enabled: open && !!item?.subcontractor?.id,
  });

  const boqQuery = useQuery<BoqResponse>({
    queryKey: ["contract", item?.contract?.id, "boq"],
    queryFn: () => apiGet<BoqResponse>(`/api/contracts/${item?.contract?.id}/boq`),
    enabled: open && !!item?.contract?.id,
  });

  const clientPlanQuery = useQuery<PlanResponse>({
    queryKey: ["contract", item?.contract?.id, "plan"],
    queryFn: () => apiGet<PlanResponse>(`/api/contracts/${item?.contract?.id}/plan`),
    enabled: open && !!item?.contract?.id,
  });

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["sub-contract", subContractId] });
    qc.invalidateQueries({ queryKey: ["sub-contracts"] });
    qc.invalidateQueries({ queryKey: ["subcontractors"] });
    qc.invalidateQueries({ queryKey: ["vouchers"] });
    qc.invalidateQueries({ queryKey: ["contract"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }, [qc, subContractId]);

  // ===== بنود عقد الباطن =====
  const [draftItems, setDraftItems] = React.useState<DraftItem[]>([]);
  const [itemsDirty, setItemsDirty] = React.useState(false);

  React.useEffect(() => {
    if (!itemsQuery.data || itemsDirty) return;
    setDraftItems(
      (itemsQuery.data.items ?? []).map((it, i) => ({
        key: `r${it.id}-${i}`,
        boqItemId: it.boqItemId ?? null,
        description: it.description,
        qty: String(it.qty ?? 1),
        unitPrice: String(it.unitPrice ?? 0),
      }))
    );
  }, [itemsQuery.data, itemsDirty]);

  const saveItemsMutation = useMutation({
    mutationFn: () =>
      apiPut(`/api/sub-contracts/${subContractId}/items`, {
        items: draftItems.map((d) => ({
          ...(d.boqItemId ? { boqItemId: d.boqItemId } : {}),
          description: d.description.trim(),
          qty: Number(d.qty || 1),
          unitPrice: Number(d.unitPrice || 0),
        })),
      }),
    onSuccess: () => {
      invalidate();
      setItemsDirty(false);
      toast({ title: "تم الحفظ", description: "حُدّثت بنود عقد الباطن" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر حفظ البنود", description: errMessage(e) });
    },
  });

  const addFromBoq = (boqId: string) => {
    const b = (boqQuery.data?.items ?? []).find((x) => String(x.id) === boqId);
    if (!b) return;
    setDraftItems((prev) => [
      ...prev,
      { key: `b${b.id}-${prev.length}`, boqItemId: b.id, description: b.description, qty: String(b.qty), unitPrice: String(b.unitPrice) },
    ]);
    setItemsDirty(true);
  };

  // ===== إضافة خط خطة =====
  const [addPlanOpen, setAddPlanOpen] = React.useState(false);
  const [planForm, setPlanForm] = React.useState({ title: "", amount: "", dueDate: todayStr() });
  const [sourceIds, setSourceIds] = React.useState<number[]>([]);

  const clientDueLines = (clientPlanQuery.data?.lines ?? []).filter(
    (l) => Number(l.remaining) > 0.001 && !["paid", "skipped"].includes(l.state)
  );

  const addPlanMutation = useMutation({
    mutationFn: () =>
      apiPost(`/api/sub-contracts/${subContractId}/plan`, {
        title: planForm.title.trim(),
        amount: Number(planForm.amount || 0),
        dueDate: planForm.dueDate,
        sources: sourceIds.map((planLineId) => ({ planLineId })),
      }),
    onSuccess: () => {
      invalidate();
      setAddPlanOpen(false);
      setPlanForm({ title: "", amount: "", dueDate: todayStr() });
      setSourceIds([]);
      toast({ title: "تمت الإضافة", description: "أُضيف خط الدفعة لخطة الباطن" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر إضافة الخط", description: errMessage(e) });
    },
  });

  const [deletePlanId, setDeletePlanId] = React.useState<number | null>(null);
  const deletePlanMutation = useMutation({
    mutationFn: (lineId: number) => apiDelete(`/api/sub-contracts/${subContractId}/plan/${lineId}`),
    onSuccess: () => {
      invalidate();
      setDeletePlanId(null);
      toast({ title: "تم الحذف", description: "حُذف خط الدفعة" });
    },
    onError: (e) => {
      setDeletePlanId(null);
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر حذف الخط", description: errMessage(e) });
    },
  });

  // ===== توزيع تلقائي =====
  const [distributeOpen, setDistributeOpen] = React.useState(false);
  const [distForm, setDistForm] = React.useState({ total: "", count: "3", useBoq: false });
  const [distBoqIds, setDistBoqIds] = React.useState<number[]>([]);

  const distributeMutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { total: Number(distForm.total || 0) };
      if (distForm.useBoq && distBoqIds.length > 0) body.boqItemIds = distBoqIds;
      else body.count = Number(distForm.count || 3);
      return apiPost(`/api/sub-contracts/${subContractId}/plan/distribute`, body);
    },
    onSuccess: () => {
      invalidate();
      setDistributeOpen(false);
      setDistBoqIds([]);
      toast({ title: "تم التوزيع", description: "وُزّع المبلغ على خطة دفعات الباطن" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر التوزيع", description: errMessage(e) });
    },
  });

  // ===== صرف على الباطن =====

  // ===== إلغاء / حذف عقد الباطن =====
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState("");
  // V5.8: الحذف عبر نافذة الخيارات المعتمدة SubDeleteDialog (بلا حذف مباشر)
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const cancelMutation = useMutation({
    mutationFn: () => apiPatch(`/api/sub-contracts/${subContractId}`, { status: "ملغى", reason: cancelReason.trim() }),
    onSuccess: () => {
      invalidate();
      setCancelOpen(false);
      setCancelReason("");
      toast({ title: "تم إلغاء عقد الباطن", description: "أُرشِف العقد الباطن وفُكّت روابطه المالية السارية" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر الإلغاء", description: errMessage(e) });
    },
  });

  const planLines: SubPlanLine[] = item?.plan ?? [];

  return {
    manager,
    open,
    detailQuery,
    item,
    itemsQuery,
    payBlocksQuery,
    vouchersQuery,
    boqQuery,
    clientPlanQuery,
    invalidate,
    draftItems,
    setDraftItems,
    itemsDirty,
    setItemsDirty,
    saveItemsMutation,
    addFromBoq,
    addPlanOpen,
    setAddPlanOpen,
    planForm,
    setPlanForm,
    sourceIds,
    setSourceIds,
    clientDueLines,
    addPlanMutation,
    deletePlanId,
    setDeletePlanId,
    deletePlanMutation,
    distributeOpen,
    setDistributeOpen,
    distForm,
    setDistForm,
    distBoqIds,
    setDistBoqIds,
    distributeMutation,
    cancelOpen,
    setCancelOpen,
    cancelReason,
    setCancelReason,
    cancelMutation,
    deleteOpen,
    setDeleteOpen,
    planLines,
  };
}

// ===================================================================
// مكونات عرض مشتركة (تُستخدم بالنافذة وصفحة «عقد باطن جديد»)
// ===================================================================

/** البطاقات المالية الثلاث */
export function SubFinCards({ item }: { item: NonNullable<SubContractDetailResponse["item"]> }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <Card className="gap-1 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">القيمة</span>
          <Wallet className="size-3.5 text-primary/70" />
        </div>
        <div className="text-sm font-bold tabular-nums lg:text-base" dir="ltr">{formatKWD(item.amount)}</div>
      </Card>
      <Card className="gap-1 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">المدفوع</span>
          <Banknote className="size-3.5 text-primary/70" />
        </div>
        <div className="text-sm font-bold tabular-nums text-status-done lg:text-base" dir="ltr">
          {formatKWD(item.paid)}
        </div>
      </Card>
      <Card className="gap-1 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">سقف الصرف المتبقي</span>
          <AlertTriangle className="size-3.5 text-status-warn" />
        </div>
        <div className="text-sm font-bold tabular-nums text-status-warn lg:text-base" dir="ltr">
          {formatKWD(item.capRemaining ?? item.remaining)}
        </div>
      </Card>
    </div>
  );
}

/** محرر بنود عقد الباطن (إضافة من الكميات/يدوي + الجدول + حفظ/تراجع) */
export function SubItemsEditor({
  boqItems,
  draftItems,
  setDraftItems,
  dirty,
  setItemsDirty,
  serverItems,
  onAddFromBoq,
  saving,
  onSave,
}: {
  boqItems: BoqResponse["items"];
  draftItems: DraftItem[];
  setDraftItems: React.Dispatch<React.SetStateAction<DraftItem[]>>;
  dirty: boolean;
  setItemsDirty: (v: boolean) => void;
  serverItems?: SubContractItemsResponse;
  onAddFromBoq: (boqId: string) => void;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {boqItems.length > 0 && (
          <Select onValueChange={(v) => v !== "none" && onAddFromBoq(v)} value="none">
            <SelectTrigger className="h-9 w-52">
              <SelectValue placeholder="إضافة من بنود الكميات…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">إضافة من بنود الكميات…</SelectItem>
              {boqItems.map((b) => (
                <SelectItem key={b.id} value={String(b.id)}>
                  {b.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => {
            setDraftItems((p) => [...p, { key: `m${Date.now()}`, description: "", qty: "1", unitPrice: "" }]);
            setItemsDirty(true);
          }}
        >
          <Plus className="size-3.5" />
          بند يدوي
        </Button>
      </div>

      {draftItems.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            لا بنود — أضف من بنود كميات عقد العميل أو يدويًا.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead>الوصف</TableHead>
                <TableHead className="w-20">الكمية</TableHead>
                <TableHead className="w-28">سعر الوحدة</TableHead>
                <TableHead className="w-24 text-start">المبلغ</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {draftItems.map((d, i) => (
                <TableRow key={d.key}>
                  <TableCell>
                    {d.boqItemId ? (
                      <span className="text-sm">{d.description}</span>
                    ) : (
                      <Input
                        className="h-8"
                        placeholder="وصف البند"
                        value={d.description}
                        onChange={(e) => {
                          setDraftItems((p) => p.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)));
                          setItemsDirty(true);
                        }}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8"
                      dir="ltr"
                      type="number"
                      min="0"
                      step="0.001"
                      value={d.qty}
                      onChange={(e) => {
                        setDraftItems((p) => p.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)));
                        setItemsDirty(true);
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8"
                      dir="ltr"
                      type="number"
                      min="0"
                      step="0.001"
                      value={d.unitPrice}
                      onChange={(e) => {
                        setDraftItems((p) => p.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)));
                        setItemsDirty(true);
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {formatKWD(Number(d.qty || 0) * Number(d.unitPrice || 0))}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive hover:text-destructive"
                      onClick={() => {
                        setDraftItems((p) => p.filter((_, j) => j !== i));
                        setItemsDirty(true);
                      }}
                      aria-label="حذف"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {dirty && (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => {
              setItemsDirty(false);
              if (serverItems)
                setDraftItems(
                  serverItems.items.map((it, i) => ({
                    key: `r${it.id}-${i}`,
                    boqItemId: it.boqItemId ?? null,
                    description: it.description,
                    qty: String(it.qty ?? 1),
                    unitPrice: String(it.unitPrice ?? 0),
                  }))
                );
            }}
          >
            تراجع
          </Button>
          <Button size="sm" className="h-9" disabled={saving} onClick={onSave}>
            {saving ? "جارٍ الحفظ…" : "حفظ البنود"}
          </Button>
        </div>
      )}
    </>
  );
}

/** جدول خطوط خطة دفعات الباطن */
export function SubPlanLinesTable({
  lines,
  manager,
  onDelete,
}: {
  lines: SubPlanLine[];
  manager: boolean;
  onDelete: (lineId: number) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="max-h-64 overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-muted">
            <TableRow>
              <TableHead>الخط</TableHead>
              <TableHead className="w-28">الاستحقاق</TableHead>
              <TableHead className="w-24 text-start">المبلغ</TableHead>
              <TableHead className="w-40">الحالة</TableHead>
              {manager && <TableHead className="w-10"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="max-w-40">
                  <span className="block truncate font-medium">{l.title}</span>
                  {(l.sources?.length ?? 0) > 0 && (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      مصادره: {l.sources!.map((s) => s.title).join("، ")}
                    </span>
                  )}
                </TableCell>
                <TableCell className="tabular-nums" dir="ltr">{fmtDate(l.dueDate)}</TableCell>
                <TableCell className="text-end font-bold tabular-nums" dir="ltr">{formatKWD(l.amount)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <StatusBadge status={l.state || ""} label={l.stateLabel || l.state || "—"} className="text-[11px]" />
                    {l.gated && (
                      <Badge className="bg-status-done-bg text-status-done">
                        <Lock className="size-3" />
                        موقوفة ببوابة تحصيل العميل
                      </Badge>
                    )}
                  </div>
                </TableCell>
                {manager && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive hover:text-destructive"
                      onClick={() => onDelete(l.id)}
                      aria-label="حذف الخط"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** جدول كتل الدفع (مقارنة دفعات العميل بخطوط الباطن) */
export function SubBlocksTable({ loading, rows }: { loading: boolean; rows: SubPayBlocksResponse["rows"] }) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          لا كتل دفع — تظهر مقارنة دفعات العميل بخطوط الباطن بعد إعداد الخطة.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="max-h-72 overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-muted">
            <TableRow>
              <TableHead>دفعة العميل</TableHead>
              <TableHead className="w-24 text-start">قيمتها</TableHead>
              <TableHead className="w-24 text-start">المغطى</TableHead>
              <TableHead>خطوط الباطن المرتبطة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell>
                  <div className="text-sm font-medium">{r.custTitle}</div>
                  <StatusBadge status={r.custState || ""} className="mt-1 text-[10px]" />
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">{formatKWD(r.custAmount)}</TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">{formatKWD(r.custCovered)}</TableCell>
                <TableCell>
                  {r.subLines.length === 0 ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    <div className="space-y-1">
                      {r.subLines.map((sl) => (
                        <div key={sl.id} className="flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                          <span className="font-medium">{sl.title}</span>
                          <span className="tabular-nums text-muted-foreground" dir="ltr">{formatKWD(sl.amount)}</span>
                          <StatusBadge status={sl.state || ""} label={sl.stateLabel || sl.state} className="text-[10px]" />
                          {sl.gated && <Lock className="size-3 text-muted-foreground" />}
                        </div>
                      ))}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** قائمة سندات المقاول */
export function SubVouchersList({ vouchers }: { vouchers: VouchersResponse["items"] }) {
  if (vouchers.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          لا سندات على هذا المقاول بعد — استخدم «صرف على هذا الباطن».
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {vouchers.map((v) => (
        <div key={v.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 ${v.cancelled ? "opacity-50" : ""}`}>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" dir="ltr">{v.voucherNumber}</Badge>
            <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">{fmtDate(v.vdate)}</span>
            {v.cancelled && <StatusBadge status="ملغى" />}
          </div>
          <span className="font-bold tabular-nums" dir="ltr">{formatKWD(v.amount)}</span>
        </div>
      ))}
    </div>
  );
}

/** حقول «إضافة دفعة لخطة الباطن» (بدون الغلاف — نافذة في النافذة الأصلية وقسم inline في الصفحة) */
export function AddPlanFields({
  planForm,
  setPlanForm,
  clientDueLines,
  sourceIds,
  setSourceIds,
}: {
  planForm: { title: string; amount: string; dueDate: string };
  setPlanForm: React.Dispatch<React.SetStateAction<{ title: string; amount: string; dueDate: string }>>;
  clientDueLines: PlanResponse["lines"];
  sourceIds: number[];
  setSourceIds: React.Dispatch<React.SetStateAction<number[]>>;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="sp-title">الوصف *</Label>
          <Input id="sp-title" className="h-9" value={planForm.title} onChange={(e) => setPlanForm((f) => ({ ...f, title: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sp-amount">المبلغ *</Label>
          <Input id="sp-amount" className="h-9" dir="ltr" type="number" min="0" step="0.001" value={planForm.amount} onChange={(e) => setPlanForm((f) => ({ ...f, amount: e.target.value }))} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="sp-due">الاستحقاق التقديري</Label>
          <Input id="sp-due" className="h-9" dir="ltr" type="date" value={planForm.dueDate} onChange={(e) => setPlanForm((f) => ({ ...f, dueDate: e.target.value }))} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>مصادر من دفعات العميل (متعدد)</Label>
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
          {clientDueLines.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">لا دفعات عميل متاحة للاختيار — يمكن ترك الخط بلا مصادر.</p>
          ) : (
            clientDueLines.map((l) => (
              <label key={l.id} className="flex items-start gap-2 rounded-md p-1.5 text-xs hover:bg-muted/60">
                <Checkbox
                  className="mt-0.5"
                  checked={sourceIds.includes(l.id)}
                  onCheckedChange={(c) => setSourceIds((p) => (c ? [...p, l.id] : p.filter((x) => x !== l.id)))}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{l.title}</span>
                  <span className="text-muted-foreground" dir="ltr">
                    {fmtDate(l.dueDate)} — متبقٍ {formatKWD(l.remaining)}
                  </span>
                </span>
              </label>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** زر اختيار نمط التوزيع */
export function SwitchLike({ checked, onClick, label }: { checked: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
        checked ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}

/** حقول «توزيع تلقائي لخطة الدفعات» (بدون الغلاف) */
export function DistributeFields({
  distForm,
  setDistForm,
  boqItems,
  distBoqIds,
  setDistBoqIds,
}: {
  distForm: { total: string; count: string; useBoq: boolean };
  setDistForm: React.Dispatch<React.SetStateAction<{ total: string; count: string; useBoq: boolean }>>;
  boqItems: BoqResponse["items"];
  distBoqIds: number[];
  setDistBoqIds: React.Dispatch<React.SetStateAction<number[]>>;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="dt-total">الإجمالي *</Label>
        <Input id="dt-total" className="h-9" dir="ltr" type="number" min="0" step="0.001" value={distForm.total} onChange={(e) => setDistForm((f) => ({ ...f, total: e.target.value }))} />
      </div>
      <div className="flex items-center gap-2">
        <SwitchLike checked={!distForm.useBoq} onClick={() => setDistForm((f) => ({ ...f, useBoq: false }))} label="عدد دفعات متساوية" />
        <SwitchLike checked={distForm.useBoq} onClick={() => setDistForm((f) => ({ ...f, useBoq: true }))} label="على بنود الكميات" />
      </div>
      {!distForm.useBoq ? (
        <div className="space-y-1.5">
          <Label htmlFor="dt-count">عدد الخطوط</Label>
          <Input id="dt-count" className="h-9" dir="ltr" type="number" min="1" value={distForm.count} onChange={(e) => setDistForm((f) => ({ ...f, count: e.target.value }))} />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label>بنود الكميات (متعدد)</Label>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
            {boqItems.length === 0 ? (
              <p className="p-2 text-xs text-muted-foreground">لا بنود كميات على عقد العميل.</p>
            ) : (
              boqItems.map((b) => (
                <label key={b.id} className="flex items-center gap-2 rounded-md p-1.5 text-xs hover:bg-muted/60">
                  <Checkbox
                    checked={distBoqIds.includes(b.id)}
                    onCheckedChange={(c) => setDistBoqIds((p) => (c ? [...p, b.id] : p.filter((x) => x !== b.id)))}
                  />
                  <span className="min-w-0 flex-1 truncate">{b.description}</span>
                  <span className="tabular-nums text-muted-foreground" dir="ltr">{formatKWD(b.amount)}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ===================================================================
// نافذة تفاصيل عقد الباطن — نفس السلوك السابق مركّبة من المكونات المشتركة
// ===================================================================
export function SubContractDialog({ subContractId, onOpenChange, user, onAuthError, onPay }: SubContractDialogProps) {
  const s = useSubContractDetail(subContractId, user, onAuthError);
  const open = subContractId !== null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>عقد باطن — {s.item?.subcontractor?.name ?? "…"}</DialogTitle>
            <DialogDescription>
              عقد العميل: {s.item?.contract?.contractNumber ?? "—"} — الاستحقاق باكتمال مصادره من دفعات العميل.
            </DialogDescription>
          </DialogHeader>

          {s.detailQuery.isLoading ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-lg" />
                ))}
              </div>
              <Skeleton className="h-64 rounded-lg" />
            </div>
          ) : !s.item ? (
            <p className="py-6 text-center text-sm text-destructive">{errMessage(s.detailQuery.error)}</p>
          ) : (
            <>
              {/* البطاقات المالية */}
              <SubFinCards item={s.item} />

              {/* إجراءات */}
              {s.manager && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" className="h-9 gap-1.5" onClick={() => onPay()}>
                    <Banknote className="size-4" />
                    صرف على هذا الباطن
                  </Button>
                  {s.item.status !== "ملغى" ? (
                    <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => { s.setCancelReason(""); s.setCancelOpen(true); }}>
                      <Ban className="size-4" />
                      إلغاء العقد الباطن
                    </Button>
                  ) : (
                    <StatusBadge status="ملغى" />
                  )}
                  <Button variant="outline" size="sm" className="h-9 gap-1.5 text-destructive hover:text-destructive" onClick={() => s.setDeleteOpen(true)}>
                    <Trash2 className="size-4" />
                    حذف
                  </Button>
                </div>
              )}

              <Tabs defaultValue="items">
                <TabsList className="flex h-auto w-full flex-nowrap justify-start gap-1 overflow-x-auto p-1">
                  <TabsTrigger value="items" className="shrink-0">البنود</TabsTrigger>
                  <TabsTrigger value="plan" className="shrink-0">خطة الدفعات</TabsTrigger>
                  <TabsTrigger value="blocks" className="shrink-0">كتل الدفع</TabsTrigger>
                  <TabsTrigger value="vouchers" className="shrink-0">السندات</TabsTrigger>
                </TabsList>

                {/* ===== البنود ===== */}
                <TabsContent value="items" className="mt-3 space-y-3">
                  <SubItemsEditor
                    boqItems={s.boqQuery.data?.items ?? []}
                    draftItems={s.draftItems}
                    setDraftItems={s.setDraftItems}
                    dirty={s.itemsDirty}
                    setItemsDirty={s.setItemsDirty}
                    serverItems={s.itemsQuery.data}
                    onAddFromBoq={s.addFromBoq}
                    saving={s.saveItemsMutation.isPending}
                    onSave={() => s.saveItemsMutation.mutate()}
                  />
                </TabsContent>

                {/* ===== خطة الدفعات ===== */}
                <TabsContent value="plan" className="mt-3 space-y-3">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => s.setDistributeOpen(true)}>
                      <Wand2 className="size-4" />
                      توزيع تلقائي
                    </Button>
                    <Button size="sm" className="h-9 gap-1.5" onClick={() => { s.setPlanForm({ title: "", amount: "", dueDate: todayStr() }); s.setSourceIds([]); s.setAddPlanOpen(true); }}>
                      <Plus className="size-4" />
                      إضافة دفعة
                    </Button>
                  </div>
                  {s.planLines.length === 0 ? (
                    <Card>
                      <CardContent className="p-6 text-center text-sm text-muted-foreground">
                        لا خطوط دفعات — أضف خطوطًا أو وزّع تلقائيًا على بنود الكميات.
                      </CardContent>
                    </Card>
                  ) : (
                    <SubPlanLinesTable
                      lines={s.planLines}
                      manager={s.manager}
                      onDelete={(lineId) => s.setDeletePlanId(lineId)}
                    />
                  )}
                </TabsContent>

                {/* ===== كتل الدفع ===== */}
                <TabsContent value="blocks" className="mt-3">
                  <SubBlocksTable loading={s.payBlocksQuery.isLoading} rows={s.payBlocksQuery.data?.rows ?? []} />
                </TabsContent>

                {/* ===== السندات ===== */}
                <TabsContent value="vouchers" className="mt-3">
                  <SubVouchersList vouchers={s.vouchersQuery.data?.items ?? []} />
                </TabsContent>
              </Tabs>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* إضافة دفعة للخطة */}
      <Dialog open={s.addPlanOpen} onOpenChange={s.setAddPlanOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>إضافة دفعة لخطة الباطن</DialogTitle>
            <DialogDescription>اربط الدفعة بمصادرها من دفعات العميل — الاستحقاق باكتمال كل المصادر.</DialogDescription>
          </DialogHeader>
          <AddPlanFields
            planForm={s.planForm}
            setPlanForm={s.setPlanForm}
            clientDueLines={s.clientDueLines}
            sourceIds={s.sourceIds}
            setSourceIds={s.setSourceIds}
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => s.setAddPlanOpen(false)} disabled={s.addPlanMutation.isPending}>
              إلغاء
            </Button>
            <Button
              className="h-9"
              disabled={s.addPlanMutation.isPending || !s.planForm.title.trim() || !(Number(s.planForm.amount) > 0)}
              onClick={() => s.addPlanMutation.mutate()}
            >
              {s.addPlanMutation.isPending ? "جارٍ الحفظ…" : "إضافة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* توزيع تلقائي */}
      <Dialog open={s.distributeOpen} onOpenChange={s.setDistributeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>توزيع تلقائي لخطة الدفعات</DialogTitle>
            <DialogDescription>يوزع المبلغ إما على عدد دفعات متساوية أو على بنود كميات العقد.</DialogDescription>
          </DialogHeader>
          <DistributeFields
            distForm={s.distForm}
            setDistForm={s.setDistForm}
            boqItems={s.boqQuery.data?.items ?? []}
            distBoqIds={s.distBoqIds}
            setDistBoqIds={s.setDistBoqIds}
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => s.setDistributeOpen(false)} disabled={s.distributeMutation.isPending}>
              إلغاء
            </Button>
            <Button
              className="h-9"
              disabled={s.distributeMutation.isPending || !(Number(s.distForm.total) > 0) || (s.distForm.useBoq && s.distBoqIds.length === 0)}
              onClick={() => s.distributeMutation.mutate()}
            >
              {s.distributeMutation.isPending ? "جارٍ التوزيع…" : "توزيع"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* إلغاء عقد الباطن */}
      <Dialog open={s.cancelOpen} onOpenChange={s.setCancelOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>إلغاء عقد الباطن</DialogTitle>
            <DialogDescription>إلغاء ناعم — السندات السارية تُفكّ من هذا العقد.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="sc-reason">سبب الإلغاء *</Label>
            <Textarea id="sc-reason" rows={3} value={s.cancelReason} onChange={(e) => s.setCancelReason(e.target.value)} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => s.setCancelOpen(false)} disabled={s.cancelMutation.isPending}>
              تراجع
            </Button>
            <Button variant="destructive" className="h-9" disabled={s.cancelMutation.isPending || !s.cancelReason.trim()} onClick={() => s.cancelMutation.mutate()}>
              {s.cancelMutation.isPending ? "جارٍ الإلغاء…" : "إلغاء"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* حذف بيانات المقاول بخيارات (V5.8 — نافذة الخيارات المعتمدة بدل الحذف المباشر) */}
      <SubDeleteDialog
        subcontractorId={s.item?.subcontractor?.id ?? null}
        open={s.deleteOpen}
        onOpenChange={s.setDeleteOpen}
        onAuthError={onAuthError}
        onDone={(info) => {
          s.invalidate();
          if (info.action === "contracts" && subContractId !== null && info.deletedContractIds.includes(subContractId)) {
            s.setDeleteOpen(false);
            onOpenChange(false);
          }
        }}
        focus="contracts"
      />

      {/* تأكيد حذف خط خطة */}
      <Dialog open={s.deletePlanId !== null} onOpenChange={(o) => !o && s.setDeletePlanId(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>حذف خط الدفعة</DialogTitle>
            <DialogDescription>سيُحذف الخط من خطة الباطن — هل أنت متأكد؟</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => s.setDeletePlanId(null)} disabled={s.deletePlanMutation.isPending}>
              تراجع
            </Button>
            <Button variant="destructive" className="h-9" disabled={s.deletePlanMutation.isPending} onClick={() => s.deletePlanId && s.deletePlanMutation.mutate(s.deletePlanId)}>
              {s.deletePlanMutation.isPending ? "جارٍ الحذف…" : "حذف"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
