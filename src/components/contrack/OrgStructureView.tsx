"use client";

/**
 * الشاشة الموحدة «الوظائف ← الإدارة ← القسم ← الوظيفة» — تغيير المالك الحرفي:
 * «هتكون الوظائف وتاني عمود الادارة وتلت عمود القسم ورابع عمود الوظيفه».
 *
 * أربعة أعمدة (2×2 على التابلت lg، متكدسة على الجوال):
 *   1) الوظائف — مكتبة المسميات الوظيفية الكاملة (قائمة jobs المرجعية) مع شارة
 *      موضع الارتباط «القسم — الإدارة» لكل مسمى، والإضافة من هنا عامة بلا ربط.
 *   2) الإدارات — بنود قائمة الإدارات المرجعية (admins)، شارة بعدد الأقسام المرتبطة.
 *   3) الأقسام — أقسام الإدارة المحددة ثم الأقسام العامة (بدون إدارة)، شارة عدد الوظائف.
 *   4) الوظيفة — وظائف القسم المحدد ثم الوظائف العامة (بدون قسم) — هنا الربط والفك.
 *
 * الارتباط اختياري عبر RefItem.parentId (org-structure-design.md D1/D3/D4) —
 * بلا أي جداول أو مسارات جديدة؛ كل الكتابة عبر مسارات القوائم المرجعية القائمة
 * (/api/ref-lists + /api/ref-lists/[id]/items + /api/ref-items/[id] + move) بحرس adminGuard.
 * حارس الحذف خادميًا: بند عليه أبناء مرتبطون لا يُحذف حتى يُفك ارتباطهم.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  BookMarked,
  Building2,
  ClipboardList,
  Link2,
  Loader2,
  Network,
  Pencil,
  Plus,
  Trash2,
  Unlink,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "./api";
import { errMessage, type User } from "./contrack-types";

// ===== أنواع الـAPI — عقد /api/ref-lists الموثق =====
interface OrgRefItem {
  id: number;
  listId: number;
  name: string;
  code: string;
  value: number | null;
  notes: string;
  active: boolean;
  sortOrder: number;
  parentId: number | null;
  childrenCount: number;
  stageLinks: { id: number; stageId: number; stageName: string; transactionType: string }[];
}
interface OrgRefList {
  id: number;
  key: string;
  name: string;
  description: string;
  system: boolean;
  active: boolean;
  items: OrgRefItem[];
}

/** نوع بند العمود — يحدد القائمة والصياغة العربية */
type OrgKind = "admins" | "departments" | "jobs";

const KIND_LABEL: Record<OrgKind, string> = {
  admins: "الإدارة",
  departments: "القسم",
  jobs: "الوظيفة",
};

interface OrgStructureViewProps {
  user: User;
  onAuthError: () => void;
  /** مُمرَّر من RefListsView لتوحيد التوست */
  onFailToast?: (e: unknown, title: string) => void;
}

export function OrgStructureView({ user, onAuthError, onFailToast }: OrgStructureViewProps) {
  const { toast } = useToast();
  const manager = user.role === "admin" || user.role === "developer";

  const onFail = React.useCallback(
    (e: unknown, title: string) => {
      if (onFailToast) {
        onFailToast(e, title);
        return;
      }
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title, description: errMessage(e) });
    },
    [onAuthError, onFailToast, toast]
  );

  // ===== البيانات — مصدر واحد: القوائم المرجعية =====
  const listsQuery = useQuery<{ lists: OrgRefList[] }>({
    queryKey: ["ref-lists"],
    queryFn: () => apiGet<{ lists: OrgRefList[] }>("/api/ref-lists"),
  });

  const adminList = listsQuery.data?.lists.find((l) => l.key === "admins") ?? null;
  const deptList = listsQuery.data?.lists.find((l) => l.key === "departments") ?? null;
  const jobList = listsQuery.data?.lists.find((l) => l.key === "jobs") ?? null;
  const directorates = adminList?.items ?? [];
  const departments = deptList?.items ?? [];
  const jobs = jobList?.items ?? [];

  // ===== الاختيار — المفتاح لظهور الأعمدة التالية (افتراضيًا أول بند كما في الشاشة الموحدة) =====
  const [selectedDirectorateId, setSelectedDirectorateId] = React.useState<number | null>(null);
  const [selectedDepartmentId, setSelectedDepartmentId] = React.useState<number | null>(null);
  const selectedDirectorate = React.useMemo(
    () => directorates.find((d) => d.id === selectedDirectorateId) ?? directorates[0] ?? null,
    [directorates, selectedDirectorateId]
  );
  const selectedDepartment = React.useMemo(
    () => departments.find((d) => d.id === selectedDepartmentId) ?? null,
    [departments, selectedDepartmentId]
  );

  // ===== تجميع الأبناء — المجموعتان: المرتبط بالمحدد ثم العام (D3) =====
  const linkedDepts = React.useMemo(
    () => (selectedDirectorate ? departments.filter((d) => d.parentId === selectedDirectorate.id) : []),
    [departments, selectedDirectorate]
  );
  const generalDepts = React.useMemo(() => departments.filter((d) => !d.parentId), [departments]);

  const deptJobs = React.useMemo(
    () => (selectedDepartment ? jobs.filter((j) => j.parentId === selectedDepartment.id) : []),
    [jobs, selectedDepartment]
  );
  const generalJobs = React.useMemo(() => jobs.filter((j) => !j.parentId), [jobs]);

  /** موضع ارتباط كل وظيفة للشارة في مكتبة العمود الأول — «القسم — الإدارة» */
  const jobPlacementById = React.useMemo(() => {
    const m = new Map<number, string>();
    for (const j of jobs) {
      if (j.parentId === null) continue;
      const dept = departments.find((d) => d.id === j.parentId);
      if (!dept) continue;
      const adm = dept.parentId ? directorates.find((a) => a.id === dept.parentId) : null;
      m.set(j.id, adm ? `${dept.name} — ${adm.name}` : dept.name);
    }
    return m;
  }, [jobs, departments, directorates]);

  const qc = useQueryClient();
  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["ref-lists"] });
  }, [qc]);

  // ======================================================================
  // طفرات الكتابة — كلها عبر مسارات القوائم المرجعية القائمة (adminGuard خلفها)
  // ======================================================================
  const [itemDialog, setItemDialog] = React.useState<{
    kind: OrgKind;
    mode: "add" | "edit";
    item?: OrgRefItem;
    /** إضافة عامة (بلا ربط بالأب المحدد) من رأس المجموعة العامة أو مكتبة الوظائف */
    general?: boolean;
  } | null>(null);
  const [itemName, setItemName] = React.useState("");
  const [itemCode, setItemCode] = React.useState("");
  const [itemNotes, setItemNotes] = React.useState("");
  const [deleteItem, setDeleteItem] = React.useState<{ kind: OrgKind; item: OrgRefItem } | null>(null);

  const openItemDialog = (
    kind: OrgKind,
    mode: "add" | "edit",
    item?: OrgRefItem,
    general?: boolean
  ) => {
    setItemName(mode === "edit" && item ? item.name : "");
    setItemCode(mode === "edit" && item ? item.code : "");
    setItemNotes(mode === "edit" && item ? item.notes : "");
    setItemDialog({ kind, mode, item, general });
  };

  /** قائمة كل نوع — لمسار الإضافة (items تُضاف عبر /api/ref-lists/[id]/items) */
  const listIdOfKind = (kind: OrgKind): number | null =>
    kind === "admins" ? adminList?.id ?? null : kind === "departments" ? deptList?.id ?? null : jobList?.id ?? null;

  /** الأب الآلي عند الإضافة من عمود أب محدد (D4) — الإضافة العامة بلا أب */
  const autoParentForAdd = (kind: OrgKind, general?: boolean): number | null => {
    if (general) return null;
    if (kind === "departments") return selectedDirectorate?.id ?? null;
    if (kind === "jobs") return selectedDepartment?.id ?? null;
    return null;
  };

  const saveItemMutation = useMutation({
    mutationFn: () => {
      const kind = itemDialog?.kind;
      if (!kind) throw new Error("نوع البند مفقود");
      const name = itemName.trim();
      if (!name) throw new Error(`اسم ${KIND_LABEL[kind]} مطلوب`);
      const listId = listIdOfKind(kind);
      if (!listId) throw new Error("القائمة المرجعية غير موجودة");
      const common = { name, code: itemCode.trim(), notes: itemNotes.trim() };
      if (itemDialog?.mode === "edit" && itemDialog.item) {
        return apiPatch(`/api/ref-items/${itemDialog.item.id}`, common);
      }
      return apiPost(`/api/ref-lists/${listId}/items`, {
        ...common,
        parentId: autoParentForAdd(kind, itemDialog?.general),
      });
    },
    onSuccess: () => {
      invalidate();
      const kind = itemDialog?.kind;
      setItemDialog(null);
      toast({ title: itemDialog?.mode === "edit" ? `تم تعديل ${kind ? KIND_LABEL[kind] : "البند"}` : "تمت الإضافة والربط" });
    },
    onError: (e: unknown) => onFail(e, "تعذر حفظ البند"),
  });

  const deleteItemMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/ref-items/${id}`),
    onSuccess: () => {
      setDeleteItem(null);
      invalidate();
      toast({ title: "تم حذف البند" });
    },
    onError: (e: unknown) => {
      setDeleteItem(null);
      onFail(e, "تعذر حذف البند");
    },
  });

  const moveItemMutation = useMutation({
    mutationFn: ({ id, dir }: { id: number; dir: "up" | "down" }) =>
      apiPost(`/api/ref-items/${id}/move`, { dir }),
    onSuccess: () => invalidate(),
    onError: (e: unknown) => onFail(e, "تعذر الترتيب"),
  });

  /** ربط بند عام بالمحدد من العمود الأب / فك الارتباط — PATCH parentId (D4) */
  const linkMutation = useMutation({
    mutationFn: ({ id, parentId }: { id: number; parentId: number | null }) =>
      apiPatch(`/api/ref-items/${id}`, { parentId }),
    onSuccess: (_res, vars) => {
      invalidate();
      toast({ title: vars.parentId === null ? "تم فك الارتباط — البند صار عامًا" : "تم الربط بالمحدد" });
    },
    onError: (e: unknown) => onFail(e, "تعذر تحديث الارتباط"),
  });

  const busy = saveItemMutation.isPending || deleteItemMutation.isPending || linkMutation.isPending;

  // ======================================================================
  // صف بند موحد — نمطان: مكتبة (بلا تحديد + شارة موضع الارتباط) واعتيادي (اختيار/ربط)
  // ======================================================================
  const renderRow = (
    it: OrgRefItem,
    kind: OrgKind,
    opts: {
      selected?: boolean;
      onSelect?: () => void;
      parentSelected?: boolean;
      parentLabel?: string;
      /** نمط مكتبة الوظائف (العمود الأول) — بلا تحديد وبشارة موضع الارتباط */
      library?: boolean;
    }
  ) => {
    const placement = opts.library ? jobPlacementById.get(it.id) ?? null : null;
    return (
      <li key={it.id}>
        <div
          {...(opts.library
            ? {}
            : {
                role: "button",
                tabIndex: 0,
                "aria-pressed": opts.selected ?? false,
                onClick: opts.onSelect,
                onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    opts.onSelect?.();
                  }
                },
              })}
          className={`flex w-full flex-col gap-1 rounded-lg border px-3 py-2 transition-colors ${
            opts.library ? "cursor-default" : "cursor-pointer"
          } ${!opts.library && opts.selected ? "border-primary/60 bg-primary/10" : "hover:bg-muted/60"}`}
        >
          <span className="flex w-full items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={it.name}>
              {it.name}
            </span>
            {!it.active && <Badge variant="secondary" className="text-[10px]">معطّل</Badge>}
            {opts.library && placement && (
              <Badge variant="outline" className="text-[10px] shrink-0 max-w-[55%]" title={`مرتبطة بـ${placement}`}>
                <span className="truncate">← {placement}</span>
              </Badge>
            )}
            {!opts.library && it.parentId !== null && kind !== "admins" && (
              <Badge variant="outline" className="text-[10px] shrink-0">مرتبط</Badge>
            )}
          </span>
          <span className="flex w-full items-center gap-2 text-[11px] text-muted-foreground">
            {it.code ? <span className="numeric truncate" dir="ltr">{it.code}</span> : null}
            <span className="numeric ms-auto">
              {kind === "admins"
                ? `${it.childrenCount} قسم`
                : kind === "departments"
                  ? `${it.childrenCount} وظيفة`
                  : ""}
            </span>
            {manager && (
              <span className="flex items-center gap-0.5 shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  aria-label={`تحريك ${it.name} لأعلى`}
                  disabled={moveItemMutation.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    moveItemMutation.mutate({ id: it.id, dir: "up" });
                  }}
                >
                  <ArrowUp className="size-3.5" aria-hidden />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  aria-label={`تحريك ${it.name} لأسفل`}
                  disabled={moveItemMutation.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    moveItemMutation.mutate({ id: it.id, dir: "down" });
                  }}
                >
                  <ArrowDown className="size-3.5" aria-hidden />
                </Button>
                {!opts.library && kind !== "admins" && (
                  it.parentId === null && opts.parentSelected ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 text-primary hover:text-primary"
                      aria-label={`ربط ${it.name} بـ${opts.parentLabel ?? KIND_LABEL[kind]}`}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        const parentId = kind === "departments" ? selectedDirectorate?.id : selectedDepartment?.id;
                        if (parentId) linkMutation.mutate({ id: it.id, parentId });
                      }}
                    >
                      <Link2 className="size-3.5" aria-hidden />
                    </Button>
                  ) : it.parentId !== null ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      aria-label={`فك ربط ${it.name}`}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        linkMutation.mutate({ id: it.id, parentId: null });
                      }}
                    >
                      <Unlink className="size-3.5" aria-hidden />
                    </Button>
                  ) : null
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  aria-label={`تعديل ${it.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    openItemDialog(kind, "edit", it);
                  }}
                >
                  <Pencil className="size-3.5" aria-hidden />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 text-destructive hover:text-destructive"
                  aria-label={`حذف ${it.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteItem({ kind, item: it });
                  }}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </span>
            )}
          </span>
        </div>
      </li>
    );
  };

  /** رأس مجموعة داخل عمود — عنوان + (للمجموعة العامة) زر إضافة عامة */
  const renderGroupHeader = (title: string, kind?: OrgKind, general?: boolean) => (
    <div className="flex items-center justify-between gap-2 pb-1">
      <p className="text-xs font-bold text-muted-foreground">{title}</p>
      {manager && general && kind && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-[11px]"
          onClick={() => openItemDialog(kind, "add", undefined, true)}
        >
          <Plus className="size-3" aria-hidden />
          إضافة عامة
        </Button>
      )}
    </div>
  );

  const emptyBox = (msg: string) => (
    <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">{msg}</p>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold whitespace-nowrap">الوظائف والإدارات والأقسام</h1>
        <span className="hidden xl:inline text-xs text-muted-foreground">
          مكتبة الوظائف ← الإدارة ← القسم ← الوظيفة — الارتباط اختياري والأبناء يمنعون الحذف
        </span>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {/* ============ العمود 1: الوظائف — مكتبة المسميات ============ */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <BookMarked className="size-4 text-primary" aria-hidden />
              الوظائف
              <span className="numeric text-xs font-normal text-muted-foreground">({jobs.length})</span>
            </CardTitle>
            {manager && (
              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => openItemDialog("jobs", "add", undefined, true)}>
                <Plus className="size-3.5" aria-hidden />
                إضافة وظيفة
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {listsQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded-lg" />
                ))}
              </div>
            ) : listsQuery.isError ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                تعذر تحميل القوائم — {errMessage(listsQuery.error)}
              </p>
            ) : jobs.length === 0 ? (
              emptyBox(manager ? "لا وظائف بعد — أضف أول مسمى وظيفي بالزر أعلى" : "لا وظائف بعد")
            ) : (
              <ul className="max-h-96 space-y-1.5 overflow-y-auto pe-1" aria-label="مكتبة الوظائف">
                {jobs.map((j) =>
                  renderRow(j, "jobs", { library: true })
                )}
              </ul>
            )}
            <p className="mt-3 rounded-lg border border-dashed p-2.5 text-[11px] leading-5 text-muted-foreground">
              هذه مكتبة كل المسميات الوظيفية — شارة «←» تُظهر موضع الارتباط (القسم — الإدارة).
              لربط وظيفة بقسم: اختر الإدارة ثم القسم من العمودين التاليين ثم استخدم عمود «الوظيفة».
            </p>
          </CardContent>
        </Card>

        {/* ============ العمود 2: الإدارات ============ */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <Building2 className="size-4 text-primary" aria-hidden />
              الإدارات
            </CardTitle>
            {manager && (
              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => openItemDialog("admins", "add")}>
                <Plus className="size-3.5" aria-hidden />
                إضافة
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {listsQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded-lg" />
                ))}
              </div>
            ) : directorates.length === 0 ? (
              emptyBox(manager ? "لا إدارات بعد — أضف أول إدارة بالزر أعلى" : "لا إدارات بعد")
            ) : (
              <ul className="max-h-96 space-y-1.5 overflow-y-auto pe-1" aria-label="قائمة الإدارات">
                {directorates.map((d) =>
                  renderRow(d, "admins", {
                    selected: selectedDirectorate?.id === d.id,
                    onSelect: () => {
                      setSelectedDirectorateId(d.id);
                      setSelectedDepartmentId(null);
                    },
                  })
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ============ العمود 3: الأقسام (المرتبطة + العامة) ============ */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <Network className="size-4 text-primary" aria-hidden />
              الأقسام
              {selectedDirectorate && (
                <span className="truncate font-normal text-muted-foreground" title={selectedDirectorate.name}>
                  — {selectedDirectorate.name}
                </span>
              )}
            </CardTitle>
            {manager && (
              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => openItemDialog("departments", "add")}>
                <Plus className="size-3.5" aria-hidden />
                {selectedDirectorate ? "قسم للإدارة" : "قسم"}
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {listsQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-11 rounded-lg" />
                ))}
              </div>
            ) : departments.length === 0 ? (
              emptyBox(manager ? "لا أقسام بعد — أضف أول قسم بالزر أعلى" : "لا أقسام بعد")
            ) : (
              <>
                {selectedDirectorate && (
                  <div className="space-y-1.5">
                    {renderGroupHeader(`أقسام «${selectedDirectorate.name}»`)}
                    {linkedDepts.length === 0 ? (
                      <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                        لا أقسام مرتبطة بهذه الإدارة بعد — أضف قسمًا جديدًا أو اربط قسمًا عامًا بأيقونة الرابط
                      </p>
                    ) : (
                      <ul className="max-h-72 space-y-1.5 overflow-y-auto pe-1" aria-label="أقسام الإدارة المحددة">
                        {linkedDepts.map((d) =>
                          renderRow(d, "departments", {
                            selected: selectedDepartment?.id === d.id,
                            onSelect: () => {
                              setSelectedDepartmentId(d.id);
                            },
                            parentSelected: Boolean(selectedDirectorate),
                            parentLabel: selectedDirectorate.name,
                          })
                        )}
                      </ul>
                    )}
                  </div>
                )}
                <div className={`space-y-1.5 ${selectedDirectorate ? "border-t pt-3" : ""}`}>
                  {renderGroupHeader("أقسام عامة (بدون إدارة)", "departments", true)}
                  {generalDepts.length === 0 ? (
                    <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                      لا أقسام عامة — كل الأقسام مرتبطة بإداراتها
                    </p>
                  ) : (
                    <ul className="max-h-72 space-y-1.5 overflow-y-auto pe-1" aria-label="الأقسام العامة">
                      {generalDepts.map((d) =>
                        renderRow(d, "departments", {
                          selected: selectedDepartment?.id === d.id,
                          onSelect: () => setSelectedDepartmentId(d.id),
                          parentSelected: Boolean(selectedDirectorate),
                          parentLabel: selectedDirectorate?.name,
                        })
                      )}
                    </ul>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* ============ العمود 4: الوظيفة (وظائف القسم + العامة) ============ */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <ClipboardList className="size-4 text-primary" aria-hidden />
              الوظيفة
              {selectedDepartment && (
                <span className="truncate font-normal text-muted-foreground" title={selectedDepartment.name}>
                  — {selectedDepartment.name}
                </span>
              )}
            </CardTitle>
            {manager && (
              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => openItemDialog("jobs", "add")}>
                <Plus className="size-3.5" aria-hidden />
                {selectedDepartment ? "وظيفة للقسم" : "وظيفة"}
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {listsQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-11 rounded-lg" />
                ))}
              </div>
            ) : jobs.length === 0 ? (
              emptyBox(manager ? "لا وظائف بعد — أضف أول وظيفة من مكتبة «الوظائف»" : "لا وظائف بعد")
            ) : !selectedDepartment ? (
              <>
                <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                  اختر قسمًا من عمود «الأقسام» لعرض وظائفه وربط وظائف جديدة به — الوظائف العامة تظهر أدناه
                </p>
                <div className="space-y-1.5">
                  {renderGroupHeader("وظائف عامة (بدون قسم)", "jobs", true)}
                  {generalJobs.length === 0 ? (
                    <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                      لا وظائف عامة
                    </p>
                  ) : (
                    <ul className="max-h-72 space-y-1.5 overflow-y-auto pe-1" aria-label="الوظائف العامة">
                      {generalJobs.map((j) =>
                        renderRow(j, "jobs", { parentSelected: false })
                      )}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  {renderGroupHeader(`وظائف «${selectedDepartment.name}»`)}
                  {deptJobs.length === 0 ? (
                    <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                      لا وظائف مرتبطة بهذا القسم بعد — أضف وظيفة جديدة أو اربط وظيفة عامة بأيقونة الرابط
                    </p>
                  ) : (
                    <ul className="max-h-72 space-y-1.5 overflow-y-auto pe-1" aria-label="وظائف القسم المحدد">
                      {deptJobs.map((j) =>
                        renderRow(j, "jobs", {
                          parentSelected: Boolean(selectedDepartment),
                          parentLabel: selectedDepartment.name,
                        })
                      )}
                    </ul>
                  )}
                </div>
                <div className="space-y-1.5 border-t pt-3">
                  {renderGroupHeader("وظائف عامة (بدون قسم)", "jobs", true)}
                  {generalJobs.length === 0 ? (
                    <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                      لا وظائف عامة — كل الوظائف مرتبطة بأقسامها
                    </p>
                  ) : (
                    <ul className="max-h-72 space-y-1.5 overflow-y-auto pe-1" aria-label="الوظائف العامة">
                      {generalJobs.map((j) =>
                        renderRow(j, "jobs", {
                          parentSelected: Boolean(selectedDepartment),
                          parentLabel: selectedDepartment.name,
                        })
                      )}
                    </ul>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ================== نافذة إضافة/تعديل البند ================== */}
      <Dialog open={itemDialog !== null} onOpenChange={(o) => !o && setItemDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {itemDialog?.mode === "edit"
                ? `تعديل ${itemDialog.kind ? KIND_LABEL[itemDialog.kind] : "البند"}`
                : itemDialog?.general
                  ? `إضافة ${itemDialog.kind === "jobs" ? "وظيفة جديدة (بدون ربط)" : `${itemDialog.kind ? KIND_LABEL[itemDialog.kind] : "بند"} عامة (بدون ربط)`}`
                  : `إضافة ${itemDialog?.kind === "departments" && selectedDirectorate ? `قسم إلى «${selectedDirectorate.name}»` : itemDialog?.kind === "jobs" && selectedDepartment ? `وظيفة إلى «${selectedDepartment.name}»` : itemDialog?.kind ? KIND_LABEL[itemDialog.kind] : "بند"}`}
            </DialogTitle>
            <DialogDescription>
              {itemDialog?.kind === "admins"
                ? "الإدارات هي قمة الهيكل — الأقسام تُربط بها من عمود «الأقسام»."
                : itemDialog?.kind === "departments"
                  ? itemDialog?.general || !selectedDirectorate
                    ? "قسم عام بلا إدارة — يمكنك ربطه لاحقًا بأيقونة الرابط."
                    : "سيُربط القسم آلياً بالإدارة المحددة، ويمكن فك الارتباط لاحقاً."
                  : itemDialog?.general || !selectedDepartment
                    ? "وظيفة بلا قسم — تظهر في مكتبة «الوظائف» ويمكن ربطها لاحقًا من عمود «الوظيفة»."
                    : "ستُربط الوظيفة آلياً بالقسم المحدد، ويمكن فك الارتباط لاحقاً."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="org-item-name">الاسم</Label>
              <Input
                id="org-item-name"
                className="h-10"
                placeholder={itemDialog?.kind === "admins" ? "مثال: الإدارة الهندسية" : itemDialog?.kind === "departments" ? "مثال: قسم الإنشاءات" : "مثال: مهندس موقع"}
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-item-code">الرمز (اختياري)</Label>
              <Input
                id="org-item-code"
                className="h-10"
                dir="ltr"
                placeholder="ENG / CONST / SITE-ENG"
                value={itemCode}
                onChange={(e) => setItemCode(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-item-notes">ملاحظات (اختياري)</Label>
              <Input
                id="org-item-notes"
                className="h-10"
                value={itemNotes}
                onChange={(e) => setItemNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-10" onClick={() => setItemDialog(null)} disabled={saveItemMutation.isPending}>
              إلغاء
            </Button>
            <Button className="h-10" disabled={saveItemMutation.isPending} onClick={() => saveItemMutation.mutate()}>
              {saveItemMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              {itemDialog?.mode === "edit" ? "حفظ التعديلات" : "إضافة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================== نافذة تأكيد الحذف ================== */}
      <Dialog open={deleteItem !== null} onOpenChange={(o) => !o && setDeleteItem(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>حذف {deleteItem ? KIND_LABEL[deleteItem.kind] : "البند"}</DialogTitle>
            <DialogDescription>
              حذف «{deleteItem?.item.name}» من القائمة المرجعية؟ إن كان عليه أقسام أو وظائف مرتبطة
              فسيُرفض الحذف — فُكّ ارتباطها أولًا.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-10" onClick={() => setDeleteItem(null)}>إلغاء</Button>
            <Button
              variant="destructive"
              className="h-10"
              disabled={deleteItemMutation.isPending}
              onClick={() => deleteItem && deleteItemMutation.mutate(deleteItem.item.id)}
            >
              {deleteItemMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
