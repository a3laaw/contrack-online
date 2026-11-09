"use client";

/**
 * ContractsSection.tsx — قسم «عقود الصيانة» (docs/maintenance-design.md §6 — د2):
 * العقود الموسومة بأنواعها (isMaintenance) ببطاقاتها وتجمعاتها (خطة/حدث قادم/أوامر مفتوحة/المفوتر)
 * + حوار إنشاء مختصر يستدعي نفس API العقود القائم (نمط عروض المبيعات: بيت مستقل يستهلك المحرك)
 * — المراحل وBOQ تبقى بشاشة العقود الكاملة.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, FileSignature, NotebookPen, Plus } from "lucide-react";

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
import { ApiError, apiGet, apiPost } from "../api";
import { fmtMoney, fmtNum, statusTone, type MaintenanceContractRow } from "../MaintenanceView";

interface Props {
  onAuthError: () => void;
  onOpenContract: (id: number) => void;
}

interface CustomerOption {
  id: number;
  name: string;
}

function EmptyState({ icon: Icon, title, hint }: { icon: React.ComponentType<{ className?: string }>; title: string; hint: string }) {
  return (
    <div className="py-8 text-center">
      <Icon className="mx-auto size-8 text-muted-foreground/50" />
      <p className="mt-2 text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function ContractsSection({ onAuthError, onOpenContract }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const onErr = React.useCallback(
    (e: unknown, title: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title, description: (e as { message?: string })?.message || "خطأ غير متوقع" });
    },
    [onAuthError, toast]
  );

  const contractsQuery = useQuery<{ contracts: MaintenanceContractRow[]; typeNames: string[] }>({
    queryKey: ["maintenance", "contracts"],
    queryFn: () => apiGet<{ contracts: MaintenanceContractRow[]; typeNames: string[] }>("/api/maintenance/contracts"),
  });
  const customersQuery = useQuery<{ customers: CustomerOption[] }>({
    queryKey: ["maintenance", "customers-lite"],
    queryFn: () => apiGet<{ customers: CustomerOption[] }>("/api/customers"),
    staleTime: 60_000,
  });

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["maintenance"] });
  }, [qc]);

  // ===== إنشاء عقد صيانة (نفس API العقود — د2) =====
  const [dlg, setDlg] = React.useState(false);
  const [form, setForm] = React.useState({ customerId: "", contractType: "", amount: "", contractDate: "", startDate: "", notes: "" });
  const types = contractsQuery.data?.typeNames ?? [];
  React.useEffect(() => {
    if (types.length > 0 && !form.contractType) setForm((f) => ({ ...f, contractType: types[0] }));
  }, [types.length]);

  const createMutation = useMutation({
    mutationFn: (v: typeof form) =>
      apiPost<{ contract?: { id: number } }>("/api/contracts", {
        customerId: Number(v.customerId),
        contractType: v.contractType,
        contractName: v.contractType,
        amount: Number(v.amount),
        contractDate: v.contractDate,
        startDate: v.startDate || undefined,
        notes: v.notes,
        description: `عقد صيانة — ${v.contractType}`,
      }),
    onSuccess: () => {
      setDlg(false);
      setForm({ customerId: "", contractType: types[0] ?? "", amount: "", contractDate: "", startDate: "", notes: "" });
      invalidate();
      toast({ title: "أُنشئ عقد الصيانة", description: "المراحل وبنود الكميات من شاشة العقد الكاملة عند الحاجة" });
    },
    onError: (e) => onErr(e, "تعذر إنشاء العقد"),
  });

  const rows = contractsQuery.data?.contracts ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">العقود بأنواع موسومة «عقد صيانة» — وسم الأنواع من شاشة إدارة الأنواع (د11)</p>
        <Button size="sm" onClick={() => setDlg(true)} className="gap-1.5">
          <Plus className="size-4" />
          عقد صيانة جديد
        </Button>
      </div>

      {contractsQuery.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="p-4">
          <EmptyState
            icon={FileSignature}
            title="لا عقود صيانة بعد"
            hint="أنشئ عقدًا بنوع موسوم «عقد صيانة» — أو وسم نوعًا قائمًا من شاشة إدارة الأنواع"
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((c) => (
            <Card
              key={c.id}
              className="cursor-pointer gap-2 p-4 transition-colors hover:border-primary/40"
              onClick={() => onOpenContract(c.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{c.contractName || c.contractType}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{c.contractNumber}</p>
                </div>
                <Badge className={`h-5 shrink-0 px-1.5 text-[10px] ${statusTone(c.status)}`}>{c.status}</Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">العميل: {c.customerName}</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <span className="text-muted-foreground">
                  القيمة: <span className="font-bold text-foreground">{fmtMoney(c.amount)}</span>
                </span>
                <span className="text-muted-foreground">
                  المفوتر: <span className="font-bold text-foreground">{fmtMoney(c.invoiced)}</span>
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <CalendarClock className="size-3" />
                  {c.nextDue ? `الحدث القادم: ${c.nextDue}` : "لا أحداث قادمة"}
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <NotebookPen className="size-3" />
                  {c.openOrders > 0 ? `${fmtNum(c.openOrders)} أوامر مفتوحة` : "لا أوامر مفتوحة"}
                </span>
              </div>
              {c.plan && (
                <p className="truncate text-[11px] text-muted-foreground">
                  الخطة: {c.plan.name || "بلا اسم"} — {c.plan.active ? "نشطة" : "معطّلة"}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* حوار إنشاء عقد صيانة — نفس API العقود (د2) */}
      <Dialog open={dlg} onOpenChange={setDlg}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>عقد صيانة جديد</DialogTitle>
            <DialogDescription>يُنشأ بنفس محرك العقود بنوع صيانة — المراحل والبنود من شاشة العقد لاحقًا</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>العميل *</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={form.customerId}
                onChange={(e) => setForm({ ...form, customerId: e.target.value })}
              >
                <option value="">— اختر العميل —</option>
                {(customersQuery.data?.customers ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>نوع الصيانة *</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={form.contractType}
                onChange={(e) => setForm({ ...form, contractType: e.target.value })}
              >
                {types.length === 0 && <option value="">لا أنواع موسومة صيانة</option>}
                {types.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>القيمة (د.ك) *</Label>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>تاريخ العقد *</Label>
                <Input
                  type="date"
                  value={form.contractDate}
                  onChange={(e) => setForm({ ...form, contractDate: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>تاريخ البداية</Label>
              <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>ملاحظات</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={createMutation.isPending}
              onClick={() => {
                if (!form.customerId) return toast({ variant: "destructive", title: "العميل مطلوب" });
                if (!form.contractType) return toast({ variant: "destructive", title: "اختر نوع الصيانة — لا أنواع موسومة" });
                if (!(Number(form.amount) > 0)) return toast({ variant: "destructive", title: "قيمة العقد يجب أن تكون أكبر من صفر" });
                if (!form.contractDate) return toast({ variant: "destructive", title: "تاريخ العقد مطلوب" });
                createMutation.mutate(form);
              }}
            >
              إنشاء العقد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
