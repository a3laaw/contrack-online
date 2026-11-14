"use client";

/**
 * الشاشة الموحدة «المناطق — المحافظة ← المدينة ← المنطقة» — طلب المالك الحرفي:
 * «المناطق — هتكون المحافظة — المدينة / المنطقة عمود».
 *
 * ثلاثة أعمدة هرمية ذاتية على قائمة المناطق المرجعية (areas) نفسها:
 *   1) المحافظة — بنود بلا أب (المحافظات الست المبذرة سلفًا)، شارة بعدد المدن.
 *   2) المدينة — أبناء المحافظة المحددة، شارة بعدد المناطق.
 *   3) المنطقة — أبناء المدينة المحددة.
 *
 * نقل البند بين المستويات من نافذة التعديل (منتقي الموضع: محافظة أو مدينة) —
 * والقواعد خادميًا في resolveRefParent: ثلاثة مستويات لا تتجاوزها، لا دوران،
 * ونقل شجرة بأبناء لا يخرج أي حفيد عن المستويات. حارس الحذف خادميًا كالسكنى:
 * بند عليه أبناء لا يُحذف حتى تُنقل أو تُحذف أولًا.
 *
 * بلا أي جداول أو مسارات جديدة؛ كل الكتابة عبر مسارات القوائم المرجعية القائمة
 * (/api/ref-lists/[id]/items + /api/ref-items/[id] + move) بحرس adminGuard.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  Loader2,
  MapPin,
  Map as MapIcon,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "./api";
import { errMessage, type User } from "./contrack-types";

// ===== أنواع الـAPI — عقد /api/ref-lists الموثق =====
interface AreaRefItem {
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
}
interface AreaRefList {
  id: number;
  key: string;
  name: string;
  description: string;
  system: boolean;
  active: boolean;
  items: AreaRefItem[];
}

/** مستوى البند في هرمية المناطق — كلها بنود قائمة areas الواحدة */
type AreaKind = "governorates" | "cities" | "areas";

const KIND_LABEL: Record<AreaKind, string> = {
  governorates: "المحافظة",
  cities: "المدينة",
  areas: "المنطقة",
};

interface AreasStructureViewProps {
  user: User;
  onAuthError: () => void;
  /** مُمرَّر من RefListsView لتوحيد التوست */
  onFailToast?: (e: unknown, title: string) => void;
}

export function AreasStructureView({ user, onAuthError, onFailToast }: AreasStructureViewProps) {
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

  // ===== البيانات — قائمة المناطق المرجعية (تُبذر تلقائيًا بمحافظات الكويت عند أول قراءة) =====
  const listsQuery = useQuery<{ lists: AreaRefList[] }>({
    queryKey: ["ref-lists"],
    queryFn: () => apiGet<{ lists: AreaRefList[] }>("/api/ref-lists"),
  });

  const areasList = listsQuery.data?.lists.find((l) => l.key === "areas") ?? null;
  const allItems = areasList?.items ?? [];

  // ===== المستويات الثلاثة — من نفس القائمة حسب parentId =====
  const governorates = React.useMemo(() => allItems.filter((i) => i.parentId === null), [allItems]);
  const cities = React.useMemo(() => allItems.filter((i) => i.parentId !== null), [allItems]);

  // ===== الاختيار — المحافظة افتراضيًا أول بند، والمدينة باختيار صريح =====
  const [selectedGovernorateId, setSelectedGovernorateId] = React.useState<number | null>(null);
  const [selectedCityId, setSelectedCityId] = React.useState<number | null>(null);
  const selectedGovernorate = React.useMemo(
    () => governorates.find((g) => g.id === selectedGovernorateId) ?? governorates[0] ?? null,
    [governorates, selectedGovernorateId]
  );
  const selectedCity = React.useMemo(
    () => cities.find((c) => c.id === selectedCityId) ?? null,
    [cities, selectedCityId]
  );

  const governorateCities = React.useMemo(
    () => (selectedGovernorate ? cities.filter((c) => c.parentId === selectedGovernorate.id) : []),
    [cities, selectedGovernorate]
  );
  const cityAreas = React.useMemo(
    () => (selectedCity ? allItems.filter((i) => i.parentId === selectedCity.id) : []),
    [allItems, selectedCity]
  );

  const qc = useQueryClient();
  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["ref-lists"] });
  }, [qc]);

  // ======================================================================
  // طفرات الكتابة — عبر مسارات القوائم المرجعية القائمة (adminGuard خلفها)
  // ======================================================================
  const [itemDialog, setItemDialog] = React.useState<{
    kind: AreaKind;
    mode: "add" | "edit";
    item?: AreaRefItem;
  } | null>(null);
  const [itemName, setItemName] = React.useState("");
  const [itemCode, setItemCode] = React.useState("");
  const [itemNotes, setItemNotes] = React.useState("");
  /** الموضع الجديد في الشجرة عند التعديل — undefined = بلا تغيير · رقم = أب جديد */
  const [editParentId, setEditParentId] = React.useState<number | null | undefined>(undefined);
  const [deleteItem, setDeleteItem] = React.useState<{ kind: AreaKind; item: AreaRefItem } | null>(null);

  const openItemDialog = (kind: AreaKind, mode: "add" | "edit", item?: AreaRefItem) => {
    setItemName(mode === "edit" && item ? item.name : "");
    setItemCode(mode === "edit" && item ? item.code : "");
    setItemNotes(mode === "edit" && item ? item.notes : "");
    setEditParentId(mode === "edit" && item ? item.parentId : undefined);
    setItemDialog({ kind, mode, item });
  };

  /** مستوى البند الحالي — لصياغة الموضع في نافذة التعديل */
  const levelOf = (it: AreaRefItem): "governorate" | "city" | "area" =>
    it.parentId === null ? "governorate" : (allItems.find((p) => p.id === it.parentId)?.parentId === null ? "city" : "area");

  const levelText = (it: AreaRefItem): string => {
    const level = levelOf(it);
    if (level === "governorate") return "محافظة (قمة الشجرة)";
    const parent = allItems.find((p) => p.id === it.parentId);
    return level === "city" ? `مدينة تحت «${parent?.name ?? "?"}»` : `منطقة تحت «${parent?.name ?? "?"}»`;
  };

  const saveItemMutation = useMutation({
    mutationFn: () => {
      const kind = itemDialog?.kind;
      if (!kind) throw new Error("نوع البند مفقود");
      const name = itemName.trim();
      if (!name) throw new Error(`اسم ${KIND_LABEL[kind]} مطلوب`);
      if (!areasList) throw new Error("قائمة المناطق غير موجودة");
      const common: Record<string, unknown> = { name, code: itemCode.trim(), notes: itemNotes.trim() };
      if (itemDialog?.mode === "edit" && itemDialog.item) {
        if (editParentId !== undefined) common.parentId = editParentId;
        return apiPatch(`/api/ref-items/${itemDialog.item.id}`, common);
      }
      // الإضافة — الأب آلي من العمود: محافظة بلا أب · مدينة للمحافظة المحددة · منطقة للمدينة المحددة
      const parentId =
        kind === "governorates" ? null : kind === "cities" ? selectedGovernorate?.id ?? null : selectedCity?.id ?? null;
      return apiPost(`/api/ref-lists/${areasList.id}/items`, { ...common, parentId });
    },
    onSuccess: () => {
      invalidate();
      const kind = itemDialog?.kind;
      const mode = itemDialog?.mode;
      setItemDialog(null);
      toast({
        title:
          mode === "edit"
            ? `تم تعديل ${kind ? KIND_LABEL[kind] : "البند"}`
            : "تمت الإضافة في موضعها",
      });
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

  const busy = saveItemMutation.isPending || deleteItemMutation.isPending;

  // ======================================================================
  // صف بند موحد للثلاثة أعمدة — اختيار/شارات/أزرار إجراءات
  // ======================================================================
  const renderRow = (
    it: AreaRefItem,
    kind: AreaKind,
    opts: { selected: boolean; onSelect: () => void }
  ) => (
    <li key={it.id}>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={opts.selected}
        onClick={opts.onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            opts.onSelect();
          }
        }}
        className={`flex w-full flex-col gap-1 rounded-lg border px-3 py-2 transition-colors cursor-pointer ${
          opts.selected ? "border-primary/60 bg-primary/10" : "hover:bg-muted/60"
        }`}
      >
        <span className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={it.name}>
            {it.name}
          </span>
          {!it.active && <Badge variant="secondary" className="text-[10px]">معطّل</Badge>}
        </span>
        <span className="flex w-full items-center gap-2 text-[11px] text-muted-foreground">
          {it.code ? <span className="numeric truncate" dir="ltr">{it.code}</span> : null}
          <span className="numeric ms-auto">
            {kind === "governorates"
              ? `${it.childrenCount} مدينة`
              : kind === "cities"
                ? `${it.childrenCount} منطقة`
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
              <Button
                size="icon"
                variant="ghost"
                className="size-6"
                aria-label={`تعديل ${it.name} ونقلها`}
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

  const emptyBox = (msg: string) => (
    <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">{msg}</p>
  );

  // منتقي الموضع في نافذة التعديل — يظهر دائمًا في التعديل: نقل بين المستويات
  // أو البقاء محافظة (خيار القمة) — والحارس الخادمي يمنع أي موضع باطل
  const parentSelect = itemDialog?.mode === "edit";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold whitespace-nowrap">المناطق — المحافظة ← المدينة ← المنطقة</h1>
        <span className="hidden xl:inline text-xs text-muted-foreground">
          اختر محافظة ← تظهر مدنها ← اختر مدينة فتظهر مناطقها — النقل من نافذة التعديل والأبناء يمنعون الحذف
        </span>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        {/* ============ العمود 1: المحافظات ============ */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <MapIcon className="size-4 text-primary" aria-hidden />
              المحافظة
            </CardTitle>
            {manager && (
              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => openItemDialog("governorates", "add")}>
                <Plus className="size-3.5" aria-hidden />
                إضافة
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
            ) : governorates.length === 0 ? (
              emptyBox(manager ? "لا محافظات بعد — أضف أول محافظة بالزر أعلى" : "لا محافظات بعد")
            ) : (
              <ul className="max-h-96 space-y-1.5 overflow-y-auto pe-1" aria-label="قائمة المحافظات">
                {governorates.map((g) =>
                  renderRow(g, "governorates", {
                    selected: selectedGovernorate?.id === g.id,
                    onSelect: () => {
                      setSelectedGovernorateId(g.id);
                      setSelectedCityId(null);
                    },
                  })
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ============ العمود 2: المدن ============ */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <Building2 className="size-4 text-primary" aria-hidden />
              المدينة
              {selectedGovernorate && (
                <span className="truncate font-normal text-muted-foreground" title={selectedGovernorate.name}>
                  — {selectedGovernorate.name}
                </span>
              )}
            </CardTitle>
            {manager && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1 text-xs"
                disabled={!selectedGovernorate}
                onClick={() => openItemDialog("cities", "add")}
              >
                <Plus className="size-3.5" aria-hidden />
                {selectedGovernorate ? "مدينة للمحافظة" : "مدينة"}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {listsQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-11 rounded-lg" />
                ))}
              </div>
            ) : !selectedGovernorate ? (
              emptyBox("أضف أو اختر محافظة أولًا لتظهر مدنها هنا")
            ) : governorateCities.length === 0 ? (
              emptyBox(manager ? "لا مدن بهذه المحافظة بعد — أضف أول مدينة بالزر أعلى" : "لا مدن بهذه المحافظة بعد")
            ) : (
              <ul className="max-h-96 space-y-1.5 overflow-y-auto pe-1" aria-label={`مدن ${selectedGovernorate.name}`}>
                {governorateCities.map((c) =>
                  renderRow(c, "cities", {
                    selected: selectedCity?.id === c.id,
                    onSelect: () => setSelectedCityId(c.id),
                  })
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ============ العمود 3: المناطق ============ */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <MapPin className="size-4 text-primary" aria-hidden />
              المنطقة
              {selectedCity && (
                <span className="truncate font-normal text-muted-foreground" title={selectedCity.name}>
                  — {selectedCity.name}
                </span>
              )}
            </CardTitle>
            {manager && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1 text-xs"
                disabled={!selectedCity}
                onClick={() => openItemDialog("areas", "add")}
              >
                <Plus className="size-3.5" aria-hidden />
                {selectedCity ? "منطقة للمدينة" : "منطقة"}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {listsQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-11 rounded-lg" />
                ))}
              </div>
            ) : !selectedCity ? (
              emptyBox("اختر مدينة من عمود «المدينة» لعرض مناطقها هنا")
            ) : cityAreas.length === 0 ? (
              emptyBox(manager ? "لا مناطق بهذه المدينة بعد — أضف أول منطقة بالزر أعلى" : "لا مناطق بهذه المدينة بعد")
            ) : (
              <ul className="max-h-96 space-y-1.5 overflow-y-auto pe-1" aria-label={`مناطق ${selectedCity.name}`}>
                {cityAreas.map((a) =>
                  renderRow(a, "areas", {
                    selected: false,
                    onSelect: () => undefined,
                  })
                )}
              </ul>
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
                : itemDialog?.kind === "governorates"
                  ? "إضافة محافظة"
                  : itemDialog?.kind === "cities"
                    ? `إضافة مدينة إلى «${selectedGovernorate?.name ?? ""}»`
                    : `إضافة منطقة إلى «${selectedCity?.name ?? ""}»`}
            </DialogTitle>
            <DialogDescription>
              {itemDialog?.mode === "edit" ? (
                <>
                  الموضع الحالي: {itemDialog.item ? levelText(itemDialog.item) : ""} — يمكنك نقل البند بمنتقي
                  الموضع (قواعد الشجرة خادمية: ثلاثة مستويات لا تتجاوزها).
                </>
              ) : itemDialog?.kind === "governorates" ? (
                "المحافظات قمة هرمية المناطق — المدن تُربط بها من العمود الثاني."
              ) : itemDialog?.kind === "cities" ? (
                "ستُربط المدينة آلياً بالمحافظة المحددة، والنقل لاحقاً من نافذة التعديل."
              ) : (
                "ستُربط المنطقة آلياً بالمدينة المحددة، والنقل لاحقاً من نافذة التعديل."
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="area-item-name">الاسم</Label>
              <Input
                id="area-item-name"
                className="h-10"
                placeholder={itemDialog?.kind === "governorates" ? "مثال: العاصمة" : itemDialog?.kind === "cities" ? "مثال: مدينة الكويت" : "مثال: منطقة السالم"}
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
              />
            </div>
            {parentSelect && itemDialog?.item && (
              <div className="space-y-1.5">
                <Label htmlFor="area-item-parent">الموضع في الشجرة (نقل البند)</Label>
                <Select
                  value={editParentId === null || editParentId === undefined ? "root" : String(editParentId)}
                  onValueChange={(v) => setEditParentId(v === "root" ? null : Number(v))}
                >
                  <SelectTrigger id="area-item-parent" className="h-10 w-full">
                    <SelectValue placeholder="اختر المحافظة أو المدينة" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    <SelectGroup>
                      <SelectLabel>القمة</SelectLabel>
                      <SelectItem value="root">محافظة (بلا أب)</SelectItem>
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>المحافظات — البند يصير مدينة</SelectLabel>
                      {governorates
                        .filter((g) => g.id !== itemDialog.item?.id)
                        .map((g) => (
                          <SelectItem key={g.id} value={String(g.id)}>
                            {g.name}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>المدن — البند يصير منطقة</SelectLabel>
                      {cities
                        .filter((c) => c.id !== itemDialog.item?.id)
                        .map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            {c.name}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  تحت المحافظة = مدينة · تحت المدينة = منطقة — والقواعد الخادمية تمنع تجاوز المستويات الثلاثة.
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="area-item-code">الرمز (اختياري)</Label>
              <Input
                id="area-item-code"
                className="h-10"
                dir="ltr"
                placeholder="KW-CAP / KWT / SAL"
                value={itemCode}
                onChange={(e) => setItemCode(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="area-item-notes">ملاحظات (اختياري)</Label>
              <Input
                id="area-item-notes"
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
              حذف «{deleteItem?.item.name}» من قائمة المناطق؟ إن كان عليه مدن أو مناطق مرتبطة
              فسيُرفض الحذف — انقلها أو احذفها أولًا.
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
