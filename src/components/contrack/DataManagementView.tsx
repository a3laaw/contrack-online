"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Database,
  DatabaseBackup,
  Download,
  Eye,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useToast } from "@/hooks/use-toast";
import { adminApi } from "@/lib/admin-api";
import { ApiError, apiGet, apiPost } from "./api";
import type {
  AuditResponse,
  BackupsResponse,
  BackupCreateResponse,
  BackupRestoreResponse,
  FullResetResponse,
  PurgeAuditResponse,
  PurgeExecuteResponse,
  PurgePreviewResponse,
  User,
} from "./contrack-types";
import { PURGE_KIND_LABEL, errMessage, isManagerRole } from "./contrack-types";
import { fmtDateTime } from "@/lib/format";

interface DataManagementViewProps {
  user: User;
  onAuthError: () => void;
  /** القسم المبدئي من القائمة الجانبية: backup ⇒ النسخ الاحتياطي، devtools ⇒ أدوات المطور */
  initialSection?: string;
}

/** بطاقة مقفلة — لغير المصرّح */
function LockedCard({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        <Lock className="size-8 text-muted-foreground/50" />
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function failToast(toast: ReturnType<typeof useToast>["toast"], onAuthError: () => void, title: string) {
  return (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) onAuthError();
    toast({ variant: "destructive", title, description: errMessage(e) });
  };
}

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return fmtDateTime(new Date(iso).toISOString());
  } catch {
    return iso;
  }
}

// ==================== تبويب سجل التدقيق ====================

const AUDIT_ENTITY_OPTIONS: { value: string; label: string }[] = [
  { value: "voucher", label: "سند" },
  { value: "contract", label: "عقد" },
  { value: "addendum", label: "ملحق" },
  { value: "claim", label: "مطالبة" },
  { value: "customer", label: "عميل" },
  { value: "visit", label: "زيارة" },
  { value: "comment", label: "تعليق" },
  { value: "invoice", label: "فاتورة" },
  { value: "task", label: "مهمة" },
  { value: "payment_plan", label: "دفعة" },
  { value: "backup", label: "نسخة احتياطية" },
  { value: "user", label: "مستخدم" },
  { value: "system", label: "النظام" },
];

const PAGE = 50;

function AuditTab({ onAuthError }: { onAuthError: () => void }) {
  const { toast } = useToast();

  // مسودة الفلاتر + الفلاتر المطبقة
  const [draft, setDraft] = React.useState({ entityType: "all", username: "", q: "", from: "", to: "" });
  const [filters, setFilters] = React.useState({ entityType: "all", username: "", q: "", from: "", to: "" });
  const [limit, setLimit] = React.useState(PAGE);

  const params = new URLSearchParams();
  if (filters.entityType && filters.entityType !== "all") params.set("entityType", filters.entityType);
  if (filters.username.trim()) params.set("username", filters.username.trim());
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  params.set("limit", String(limit));

  const auditQuery = useQuery<AuditResponse>({
    queryKey: ["audit", filters, limit],
    queryFn: () => apiGet<AuditResponse>(`/api/audit?${params.toString()}`),
    placeholderData: (prev) => prev,
  });

  React.useEffect(() => {
    if (auditQuery.isError) failToast(toast, onAuthError, "تعذر تحميل سجل التدقيق")(auditQuery.error);
  }, [auditQuery.isError, auditQuery.error, toast, onAuthError]);

  const items = auditQuery.data?.items ?? [];
  const total = auditQuery.data?.total ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <div className="space-y-1.5">
              <Label className="text-xs">الكيان</Label>
              <Select value={draft.entityType} onValueChange={(v) => setDraft((d) => ({ ...d, entityType: v }))}>
                <SelectTrigger className="h-9 w-full" aria-label="فلتر الكيان">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {AUDIT_ENTITY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-user" className="text-xs">المستخدم</Label>
              <Input
                id="a-user"
                className="h-9"
                placeholder="اسم المستخدم"
                value={draft.username}
                onChange={(e) => setDraft((d) => ({ ...d, username: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-q" className="text-xs">بحث</Label>
              <Input
                id="a-q"
                className="h-9"
                placeholder="إجراء/اسم/سبب…"
                value={draft.q}
                onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setFilters(draft);
                    setLimit(PAGE);
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-from" className="text-xs">من تاريخ</Label>
              <Input
                id="a-from"
                type="date"
                className="h-9"
                value={draft.from}
                onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-to" className="text-xs">إلى تاريخ</Label>
              <Input
                id="a-to"
                type="date"
                className="h-9"
                value={draft.to}
                onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button
                size="sm"
                className="h-9 flex-1 gap-1.5"
                onClick={() => {
                  setFilters(draft);
                  setLimit(PAGE);
                }}
              >
                <Search className="size-4" />
                تطبيق
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                aria-label="إعادة تعيين الفلاتر"
                onClick={() => {
                  const empty = { entityType: "all", username: "", q: "", from: "", to: "" };
                  setDraft(empty);
                  setFilters(empty);
                  setLimit(PAGE);
                }}
              >
                <RotateCcw className="size-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="size-4 text-primary" />
            سجل التدقيق
            <Badge variant="secondary" className="text-[10px]">{total} سجلًا</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {auditQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              جارٍ التحميل…
            </div>
          ) : items.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">لا توجد سجلات مطابقة</p>
          ) : (
            <div className="max-h-[520px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead className="text-start">الوقت</TableHead>
                    <TableHead className="text-start">المستخدم</TableHead>
                    <TableHead className="text-start">الإجراء</TableHead>
                    <TableHead className="text-start">الكيان</TableHead>
                    <TableHead className="text-start">الاسم</TableHead>
                    <TableHead className="text-start">الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtTs(r.ts)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs font-medium">{r.username || "—"}</TableCell>
                      <TableCell className="max-w-52">
                        <span className="line-clamp-1 text-xs" title={r.reason ? `${r.action} — ${r.reason}` : r.action}>
                          {r.action}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant="secondary" className="text-[10px]">
                          {AUDIT_ENTITY_OPTIONS.find((o) => o.value === r.entityType)?.label || r.entityType}
                          {r.entityId ? ` #${r.entityId}` : ""}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-56">
                        <span className="line-clamp-1 text-xs" title={r.entityName}>{r.entityName || "—"}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          {r.oldStatus ? (
                            <Badge variant="outline" className="text-[10px]">{r.oldStatus}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                          {r.oldStatus && r.newStatus ? <span className="text-[10px] text-muted-foreground">←</span> : null}
                          {r.newStatus ? (
                            <Badge className="text-[10px]" variant="default">{r.newStatus}</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {items.length < total && (
            <div className="flex justify-center border-t p-3">
              <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setLimit((l) => l + PAGE)} disabled={auditQuery.isFetching}>
                {auditQuery.isFetching ? <Loader2 className="size-4 animate-spin" /> : null}
                المزيد ({items.length} من {total})
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ==================== تبويب النسخ الاحتياطي ====================

interface BackupRow {
  fileName: string;
  kind: "db" | "full" | "safety";
  username: string;
  sizeKB: number;
  createdAt: string;
  exists: boolean;
  tableCounts?: Record<string, number>;
}

function rowsCountOf(tc?: Record<string, number>): number {
  return Object.values(tc ?? {}).reduce((a, b) => a + b, 0);
}

function BackupsTab({ onAuthError }: { onAuthError: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [restoreTarget, setRestoreTarget] = React.useState<string | null>(null);

  const backupsQuery = useQuery<BackupsResponse>({
    queryKey: ["backups"],
    queryFn: () => apiGet<BackupsResponse>("/api/backups"),
  });

  const createMutation = useMutation<BackupCreateResponse, unknown, void>({
    mutationFn: () => apiPost<BackupCreateResponse>("/api/backups", {}),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["backups"] });
      qc.invalidateQueries({ queryKey: ["audit"] });
      toast({ title: "تم إنشاء النسخة", description: res.message || `الملف: ${res.fileName}` });
    },
    onError: failToast(toast, onAuthError, "تعذر إنشاء النسخة الاحتياطية"),
  });

  const downloadMutation = useMutation<Awaited<ReturnType<typeof adminApi.downloadBackup>>, unknown, void>({
    mutationFn: () => adminApi.downloadBackup(),
    onSuccess: (res) => {
      const total = rowsCountOf(res.meta.tables);
      toast({ title: "تم تنزيل النسخة", description: `${res.filename} — ${total.toLocaleString("en-US")} صفًا` });
    },
    onError: failToast(toast, onAuthError, "تعذر تنزيل النسخة الاحتياطية"),
  });

  const restoreMutation = useMutation<BackupRestoreResponse, unknown, { fileName: string }>({
    mutationFn: (body) => apiPost<BackupRestoreResponse>("/api/backups/restore", body),
    onSuccess: (res) => {
      qc.invalidateQueries(); // كل البيانات تغيّرت بعد الاستعادة
      setRestoreTarget(null);
      toast({ title: "تمت الاستعادة", description: res.message });
    },
    onError: (e) => {
      setRestoreTarget(null);
      failToast(toast, onAuthError, "تعذرت الاستعادة")(e);
    },
  });

  const items = (backupsQuery.data?.items ?? []) as BackupRow[];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <DatabaseBackup className="size-4 text-primary" />
            إنشاء نسخة احتياطية
          </CardTitle>
          <CardDescription>
            تُحفظ نسخ JSON كاملة على الخادم في مجلد db/backups مع فهرس، ويُحتفظ بآخر 30 نسخة تلقائيًا — والاستعادة
            تحافظ على المعرّفات الأصلية وتعيد ضبط تسلسلات المعرّفات
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button
            className="h-10 gap-1.5"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />}
            إنشاء نسخة
          </Button>
          <Button
            variant="outline"
            className="h-10 gap-1.5"
            onClick={() => downloadMutation.mutate()}
            disabled={downloadMutation.isPending}
          >
            {downloadMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            تنزيل نسخة JSON
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-10"
            aria-label="تحديث القائمة"
            title="تحديث القائمة"
            onClick={() => backupsQuery.refetch()}
            disabled={backupsQuery.isFetching}
          >
            <RefreshCw className={backupsQuery.isFetching ? "size-4 animate-spin" : "size-4"} />
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">النسخ المحفوظة</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {backupsQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              جارٍ التحميل…
            </div>
          ) : items.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">لا توجد نسخ محفوظة بعد — أنشئ أول نسخة من الأعلى</p>
          ) : (
            <div className="max-h-[480px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead className="text-start">الاسم</TableHead>
                    <TableHead className="text-start">الصفوف</TableHead>
                    <TableHead className="text-start">الحجم</TableHead>
                    <TableHead className="text-start">التاريخ</TableHead>
                    <TableHead className="text-start">المستخدم</TableHead>
                    <TableHead className="text-start">إجراء</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((b) => (
                    <TableRow key={b.fileName}>
                      <TableCell className="max-w-64">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={b.kind === "safety" ? "destructive" : "secondary"}
                            className="shrink-0 text-[10px]"
                          >
                            {b.kind === "safety" ? "أمان" : "خادم"}
                          </Badge>
                          <span className="line-clamp-1 font-mono text-xs" dir="ltr" title={b.fileName}>{b.fileName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {rowsCountOf(b.tableCounts).toLocaleString("en-US")}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{b.sizeKB.toLocaleString("en-US")} KB</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtTs(b.createdAt)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{b.username || "—"}</TableCell>
                      <TableCell className="text-start">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 gap-1.5"
                          onClick={() => setRestoreTarget(b.fileName)}
                          disabled={!b.exists || restoreMutation.isPending}
                        >
                          <RotateCcw className="size-4" />
                          استعادة
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* حوار تأكيد الاستعادة — تحذير بذكر النسخة الأمان */}
      <AlertDialog open={!!restoreTarget} onOpenChange={(open) => !open && setRestoreTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-status-warn" />
              استعادة نسخة احتياطية
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm leading-6">
                <p>
                  سيتم حذف بيانات قاعدة Postgres الحالية من كل الجداول وإعادة إنشائها من النسخة
                  <span className="mx-1 font-mono text-xs" dir="ltr">{restoreTarget}</span>
                  مع الحفاظ على المعرّفات الأصلية وإعادة ضبط التسلسلات.
                </p>
                <p className="rounded-md bg-amber-500/10 p-2 text-xs text-status-warn">
                  سيُنشأ أولًا <strong>نسخة أمان</strong> (safety-…) من الوضع الحالي ويمكن استعادتها لاحقًا. كل خطوات
                  الحذف والإنشاء داخل معاملة واحدة — إن فشل أي جزء تُرجع القاعدة كما كانت.
                </p>
                <p className="text-xs text-muted-foreground">هل تريد المتابعة؟</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (restoreTarget) restoreMutation.mutate({ fileName: restoreTarget });
              }}
            >
              {restoreMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
              استعادة الآن
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ==================== تبويب إدارة البيانات (المطور) ====================

function DataTab({ onAuthError }: { onAuthError: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // ===== محو كيان =====
  const [purgeKind, setPurgeKind] = React.useState<"contract" | "customer">("contract");
  const [purgeId, setPurgeId] = React.useState("");
  const [preview, setPreview] = React.useState<PurgePreviewResponse | null>(null);
  const [purgeReason, setPurgeReason] = React.useState("");
  const [purgeConfirm, setPurgeConfirm] = React.useState("");
  const [lastPurge, setLastPurge] = React.useState<PurgeExecuteResponse | null>(null);

  const previewMutation = useMutation<PurgePreviewResponse, unknown, { action: "preview"; kind: string; id: number }>({
    mutationFn: (body) => apiPost<PurgePreviewResponse>("/api/data-mgmt/purge", body),
    onSuccess: (res) => {
      setPreview(res);
      setLastPurge(null);
      toast({ title: "المعاينة جاهزة", description: `${res.label} — إجمالي التبعيات المباشرة: ${res.total}` });
    },
    onError: (e) => {
      setPreview(null);
      failToast(toast, onAuthError, "تعذرت المعاينة")(e);
    },
  });

  const executeMutation = useMutation<PurgeExecuteResponse, unknown, { action: "execute"; kind: string; id: number; reason: string }>({
    mutationFn: (body) => apiPost<PurgeExecuteResponse>("/api/data-mgmt/purge", body),
    onSuccess: (res) => {
      setLastPurge(res);
      setPreview(null);
      setPurgeReason("");
      setPurgeConfirm("");
      setPurgeId("");
      qc.invalidateQueries({ queryKey: ["purge-audit"] });
      qc.invalidateQueries({ queryKey: ["audit"] });
      toast({ title: "تم المحو", description: res.message });
    },
    onError: failToast(toast, onAuthError, "تعذر تنفيذ المحو"),
  });

  // ===== إعادة الضبط الكاملة =====
  const [resetConfirm, setResetConfirm] = React.useState("");
  const [resetReason, setResetReason] = React.useState("");

  const resetMutation = useMutation<FullResetResponse, unknown, { confirm: string; reason: string }>({
    mutationFn: (body) => apiPost<FullResetResponse>("/api/data-mgmt/full-reset", body),
    onSuccess: (res) => {
      setResetConfirm("");
      setResetReason("");
      qc.invalidateQueries({ queryKey: ["purge-audit"] });
      qc.invalidateQueries({ queryKey: ["audit"] });
      toast({ title: "تمت إعادة الضبط", description: res.message });
    },
    onError: failToast(toast, onAuthError, "تعذرت إعادة الضبط"),
  });

  // ===== سجل المحو =====
  const [logKind, setLogKind] = React.useState("all");
  const [logQ, setLogQ] = React.useState("");

  const logParams = new URLSearchParams();
  if (logKind !== "all") logParams.set("kind", logKind);
  if (logQ.trim()) logParams.set("q", logQ.trim());
  logParams.set("limit", "100");

  const logQuery = useQuery<PurgeAuditResponse>({
    queryKey: ["purge-audit", logKind, logQ],
    queryFn: () => apiGet<PurgeAuditResponse>(`/api/data-mgmt/purge?${logParams.toString()}`),
    placeholderData: (prev) => prev,
  });

  React.useEffect(() => {
    if (logQuery.isError) failToast(toast, onAuthError, "تعذر تحميل سجل المحو")(logQuery.error);
  }, [logQuery.isError, logQuery.error, toast, onAuthError]);

  const idNum = Number(purgeId) || 0;
  const canExecute = !!preview && purgeReason.trim().length > 0 && purgeConfirm === "محو";
  const canReset = resetConfirm === "إعادة الضبط الكاملة" && resetReason.trim().length > 0;
  const logItems = logQuery.data?.items ?? [];

  return (
    <div className="space-y-4">
      {/* محو كيان */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Trash2 className="size-4 text-destructive" />
            محو كيان (بلاقطة كاملة)
          </CardTitle>
          <CardDescription>
            معاينة شجرة التبعيات أولًا بلا حذف، ثم تنفيذ المحو بسبب إلزامي — تُحفظ لقطة JSON كاملة في سجل المحو قبل الحذف
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs">النوع</Label>
              <Select value={purgeKind} onValueChange={(v) => { setPurgeKind(v as "contract" | "customer"); setPreview(null); }}>
                <SelectTrigger className="h-9 w-full" aria-label="نوع الكيان">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contract">عقد</SelectItem>
                  <SelectItem value="customer">عميل</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-id" className="text-xs">المعرف الرقمي</Label>
              <Input
                id="p-id"
                type="number"
                min={1}
                className="h-9"
                placeholder="مثال: 12"
                value={purgeId}
                onChange={(e) => { setPurgeId(e.target.value); setPreview(null); }}
              />
            </div>
            <Button
              variant="outline"
              className="h-9 gap-1.5"
              onClick={() => previewMutation.mutate({ action: "preview", kind: purgeKind, id: idNum })}
              disabled={idNum <= 0 || previewMutation.isPending}
            >
              {previewMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
              معاينة
            </Button>
          </div>

          {/* شجرة العدّادات */}
          {preview && (
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant="destructive" className="text-[10px]">للمحو</Badge>
                <span className="text-sm font-semibold">{preview.label}</span>
                <Badge variant="secondary" className="text-[10px]">{PURGE_KIND_LABEL[preview.kind]} #{preview.id}</Badge>
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
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="p-reason" className="text-xs">سبب المحو (إلزامي)</Label>
                  <Input
                    id="p-reason"
                    className="h-9"
                    placeholder="اذكر سبب المحو…"
                    value={purgeReason}
                    onChange={(e) => setPurgeReason(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-confirm" className="text-xs">تأكيد — اكتب «محو»</Label>
                  <Input
                    id="p-confirm"
                    className="h-9"
                    placeholder="محو"
                    value={purgeConfirm}
                    onChange={(e) => setPurgeConfirm(e.target.value)}
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button
                  variant="destructive"
                  className="h-10 gap-1.5"
                  onClick={() => executeMutation.mutate({ action: "execute", kind: preview.kind, id: preview.id, reason: purgeReason.trim() })}
                  disabled={!canExecute || executeMutation.isPending}
                >
                  {executeMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  تنفيذ المحو
                </Button>
                <p className="text-xs text-muted-foreground">لا يُنفَّذ الحذف إلا بعد المعاينة + السبب + كتابة «محو»</p>
              </div>
            </div>
          )}

          {/* نتيجة آخر محو */}
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

      {/* إعادة الضبط الكاملة — كتلة حمراء عالية التحذير */}
      <Card className="border-red-300">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-status-danger">
            <AlertTriangle className="size-4" />
            إعادة الضبط الكاملة — خطير
          </CardTitle>
          <CardDescription className="text-status-danger/80">
            حذف <strong>كل بيانات الأعمال</strong> بمعاملة واحدة: العملاء والعقود والسندات والدفعات والمراحل والملاحق
            والمطالبات والفواتير والباطن والعُهد والبوابة والشركة الأخرى والقيود والمهام والزيارات والتعليقات والمرفقات
            والموظفون وأنواع العقود والمراحل المرجعية والقوالب.
          </CardDescription>
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
              <Label htmlFor="fr-confirm" className="text-xs">
                تأكيد — اكتب «إعادة الضبط الكاملة» حرفيًا
              </Label>
              <Input
                id="fr-confirm"
                className="h-9"
                placeholder="إعادة الضبط الكاملة"
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fr-reason" className="text-xs">السبب (إلزامي)</Label>
              <Input
                id="fr-reason"
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
            onClick={() => resetMutation.mutate({ confirm: resetConfirm, reason: resetReason.trim() })}
            disabled={!canReset || resetMutation.isPending}
          >
            {resetMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />}
            تنفيذ إعادة الضبط الكاملة
          </Button>
          {resetMutation.isError && (
            <p className="text-xs text-destructive">{errMessage(resetMutation.error)}</p>
          )}
        </CardContent>
      </Card>

      {/* سجل المحو PurgeAudit */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">سجل المحو (PurgeAudit)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-end gap-2 p-4 pb-3">
            <div className="w-40 space-y-1.5">
              <Label className="text-xs">النوع</Label>
              <Select value={logKind} onValueChange={setLogKind}>
                <SelectTrigger className="h-9 w-full" aria-label="فلتر نوع سجل المحو">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="contract">عقد</SelectItem>
                  <SelectItem value="customer">عميل</SelectItem>
                  <SelectItem value="full_reset">إعادة ضبط</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label htmlFor="pl-q" className="text-xs">بحث</Label>
              <Input
                id="pl-q"
                className="h-9"
                placeholder="اسم/سبب/مستخدم…"
                value={logQ}
                onChange={(e) => setLogQ(e.target.value)}
              />
            </div>
            {logQuery.data && <Badge variant="secondary" className="mb-2 text-[10px]">{logQuery.data.total} سجلًا</Badge>}
          </div>
          {logQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              جارٍ التحميل…
            </div>
          ) : logItems.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">لا توجد عمليات محو مسجلة</p>
          ) : (
            <div className="max-h-80 overflow-y-auto border-t">
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
                      <TableCell className="whitespace-nowrap text-start text-xs text-muted-foreground">
                        {(r.snapshotSize / 1024).toFixed(1)} KB
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ==================== الشاشة الرئيسية ====================

export function DataManagementView({ user, onAuthError, initialSection }: DataManagementViewProps) {
  const manager = isManagerRole(user.role);
  const developer = user.role === "developer";

  // القسم النشط من القائمة الجانبية: النسخ الاحتياطي أو أدوات المطور
  const [dmTab, setDmTab] = React.useState(initialSection === "devtools" ? "audit" : "backups");
  React.useEffect(() => {
    if (initialSection) setDmTab(initialSection === "devtools" ? "audit" : "backups");
  }, [initialSection]);

  if (!manager) {
    return <LockedCard title="للمدير فقط" description="إدارة البيانات والنسخ الاحتياطي وسجل التدقيق متاحة للمدير/المطور فقط." />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <ShieldCheck className="size-5 text-primary" />
          إدارة البيانات
        </h1>
        <p className="text-sm text-muted-foreground">سجل التدقيق · النسخ الاحتياطي · أدوات المحو وإعادة الضبط (حوكمة النظام)</p>
      </div>

      <Tabs value={dmTab} onValueChange={setDmTab}>
        <TabsList className="h-10 w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="audit" className="gap-1.5">
            <ScrollText className="size-4" />
            سجل التدقيق
          </TabsTrigger>
          <TabsTrigger value="backups" className="gap-1.5">
            <DatabaseBackup className="size-4" />
            النسخ الاحتياطي
          </TabsTrigger>
          <TabsTrigger value="data" className="gap-1.5">
            <ShieldCheck className="size-4" />
            إدارة البيانات
            {!developer && <Lock className="size-3 text-muted-foreground" />}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="audit" className="mt-4">
          <AuditTab onAuthError={onAuthError} />
        </TabsContent>

        <TabsContent value="backups" className="mt-4">
          <BackupsTab onAuthError={onAuthError} />
        </TabsContent>

        <TabsContent value="data" className="mt-4">
          {developer ? (
            <DataTab onAuthError={onAuthError} />
          ) : (
            <LockedCard
              title="أدوات المحو للمطور فقط"
              description="محو الكيانات وإعادة الضبط الكاملة أدوات حساسة متاحة لحساب المطور فقط — لا تُسلَّم للعميل."
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
