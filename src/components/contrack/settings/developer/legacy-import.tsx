"use client";

/**
 * مستورد الملفات القديمة فوق نظام الشركات — Task 86 (مرآة قرار الخطوة 2):
 * مصدران: ملف قاعدة بيانات SQLite (.sqlite/.db) يُقرأ على الخادم ويُحوَّل
 * جداوله إلى أوراق القالب الثماني تلقائيًا (مع محرّر ربط يدوي)، أو نص جدولي
 * ملصوق (TSV/CSV بترويسة). ثم يعمل خط أنابيب الاستيراد القائم كاملًا:
 * فحص بمعاينة وأخطاء برقم الصف ← اختيار الأوراق ← تنفيذ بترتيب التبعية.
 *
 * الشركة المستهدفة: التنفيذ يجري في «شركة الجلسة الحالية» — المعالج يطلب
 * صراحةً اختيار الشركة (أو إنشاء شركة معزولة جديدة) ويطابقها مع الجلسة عبر
 * حارس الخادم (409) — بيانات الشركة الرئيسية لا تُلمس إلا باختيار واعٍ.
 */

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Database,
  FileUp,
  Loader2,
  Plus,
  Table2,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { IMPORT_SHEETS } from "@/lib/import/sheets";
import {
  LEGACY_ENTITIES,
  autoDetectMapping,
  entityHeaders,
  buildTextSheet,
} from "@/lib/import/legacy-shared";
import type { LegacyEntityKey, LegacyMapping, LegacyTableInfo } from "@/lib/import/legacy-shared";
import { errMessage } from "../../contrack-types";
import { apiGet, apiPost, getStoredToken, setStoredToken } from "../../api";

// ===== أنواع الاستجابات =====

interface CompanyRow {
  id: number;
  name: string;
  shortName: string;
  isActive: boolean;
  usersCount: number;
}
interface CompaniesResponse {
  companies: CompanyRow[];
  currentCompanyId: number;
  canSwitch: boolean;
}

interface InspectResponse {
  fileName: string;
  sizeKB: number;
  tables: (LegacyTableInfo & { sample: string[][] })[];
  mapping: LegacyMapping;
}

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
interface PreviewResponse {
  counts: ImportCounts;
  sheetsPresent: string[];
  errors: ImportIssueDTO[];
  warnings: ImportIssueDTO[];
  preview: Record<string, { line: number; cells: Record<string, string> }[]>;
  notes: string[];
}
interface SyncReport {
  typesCreated: string[];
  accountsCreated: string[];
  projectsCreated: string[];
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
  sync: SyncReport;
  notes: string[];
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

export function LegacyImport({ onAuthError }: { onAuthError: () => void }) {
  const { toast } = useToast();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // ===== الشركة المستهدفة =====
  const companiesQ = useQuery({
    queryKey: ["companies"],
    queryFn: () => apiGet<CompaniesResponse>("/api/companies"),
    retry: false,
  });
  const companiesData = companiesQ.data;
  const currentCompanyId = companiesData?.currentCompanyId ?? 0;
  const [targetId, setTargetId] = React.useState<string>("current");
  const [newCompanyName, setNewCompanyName] = React.useState("");
  const effectiveTargetId = targetId === "current" ? currentCompanyId : Number(targetId);
  const targetCompany = companiesData?.companies.find((c) => c.id === effectiveTargetId);
  const sessionCompany = companiesData?.companies.find((c) => c.id === currentCompanyId);
  const companyMismatch =
    !!companiesData?.canSwitch && effectiveTargetId > 0 && effectiveTargetId !== currentCompanyId;

  const switchTo = async (id: number) => {
    try {
      const res = await apiPost<{ token: string }>("/api/companies/switch", { companyId: id });
      setStoredToken(res.token);
      window.location.reload();
    } catch (e) {
      if ((e as { status?: number }).status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر التبديل", description: errMessage(e) });
    }
  };

  const createCompanyMutation = useMutation<unknown, unknown, void>({
    mutationFn: async () => {
      const created = await apiPost<{ company: { id: number; name: string } }>("/api/companies", {
        name: newCompanyName.trim(),
      });
      const sw = await apiPost<{ token: string }>("/api/companies/switch", { companyId: created.company.id });
      setStoredToken(sw.token); // مزامنة التوكن المخزّن — Bearer يسبق الكوكي في أولوية الجلسة
      return created;
    },
    onSuccess: () => window.location.reload(),
    onError: (e) => {
      if ((e as { status?: number }).status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر إنشاء الشركة", description: errMessage(e) });
    },
  });

  // ===== الوضع والملف =====
  const [mode, setMode] = React.useState<"sqlite" | "text">("sqlite");
  const [inspect, setInspect] = React.useState<InspectResponse | null>(null);
  const [mapping, setMapping] = React.useState<LegacyMapping | null>(null);
  const [openEntity, setOpenEntity] = React.useState<string>("");

  // النص الملصوق
  const [textSheet, setTextSheet] = React.useState<string>(IMPORT_SHEETS[0].name);
  const [textContent, setTextContent] = React.useState("");
  const textCheck = React.useMemo(() => {
    if (!textContent.trim()) return null;
    const res = buildTextSheet(textContent, textSheet);
    return res; // {error} أو {sheet, info}
  }, [textContent, textSheet]);

  // الفحص والتنفيذ
  const [parsed, setParsed] = React.useState<PreviewResponse | null>(null);
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [report, setReport] = React.useState<RunResponse | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const fail = React.useCallback(
    (e: unknown, title: string) => {
      if ((e as { status?: number })?.status === 401) {
        onAuthError();
        return;
      }
      toast({ variant: "destructive", title, description: errText(e) });
    },
    [onAuthError, toast]
  );

  const resetResults = () => {
    setParsed(null);
    setReport(null);
    setSelected({});
  };

  // ===== ١) فحص ملف SQLite =====
  const inspectMutation = useMutation<InspectResponse, unknown, File>({
    mutationFn: (f) => {
      const form = new FormData();
      form.append("file", f);
      return postForm<InspectResponse>("/api/import/legacy/inspect", form);
    },
    onSuccess: (res) => {
      setInspect(res);
      setMapping(res.mapping);
      resetResults();
      toast({
        title: "تم فحص الملف",
        description: `${res.tables.length} جدول · ${(res.sizeKB).toLocaleString("en-US")} KB`,
      });
    },
    onError: (e) => fail(e, "تعذر فحص الملف"),
  });

  const onPickFile = (f: File | null) => {
    setInspect(null);
    setMapping(null);
    resetResults();
    if (f) inspectMutation.mutate(f);
  };

  // ===== ٢) المعاينة =====
  const buildPayload = (withSelected: boolean): FormData | null => {
    if (effectiveTargetId <= 0) {
      toast({ variant: "destructive", title: "حدّد الشركة المستهدفة أولًا" });
      return null;
    }
    const form = new FormData();
    if (mode === "sqlite") {
      const file = fileInputRef.current?.files?.[0];
      if (!file || !mapping) {
        toast({ variant: "destructive", title: "اختر ملف SQLite وافحصه أولًا" });
        return null;
      }
      form.append("file", file);
      form.append(
        "payload",
        JSON.stringify({ mode: "sqlite", targetCompanyId: effectiveTargetId, mapping })
      );
    } else {
      form.append(
        "payload",
        JSON.stringify({
          mode: "text",
          targetCompanyId: effectiveTargetId,
          text: textContent,
          sheet: textSheet,
          ...(withSelected ? { selected: [textSheet] } : {}),
        })
      );
    }
    return form;
  };

  const previewMutation = useMutation<PreviewResponse, unknown, FormData>({
    mutationFn: (form) => postForm<PreviewResponse>("/api/import/legacy/preview", form),
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
    onError: (e) => fail(e, "تعذر فحص المصدر"),
  });

  // ===== ٣) التنفيذ =====
  const runMutation = useMutation<RunResponse, unknown, FormData>({
    mutationFn: (form) => postForm<RunResponse>("/api/import/legacy/run", form),
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

  const onPreview = () => {
    const form = buildPayload(false);
    if (form) previewMutation.mutate(form);
  };
  const onRun = () => {
    let form: FormData | null;
    if (mode === "sqlite") {
      form = buildPayload(false);
      if (form) {
        const payload = JSON.parse(form.get("payload") as string);
        payload.selected = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
        form.set("payload", JSON.stringify(payload));
      }
    } else {
      form = buildPayload(true);
    }
    if (form) runMutation.mutate(form);
  };

  // ===== ملخص النتائج =====
  const summary = React.useMemo(() => {
    if (!parsed) return "لم يُفحص المصدر بعد.";
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
    return {
      customers: has("العملاء") ? c.customers : 0,
      contracts: has("العقود") ? c.contracts : 0,
      sup_contracts: has("عقود الإشراف") ? c.sup_contracts : 0,
      subs: has("مقاولو الباطن") ? c.subs : 0,
      sub_contracts: has("عقود الباطن") ? c.sub_contracts : 0,
      expenses: has("سندات الصرف") ? c.expenses : 0,
      payments: has("سندات القبض") ? c.payments : 0,
    };
  }, [parsed, selected]);

  const confirmText = React.useMemo(() => {
    if (!selectedCounts) return "";
    return (
      `سيتم إدخال البيانات في شركة «${targetCompany?.name ?? effectiveTargetId}»:\n` +
      `• ${selectedCounts.customers} عميل\n` +
      `• ${selectedCounts.contracts} عقد\n` +
      (selectedCounts.sup_contracts ? `• ${selectedCounts.sup_contracts} عقد إشراف هندسي\n` : "") +
      `• ${selectedCounts.subs} مقاول باطن\n` +
      (selectedCounts.sub_contracts ? `• ${selectedCounts.sub_contracts} عقد باطن\n` : "") +
      `• ${selectedCounts.payments} سند قبض\n` +
      (selectedCounts.expenses ? `• ${selectedCounts.expenses} سند صرف\n` : "") +
      "\nالأنواع والحسابات والمشاريع الناقصة ستُنشأ تلقائيًا في الشركة المستهدفة.\nهل أنت متأكد؟"
    );
  }, [selectedCounts, targetCompany, effectiveTargetId]);

  const busy = inspectMutation.isPending || previewMutation.isPending || runMutation.isPending || createCompanyMutation.isPending;

  // ===== محرّر الخريطة =====
  const tables = inspect?.tables ?? [];
  const tableByName = React.useMemo(() => new Map(tables.map((t) => [t.name, t])), [tables]);

  const setEntityTable = (key: LegacyEntityKey, tableName: string) => {
    setMapping((prev) => {
      if (!prev) return prev;
      const t = tableName ? (tableByName.get(tableName) ?? null) : null;
      const auto = autoDetectMapping(t ? [t] : []);
      return { ...prev, [key]: { table: tableName || null, columns: auto[key].columns } };
    });
    resetResults();
  };
  const setEntityColumn = (key: LegacyEntityKey, header: string, col: string) => {
    setMapping((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [key]: { ...prev[key], columns: { ...prev[key].columns, [header]: col } },
      };
    });
    resetResults();
  };

  return (
    <div className="space-y-4" data-testid="legacy-import">
      {/* ===== الشركة المستهدفة ===== */}
      <div className="rounded-lg border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm leading-6">
            <b>الشركة المستهدفة للاستيراد:</b> كل ما يُستورد يذهب إلى هذه الشركة فقط — الشركة الرئيسية
            وبياناتها الحية لا تُلمس.
          </p>
          <Select value={targetId} onValueChange={(v) => { setTargetId(v); resetResults(); }} disabled={busy}>
            <SelectTrigger className="h-9 w-64" aria-label="اختيار الشركة المستهدفة">
              <SelectValue placeholder="اختر الشركة…" />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              <SelectItem value="current">
                الشركة الحالية — {sessionCompany?.name ?? "…"}
              </SelectItem>
              {(companiesData?.companies ?? [])
                .filter((c) => c.isActive && c.id !== currentCompanyId)
                .map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              <SelectItem value="new">➕ شركة معزولة جديدة…</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {targetId === "new" && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
            <Input
              className="h-9 w-64"
              placeholder="اسم الشركة المعزولة (مثل: بيانات قديمة — فرع X)"
              value={newCompanyName}
              onChange={(e) => setNewCompanyName(e.target.value)}
              aria-label="اسم الشركة الجديدة"
            />
            <Button
              className="h-9 gap-1.5"
              disabled={!newCompanyName.trim() || createCompanyMutation.isPending}
              onClick={() => createCompanyMutation.mutate()}
            >
              {createCompanyMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              إنشاء والتبديل إليها
            </Button>
            <p className="text-xs text-muted-foreground">تُنشأ ثم تُصبح جلسك الحالية تلقائيًا لتنفيذ الاستيراد فيها.</p>
          </div>
        )}

        {companyMismatch && targetId !== "new" && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-status-warn">
            <AlertTriangle className="size-4" />
            <span>
              الجلسة الحالية في «{sessionCompany?.name}» — للتنفيذ في «{targetCompany?.name}» بدّل أولًا
              (سيُعاد تحميل الصفحة وأعد اختيار الملف).
            </span>
            <Button size="sm" className="h-8 gap-1" onClick={() => switchTo(effectiveTargetId)} disabled={busy}>
              <Building2 className="size-3.5" /> التبديل الآن
            </Button>
          </div>
        )}
      </div>

      {/* ===== تبويبات المصدر ===== */}
      <div className="flex gap-2" role="tablist" aria-label="مصدر الاستيراد">
        <Button
          size="sm"
          variant={mode === "sqlite" ? "default" : "outline"}
          className="h-9 gap-1.5"
          onClick={() => { setMode("sqlite"); resetResults(); }}
          data-testid="legacy-mode-sqlite"
        >
          <Database className="size-4" /> ملف قاعدة بيانات (SQLite)
        </Button>
        <Button
          size="sm"
          variant={mode === "text" ? "default" : "outline"}
          className="h-9 gap-1.5"
          onClick={() => { setMode("text"); resetResults(); }}
          data-testid="legacy-mode-text"
        >
          <Table2 className="size-4" /> لصق نص جدولي
        </Button>
      </div>

      {/* ===== وضع SQLite ===== */}
      {mode === "sqlite" && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".sqlite,.db,.sqlite3,.db3"
            className="hidden"
            aria-label="اختيار ملف قاعدة البيانات القديمة"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          />
          <div className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-xl text-sm leading-6">
                <b>الخطوة ١:</b> ارفع ملف قاعدة البيانات المكتبية (.sqlite / .db) — تُقرأ جداوله على
                الخادم ويُكتشف ربطها تلقائيًا (عملاء، عقود، سندات…).
              </p>
              <Button className="h-9 gap-1.5" onClick={() => fileInputRef.current?.click()} disabled={busy} data-testid="legacy-pick">
                {inspectMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
                اختيار الملف وفحصه
              </Button>
            </div>
            {inspect && (
              <p className="mt-2 text-xs text-muted-foreground">
                الملف: {inspect.fileName} · {inspect.sizeKB.toLocaleString("en-US")} KB · {inspect.tables.length} جدول
              </p>
            )}
          </div>

          {/* ملخص الاكتشاف + محرّر الربط */}
          {inspect && mapping && (
            <div className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-medium">
                <b>الخطوة ٢:</b> الربط المكتشف — عدّله فقط إن كان مصدرًا غير قياسي:
              </p>
              <div className="space-y-1">
                {LEGACY_ENTITIES.map((e) => {
                  const m = mapping[e.key];
                  const rowsCount = m.table ? (tableByName.get(m.table)?.rows ?? 0) : 0;
                  const open = openEntity === e.key;
                  return (
                    <div key={e.key} className="rounded-md border">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-xs hover:bg-muted/50"
                        onClick={() => setOpenEntity(open ? "" : e.key)}
                        aria-expanded={open}
                      >
                        <span className="font-medium">{e.label}</span>
                        <span className="text-muted-foreground">
                          {m.table ? `${m.table} · ${rowsCount.toLocaleString("en-US")} صف` : "— تخطي —"}
                        </span>
                      </button>
                      {open && (
                        <div className="space-y-2 border-t p-3">
                          <div className="flex items-center gap-2">
                            <span className="w-24 text-xs text-muted-foreground">الجدول</span>
                            <Select
                              value={m.table ?? ""}
                              onValueChange={(v) => setEntityTable(e.key, v)}
                            >
                              <SelectTrigger className="h-8 w-56" aria-label={`جدول ${e.label}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="max-h-60">
                                <SelectItem value="">— تخطي هذا الكيان —</SelectItem>
                                {tables.map((t) => (
                                  <SelectItem key={t.name} value={t.name}>
                                    {t.name} ({t.rows.toLocaleString("en-US")})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {m.table && (
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {entityHeaders(e.key).map((h) => (
                                <div key={h} className="flex items-center gap-2">
                                  <span className="w-28 shrink-0 truncate text-xs text-muted-foreground" title={h}>{h}</span>
                                  <Select
                                    value={m.columns[h] ?? ""}
                                    onValueChange={(v) => setEntityColumn(e.key, h, v)}
                                  >
                                    <SelectTrigger className="h-8 w-full" aria-label={`عمود ${h}`}>
                                      <SelectValue placeholder="— تلقائي —" />
                                    </SelectTrigger>
                                    <SelectContent className="max-h-60">
                                      <SelectItem value="">— تلقائي —</SelectItem>
                                      {(tableByName.get(m.table ?? "")?.columns ?? []).map((c) => (
                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ===== وضع النص ===== */}
      {mode === "text" && (
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm leading-6">
            <b>الخطوة ١:</b> الصق جدولًا بترويسة (نسخ من Excel/Notepad بأعمدة Tab أو CSV) — يستهدف
            ورقة واحدة في كل مرة، فارفع العقود أولًا ثم سنداتها.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">الورقة المستهدفة:</span>
            <Select value={textSheet} onValueChange={(v) => { setTextSheet(v); resetResults(); }} disabled={busy}>
              <SelectTrigger className="h-9 w-52" aria-label="اختيار ورقة النص">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {IMPORT_SHEETS.map((s) => (
                  <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <textarea
            className="min-h-40 w-full rounded-md border bg-background p-2 font-mono text-xs"
            placeholder={`مثال لورقة «${textSheet}»:\n${entityHeaders(LEGACY_ENTITIES.find((e) => e.sheet === textSheet)?.key ?? "customers").join("\t")}\n...`}
            value={textContent}
            onChange={(e) => { setTextContent(e.target.value); resetResults(); }}
            aria-label="النص الجدولي الملصوق"
          />
          {textCheck && (
            "error" in textCheck ? (
              <p className="text-xs text-destructive">🛑 {textCheck.error}</p>
            ) : (
              <p className="text-xs text-teal-700">
                <CheckCircle2 className="mb-0.5 inline size-3.5" /> فاصل: {textCheck.info.delimiter} ·
                أعمدة مطوبة: {textCheck.info.matched}
                {textCheck.info.positional ? " (بالموقع)" : ""} · صفوف: {textCheck.info.rows}
                {textCheck.info.unmatched.length > 0 && (
                  <> · ترويسات مُهملة: {textCheck.info.unmatched.join("، ")}</>
                )}
              </p>
            )
          )}
        </div>
      )}

      {/* ===== زر الفحص ===== */}
      {(mode === "sqlite" ? !!inspect : !!textCheck && !("error" in textCheck)) && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
          <Button className="h-9 gap-1.5" onClick={onPreview} disabled={busy || companyMismatch} data-testid="legacy-preview">
            {previewMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Table2 className="size-4" />}
            فحص ومعاينة في «{targetCompany?.name ?? "…"}»
          </Button>
          {companyMismatch && (
            <span className="text-xs text-status-warn">بدّل إلى الشركة المستهدفة أولًا (الصندوق أعلاه).</span>
          )}
        </div>
      )}

      {/* ===== نتائج الفحص ===== */}
      <div className="space-y-2" data-testid="legacy-results">
        <p className="text-sm font-semibold">{summary}</p>

        {parsed && parsed.notes.length > 0 && (
          <div className="space-y-1 rounded-lg border p-2">
            <p className="text-xs font-semibold text-muted-foreground">ملاحظات التحويل من المصدر:</p>
            {parsed.notes.map((n, i) => (
              <p key={i} className="text-xs leading-5 text-status-warn">ℹ {n}</p>
            ))}
          </div>
        )}

        {parsed && parsed.errors.length === 0 && parsed.warnings.length === 0 && (
          <p className="flex items-center gap-1.5 text-sm text-teal-700">
            <CheckCircle2 className="size-4" /> ✅ المصدر سليم تمامًا · جاهز للاستيراد
          </p>
        )}

        {parsed && parsed.errors.length > 0 && (
          <div className="max-h-60 overflow-y-auto rounded-lg border" data-testid="legacy-errors">
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

        {parsed && parsed.warnings.length > 0 && (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2" data-testid="legacy-warnings">
            {parsed.warnings.map((w, i) => (
              <p key={i} className="text-xs leading-5 text-status-warn">⚠ {w.text}</p>
            ))}
          </div>
        )}

        {parsed && parsed.errors.length > 0 && (
          <p className="text-xs font-bold text-destructive">
            🛑 صحح الأخطاء أعلاه أو أزل أوراقها من التنفيذ · لن يُدخل أي شيء قبل ذلك.
          </p>
        )}

        {/* اختيار الأوراق المنفَّذة */}
        {parsed && parsed.errors.length === 0 && parsed.sheetsPresent.length > 0 && (
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
        {parsed && Object.keys(parsed.preview).length > 0 && (
          <div className="space-y-3 rounded-lg border p-3" data-testid="legacy-preview">
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
      </div>

      {/* ===== التنفيذ ===== */}
      {parsed && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3" data-testid="legacy-execute">
          <Button
            className="h-9 gap-1.5"
            disabled={busy || selectedErrors.length > 0 || selectedSheets.length === 0 || companyMismatch}
            onClick={() => setConfirmOpen(true)}
          >
            {runMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            📥 تنفيذ الاستيراد في «{targetCompany?.name ?? "…"}»
          </Button>
          {selectedErrors.length > 0 && (
            <span className="text-xs text-muted-foreground">صحّح أخطاء الأوراق المختارة أولًا ({selectedErrors.length}).</span>
          )}
        </div>
      )}

      {runMutation.isPending && (
        <div className="space-y-2 rounded-lg border p-3" data-testid="legacy-progress">
          <p className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> جارٍ تنفيذ الاستيراد… مزامنة المرجعيات ثم الإدخال بترتيب التبعية
          </p>
          <Progress value={66} className="h-2 animate-pulse" />
        </div>
      )}

      {/* ===== تقرير النتائج ===== */}
      {report && (
        <div className="space-y-2 rounded-lg border border-teal-600/40 bg-teal-600/5 p-3" data-testid="legacy-report">
          <p className="text-sm font-bold">تم الاستيراد بنجاح! 🎉</p>
          {(report.sync.typesCreated.length > 0 ||
            report.sync.accountsCreated.length > 0 ||
            report.sync.projectsCreated.length > 0) && (
            <div className="rounded-md border bg-background p-2 text-xs leading-5">
              <p className="font-semibold">مرجعيات أُنشئت في الشركة المستهدفة:</p>
              {report.sync.typesCreated.length > 0 && (
                <p>• أنواع عقود ({report.sync.typesCreated.length}): {report.sync.typesCreated.join("، ")}</p>
              )}
              {report.sync.accountsCreated.length > 0 && (
                <p>• حسابات مصروفات ({report.sync.accountsCreated.length}): {report.sync.accountsCreated.slice(0, 6).join("، ")}{report.sync.accountsCreated.length > 6 ? " …" : ""}</p>
              )}
              {report.sync.projectsCreated.length > 0 && (
                <p>• مشاريع ({report.sync.projectsCreated.length}): {report.sync.projectsCreated.slice(0, 6).join("، ")}{report.sync.projectsCreated.length > 6 ? " …" : ""}</p>
              )}
            </div>
          )}
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
              • سندات قبض: {report.stats.payments}
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
            </div>
          )}
          {report.notes.length > 0 && (
            <div className="space-y-1 rounded-md border p-2 text-xs leading-5 text-muted-foreground">
              {report.notes.map((n, i) => (
                <p key={i}>ℹ {n}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== تأكيد التنفيذ ===== */}
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
                onRun();
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
