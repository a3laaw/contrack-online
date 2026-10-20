"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  Files,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { apiDelete, apiGet, apiPost, apiPut, getStoredToken } from "./api";
import { errMessage, isManagerRole, type User } from "./contrack-types";
import { fmtDateTime } from "@/lib/format";
import {
  docFileName,
  fieldsColumnText,
  MSG_TEMPLATE_BAD_STATUS,
  MSG_UPLOAD_SUCCESS_PREFIX,
  SOURCE_TYPES,
  TEMPLATE_STATUSES,
  templateStatusBadgeClass,
} from "@/lib/forms/forms-core";

/**
 * مركز النماذج Word (بند 56) — مرآة word_forms_center.py تبويب «باقي النماذج»:
 * قائمة قوالب بشارات الحالة + رفع Word + تعديل البيانات/الاعتماد/الأرشفة/الحذف
 * + نافذة التعبئة (عميل/عقد/عرض + حقول يدوية) + سجل المستندات المولدة بإعادة
 * تحميلها + قسم التصنيفات (إضافة ويب موثقة — جدول form_categories بلا واجهة مكتبية).
 * تبويب «العقود وعروض الأسعار» الرسمي ملفي بالمكتبي — غير متاح في الويب حالياً.
 */

interface FormsCenterViewProps {
  user: User;
  onAuthError: () => void;
}

interface TemplateField {
  id: number;
  name: string;
  placeholder: string;
  fieldType: string;
  sourceType: string;
  sourceEntity: string;
  sourceKey: string;
  defaultValue: string;
  required: boolean;
  sort: number;
}

interface TemplateRow {
  id: number;
  baseName: string;
  version: number;
  description: string;
  categoryId: number | null;
  categoryName: string;
  status: string;
  fieldsCount: number;
  documentsCount: number;
  readyPercent: number;
  printIdentity: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

interface TemplateDetailRow extends TemplateRow {
  fields: TemplateField[];
}

interface CategoryRow {
  id: number;
  name: string;
  sort: number;
  templatesCount: number;
}

interface DocumentRow {
  id: number;
  docNumber: string;
  title: string;
  templateId: number;
  templateName: string;
  templateVersion: number;
  customerId: number | null;
  customerName: string;
  contractId: number | null;
  contractNumber: string;
  createdBy: string;
  createdAt: string;
}

interface CustomerOption {
  id: number;
  customerCode: string;
  name: string;
}

interface ContractOption {
  id: number;
  contractNumber: string;
  contractName: string;
  customerId: number;
  status: string;
}

interface QuotationOption {
  id: number;
  quotationNumber: string;
  description: string;
  customerId: number;
  status: string;
  totalAmount: number;
}

/** رفع multipart مع التوكن (نمط import-wizard) */
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

/** توليد مستند: POST JSON ⇒ docx blob + رؤوس الرقم/المعرف للتوست والاسم */
async function generateDocx(
  templateId: number,
  body: Record<string, unknown>,
  baseName: string
): Promise<{ docNumber: string; fileName: string }> {
  const token = getStoredToken();
  const res = await fetch(`/api/forms/templates/${templateId}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    credentials: "include",
  });
  if (res.status === 401) {
    const err = new Error("انتهت الجلسة — أعد تسجيل الدخول") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error || `فشل التوليد (${res.status})`);
  }
  const blob = await res.blob();
  const docNumber = res.headers.get("X-Form-Document-Number") || "FD-0001";
  const fileName = docFileName(baseName, docNumber);
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
  return { docNumber, fileName };
}

/** إعادة تحميل مستند محفوظ (docx blob من سجل المستندات) */
async function downloadStoredDoc(id: number, fileName: string): Promise<void> {
  const token = getStoredToken();
  const res = await fetch(`/api/forms/documents/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: "include",
  });
  if (res.status === 401) {
    const err = new Error("انتهت الجلسة — أعد تسجيل الدخول") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error || `فشل التنزيل (${res.status})`);
  }
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}

export function FormsCenterView({ user, onAuthError }: FormsCenterViewProps) {
  const manager = isManagerRole(user.role);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = React.useState("templates");
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("الكل");
  const flagsQuery = useQuery<{ flags: Array<{ key: string; effective: boolean }> }>({
    queryKey: ["feature-flags"],
    queryFn: async () => {
      return apiGet<{ flags: Array<{ key: string; effective: boolean }> }>("/api/feature-flags");
    },
    staleTime: 60_000,
    retry: false,
  });
  const flags = flagsQuery.data?.flags ?? [];
  const wordFormsOn =
    flags.length === 0 || flags.find((f) => f.key === "word_forms")?.effective !== false;

  const handleError = React.useCallback(
    (e: unknown, fallback: string) => {
      if (e instanceof Error && (e as Error & { status?: number }).status === 401) {
        onAuthError();
        return;
      }
      toast({ title: errMessage(e) || fallback, variant: "destructive" });
    },
    [onAuthError, toast]
  );

  const templatesQuery = useQuery<{ templates: TemplateRow[] }>({
    queryKey: ["forms", "templates", search, statusFilter],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (search.trim()) p.set("q", search.trim());
      if (statusFilter !== "الكل") p.set("status", statusFilter);
      const qs = p.toString();
      return apiGet<{ templates: TemplateRow[] }>(`/api/forms/templates${qs ? `?${qs}` : ""}`);
    },
  });

  const documentsQuery = useQuery<{ documents: DocumentRow[] }>({
    queryKey: ["forms", "documents"],
    queryFn: async () => {
      return apiGet<{ documents: DocumentRow[] }>("/api/forms/documents");
    },
  });

  const categoriesQuery = useQuery<{ categories: CategoryRow[] }>({
    queryKey: ["forms", "categories"],
    queryFn: async () => {
      return apiGet<{ categories: CategoryRow[] }>("/api/forms/categories");
    },
  });

  const templates = templatesQuery.data?.templates ?? [];
  const documents = documentsQuery.data?.documents ?? [];
  const categories = categoriesQuery.data?.categories ?? [];

  // ===== نافذة الرفع =====
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [uploadFile, setUploadFile] = React.useState<File | null>(null);
  const [uploadName, setUploadName] = React.useState("");
  const [uploadDesc, setUploadDesc] = React.useState("");
  const [uploadCategory, setUploadCategory] = React.useState<string>("none");
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("file", uploadFile as File);
      form.append("name", uploadName);
      form.append("description", uploadDesc);
      form.append("categoryId", uploadCategory === "none" ? "" : uploadCategory);
      return postForm<{ placeholdersCount: number; knownCount: number }>("/api/forms/templates", form);
    },
    onSuccess: (res) => {
      toast({
        title: `${MSG_UPLOAD_SUCCESS_PREFIX}${res.placeholdersCount} · مطابق تلقائيًا: ${res.knownCount}`,
      });
      qc.invalidateQueries({ queryKey: ["forms"] });
      setUploadOpen(false);
      setUploadFile(null);
      setUploadName("");
      setUploadDesc("");
      setUploadCategory("none");
    },
    onError: (e) => handleError(e, "تعذر رفع القالب."),
  });

  const onPickFile = (f: File | null) => {
    setUploadFile(f);
    if (f && !uploadName) {
      const base = f.name.replace(/\.docx$/i, "");
      setUploadName(base);
    }
  };

  // ===== نافذة التعبئة/التوليد =====
  const [fillTemplate, setFillTemplate] = React.useState<TemplateRow | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);

  const detailQuery = useQuery<{ template: TemplateDetailRow }>({
    queryKey: ["forms", "template", fillTemplate?.id],
    queryFn: async () => {
      return apiGet<{ template: TemplateDetailRow }>(`/api/forms/templates/${fillTemplate?.id}`);
    },
    enabled: !!fillTemplate,
  });

  // ===== نافذة تعديل البيانات =====
  const [editTemplate, setEditTemplate] = React.useState<TemplateRow | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editDesc, setEditDesc] = React.useState("");
  const [editStatus, setEditStatus] = React.useState<string>("مسودة");

  const openEdit = (t: TemplateRow) => {
    setEditTemplate(t);
    setEditName(t.baseName);
    setEditDesc(t.description);
    setEditStatus(t.status);
  };

  const editMutation = useMutation({
    mutationFn: () => {
      return apiPut<{ template: TemplateRow }>(`/api/forms/templates/${editTemplate?.id}`, {
        baseName: editName,
        description: editDesc,
        status: editStatus,
      });
    },
    onSuccess: () => {
      toast({ title: "تم تعديل بيانات النموذج" });
      qc.invalidateQueries({ queryKey: ["forms"] });
      setEditTemplate(null);
    },
    onError: (e) => handleError(e, MSG_TEMPLATE_BAD_STATUS),
  });

  // ===== الأرشفة/الاستعادة =====
  const [archiveTarget, setArchiveTarget] = React.useState<TemplateRow | null>(null);
  const archiveMutation = useMutation({
    mutationFn: (t: TemplateRow) => {
      return apiPut<{ template: TemplateRow }>(`/api/forms/templates/${t.id}`, {
        status: t.status === "مؤرشف" ? "معتمد" : "مؤرشف",
      });
    },
    onSuccess: (_res, t) => {
      toast({ title: t.status === "مؤرشف" ? "تمت الاستعادة" : "تمت الأرشفة" });
      qc.invalidateQueries({ queryKey: ["forms", "templates"] });
      setArchiveTarget(null);
    },
    onError: (e) => handleError(e, "تعذر تغيير حالة النموذج."),
  });

  // ===== الحذف (مدير فقط) =====
  const [deleteTarget, setDeleteTarget] = React.useState<TemplateRow | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (t: TemplateRow) => {
      return apiDelete<{ deleted: boolean }>(`/api/forms/templates/${t.id}`);
    },
    onSuccess: () => {
      toast({ title: "تم حذف النموذج" });
      qc.invalidateQueries({ queryKey: ["forms"] });
      setDeleteTarget(null);
    },
    onError: (e) => handleError(e, "تعذر حذف النموذج."),
  });

  // ===== إضافة تصنيف =====
  const [categoryOpen, setCategoryOpen] = React.useState(false);
  const [categoryName, setCategoryName] = React.useState("");
  const categoryMutation = useMutation({
    mutationFn: () => {
      return apiPost<{ category: CategoryRow }>("/api/forms/categories", { name: categoryName });
    },
    onSuccess: () => {
      toast({ title: "أُنشئ التصنيف ✅" });
      qc.invalidateQueries({ queryKey: ["forms", "categories"] });
      setCategoryOpen(false);
      setCategoryName("");
    },
    onError: (e) => handleError(e, "تعذر إنشاء التصنيف."),
  });

  // ===== تنزيل مستند من السجل =====
  const downloadMutation = useMutation({
    mutationFn: (d: DocumentRow) =>
      downloadStoredDoc(d.id, docFileName(d.templateName, d.docNumber || `FD-${d.id}`)),
    onSuccess: () => toast({ title: "تم تنزيل المستند ✅" }),
    onError: (e) => handleError(e, "تعذر تنزيل المستند."),
  });

  const isLoading = templatesQuery.isLoading;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6" dir="rtl">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-xl font-extrabold tracking-tight">مركز النماذج</h1>
        <p className="text-sm text-muted-foreground">
          النماذج الرسمية والعامة · توليد Word/PDF من مكان واحد.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList className="w-fit">
          <TabsTrigger value="templates">القوالب</TabsTrigger>
          <TabsTrigger value="documents">المستندات المولدة</TabsTrigger>
          <TabsTrigger value="categories">التصنيفات</TabsTrigger>
        </TabsList>

        {/* ===== تبويب القوالب ===== */}
        <TabsContent value="templates" className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-4 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="بحث باسم النموذج..."
                  className="w-full sm:w-64"
                  aria-label="بحث باسم النموذج"
                />
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-36" aria-label="فلتر الحالة">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="الكل">كل الحالات</SelectItem>
                    {TEMPLATE_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grow" />
                {wordFormsOn && (
                  <Button
                    variant="outline"
                    onClick={() => setUploadOpen(true)}
                    className="gap-1.5"
                  >
                    <Upload className="size-4" aria-hidden />
                    رفع Word
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => templatesQuery.refetch()}
                  aria-label="تحديث القائمة"
                >
                  <RefreshCw className={`size-4 ${templatesQuery.isFetching ? "animate-spin" : ""}`} />
                </Button>
              </div>

              {isLoading ? (
                <div className="flex flex-col gap-2">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : templates.length === 0 ? (
                <Alert>
                  <AlertDescription>
                    لا توجد قوالب بعد — ارفع أول قالب Word بحقول <span dir="ltr">{"{{...}}"}</span> لبدء التوليد.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="max-h-96 overflow-y-auto rounded-md border" dir="rtl">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead>النموذج</TableHead>
                        <TableHead className="w-20">الإصدار</TableHead>
                        <TableHead className="w-24">الحالة</TableHead>
                        <TableHead className="w-36">الحقول</TableHead>
                        <TableHead className="w-40">آخر تعديل</TableHead>
                        <TableHead className="w-64 text-left">إجراءات</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {templates.map((t) => {
                        return (
                          <TableRow key={t.id}>
                            <TableCell>
                              <div className="font-semibold">{t.baseName}</div>
                              {t.description ? (
                                <div className="text-xs text-muted-foreground line-clamp-1">{t.description}</div>
                              ) : null}
                            </TableCell>
                            <TableCell>v{t.version}</TableCell>
                            <TableCell>
                              <Badge className={`border-0 text-xs ${templateStatusBadgeClass(t.status)}`}>
                                {t.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {fieldsColumnText(t.fieldsCount, t.readyPercent)}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {fmtDateTime(t.updatedAt)}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap justify-end gap-1">
                                <Button size="sm" onClick={() => { setFillTemplate(t); setDetailOpen(true); }}>
                                  تعبئة
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1"
                                  onClick={() => { setFillTemplate(t); setDetailOpen(true); }}
                                  title="عرض الحقول ومدى دعمها التلقائي"
                                >
                                  <Link2 className="size-3.5" aria-hidden />
                                  ربط الحقول
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="gap-1"
                                  onClick={() => openEdit(t)}
                                  title="تعديل اسم القالب وبياناته الخارجية"
                                >
                                  <Pencil className="size-3.5" aria-hidden />
                                  ✎ تعديل البيانات
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setArchiveTarget(t)}
                                  title="أرشفة النموذج المحدد أو استعادته"
                                >
                                  أرشفة/استعادة
                                </Button>
                                {manager && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive hover:text-destructive"
                                    disabled={t.documentsCount > 0}
                                    title={t.documentsCount > 0 ? "حذف النموذج (له مستندات محفوظة)" : "حذف النموذج"}
                                    onClick={() => setDeleteTarget(t)}
                                  >
                                    <Trash2 className="size-3.5" aria-hidden />
                                    🗑 حذف
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== تبويب المستندات المولدة ===== */}
        <TabsContent value="documents" className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-4 p-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold">سجل المستندات المولدة</h2>
                <div className="grow" />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => documentsQuery.refetch()}
                  aria-label="تحديث السجل"
                >
                  <RefreshCw className={`size-4 ${documentsQuery.isFetching ? "animate-spin" : ""}`} />
                </Button>
              </div>
              {documentsQuery.isLoading ? (
                <div className="flex flex-col gap-2">
                  {[0, 1].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : documents.length === 0 ? (
                <Alert>
                  <AlertDescription>لا توجد مستندات مولدة بعد — املأ قالبًا من تبويب القوالب.</AlertDescription>
                </Alert>
              ) : (
                <div className="max-h-96 overflow-y-auto rounded-md border" dir="rtl">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead className="w-24">الرقم</TableHead>
                        <TableHead>العنوان</TableHead>
                        <TableHead>النموذج</TableHead>
                        <TableHead>العميل</TableHead>
                        <TableHead>العقد</TableHead>
                        <TableHead className="w-28">أنشأه</TableHead>
                        <TableHead className="w-36">التاريخ</TableHead>
                        <TableHead className="w-24 text-left">تحميل</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {documents.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-mono text-xs">{d.docNumber}</TableCell>
                          <TableCell className="font-semibold">{d.title}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {d.templateName} <span dir="ltr">(v{d.templateVersion})</span>
                          </TableCell>
                          <TableCell>{d.customerName || "—"}</TableCell>
                          <TableCell>{d.contractNumber || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{d.createdBy}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fmtDateTime(d.createdAt)}</TableCell>
                          <TableCell>
                            <div className="flex justify-end">
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1"
                                onClick={() => downloadMutation.mutate(d)}
                                disabled={downloadMutation.isPending}
                              >
                                <Download className="size-3.5" aria-hidden />
                                إعادة تحميل
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== تبويب التصنيفات ===== */}
        <TabsContent value="categories" className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-4 p-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold">تصنيفات النماذج</h2>
                <div className="grow" />
                <Button size="sm" className="gap-1" onClick={() => setCategoryOpen(true)}>
                  <Plus className="size-4" aria-hidden />
                  تصنيف جديد
                </Button>
              </div>
              {categoriesQuery.isLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : categories.length === 0 ? (
                <Alert>
                  <AlertDescription>لا توجد تصنيفات بعد — أضف تصنيفًا لتنظيم القوالب.</AlertDescription>
                </Alert>
              ) : (
                <div className="max-h-96 overflow-y-auto rounded-md border" dir="rtl">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead>التصنيف</TableHead>
                        <TableHead className="w-32">عدد القوالب</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {categories.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-semibold">{c.name}</TableCell>
                          <TableCell>{c.templatesCount}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ===== حوار رفع قالب ===== */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="sm:max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>رفع قالب Word</DialogTitle>
            <DialogDescription>
              ملف .docx يحتوي وسوم <span dir="ltr">{"{{اسم_العميل}}"}</span> — تُستخرج الحقول تلقائيًا عند الرفع.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="form-file">ملف القالب (.docx)</Label>
              <input
                ref={fileInputRef}
                id="form-file"
                type="file"
                accept=".docx"
                className="hidden"
                onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              />
              <Button variant="outline" className="w-fit gap-1.5" onClick={() => fileInputRef.current?.click()}>
                <Files className="size-4" aria-hidden />
                {uploadFile ? uploadFile.name : "اختر ملف Word"}
              </Button>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="form-name">اسم النموذج *</Label>
              <Input
                id="form-name"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                placeholder="مثال: خطاب تعريف بالراتب"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="form-desc">الوصف</Label>
              <Textarea
                id="form-desc"
                value={uploadDesc}
                onChange={(e) => setUploadDesc(e.target.value)}
                rows={2}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>التصنيف</Label>
              <Select value={uploadCategory} onValueChange={setUploadCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— بلا تصنيف —</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUploadOpen(false)}>
              ✕ إلغاء
            </Button>
            <Button
              onClick={() => uploadMutation.mutate()}
              disabled={!uploadFile || !uploadName.trim() || uploadMutation.isPending}
            >
              {uploadMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "رفع القالب"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== نافذة التعبئة/التوليد ===== */}
      {fillTemplate && (
        <FillDialog
          open={detailOpen}
          onOpenChange={(o) => {
            setDetailOpen(o);
            if (!o) setFillTemplate(null);
          }}
          template={fillTemplate}
          detail={detailQuery.data?.template ?? null}
          loading={detailQuery.isLoading}
          onAuthError={onAuthError}
          onGenerated={() => {
            qc.invalidateQueries({ queryKey: ["forms", "documents"] });
            qc.invalidateQueries({ queryKey: ["forms", "templates"] });
            setDetailOpen(false);
            setFillTemplate(null);
            setTab("documents");
          }}
        />
      )}

      {/* ===== حوار تعديل البيانات ===== */}
      <Dialog open={!!editTemplate} onOpenChange={(o) => !o && setEditTemplate(null)}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل بيانات النموذج</DialogTitle>
            <DialogDescription>
              هذا التعديل يغير بيانات النموذج في المركز فقط، ولا يغير حقول القالب الداخلية أو المستندات التي تم توليدها سابقًا.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-name">اسم النموذج</Label>
              <Input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-desc">الوصف</Label>
              <Textarea id="edit-desc" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={3} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الحالة</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditTemplate(null)}>
              ✕ إلغاء
            </Button>
            <Button onClick={() => editMutation.mutate()} disabled={!editName.trim() || editMutation.isPending}>
              {editMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "💾 حفظ البيانات"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تأكيد الأرشفة/الاستعادة ===== */}
      <Dialog open={!!archiveTarget} onOpenChange={(o) => !o && setArchiveTarget(null)}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>{archiveTarget?.status === "مؤرشف" ? "استعادة" : "أرشفة"}</DialogTitle>
            <DialogDescription>
              {archiveTarget?.status === "مؤرشف"
                ? `استعادة النموذج «${archiveTarget?.baseName}»؟`
                : `أرشفة النموذج «${archiveTarget?.baseName}»؟`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setArchiveTarget(null)}>
              ✕ إلغاء
            </Button>
            <Button
              onClick={() => archiveTarget && archiveMutation.mutate(archiveTarget)}
              disabled={archiveMutation.isPending}
            >
              {archiveTarget?.status === "مؤرشف" ? "استعادة" : "أرشفة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تأكيد الحذف ===== */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>حذف النموذج</DialogTitle>
            <DialogDescription>
              حذف النموذج «{deleteTarget?.baseName}» نهائيًا من مركز النماذج؟
              <br />
              لن يتم حذف أي مستندات عملاء لأنه غير مستخدم.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              ✕ إلغاء
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
              disabled={deleteMutation.isPending}
            >
              🗑 حذف نهائي
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== حوار تصنيف جديد ===== */}
      <Dialog open={categoryOpen} onOpenChange={setCategoryOpen}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>تصنيف جديد</DialogTitle>
            <DialogDescription>اسم التصنيف يظهر عند رفع القوالب لتنظيمها.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cat-name">اسم التصنيف *</Label>
            <Input id="cat-name" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCategoryOpen(false)}>
              ✕ إلغاء
            </Button>
            <Button
              onClick={() => categoryMutation.mutate()}
              disabled={!categoryName.trim() || categoryMutation.isPending}
            >
              {categoryMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** حوار التعبئة والتوليد — مرآة WordFormFillDialog */
function FillDialog({
  open,
  onOpenChange,
  template,
  detail,
  loading,
  onAuthError,
  onGenerated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  template: TemplateRow;
  detail: TemplateDetailRow | null;
  loading: boolean;
  onAuthError: () => void;
  onGenerated: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = React.useState("");
  const [customerId, setCustomerId] = React.useState<string>("none");
  const [contractId, setContractId] = React.useState<string>("none");
  const [quotationId, setQuotationId] = React.useState<string>("none");
  const [manual, setManual] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setTitle(template.baseName);
      setCustomerId("none");
      setContractId("none");
      setQuotationId("none");
      setManual({});
    }
  }, [open, template]);

  const customersQuery = useQuery<{ customers: CustomerOption[] }>({
    queryKey: ["forms", "fill-customers"],
    queryFn: async () => {
      return apiGet<{ customers: CustomerOption[] }>("/api/customers");
    },
    enabled: open,
  });

  const contractsQuery = useQuery<{ contracts: ContractOption[] }>({
    queryKey: ["forms", "fill-contracts", customerId],
    queryFn: async () => {
      const cid = customerId !== "none" ? `?customerId=${customerId}` : "";
      return apiGet<{ contracts: ContractOption[] }>(`/api/contracts${cid}`);
    },
    enabled: open,
  });

  const quotationsQuery = useQuery<{ quotations: QuotationOption[] }>({
    queryKey: ["forms", "fill-quotations", customerId],
    queryFn: async () => {
      const cid = customerId !== "none" ? `?customerId=${customerId}` : "";
      return apiGet<{ quotations: QuotationOption[] }>(`/api/quotes${cid}`);
    },
    enabled: open,
  });

  const fields = detail?.fields ?? [];
  const manualFields = fields.filter((f) => (f.sourceType || "manual") === "manual");

  const generate = async () => {
    // فحص الإلزام الواجهي — مرآة style.error «الحقل مطلوب: X»
    for (const f of manualFields) {
      const key = f.name || f.placeholder;
      if (f.required && !String(manual[key] ?? "").trim()) {
        toast({ title: `الحقل مطلوب: ${f.placeholder || key}`, variant: "destructive" });
        return;
      }
    }
    setBusy(true);
    try {
      const res = await generateDocx(
        template.id,
        {
          title,
          customerId: customerId !== "none" ? Number(customerId) : null,
          contractId: contractId !== "none" ? Number(contractId) : null,
          quotationId: quotationId !== "none" ? Number(quotationId) : null,
          values: manual,
        },
        template.baseName
      );
      toast({ title: `تم توليد مستند Word.\n${res.fileName}` });
      onGenerated();
    } catch (e) {
      if (e instanceof Error && (e as Error & { status?: number }).status === 401) {
        onAuthError();
        return;
      }
      toast({ title: errMessage(e) || "تعذر توليد المستند.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" dir="rtl">
        <DialogHeader>
          <DialogTitle>تعبئة نموذج Word — {template.baseName}</DialogTitle>
          <DialogDescription>
            القيم المرتبطة بالنظام تُملأ تلقائيًا، واكتب فقط الحقول اليدوية ثم اضغط توليد.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="doc-title">اسم المستند</Label>
                <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>العميل</Label>
                <Select value={customerId} onValueChange={(v) => { setCustomerId(v); setContractId("none"); setQuotationId("none"); }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— بدون عميل —</SelectItem>
                    {(customersQuery.data?.customers ?? []).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name} · {c.customerCode}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>العقد</Label>
                <Select value={contractId} onValueChange={setContractId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— بدون عقد —</SelectItem>
                    {(contractsQuery.data?.contracts ?? []).map((k) => (
                      <SelectItem key={k.id} value={String(k.id)}>
                        {k.contractNumber} · {k.contractName || k.contractNumber}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label>عرض السعر</Label>
                <Select value={quotationId} onValueChange={setQuotationId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— بدون عرض —</SelectItem>
                    {(quotationsQuery.data?.quotations ?? []).map((q) => (
                      <SelectItem key={q.id} value={String(q.id)}>
                        {q.quotationNumber} · {q.description || q.quotationNumber}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-bold">الحقول اليدوية</h3>
              {manualFields.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  لا توجد حقول يدوية — هذا القالب جاهز للتعبئة التلقائية.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {manualFields.map((f) => {
                    const key = f.name || f.placeholder;
                    const label = f.placeholder || key;
                    return (
                      <div key={f.id} className="flex flex-col gap-1.5">
                        <Label htmlFor={`mf-${f.id}`} className="text-xs">
                          {label}
                          {f.required ? " *" : ""}
                        </Label>
                        <Input
                          id={`mf-${f.id}`}
                          value={manual[key] ?? ""}
                          onChange={(e) => setManual((m) => ({ ...m, [key]: e.target.value }))}
                          placeholder={`{{${label}}}`}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ربط الحقول — عرض فقط (كحوار «ربط حقول Word» المكتبي) */}
            {fields.length > 0 && (
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-semibold">ربط الحقول</summary>
                <div className="mt-3 max-h-56 overflow-y-auto rounded-md border" dir="rtl">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Placeholder</TableHead>
                        <TableHead>مصدر</TableHead>
                        <TableHead>جهة</TableHead>
                        <TableHead>حقل</TableHead>
                        <TableHead>إلزام</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fields.map((f) => (
                        <TableRow key={f.id}>
                          <TableCell className="text-xs" dir="ltr">
                            {`{{${f.placeholder || f.name}}}`}
                          </TableCell>
                          <TableCell className="text-xs">
                            {SOURCE_TYPES[f.sourceType] || f.sourceType}
                          </TableCell>
                          <TableCell className="text-xs">{f.sourceEntity || "—"}</TableCell>
                          <TableCell className="text-xs">{f.sourceKey || "—"}</TableCell>
                          <TableCell className="text-xs">{f.required ? "مطلوب" : "اختياري"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </details>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            ✕ إلغاء
          </Button>
          <Button onClick={generate} disabled={busy || loading}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : "توليد Word"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
