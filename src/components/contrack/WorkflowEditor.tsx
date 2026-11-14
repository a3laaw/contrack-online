'use client'

// ============================================================
// ConTrack Online — محرر شجرة مراحل نوع العقد (WorkflowStage)
// يُركَب داخل TypesView (تاب «شجرة المراحل»):
// - رئيسيات + فرعيات (parentName) مرتبة بـ stageOrder
// - إضافة/تعديل/حذف بحارس: مرحلة مرّت بها عقود أو لها أبناء ⇒ لا تُحذف
// عبر /api/workflow-stages (spec-8-f §7.2)
// ============================================================

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, CornerDownRight, ListTree, Loader2, Pencil, Plus, ShieldCheck, Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { adminApi } from '@/lib/admin-api'
import { payKindLabel } from '@/lib/admin-types'
import type { WorkflowStageDTO, WorkflowStagePatch } from '@/lib/admin-types'

export interface WorkflowEditorProps {
  /** اسم نوع العقد (نصي كالأصل — مراحل العقد مرتبطة بنوع إلزامي) */
  contractTypeName: string
}

interface EditorTarget {
  mode: 'new' | 'edit'
  parent?: WorkflowStageDTO | null
  stage?: WorkflowStageDTO
}

interface DeleteTarget {
  stage: WorkflowStageDTO
  usageNote: string
}

export function WorkflowEditor({ contractTypeName }: WorkflowEditorProps) {
  const qc = useQueryClient()
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null)

  const stagesQ = useQuery({
    queryKey: ['workflow-stages', contractTypeName],
    queryFn: () => adminApi.workflowStages(contractTypeName),
    enabled: !!contractTypeName,
  })

  const tree = useMemo(() => {
    const stages = stagesQ.data?.stages ?? []
    const mains = stages.filter((s) => s.parentId == null)
    return mains.map((m) => ({
      stage: m,
      children: stages.filter((s) => s.parentId === m.id),
    }))
  }, [stagesQ.data?.stages])

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminApi.deleteStage(id),
    onSuccess: () => {
      toast.success('تم حذف المرحلة')
      setDeleting(null)
      qc.invalidateQueries({ queryKey: ['workflow-stages', contractTypeName] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!contractTypeName) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">اختر نوع عقد أولًا</p>
    )
  }

  const contractsCount = stagesQ.data?.contractsCount ?? 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <ListTree className="size-4 text-primary" aria-hidden />
            شجرة مراحل «{contractTypeName}»
          </span>
          {contractsCount > 0 ? (
            <Badge className="gap-1 bg-status-warn-bg text-status-warn border border-status-warn/40">
              <ShieldCheck className="size-3" aria-hidden />
              عقود على هذا النوع: <span className="numeric">{contractsCount}</span> — المراحل المستخدمة محمية من الحذف
            </Badge>
          ) : (
            <Badge variant="secondary">بلا عقود بعد — الحذف حر مع فك روابط الدفعات</Badge>
          )}
        </div>
        <Button className="h-11 gap-2 font-semibold" onClick={() => setEditor({ mode: 'new', parent: null })}>
          <Plus className="size-4" aria-hidden />
          مرحلة رئيسية
        </Button>
      </div>

      {stagesQ.error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3 text-sm">
          تعذر تحميل الشجرة: {(stagesQ.error as Error).message}
        </div>
      )}

      {stagesQ.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
        </div>
      ) : tree.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            لا مراحل لهذا النوع بعد — ابدأ بإضافة مرحلة رئيسية ثم فرعياتها
          </CardContent>
        </Card>
      ) : (
        <div className="max-h-96 overflow-y-auto rounded-lg border">
          <div className="divide-y">
            {tree.map(({ stage, children }) => (
              <div key={stage.id}>
                <StageRow
                  stage={stage}
                  onEdit={() => setEditor({ mode: 'edit', stage })}
                  onAddChild={() => setEditor({ mode: 'new', parent: stage })}
                  onDelete={() =>
                    setDeleting({
                      stage,
                      usageNote: contractsCount > 0 && stage.usageCount > 0
                        ? '⚠️ عقود من هذا النوع مرّت بهذه المرحلة — الحذف سيُرفض'
                        : 'سيُفكّ ربط أي دفعات مرتبطة بها قبل الحذف',
                    })
                  }
                />
                {children.length > 0 && (
                  <div className="bg-muted/20">
                    {children.map((child) => (
                      <StageRow
                        key={child.id}
                        stage={child}
                        isChild
                        onEdit={() => setEditor({ mode: 'edit', stage: child })}
                        onDelete={() =>
                          setDeleting({
                            stage: child,
                            usageNote: contractsCount > 0 && child.usageCount > 0
                              ? '⚠️ عقود من هذا النوع مرّت بهذه المرحلة — الحذف سيُرفض'
                              : 'سيُفكّ ربط أي دفعات مرتبطة بها قبل الحذف',
                          })
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <StageDialog
        target={editor}
        contractTypeName={contractTypeName}
        onClose={() => setEditor(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['workflow-stages', contractTypeName] })
          qc.invalidateQueries({ queryKey: ['contract-types'] })
        }}
      />

      <AlertDialog open={deleting != null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-600" aria-hidden />
              حذف المرحلة «{deleting?.stage.stageName}»؟
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.usageNote}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">تراجع</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
              onClick={(e) => {
                e.preventDefault()
                if (deleting) deleteMutation.mutate(deleting.stage.id)
              }}
            >
              {deleteMutation.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              <Trash2 className="size-4" aria-hidden />
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ------------------------------------------------------------
// صف مرحلة
// ------------------------------------------------------------
function StageRow({
  stage,
  isChild = false,
  onEdit,
  onAddChild,
  onDelete,
}: {
  stage: WorkflowStageDTO
  isChild?: boolean
  onEdit: () => void
  onAddChild?: () => void
  onDelete: () => void
}) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2.5 ${isChild ? 'ps-8' : ''}`}>
      {isChild ? (
        <CornerDownRight className="size-4 text-muted-foreground shrink-0" aria-hidden />
      ) : (
        <span
          className="size-3 rounded-full shrink-0 border border-black/10"
          style={{ backgroundColor: stage.color }}
          aria-hidden
        />
      )}
      <span className="size-6 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center numeric shrink-0">
        {stage.stageOrder}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-sm truncate">{stage.stageName}</span>
          {stage.childrenCount > 0 && (
            <Badge variant="secondary" className="text-[10px] numeric">
              {stage.childrenCount} فرعية
            </Badge>
          )}
          {stage.usageCount > 0 && (
            <Badge className="text-[10px] bg-status-warn-bg text-status-warn border border-status-warn/40">
              مستخدمة في عقود
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
          {stage.expectedDays > 0 && <span className="numeric">{stage.expectedDays} يومًا</span>}
          {stage.payPct > 0 && (
            <span className="numeric">
              {payKindLabel(stage.payKind)} {stage.payPct}%
            </span>
          )}
          {stage.isPreContract && <span>ما قبل التعاقد</span>}
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {!isChild && (
          <Button size="icon" variant="ghost" className="h-9 w-9" onClick={onAddChild} aria-label={`إضافة فرعية تحت ${stage.stageName}`} title="إضافة مرحلة فرعية">
            <CornerDownRight className="size-4" />
          </Button>
        )}
        <Button size="icon" variant="ghost" className="h-9 w-9" onClick={onEdit} aria-label={`تعديل ${stage.stageName}`}>
          <Pencil className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive hover:text-destructive" onClick={onDelete} aria-label={`حذف ${stage.stageName}`}>
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// حوار إضافة/تعديل مرحلة
// ------------------------------------------------------------
function StageDialog({
  target,
  contractTypeName,
  onClose,
  onSaved,
}: {
  target: EditorTarget | null
  contractTypeName: string
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = target?.mode === 'edit'
  const stage = target?.stage

  const [name, setName] = useState('')
  const [expectedDays, setExpectedDays] = useState('0')
  const [payPct, setPayPct] = useState('0')
  const [payKind, setPayKind] = useState('')
  const [sortOrder, setSortOrder] = useState('')
  const [initializedFor, setInitializedFor] = useState('')

  const key = isEdit && stage ? `e${stage.id}` : target?.parent ? `n-${target.parent.id}` : 'n'
  if (target && initializedFor !== key) {
    setInitializedFor(key)
    setName(stage?.stageName ?? '')
    setExpectedDays(String(stage?.expectedDays ?? 0))
    setPayPct(String(stage?.payPct ?? 0))
    setPayKind(stage?.payKind ?? '')
    setSortOrder('')
  }
  if (!target && initializedFor) setInitializedFor('')

  const mutation = useMutation({
    mutationFn: () => {
      if (isEdit && stage) {
        const patch: WorkflowStagePatch = {
          name,
          expectedDays: Number(expectedDays) || 0,
          payKind,
          payPct: Number(payPct) || 0,
        }
        if (sortOrder !== '') patch.sortOrder = Number(sortOrder) || 0
        return adminApi.updateStage(stage.id, patch)
      }
      return adminApi.addStage({
        contractType: contractTypeName,
        name,
        parentName: target?.parent?.stageName ?? null,
        expectedDays: Number(expectedDays) || 0,
        payPct: Number(payPct) || 0,
        payKind,
        ...(sortOrder !== '' ? { sortOrder: Number(sortOrder) || 0 } : {}),
      })
    },
    onSuccess: () => {
      toast.success(isEdit ? 'تم تعديل المرحلة' : 'تمت إضافة المرحلة')
      onSaved()
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function submit() {
    if (!name.trim()) {
      toast.error('اسم المرحلة إلزامي')
      return
    }
    mutation.mutate()
  }

  return (
    <Dialog open={target != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `تعديل المرحلة — ${stage?.stageName}` : 'مرحلة جديدة'}
          </DialogTitle>
          <DialogDescription>
            {target?.parent
              ? `فرعية تحت «${target.parent.stageName}» في نوع «${contractTypeName}»`
              : `مرحلة رئيسية في نوع «${contractTypeName}»`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="st-name">اسم المرحلة *</Label>
            <Input id="st-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: الأساسات" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-days">المدة المتوقعة (أيام)</Label>
            <Input id="st-days" type="number" min={0} className="h-11 numeric" value={expectedDays} onChange={(e) => setExpectedDays(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-order">الترتيب (اختياري)</Label>
            <Input id="st-order" type="number" min={0} className="h-11 numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} placeholder="افتراضي: آخر الترتيب" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-paykind">نوع الدفع</Label>
            <Select value={payKind} onValueChange={setPayKind}>
              <SelectTrigger id="st-paykind" className="h-11 w-full" aria-label="نوع الدفع">
                <SelectValue placeholder="بلا" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">بلا</SelectItem>
                <SelectItem value="achieve">عند الإنجاز</SelectItem>
                <SelectItem value="advance">مقدمة</SelectItem>
                <SelectItem value="final">ختامية</SelectItem>
                <SelectItem value="days">بالأيام</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-paypct">نسبة الدفع %</Label>
            <Input
              id="st-paypct"
              type="number"
              min={0}
              max={100}
              step="0.1"
              className="h-11 numeric"
              value={payPct}
              onChange={(e) => setPayPct(e.target.value)}
              disabled={!payKind}
            />
            {payKind && !(Number(payPct) > 0) && (
              <p className="text-[11px] text-amber-600">تحديد نوع الدفع يستلزم نسبة أكبر من صفر</p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={mutation.isPending}>إلغاء</Button>
          <Button className="h-11 gap-2" onClick={submit} disabled={mutation.isPending || (!!payKind && !(Number(payPct) > 0))}>
            {mutation.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {isEdit ? 'حفظ التعديلات' : 'إضافة المرحلة'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
