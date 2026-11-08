"use client";

/**
 * DocsSection.tsx — قسم «أذون المخازن» (§7): قائمة بفلاتر + أربعة أزرار إنشاء
 * + حوار تفاصيل بالقيد المرتبط + إلغاء بسبب للمدير — الحفظ مرحّل بقيد فوري (لا مسودات).
 * لقطات التكلفة للصرف/الجرد يشتقها الخادم آليًا (المتوسط المرجحي — د2) — العميل يرسل 0 للصرف.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Ban,
  ClipboardCheck,
  Loader2,
  PackageMinus,
  PackageOpen,
  PackagePlus,
  Plus,
  Trash2,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPost } from "../api";
import { cn } from "@/lib/utils";
import { SearchableSelect } from "../SearchableSelect";
import { fmtMoney, fmtQty } from "../WarehousesView";

interface Props {
  onAuthError: () => void;
  isAdmin: boolean;
}

// ==================== أنواع ====================

interface DocRow {
  id: number;
  docNumber: string;
  kind: string;
  kindLabel: string;
  entrySource: string;
  vdate: string;
  warehouseId: number;
  warehouseName: string;
  targetWarehouseId: number | null;
  targetWarehouseName: string;
  contractId: number | null;
  contractNumber: string;
  contractName: string;
  party: string;
  totalAmount: number;
  lineCount: number;
  status: string;
  cancelReason: string;
  cancelledAt: string | null;
  notes: string;
  createdBy: string;
}

interface ContractOpt {
  id: number;
  contractNumber: string;
  contractName: string;
  customerName: string;
  status: string;
}

interface AccountOpt {
  id: number;
  code: string;
  name: string;
  isLeaf: boolean;
  allowPosting: boolean;
  isActive: boolean;
  type: string;
}

interface BoqOpt {
  id: number;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  total: number;
}

interface LineState {
  itemId: string;
  boqItemId: string;
  qty: string;
  countedQty: string;
  snapUnitCost: string;
  note: string;
}

const KIND_TONE: Record<string, { text: string; bg: string }> = {
  entry: { text: "text-status-done", bg: "bg-status-done-bg" },
  issue: { text: "text-status-warn", bg: "bg-status-warn-bg" },
  transfer: { text: "text-status-info", bg: "bg-status-info-bg" },
  count: { text: "text-status-danger", bg: "bg-status-danger-bg" },
};

const KIND_META = [
  { kind: "entry", label: "إدخال", icon: PackageOpen },
  { kind: "issue", label: "صرف", icon: PackageMinus },
  { kind: "transfer", label: "تحويل", icon: ArrowLeftRight },
  { kind: "count", label: "جرد", icon: ClipboardCheck },
] as const;

const SOURCE_LABELS: Record<string, string> = {
  cash: "شراء نقدي",
  credit: "شراء آجل (مورد)",
  return: "مرتجع من موقع",
};

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("px-3 py-2 text-start text-[11px] font-semibold text-muted-foreground", className)}>{children}</th>;
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2 text-[13px]", className)}>{children}</td>;
}

const EMPTY_LINE: LineState = { itemId: "", boqItemId: "", qty: "", countedQty: "", snapUnitCost: "", note: "" };

// ==================== القسم ====================

export function DocsSection({ onAuthError, isAdmin }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const onErr = React.useCallback(
    (e: unknown, title: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title, description: (e as { message?: string })?.message || "خطأ غير متوقع" });
    },
    [onAuthError, toast]
  );

  const [fKind, setFKind] = React.useState("all");
  const [fStatus, setFStatus] = React.useState("all");
  const [fWarehouse, setFWarehouse] = React.useState("all");

  const warehousesQuery = useQuery<{ warehouses: { id: number; name: string; active: boolean }[] }>({
    queryKey: ["warehouses", "warehouses"],
    queryFn: () => apiGet<{ warehouses: { id: number; name: string; active: boolean }[] }>("/api/warehouses/warehouses"),
  });
  const warehouses = warehousesQuery.data?.warehouses ?? [];

  const docsParams = new URLSearchParams();
  if (fKind !== "all") docsParams.set("kind", fKind);
  if (fStatus !== "all") docsParams.set("status", fStatus);
  if (fWarehouse !== "all") docsParams.set("warehouseId", fWarehouse);
  const docsQuery = useQuery<{ docs: DocRow[] }>({
    queryKey: ["warehouses", "docs", fKind, fStatus, fWarehouse],
    queryFn: () => apiGet<{ docs: DocRow[] }>(`/api/warehouses/docs?${docsParams.toString()}`),
  });

  const [createMode, setCreateMode] = React.useState<"entry" | "issue" | "transfer" | "count" | null>(null);
  const [detailId, setDetailId] = React.useState<number | null>(null);

  const docs = docsQuery.data?.docs ?? [];

  return (
    <Card className="p-4">
      {/* الفلاتر + الإنشاء */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={fKind} onValueChange={setFKind}>
          <SelectTrigger className="h-8 w-28 text-xs" aria-label="نوع الإذن">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الأنواع</SelectItem>
            {KIND_META.map((k) => (
              <SelectItem key={k.kind} value={k.kind}>
                {k.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={fStatus} onValueChange={setFStatus}>
          <SelectTrigger className="h-8 w-28 text-xs" aria-label="الحالة">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            <SelectItem value="posted">مرحّل</SelectItem>
            <SelectItem value="cancelled">ملغى</SelectItem>
          </SelectContent>
        </Select>
        <Select value={fWarehouse} onValueChange={setFWarehouse}>
          <SelectTrigger className="h-8 w-40 text-xs" aria-label="المستودع">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل المستودعات</SelectItem>
            {warehouses.map((w) => (
              <SelectItem key={w.id} value={String(w.id)}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ms-auto flex flex-wrap items-center gap-1.5">
          {KIND_META.map((k) => (
            <Button key={k.kind} size="sm" variant="outline" className="h-8 gap-1" onClick={() => setCreateMode(k.kind)}>
              <Plus className="size-3.5" />
              {k.label}
            </Button>
          ))}
        </div>
      </div>

      {/* القائمة */}
      {docsQuery.isLoading ? (
        [0, 1, 2, 3].map((i) => <Skeleton key={i} className="mb-2 h-9 w-full" />)
      ) : docs.length === 0 ? (
        <div className="py-10 text-center">
          <PackagePlus className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm font-medium">لا أذون بالفلاتر الحالية</p>
          <p className="text-xs text-muted-foreground">أنشئ أول إذن من أزرار الإنشاء أعلاه</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="border-b">
                <Th>الرقم</Th>
                <Th>النوع</Th>
                <Th>التاريخ</Th>
                <Th>المستودع</Th>
                <Th>العقد / الطرف</Th>
                <Th>الأسطر</Th>
                <Th>القيمة</Th>
                <Th>الحالة</Th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr
                  key={d.id}
                  className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                  onClick={() => setDetailId(d.id)}
                >
                  <Td className="font-bold tabular-nums">{d.docNumber}</Td>
                  <Td>
                    <Badge className={cn("h-5 px-1.5 text-[10px]", KIND_TONE[d.kind]?.bg, KIND_TONE[d.kind]?.text)}>
                      {d.kindLabel}
                    </Badge>
                  </Td>
                  <Td className="tabular-nums text-muted-foreground">{d.vdate}</Td>
                  <Td>
                    {d.warehouseName}
                    {d.targetWarehouseName && (
                      <span className="text-muted-foreground"> ← {d.targetWarehouseName}</span>
                    )}
                  </Td>
                  <Td>
                    {d.contractNumber ? (
                      <span>
                        <span className="font-medium">{d.contractNumber}</span>
                        {d.party && <span className="text-muted-foreground"> — {d.party}</span>}
                      </span>
                    ) : d.party ? (
                      d.party
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Td>
                  <Td className="tabular-nums">{d.lineCount}</Td>
                  <Td className="tabular-nums font-medium">{fmtMoney(d.totalAmount)}</Td>
                  <Td>
                    {d.status === "posted" ? (
                      <Badge className="h-5 bg-status-done-bg px-1.5 text-[10px] text-status-done">مرحّل</Badge>
                    ) : (
                      <Badge className="h-5 bg-muted px-1.5 text-[10px] text-muted-foreground" title={d.cancelReason}>
                        ملغى
                      </Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* حوار الإنشاء */}
      {createMode && (
        <CreateDocDialog
          mode={createMode}
          warehouses={warehouses}
          onClose={() => setCreateMode(null)}
          onErr={onErr}
          onSaved={(num, journal) => {
            setCreateMode(null);
            qc.invalidateQueries({ queryKey: ["warehouses"] });
            toast({
              title: `حُفظ الإذن ${num}`,
              description: journal ? "وصدر القيد المرتبط" : "تحويل — بلا قيد (نقل موقع لا قيمة)",
            });
          }}
        />
      )}

      {/* حوار التفاصيل */}
      {detailId != null && (
        <DocDetailDialog
          id={detailId}
          isAdmin={isAdmin}
          onClose={() => setDetailId(null)}
          onErr={onErr}
          onCancelled={() => {
            setDetailId(null);
            qc.invalidateQueries({ queryKey: ["warehouses"] });
            toast({ title: "أُلغي الإذن وصدر قيد عكسي" });
          }}
        />
      )}
    </Card>
  );
}

// ==================== حوار الإنشاء الموحد ====================

function CreateDocDialog({
  mode,
  warehouses,
  onClose,
  onErr,
  onSaved,
}: {
  mode: "entry" | "issue" | "transfer" | "count";
  warehouses: { id: number; name: string; active: boolean }[];
  onClose: () => void;
  onErr: (e: unknown, title: string) => void;
  onSaved: (docNumber: string, hasJournal: boolean) => void;
}) {
  const activeWhs = warehouses.filter((w) => w.active);
  const [vdate, setVdate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [warehouseId, setWarehouseId] = React.useState("");
  const [targetWarehouseId, setTargetWarehouseId] = React.useState("");
  const [entrySource, setEntrySource] = React.useState("cash");
  const [payAccountId, setPayAccountId] = React.useState("");
  const [party, setParty] = React.useState("");
  const [contractId, setContractId] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [lines, setLines] = React.useState<LineState[]>([{ ...EMPTY_LINE }]);

  // مراجع الحوارات الأخرى: العقود + حسابات الدفع + الأصناف
  const contractsQuery = useQuery<{ contracts: ContractOpt[] }>({
    queryKey: ["wh-contracts"],
    queryFn: () => apiGet<{ contracts: ContractOpt[] }>("/api/contracts"),
  });
  const contracts = (contractsQuery.data?.contracts ?? []).filter((c) => c.status !== "ملغى" && c.status !== "مسودة");
  const boqQuery = useQuery<{ items: BoqOpt[] }>({
    queryKey: ["wh-boq", contractId],
    queryFn: () => apiGet<{ items: BoqOpt[] }>(`/api/contracts/${contractId}/items`),
    enabled: !!contractId && mode === "issue",
  });
  const itemsQuery = useQuery<{ items: { id: number; name: string; unit: string; active: boolean }[] }>({
    queryKey: ["warehouses", "items"],
    queryFn: () => apiGet<{ items: { id: number; name: string; unit: string; active: boolean }[] }>("/api/warehouses/items"),
  });

  const items = itemsQuery.data?.items ?? [];
  const itemOptions = React.useMemo(
    () =>
      items
        .filter((i) => (mode === "count" ? true : i.active))
        .map((i) => ({ value: String(i.id), label: i.unit ? `${i.name} (${i.unit})` : i.name })),
    [items, mode]
  );
  const boqItems = boqQuery.data?.items ?? [];

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiPost<{ docNumber: string; journalEntryId: number | null }>("/api/warehouses/docs", payload),
    onSuccess: (res) => onSaved(res.docNumber, res.journalEntryId != null),
    onError: (e) => onErr(e, "تعذر حفظ الإذن"),
  });

  const total = lines.reduce((s, l) => {
    const q = mode === "count" ? Number(l.countedQty) || 0 : Number(l.qty) || 0;
    return s + Math.abs(q * (Number(l.snapUnitCost) || 0));
  }, 0);

  const contractNeeded = mode === "issue" || (mode === "entry" && entrySource === "return");
  const canSubmit =
    !!warehouseId &&
    lines.length > 0 &&
    lines.every((l) => {
      if (!l.itemId) return false;
      if (mode === "count") return l.countedQty !== "" && Number(l.countedQty) >= 0;
      return Number(l.qty) > 0;
    }) &&
    (mode !== "entry" || entrySource !== "credit" || !!party.trim()) &&
    (mode !== "entry" || entrySource !== "cash" || !!payAccountId) &&
    (!contractNeeded || !!contractId) &&
    (mode !== "transfer" || (!!targetWarehouseId && targetWarehouseId !== warehouseId)) &&
    !createMutation.isPending;

  const submit = () => {
    createMutation.mutate({
      kind: mode,
      entrySource: mode === "entry" ? entrySource : undefined,
      vdate,
      warehouseId: Number(warehouseId),
      targetWarehouseId: mode === "transfer" ? Number(targetWarehouseId) : undefined,
      contractId: mode === "issue" ? Number(contractId) : mode === "entry" && entrySource === "return" ? Number(contractId) : undefined,
      party: mode === "entry" ? party.trim() : undefined,
      payAccountId: mode === "entry" && entrySource === "cash" ? Number(payAccountId) : undefined,
      notes: notes.trim() || undefined,
      lines: lines.map((l) => ({
        itemId: Number(l.itemId),
        boqItemId: l.boqItemId ? Number(l.boqItemId) : undefined,
        qty: mode === "count" ? undefined : Number(l.qty),
        countedQty: mode === "count" ? Number(l.countedQty) : undefined,
        snapUnitCost: mode === "issue" || mode === "count" ? 0 : Number(l.snapUnitCost) || 0,
        note: l.note.trim() || undefined,
      })),
    });
  };

  const kindLabel = KIND_META.find((k) => k.kind === mode)?.label ?? "";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>إذن {kindLabel} مخزني</DialogTitle>
          <DialogDescription>
            {mode === "issue"
              ? "الصرف على عقد حصرًا — السعر يُحتسب آليًا بالمتوسط المرجحي ولا يُرسل"
              : mode === "count"
                ? "أدخل الكمية المفحوصة — يُقيّد الفرق عن المسجّل آليًا بسعر اللقطة"
                : mode === "transfer"
                  ? "نقل بين مستودعين — بلا قيد محاسبي (نقل موقع لا قيمة)"
                  : "الحفظ مرحّل بقيد فوري — لا مسودات"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label>التاريخ *</Label>
              <Input type="date" value={vdate} onChange={(e) => setVdate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>المستودع *</Label>
              <SearchableSelect value={warehouseId} onValueChange={setWarehouseId} options={activeWhs.map((w) => ({ value: String(w.id), label: w.name }))} />
            </div>
            {mode === "transfer" && (
              <div className="space-y-1.5">
                <Label>إلى مستودع *</Label>
                <SearchableSelect
                  value={targetWarehouseId}
                  onValueChange={setTargetWarehouseId}
                  options={activeWhs.filter((w) => String(w.id) !== warehouseId).map((w) => ({ value: String(w.id), label: w.name }))}
                />
              </div>
            )}
            {(mode === "issue" || (mode === "entry" && entrySource === "return")) && (
              <div className="space-y-1.5">
                <Label>العقد *</Label>
                <SearchableSelect
                  value={contractId}
                  onValueChange={(v) => {
                    setContractId(v);
                    setLines((ls) => ls.map((l) => ({ ...l, boqItemId: "" })));
                  }}
                  options={contracts.map((c) => ({ value: String(c.id), label: `${c.contractNumber}${c.contractName ? ` — ${c.contractName}` : ""}` }))}
                />
              </div>
            )}
          </div>

          {mode === "entry" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>مصدر الإدخال *</Label>
                <Select value={entrySource} onValueChange={(v) => { setEntrySource(v); setParty(""); setPayAccountId(""); }}>
                  <SelectTrigger aria-label="مصدر الإدخال">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">شراء نقدي</SelectItem>
                    <SelectItem value="credit">شراء آجل (مورد)</SelectItem>
                    <SelectItem value="return">مرتجع من موقع</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {entrySource === "cash" && (
                <div className="space-y-1.5">
                  <Label>حساب الدفع (صندوق/بنك) *</Label>
                  <PayAccountSelect value={payAccountId} onValueChange={setPayAccountId} onErr={onErr} />
                </div>
              )}
              {entrySource === "credit" && (
                <div className="space-y-1.5">
                  <Label>اسم المورد *</Label>
                  <Input value={party} onChange={(e) => setParty(e.target.value)} placeholder="مؤسسة مواد البناء" />
                </div>
              )}
            </div>
          )}

          {/* الأسطر */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>الأسطر *</Label>
              <Button type="button" variant="outline" size="sm" className="h-7 gap-1" onClick={() => setLines((ls) => [...ls, { ...EMPTY_LINE }])}>
                <Plus className="size-3" />
                سطر
              </Button>
            </div>
            {boqItems.length > 0 && mode === "issue" && (
              <p className="text-[11px] text-muted-foreground">يمكن ربط كل سطر ببند كميات لتفعيل تقرير الانحراف</p>
            )}
            {lines.map((l, idx) => (
              <div key={idx} className="grid grid-cols-2 items-end gap-2 rounded-md border p-2 sm:grid-cols-6">
                <div className="col-span-2 space-y-1 sm:col-span-2">
                  <Label className="text-[11px]">الصنف</Label>
                  <SearchableSelect
                    value={l.itemId}
                    onValueChange={(v) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, itemId: v } : x)))}
                    options={itemOptions}
                  />
                </div>
                {mode === "issue" && boqItems.length > 0 && (
                  <div className="col-span-2 space-y-1 sm:col-span-2">
                    <Label className="text-[11px]">بند الكميات (اختياري)</Label>
                    <SearchableSelect
                      value={l.boqItemId}
                      onValueChange={(v) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, boqItemId: v } : x)))}
                      options={boqItems.map((b) => ({ value: String(b.id), label: b.description }))}
                      allowClear
                    />
                  </div>
                )}
                {mode === "count" ? (
                  <div className="space-y-1">
                    <Label className="text-[11px]">المفحوص</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      value={l.countedQty}
                      onChange={(e) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, countedQty: e.target.value } : x)))}
                    />
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label className="text-[11px]">الكمية</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      value={l.qty}
                      onChange={(e) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))}
                    />
                  </div>
                )}
                {mode !== "count" && (
                  <div className="space-y-1">
                    <Label className="text-[11px]">سعر الوحدة</Label>
                    {mode === "issue" ? (
                      <Input value="آلي" disabled title="يُحتسب من المتوسط المرجحي عند الحفظ" />
                    ) : (
                      <Input
                        type="number"
                        min="0"
                        step="0.001"
                        value={l.snapUnitCost}
                        onChange={(e) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, snapUnitCost: e.target.value } : x)))}
                        placeholder={mode === "entry" && entrySource === "return" ? "آخر سعر صرف" : "د.ك"}
                      />
                    )}
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-[11px]">ملاحظة</Label>
                  <Input value={l.note} onChange={(e) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, note: e.target.value } : x)))} />
                </div>
                <div className="flex justify-end sm:col-span-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 text-status-danger"
                    onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, i) => i !== idx) : ls))}
                    aria-label="حذف السطر"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            <p className="text-end text-xs font-medium">
              الإجمالي: <span className="tabular-nums">{fmtMoney(total)}</span>
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>ملاحظات الإذن</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {createMutation.isPending && <Loader2 className="size-4 animate-spin" />}
            حفظ ونشر
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** حسابات الدفع النقدي — أوراق أصول قابلة للنشر (صندوق/بنك) */
function PayAccountSelect({
  value,
  onValueChange,
  onErr,
}: {
  value: string;
  onValueChange: (v: string) => void;
  onErr: (e: unknown, t: string) => void;
}) {
  const q = useQuery<{ accounts: AccountOpt[] }>({
    queryKey: ["accounts"],
    queryFn: () => apiGet<{ accounts: AccountOpt[] }>("/api/accounts"),
  });
  const opts = (q.data?.accounts ?? [])
    .filter((a) => a.type === "asset" && a.isLeaf && a.allowPosting && a.isActive)
    .map((a) => ({ value: String(a.id), label: `${a.code} — ${a.name}` }));
  return <SearchableSelect value={value} onValueChange={onValueChange} options={opts} />;
}

// ==================== حوار التفاصيل + الإلغاء ====================

interface DocDetail {
  doc: {
    id: number;
    docNumber: string;
    kind: string;
    entrySource: string;
    vdate: string;
    warehouseName: string;
    targetWarehouseName: string;
    contractNumber: string;
    contractName: string;
    party: string;
    payAccountName: string;
    totalAmount: number;
    status: string;
    cancelReason: string;
    cancelledAt: string | null;
    notes: string;
    createdBy: string;
    journal: { id: number; entryNo: number; status: string } | null;
    lines: {
      id: number;
      itemName: string;
      unit: string;
      category: string;
      boqItemId: number | null;
      boqDescription: string;
      qty: number;
      countedQty: number;
      snapUnitCost: number;
      amount: number;
      note: string;
    }[];
  };
}

function DocDetailDialog({
  id,
  isAdmin,
  onClose,
  onErr,
  onCancelled,
}: {
  id: number;
  isAdmin: boolean;
  onClose: () => void;
  onErr: (e: unknown, title: string) => void;
  onCancelled: () => void;
}) {
  const q = useQuery<DocDetail>({
    queryKey: ["warehouses", "doc", id],
    queryFn: () => apiGet<DocDetail>(`/api/warehouses/docs/${id}`),
  });
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const cancelMutation = useMutation({
    mutationFn: () => apiPost(`/api/warehouses/docs/${id}/cancel`, { reason: reason.trim() }),
    onSuccess: onCancelled,
    onError: (e) => onErr(e, "تعذر إلغاء الإذن"),
  });
  const d = q.data?.doc;
  if (!d) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>تفاصيل الإذن</DialogTitle>
          </DialogHeader>
          <Skeleton className="h-40 w-full" />
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {d.docNumber}
            {d.status === "posted" ? (
              <Badge className="h-5 bg-status-done-bg px-1.5 text-[10px] text-status-done">مرحّل</Badge>
            ) : (
              <Badge className="h-5 bg-muted px-1.5 text-[10px] text-muted-foreground">ملغى</Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {d.vdate} · {d.warehouseName}
            {d.targetWarehouseName && ` ← ${d.targetWarehouseName}`}
            {d.contractNumber && ` · عقد ${d.contractNumber}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 rounded-md border p-3 text-[13px] sm:grid-cols-4">
            <div>
              <p className="text-[11px] text-muted-foreground">النوع</p>
              <p className="font-medium">{KIND_META.find((k) => k.kind === d.kind)?.label ?? d.kind}</p>
            </div>
            {d.kind === "entry" && (
              <div>
                <p className="text-[11px] text-muted-foreground">المصدر</p>
                <p className="font-medium">{SOURCE_LABELS[d.entrySource] ?? d.entrySource}</p>
              </div>
            )}
            {d.party && (
              <div>
                <p className="text-[11px] text-muted-foreground">الطرف</p>
                <p className="font-medium">{d.party}</p>
              </div>
            )}
            {d.payAccountName && (
              <div>
                <p className="text-[11px] text-muted-foreground">حساب الدفع</p>
                <p className="font-medium">{d.payAccountName}</p>
              </div>
            )}
            <div>
              <p className="text-[11px] text-muted-foreground">الإجمالي</p>
              <p className="font-bold tabular-nums">{fmtMoney(d.totalAmount)}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">أنشأه</p>
              <p className="font-medium">{d.createdBy || "—"}</p>
            </div>
            <div className="col-span-2">
              <p className="text-[11px] text-muted-foreground">القيد المرتبط</p>
              <p className="font-medium">
                {d.journal ? `قيد رقم ${d.journal.entryNo}${d.journal.status === "cancelled" ? " (ملغى بعكسه)" : ""}` : d.kind === "transfer" ? "بلا قيد — نقل موقع لا قيمة" : "—"}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead>
                <tr className="border-b">
                  <Th>الصنف</Th>
                  {d.kind === "count" && <Th>المسجّل→المفحوص</Th>}
                  <Th>{d.kind === "count" ? "الفرق المقيّد" : "الكمية"}</Th>
                  <Th>سعر اللقطة</Th>
                  <Th>المبلغ</Th>
                  {d.lines.some((l) => l.boqDescription) && <Th>بند الكميات</Th>}
                  <Th>ملاحظة</Th>
                </tr>
              </thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <Td className="font-medium">
                      {l.itemName}
                      {l.unit && <span className="text-muted-foreground"> ({l.unit})</span>}
                    </Td>
                    {d.kind === "count" && (
                      <Td className="tabular-nums text-muted-foreground">{fmtQty(l.countedQty - l.qty)} ← {fmtQty(l.countedQty)}</Td>
                    )}
                    <Td className="tabular-nums">{fmtQty(d.kind === "count" ? l.qty : Math.abs(l.qty))}</Td>
                    <Td className="tabular-nums">{fmtMoney(l.snapUnitCost)}</Td>
                    <Td className="tabular-nums font-medium">{fmtMoney(Math.abs(l.amount))}</Td>
                    {d.lines.some((x) => x.boqDescription) && <Td className="text-muted-foreground">{l.boqDescription || "—"}</Td>}
                    <Td className="text-muted-foreground">{l.note || "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {d.status === "cancelled" && (
            <div className="rounded-md border border-status-danger-bg bg-status-danger-bg/40 p-3 text-[13px]">
              <p className="flex items-center gap-1.5 font-medium text-status-danger">
                <Ban className="size-3.5" />
                ملغى بسبب: {d.cancelReason}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          {d.status === "posted" && isAdmin ? (
            <Button
              variant="destructive"
              size="sm"
              className="h-8 gap-1"
              onClick={() => setCancelOpen(true)}
              disabled={cancelMutation.isPending}
            >
              <Ban className="size-3.5" />
              إلغاء الإذن
            </Button>
          ) : (
            <span />
          )}
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
        </DialogFooter>

        {cancelOpen && (
          <Dialog open onOpenChange={(o) => !o && setCancelOpen(false)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>إلغاء الإذن {d.docNumber}</DialogTitle>
                <DialogDescription>يصدر قيد عكسي مرتبط — والأرصدة الاشتقاقية تعود تلقائيًا. سبب الإلغاء إلزامي.</DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="cancel-reason">سبب الإلغاء *</Label>
                <Textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCancelOpen(false)}>
                  رجوع
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => cancelMutation.mutate()}
                  disabled={cancelMutation.isPending || !reason.trim()}
                >
                  {cancelMutation.isPending && <Loader2 className="size-4 animate-spin" />}
                  إلغاء نهائي
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}

