"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  Eye,
  HandCoins,
  Loader2,
  Plus,
  RefreshCw,
  Repeat,
  PiggyBank,
  Receipt as ReceiptIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiGet } from "./api";
import { errMessage, isManagerRole } from "./contrack-types";
import { VOUCHER_TYPE_BADGE, VOUCHER_TYPE_LABEL } from "./contrack-types";
import type { User, VoucherDetailResponse, VoucherItem, VouchersResponse } from "./contrack-types";
import { fmtDate, formatKWD, statusBadgeClass } from "@/lib/format";
import { VoucherPage } from "./VoucherPage";

interface VouchersViewProps {
  user: User;
  onAuthError: () => void;
  /** فلتر بحث مسبق (من البحث الشامل) */
  presetQ?: string | null;
  onConsumePresetQ?: () => void;
  /** الوضع المبدئي من القائمة الجانبية: سندات القبض / سندات الصرف */
  initialMode?: "receipt" | "payment";
}

const TYPE_FILTERS: { v: string; label: string }[] = [
  { v: "", label: "الكل" },
  { v: "receipt", label: "قبض" },
  { v: "payment", label: "صرف" },
  { v: "transfer", label: "تحويل" },
  { v: "custody_return", label: "إرجاع عهدة" },
  { v: "salary_deduction", label: "خصم راتب" },
];

export function VouchersView({ user, onAuthError, presetQ, onConsumePresetQ, initialMode }: VouchersViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);

  // ===== فلاتر =====
  const [vtype, setVtype] = React.useState(initialMode ?? "");

  // مزامنة الوضع مع القائمة الجانبية (قبض/صرف)
  React.useEffect(() => {
    if (initialMode) setVtype(initialMode);
  }, [initialMode]);
  const [q, setQ] = React.useState("");
  const [dq, setDq] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [includeCancelled, setIncludeCancelled] = React.useState(false);

  // فلتر بحث مسبق من البحث الشامل
  React.useEffect(() => {
    if (presetQ != null) {
      setQ(presetQ);
      onConsumePresetQ?.();
    }
  }, [presetQ]);

  React.useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams();
  if (vtype) params.set("vtype", vtype);
  if (dq) params.set("q", dq);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (includeCancelled) params.set("includeCancelled", "1");

  const listQuery = useQuery<VouchersResponse>({
    queryKey: ["vouchers", params.toString()],
    queryFn: () => apiGet<VouchersResponse>(`/api/vouchers?${params.toString()}`),
  });

  React.useEffect(() => {
    const e = listQuery.error;
    if (e && "status" in e && (e as { status?: number }).status === 401) onAuthError();
  }, [listQuery.error, onAuthError]);

  const items: VoucherItem[] =
    (listQuery.data as unknown as { vouchers?: VoucherItem[] })?.vouchers ??
    listQuery.data?.items ??
    [];
  const activeItems = items.filter((i) => !i.cancelled);

  // تعميم محلي من العناصر المعروضة (غير ملغاة)
  const sum = (t: string[]) =>
    activeItems.filter((i) => t.includes(i.vtype)).reduce((s, i) => s + Number(i.amount || 0), 0);
  const kpiReceipt = sum(["receipt"]);
  const kpiPayment = sum(["payment"]);
  const kpiTransfer = sum(["transfer"]);
  const kpiOther = sum(["custody_return", "salary_deduction"]);

  // ===== حوار التفاصيل =====
  const [detailId, setDetailId] = React.useState<number | null>(null);
  const detailQuery = useQuery<VoucherDetailResponse>({
    queryKey: ["voucher", detailId],
    queryFn: () => apiGet<VoucherDetailResponse>(`/api/vouchers/${detailId}`),
    enabled: detailId !== null,
  });

  // ===== حوار الإلغاء =====
  const [cancelTarget, setCancelTarget] = React.useState<VoucherItem | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");

  const doCancel = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      const res = await fetch(`/api/vouchers/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("ctrk_token") || ""}` },
        credentials: "include",
        body: JSON.stringify({ reason }),
      });
      if (res.status === 401) onAuthError();
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data as { error?: string })?.error || `فشل الطلب (${res.status})`);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      qc.invalidateQueries({ queryKey: ["voucher"] });
      qc.invalidateQueries({ queryKey: ["contract"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: "تم إلغاء السند", description: "عُكس أثره المالي وأُعيدت فتح الدفعات المغطاة" });
      setCancelTarget(null);
      setCancelReason("");
    },
    onError: (e) => {
      toast({ variant: "destructive", title: "تعذر إلغاء السند", description: errMessage(e) });
    },
  });

  // صفحة السند (بدل النافذة): {mode, editing} أو null للقائمة
  const [voucherPage, setVoucherPage] = React.useState<{ mode: "receipt" | "payment"; editing: VoucherItem | null } | null>(null);

  const kpis = [
    { label: "إجمالي القبض", value: kpiReceipt, icon: HandCoins, tone: "text-status-done" },
    { label: "إجمالي الصرف", value: kpiPayment, icon: ReceiptIcon, tone: "text-status-danger" },
    { label: "التحويلات", value: kpiTransfer, icon: Repeat, tone: "text-status-info" },
    { label: "إرجاع عهدة وخصم رواتب", value: kpiOther, icon: PiggyBank, tone: "text-status-warn" },
  ];

  // صفحة السند تُعرض بدل القائمة مباشرة (لا نافذة)
  if (voucherPage) {
    return (
      <VoucherPage
        user={user}
        onAuthError={onAuthError}
        mode={voucherPage.mode}
        editing={voucherPage.editing}
        onSaved={() => setVoucherPage(null)}
        onCancel={() => setVoucherPage(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* رأس الصفحة — سطر واحد مضغوط */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold whitespace-nowrap">السندات</h1>
        <span className="hidden xl:inline text-xs text-muted-foreground">قبض وصرف وتحويلات — مع الربط بالدفعات</span>
        <div className="ms-auto flex items-center gap-2">
          <Button variant="outline" size="icon" className="size-9" onClick={() => listQuery.refetch()} aria-label="تحديث">
            <RefreshCw className={listQuery.isFetching ? "size-4 animate-spin" : "size-4"} />
          </Button>
          <Button size="sm" className="h-9 gap-1.5" onClick={() => setVoucherPage({ mode: vtype === "payment" ? "payment" : "receipt", editing: null })}>
            <Plus className="size-4" />
            سند جديد
          </Button>
        </div>
      </div>

      {/* بطاقات KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.label} className="gap-1 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{k.label}</span>
                <Icon className="size-4 text-primary/70" />
              </div>
              <div className={`text-base font-bold tabular-nums lg:text-lg ${k.tone}`} dir="ltr">
                {formatKWD(k.value)}
              </div>
            </Card>
          );
        })}
      </div>

      {/* الفلاتر */}
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.v}
              type="button"
              onClick={() => setVtype(f.v)}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                vtype === f.v ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1 space-y-1.5">
            <Label htmlFor="v-q">بحث</Label>
            <Input id="v-q" className="h-9" placeholder="رقم السند/الطرف/البيان…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-from">من</Label>
            <Input id="v-from" className="h-9 w-36" dir="ltr" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-to">إلى</Label>
            <Input id="v-to" className="h-9 w-36" dir="ltr" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Switch id="v-cancelled" checked={includeCancelled} onCheckedChange={setIncludeCancelled} />
            <Label htmlFor="v-cancelled" className="text-xs">عرض الملغاة</Label>
          </div>
        </div>
      </Card>

      {/* الجدول */}
      {listQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : listQuery.isError ? (
        <Card className="border-status-danger/40">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <AlertTriangle className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{errMessage(listQuery.error)}</p>
            <Button variant="outline" size="sm" className="h-9" onClick={() => listQuery.refetch()}>
              <RefreshCw className="size-4" /> إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            لا سندات مطابقة — أنشئ سندًا جديدًا للبدء.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* سطح المكتب */}
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <div className="max-h-[480px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted">
                  <TableRow>
                    <TableHead className="w-32">الرقم</TableHead>
                    <TableHead className="w-28">التاريخ</TableHead>
                    <TableHead>الطرف</TableHead>
                    <TableHead>الوصف</TableHead>
                    <TableHead className="text-start">المبلغ</TableHead>
                    <TableHead className="w-24">الحالة</TableHead>
                    <TableHead className="w-20">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TooltipProvider delayDuration={200}>
                    {items.map((v) => (
                      <TableRow key={v.id} className={v.cancelled ? "opacity-50" : undefined}>
                        <TableCell>
                          <Badge className={VOUCHER_TYPE_BADGE[v.vtype] || statusBadgeClass("")} dir="ltr">
                            {v.voucherNumber}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular-nums" dir="ltr">{fmtDate(v.vdate)}</TableCell>
                        <TableCell className="max-w-36 truncate">
                          {v.partyName || v.party || (v.partyType === "partner" ? "شريك" : "—")}
                          {v.contractNumber && (
                            <span className="block text-[11px] text-muted-foreground" dir="ltr">{v.contractNumber}</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-48">
                          <span className="block truncate text-muted-foreground">{v.description || "—"}</span>
                        </TableCell>
                        <TableCell className="text-end font-bold tabular-nums" dir="ltr">{formatKWD(v.amount)}</TableCell>
                        <TableCell>
                          {v.cancelled ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge className="bg-status-danger-bg text-status-danger">ملغى</Badge>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-56 text-xs">
                                {v.cancelReason || "ملغى"}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <Badge className="bg-status-done-bg text-status-done">سارٍ</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="size-8" onClick={() => setDetailId(v.id)} aria-label="تفاصيل">
                              <Eye className="size-4" />
                            </Button>
                            {manager && !v.cancelled && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 text-destructive hover:text-destructive"
                                onClick={() => {
                                  setCancelTarget(v);
                                  setCancelReason("");
                                }}
                                aria-label="إلغاء السند"
                              >
                                <Ban className="size-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TooltipProvider>
                </TableBody>
              </Table>
            </div>
          </div>

          {/* موبايل */}
          <div className="space-y-2 md:hidden">
            {items.map((v) => (
              <Card key={v.id} className={`gap-2 p-3 ${v.cancelled ? "opacity-60" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <Badge className={VOUCHER_TYPE_BADGE[v.vtype] || statusBadgeClass("")} dir="ltr">
                    {v.voucherNumber}
                  </Badge>
                  <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">{fmtDate(v.vdate)}</span>
                  {v.cancelled ? (
                    <Badge className="bg-status-danger-bg text-status-danger">ملغى</Badge>
                  ) : (
                    <Badge className="bg-status-done-bg text-status-done">سارٍ</Badge>
                  )}
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="min-w-0 truncate">{v.partyName || v.party || "—"}</span>
                  <span className="font-bold tabular-nums" dir="ltr">{formatKWD(v.amount)}</span>
                </div>
                {v.description && <p className="truncate text-xs text-muted-foreground">{v.description}</p>}
                {v.cancelled && v.cancelReason && <p className="text-xs text-status-danger">السبب: {v.cancelReason}</p>}
                <div className="flex justify-end gap-1">
                  <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setDetailId(v.id)}>
                    <Eye className="size-3.5" /> تفاصيل
                  </Button>
                  {manager && !v.cancelled && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-destructive hover:text-destructive"
                      onClick={() => {
                        setCancelTarget(v);
                        setCancelReason("");
                      }}
                    >
                      <Ban className="size-3.5" /> إلغاء
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* حوار التفاصيل */}
      <Dialog open={detailId !== null} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>تفاصيل السند</DialogTitle>
            <DialogDescription>الأرقام محسوبة لحظيًا من الحركات.</DialogDescription>
          </DialogHeader>
          {detailQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> جارٍ التحميل…
            </div>
          ) : detailQuery.data ? (
            <VoucherDetailBody data={detailQuery.data} />
          ) : (
            <p className="py-4 text-center text-sm text-destructive">{errMessage(detailQuery.error)}</p>
          )}
        </DialogContent>
      </Dialog>

      {/* حوار إلغاء السند */}
      <Dialog open={cancelTarget !== null} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>إلغاء سند</DialogTitle>
            <DialogDescription>
              سيُلغى السند {cancelTarget?.voucherNumber} ناعمًا ويعكس أثره المالي — الرقم لا يُعاد للاستخدام.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="vc-reason">سبب الإلغاء *</Label>
            <Textarea id="vc-reason" rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              يُرفض الإلغاء إن وُجدت مطالبة سارية أو تصفية عهدة أو ابن رسوم بنكية حي — تظهر رسالة الخلفية حرفيًا.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setCancelTarget(null)} disabled={doCancel.isPending}>
              تراجع
            </Button>
            <Button
              variant="destructive"
              className="h-9"
              disabled={doCancel.isPending || !cancelReason.trim()}
              onClick={() => cancelTarget && doCancel.mutate({ id: cancelTarget.id, reason: cancelReason.trim() })}
            >
              {doCancel.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> جارٍ الإلغاء…
                </>
              ) : (
                "إلغاء السند"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** جسم نافذة التفاصيل — مشترك بين شاشة السندات وتبويب سندات العقد */
export function VoucherDetailBody({ data }: { data: VoucherDetailResponse }) {
  const v = data.item;
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "النوع", value: VOUCHER_TYPE_LABEL[v.vtype] || v.vtype },
    { label: "التاريخ", value: fmtDate(v.vdate) },
    { label: "الطرف", value: v.partyName || v.party || (v.partyType === "partner" ? "شريك" : "—") },
    { label: "الطريقة", value: v.method || "—" },
    { label: "الحساب", value: v.account || v.expenseAccountSnapshot || v.custodyAccountSnapshot || "—" },
    { label: "العقد", value: v.contractNumber || "—" },
    { label: "البيان", value: v.description || "—" },
    ...(v.advanceAmount ? [{ label: "دفعة مقدمة (فائض)", value: formatKWD(v.advanceAmount) }] : []),
    ...(v.receiptGroupRef ? [{ label: "مرجع المجموعة", value: v.receiptGroupRef }] : []),
    ...(v.employeeName ? [{ label: "الموظف", value: v.employeeName }] : []),
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
        <Badge className={VOUCHER_TYPE_BADGE[v.vtype] || statusBadgeClass("")} dir="ltr">
          {v.voucherNumber}
        </Badge>
        <span className="text-lg font-bold tabular-nums" dir="ltr">{formatKWD(v.amount)}</span>
        {v.cancelled ? (
          <Badge className="bg-status-danger-bg text-status-danger">ملغى</Badge>
        ) : (
          <Badge className="bg-status-done-bg text-status-done">سارٍ</Badge>
        )}
      </div>
      {v.cancelled && v.cancelReason && (
        <p className="rounded-md bg-status-danger-bg p-2 text-xs text-status-danger">سبب الإلغاء: {v.cancelReason}</p>
      )}
      <div className="grid grid-cols-2 gap-2 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="rounded-md border p-2">
            <div className="text-[11px] text-muted-foreground">{r.label}</div>
            <div className="mt-0.5 break-words font-medium">{r.value}</div>
          </div>
        ))}
      </div>
      {(data.links?.length ?? 0) > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold">خطوط الربط بالدفعات</p>
          <div className="max-h-36 space-y-1 overflow-y-auto">
            {data.links.map((l) => (
              <div key={l.lineId} className="flex items-center justify-between rounded-md border px-2 py-1.5 text-xs">
                <span>خط #{l.lineId} — {l.kind}</span>
                <span className="font-bold tabular-nums" dir="ltr">{formatKWD(l.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {(v.feeChildren?.length ?? 0) > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold">سندات الرسوم البنكية الأبناء</p>
          <div className="space-y-1">
            {v.feeChildren!.map((f) => (
              <div key={f.voucherNumber} className="flex items-center justify-between rounded-md border px-2 py-1.5 text-xs">
                <Badge variant="secondary" dir="ltr">{f.voucherNumber}</Badge>
                <span className="font-bold tabular-nums" dir="ltr">{formatKWD(f.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
