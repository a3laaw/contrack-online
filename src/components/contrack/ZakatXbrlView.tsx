"use client";

/**
 * شاشة «الزكاة والتقديم الإلكتروني» — Task 111.
 * تبويبان:
 *  1) الزكاة والضريبة: إقرار الزكاة 1% (قانون 8/2019 لصندوق الكويت الوطني) وضريبة دخل
 *     الأجانب 15% (للشركات الأجنبية الملكية فقط) — صافي ربح السنة من الأستاذ حصرًا (قيود
 *     الإغلاق مستثناة)، تعديلات النموذج المعلن موثقة صفًا صفًا، الاعتماد ينشر قيد المخصص
 *     آليًا عبر المحرك الموحد (5400/2170 للزكاة، 5300/2180 للضريبة)، والإلغاء قيد عكسي موثق.
 *  2) تقديم XBRL: فحص اكتمال الخريطة (تقرير «عناصر غير مغطاة») + معاينة وثيقة iXBRL
 *     داخليًا + تنزيل ملف التقديم — التصدير النهائي محجوب عند اكتمال النقص (force لمسودة).
 * الاعتماد/الإلغاء/علم الشركة الأجنبية للمدير حصرًا — الشاشة خلف screen_zakat_xbrl.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Ban,
  FileBadge,
  Globe2,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPost, apiDelete, getStoredToken } from "./api";
import { errMessage, isManagerRole, type User } from "./contrack-types";
import { fetchBlobDownload } from "@/lib/download-blob";
import { formatKWD } from "@/lib/format";
import { DEFAULT_ZAKAT_ADJUSTMENTS, TAX_KIND_LABEL, type TaxAdjustment, type TaxDeclarationDTO, type TaxKind } from "@/lib/tax-core";

// ==================== الأنواع ====================

interface DeclarationsResponse {
  declarations: TaxDeclarationDTO[];
  currentNetProfit: number;
  currentRevenue: number;
  currentExpense: number;
  foreignOwned: boolean;
}

interface UncoveredLine {
  statement: string;
  code: string;
  name: string;
  amount: number;
}

interface CoverageResponse {
  asOf: string;
  from: string;
  complete: boolean;
  tagged: number;
  uncovered: UncoveredLine[];
  totalsTagged: string[];
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-status-warn-bg text-status-warn",
  approved: "bg-status-done-bg text-status-done",
  cancelled: "bg-status-danger-bg text-status-danger",
};

function yearStr(): number {
  return new Date().getFullYear();
}

export function ZakatXbrlView({ user, onAuthError }: { user: User; onAuthError: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);
  const [tab, setTab] = React.useState("zakat");
  const [taxYear, setTaxYear] = React.useState(() => yearStr());
  const [asOf, setAsOf] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [exporting, setExporting] = React.useState<"preview" | "download" | null>(null);

  // ==================== الإقرارات ====================
  const decQ = useQuery({
    queryKey: ["tax-declarations", taxYear],
    queryFn: async () => apiGet<DeclarationsResponse>(`/api/tax/declarations?year=${taxYear}`),
  });

  React.useEffect(() => {
    if (decQ.error instanceof ApiError && decQ.error.status === 401) onAuthError();
  }, [decQ.error, onAuthError]);

  // ==================== مسودة جديدة ====================
  const [draftOpen, setDraftOpen] = React.useState(false);
  const [draftKind, setDraftKind] = React.useState<TaxKind>("zakat");
  const [draftNotes, setDraftNotes] = React.useState("");
  const [draftAdjustments, setDraftAdjustments] = React.useState<TaxAdjustment[]>(() =>
    DEFAULT_ZAKAT_ADJUSTMENTS.map((a) => ({ ...a }))
  );

  const openDraft = () => {
    setDraftAdjustments(DEFAULT_ZAKAT_ADJUSTMENTS.map((a) => ({ ...a })));
    setDraftKind("zakat");
    setDraftNotes("");
    setDraftOpen(true);
  };

  const createDraftQ = useMutation({
    mutationFn: async () => {
      const res = await apiPost<{ declaration: TaxDeclarationDTO }>("/api/tax/declarations", {
        year: taxYear,
        kind: draftKind,
        adjustments: draftAdjustments,
        notes: draftNotes,
      });
      return res.declaration;
    },
    onSuccess: (d) => {
      toast({ title: "أُنشئت المسودة", description: `${TAX_KIND_LABEL[d.kind]} — المخصص ${formatKWD(d.amount)}` });
      setDraftOpen(false);
      qc.invalidateQueries({ queryKey: ["tax-declarations"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر إنشاء المسودة", description: errMessage(e) });
    },
  });

  const approveQ = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiPost<{ declaration: TaxDeclarationDTO }>(`/api/tax/declarations/${id}/approve`, {});
      return res.declaration;
    },
    onSuccess: (d) => {
      toast({ title: "اعتمد ونُشر المخصص", description: `قيد #${d.entryNo} بمبلغ ${formatKWD(d.amount)}` });
      qc.invalidateQueries({ queryKey: ["tax-declarations"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر الاعتماد", description: errMessage(e) });
    },
  });

  const [cancelTarget, setCancelTarget] = React.useState<TaxDeclarationDTO | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");

  const cancelQ = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiPost<{ declaration: TaxDeclarationDTO }>(`/api/tax/declarations/${id}/cancel`, { reason: cancelReason });
      return res.declaration;
    },
    onSuccess: () => {
      toast({ title: "أُلغي الإقرار", description: "نُشر قيد عكسي موثق وبقي السجل للأثر" });
      setCancelTarget(null);
      setCancelReason("");
      qc.invalidateQueries({ queryKey: ["tax-declarations"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر الإلغاء", description: errMessage(e) });
    },
  });

  const deleteQ = useMutation({
    mutationFn: async (id: number) => apiDelete(`/api/tax/declarations/${id}`),
    onSuccess: () => {
      toast({ title: "حُذفت المسودة" });
      qc.invalidateQueries({ queryKey: ["tax-declarations"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر الحذف", description: errMessage(e) });
    },
  });

  const flagQ = useMutation({
    mutationFn: async (foreignOwned: boolean) => apiPost<{ foreignOwned: boolean }>("/api/tax/company-flag", { foreignOwned }),
    onSuccess: (r) => {
      toast({ title: r.foreignOwned ? "فُعّلت وحدة ضريبة الأجانب" : "عُطّلت وحدة ضريبة الأجانب" });
      qc.invalidateQueries({ queryKey: ["tax-declarations"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر تغيير العلم", description: errMessage(e) });
    },
  });

  // ==================== XBRL ====================
  const covQ = useQuery({
    queryKey: ["xbrl-coverage", asOf],
    queryFn: async () => apiGet<CoverageResponse>(`/api/xbrl/completeness?asOf=${asOf}`),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(asOf) && tab === "xbrl",
  });

  React.useEffect(() => {
    if (covQ.error instanceof ApiError && covQ.error.status === 401) onAuthError();
  }, [covQ.error, onAuthError]);

  const onXbrl = async (kind: "preview" | "download", force: boolean) => {
    try {
      setExporting(kind);
      if (kind === "preview") {
        // المعاينة داخلية — تُفتح بمتتبع مصادق (توكن في العنوان غير آمن؛ نستخدم blob مع التوكن)
        const token = getStoredToken();
        const res = await fetch(`/api/xbrl/preview?asOf=${asOf}${force ? "&force=1" : ""}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        const html = await res.text();
        const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
        window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      } else {
        await fetchBlobDownload({
          url: `/api/xbrl/preview?asOf=${asOf}&download=1${force ? "&force=1" : ""}`,
          token: getStoredToken(),
          filename: `التقديم-iXBRL-${taxYear}.html`,
        });
      }
      toast({ title: kind === "preview" ? "فُتحت المعاينة" : "نُزّل ملف التقديم iXBRL" });
    } catch (e) {
      if ((e as { status?: number }).status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر التوليد", description: errMessage(e) });
    } finally {
      setExporting(null);
    }
  };

  const data = decQ.data;

  return (
    <main className="space-y-6">
      {/* ==================== الترويسة ==================== */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <FileBadge className="h-6 w-6 text-primary" aria-hidden="true" />
            الزكاة والتقديم الإلكتروني
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            الزكاة 1% (قانون 8/2019 لصندوق الكويت الوطني) وضريبة دخل الأجانب 15% — من الأستاذ حصرًا، وتقديم iXBRL للقرار الوزاري 44/2016.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { decQ.refetch(); covQ.refetch(); }} disabled={decQ.isFetching || covQ.isFetching}>
          <RefreshCw className={`h-4 w-4 ${decQ.isFetching || covQ.isFetching ? "animate-spin" : ""}`} />
          تحديث
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-2 sm:w-auto">
          <TabsTrigger value="zakat">الزكاة والضريبة</TabsTrigger>
          <TabsTrigger value="xbrl">تقديم XBRL</TabsTrigger>
        </TabsList>

        {/* ==================== تبويب الزكاة والضريبة ==================== */}
        <TabsContent value="zakat" className="space-y-4">
          {/* جاهزية السنة */}
          {data && (
            <Card>
              <CardContent className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-4 sm:items-center">
                <div>
                  <div className="text-xs text-muted-foreground">سنة الإقرار</div>
                  <div className="mt-1 flex items-center gap-2">
                    <Input
                      id="tax-year"
                      className="h-9 w-24"
                      type="number"
                      value={taxYear}
                      min={2000}
                      max={2100}
                      onChange={(e) => setTaxYear(Number(e.target.value) || yearStr())}
                    />
                    <Button size="sm" onClick={openDraft} disabled={!manager}>
                      <Plus className="h-4 w-4" /> مسودة إقرار
                    </Button>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">إيراد السنة (الأستاذ)</div>
                  <div className="mt-1 font-bold text-status-done">{formatKWD(data.currentRevenue)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">مصروف السنة (الأستاذ)</div>
                  <div className="mt-1 font-bold text-status-danger">{formatKWD(data.currentExpense)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">صافي ربح السنة</div>
                  <div className={`mt-1 font-bold ${data.currentNetProfit >= 0 ? "text-status-done" : "text-status-danger"}`}>
                    {formatKWD(data.currentNetProfit)}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* علم الشركة الأجنبية */}
          {data && manager && (
            <Card>
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="flex items-center gap-2">
                  <Globe2 className="h-5 w-5 text-primary" aria-hidden="true" />
                  <div>
                    <div className="text-sm font-semibold">شركة أجنبية الملكية</div>
                    <p className="text-xs text-muted-foreground">يفعّل وحدة ضريبة دخل الأجانب 15% لهذه الشركة (الإقرار نفسه من الأستاذ).</p>
                  </div>
                </div>
                <Switch checked={data.foreignOwned} onCheckedChange={(v) => flagQ.mutate(v)} disabled={flagQ.isPending} />
              </CardContent>
            </Card>
          )}

          {/* جدول الإقرارات */}
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[10%]">السنة</TableHead>
                  <TableHead className="w-[28%]">النوع</TableHead>
                  <TableHead className="w-[12%]">صافي الربح</TableHead>
                  <TableHead className="w-[12%]">الوعاء</TableHead>
                  <TableHead className="w-[12%]">المخصص</TableHead>
                  <TableHead className="w-[10%]">الحالة</TableHead>
                  <TableHead className="w-[16%]">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {decQ.isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      <Loader2 className="ml-2 inline h-4 w-4 animate-spin" /> جارٍ التحميل…
                    </TableCell>
                  </TableRow>
                )}
                {data && data.declarations.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      لا إقرارات لهذه السنة — أنشئ مسودة لبدء الاحتساب.
                    </TableCell>
                  </TableRow>
                )}
                {data?.declarations.map((d) => (
                  <TableRow key={d.id} className="hover:bg-muted/40">
                    <TableCell className="font-bold">{d.year}</TableCell>
                    <TableCell className="text-right text-xs">{TAX_KIND_LABEL[d.kind]}</TableCell>
                    <TableCell className="text-center">{formatKWD(d.netProfit)}</TableCell>
                    <TableCell className="text-center">{formatKWD(d.base)}</TableCell>
                    <TableCell className="text-center font-bold">{formatKWD(d.amount)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[d.status] || "bg-muted"}`}>
                        {d.status === "draft" ? "مسودة" : d.status === "approved" ? "معتمد" : "ملغى"}
                      </span>
                      {d.entryNo != null && <Badge variant="outline" className="mr-1 font-mono text-[11px]">قيد #{d.entryNo}</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        {d.status === "draft" && (
                          <>
                            <Button size="sm" variant="outline" className="h-8" disabled={!manager || approveQ.isPending} onClick={() => approveQ.mutate(d.id)}>
                              <BadgeCheck className="h-4 w-4" /> اعتماد ونشر
                            </Button>
                            <Button size="sm" variant="ghost" className="h-8 text-status-danger" disabled={deleteQ.isPending} onClick={() => deleteQ.mutate(d.id)}>
                              <Trash2 className="h-4 w-4" /> حذف
                            </Button>
                          </>
                        )}
                        {d.status === "approved" && (
                          <Button size="sm" variant="outline" className="h-8 text-status-danger" disabled={!manager || cancelQ.isPending} onClick={() => { setCancelTarget(d); setCancelReason(""); }}>
                            <Ban className="h-4 w-4" /> إلغاء (عكسي)
                          </Button>
                        )}
                        {d.status === "cancelled" && <span className="text-xs text-muted-foreground" title={d.cancelReason}>ملغى موثقًا</span>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {data && !data.foreignOwned && (
            <p className="text-xs text-muted-foreground">
              وحدة ضريبة دخل الأجانب معطلة لهذه الشركة — يظهر خيارها في المسودات بعد تفعيل العلم أعلاه (للمدير).
            </p>
          )}
        </TabsContent>

        {/* ==================== تبويب تقديم XBRL ==================== */}
        <TabsContent value="xbrl" className="space-y-4">
          <Card>
            <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3 sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="xbrl-asof">حتى تاريخ (لحظة المركز المالي)</Label>
                <Input id="xbrl-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
              </div>
              <div className="flex items-center gap-2 sm:col-span-2 sm:justify-end">
                <Button size="sm" variant="outline" onClick={() => onXbrl("preview", false)} disabled={exporting !== null}>
                  {exporting === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  معاينة iXBRL
                </Button>
                <Button size="sm" variant="outline" onClick={() => onXbrl("download", false)} disabled={exporting !== null}>
                  {exporting === "download" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileBadge className="h-4 w-4" />}
                  تنزيل ملف التقديم
                </Button>
              </div>
            </CardContent>
          </Card>

          {covQ.data && (
            <>
              <Card className={covQ.data.complete ? "border-status-done/40" : "border-status-warn/50"}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-2">
                    {covQ.data.complete ? (
                      <ShieldCheck className="h-8 w-8 text-status-done" aria-hidden="true" />
                    ) : (
                      <span className="text-status-warn text-2xl">⚠</span>
                    )}
                    <div>
                      <div className="text-sm font-bold">
                        {covQ.data.complete ? "الخريطة كاملة — جاهز للتقديم النهائي ✓" : `الخريطة ناقصة — ${covQ.data.uncovered.length} بندًا بلا عنصر`}
                      </div>
                      <div className="text-xs text-muted-foreground">{covQ.data.tagged} بندًا موسومًا حتى {covQ.data.asOf} — التنزيل النهائي محجوب حتى الاكتمال (المعاينة والتنزيل كمسودة بـ force متاحان).</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {covQ.data.uncovered.length > 0 && (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>القائمة</TableHead>
                        <TableHead>الحساب</TableHead>
                        <TableHead className="text-center">القيمة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {covQ.data.uncovered.map((u, i) => (
                        <TableRow key={i} className="hover:bg-muted/40">
                          <TableCell className="text-xs">{u.statement}</TableCell>
                          <TableCell>
                            <span className="font-mono text-xs text-muted-foreground">{u.code}</span> {u.name}
                          </TableCell>
                          <TableCell className="text-center">{formatKWD(Math.abs(u.amount))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <p className="pb-2 text-center text-xs text-muted-foreground">
                اربط العناصر الناقصة من «دليل الحسابات ← تعديل الحساب ← خريطة XBRL» ثم أعد الفحص — القيم الموسومة تأتي من القوائم المبنية على الأستاذ بلا أي إدخال يدوي.
              </p>
            </>
          )}
          {covQ.isLoading && (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="ml-2 h-5 w-5 animate-spin" /> جارٍ فحص الاكتمال…
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ==================== حوار المسودة ==================== */}
      <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>مسودة إقرار — سنة {taxYear}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>نوع الإقرار</Label>
              <Select value={draftKind} onValueChange={(v) => setDraftKind(v as TaxKind)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="zakat">الزكاة 1% — صندوق الكويت الوطني</SelectItem>
                  <SelectItem value="foreign_tax" disabled={!data?.foreignOwned}>
                    ضريبة دخل الأجانب 15% {data && !data.foreignOwned ? "(تحتاج تفعيل علم الشركة الأجنبية)" : ""}
                  </SelectItem>
                </SelectContent>
              </Select>
              {data && (
                <p className="text-[11px] text-muted-foreground">
                  صافي ربح السنة من الأستاذ: <span className="font-bold">{formatKWD(data.currentNetProfit)}</span> — قيود الإغلاق السنوي مستثناة.
                </p>
              )}
            </div>
            <div>
              <Label className="mb-1.5 block">تعديلات النموذج المعلن (إضافة موجبة / خصم سالب)</Label>
              <div className="space-y-2">
                {draftAdjustments.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      className="h-9 flex-1"
                      value={a.label}
                      onChange={(e) => setDraftAdjustments((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                      placeholder="وصف التعديل"
                    />
                    <Input
                      className="h-9 w-32"
                      type="number"
                      step="0.001"
                      value={a.amount || ""}
                      onChange={(e) => setDraftAdjustments((prev) => prev.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) || 0 } : x)))}
                      placeholder="0.000"
                    />
                    <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => setDraftAdjustments((prev) => prev.filter((_, j) => j !== i))} aria-label="حذف التعديل">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => setDraftAdjustments((prev) => [...prev, { label: "", amount: 0 }])}>
                  <Plus className="h-4 w-4" /> إضافة تعديل
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="draft-notes">ملاحظات</Label>
              <Input id="draft-notes" className="h-9" value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDraftOpen(false)} disabled={createDraftQ.isPending}>إلغاء</Button>
            <Button onClick={() => createDraftQ.mutate()} disabled={createDraftQ.isPending || draftAdjustments.some((a) => !a.label.trim() && a.amount !== 0)}>
              {createDraftQ.isPending ? "جارٍ الإنشاء…" : "إنشاء المسودة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== حوار الإلغاء ==================== */}
      <Dialog open={cancelTarget !== null} onOpenChange={(v) => !v && setCancelTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>إلغاء إقرار معتمد — {cancelTarget?.year}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            الإلغاء ينشر قيدًا عكسيًا موثقًا عبر المحرك ويعلم الإقرار ملغى — لا حذف فيزيائي. السبب إلزامي.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">سبب الإلغاء</Label>
            <Input id="cancel-reason" className="h-9" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={cancelQ.isPending}>رجوع</Button>
            <Button variant="destructive" onClick={() => cancelTarget && cancelQ.mutate(cancelTarget.id)} disabled={cancelQ.isPending || !cancelReason.trim()}>
              {cancelQ.isPending ? "جارٍ الإلغاء…" : "إلغاء بقيد عكسي"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
