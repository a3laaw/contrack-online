"use client";

/**
 * شاشة القوائم المرجعية (الجلسة 11) — مركز البيانات المرجعية بثلاثة أقسام:
 *   1) القوائم العامة: إطار عام قابل للتوسعة — الأوزان · المناطق · الوظائف · الأقسام ·
 *      الإدارات مدمجة (لا تُحذف)، وأي قائمة يضيفها المالك («وغيرها») مع بنودها
 *      قابلة للإضافة والتعديل والترتيب والإيقاف والحذف.
 *   2) ربطها مع مراحل العمل: كل بند يُربط بمراحل متعددة (RefItemStage) من شجرة
 *      مراحل التنفيذ القائمة — والمراحل نفسها تُدار من القسم الثالث.
 *   3) أنواع العقود ومراحل العمل: تضمين المدرّين القائمين حرفيًا (بلا أي هجرة)
 *      كي يكون المكان موحّدًا لكل المرجعيات.
 * الأسلاك: /api/ref-lists + /api/ref-lists/[id] + /api/ref-lists/[id]/items +
 *          /api/ref-items/[id] + /api/ref-items/[id]/move — الكتابة للمدير فقط.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "./api";
import { errMessage, type User } from "./contrack-types";
import { ContractTypesManager } from "./ContractTypesManager";
import { OrgStructureView } from "./OrgStructureView";
import { AreasStructureView } from "./AreasStructureView";
import { TypesStagesPaymentsView } from "./TypesStagesPaymentsView";
import { WorkflowTab } from "./settings/workflow-tab";

export type RefListsSection = "types-stages-payments" | "org-structure" | "areas" | "lists" | "contract-types" | "stages";

// ===== أنواع الـAPI — عقد /api/ref-lists الموثق =====
interface RefStageLink {
  id: number;
  stageId: number;
  stageName: string;
  transactionType: string;
}
interface RefItemDTO {
  id: number;
  listId: number;
  name: string;
  code: string;
  value: number | null;
  notes: string;
  active: boolean;
  sortOrder: number;
  stageLinks: RefStageLink[];
}
interface RefListDTO {
  id: number;
  key: string;
  name: string;
  description: string;
  system: boolean;
  active: boolean;
  items: RefItemDTO[];
}
interface RefListsResponse {
  lists: RefListDTO[];
}
interface RefStageDTO {
  id: number;
  transactionType: string;
  stageName: string;
  stageOrder: number;
}

/** تسمية أنواع المعاملة في شجرة المراحل — للعرض داخل مجمّع الاختيار */
const TX_LABEL: Record<string, string> = {
  contract: "مراحل العقود",
  payment: "مراحل الدفعات",
  subcontract: "مراحل الباطن",
  customer: "مراحل العملاء",
};

interface RefListsViewProps {
  user: User;
  onAuthError: () => void;
  /** القسم المبدئي من القائمة الجانبية (lists/contract-types/stages) */
  section?: RefListsSection;
  onSectionChange?: (s: RefListsSection) => void;
}

export function RefListsView({ user, onAuthError, section = "lists", onSectionChange }: RefListsViewProps) {
  const { toast } = useToast();
  // النمط الموحد عبر الشاشات: خطأ 401 ⇒ خروج للدخول، وغيره ⇒ توست بالرسالة العربية
  const onFail = React.useCallback(
    (e: unknown, title: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title, description: errMessage(e) });
    },
    [onAuthError, toast]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold whitespace-nowrap">القوائم المرجعية</h1>
        <span className="hidden xl:inline text-xs text-muted-foreground">
          الأوزان · المناطق · الوظائف · الأقسام · الإدارات · أنواع العقود — إضافة وتعديل وربط بمراحل العمل، وقوائم جديدة وقتما تحتاج
        </span>
      </div>

      {/* الجلسة 14 — قرار المالك: القائمة الجانبية هي الملاحّ الوحيد — بلا شريط تبويبات داخلي */}
      <Tabs value={section} onValueChange={(v) => onSectionChange?.(v as RefListsSection)} className="gap-4">

        {/* الشاشة الموحدة — قرار المالك: أنواع العقود ومراحل العمل والدفعات كلها في صفحة واحدة */}
        <TabsContent value="types-stages-payments" className="space-y-4">
          <TypesStagesPaymentsView user={user} onAuthError={onAuthError} onFailToast={onFail} />
        </TabsContent>

        {/* الشاشة الموحدة الثانية — تغيير المالك: الوظائف والإدارة والقسم والوظيفة في أربعة أعمدة مترابطة */}
        <TabsContent value="org-structure" className="space-y-4">
          <OrgStructureView user={user} onAuthError={onAuthError} onFailToast={onFail} />
        </TabsContent>

        {/* الشاشة الموحدة الثالثة — قرار المالك: المناطق هرمية المحافظة ← المدينة ← المنطقة */}
        <TabsContent value="areas" className="space-y-4">
          <AreasStructureView user={user} onAuthError={onAuthError} onFailToast={onFail} />
        </TabsContent>

        <TabsContent value="lists" className="space-y-4">
          <ListsPanel user={user} onFail={onFail} />
        </TabsContent>

        {/* أنواع العقود — المدرّ القائم حرفيًا (بلا هجرة) داخل الموضع الموحد */}
        <TabsContent value="contract-types" className="space-y-4">
          <p className="text-xs text-muted-foreground">
            أنواع العقود وقوالب دفعها ومكوّناتها — تُدار هنا كما في الإعدادات تمامًا، وهي المرجع المستخدم في إنشاء العقود.
          </p>
          <ContractTypesManager onAuthError={onAuthError} />
        </TabsContent>

        {/* مراحل العمل — تبويب مراحل المتابعة القائم: مصدر المراحل التي تُربط بها البنود */}
        <TabsContent value="stages" className="space-y-4">
          <p className="text-xs text-muted-foreground">
            شجرة مراحل التنفيذ لكل نوع معاملة — المراحل هنا هي التي تُربط بها بنود القوائم المرجعية من قسم «القوائم العامة».
          </p>
          <WorkflowTab onAuthError={onAuthError} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ====================================================================
// قسم القوائم العامة — لوحة القوائم (يمين) وبنود القائمة المحددة (يسار)
// ====================================================================

function ListsPanel({
  user,
  onFail,
}: {
  user: User;
  onFail: (e: unknown, title: string) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = user.role === "admin" || user.role === "developer";

  const listsQuery = useQuery<RefListsResponse>({
    queryKey: ["ref-lists"],
    queryFn: () => apiGet<RefListsResponse>("/api/ref-lists"),
  });
  const stagesQuery = useQuery<{ stages: RefStageDTO[] }>({
    queryKey: ["workflow-stages"],
    queryFn: () => apiGet<{ stages: RefStageDTO[] }>("/api/workflow-stages"),
  });

  const lists = listsQuery.data?.lists ?? [];
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const selected = React.useMemo(
    () => lists.find((l) => l.id === selectedId) ?? lists[0] ?? null,
    [lists, selectedId]
  );

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["ref-lists"] });
  }, [qc]);

  // ===== نوافذ القائمة =====
  const [newListOpen, setNewListOpen] = React.useState(false);
  const [renameList, setRenameList] = React.useState<RefListDTO | null>(null);
  const [confirmDeleteList, setConfirmDeleteList] = React.useState<RefListDTO | null>(null);

  // ===== نوافذ البنود =====
  const [itemDialog, setItemDialog] = React.useState<{ mode: "add"; listId: number } | { mode: "edit"; item: RefItemDTO } | null>(null);
  const [confirmDeleteItem, setConfirmDeleteItem] = React.useState<RefItemDTO | null>(null);

  const deleteListMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/ref-lists/${id}`),
    onSuccess: () => {
      setSelectedId(null);
      setConfirmDeleteList(null);
      invalidate();
      toast({ title: "تم حذف القائمة ببنودها" });
    },
    onError: (e) => onFail(e, "تعذر حذف القائمة"),
  });

  const deleteItemMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/ref-items/${id}`),
    onSuccess: () => {
      setConfirmDeleteItem(null);
      invalidate();
      toast({ title: "تم حذف البند" });
    },
    onError: (e) => onFail(e, "تعذر حذف البند"),
  });

  const toggleItemMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      apiPatch(`/api/ref-items/${id}`, { active }),
    onSuccess: invalidate,
    onError: (e) => onFail(e, "تعذر تغيير حالة البند"),
  });

  const moveItemMutation = useMutation({
    mutationFn: ({ id, dir }: { id: number; dir: "up" | "down" }) =>
      apiPost(`/api/ref-items/${id}/move`, { dir }),
    onSuccess: invalidate,
    onError: (e) => onFail(e, "تعذر ترتيب البند"),
  });

  if (!manager) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">إدارة القوائم المرجعية للمدير فقط</CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr] items-start">
      {/* ===== لوحة القوائم ===== */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">القوائم</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {listsQuery.isLoading && <p className="text-xs text-muted-foreground">جارٍ التحميل…</p>}
          {lists.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setSelectedId(l.id)}
              className={`w-full text-start rounded-lg border px-3 py-2 transition-colors ${
                selected?.id === l.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">{l.name}</span>
                <Badge variant="outline" className="shrink-0">{l.items.length}</Badge>
              </span>
              <span className="mt-1 flex items-center gap-1.5">
                {l.system ? (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">مدمجة</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">مخصصة</Badge>
                )}
                {!l.active && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">موقوفة</Badge>}
              </span>
            </button>
          ))}
          <Button variant="outline" size="sm" className="w-full mt-2" onClick={() => setNewListOpen(true)}>
            <Plus className="size-4 me-1.5" />
            قائمة جديدة
          </Button>
        </CardContent>
      </Card>

      {/* ===== بنود القائمة المحددة ===== */}
      {selected && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="truncate">{selected.name}</span>
                  {selected.system ? (
                    <Badge variant="secondary" className="shrink-0">قائمة مدمجة</Badge>
                  ) : (
                    <Badge variant="outline" className="shrink-0">مخصصة</Badge>
                  )}
                </CardTitle>
                {selected.description && (
                  <p className="text-xs text-muted-foreground mt-1">{selected.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setRenameList(selected)}>
                  <Pencil className="size-3.5 me-1.5" />
                  تعديل القائمة
                </Button>
                {!selected.system && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirmDeleteList(selected)}
                  >
                    <Trash2 className="size-3.5 me-1.5" />
                    حذف القائمة
                  </Button>
                )}
                <Button size="sm" onClick={() => setItemDialog({ mode: "add", listId: selected.id })}>
                  <Plus className="size-4 me-1.5" />
                  إضافة بند
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {selected.items.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                لا بنود بعد — أضف أول بند إلى «{selected.name}»
              </p>
            ) : (
              <div className="max-h-[480px] overflow-y-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                    <tr className="text-start">
                      <th className="px-2 py-2 text-xs font-medium w-16">الترتيب</th>
                      <th className="px-2 py-2 text-xs font-medium text-start">الاسم</th>
                      <th className="px-2 py-2 text-xs font-medium text-start w-24">الرمز</th>
                      <th className="px-2 py-2 text-xs font-medium text-start w-20">القيمة</th>
                      <th className="px-2 py-2 text-xs font-medium text-start">المراحل المرتبطة</th>
                      <th className="px-2 py-2 text-xs font-medium text-start w-24">الحالة</th>
                      <th className="px-2 py-2 text-xs font-medium text-start w-20">أدوات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.items.map((it, idx) => (
                      <tr key={it.id} className="border-t border-border/70 align-middle">
                        <td className="px-2 py-1.5">
                          <span className="inline-flex items-center gap-0.5">
                            <Button
                              variant="ghost" size="icon" aria-label="تحريك أعلى"
                              className="size-6"
                              disabled={idx === 0 || moveItemMutation.isPending}
                              onClick={() => moveItemMutation.mutate({ id: it.id, dir: "up" })}
                            >
                              <ArrowUp className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost" size="icon" aria-label="تحريك أسفل"
                              className="size-6"
                              disabled={idx === selected.items.length - 1 || moveItemMutation.isPending}
                              onClick={() => moveItemMutation.mutate({ id: it.id, dir: "down" })}
                            >
                              <ArrowDown className="size-3.5" />
                            </Button>
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="font-medium">{it.name}</span>
                          {it.notes && <span className="block text-xs text-muted-foreground">{it.notes}</span>}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">{it.code || "—"}</td>
                        <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{it.value ?? "—"}</td>
                        <td className="px-2 py-1.5">
                          {it.stageLinks.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <span className="flex flex-wrap gap-1">
                              {it.stageLinks.slice(0, 3).map((sl) => (
                                <Badge key={sl.id} variant="secondary" className="text-[10px] px-1.5 py-0 max-w-36 truncate">
                                  {sl.stageName}
                                </Badge>
                              ))}
                              {it.stageLinks.length > 3 && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                  +{it.stageLinks.length - 3}
                                </Badge>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <Switch
                            checked={it.active}
                            aria-label={`تفعيل ${it.name}`}
                            disabled={toggleItemMutation.isPending}
                            onCheckedChange={(v) => toggleItemMutation.mutate({ id: it.id, active: v })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="inline-flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="size-7" aria-label={`تعديل ${it.name}`} onClick={() => setItemDialog({ mode: "edit", item: it })}>
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive"
                              aria-label={`حذف ${it.name}`}
                              onClick={() => setConfirmDeleteItem(it)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===== نوافذ ===== */}
      <NewListDialog open={newListOpen} onOpenChange={setNewListOpen} onFail={onFail} onDone={invalidate} />
      <RenameListDialog list={renameList} onClose={() => setRenameList(null)} onFail={onFail} onDone={invalidate} />
      <ItemDialog
        state={itemDialog}
        onClose={() => setItemDialog(null)}
        stages={stagesQuery.data?.stages ?? []}
        stagesLoading={stagesQuery.isLoading}
        onFail={onFail}
        onDone={invalidate}
      />

      <AlertDialog open={!!confirmDeleteList} onOpenChange={(o) => !o && setConfirmDeleteList(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف القائمة؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف «{confirmDeleteList?.name}» بكل بنودها وروابط مراحلها. لا يمكن الرجوع بعد الحذف.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDeleteList && deleteListMutation.mutate(confirmDeleteList.id)}
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmDeleteItem} onOpenChange={(o) => !o && setConfirmDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف البند؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف «{confirmDeleteItem?.name}» من القائمة مع روابط مراحله.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDeleteItem && deleteItemMutation.mutate(confirmDeleteItem.id)}
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ====================================================================
// نوافذ القوائم — إنشاء/تسمية + بند (إضافة/تعديل مع ربط المراحل)
// ====================================================================

function NewListDialog({
  open,
  onOpenChange,
  onFail,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onFail: (e: unknown, title: string) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");

  const createMutation = useMutation({
    mutationFn: () => apiPost("/api/ref-lists", { name, description }),
    onSuccess: (res: { list?: RefListDTO }) => {
      onOpenChange(false);
      setName("");
      setDescription("");
      if (res?.list) onDone();
      toast({ title: "تم إنشاء القائمة", description: "أضف بنودها الآن من اللوحة" });
    },
    onError: (e) => onFail(e, "تعذر إنشاء القائمة"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>قائمة مرجعية جديدة</DialogTitle>
          <DialogDescription>أي قائمة تنشئها هنا تظهر لبند القوائم العامة — مثل الأوزان والمناطق تمامًا.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ref-list-name">اسم القائمة *</Label>
            <Input
              id="ref-list-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: مصادر العملاء · أنواع الضمانات"
              maxLength={60}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ref-list-desc">الوصف</Label>
            <Textarea
              id="ref-list-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="ماذا تحتوي هذه القائمة؟"
              rows={2}
              maxLength={200}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button disabled={!name.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
            إنشاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameListDialog({
  list,
  onClose,
  onFail,
  onDone,
}: {
  list: RefListDTO | null;
  onClose: () => void;
  onFail: (e: unknown, title: string) => void;
  onDone: () => void;
}) {
  // النافذة الداخلية تُركَّب بمفتاح القائمة — فتُهيّئ حالتها من خصائصها بلا أي مزامنة وقت الرسم
  return (
    <Dialog open={!!list} onOpenChange={(o) => !o && onClose()}>
      {list && <RenameListForm key={list.id} list={list} onClose={onClose} onFail={onFail} onDone={onDone} />}
    </Dialog>
  );
}

function RenameListForm({
  list,
  onClose,
  onFail,
  onDone,
}: {
  list: RefListDTO;
  onClose: () => void;
  onFail: (e: unknown, title: string) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState(list.name);
  const [description, setDescription] = React.useState(list.description);

  const patchMutation = useMutation({
    mutationFn: (data: { name?: string; description?: string }) =>
      apiPatch(`/api/ref-lists/${list.id}`, data),
    onSuccess: () => {
      onClose();
      onDone();
      toast({ title: "تم تعديل القائمة" });
    },
    onError: (e) => onFail(e, "تعذر تعديل القائمة"),
  });

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>تعديل القائمة</DialogTitle>
        <DialogDescription>
          {list.system ? "قائمة مدمجة — الاسم والوصف قابلان للتعديل ولا يمكن حذفها." : "الاسم والوصف قابلان للتعديل."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="ref-rename-name">اسم القائمة *</Label>
          <Input id="ref-rename-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ref-rename-desc">الوصف</Label>
          <Textarea id="ref-rename-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={200} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>إلغاء</Button>
        <Button disabled={!name.trim() || patchMutation.isPending} onClick={() => patchMutation.mutate({ name: name.trim(), description })}>
          حفظ
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ItemDialog({
  state,
  onClose,
  stages,
  stagesLoading,
  onFail,
  onDone,
}: {
  state: { mode: "add"; listId: number } | { mode: "edit"; item: RefItemDTO } | null;
  onClose: () => void;
  stages: RefStageDTO[];
  stagesLoading: boolean;
  onFail: (e: unknown, title: string) => void;
  onDone: () => void;
}) {
  // النافذة الداخلية تُركَّب بمفتاح فريد للهدف (بند للتعديل أو قائمة للإضافة) — فتُهيّئ من خصائصها بلا مزامنة وقت الرسم
  const openKey = state ? (state.mode === "edit" ? `edit-${state.item.id}` : `add-${state.listId}`) : "";
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      {state && (
        <ItemForm
          key={openKey}
          state={state}
          stages={stages}
          stagesLoading={stagesLoading}
          onClose={onClose}
          onFail={onFail}
          onDone={onDone}
        />
      )}
    </Dialog>
  );
}

function ItemForm({
  state,
  onClose,
  stages,
  stagesLoading,
  onFail,
  onDone,
}: {
  state: { mode: "add"; listId: number } | { mode: "edit"; item: RefItemDTO };
  onClose: () => void;
  stages: RefStageDTO[];
  stagesLoading: boolean;
  onFail: (e: unknown, title: string) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const editing = state.mode === "edit" ? state.item : null;

  // التهيئة من الخصائص مرة واحدة عند التركيب (المفتاح يضمن إعادة التركيب لكل هدف جديد)
  const [name, setName] = React.useState(editing?.name ?? "");
  const [code, setCode] = React.useState(editing?.code ?? "");
  const [value, setValue] = React.useState(editing?.value === null || editing?.value === undefined ? "" : String(editing.value));
  const [notes, setNotes] = React.useState(editing?.notes ?? "");
  const [stageIds, setStageIds] = React.useState<Set<number>>(
    () => new Set(editing ? editing.stageLinks.map((l) => l.stageId) : [])
  );

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      state.mode === "edit"
        ? apiPatch(`/api/ref-items/${state.item.id}`, payload)
        : apiPost(`/api/ref-lists/${state.listId}/items`, payload),
    onSuccess: () => {
      onClose();
      onDone();
      toast({ title: state.mode === "edit" ? "تم تعديل البند" : "تمت إضافة البند" });
    },
    onError: (e) => onFail(e, "تعذر حفظ البند"),
  });

  const grouped = React.useMemo(() => {
    const order = ["contract", "payment", "subcontract", "customer"];
    const map = new Map<string, RefStageDTO[]>();
    for (const s of stages) {
      const arr = map.get(s.transactionType) ?? [];
      arr.push(s);
      map.set(s.transactionType, arr);
    }
    return order
      .filter((k) => map.has(k))
      .map((k) => ({ tx: k, label: TX_LABEL[k] ?? k, items: map.get(k)! }));
  }, [stages]);

  const toggleStage = (id: number, on: boolean) => {
    setStageIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{state.mode === "edit" ? `تعديل: ${editing?.name}` : "إضافة بند"}</DialogTitle>
        <DialogDescription>الاسم مطلوب، والباقي اختياري — ويمكن ربط البند بمراحل عمل متعددة.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ref-item-name">الاسم *</Label>
            <Input id="ref-item-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ref-item-code">الرمز</Label>
            <Input id="ref-item-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="اختياري" maxLength={40} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ref-item-value">القيمة</Label>
            <Input
              id="ref-item-value"
              type="number"
              step="0.0001"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="اختياري — للأوزان وغيرها"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ref-item-notes">ملاحظات</Label>
            <Input id="ref-item-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" maxLength={300} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>المراحل المرتبطة</Label>
          {stagesLoading ? (
            <p className="text-xs text-muted-foreground">جارٍ تحميل المراحل…</p>
          ) : grouped.length === 0 ? (
            <p className="text-xs text-muted-foreground">لا مراحل معرفة بعد — عرّفها من قسم «مراحل العمل».</p>
          ) : (
            <div className="max-h-44 overflow-y-auto rounded-lg border p-2 space-y-2.5">
              {grouped.map((g) => (
                <div key={g.tx}>
                  <p className="text-[11px] font-semibold text-muted-foreground mb-1">{g.label}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {g.items.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-muted/60 cursor-pointer text-sm">
                        <Checkbox
                          checked={stageIds.has(s.id)}
                          onCheckedChange={(v) => toggleStage(s.id, v === true)}
                          aria-label={`ربط ${s.stageName}`}
                        />
                        <span className="truncate">{s.stageName}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {stageIds.size > 0 && (
            <p className="text-[11px] text-muted-foreground">مختارة: {stageIds.size} مرحلة</p>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>إلغاء</Button>
        <Button
          disabled={!name.trim() || saveMutation.isPending}
          onClick={() =>
            saveMutation.mutate({
              name: name.trim(),
              code,
              value: value.trim() === "" ? null : Number(value),
              notes,
              stageIds: [...stageIds],
            })
          }
        >
          {state.mode === "edit" ? "حفظ" : "إضافة"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
