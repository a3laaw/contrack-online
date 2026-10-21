"use client";

/**
 * تبويب «§ حسابات المصروفات» — مرآة _tab_expense_accounts المكتبية
 * (settings.py:1665-1850): شجرة أب ← أبناء، سند الصرف يستخدم الأبناء فقط.
 * الأسلاك عبر /api/expense-accounts كما كانت في SettingsView القديم حرفيًا.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPost, apiPut } from "../api";
import { errMessage } from "../contrack-types";

interface ExpenseAccountFull {
  id: number;
  name: string;
  parentId?: number | null;
  fullPath?: string;
  isActive?: boolean;
  allowPosting?: boolean;
  includeInProfitability?: boolean;
  accountKind?: string;
  sortOrder?: number;
}

const EXP_ACCOUNT_KIND_LABEL: Record<string, string> = {
  expense: "مصروف",
  advance: "سلفة",
};

export function ExpenseAccountsTab({ onAuthError }: { onAuthError: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const accQuery = useQuery<ExpenseAccountFull[], Error>({
    queryKey: ["expense-accounts"],
    queryFn: async () => {
      const data = await apiGet<unknown>("/api/expense-accounts");
      if (Array.isArray(data)) return data as ExpenseAccountFull[];
      const wrapped = data as { accounts?: ExpenseAccountFull[] };
      return wrapped?.accounts ?? [];
    },
    retry: false,
  });
  const accounts: ExpenseAccountFull[] = accQuery.data ?? [];
  const parents = accounts.filter((a) => !a.parentId);
  const [parentId, setParentId] = React.useState<string>("");
  const selectedParent = parents.find((p) => String(p.id) === parentId) || parents[0] || null;
  const children = selectedParent ? accounts.filter((a) => a.parentId === selectedParent.id) : [];
  const [selectedChildId, setSelectedChildId] = React.useState<number | null>(null);
  const selectedChild = children.find((c) => c.id === selectedChildId) || null;

  // إعادة ضبط التحديد عند تغير القائمة
  React.useEffect(() => {
    if (selectedChildId && !selectedChild) setSelectedChildId(null);
  }, [selectedChildId, selectedChild]);

  const [editOpen, setEditOpen] = React.useState(false);
  const [editForm, setEditForm] = React.useState<{
    id: number;
    name: string;
    isActive: boolean;
    allowPosting: boolean;
    includeInProfitability: boolean;
    accountKind: string;
  } | null>(null);

  const [addOpen, setAddOpen] = React.useState<"parent" | "child" | null>(null);
  const [addName, setAddName] = React.useState("");

  const fail = (e: unknown, title: string) => {
    if (e instanceof ApiError && e.status === 401) onAuthError();
    toast({ variant: "destructive", title, description: errMessage(e) });
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ["expense-accounts"] });

  const addMutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { name: addName.trim() };
      if (addOpen === "child" && selectedParent) body.parentId = selectedParent.id;
      return apiPost("/api/expense-accounts", body);
    },
    onSuccess: () => {
      toast({ title: "تمت الإضافة" });
      setAddOpen(null);
      setAddName("");
      refresh();
    },
    onError: (e) => fail(e, "تعذر الإضافة"),
  });

  // PUT عبر /api/expense-accounts/[id] — العقد الفعلي للمسار (path param)
  const editMutation = useMutation({
    mutationFn: () => {
      if (!editForm) return Promise.resolve(null);
      return apiPut(`/api/expense-accounts/${editForm.id}`, {
        name: editForm.name.trim(),
        isActive: editForm.isActive,
        allowPosting: editForm.allowPosting,
        includeInProfitability: editForm.includeInProfitability,
        accountKind: editForm.accountKind,
      });
    },
    onSuccess: () => {
      toast({ title: "تم الحفظ" });
      setEditOpen(false);
      refresh();
    },
    onError: (e) => fail(e, "تعذر الحفظ"),
  });

  const toggleMutation = useMutation({
    mutationFn: (acc: ExpenseAccountFull) =>
      apiPut(`/api/expense-accounts/${acc.id}`, { isActive: !acc.isActive }),
    onSuccess: () => {
      toast({ title: "تم التبديل" });
      refresh();
    },
    onError: (e) => fail(e, "تعذر التبديل"),
  });

  const openEdit = (acc: ExpenseAccountFull) => {
    setEditForm({
      id: acc.id,
      name: acc.name,
      isActive: acc.isActive ?? true,
      allowPosting: acc.allowPosting ?? true,
      includeInProfitability: acc.includeInProfitability ?? true,
      accountKind: acc.accountKind || "expense",
    });
    setEditOpen(true);
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-base">شجرة حسابات المصروفات</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            اختر الحساب الأب من القائمة الجانبية؛ تظهر الحسابات الأبناء المقابلة له فقط. سند الصرف يستخدم الأبناء فقط.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="h-9 gap-1.5" onClick={() => { setAddOpen("parent"); setAddName(""); }}>
            <Plus className="size-4" />
            ＋ إضافة حساب أب
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            disabled={!selectedParent}
            onClick={() => { setAddOpen("child"); setAddName(""); }}
          >
            <Plus className="size-4" />
            ＋ إضافة حساب ابن
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            disabled={!selectedChild && !selectedParent}
            onClick={() => openEdit((selectedChild || selectedParent)!)}
          >
            <Pencil className="size-4" />
            ✎ تعديل المحدد
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            disabled={!selectedChild && !selectedParent}
            onClick={() => toggleMutation.mutate((selectedChild || selectedParent)!)}
          >
            تفعيل/إيقاف المحدد
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {accQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 rounded-lg" />
            ))}
          </div>
        ) : accQuery.isError ? (
          <div className="py-8 text-center text-sm text-destructive">
            تعذر تحميل حسابات المصروفات — {errMessage(accQuery.error)}
            <div className="mt-2">
              <Button size="sm" variant="outline" className="h-8" onClick={() => accQuery.refetch()}>إعادة المحاولة</Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
            {/* الحسابات الأب */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">الحسابات الأب</Label>
              <div className="max-h-80 space-y-1 overflow-y-auto rounded-md border p-1.5">
                {parents.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { setParentId(String(p.id)); setSelectedChildId(null); }}
                    className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-start text-sm transition-colors ${
                      selectedParent?.id === p.id
                        ? "bg-primary/10 font-semibold text-primary"
                        : "text-foreground/80 hover:bg-accent"
                    }`}
                  >
                    <span className="truncate">{p.name}</span>
                    {p.isActive === false && <span className="shrink-0 text-xs text-muted-foreground">· موقوف</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* الأبناء */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">الأبناء التابعة للحساب المحدد</Label>
              <div className="max-h-80 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-36">الحساب الابن</TableHead>
                      <TableHead className="w-16 text-center">نشط</TableHead>
                      <TableHead className="w-20 text-center">في السند</TableHead>
                      <TableHead className="w-24 text-center">يدخل الربحية</TableHead>
                      <TableHead className="w-20 text-center">النوع</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {children.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                          لا حسابات أبناء لهذا الحساب
                        </TableCell>
                      </TableRow>
                    ) : (
                      children.map((c) => (
                        <TableRow
                          key={c.id}
                          className={`cursor-pointer ${selectedChildId === c.id ? "bg-primary/5" : ""}`}
                          onClick={() => setSelectedChildId(c.id)}
                        >
                          <TableCell className="whitespace-nowrap">{c.name}</TableCell>
                          <TableCell className="text-center">{c.isActive === false ? "لا" : "نعم"}</TableCell>
                          <TableCell className="text-center">{c.allowPosting === false ? "لا" : "نعم"}</TableCell>
                          <TableCell className="text-center">{c.includeInProfitability === false ? "لا" : "نعم"}</TableCell>
                          <TableCell className="text-center text-xs text-muted-foreground">
                            {EXP_ACCOUNT_KIND_LABEL[c.accountKind || "expense"] || c.accountKind || "expense"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}
      </CardContent>

      {/* إضافة حساب */}
      <Dialog open={addOpen !== null} onOpenChange={(v) => !v && setAddOpen(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">{addOpen === "parent" ? "إضافة حساب أب" : `إضافة حساب ابن — ${selectedParent?.name || ""}`}</DialogTitle>
            <DialogDescription>الاسم يظهر في قائمة حسابات سند الصرف.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="ea-name">الاسم:*</Label>
            <Input id="ea-name" className="h-9" value={addName} onChange={(e) => setAddName(e.target.value)} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setAddOpen(null)} disabled={addMutation.isPending}>إلغاء</Button>
            <Button className="h-9" disabled={addMutation.isPending || !addName.trim()} onClick={() => addMutation.mutate()}>
              {addMutation.isPending ? "جارٍ الإضافة…" : "إضافة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تعديل حساب */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">✎ تعديل الحساب</DialogTitle>
            <DialogDescription>التعديل ينعكس على قوائم سند الصرف والربحية.</DialogDescription>
          </DialogHeader>
          {editForm && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ea-edit-name">الاسم:*</Label>
                <Input id="ea-edit-name" className="h-9" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center justify-between rounded-lg border p-2.5">
                  <span className="text-sm">نشط</span>
                  <Switch checked={editForm.isActive} onCheckedChange={(v) => setEditForm({ ...editForm, isActive: v })} />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-2.5">
                  <span className="text-sm">في السند</span>
                  <Switch checked={editForm.allowPosting} onCheckedChange={(v) => setEditForm({ ...editForm, allowPosting: v })} />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-2.5">
                  <span className="text-sm">يدخل الربحية</span>
                  <Switch checked={editForm.includeInProfitability} onCheckedChange={(v) => setEditForm({ ...editForm, includeInProfitability: v })} />
                </div>
                <div className="space-y-1.5">
                  <Label>النوع</Label>
                  <Select value={editForm.accountKind} onValueChange={(v) => setEditForm({ ...editForm, accountKind: v })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">مصروف</SelectItem>
                      <SelectItem value="advance">سلفة</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setEditOpen(false)} disabled={editMutation.isPending}>إلغاء</Button>
            <Button className="h-9" disabled={editMutation.isPending || !editForm?.name.trim()} onClick={() => editMutation.mutate()}>
              {editMutation.isPending ? "جارٍ الحفظ…" : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
