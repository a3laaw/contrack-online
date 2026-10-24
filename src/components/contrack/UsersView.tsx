"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Pencil,
  Trash2,
  ShieldCheck,
  Loader2,
  Monitor,
  BarChart3,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Skeleton } from "@/components/ui/skeleton";
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
import { ApiError, apiDelete, apiGet, apiPut } from "./api";
import type {
  PermissionsResponse,
  User,
  UserListItem,
  UsersResponse,
} from "./contrack-types";
import { ROLE_LABEL, errMessage } from "./contrack-types";
import { UserEditPage } from "./UserEditPage";

interface UsersViewProps {
  user: User;
  onAuthError: () => void;
}

export function UsersView({ user, onAuthError }: UsersViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = user.role === "admin" || user.role === "developer";

  const listQuery = useQuery<UsersResponse>({
    queryKey: ["users"],
    queryFn: () => apiGet<UsersResponse>("/api/users"),
    enabled: manager,
  });

  const [userPage, setUserPage] = React.useState<{ editing: UserListItem | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<UserListItem | null>(null);
  const [permsId, setPermsId] = React.useState<number | null>(null);

  const fail = React.useCallback(
    (e: unknown, title: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title, description: errMessage(e) });
    },
    [onAuthError, toast]
  );

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast({ title: "تم الحذف", description: "حُذف المستخدم" });
      setDeleteTarget(null);
    },
    onError: (e) => {
      setDeleteTarget(null);
      fail(e, "تعذر الحذف");
    },
  });

  const openAdd = () => setUserPage({ editing: null });

  const openEdit = (u: UserListItem) => setUserPage({ editing: u });

  if (!manager) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <ShieldCheck className="size-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">للمدير فقط</p>
          <p className="text-xs text-muted-foreground">إدارة المستخدمين متاحة لحساب المدير/المطور فقط.</p>
        </CardContent>
      </Card>
    );
  }

  // صفحة المستخدم (جديد/تعديل) — بلا مسار، استبدال في نفس المستوى (بعد حراس الـhooks والصلاحية)
  if (userPage) {
    return <UserEditPage editing={userPage.editing} onAuthError={onAuthError} onClose={() => setUserPage(null)} />;
  }

  const items = listQuery.data?.users ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold whitespace-nowrap">المستخدمون</h1>
        <span className="hidden xl:inline text-xs text-muted-foreground">إدارة الحسابات والأدوار والصلاحيات</span>
        <Button className="ms-auto h-9 gap-1.5" onClick={openAdd}>
          <Plus className="size-4" />
          مستخدم جديد
        </Button>
      </div>

      {listQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : listQuery.isError ? (
        <Card className="border-status-danger/40">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">{errMessage(listQuery.error)}</CardContent>
        </Card>
      ) : (
        <>
          {/* جدول — الحاسوب */}
          <Card className="hidden md:block overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>اسم المستخدم</TableHead>
                  <TableHead>الاسم الكامل</TableHead>
                  <TableHead className="w-28">الدور</TableHead>
                  <TableHead className="w-24 text-center">الحالة</TableHead>
                  <TableHead className="w-36 text-center">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium" dir="ltr">{u.username}</TableCell>
                    <TableCell>{u.fullName || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{ROLE_LABEL[u.role] || u.role}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {u.active ? (
                        <Badge className="bg-status-done-bg text-status-done">نشط</Badge>
                      ) : (
                        <Badge variant="secondary">معطّل</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(u)} aria-label="تعديل">
                          <Pencil className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => setPermsId(u.id)} aria-label="الصلاحيات">
                          <ShieldCheck className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(u)}
                          aria-label="حذف"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* بطاقات — الموبايل */}
          <div className="grid grid-cols-1 gap-2 md:hidden">
            {items.map((u) => (
              <Card key={u.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold" dir="ltr">{u.username}</div>
                    <div className="text-xs text-muted-foreground">{u.fullName || "—"}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant="secondary">{ROLE_LABEL[u.role] || u.role}</Badge>
                    {u.active ? (
                      <Badge className="bg-status-done-bg text-status-done">نشط</Badge>
                    ) : (
                      <Badge variant="secondary">معطّل</Badge>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-9 flex-1 gap-1.5" onClick={() => openEdit(u)}>
                    <Pencil className="size-4" />
                    تعديل
                  </Button>
                  <Button variant="outline" size="sm" className="h-9 flex-1 gap-1.5" onClick={() => setPermsId(u.id)}>
                    <ShieldCheck className="size-4" />
                    صلاحيات
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-9 shrink-0 text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(u)}
                    aria-label="حذف"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* حذف مستخدم — نافذة صغيرة */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المستخدم؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف حساب «{deleteTarget?.username}». قد يرفض النظام حذف آخر مدير.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9">إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="h-9 border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
              }}
            >
              {deleteMutation.isPending ? "جارٍ الحذف…" : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* الصلاحيات */}
      {permsId !== null && (
        <PermissionsDialog
          userId={permsId}
          onClose={() => setPermsId(null)}
          onAuthError={onAuthError}
        />
      )}
    </div>
  );
}

// ==================== نافذة الصلاحيات ====================

const GROUP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "الشاشات": Monitor,
  "التقارير": BarChart3,
  "الإجراءات": Zap,
};

function PermissionsDialog({
  userId,
  onClose,
  onAuthError,
}: {
  userId: number;
  onClose: () => void;
  onAuthError: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const permsQuery = useQuery<PermissionsResponse>({
    queryKey: ["user-permissions", userId],
    queryFn: () => apiGet<PermissionsResponse>(`/api/users/${userId}/permissions`),
  });

  const [allowed, setAllowed] = React.useState<Record<string, boolean>>({});
  const [initialized, setInitialized] = React.useState(false);

  React.useEffect(() => {
    if (permsQuery.data && !initialized) {
      const map: Record<string, boolean> = {};
      for (const c of permsQuery.data.catalog) {
        map[c.key] = permsQuery.data.permissions.find((i) => i.permKey === c.key)?.allowed ?? true;
      }
      setAllowed(map);
      setInitialized(true);
    }
  }, [permsQuery.data, initialized]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiPut(`/api/users/${userId}/permissions`, {
        permissions: Object.entries(allowed).map(([permKey, a]) => ({ permKey, allowed: a })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-permissions", userId] });
      toast({ title: "تم الحفظ", description: "حُفظت صلاحيات المستخدم" });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر الحفظ", description: errMessage(e) });
    },
  });

  const catalog = permsQuery.data?.catalog ?? [];
  // تجميع حسب المجموعة مع الحفاظ على ترتيب الكتالوج
  const groups: { group: string; items: { key: string; label: string }[] }[] = [];
  for (const c of catalog) {
    let g = groups.find((x) => x.group === c.group);
    if (!g) {
      g = { group: c.group, items: [] };
      groups.push(g);
    }
    g.items.push({ key: c.key, label: c.label });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            صلاحيات المستخدم
          </DialogTitle>
          <DialogDescription>المدير/المطور يملك كل الصلاحيات تلقائيًا — الضبط هنا يخص السكرتير.</DialogDescription>
        </DialogHeader>

        {permsQuery.isLoading || !initialized ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => {
              const Icon = GROUP_ICONS[g.group] || Monitor;
              return (
                <div key={g.group} className="rounded-lg border">
                  <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm font-semibold">
                    <Icon className="size-4 text-primary" />
                    {g.group}
                    <Badge variant="secondary" className="ms-auto text-[10px]">{g.items.length}</Badge>
                  </div>
                  <div className="divide-y">
                    {g.items.map((it) => (
                      <div key={it.key} className="flex items-center justify-between gap-3 px-3 py-2">
                        <span className="text-sm">{it.label}</span>
                        <Switch
                          checked={allowed[it.key] ?? true}
                          onCheckedChange={(v) => setAllowed((m) => ({ ...m, [it.key]: v }))}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-9" onClick={onClose} disabled={saveMutation.isPending}>
            إلغاء
          </Button>
          <Button className="h-9 gap-1.5" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !initialized}>
            {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            حفظ الصلاحيات
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
