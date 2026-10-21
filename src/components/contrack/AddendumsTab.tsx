"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  CheckCircle2,
  Download,
  FileDiff,
  HandCoins,
  Loader2,
  Plus,
  ShieldAlert,
  Trash2,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { SearchableSelect } from "./SearchableSelect";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiFetch, apiGet, apiPatch, apiPost } from "./api";
import type {
  AddendumDetailResponse,
  AddendumRow,
  AddendumsResponse,
  ContractDetailResponse,
  SubContractsResponse,
  User,
} from "./contrack-types";
import { ADDENDUM_TYPE_BADGE, errMessage, isManagerRole } from "./contrack-types";
import { fmtDate, formatKWD, round3, statusBadgeClass } from "@/lib/format";
import { AddendumPartPage } from "./AddendumPartPage";

interface AddendumsTabProps {
  contract: ContractDetailResponse;
  user: User;
  onAuthError: () => void;
}

type Side = "client" | "sub";

/** تابا الجهتين (المكتبى 1479/1500): الأوامر على العميل مقابل أوامر الباطن */
type AdxSide = "client" | "sub";

/** رؤوس تصدير الأوامر — حرفية من _export_addendums (contract_hub.py:1315) */
const ADX_EXPORT_HEADS = ["الرقم", "النوع", "الجهة", "التاريخ", "السبب", "زيادة", "خصم", "الصافي", "بنود", "مُنفّذ", "الحالة", "سبب الإلغاء"];

const ACTION_LABEL: Record<string, string> = {
  add: "إضافة بند",
  delete: "حذف بند",
  unlink: "فك ربط مرحلة",
};

const REF_LABEL: Record<string, string> = {
  boq: "بنود الكميات",
  plan: "دفعة",
  stage: "مرحلة",
};

const STEP_LABELS = ["بيانات الملحق", "الأجزاء", "مراجعة واعتماد"];

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function netText(net: number): string {
  if (net > 0) return `+${formatKWD(net)}`;
  if (net < 0) return `−${formatKWD(Math.abs(net))}`;
  return formatKWD(0);
}

function netClass(net: number): string {
  if (net > 0) return "text-status-done";
  if (net < 0) return "text-status-danger";
  return "text-muted-foreground";
}

/** تنزيل CSV بترميز UTF-8 مع BOM (نمط التصدير الخلفي) */
function downloadCsv(title: string, heads: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [heads.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv; charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/\s+/g, "-") || "تصدير"}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function KpiCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <Card className="gap-1 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="size-4 text-primary/70" />
      </div>
      <p className={`text-base font-bold tabular-nums sm:text-lg ${tone || ""}`}>{value}</p>
    </Card>
  );
}

export function AddendumsTab({ contract, user, onAuthError }: AddendumsTabProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);

  const contractId = contract.contract.id;
  const current = Number(contract.current || 0);
  const collected = Number(contract.collected || 0);

  // ===== تابا الجهتين (العميل / المقاول) — المكتبى 1456–1500 =====
  const [adxSide, setAdxSide] = React.useState<AdxSide>("client");

  // ===== قائمة الملاحق =====
  const listQuery = useQuery<AddendumsResponse>({
    queryKey: ["contract", contractId, "addendums"],
    queryFn: () => apiGet<AddendumsResponse>(`/api/contracts/${contractId}/addendums`),
  });
  const allItems: AddendumRow[] = listQuery.data?.items ?? [];
  // فصل الأوامر حسب الجهة (المكتبى _sec_addendums 2304–2313)
  const items = adxSide === "client" ? allItems.filter((i) => i.side !== "sub") : allItems.filter((i) => i.side === "sub");
  const approvedNet = round3(
    allItems
      .filter((i) => i.status === "معتمد")
      .reduce((s, i) => s + Number(i.net ?? Number(i.amountAdd || 0) - Number(i.amountDeduct || 0)), 0)
  );

  React.useEffect(() => {
    const e = listQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [listQuery.error, onAuthError]);

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["contract", contractId] });
    qc.invalidateQueries({ queryKey: ["contracts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }, [qc, contractId]);

  const fail = React.useCallback(
    (e: unknown, title: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title, description: errMessage(e) });
    },
    [onAuthError, toast]
  );

  // ===== حوار الملحق =====
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [currentId, setCurrentId] = React.useState<number | null>(null);
  const [saving, setSaving] = React.useState(false);

  const [form, setForm] = React.useState({
    addendumType: "أمر تغييري",
    side: "client" as Side,
    subContractId: "none",
    adate: todayStr(),
    reason: "",
    description: "",
    amountAdd: "",
    amountDeduct: "",
  });

  const detailQuery = useQuery<AddendumDetailResponse>({
    queryKey: ["addendum", currentId],
    queryFn: () => apiGet<AddendumDetailResponse>(`/api/addendums/${currentId}`),
    enabled: dialogOpen && currentId !== null,
  });
  // الخلفي يرسل المفرد بمفتاح «addendum» (نقبل «item» احتياطًا)
  const detailItem = detailQuery.data?.item ?? detailQuery.data?.addendum ?? null;
  const parts = detailQuery.data?.items ?? [];
  const canEditStep1 =
    currentId === null ||
    (detailItem
      ? detailItem.editable ?? (detailItem.status !== "معتمد" && detailItem.status !== "ملغى")
      : false);

  const subContractsQuery = useQuery<SubContractsResponse>({
    queryKey: ["sub-contracts", "contract", contractId],
    queryFn: () => apiGet<SubContractsResponse>(`/api/sub-contracts?contractId=${contractId}`),
    enabled: dialogOpen && form.side === "sub",
  });

  // ===== صفحة «إضافة جزء للملحق» (بدل النافذة) =====
  const [partPage, setPartPage] = React.useState(false);

  const openNew = (side: Side = "client") => {
    setForm({
      addendumType: "أمر تغييري",
      side,
      subContractId: "none",
      adate: todayStr(),
      reason: "",
      description: "",
      amountAdd: "",
      amountDeduct: "",
    });
    setCurrentId(null);
    setStep(1);
    setDialogOpen(true);
  };

  const openExisting = (row: AddendumRow) => {
    setForm({
      addendumType: row.addendumType || "أمر تغييري",
      side: (row.side === "sub" ? "sub" : "client") as Side,
      subContractId: row.subContractId ? String(row.subContractId) : "none",
      adate: row.adate || todayStr(),
      reason: row.reason || "",
      description: row.description || "",
      amountAdd: Number(row.amountAdd || 0) ? String(row.amountAdd) : "",
      amountDeduct: Number(row.amountDeduct || 0) ? String(row.amountDeduct) : "",
    });
    setCurrentId(row.id);
    setStep(row.status === "مسودة" ? 1 : 2);
    setDialogOpen(true);
  };

  // ===== حفظ بيانات الملحق (خطوة 1) =====
  const saveStep1 = async () => {
    if (!form.reason.trim()) {
      toast({ variant: "destructive", title: "أدخل سبب الملحق" });
      return;
    }
    if (form.side === "sub" && form.subContractId === "none") {
      toast({ variant: "destructive", title: "اختر عقد الباطن" });
      return;
    }
    try {
      setSaving(true);
      let id = currentId;
      if (id === null) {
        const body: Record<string, unknown> = {
          addendumType: form.addendumType,
          adate: form.adate,
          reason: form.reason.trim(),
          description: form.description.trim(),
          side: form.side,
        };
        if (form.side === "sub") body.subContractId = Number(form.subContractId);
        const res = await apiPost<{ item?: AddendumRow; addendum?: AddendumRow }>(
          `/api/contracts/${contractId}/addendums`,
          body
        );
        const created = res.item ?? res.addendum;
        if (!created?.id) throw new Error("استجابة غير متوقعة من الخلفي عند إنشاء الملحق");
        id = created.id;
        setCurrentId(id);
      }
      if (canEditStep1) {
        // المبالغ المباشرة عبر PATCH — ولملحق الباطن تُدار القيم من أجزائه فقط
        const patch: Record<string, unknown> = {
          reason: form.reason.trim(),
          description: form.description.trim(),
          adate: form.adate,
        };
        if (form.side !== "sub") {
          patch.amountAdd = Number(form.amountAdd || 0);
          patch.amountDeduct = Number(form.amountDeduct || 0);
        }
        await apiPatch(`/api/addendums/${id}`, patch);
      }
      qc.invalidateQueries({ queryKey: ["contract", contractId, "addendums"] });
      qc.invalidateQueries({ queryKey: ["addendum", id] });
      setStep(2);
    } catch (e) {
      fail(e, "تعذر حفظ بيانات الملحق");
    } finally {
      setSaving(false);
    }
  };

  // ===== حذف جزء من قائمة الأجزاء (خطوة 2) =====
  const delPartMutation = useMutation({
    mutationFn: (partId: number) =>
      apiFetch(`/api/addendums/${currentId}/parts?partId=${partId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["addendum", currentId] });
      qc.invalidateQueries({ queryKey: ["contract", contractId, "addendums"] });
      toast({ title: "حُذف الجزء من الملحق" });
    },
    onError: (e) => fail(e, "تعذر حذف الجزء"),
  });

  // ===== الاعتماد والإلغاء =====
  const [approveTarget, setApproveTarget] = React.useState<AddendumRow | null>(null);
  const [cancelTarget, setCancelTarget] = React.useState<AddendumRow | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");
  const [approveError, setApproveError] = React.useState("");

  const approveMutation = useMutation({
    mutationFn: (id: number) => apiPost<{ item: AddendumRow }>(`/api/addendums/${id}/approve`),
    onSuccess: (_res, id) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["addendum", id] });
      setApproveTarget(null);
      setApproveError("");
      setDialogOpen(false);
      toast({ title: "تم اعتماد الملحق", description: "طُبقت أجزاؤه وتغيّرت القيمة الحالية للعقد" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      // رسالة الحارسين تُعرض حرفيًا
      setApproveError(errMessage(e));
      toast({ variant: "destructive", title: "رُفض الاعتماد", description: errMessage(e) });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string; wasApproved?: boolean }) =>
      apiFetch<{ item?: AddendumRow }>(`/api/addendums/${id}`, { method: "DELETE", body: { reason } }),
    onSuccess: (_res, vars) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["addendum", vars.id] });
      setCancelTarget(null);
      setCancelReason("");
      setDialogOpen(false);
      toast({
        title: "أُلغي الملحق",
        description:
          vars.wasApproved
            ? "نُفّذ التراجع الكامل: عُكس أثر الأجزاء المطبقة وعادت القيمة الحالية"
            : "بقي الملحق مسجلًا بحالة ملغى دون أثر مالي",
      });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر إلغاء الملحق", description: errMessage(e) });
    },
  });

  // ===== ملخص المراجعة (خطوة 3) =====
  // الخلفي يعيد حساب رأس الملحق من الأجزاء بعد كل إضافة/إزالة — الصافي المعتمد هو detailItem.net
  const partsAdd = round3(parts.filter((p) => p.action === "add").reduce((s, p) => s + Number(p.amount || 0), 0));
  const partsDel = round3(parts.filter((p) => p.action === "delete").reduce((s, p) => s + Number(p.amount || 0), 0));
  const rowNet = detailItem
    ? round3(Number(detailItem.net ?? Number(detailItem.amountAdd || 0) - Number(detailItem.amountDeduct || 0)))
    : 0;
  const currentAfter = round3(current + rowNet);
  const guardValue = rowNet < 0 && currentAfter < collected - 0.001;
  const guardSub = detailItem?.side === "sub" && !detailItem.subContractId;

  const dialogStatus = detailItem?.status ?? (currentId === null ? "مسودة" : "");

  // صفحة «إضافة جزء للملحق» تُعرض مكان التاب مباشرة (لا نافذة) — بعد كل الـhooks
  // dialogOpen يبقى صحيحًا فتعود للحوار عند خطوة الأجزاء بعد الحفظ/الإلغاء
  if (partPage) {
    return (
      <AddendumPartPage
        contractId={contractId}
        contractNumber={contract.contract.contractNumber}
        addendumId={currentId ?? 0}
        addendumNumber={detailItem?.addendumNumber ?? ""}
        planLines={contract.plan}
        stages={contract.stages}
        onAuthError={onAuthError}
        onSaved={() => setPartPage(false)}
        onCancel={() => setPartPage(false)}
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* البطاقات المالية + شارة الصافي */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard icon={Wallet} label="القيمة الأصلية" value={formatKWD(contract.contract.amount)} />
        <KpiCard icon={TrendingUp} label="القيمة الحالية" value={formatKWD(current)} tone="text-primary" />
        <KpiCard icon={HandCoins} label="المحصّل" value={formatKWD(collected)} />
      </div>

      {/* سطر القيمة المكتبى (add_value_lbl 2384–2386) + تصدير الأوامر (1450) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            className={`gap-1 ${approvedNet > 0 ? "bg-status-done-bg text-status-done" : approvedNet < 0 ? "bg-status-danger-bg text-status-danger" : "bg-muted text-muted-foreground"}`}
          >
            <FileDiff className="size-3.5" />
            صافي الملاحق المعتمدة: {netText(approvedNet)}
          </Badge>
          <span className="text-xs font-bold text-muted-foreground">
            الأصلية: {formatKWD(contract.contract.amount)} + ملحقات: {approvedNet >= 0 ? "+" : "−"}
            {formatKWD(Math.abs(approvedNet))} = الحالية: {formatKWD(current)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            title="تصدير الأوامر التغييرية إلى Excel"
            aria-label="تصدير الأوامر التغييرية"
            disabled={listQuery.isLoading || allItems.length === 0}
            onClick={() =>
              downloadCsv(
                "أوامر_التغيير",
                ADX_EXPORT_HEADS,
                allItems.map((a) => [
                  a.addendumNumber,
                  a.addendumType || "أمر تغييري",
                  a.side === "sub" ? "مقاول" : "عميل",
                  a.adate,
                  a.reason,
                  Number(a.amountAdd || 0),
                  Number(a.amountDeduct || 0),
                  Number(a.net ?? Number(a.amountAdd || 0) - Number(a.amountDeduct || 0)),
                  a.itemsCount,
                  a.approvedDate || "—",
                  a.status,
                  a.cancelReason || "",
                ])
              )
            }
          >
            <Download className="size-4" />
          </Button>
        </div>
      </div>

      {/* تابا الجهتين — المكتبى 1456–1500: «👤 العميل» و«🔨 المقاول» */}
      <div className="flex gap-1.5" role="tablist" aria-label="جهة الأوامر">
        {(
          [
            { key: "client" as AdxSide, label: "👤 العميل", btn: "＋ أمر تغييري للعميل" },
            { key: "sub" as AdxSide, label: "🔨 المقاول", btn: "＋ أمر تغييري للمقاول" },
          ]
        ).map((t) => {
          const active = adxSide === t.key;
          return (
            <div
              key={t.key}
              className={`flex flex-1 flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 ${active ? "border-primary bg-primary/10" : "border-border bg-card"}`}
            >
              <button
                role="tab"
                aria-selected={active}
                onClick={() => setAdxSide(t.key)}
                className={`min-h-[32px] text-sm font-bold ${active ? "text-primary" : "text-muted-foreground"}`}
              >
                {t.label}
              </button>
              {manager && (
                <Button
                  size="sm"
                  variant={active ? "default" : "outline"}
                  className="h-8 gap-1"
                  onClick={() => openNew(t.key)}
                  title={t.key === "client" ? "إضافة أو تعديل بند من جهة العميل" : "إضافة أو تعديل بند من جهة المقاول"}
                >
                  <Plus className="size-3.5" />
                  {t.btn}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* القائمة */}
      {listQuery.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : listQuery.isError ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">
            تعذر تحميل الملاحق — {errMessage(listQuery.error)}
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <FileDiff className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">
              {adxSide === "client" ? "لا ملاحق على جهة العميل بعد" : "لا ملاحق على جهة المقاول (الباطن) بعد"}
            </p>
            <p className="text-xs text-muted-foreground">
              أنشئ ملحقًا («عقد إضافي» بزيادة أو «أمر تغييري») ثم أضف أجزاءه واعتمده ليتغير صافي القيمة.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((row) => {
            const cancelled = row.status === "ملغى";
            const editable = row.status === "مسودة" || row.status === "تحت المراجعة";
            return (
              <Card key={row.id} className={cancelled ? "opacity-60" : ""}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold">{row.addendumNumber}</span>
                    <Badge className={`border-transparent ${ADDENDUM_TYPE_BADGE[row.addendumType] || ""}`}>
                      {row.addendumType}
                    </Badge>
                    <Badge className={`border-transparent ${statusBadgeClass(row.status)}`}>{row.status}</Badge>
                    {row.side === "sub" && (
                      <Badge variant="outline" className="text-[11px]">
                        باطن
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">بتاريخ {fmtDate(row.adate)}</span>
                    <span className={`ms-auto text-sm font-bold tabular-nums ${netClass(Number(row.net ?? 0))}`}>
                      {netText(Number(row.net ?? Number(row.amountAdd || 0) - Number(row.amountDeduct || 0)))}
                    </span>
                  </div>

                  <div className="text-sm">
                    <span className="font-medium">السبب: </span>
                    {row.reason || "—"}
                  </div>
                  {row.description && (
                    <p className="text-xs text-muted-foreground">{row.description}</p>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>الأجزاء: {row.itemsCount}</span>
                    {row.approvedDate && <span>اعتماد: {fmtDate(row.approvedDate)}</span>}
                    {cancelled && <span className="text-destructive">سبب الإلغاء: {row.cancelReason || "—"}</span>}
                  </div>

                  <div className="flex flex-wrap justify-end gap-1.5">
                    {editable && (
                      <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => openExisting(row)}>
                        <FileDiff className="size-3.5" />
                        فتح
                      </Button>
                    )}
                    {editable && manager && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 text-status-done hover:text-status-done"
                          disabled={approveMutation.isPending}
                          onClick={() => {
                            setApproveError("");
                            setApproveTarget(row);
                          }}
                        >
                          <CheckCircle2 className="size-3.5" />
                          اعتماد
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 text-destructive hover:text-destructive"
                          onClick={() => {
                            setCancelReason("");
                            setCancelTarget(row);
                          }}
                        >
                          <Ban className="size-3.5" />
                          إلغاء
                        </Button>
                      </>
                    )}
                    {row.status === "معتمد" && manager && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 text-destructive hover:text-destructive"
                        onClick={() => {
                          setCancelReason("");
                          setCancelTarget(row);
                        }}
                      >
                        <Ban className="size-3.5" />
                        إلغاء (تراجع كامل)
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ===== حوار الملحق (3 مراحل) ===== */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {currentId === null ? "ملحق جديد" : `ملحق ${detailItem?.addendumNumber ?? ""}`}
              {dialogStatus && (
                <Badge className={`border-transparent text-[11px] ${statusBadgeClass(dialogStatus)}`}>
                  {dialogStatus}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              ثلاث مراحل: بيانات الملحق ثم أجزاؤه (بنود/دفعات/مراحل) ثم المراجعة والاعتماد — الاعتماد يطبق الأجزاء فعليًا.
            </DialogDescription>
          </DialogHeader>

          {/* مؤشر الخطوات */}
          <div className="flex items-center gap-1.5 text-[11px]">
            {STEP_LABELS.map((label, i) => {
              const n = (i + 1) as 1 | 2 | 3;
              const active = step === n;
              const done = step > n;
              return (
                <div
                  key={label}
                  className={`flex items-center gap-1 rounded-full border px-2 py-1 ${
                    active
                      ? "border-primary bg-primary/10 font-semibold text-primary"
                      : done
                        ? "border-status-done/40 bg-status-done-bg text-status-done"
                        : "text-muted-foreground"
                  }`}
                >
                  <span className="font-bold">{n}</span>
                  <span className="hidden sm:inline">{label}</span>
                </div>
              );
            })}
          </div>

          {/* ===== المرحلة 1: البيانات ===== */}
          {step === 1 && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>النوع</Label>
                  <Select
                    value={form.addendumType}
                    disabled={!canEditStep1}
                    onValueChange={(v) => setForm((f) => ({ ...f, addendumType: v }))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="عقد إضافي">عقد إضافي</SelectItem>
                      <SelectItem value="أمر تغييري">أمر تغييري</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>الطرف</Label>
                  <Select
                    value={form.side}
                    disabled={!canEditStep1}
                    onValueChange={(v) => setForm((f) => ({ ...f, side: v as Side, subContractId: v === "sub" ? f.subContractId : "none" }))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="client">العميل</SelectItem>
                      <SelectItem value="sub">مقاول باطن</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.side === "sub" && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>عقد الباطن</Label>
                    <SearchableSelect
                      value={form.subContractId}
                      disabled={!canEditStep1}
                      onValueChange={(v) => setForm((f) => ({ ...f, subContractId: v }))}
                      options={[
                        { value: "none", label: "— اختر —" },
                        ...(subContractsQuery.data?.items ?? []).map((s) => ({ value: String(s.id), label: `${s.subcontractor.name} — ${formatKWD(s.amount)} (متبقي ${formatKWD(s.remaining)})` })),
                      ]}
                      placeholder="اختر العقد الباطن"
                      searchPlaceholder="ابحث باسم المقاول…"
                      emptyText="لا نتائج مطابقة"
                    />
                    {form.side === "sub" && subContractsQuery.isSuccess && (subContractsQuery.data?.items ?? []).length === 0 && (
                      <p className="text-xs text-destructive">لا عقود باطنة على هذا العقد — أنشئ عقدًا باطنًا أولًا.</p>
                    )}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>التاريخ</Label>
                  <Input
                    type="date"
                    className="h-9"
                    value={form.adate}
                    disabled={!canEditStep1}
                    onChange={(e) => setForm((f) => ({ ...f, adate: e.target.value }))}
                  />
                </div>
                {form.side !== "sub" ? (
                  <>
                    <div className="space-y-1.5">
                      <Label>مبلغ زيادة مباشر (اختياري)</Label>
                      <Input
                        type="number"
                        step="0.001"
                        min="0"
                        className="h-9"
                        dir="ltr"
                        value={form.amountAdd}
                        disabled={!canEditStep1}
                        onChange={(e) => setForm((f) => ({ ...f, amountAdd: e.target.value }))}
                        placeholder="0.000"
                      />
                      {form.addendumType === "عقد إضافي" && (
                        <p className="text-[11px] text-muted-foreground">العقد الإضافي يتطلب قيمة إضافية أكبر من صفر.</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label>مبلغ خصم مباشر (اختياري)</Label>
                      <Input
                        type="number"
                        step="0.001"
                        min="0"
                        className="h-9"
                        dir="ltr"
                        value={form.amountDeduct}
                        disabled={!canEditStep1}
                        onChange={(e) => setForm((f) => ({ ...f, amountDeduct: e.target.value }))}
                        placeholder="0.000"
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-[11px] text-status-warn sm:col-span-2">
                    قيم ملحق الباطن تُدار من أجزائه فقط — لا مبالغ مباشرة على الرأس.
                  </p>
                )}
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>السبب *</Label>
                  <Input
                    className="h-9"
                    value={form.reason}
                    disabled={!canEditStep1}
                    onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                    placeholder="مثال: زيادة في نطاق العمل بطلب العميل"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>الوصف</Label>
                  <Textarea
                    rows={2}
                    className="h-9 min-h-9"
                    value={form.description}
                    disabled={!canEditStep1}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </div>
              </div>
              {!canEditStep1 && (
                <p className="text-xs text-status-warn">
                  {dialogStatus === "معتمد" || dialogStatus === "ملغى"
                    ? "الملحق معتمد/ملغى — البيانات والأجزاء للقراءة فقط."
                    : "البيانات قابلة للتعديل حتى الاعتماد — الأجزاء أيضًا."}
                </p>
              )}
            </div>
          )}

          {/* ===== المرحلة 2: الأجزاء ===== */}
          {step === 2 && (
            <div className="space-y-3">
              {detailQuery.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : detailQuery.isError ? (
                <p className="text-sm text-destructive">تعذر تحميل الأجزاء — {errMessage(detailQuery.error)}</p>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      أجزاء الملحق ({parts.length}) — قابلة للتعديل قبل الاعتماد.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5"
                      onClick={() => setPartPage(true)}
                    >
                      <Plus className="size-3.5" />
                      إضافة جزء
                    </Button>
                  </div>

                  {parts.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                      لا أجزاء بعد — أضف بنود كميات أو دفعات أو فكّ ربط مرحلة، أو اكتفِ بالمبلغ المباشر من المرحلة 1.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {parts.map((p) => (
                        <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2 text-xs">
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            {ACTION_LABEL[p.action] || p.action}
                          </Badge>
                          <Badge variant="secondary" className="shrink-0 text-[10px]">
                            {REF_LABEL[p.refKind] || p.refKind}
                          </Badge>
                          <span className="min-w-0 flex-1 truncate">{p.description || "—"}</span>
                          {p.action === "add" && p.refKind === "boq" && (
                            <span className="text-muted-foreground">
                              {formatKWD(p.qty)} {p.unit} × {formatKWD(p.unitPrice)}
                            </span>
                          )}
                          {p.refKind === "plan" && p.dueDate && (
                            <span className="text-muted-foreground">استحقاق {fmtDate(p.dueDate)}</span>
                          )}
                          {Number(p.amount || 0) !== 0 && (
                            <span className={`font-bold tabular-nums ${p.action === "add" ? "text-status-done" : "text-status-danger"}`}>
                              {p.action === "add" ? "+" : "−"}
                              {formatKWD(Math.abs(Number(p.amount || 0)))}
                            </span>
                          )}
                          {p.applied ? (
                            <Badge className="shrink-0 bg-status-done-bg text-status-done">مُطبق</Badge>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 px-2 text-destructive hover:text-destructive"
                              disabled={delPartMutation.isPending}
                              onClick={() => delPartMutation.mutate(p.id)}
                            >
                              <Trash2 className="size-3.5" />
                              حذف
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ===== المرحلة 3: مراجعة واعتماد ===== */}
          {step === 3 && (
            <div className="space-y-3">
              <div className="space-y-1.5 rounded-lg border p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">أجزاء الإضافة</span>
                  <span className="font-bold tabular-nums text-status-done">+{formatKWD(partsAdd)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">أجزاء الحذف</span>
                  <span className="font-bold tabular-nums text-status-danger">−{formatKWD(partsDel)}</span>
                </div>
                <div className="flex justify-between border-t pt-1.5">
                  <span className="font-semibold">صافي الملحق (من الخلفي)</span>
                  <span className={`font-bold tabular-nums ${netClass(rowNet)}`}>{netText(rowNet)}</span>
                </div>
                {detailItem?.side === "sub" ? (
                  <p className="text-xs text-muted-foreground">الصافي يُطبق على قيمة عقد الباطن عند الاعتماد — لا يمس قيمة العقد.</p>
                ) : (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>القيمة الحالية بعد الاعتماد (تقديري)</span>
                    <span className="font-semibold tabular-nums">{formatKWD(currentAfter)}</span>
                  </div>
                )}
              </div>

              {(guardValue || guardSub) && (
                <div className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                  <p className="flex items-center gap-1.5 font-semibold">
                    <ShieldAlert className="size-4" />
                    تنبيه الحارسين الماليين
                  </p>
                  {guardValue && (
                    <p>
                      القيمة الحالية بعد الخصم ({formatKWD(currentAfter)}) أقل من المحصّل ({formatKWD(collected)}) — سيُرفض الاعتماد.
                    </p>
                  )}
                  {guardSub && <p>ملحق باطن بلا عقد باطن محدد — يجب أن يكون مبلغ الباطن أكبر من صفر.</p>}
                </div>
              )}

              {approveError && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs font-semibold text-destructive">
                  {approveError}
                </div>
              )}

              {!manager && (
                <p className="text-xs text-muted-foreground">الاعتماد متاح للمدير فقط — يمكنك إرسال الملحق للمراجعة.</p>
              )}
            </div>
          )}

          <DialogFooter className="flex-wrap gap-2">
            {step > 1 && (
              <Button variant="outline" className="h-9" onClick={() => setStep((s) => (s === 3 ? 2 : 1))}>
                السابق
              </Button>
            )}
            {step === 1 && (
              <Button className="h-9 gap-1.5" disabled={saving || detailQuery.isLoading} onClick={saveStep1}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                حفظ ومتابعة للأجزاء
              </Button>
            )}
            {step === 2 && (
              <Button className="h-9" onClick={() => setStep(3)}>
                متابعة للمراجعة
              </Button>
            )}
            {step === 3 && (
              <>
                {manager && currentId !== null && dialogStatus !== "معتمد" && dialogStatus !== "ملغى" && (
                  <Button
                    className="h-9 gap-1.5"
                    disabled={approveMutation.isPending}
                    onClick={() => {
                      setApproveError("");
                      approveMutation.mutate(currentId);
                    }}
                  >
                    {approveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    اعتماد الملحق
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تأكيد الاعتماد من القائمة ===== */}
      <AlertDialog open={approveTarget !== null} onOpenChange={(o) => !o && setApproveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>اعتماد {approveTarget?.addendumNumber ?? ""}؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُطبق صافي الملحق ({approveTarget ? netText(Number(approveTarget.net ?? 0)) : ""}) على القيمة الحالية
              {approveTarget && Number(approveTarget.net ?? 0) < 0 && " — وإن أصبحت القيمة أقل من المحصّل سيرفض الحارس الاعتماد"}.
              لا يمكن التراجع إلا بإلغاء كامل من المدير.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {approveError && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs font-semibold text-destructive">
              {approveError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>رجوع</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={approveMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (approveTarget) approveMutation.mutate(approveTarget.id);
              }}
            >
              {approveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              اعتماد
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== إلغاء الملحق (سبب) ===== */}
      <AlertDialog open={cancelTarget !== null} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {cancelTarget?.status === "معتمد" ? `إلغاء (تراجع كامل) عن ${cancelTarget?.addendumNumber ?? ""}؟` : `إلغاء ${cancelTarget?.addendumNumber ?? ""}؟`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget?.status === "معتمد"
                ? "سيُعكس أثر الأجزاء المطبقة فعليًا (المُنشأ يُمحى والمحذوف يعود) وتُعاد القيمة الحالية. اذكر سبب التراجع."
                : "يبقى الملحق مسجلًا بحالة ملغى دون أثر مالي. اذكر سبب الإلغاء."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            rows={2}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="سبب الإلغاء/التراجع (إلزامي)"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>رجوع</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={cancelMutation.isPending || !cancelReason.trim()}
              onClick={(e) => {
                e.preventDefault();
                if (cancelTarget)
                  cancelMutation.mutate({
                    id: cancelTarget.id,
                    reason: cancelReason.trim(),
                    wasApproved: cancelTarget.status === "معتمد",
                  });
              }}
            >
              {cancelMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              تأكيد الإلغاء
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
