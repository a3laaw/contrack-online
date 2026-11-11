"use client";

/**
 * قسم «مستخلصات الباطن (SubIPC)» — بطاقة العقد الباطن الموسعة
 * (المرحلة أ — docs/retention-subipc-advance-design.md §5.4):
 *  · جدول المستخلصات بآلة حالاتها (مسودة→مقدم→معتمد→مدفوع / ملغي)
 *  · نافذة إنشاء ببنود من بنود العقد (كمية هذا المستخلص مقابل المتاح)
 *  · خصومات: نسبة محتجزات · استرداد آلي للدفعة المقدمة · أخرى
 *  · الصرف عبر سند صرف باطن عادي (بوابة العميل والسقف تلقائيًا) — وإلغاء السند يعيده لمعتمد
 *  · مؤشرات: تراكمي معتمد/مدفوع/محتجز قائم
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, CheckCheck, Loader2, PiggyBank, Plus, Send, Trash2, X } from "lucide-react";

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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { apiDelete, apiGet, apiPost } from "./api";
import type { User } from "./contrack-types";
import { errMessage } from "./contrack-types";
import { fmtDate, formatKWD, round3 } from "@/lib/format";
import { isManagerRole } from "./contrack-types";

// ==================== الأنواع ====================

interface CertLine {
  id: number;
  subItemId: number | null;
  description: string;
  qty: number;
  unitPrice: number;
  amount: number;
  cumulativeQty: number;
}

interface SubCertificateRow {
  id: number;
  subContractId: number;
  certNo: number;
  certNumber: string;
  certDate: string;
  periodFrom: string;
  periodTo: string;
  grossAmount: number;
  retentionRate: number;
  retentionAmount: number;
  advanceRecovery: number;
  otherDeductions: number;
  otherDeductionNote: string;
  netAmount: number;
  cumulativeAmount: number;
  status: string;
  submitBy: string;
  submitAt: string;
  approveBy: string;
  approveAt: string;
  paidVoucherId: number | null;
  paidVoucherNumber: string | null;
  cancelReason: string;
  notes: string;
  lines: CertLine[];
}

interface SubCertItem {
  id: number;
  description: string;
  unit: string;
  qty: number;
  unitPrice: number;
  amount: number;
  boqItemId: number | null;
  availableQty: number;
}

interface SubCertificatesResponse {
  certificates: SubCertificateRow[];
  items: SubCertItem[];
}

const CERT_STATUS_CLS: Record<string, string> = {
  مسودة: "bg-muted text-muted-foreground",
  مقدم: "bg-status-warn/15 text-status-warn",
  معتمد: "bg-primary/15 text-primary-ink",
  مدفوع: "bg-status-done/15 text-status-done",
  ملغي: "bg-status-danger/10 text-status-danger",
};

interface DraftLine {
  subItemId: string; // "none" أو معرف البند
  description: string;
  qty: string;
  unitPrice: string;
}

const EMPTY_LINE: DraftLine = { subItemId: "none", description: "", qty: "1", unitPrice: "" };

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const num = (s: string): number => {
  const n = Number(String(s).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

// ==================== المكوّن ====================

export function SubCertificatesCard({
  subContractId,
  user,
  onAuthError,
}: {
  subContractId: number;
  user: User;
  onAuthError: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);

  const query = useQuery<SubCertificatesResponse>({
    queryKey: ["sub-certificates", subContractId],
    queryFn: () => apiGet<SubCertificatesResponse>(`/api/sub-certificates?subContractId=${subContractId}`),
  });

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["sub-certificates", subContractId] });
    qc.invalidateQueries({ queryKey: ["contract"] });
    qc.invalidateQueries({ queryKey: ["subcontract"] });
    qc.invalidateQueries({ queryKey: ["vouchers"] });
  }, [qc, subContractId]);

  // ===== نافذة الإنشاء =====
  const [createOpen, setCreateOpen] = React.useState(false);
  const [certDate, setCertDate] = React.useState(todayStr());
  const [periodFrom, setPeriodFrom] = React.useState("");
  const [periodTo, setPeriodTo] = React.useState("");
  const [retentionRate, setRetentionRate] = React.useState("0");
  const [otherDeductions, setOtherDeductions] = React.useState("0");
  const [otherDeductionNote, setOtherDeductionNote] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [draftLines, setDraftLines] = React.useState<DraftLine[]>([{ ...EMPTY_LINE }]);

  const items = query.data?.items ?? [];
  const itemById = new Map(items.map((it) => [it.id, it]));

  const draftTotals = React.useMemo(() => {
    let gross = 0;
    for (const l of draftLines) {
      gross += round3(num(l.qty) * num(l.unitPrice));
    }
    gross = round3(gross);
    const rate = Math.min(25, Math.max(0, num(retentionRate)));
    const retention = round3((gross * rate) / 100);
    const other = Math.max(0, num(otherDeductions));
    const net = round3(Math.max(0, gross - retention - other));
    return { gross, retention, other, net, rate };
  }, [draftLines, retentionRate, otherDeductions]);

  const createMutation = useMutation({
    mutationFn: () =>
      apiPost<{ certificate: { certNumber: string } }>("/api/sub-certificates", {
        subContractId,
        certDate,
        periodFrom: periodFrom || undefined,
        periodTo: periodTo || undefined,
        retentionRate: draftTotals.rate,
        otherDeductions: draftTotals.other,
        otherDeductionNote: otherDeductionNote.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: draftLines
          .filter((l) => l.description.trim() && num(l.qty) > 0)
          .map((l) => ({
            subItemId: l.subItemId !== "none" ? Number(l.subItemId) : null,
            description: l.description.trim(),
            qty: num(l.qty),
            unitPrice: num(l.unitPrice),
          })),
      }),
    onSuccess: (res) => {
      invalidate();
      setCreateOpen(false);
      resetForm();
      toast({ title: "أُنشئ المستخلص", description: `${res.certificate.certNumber} — مسودة قابلة للتعديل حتى التقديم` });
    },
    onError: (e) => {
      if (e instanceof Error && "status" in e && (e as { status?: number }).status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر إنشاء المستخلص", description: errMessage(e) });
    },
  });

  const resetForm = () => {
    setCertDate(todayStr());
    setPeriodFrom("");
    setPeriodTo("");
    setRetentionRate("0");
    setOtherDeductions("0");
    setOtherDeductionNote("");
    setNotes("");
    setDraftLines([{ ...EMPTY_LINE }]);
  };

  // ===== آلة الحالات =====
  const submitMutation = useMutation({
    mutationFn: (id: number) => apiPost(`/api/sub-certificates/${id}/submit`, {}),
    onSuccess: () => {
      invalidate();
      toast({ title: "قُدّم المستخلص" });
    },
    onError: (e) => toast({ variant: "destructive", title: "تعذر التقديم", description: errMessage(e) }),
  });
  const approveMutation = useMutation({
    mutationFn: (id: number) => apiPost<{ cumulativeAmount: number }>(`/api/sub-certificates/${id}/approve`, {}),
    onSuccess: (res) => {
      invalidate();
      toast({
        title: "اعتمد المستخلص",
        description: `جُمّدت اللقطات — التراكمي ${formatKWD(res.cumulativeAmount)} (الاعتماد لحظة الحقيقة)`,
      });
    },
    onError: (e) => toast({ variant: "destructive", title: "تعذر الاعتماد", description: errMessage(e) }),
  });
  const payMutation = useMutation({
    mutationFn: (id: number) =>
      apiPost<{ voucherNumber: string; amount: number }>(`/api/sub-certificates/${id}/pay`, {}),
    onSuccess: (res) => {
      invalidate();
      toast({
        title: "صُرف المستخلص",
        description: `سند الصرف ${res.voucherNumber} بمبلغ ${formatKWD(res.amount)} — إلغاؤه لاحقًا يعيد المستخلص لـ«معتمد»`,
      });
    },
    onError: (e) => toast({ variant: "destructive", title: "تعذر الصرف", description: errMessage(e) }),
  });
  const [cancelTarget, setCancelTarget] = React.useState<SubCertificateRow | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");
  const cancelMutation = useMutation({
    mutationFn: () => apiPost(`/api/sub-certificates/${cancelTarget?.id}/cancel`, { reason: cancelReason.trim() }),
    onSuccess: () => {
      invalidate();
      setCancelTarget(null);
      setCancelReason("");
      toast({ title: "أُلغي المستخلص" });
    },
    onError: (e) => toast({ variant: "destructive", title: "تعذر الإلغاء", description: errMessage(e) }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/sub-certificates/${id}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "حُذفت المسودة" });
    },
    onError: (e) => toast({ variant: "destructive", title: "تعذر الحذف", description: errMessage(e) }),
  });

  const certificates = query.data?.certificates ?? [];
  const actionPending =
    submitMutation.isPending || approveMutation.isPending || payMutation.isPending || cancelMutation.isPending || deleteMutation.isPending;

  // مؤشرات محلية من القائمة
  let approvedCum = 0;
  let paidCum = 0;
  let pendingRetention = 0;
  for (const c of certificates) {
    if (c.status === "ملغي") continue;
    if (c.status === "معتمد" || c.status === "مدفوع") {
      approvedCum += c.netAmount;
      pendingRetention += c.retentionAmount;
    }
    if (c.status === "مدفوع") paidCum += c.netAmount;
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-bold">
            <PiggyBank className="size-4 text-primary-ink/70" />
            مستخلصات الباطن (SubIPC)
          </h3>
          <Button size="sm" className="h-8 gap-1" onClick={() => setCreateOpen(true)} disabled={query.isLoading}>
            <Plus className="size-3.5" />
            مستخلص جديد
          </Button>
        </div>

        {certificates.length > 0 && (
          <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-2 text-center text-xs">
            <div>
              <div className="text-muted-foreground">تراكمي معتمد</div>
              <div className="font-mono font-bold tabular-nums" dir="ltr">{formatKWD(approvedCum)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">مدفوع</div>
              <div className="font-mono font-bold tabular-nums text-status-done" dir="ltr">{formatKWD(paidCum)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">محتجز قائم</div>
              <div className="font-mono font-bold tabular-nums text-status-warn" dir="ltr">{formatKWD(pendingRetention)}</div>
            </div>
          </div>
        )}

        {query.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
        ) : certificates.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            لا مستخلصات بعد — أنشئ مستخلصًا بكميات من بنود العقد (التراكمي الكمي يُجمَّد عند الاعتماد).
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="text-start">الرقم</TableHead>
                  <TableHead className="text-start">التاريخ</TableHead>
                  <TableHead className="text-end">الإجمالي</TableHead>
                  <TableHead className="text-end">محتجز</TableHead>
                  <TableHead className="text-end">استرداد</TableHead>
                  <TableHead className="text-end">أخرى</TableHead>
                  <TableHead className="text-end">الصافي</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  <TableHead className="text-start">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {certificates.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs font-bold" dir="ltr">{c.certNumber}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDate(c.certDate)}</TableCell>
                    <TableCell className="text-end text-xs tabular-nums" dir="ltr">{formatKWD(c.grossAmount)}</TableCell>
                    <TableCell className="text-end text-xs tabular-nums text-status-warn" dir="ltr">{formatKWD(c.retentionAmount)}</TableCell>
                    <TableCell className="text-end text-xs tabular-nums" dir="ltr">{formatKWD(c.advanceRecovery)}</TableCell>
                    <TableCell className="text-end text-xs tabular-nums" dir="ltr">{formatKWD(c.otherDeductions)}</TableCell>
                    <TableCell className="text-end text-xs font-bold tabular-nums text-primary-ink" dir="ltr">{formatKWD(c.netAmount)}</TableCell>
                    <TableCell>
                      <Badge className={`border-0 text-[11px] ${CERT_STATUS_CLS[c.status] ?? "bg-muted"}`}>{c.status}</Badge>
                      {c.status === "ملغي" && c.cancelReason && (
                        <p className="mt-1 max-w-28 truncate text-[10px] text-muted-foreground" title={c.cancelReason}>{c.cancelReason}</p>
                      )}
                      {c.paidVoucherNumber && (
                        <p className="mt-1 font-mono text-[10px] text-muted-foreground" dir="ltr">{c.paidVoucherNumber}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        {c.status === "مسودة" && (
                          <>
                            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" disabled={actionPending} onClick={() => submitMutation.mutate(c.id)}>
                              <Send className="size-3" /> تقديم
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-status-danger"
                              disabled={actionPending}
                              aria-label={`حذف المسودة ${c.certNumber}`}
                              onClick={() => deleteMutation.mutate(c.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </>
                        )}
                        {c.status === "مقدم" && (
                          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" disabled={actionPending} onClick={() => approveMutation.mutate(c.id)}>
                            <CheckCheck className="size-3" /> اعتماد
                          </Button>
                        )}
                        {c.status === "معتمد" && manager && (
                          <Button size="sm" className="h-7 gap-1 px-2 text-[11px]" disabled={actionPending} onClick={() => payMutation.mutate(c.id)}>
                            <Banknote className="size-3" /> صرف
                          </Button>
                        )}
                        {c.status !== "مدفوع" && c.status !== "ملغي" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-status-danger"
                            disabled={actionPending}
                            onClick={() => {
                              setCancelTarget(c);
                              setCancelReason("");
                            }}
                          >
                            <X className="size-3" /> إلغاء
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

      {/* ===== نافذة إنشاء مستخلص ===== */}
      <Dialog open={createOpen} onOpenChange={(o) => (o ? setCreateOpen(true) : (setCreateOpen(false), resetForm()))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>مستخلص باطن جديد</DialogTitle>
            <DialogDescription>
              اختر الكميات من بنود العقد — «المتاح» = كمية البند − ما استُخلص سابقًا (غير الملغي). اللقطات تُجمَّد لحظة الاعتماد.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">تاريخ المستخلص *</Label>
              <Input type="date" className="h-9" value={certDate} onChange={(e) => setCertDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">الفترة من</Label>
              <Input type="date" className="h-9" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">إلى</Label>
              <Input type="date" className="h-9" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
            </div>
          </div>

          {/* أسطر المستخلص */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold">أسطر الأعمال المنفذة</Label>
              <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => setDraftLines((p) => [...p, { ...EMPTY_LINE }])}>
                <Plus className="size-3" /> سطر
              </Button>
            </div>
            <div className="space-y-2">
              {draftLines.map((l, idx) => {
                const item = l.subItemId !== "none" ? itemById.get(Number(l.subItemId)) : undefined;
                return (
                  <div key={idx} className="space-y-2 rounded-lg border p-2.5">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">بند العقد (اختياري — يتحقق التراكمي الكمي)</Label>
                        <select
                          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                          value={l.subItemId}
                          onChange={(e) => {
                            const v = e.target.value;
                            setDraftLines((p) =>
                              p.map((row, i) =>
                                i === idx
                                  ? v !== "none" && itemById.get(Number(v))
                                    ? {
                                        ...row,
                                        subItemId: v,
                                        description: itemById.get(Number(v))!.description,
                                        unitPrice: String(itemById.get(Number(v))!.unitPrice),
                                      }
                                    : { ...row, subItemId: v }
                                  : row
                              )
                            );
                          }}
                        >
                          <option value="none">سطر حر (بلا بند)</option>
                          {items.map((it) => (
                            <option key={it.id} value={String(it.id)} disabled={it.availableQty <= 0}>
                              {it.description} — متاح {round3(it.availableQty)} {it.unit}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">الوصف *</Label>
                        <Input
                          className="h-9"
                          value={l.description}
                          onChange={(e) => setDraftLines((p) => p.map((row, i) => (i === idx ? { ...row, description: e.target.value } : row)))}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">
                          الكمية {item ? `(المتاح ${round3(item.availableQty)})` : ""}
                        </Label>
                        <Input
                          className="h-9 ltr text-start"
                          dir="ltr"
                          inputMode="decimal"
                          value={l.qty}
                          onChange={(e) => setDraftLines((p) => p.map((row, i) => (i === idx ? { ...row, qty: e.target.value } : row)))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">سعر الوحدة</Label>
                        <Input
                          className="h-9 ltr text-start"
                          dir="ltr"
                          inputMode="decimal"
                          value={l.unitPrice}
                          onChange={(e) => setDraftLines((p) => p.map((row, i) => (i === idx ? { ...row, unitPrice: e.target.value } : row)))}
                        />
                      </div>
                      <div className="flex items-end justify-between gap-1">
                        <div className="text-xs">
                          <span className="text-muted-foreground">الإجمالي </span>
                          <span className="font-bold tabular-nums" dir="ltr">{formatKWD(round3(num(l.qty) * num(l.unitPrice)))}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-status-danger"
                          disabled={draftLines.length === 1}
                          onClick={() => setDraftLines((p) => p.filter((_, i) => i !== idx))}
                          aria-label="إزالة السطر"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* الخصومات */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs">نسبة المحتجزات %</Label>
              <div className="flex items-center gap-1">
                {[0, 5, 10].map((p) => (
                  <Button key={p} type="button" variant={draftTotals.rate === p ? "default" : "outline"} size="sm" className="h-8 px-2" onClick={() => setRetentionRate(String(p))}>
                    {p}%
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">خصومات أخرى (د.ك)</Label>
              <Input className="h-9 ltr text-start" dir="ltr" inputMode="decimal" value={otherDeductions} onChange={(e) => setOtherDeductions(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">ملاحظة الخصومات الأخرى</Label>
              <Input className="h-9" value={otherDeductionNote} onChange={(e) => setOtherDeductionNote(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">ملاحظات</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {/* شريط الإجماليات */}
          <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-3 text-center text-xs sm:grid-cols-4">
            <div>
              <div className="text-muted-foreground">إجمالي المنفذ</div>
              <div className="font-mono font-bold tabular-nums" dir="ltr">{formatKWD(draftTotals.gross)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">المحتجزات</div>
              <div className="font-mono font-bold tabular-nums text-status-warn" dir="ltr">{formatKWD(draftTotals.retention)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">استرداد الدفعة</div>
              <div className="text-[11px] text-muted-foreground">آلي خادميًا حسب نسبة العقد</div>
            </div>
            <div>
              <div className="text-muted-foreground">الصافي</div>
              <div className="font-mono font-extrabold tabular-nums text-primary-ink" dir="ltr">{formatKWD(draftTotals.net)}</div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => { setCreateOpen(false); resetForm(); }} disabled={createMutation.isPending}>
              إلغاء
            </Button>
            <Button className="h-9 gap-2" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              إنشاء المسودة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== نافذة إلغاء المستخلص ===== */}
      <AlertDialog open={cancelTarget !== null} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إلغاء المستخلص {cancelTarget?.certNumber}</AlertDialogTitle>
            <AlertDialogDescription>
              الإلغاء يُخرج كمياته من التراكمي ويعيدها للمتاح — يُسجَّل بسبب إلزامي.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">سبب الإلغاء *</Label>
            <Textarea rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>تراجع</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!cancelReason.trim() || cancelMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                cancelMutation.mutate();
              }}
            >
              {cancelMutation.isPending && <Loader2 className="me-1 size-4 animate-spin" />}
              إلغاء المستخلص
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
