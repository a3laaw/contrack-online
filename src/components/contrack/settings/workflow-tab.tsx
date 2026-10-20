"use client";

/**
 * تبويب «⇄ مراحل المتابعة» — مرآة _tab_workflow المكتبية (settings.py:2549-3068)
 * في صيغتها الويبية: نوع المعاملة + إضافة/تعديل/تحريك/حذف المراحل —
 * الأسلاك عبر /api/workflow-stages كما كانت حرفيًا.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";

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

interface WorkflowStageDTO {
  id: number;
  transactionType: string;
  stageName: string;
  stageOrder: number;
  color: string;
  parentId?: number | null;
  expectedDays: number;
  contractType: string;
}

/** تسميات أنواع المعاملة — حرفيًا من workflow_service.TX_TYPES */
const TX_LABELS: Record<string, string> = {
  contract: "عقد",
  payment: "سند صرف",
  subcontract: "عقد باطن",
  customer: "عميل (ما قبل التعاقد)",
};

export function WorkflowTab({ onAuthError }: { onAuthError: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const stagesQuery = useQuery<{ stages: WorkflowStageDTO[] }>({
    queryKey: ["workflow-stages"],
    queryFn: () => apiGet<{ stages: WorkflowStageDTO[] }>("/api/workflow-stages"),
  });
  const stages: WorkflowStageDTO[] = stagesQuery.data?.stages ?? [];

  const [txType, setTxType] = React.useState("contract");
  const filtered = stages
    .filter((s) => s.transactionType === txType)
    .sort((a, b) => a.stageOrder - b.stageOrder || a.id - b.id);

  const [addName, setAddName] = React.useState("");
  const [addDays, setAddDays] = React.useState("0");
  const [editStage, setEditStage] = React.useState<WorkflowStageDTO | null>(null);
  const [editForm, setEditForm] = React.useState<{ stageName: string; stageOrder: number; expectedDays: number; color: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<WorkflowStageDTO | null>(null);

  const fail = (e: unknown, title: string) => {
    if (e instanceof ApiError && e.status === 401) onAuthError();
    toast({ variant: "destructive", title, description: errMessage(e) });
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ["workflow-stages"] });

  const addMutation = useMutation({
    mutationFn: () =>
      apiPost("/api/workflow-stages", {
        transactionType: txType,
        stageName: addName.trim(),
        stageOrder: filtered.length > 0 ? Math.max(...filtered.map((s) => s.stageOrder)) + 1 : 1,
        expectedDays: Math.max(0, Math.trunc(Number(addDays || 0))),
      }),
    onSuccess: () => {
      toast({ title: "أُضيفت المرحلة" });
      setAddName("");
      setAddDays("0");
      refresh();
    },
    onError: (e) => fail(e, "تعذر إضافة المرحلة"),
  });

  const editMutation = useMutation({
    mutationFn: () =>
      apiPatch(`/api/workflow-stages?id=${editStage!.id}`, {
        stageName: editForm!.stageName.trim(),
        stageOrder: Math.trunc(editForm!.stageOrder),
        expectedDays: Math.max(0, Math.trunc(editForm!.expectedDays)),
        color: editForm!.color,
      }),
    onSuccess: () => {
      toast({ title: "تم تعديل المرحلة" });
      setEditStage(null);
      refresh();
    },
    onError: (e) => fail(e, "تعذر تعديل المرحلة"),
  });

  // تحريك لأعلى/لأسفل — تبديل الترتيب مع الجار في نفس (النوع + القالب)
  const moveMutation = useMutation({
    mutationFn: async ({ stage, dir }: { stage: WorkflowStageDTO; dir: -1 | 1 }) => {
      const group = filtered.filter((s) => s.contractType === stage.contractType);
      const idx = group.findIndex((s) => s.id === stage.id);
      const swapWith = group[idx + dir];
      if (!swapWith) return null;
      await apiPatch(`/api/workflow-stages?id=${stage.id}`, { stageOrder: swapWith.stageOrder });
      await apiPatch(`/api/workflow-stages?id=${swapWith.id}`, { stageOrder: stage.stageOrder });
      return true;
    },
    onSuccess: () => refresh(),
    onError: (e) => fail(e, "تعذر تغيير الترتيب"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/workflow-stages?id=${id}`),
    onSuccess: () => {
      toast({ title: "تم حذف المرحلة" });
      setDeleteTarget(null);
      refresh();
    },
    onError: (e) => {
      setDeleteTarget(null);
      fail(e, "تعذر حذف المرحلة");
    },
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">مراحل المتابعة والتنفيذ</CardTitle>
        <p className="text-xs text-muted-foreground">كل نوع عقد له شجرة مستقلة تُنسخ للعقود الجديدة.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-52 space-y-1">
            <Label className="text-xs text-muted-foreground">نوع المعاملة:</Label>
            <Select value={txType} onValueChange={setTxType}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TX_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <Label className="text-xs text-muted-foreground">مرحلة جديدة:</Label>
            <Input
              className="h-9"
              placeholder="اسم المرحلة الجديدة..."
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
            />
          </div>
          <div className="w-32 space-y-1">
            <Label className="text-xs text-muted-foreground">الأيام المتوقعة:</Label>
            <Input className="h-9" dir="ltr" type="number" min="0" max="999" value={addDays} onChange={(e) => setAddDays(e.target.value)} />
          </div>
          <Button size="sm" className="h-9 gap-1.5" disabled={addMutation.isPending || !addName.trim()} onClick={() => addMutation.mutate()}>
            <Plus className="size-4" />
            إضافة
          </Button>
        </div>

        {stagesQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 rounded-lg" />
            ))}
          </div>
        ) : stagesQuery.isError ? (
          <p className="py-6 text-center text-sm text-destructive">تعذر تحميل المراحل — {errMessage(stagesQuery.error)}</p>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">لا مراحل لهذا النوع بعد — أضف أول مرحلة من الأعلى.</p>
        ) : (
          <div className="max-h-96 overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted">
                <TableRow>
                  <TableHead className="w-12 text-center">#</TableHead>
                  <TableHead className="min-w-40">المرحلة</TableHead>
                  <TableHead className="w-28">قالب النوع</TableHead>
                  <TableHead className="w-24 text-center">الأيام المتوقعة</TableHead>
                  <TableHead className="w-16 text-center">اللون</TableHead>
                  <TableHead className="w-36 text-center">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s, i) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-center text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="whitespace-nowrap font-medium">{s.stageName}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{s.contractType || "القالب العام"}</TableCell>
                    <TableCell className="text-center tabular-nums">{s.expectedDays}</TableCell>
                    <TableCell className="text-center">
                      <span className="inline-block size-4 rounded-full border" style={{ backgroundColor: s.color || "#3B82F6" }} aria-label={s.color} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" className="size-7" aria-label="تحريك لأعلى" disabled={moveMutation.isPending} onClick={() => moveMutation.mutate({ stage: s, dir: -1 })}>
                          <ArrowUp className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-7" aria-label="تحريك لأسفل" disabled={moveMutation.isPending} onClick={() => moveMutation.mutate({ stage: s, dir: 1 })}>
                          <ArrowDown className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label="تعديل المرحلة"
                          onClick={() => {
                            setEditStage(s);
                            setEditForm({ stageName: s.stageName, stageOrder: s.stageOrder, expectedDays: s.expectedDays, color: s.color || "#3B82F6" });
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive" aria-label="حذف المرحلة" onClick={() => setDeleteTarget(s)}>
                          <Trash2 className="size-3.5" />
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

      {/* تعديل مرحلة */}
      <Dialog open={editStage !== null} onOpenChange={(v) => !v && setEditStage(null)}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-base">✎ تعديل المرحلة</DialogTitle>
            <DialogDescription>{TX_LABELS[editStage?.transactionType || ""] || ""}</DialogDescription>
          </DialogHeader>
          {editForm && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="wf-name">اسم المرحلة:*</Label>
                <Input id="wf-name" className="h-9" value={editForm.stageName} onChange={(e) => setEditForm({ ...editForm, stageName: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wf-order">الترتيب:</Label>
                  <Input id="wf-order" className="h-9" dir="ltr" type="number" value={String(editForm.stageOrder)} onChange={(e) => setEditForm({ ...editForm, stageOrder: Number(e.target.value || 0) })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wf-days">الأيام المتوقعة:</Label>
                  <Input id="wf-days" className="h-9" dir="ltr" type="number" min="0" max="999" value={String(editForm.expectedDays)} onChange={(e) => setEditForm({ ...editForm, expectedDays: Number(e.target.value || 0) })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wf-color">اللون:</Label>
                  <Input id="wf-color" className="h-9 w-full p-1" dir="ltr" type="color" value={editForm.color} onChange={(e) => setEditForm({ ...editForm, color: e.target.value })} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setEditStage(null)} disabled={editMutation.isPending}>إلغاء</Button>
            <Button className="h-9" disabled={editMutation.isPending || !editForm?.stageName.trim()} onClick={() => editMutation.mutate()}>
              {editMutation.isPending ? "جارٍ الحفظ…" : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأكيد حذف مرحلة */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المرحلة؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف «{deleteTarget?.stageName}». لا يمكن حذف مرحلة لها مراحل فرعية أو مرتبطة بقالب دفعات أو نطاق عقود.
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
    </Card>
  );
}
