"use client";

/**
 * معالج استيراد البيانات القديمة من Excel — مرآة import_wizard.py (3 خطوات واضحة):
 *  1) تنزيل القالب وإعطاؤه للعميل («⬇ تنزيل القالب» الكامل + «⬇ قالب» لكل ورقة من الثماني)
 *  2) اختيار الملف المعبأ ← فحص تلقائي يعرض الأخطاء بوضوح (معاينة أول صفوف + جدول أخطاء برقم الصف)
 *  3) تنفيذ الاستيراد بعد خلو الملف من الأخطاء (بتأكيد المكتبي الحرفي وتقرير النتيجة)
 * والخطوة صفر المكتبية (تأسيس الأنواع والمراحل والدفعات) وأداة «إصلاح عقود غير محدد»
 * تُعرض كمؤشرات سطح مكتب — خدمة types_setup_service خارج نطاق بند 8.
 */

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, FileSpreadsheet, FileUp, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { getStoredToken } from "../../api";
import { fetchBlobDownload } from "@/lib/download-blob";
import { IMPORT_SHEETS } from "@/lib/import/sheets";

// ===== أنواع استجابات الـAPI =====

interface ImportIssueDTO {
  sheet: string;
  line: number;
  text: string;
  message: string;
}

interface ImportCounts {
  customers: number;
  contracts: number;
  subs: number;
  payments: number;
  sup_contracts: number;
  sub_contracts: number;
  expenses: number;
}

interface ParseResponse {
  counts: ImportCounts;
  sheetsPresent: string[];
  errors: ImportIssueDTO[];
  warnings: ImportIssueDTO[];
  preview: Record<string, { line: number; cells: Record<string, string> }[]>;
}

interface RunStats extends ImportCounts {
  skipped_customers: number;
  skipped_contracts: number;
  skipped_subs: number;
  skipped_payments: number;
  skipped_expenses: number;
  overpaid: string[];
}

interface RunResponse {
  stats: RunStats;
}

function errText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "حدث خطأ غير متوقع";
}

async function postForm<T>(path: string, form: FormData): Promise<T> {
  const token = getStoredToken();
  const res = await fetch(path, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
    credentials: "include",
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (res.status === 401) {
    const err = new Error("انتهت الجلسة — أعد تسجيل الدخول") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    throw new Error(data?.error || `فشل الطلب (${res.status})`);
  }
  return data as T;
}

export function ImportWizard({ onAuthError }: { onAuthError: () => void }) {
  const { toast } = useToast();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [parsed, setParsed] = React.useState<ParseResponse | null>(null);
  const [report, setReport] = React.useState<{ stats: RunStats } | null>(null);
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const fail = React.useCallback(
    (e: unknown, title: string) => {
      const status = (e as { status?: number })?.status;
      if (status === 401) {
        onAuthError();
        return;
      }
      toast({ variant: "destructive", title, description: errText(e) });
    },
    [onAuthError, toast]
  );

  // ===== الخطوة ١: القوالب =====
  const downloadTemplate = React.useCallback(
    async (sheet?: string) => {
      try {
        const qs = sheet ? `?sheet=${encodeURIComponent(sheet)}` : "";
        await fetchBlobDownload({
          url: `/api/import/template${qs}`,
          token: getStoredToken(),
          filename: sheet ? `قالب_${sheet}.xlsx` : "قالب_البيانات_القديمة.xlsx",
        });
        toast({ title: "تم إنشاء القالب", description: sheet ? `قالب ورقة «${sheet}»` : "قالب البيانات القديمة الكامل" });
      } catch (e) {
        fail(e, "تعذر إنشاء القالب.");
      }
    },
    [fail, toast]
  );

  // ===== الخطوة ٢: الفحص =====
  const parseMutation = useMutation<ParseResponse, unknown, File>({
    mutationFn: (f) => {
      const form = new FormData();
      form.append("file", f);
      return postForm<ParseResponse>("/api/import/parse", form);
    },
    onSuccess: (res) => {
      setParsed(res);
      setReport(null);
      const sel: Record<string, boolean> = {};
      for (const s of res.sheetsPresent) sel[s] = true;
      setSelected(sel);
      toast({
        title: "اكتمل الفحص",
        description: `أخطاء: ${res.errors.length}  |  تنبيهات: ${res.warnings.length}`,
      });
    },
    onError: (e) => fail(e, "تعذر قراءة الملف، تأكد أنه بنفس بنية القالب."),
  });

  // ===== الخطوة ٣: التنفيذ =====
  const runMutation = useMutation<RunResponse, unknown, File>({
    mutationFn: (f) => {
      const form = new FormData();
      form.append("file", f);
      const sheets = Object.entries(selected)
        .filter(([, v]) => v)
        .map(([k]) => k);
      form.append("sheets", JSON.stringify(sheets));
      return postForm<RunResponse>("/api/import/run", form);
    },
    onSuccess: (res) => {
      setReport(res);
      setConfirmOpen(false);
      toast({ title: "اكتمل الاستيراد", description: "تم الاستيراد بنجاح! 🎉" });
    },
    onError: (e) => {
      setConfirmOpen(false);
      fail(e, "توقف الاستيراد");
    },
  });

  const onPickFile = (f: File | null) => {
    setFile(f);
    setParsed(null);
    setReport(null);
    setSelected({});
    if (f) parseMutation.mutate(f);
  };

  // ===== ملخص الفحص الحرفي (import_wizard.py:413-425) =====
  const summary = React.useMemo(() => {
    if (!parsed) return "لم يُفحص أي ملف بعد.";
    const c = parsed.counts;
    return (
      `نتيجة الفحص:  👥 ${c.customers} عميل  |  📑 ${c.contracts} عقد  |  ` +
      (c.sup_contracts ? `🏗 ${c.sup_contracts} عقد إشراف  |  ` : "") +
      `👷 ${c.subs} مقاول  |  ` +
      (c.sub_contracts ? `🔗 ${c.sub_contracts} عقد باطن  |  ` : "") +
      `📥 ${c.payments} دفعة  ` +
      (c.expenses ? `|  📤 ${c.expenses} سند صرف  ` : "") +
      `—  أخطاء: ${parsed.errors.length}  |  تنبيهات: ${parsed.warnings.length}`
    );
  }, [parsed]);

  const selectedSheets = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
  const selectedErrors = parsed ? parsed.errors.filter((e) => selected[e.sheet]) : [];
  const selectedCounts: ImportCounts | null = React.useMemo(() => {
    if (!parsed) return null;
    const has = (s: string) => selected[s];
    const c = parsed.counts;
    const payIn = parsed.sheetsPresent.includes("سندات القبض") && has("سندات القبض");
    const oldPayIn = parsed.sheetsPresent.includes("الدفعات") && has("الدفعات");
    // دفعات الورقتين تُجمع معًا (البيانات لا تحمل ورقتها في العدّاد)
    return {
      customers: has("العملاء") ? c.customers : 0,
      contracts: has("العقود") ? c.contracts : 0,
      sup_contracts: has("عقود الإشراف") ? c.sup_contracts : 0,
      subs: has("مقاولو الباطن") ? c.subs : 0,
      sub_contracts: has("عقود الباطن") ? c.sub_contracts : 0,
      expenses: has("سندات الصرف") ? c.expenses : 0,
      payments: (payIn || oldPayIn ? c.payments : 0) as number,
    };
  }, [parsed, selected]);

  const confirmText = React.useMemo(() => {
    if (!selectedCounts) return "";
    return (
      "سيتم الآن إدخال:\n" +
      `• ${selectedCounts.customers} عميل\n` +
      `• ${selectedCounts.contracts} عقد\n` +
      (selectedCounts.sup_contracts ? `• ${selectedCounts.sup_contracts} عقد إشراف هندسي\n` : "") +
      `• ${selectedCounts.subs} مقاول باطن\n` +
      (selectedCounts.sub_contracts ? `• ${selectedCounts.sub_contracts} عقد باطن\n` : "") +
      `• ${selectedCounts.payments} سند قبض / دفعة\n` +
      (selectedCounts.expenses ? `• ${selectedCounts.expenses} سند صرف (دفعات مقاولين ومصروفات)\n` : "") +
      "\nيُنصح بأخذ نسخة احتياطية قبل المتابعة.\nهل أنت متأكد؟"
    );
  }, [selectedCounts]);

  const busy = parseMutation.isPending || runMutation.isPending;

  return (
    <div className="space-y-4" data-testid="import-wizard">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        aria-label="اختيار ملف البيانات المعبأ"
        onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
      />

      {/* الخطوة ١ — القالب (نص المكتبي الحرفي) */}
      <div className="rounded-lg border p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-xl text-sm leading-6">
            <b>الخطوة ١:</b> نزّل القالب وسلّمه للعميل ليملأه ببياناته (عملاء، عقود، مقاولون، دفعات)
          </p>
          <div className="flex flex-wrap gap-2">
            <Button className="h-9 gap-1.5" onClick={() => downloadTemplate()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
              ⬇ تنزيل القالب
            </Button>
          </div>
        </div>
        <div className="mt-3 border-t pt-3">
          <p className="mb-2 text-xs text-muted-foreground">قالب ورقة واحدة (رؤوس عربية جاهزة):</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {IMPORT_SHEETS.map((s) => (
              <Button
                key={s.name}
                variant="outline"
                size="sm"
                className="h-8 justify-start gap-1.5 text-xs"
                onClick={() => downloadTemplate(s.name)}
                disabled={busy}
              >
                <FileSpreadsheet className="size-3.5" />
                ⬇ قالب: {s.name}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* الخطوة ٢ — الفحص */}
      <div className="rounded-lg border p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-sm leading-6">
            <b>الخطوة ٢:</b> اختر الملف المعبأ · سيُفحص بالكامل وتُعرض أي أخطاء قبل إدخال أي شيء
          </p>
          <Button
            className="h-9 gap-1.5"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            data-testid="import-pick"
          >
            {parseMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
            اختيار الملف وفحصه
          </Button>
        </div>
        {file && (
          <p className="mt-2 text-xs text-muted-foreground">
            الملف: {file.name} · {(file.size / 1024).toFixed(0)} KB
          </p>
        )}
      </div>

      {/* نتائج الفحص */}
      <div className="space-y-2" data-testid="import-results">
        <p className="text-sm font-semibold">{summary}</p>
        {parsed && (
          <>
            {parsed.errors.length === 0 && parsed.warnings.length === 0 && (
              <p className="flex items-center gap-1.5 text-sm text-teal-700">
                <CheckCircle2 className="size-4" /> ✅ الملف سليم تمامًا · جاهز للاستيراد
              </p>
            )}

            {/* جدول الأخطاء برقم الصف */}
            {parsed.errors.length > 0 && (
              <div className="max-h-60 overflow-y-auto rounded-lg border" data-testid="import-errors">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-32">الورقة</TableHead>
                      <TableHead className="w-20">السطر</TableHead>
                      <TableHead>السبب</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.errors.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{e.sheet}</TableCell>
                        <TableCell className="text-xs">{e.line > 0 ? e.line : "—"}</TableCell>
                        <TableCell className="text-xs text-destructive">{e.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* التنبيهات */}
            {parsed.warnings.length > 0 && (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2" data-testid="import-warnings">
                {parsed.warnings.map((w, i) => (
                  <p key={i} className="text-xs leading-5 text-status-warn">⚠ {w.text}</p>
                ))}
              </div>
            )}

            {parsed.errors.length > 0 && (
              <p className="text-xs font-bold text-destructive">
                🛑 صحح الأخطاء أعلاه في ملف الإكسل ثم أعد الفحص · لن يُدخل أي شيء قبل ذلك.
              </p>
            )}

            {/* اختيار الأوراق المنفَّذة */}
            {parsed.errors.length === 0 && parsed.sheetsPresent.length > 0 && (
              <div className="rounded-lg border p-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  الأوراق المنفَّذة (ترتيب التبعية يُحترم تلقائيًا: عملاء ← عقود ← إشراف ← مقاولون ← قبض ← باطن ← صرف):
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {parsed.sheetsPresent.map((s) => (
                    <label key={s} className="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs hover:bg-muted/50">
                      <Checkbox
                        checked={Boolean(selected[s])}
                        onCheckedChange={(v) => setSelected((prev) => ({ ...prev, [s]: Boolean(v) }))}
                        disabled={busy}
                      />
                      {s}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* معاينة أول صفوف كل ورقة */}
            {Object.keys(parsed.preview).length > 0 && (
              <div className="space-y-3 rounded-lg border p-3" data-testid="import-preview">
                <p className="text-xs text-muted-foreground">معاينة أول صفوف كل ورقة (حتى 5 صفوف):</p>
                {Object.entries(parsed.preview).map(([sheet, rows]) =>
                  rows.length === 0 ? null : (
                    <div key={sheet} className="space-y-1">
                      <p className="text-xs font-semibold">{sheet}</p>
                      <div className="max-h-44 overflow-y-auto rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-16">#</TableHead>
                              {Object.keys(rows[0].cells).map((h) => (
                                <TableHead key={h} className="whitespace-nowrap text-xs">{h}</TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {rows.map((r) => (
                              <TableRow key={r.line}>
                                <TableCell className="text-xs text-muted-foreground">{r.line}</TableCell>
                                {Object.values(r.cells).map((v, i) => (
                                  <TableCell key={i} className="max-w-40 truncate text-xs" title={v}>
                                    {v}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* الخطوة ٣ — التنفيذ */}
      {parsed && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3" data-testid="import-execute">
          <Button
            className="h-9 gap-1.5"
            disabled={busy || selectedErrors.length > 0 || selectedSheets.length === 0}
            onClick={() => setConfirmOpen(true)}
          >
            {runMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            📥 تنفيذ الاستيراد الآن
          </Button>
          {selectedErrors.length > 0 && (
            <span className="text-xs text-muted-foreground">صحّح أخطاء الأوراق المختارة أولًا ({selectedErrors.length}).</span>
          )}
        </div>
      )}

      {runMutation.isPending && (
        <div className="space-y-2 rounded-lg border p-3" data-testid="import-progress">
          <p className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> جارٍ تنفيذ الاستيراد… بترتيب التبعية وداخل معاملات
          </p>
          <Progress value={66} className="h-2 animate-pulse" />
        </div>
      )}

      {/* تقرير النتائج */}
      {report && (
        <div className="space-y-2 rounded-lg border border-teal-600/40 bg-teal-600/5 p-3" data-testid="import-report">
          <p className="text-sm font-bold">تم الاستيراد بنجاح! 🎉</p>
          <ul className="space-y-1 text-sm leading-6">
            <li>
              • عملاء جدد: {report.stats.customers}
              {report.stats.skipped_customers > 0 ? ` (تم تخطي ${report.stats.skipped_customers} موجود مسبقًا)` : ""}
            </li>
            <li>
              • عقود جديدة: {report.stats.contracts}
              {report.stats.skipped_contracts > 0 ? ` (تم تخطي ${report.stats.skipped_contracts} موجود مسبقًا)` : ""}
            </li>
            {report.stats.sup_contracts > 0 && <li>• عقود إشراف جديدة: {report.stats.sup_contracts}</li>}
            <li>
              • مقاولو باطن: {report.stats.subs}
              {report.stats.skipped_subs > 0 ? ` (تم تخطي ${report.stats.skipped_subs})` : ""}
            </li>
            <li>
              • سندات قبض / دفعات: {report.stats.payments}
              {report.stats.skipped_payments > 0 ? ` (تم تخطي ${report.stats.skipped_payments} موجود مسبقًا)` : ""}
            </li>
            {report.stats.sub_contracts > 0 && <li>• عقود باطن: {report.stats.sub_contracts}</li>}
            {report.stats.expenses > 0 && (
              <li>
                • سندات صرف: {report.stats.expenses}
                {report.stats.skipped_expenses > 0 ? ` (تم تخطي ${report.stats.skipped_expenses} موجود مسبقًا)` : ""}
              </li>
            )}
          </ul>
          {report.stats.overpaid.length > 0 && (
            <div className="space-y-1 rounded-md bg-status-warn/10 p-2 text-xs text-status-warn">
              <p className="font-bold">
                ⚠ {report.stats.overpaid.length} سند تجاوز المتبقي على عقده وسُجّل كدفعة مقدمة (لم يتوقف الاستيراد):
              </p>
              {report.stats.overpaid.map((line, i) => (
                <p key={i}>- {line}</p>
              ))}
              <p>راجع قيمة هذه العقود أو تحقق من تكرار السندات.</p>
            </div>
          )}
        </div>
      )}

      {/* تأكيد التنفيذ — نص المكتبي الحرفي */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تنفيذ الاستيراد</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="whitespace-pre-wrap text-sm leading-6">{confirmText}</div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              disabled={runMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (file) runMutation.mutate(file);
              }}
            >
              {runMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              تنفيذ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
