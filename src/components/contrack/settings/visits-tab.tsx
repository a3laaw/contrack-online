"use client";

/**
 * تبويب «◷ جدول الزيارات» — مرآة _tab_visits المكتبية (settings.py:3342-3536):
 * ساعات عمل جدول الزيارات + الموظفون (أعمدة الجدول) — الأسلاك عبر
 * /api/visits/config و/api/visits/staff كما كانت حرفيًا.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";

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
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "../api";
import { errMessage } from "../contrack-types";

interface VisitConfigDTO {
  startHour: number;
  endHour: number;
  slotMinutes: number;
  editable: boolean;
  note?: string;
}

interface VisitStaffDTO {
  id: number;
  name: string;
  phone: string;
  active: boolean;
  sort: number;
  todayVisits: number;
}

export function VisitsTab({ onAuthError }: { onAuthError: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const configQuery = useQuery<VisitConfigDTO>({
    queryKey: ["visits-config"],
    queryFn: () => apiGet<VisitConfigDTO>("/api/visits/config"),
  });

  const staffQuery = useQuery<{ staff: VisitStaffDTO[] }>({
    queryKey: ["visits-staff"],
    queryFn: () => apiGet<{ staff: VisitStaffDTO[] }>("/api/visits/staff"),
  });
  const staff: VisitStaffDTO[] = staffQuery.data?.staff ?? [];

  const fail = (e: unknown, title: string) => {
    if (e instanceof ApiError && e.status === 401) onAuthError();
    toast({ variant: "destructive", title, description: errMessage(e) });
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ["visits-staff"] });

  const [addOpen, setAddOpen] = React.useState(false);
  const [addForm, setAddForm] = React.useState({ name: "", phone: "" });
  const [editStaff, setEditStaff] = React.useState<VisitStaffDTO | null>(null);
  const [editForm, setEditForm] = React.useState({ name: "", phone: "", active: true });
  const [deleteTarget, setDeleteTarget] = React.useState<VisitStaffDTO | null>(null);

  const addMutation = useMutation({
    mutationFn: () => apiPost("/api/visits/staff", { name: addForm.name.trim(), phone: addForm.phone.trim() }),
    onSuccess: () => {
      toast({ title: "أُضيف الموظف" });
      setAddOpen(false);
      setAddForm({ name: "", phone: "" });
      refresh();
    },
    onError: (e) => fail(e, "تعذر الإضافة"),
  });

  const editMutation = useMutation({
    mutationFn: () =>
      apiPatch(`/api/visits/staff/${editStaff!.id}`, {
        name: editForm.name.trim(),
        phone: editForm.phone.trim(),
        active: editForm.active,
      }),
    onSuccess: () => {
      toast({ title: "تم الحفظ" });
      setEditStaff(null);
      refresh();
    },
    onError: (e) => fail(e, "تعذر الحفظ"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/visits/staff/${id}`),
    onSuccess: () => {
      toast({ title: "تم الحذف" });
      setDeleteTarget(null);
      refresh();
    },
    onError: (e) => {
      setDeleteTarget(null);
      fail(e, "تعذر الحذف");
    },
  });

  return (
    <div className="space-y-4">
      {/* ساعات العمل */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">ساعات عمل جدول الزيارات</CardTitle>
          <p className="text-xs text-muted-foreground">
            صفوف الجدول تُبنى من هذه الساعات — ومدة الحصة تحدد دقة المواعيد (30 دقيقة = نصف ساعة لكل خانة).
          </p>
        </CardHeader>
        <CardContent>
          {configQuery.isLoading ? (
            <Skeleton className="h-10 w-72 rounded-lg" />
          ) : configQuery.isError ? (
            <p className="text-sm text-destructive">تعذر تحميل الإعدادات — {errMessage(configQuery.error)}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>من الساعة: <b className="tabular-nums">{configQuery.data?.startHour}</b></span>
              <span className="text-muted-foreground">·</span>
              <span>إلى الساعة: <b className="tabular-nums">{configQuery.data?.endHour}</b></span>
              <span className="text-muted-foreground">·</span>
              <span>مدة الحصة: <b className="tabular-nums">{configQuery.data?.slotMinutes}</b> دقيقة</span>
              {configQuery.data?.note && (
                <p className="mt-1 w-full text-xs text-muted-foreground">{configQuery.data.note}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* الموظفون */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="text-base">الموظفون (أعمدة الجدول)</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">أضف موظفي الزيارات وأرقام واتسابهم.</p>
          </div>
          <Button size="sm" className="h-9 gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            إضافة
          </Button>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {staffQuery.isLoading ? (
            <div className="space-y-2 px-6 pb-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-11 rounded-lg" />
              ))}
            </div>
          ) : staff.length === 0 ? (
            <p className="px-6 py-4 text-sm text-muted-foreground">لا موظفين — أضف أول موظف.</p>
          ) : (
            <div className="overflow-x-auto px-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-36">الموظف</TableHead>
                    <TableHead className="w-32">الهاتف</TableHead>
                    <TableHead className="w-24 text-center">زيارات مسجلة</TableHead>
                    <TableHead className="w-16 text-center">تفعيل</TableHead>
                    <TableHead className="w-16 text-center">حذف</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staff.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <button
                          type="button"
                          className="text-start hover:underline"
                          onClick={() => {
                            setEditStaff(s);
                            setEditForm({ name: s.name, phone: s.phone, active: s.active });
                          }}
                        >
                          {s.name}
                          {s.active === false && <span className="ms-1 text-xs text-muted-foreground">· موقوف</span>}
                        </button>
                      </TableCell>
                      <TableCell dir="ltr" className="text-start">{s.phone || "—"}</TableCell>
                      <TableCell className="text-center tabular-nums">{s.todayVisits}</TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={s.active}
                          onCheckedChange={(v) =>
                            apiPatch(`/api/visits/staff/${s.id}`, { active: v })
                              .then(() => refresh())
                              .catch((e) => fail(e, "تعذر التبديل"))
                          }
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                          aria-label="حذف"
                          onClick={() => setDeleteTarget(s)}
                        >
                          <Trash2 className="size-4" />
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

      {/* إضافة موظف */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-base">إضافة موظف زيارات</DialogTitle>
            <DialogDescription>يظهر الموظف كعمود في جدول الزيارات.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="vs-name">الاسم:*</Label>
              <Input id="vs-name" className="h-9" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vs-phone">الهاتف (واتساب):</Label>
              <Input id="vs-phone" className="h-9" dir="ltr" value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setAddOpen(false)} disabled={addMutation.isPending}>إلغاء</Button>
            <Button className="h-9" disabled={addMutation.isPending || !addForm.name.trim()} onClick={() => addMutation.mutate()}>
              {addMutation.isPending ? "جارٍ الإضافة…" : "إضافة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تعديل موظف */}
      <Dialog open={editStaff !== null} onOpenChange={(v) => !v && setEditStaff(null)}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-base">✎ تعديل الموظف</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="vs-edit-name">الاسم:*</Label>
              <Input id="vs-edit-name" className="h-9" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vs-edit-phone">الهاتف (واتساب):</Label>
              <Input id="vs-edit-phone" className="h-9" dir="ltr" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm font-medium">مفعّل</span>
              <Switch checked={editForm.active} onCheckedChange={(v) => setEditForm({ ...editForm, active: v })} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setEditStaff(null)} disabled={editMutation.isPending}>إلغاء</Button>
            <Button className="h-9" disabled={editMutation.isPending || !editForm.name.trim()} onClick={() => editMutation.mutate()}>
              {editMutation.isPending ? "جارٍ الحفظ…" : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأكيد الحذف */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف موظف الزيارات؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف «{deleteTarget?.name}». الموظف له زيارات مسجلة لا يُحذف — يُعطَّل بدلًا من ذلك.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9">إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="h-9 bg-destructive text-white hover:bg-destructive/90"
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
    </div>
  );
}
