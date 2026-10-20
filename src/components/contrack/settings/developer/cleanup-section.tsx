"use client";

/**
 * تاب أدوات المطور «✱ تنظيف البيانات» — مرآة _purge_card المكتبية
 * (settings.py:1244-1325) مربوطة بمسارات الويب الحية:
 *   POST /api/data-mgmt/purge     {action:'preview'|'execute', kind, id, reason}
 *   POST /api/data-mgmt/full-reset {confirm, reason}
 *   GET  /api/data-mgmt/purge      سجل المحو (PurgeAudit)
 * بنمط المكتبي مع تأكيدات مزدوجة: (1) معاينة شجرة التبعيات بلا حذف،
 * (2) سبب إلزامي + كتابة كلمة التأكيد، (3) نافذة تأكيد أخيرة.
 * الأنواع التي لا يغطيها مسار الويب (سندات/مقاول باطن) تُعرض بنصوصها
 * الحرفية مع مؤشر «غير متاح» وتوجيه لـ«إلغاء السند» — لا تبويب يُحذف.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Eye, Loader2, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPost } from "../../api";
import {
  PURGE_KIND_LABEL,
  errMessage,
  type FullResetResponse,
  type PurgeAuditResponse,
  type PurgeExecuteResponse,
  type PurgePreviewResponse,
} from "../../contrack-types";

/** النص التحذيري الحرفي من settings.py:1251-1259 */
const PURGE_WARN_LINES = [
  "⚠ هذه الأداة تحذف البيانات نهائيًا — خُصِّصت للبيانات التجريبية أو الخاطئة من الاستيراد وتنظيف النظام قبل التسليم.",
  "• تُحفظ لقطة كاملة لكل ما يُحذف في سجل التدقيق (من · متى · لماذا · البيانات كاملة).",
  "• خذ نسخة احتياطية قبل الاستخدام — الحذف لا يُستعاد تلقائيًا من داخل البرنامج.",
  "• لا تستخدمها لإخفاء حركة مالية حقيقية؛ للسند الخاطئ استخدم «إلغاء السند» فيبقى الأثر سليمًا.",
];

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ar-KW", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function CleanupSection({ onAuthError }: { onAuthError: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const fail = React.useCallback(
    (e: unknown, title: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title, description: errMessage(e) });
    },
    [onAuthError, toast]
  );

  // ===== نافذة محو كيان (عميل/عقد) =====
  const [purgeOpen, setPurgeOpen] = React.useState(false);
  const [purgeKind, setPurgeKind] = React.useState<"customer" | "contract">("customer");
  const [purgeId, setPurgeId] = React.useState("");
  const [preview, setPreview] = React.useState<PurgePreviewResponse | null>(null);
  const [purgeReason, setPurgeReason] = React.useState("");
  const [purgeConfirm, setPurgeConfirm] = React.useState("");
  const [finalConfirm, setFinalConfirm] = React.useState(false);
  const [lastPurge, setLastPurge] = React.useState<PurgeExecuteResponse | null>(null);

  const previewMutation = useMutation<PurgePreviewResponse, unknown, { kind: string; id: number }>({
    mutationFn: (body) => apiPost<PurgePreviewResponse>("/api/data-mgmt/purge", { action: "preview", ...body }),
    onSuccess: (res) => {
      setPreview(res);
      toast({ title: "المعاينة جاهزة", description: `${res.label} — إجمالي التبعيات المباشرة: ${res.total}` });
    },
    onError: (e) => {
      setPreview(null);
      fail(e, "تعذرت المعاينة");
    },
  });

  const executeMutation = useMutation<PurgeExecuteResponse, unknown, { kind: string; id: number; reason: string }>({
    mutationFn: (body) => apiPost<PurgeExecuteResponse>("/api/data-mgmt/purge", { action: "execute", ...body }),
    onSuccess: (res) => {
      setLastPurge(res);
      setPreview(null);
      setPurgeReason("");
      setPurgeConfirm("");
      setPurgeId("");
      setFinalConfirm(false);
      qc.invalidateQueries({ queryKey: ["purge-audit"] });
      qc.invalidateQueries({ queryKey: ["audit"] });
      toast({ title: "تم المحو", description: res.message });
    },
    onError: (e) => {
      setFinalConfirm(false);
      fail(e, "تعذر تنفيذ المحو");
    },
  });

  const openPurge = (kind: "customer" | "contract") => {
    setPurgeKind(kind);
    setPurgeId("");
    setPreview(null);
    setPurgeReason("");
    setPurgeConfirm("");
    setLastPurge(null);
    setPurgeOpen(true);
  };

  const idNum = Number(purgeId) || 0;
  const canExecute = !!preview && purgeReason.trim().length > 0 && purgeConfirm === "محو";

  // ===== إعادة الضبط الكاملة =====
  const [resetConfirm, setResetConfirm] = React.useState("");
  const [resetReason, setResetReason] = React.useState("");
  const [resetFinalConfirm, setResetFinalConfirm] = React.useState(false);
  const canReset = resetConfirm === "إعادة الضبط الكاملة" && resetReason.trim().length > 0;

  const resetMutation = useMutation<FullResetResponse, unknown, { confirm: string; reason: string }>({
    mutationFn: (body) => apiPost<FullResetResponse>("/api/data-mgmt/full-reset", body),
    onSuccess: (res) => {
      setResetConfirm("");
      setResetReason("");
      setResetFinalConfirm(false);
      qc.invalidateQueries({ queryKey: ["purge-audit"] });
      qc.invalidateQueries({ queryKey: ["audit"] });
      toast({ title: "تمت إعادة الضبط", description: res.message });
    },
    onError: (e) => {
      setResetFinalConfirm(false);
      fail(e, "تعذرت إعادة الضبط");
    },
  });

  // ===== سجل الحذف (PurgeAudit) =====
  const [logOpen, setLogOpen] = React.useState(false);
  const [logKind, setLogKind] = React.useState("all");
  const logQuery = useQuery<PurgeAuditResponse>({
    queryKey: ["purge-audit", "cleanup-section", logKind],
    queryFn: () => {
      const p = new URLSearchParams();
      if (logKind !== "all") p.set("kind", logKind);
      p.set("limit", "50");
      return apiGet<PurgeAuditResponse>(`/api/data-mgmt/purge?${p.toString()}`);
    },
    enabled: logOpen,
    placeholderData: (prev) => prev,
  });
  React.useEffect(() => {
    if (logOpen && logQuery.isError) fail(logQuery.error, "تعذر تحميل سجل الحذف");
  }, [logOpen, logQuery.isError, logQuery.error, fail]);
  const logItems = logQuery.data?.items ?? [];

  return (
    <div className="space-y-4">
      {/* كارت التنظيف — نصوص المكتبي الحرفية */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">🧹 تنظيف البيانات (حذف نهائي)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs leading-6 text-destructive">
            {PURGE_WARN_LINES.map((line, i) => (
              <p key={i} className={i === 0 ? "font-bold" : ""}>
                {line}
              </p>
            ))}
          </div>

          {/* أزرار المحو — الأنواع المدعومة في مسار الويب حية والباقي معروض كالمكتبي */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="destructive" className="h-9 gap-1.5" onClick={() => openPurge("customer")}>
              <Trash2 className="size-4" />
              حذف عميل بالكامل…
            </Button>
            <Button variant="destructive" className="h-9 gap-1.5" onClick={() => openPurge("contract")}>
              <Trash2 className="size-4" />
              حذف عقد…
            </Button>
            <div className="flex items-start gap-2 rounded-lg border border-dashed p-2 opacity-60">
              <span className="px-1 py-1 text-sm font-medium">🗑 حذف سندات…</span>
              <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">غير متاح في نسخة الويب الحالية</span>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-dashed p-2 opacity-60">
              <span className="px-1 py-1 text-sm font-medium">🗑 حذف مقاول باطن… (مع عقوده وسنداته)</span>
              <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">غير متاح في نسخة الويب الحالية</span>
            </div>
            <Button variant="outline" className="h-9 gap-1.5" onClick={() => setLogOpen(true)}>
              <Trash2 className="size-4" />
              سجل الحذف
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
            <span className="font-medium">🧹 إدارة البيانات (بحث + تقرير + حذف + موظفين)</span>
            <span className="text-xs text-muted-foreground">
              الأداة الموحدة في شاشة «إدارة البيانات» — افتحها من بند «أدوات المطور» في القائمة الجانبية.
            </span>
          </div>

          {lastPurge && (
            <div className="rounded-lg border border-status-done/40 bg-status-done-bg p-3 text-sm">
              <p className="font-semibold">تم محو: {lastPurge.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                لقطة كاملة محفوظة في سجل المحو — <strong>معرف السجل: #{lastPurge.auditId}</strong>
                {lastPurge.filesRemoved ? ` — أزيلت ${lastPurge.filesRemoved} ملف مرفقات من القرص` : ""}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* إعادة الضبط الكاملة — نفس مسار /api/data-mgmt/full-reset بتأكيد مزدوج */}
      <Card className="border-red-300">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-status-danger">
            <AlertTriangle className="size-4" />
            إعادة الضبط الكاملة — خطير
          </CardTitle>
          <p className="text-xs text-status-danger/80">
            حذف <strong>كل بيانات الأعمال</strong> بمعاملة واحدة: العملاء والعقود والسندات والدفعات والمراحل والملاحق
            والمطالبات والفواتير والباطن والعُهد والبوابة والشركة الأخرى والقيود والمهام والزيارات والتعليقات والمرفقات
            والموظفون وأنواع العقود والمراحل المرجعية والقوالب.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
            <p className="rounded-md bg-red-500/10 p-2 text-status-danger">
              <strong>يُحذف:</strong> كل جداول بيانات الأعمال والمحتوى المرتبط بها.
            </p>
            <p className="rounded-md bg-status-done-bg p-2 text-status-done">
              <strong>يبقى:</strong> المستخدمون والصلاحيات، الإعدادات، مزايا النظام، أرقام التسلسل، سجل التدقيق، سجل المحو.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cs-fr-confirm" className="text-xs">
                تأكيد — اكتب «إعادة الضبط الكاملة» حرفيًا
              </Label>
              <Input
                id="cs-fr-confirm"
                className="h-9"
                placeholder="إعادة الضبط الكاملة"
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cs-fr-reason" className="text-xs">السبب (إلزامي)</Label>
              <Input
                id="cs-fr-reason"
                className="h-9"
                placeholder="اذكر سبب إعادة الضبط…"
                value={resetReason}
                onChange={(e) => setResetReason(e.target.value)}
              />
            </div>
          </div>
          <Button
            variant="destructive"
            className="h-10 gap-1.5"
            onClick={() => setResetFinalConfirm(true)}
            disabled={!canReset || resetMutation.isPending}
          >
            {resetMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />}
            تنفيذ إعادة الضبط الكاملة
          </Button>
        </CardContent>
      </Card>

      {/* نافذة محو كيان — المرحلة الأولى (معاينة) والثانية (سبب + كلمة التأكيد) */}
      <Dialog open={purgeOpen} onOpenChange={(v) => !v && setPurgeOpen(false)}>
        <DialogContent className="sm:max-w-xl" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Trash2 className="size-4 text-destructive" />
              {purgeKind === "customer" ? "حذف عميل بالكامل…" : "حذف عقد…"}
            </DialogTitle>
            <DialogDescription>
              معاينة شجرة التبعيات أولًا بلا أي حذف، ثم السبب وكلمة التأكيد ونافذة تأكيد أخيرة — تُحفظ لقطة JSON كاملة في سجل المحو قبل الحذف.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="cs-p-id" className="text-xs">المعرف الرقمي ({PURGE_KIND_LABEL[purgeKind]})</Label>
                <Input
                  id="cs-p-id"
                  type="number"
                  min={1}
                  className="h-9"
                  placeholder="مثال: 12"
                  value={purgeId}
                  onChange={(e) => {
                    setPurgeId(e.target.value);
                    setPreview(null);
                  }}
                />
              </div>
              <Button
                variant="outline"
                className="h-9 gap-1.5"
                onClick={() => previewMutation.mutate({ kind: purgeKind, id: idNum })}
                disabled={idNum <= 0 || previewMutation.isPending}
              >
                {previewMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
                معاينة
              </Button>
            </div>

            {/* التأكيد الثاني: شجرة التبعيات + السبب + كلمة التأكيد */}
            {preview && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="destructive" className="text-[10px]">للمحو</Badge>
                  <span className="text-sm font-semibold">{preview.label}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {PURGE_KIND_LABEL[preview.kind]} #{preview.id}
                  </Badge>
                </div>
                {preview.tree.filter((t) => t.count > 0).length === 0 ? (
                  <p className="text-xs text-muted-foreground">لا توجد تبعيات مسجلة لهذا الكيان</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {preview.tree.filter((t) => t.count > 0).map((t) => (
                      <Badge key={t.key} variant="outline" className="text-xs">
                        {t.label}: <span className="font-bold">{t.count.toLocaleString("en-US")}</span>
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cs-p-reason" className="text-xs">سبب المحو (إلزامي)</Label>
                    <Input
                      id="cs-p-reason"
                      className="h-9"
                      placeholder="اذكر سبب المحو…"
                      value={purgeReason}
                      onChange={(e) => setPurgeReason(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cs-p-confirm" className="text-xs">تأكيد — اكتب «محو»</Label>
                    <Input
                      id="cs-p-confirm"
                      className="h-9"
                      placeholder="محو"
                      value={purgeConfirm}
                      onChange={(e) => setPurgeConfirm(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setPurgeOpen(false)}>إلغاء</Button>
            <Button
              variant="destructive"
              className="h-9 gap-1.5"
              disabled={!canExecute || executeMutation.isPending}
              onClick={() => setFinalConfirm(true)}
            >
              {executeMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              تنفيذ المحو
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* التأكيد الأخير للمحو — البوابة الثالثة قبل أي كتابة */}
      <AlertDialog open={finalConfirm} onOpenChange={setFinalConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد أخير — حذف نهائي</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm leading-6">
                <p>
                  سيُمحى {preview ? `${PURGE_KIND_LABEL[preview.kind]} «${preview.label}» (#${preview.id})` : ""} نهائيًا
                  مع كل تبعياته المعروضة أعلاه، وتُحفظ لقطة كاملة في سجل المحو بسبب: «{purgeReason.trim()}».
                </p>
                <p className="rounded-md bg-red-500/10 p-2 text-xs text-status-danger">
                  الحذف لا يُستعاد تلقائيًا من داخل البرنامج — تأكد أنك أخذت نسخة احتياطية.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>رجوع</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={executeMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (preview) executeMutation.mutate({ kind: preview.kind, id: preview.id, reason: purgeReason.trim() });
              }}
            >
              {executeMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              تأكيد المحو نهائيًا
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* التأكيد الأخير لإعادة الضبط الكاملة */}
      <AlertDialog open={resetFinalConfirm} onOpenChange={setResetFinalConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-status-danger" />
              تأكيد أخير — إعادة الضبط الكاملة
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm leading-6">
                <p>
                  سيُحذف كل بيانات الأعمال بمعاملة واحدة بسبب: «{resetReason.trim()}» — والمستخدمون والإعدادات
                  ومزايا النظام وأرقام التسلسل وسجلا التدقيق والمحو تبقى كما هي.
                </p>
                <p className="rounded-md bg-red-500/10 p-2 text-xs text-status-danger">
                  لا تراجع بعد التنفيذ — تأكد أنك أخذت نسخة احتياطية.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>رجوع</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={resetMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                resetMutation.mutate({ confirm: resetConfirm, reason: resetReason.trim() });
              }}
            >
              {resetMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />}
              تأكيد إعادة الضبط
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* نافذة سجل الحذف */}
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="sm:max-w-3xl" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-base">🗑 سجل الحذف (PurgeAudit)</DialogTitle>
            <DialogDescription>
              كل عملية محو مع لقطة كاملة محفوظة (من · متى · لماذا) — أحدث 50 سجلًا.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Select value={logKind} onValueChange={setLogKind}>
              <SelectTrigger className="h-9 w-40" aria-label="فلتر نوع سجل الحذف">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="contract">عقد</SelectItem>
                <SelectItem value="customer">عميل</SelectItem>
                <SelectItem value="full_reset">إعادة ضبط</SelectItem>
              </SelectContent>
            </Select>
            {logQuery.data && <Badge variant="secondary" className="text-[10px]">{logQuery.data.total} سجلًا</Badge>}
          </div>
          <div className="max-h-96 overflow-y-auto rounded-md border">
            {logQuery.isLoading ? (
              <p className="p-6 text-center text-sm text-muted-foreground">جارٍ التحميل…</p>
            ) : logItems.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">لا توجد عمليات محو مسجلة</p>
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead className="text-start">التاريخ</TableHead>
                    <TableHead className="text-start">المستخدم</TableHead>
                    <TableHead className="text-start">الكيان</TableHead>
                    <TableHead className="text-start">الاسم</TableHead>
                    <TableHead className="text-start">السبب</TableHead>
                    <TableHead className="text-start">اللقطة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logItems.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtTs(r.purgedAt)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs font-medium">{r.purgedBy || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={r.entity === "full_reset" ? "destructive" : "secondary"} className="text-[10px]">
                          {PURGE_KIND_LABEL[r.entity] || r.entity}
                          {r.entityId ? ` #${r.entityId}` : ""}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-56">
                        <span className="line-clamp-1 text-xs" title={r.label}>{r.label || "—"}</span>
                      </TableCell>
                      <TableCell className="max-w-52">
                        <span className="line-clamp-1 text-xs text-muted-foreground" title={r.reason}>{r.reason || "—"}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {(r.snapshotSize / 1024).toFixed(1)} KB
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
