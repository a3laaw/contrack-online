"use client";

/**
 * Task 85 — SaaS: تاب «الشركات» (إداري) — قائمة/إنشاء/تعديل/تفعيل/دخول.
 * الدخول = إعادة إصدار توكن الجلسة بشركة الهدف ثم تحديث كامل للشل.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
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
import { errMessage } from "../contrack-types";
import { apiGet, apiPatch, apiPost, setStoredToken } from "../api";

interface CompanyRow {
  id: number;
  name: string;
  shortName: string;
  isActive: boolean;
  notes: string;
  createdAt: string;
  usersCount: number;
}

interface CompaniesResponse {
  companies: CompanyRow[];
  currentCompanyId: number;
  canSwitch: boolean;
}

export function CompaniesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<CompanyRow | null>(null);
  const [form, setForm] = React.useState({ name: "", shortName: "", notes: "" });

  const q = useQuery({
    queryKey: ["companies"],
    queryFn: () => apiGet<CompaniesResponse>("/api/companies"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["companies"] });
  };

  const createM = useMutation({
    mutationFn: () => apiPost("/api/companies", form),
    onSuccess: () => {
      toast({ description: `تم إنشاء شركة «${form.name}»` });
      setCreateOpen(false);
      setForm({ name: "", shortName: "", notes: "" });
      invalidate();
    },
    onError: (e) => toast({ variant: "destructive", description: errMessage(e) }),
  });

  const updateM = useMutation({
    mutationFn: (v: { id: number; data: Record<string, unknown> }) =>
      apiPatch(`/api/companies/${v.id}`, v.data),
    onSuccess: () => {
      toast({ description: "تم حفظ تعديلات الشركة" });
      setEditTarget(null);
      invalidate();
    },
    onError: (e) => toast({ variant: "destructive", description: errMessage(e) }),
  });

  const switchM = useMutation({
    mutationFn: (id: number) => apiPost<{ token: string }>("/api/companies/switch", { companyId: id }),
    onSuccess: (res) => {
      setStoredToken(res.token); // مزامنة التوكن المحلي مع الكوكي الجديد
      toast({ description: "جارٍ الدخول إلى الشركة…" });
      setTimeout(() => window.location.reload(), 350);
    },
    onError: (e) => toast({ variant: "destructive", description: errMessage(e) }),
  });

  if (q.isLoading) {
    return (
      <div className="space-y-2 p-1">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return <p className="p-4 text-sm text-destructive">{q.error ? errMessage(q.error) : "لا بيانات"}</p>;
  }

  const { companies, currentCompanyId } = q.data;

  return (
    <div className="space-y-4 p-1">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">إدارة الشركات</h3>
          <p className="text-xs text-muted-foreground">
            كل شركة لها بياناتها المعزولة تمامًا — العملاء والعقود والسندات لا تختلط. «الدخول» يبدّل سياق العمل للشركة المختارة.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          + شركة جديدة
        </Button>
      </div>

      <div className="max-h-96 overflow-y-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>الاسم</TableHead>
              <TableHead className="hidden sm:table-cell">الاختصار</TableHead>
              <TableHead className="text-center">المستخدمون</TableHead>
              <TableHead className="text-center">الحالة</TableHead>
              <TableHead className="text-left">إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {companies.map((c) => (
              <TableRow key={c.id} className={c.id === currentCompanyId ? "bg-muted/50" : ""}>
                <TableCell className="text-xs text-muted-foreground">{c.id}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    {c.id === currentCompanyId && <Badge variant="secondary" className="text-[10px]">الحالية</Badge>}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell text-muted-foreground">{c.shortName || "—"}</TableCell>
                <TableCell className="text-center">{c.usersCount}</TableCell>
                <TableCell className="text-center">
                  <Badge variant={c.isActive ? "default" : "outline"}>
                    {c.isActive ? "فعّالة" : "معطّلة"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    {c.id !== currentCompanyId && c.isActive && (
                      <Button size="sm" variant="outline" onClick={() => switchM.mutate(c.id)} disabled={switchM.isPending}>
                        دخول
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditTarget(c);
                        setForm({ name: c.name, shortName: c.shortName, notes: c.notes });
                      }}
                    >
                      تعديل
                    </Button>
                    {c.id !== 1 && (
                      <Switch
                        checked={c.isActive}
                        onCheckedChange={(v) => updateM.mutate({ id: c.id, data: { isActive: v } })}
                        aria-label={`تفعيل ${c.name}`}
                      />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* إنشاء */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>شركة جديدة</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-name">اسم الشركة *</Label>
              <Input
                id="c-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="مثال: بيانات قديمة (ترحيل)"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-short">اختصار (اختياري)</Label>
              <Input id="c-short" value={form.shortName} onChange={(e) => setForm((f) => ({ ...f, shortName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-notes">ملاحظات (اختياري)</Label>
              <Textarea id="c-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>إلغاء</Button>
            <Button onClick={() => createM.mutate()} disabled={!form.name.trim() || createM.isPending}>
              {createM.isPending ? "جارٍ الإنشاء…" : "إنشاء"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تعديل */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>تعديل: {editTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="e-name">اسم الشركة</Label>
              <Input id="e-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-short">اختصار</Label>
              <Input id="e-short" value={form.shortName} onChange={(e) => setForm((f) => ({ ...f, shortName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-notes">ملاحظات</Label>
              <Textarea id="e-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>إلغاء</Button>
            <Button
              onClick={() => editTarget && updateM.mutate({ id: editTarget.id, data: form })}
              disabled={!form.name.trim() || updateM.isPending}
            >
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
