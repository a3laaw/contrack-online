"use client";

/**
 * تاب «مصمم القوالب» داخل القوائم المرجعية — D6: القوالب مرجعية تُبنى قبل العقد.
 * قائمة القوالب (فلتر بالنوع) + إنشاء (قالب ابتدائي جاهز D10) + فتح المصمم + حذف.
 * يُستقبل عبر sessionStorage «ctrk_doc_tpl_type_id» عند القدوم من شاشة الأنواع
 * بزر «تصميم قالب المستند» — فيُفتح حوار الإنشاء مربوطًا بالنوع المختار.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSignature, FileText, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, apiDelete, apiGet, apiPost } from "@/components/contrack/api";
import { errMessage, isManagerRole, type User } from "@/components/contrack/contrack-types";
import dynamic from "next/dynamic";
import {
  KIND_LABEL,
  type DocTemplateKind,
  type DocTemplateMeta,
} from "@/lib/doc-template-core";

// المصمم ثقيل (TipTap) — تحميل عند الطلب فقط حتى لا يدخل باندل الـ/ الرئيسي
const DocTemplateEditor = dynamic(
  () => import("./doc-template-editor").then((m) => m.DocTemplateEditor),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-3">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-[60vh] w-full" />
      </div>
    ),
  }
);

type KindFilter = "all" | DocTemplateKind;

interface CreateState {
  name: string;
  kind: DocTemplateKind;
  contractTypeId: string;
}

const EMPTY_CREATE: CreateState = { name: "", kind: "quotation", contractTypeId: "" };

export function DocTemplatesTab({
  user,
  onAuthError,
  onFailToast,
}: {
  user: User;
  onAuthError: () => void;
  onFailToast: (e: unknown, title: string) => void;
}) {
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);
  const [filter, setFilter] = React.useState<KindFilter>("all");
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createForm, setCreateForm] = React.useState<CreateState>(EMPTY_CREATE);
  const [deleteTarget, setDeleteTarget] = React.useState<DocTemplateMeta | null>(null);

  const listQuery = useQuery<{ templates: DocTemplateMeta[] }>({
    queryKey: ["doc-templates"],
    queryFn: () => apiGet<{ templates: DocTemplateMeta[] }>("/api/doc-templates"),
  });

  const typesQuery = useQuery<{ types: Array<{ id: number; name: string }> }>({
    queryKey: ["contract-types"],
    queryFn: () => apiGet<{ types: Array<{ id: number; name: string }> }>("/api/contract-types"),
    enabled: createOpen && createForm.kind === "contract_type",
  });

  // القدوم من شاشة «الأنواع والمراحل والدفعات» — حوار إنشاء مربوط بالنوع المختار
  React.useEffect(() => {
    const preset = sessionStorage.getItem("ctrk_doc_tpl_type_id");
    if (!preset) return;
    sessionStorage.removeItem("ctrk_doc_tpl_type_id");
    const typeId = Number(preset);
    if (!Number.isFinite(typeId)) return;
    setCreateForm({ name: "", kind: "contract_type", contractTypeId: String(typeId) });
    setCreateOpen(true);
  }, []);

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiPost<{ template: DocTemplateMeta }>("/api/doc-templates", payload),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["doc-templates"] });
      setCreateOpen(false);
      setCreateForm(EMPTY_CREATE);
      setEditingId(res.template.id);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      onFailToast(e, "تعذر إنشاء القالب");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/doc-templates/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["doc-templates"] });
      setDeleteTarget(null);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      onFailToast(e, "تعذر حذف القالب");
    },
  });

  const templates = (listQuery.data?.templates ?? []).filter(
    (t) => filter === "all" || t.kind === filter
  );

  if (editingId !== null) {
    return (
      <DocTemplateEditor
        templateId={editingId}
        onAuthError={onAuthError}
        onBack={() => setEditingId(null)}
      />
    );
  }

  const kindName = (id: string) => {
    const t = (typesQuery.data?.types ?? []).find((x) => String(x.id) === id);
    return t?.name ?? "";
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-base font-bold">
          <FileSignature className="size-5 text-primary" aria-hidden />
          مصمم القوالب
        </h2>
        <span className="hidden xl:inline text-xs text-muted-foreground">
          قوالب وورد-مثل تُبنى هنا وتُحفظ داخل النظام — بنود ودفعات وBOQ وجداول — والتوليد من شاشة العرض
        </span>
        <div className="ms-auto flex items-center gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as KindFilter)}>
            <SelectTrigger className="h-8 w-40 text-xs" aria-label="فلترة القوالب">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل القوالب</SelectItem>
              <SelectItem value="quotation">قوالب عروض الأسعار</SelectItem>
              <SelectItem value="contract_type">قوالب أنواع العقود</SelectItem>
            </SelectContent>
          </Select>
          {manager && (
            <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => { setCreateForm(EMPTY_CREATE); setCreateOpen(true); }}>
              <Plus className="size-3.5" aria-hidden />
              قالب جديد
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>القالب</TableHead>
              <TableHead>النوع</TableHead>
              <TableHead>نوع العقد</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>آخر تحديث</TableHead>
              <TableHead className="text-center">إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="space-y-2 py-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                </TableCell>
              </TableRow>
            ) : templates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  لا قوالب بعد — أنشئ أول قالب (قالب ابتدائي جاهز بستايل العقود يُبنى تلقائيًا عند الإنشاء)
                </TableCell>
              </TableRow>
            ) : (
              templates.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-1.5">
                      <FileText className="size-4 text-muted-foreground" aria-hidden />
                      {t.name}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">{KIND_LABEL[t.kind]}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.contractTypeName || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={t.status === "معتمد" ? "default" : "outline"} className="text-[10px]">
                      {t.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground" dir="ltr">
                    {new Date(t.updatedAt).toLocaleDateString("ar-KW-u-nu-latn")}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1 text-xs"
                        onClick={() => setEditingId(t.id)}
                        aria-label={`تصميم ${t.name}`}
                      >
                        تصميم
                      </Button>
                      {manager && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(t)}
                          aria-label={`حذف ${t.name}`}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* حوار إنشاء قالب — يبدأ بقالب ابتدائي جاهز (D10) */}
      <Dialog open={createOpen} onOpenChange={(o) => !o && setCreateOpen(false)}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>قالب مستند جديد</DialogTitle>
            <DialogDescription>
              يُنشأ بقالب ابتدائي جاهز بستايل العقود المرجعية — ثم تعدّله من المصمم بحرية كاملة.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>اسم القالب *</Label>
              <Input
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                placeholder="مثال: عقد مقاول — قيشاوي هيكل خرساني"
                aria-label="اسم القالب"
              />
            </div>
            <div className="space-y-1.5">
              <Label>نوع القالب *</Label>
              <Select
                value={createForm.kind}
                onValueChange={(v) => setCreateForm({ ...createForm, kind: v as DocTemplateKind, contractTypeId: "" })}
              >
                <SelectTrigger aria-label="نوع القالب">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quotation">{KIND_LABEL.quotation}</SelectItem>
                  <SelectItem value="contract_type">{KIND_LABEL.contract_type}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {createForm.kind === "contract_type" && (
              <div className="space-y-1.5">
                <Label>نوع العقد المرتبط *</Label>
                <Select
                  value={createForm.contractTypeId}
                  onValueChange={(v) => setCreateForm({ ...createForm, contractTypeId: v })}
                >
                  <SelectTrigger aria-label="نوع العقد المرتبط">
                    <SelectValue placeholder="اختر نوع العقد…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(typesQuery.data?.types ?? []).map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  سيرث النوع مراحله وقوالب دفعاته — كتلة الدفعات تُملأ منه حصرًا.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>إلغاء</Button>
            <Button
              size="sm"
              disabled={
                createMutation.isPending ||
                !createForm.name.trim() ||
                (createForm.kind === "contract_type" && !createForm.contractTypeId)
              }
              onClick={() =>
                createMutation.mutate({
                  name: createForm.name.trim(),
                  kind: createForm.kind,
                  contractTypeId:
                    createForm.kind === "contract_type" ? Number(createForm.contractTypeId) : undefined,
                })
              }
            >
              إنشاء وفتح المصمم
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأكيد الحذف */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>حذف القالب</DialogTitle>
            <DialogDescription>
              سيُحذف «{deleteTarget?.name}» نهائيًا — لا يؤثر على العروض والعقود المولدة سلفًا.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
