'use client'

// ============================================================
// ConTrack Online — تهيئة الأنواع (3 تابات):
// 1) «الأنواع» — بطاقات الأنواع مع مراحلها وخطة الدفعات (العرض الأصلي)
// 2) «شجرة المراحل» — WorkflowEditor لكل نوع (إضافة/تعديل/حذف)
// 3) «قوالب الدفع» — قالب دفعات النوع (نسبة/ثابت/مرن + المرحلة المحفزة)
// القواعد الحرفية: «المرحلة↔دفعة واحدة» و«مرحلة واحدة = هي المحفزة تلقائيًا»
// ============================================================

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, BadgeDollarSign, ListTree, Loader2, Pencil, Plus, Trash2, Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { api, apiGet, type ContractTypeLite } from './api'
import { WorkflowEditor } from './WorkflowEditor'
import { adminApi } from '@/lib/admin-api'
import type { PaymentTemplateDTO, PaymentTemplateInput } from '@/lib/admin-types'
import { formatKWD } from '@/lib/format'


const payKindLabel: Record<string, string> = {
  advance: 'مقدمة',
  achieve: 'عند الإنجاز',
  final: 'ختامية',
  days: 'بالأيام',
}

/** بند من قالب دفعات النوع كما يرجعه GET /api/contract-types/[id]/template */
interface TypeTplItem {
  payNo: number
  title: string
  pct: number
  amountFixed: number
  triggerStageName: string
  daysOffset: number
  linkKeyword: string
}

/** كارت نوع عقد — يجلب شجرة مراحل النوع وقالب دفعاته من نقاط النهاية الفعلية */
function TypeCard({ t }: { t: ContractTypeLite }) {
  const stagesQ = useQuery({
    queryKey: ['type-card-stages', t.name],
    queryFn: () => adminApi.workflowStages(t.name),
    staleTime: 60_000,
  })
  const tplQ = useQuery({
    queryKey: ['type-card-template', t.id],
    queryFn: () => apiGet<{ items: TypeTplItem[] }>(`/api/contract-types/${t.id}/template`),
    staleTime: 60_000,
  })
  const stages = (stagesQ.data?.stages ?? []).filter((s) => s.childrenCount === 0)
  const payments = tplQ.data?.items ?? []

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base font-bold">{t.name}</CardTitle>
          <div className="flex gap-1.5 shrink-0">
            {t.isSupervision && <Badge className="bg-teal-100 text-teal-800 border border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-900">إشراف</Badge>}
            {t.manualTrack && <Badge variant="secondary">بلا قالب</Badge>}
          </div>
        </div>
        {t.defaultAmount > 0 && (
          <p className="text-xs text-muted-foreground">قيمة افتراضية: <span className="numeric font-semibold">{formatKWD(t.defaultAmount)}</span></p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-xs font-bold text-muted-foreground mb-2">
            مراحل القالب ({stages.length}){stagesQ.isLoading ? ' …' : ''}
          </p>
          {stagesQ.isLoading ? (
            <Skeleton className="h-20 rounded-lg" />
          ) : stages.length === 0 ? (
            <p className="text-xs text-muted-foreground border rounded-lg p-3 bg-muted/30">لا مراحل معرفة — عدّل من تاب «شجرة المراحل»</p>
          ) : (
            <ol className="space-y-1.5">
              {stages.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm bg-muted/40 rounded-lg px-3 py-2">
                  <span className="size-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center numeric shrink-0">
                    {s.stageOrder}
                  </span>
                  <span className="font-medium">{s.stageName}</span>
                  {s.expectedDays > 0 && <span className="text-[11px] text-muted-foreground numeric">{s.expectedDays} يومًا</span>}
                  {s.payPct > 0 && (
                    <Badge variant="outline" className="text-[10px] ms-auto numeric">
                      {payKindLabel[s.payKind] ?? s.payKind} {s.payPct}%
                    </Badge>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
        <div>
          <p className="text-xs font-bold text-muted-foreground mb-2">
            خطة الدفعات ({payments.length}){tplQ.isLoading ? ' …' : ''}
          </p>
          {tplQ.isLoading ? (
            <Skeleton className="h-20 rounded-lg" />
          ) : payments.length === 0 ? (
            <p className="text-xs text-muted-foreground border rounded-lg p-3 bg-muted/30">لا دفعات معرفة — عدّل من تاب «قوالب الدفع»</p>
          ) : (
            <ol className="space-y-1.5">
              {payments.map((p, i) => (
                <li key={`${p.payNo}-${i}`} className="flex flex-wrap items-center gap-2 text-sm border rounded-lg px-3 py-2">
                  <span className="size-5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[11px] font-bold flex items-center justify-center numeric shrink-0">
                    {p.payNo}
                  </span>
                  <span className="font-medium">{p.title}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {p.triggerStageName ? `عند «${p.triggerStageName}»` : 'بلا مرحلة محفزة'}
                    {p.daysOffset > 0 ? ` + ${p.daysOffset} يومًا` : ''}
                  </span>
                  <span className="ms-auto font-bold text-xs numeric">
                    {p.pct > 0 ? `${p.pct}%` : formatKWD(p.amountFixed)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function TypesView() {
  const [tab, setTab] = useState('types')
  const [selectedType, setSelectedType] = useState('')

  const { data: types, isLoading, error } = useQuery({ queryKey: ['contract-types'], queryFn: api.contractTypes })

  const typeName = useMemo(() => {
    if (!types?.length) return ''
    return types.some((t) => t.name === selectedType) ? selectedType : types[0].name
  }, [types, selectedType])

  const typeSelector = types && types.length > 0 && (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor="type-picker" className="text-sm text-muted-foreground">نوع العقد:</Label>
      <Select value={typeName} onValueChange={setSelectedType}>
        <SelectTrigger id="type-picker" className="h-11 w-full sm:w-64" aria-label="اختيار نوع العقد">
          <SelectValue placeholder="اختر النوع" />
        </SelectTrigger>
        <SelectContent>
          {types.map((t) => (
            <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-11 w-full sm:w-auto overflow-x-auto justify-start">
          <TabsTrigger value="types" className="px-4 gap-1.5">
            <Wallet className="size-4" aria-hidden />
            الأنواع
          </TabsTrigger>
          <TabsTrigger value="stages" className="px-4 gap-1.5">
            <ListTree className="size-4" aria-hidden />
            شجرة المراحل
          </TabsTrigger>
          <TabsTrigger value="payments" className="px-4 gap-1.5">
            <BadgeDollarSign className="size-4" aria-hidden />
            قوالب الدفع
          </TabsTrigger>
        </TabsList>

        {/* 1) بطاقات الأنواع — العرض الأصلي */}
        <TabsContent value="types" className="mt-4">
          <p className="text-sm text-muted-foreground mb-4">
            أنواع العقود النشطة وقوالبها (مراحل + خطة دفعات) — للتعديل استخدم تابَي «شجرة المراحل» و«قوالب الدفع»
          </p>
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3 text-sm">
              تعذر تحميل الأنواع: {(error as Error).message}
            </div>
          )}
          {isLoading ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-80 rounded-xl" />)}
            </div>
          ) : (types?.length ?? 0) === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">لا توجد أنواع عقود معرفة</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {(types ?? []).map((t) => <TypeCard key={t.id} t={t} />)}
            </div>
          )}
        </TabsContent>

        {/* 2) شجرة المراحل */}
        <TabsContent value="stages" className="mt-4">
          <div className="space-y-4">
            {typeSelector}
            {types?.length ? <WorkflowEditor contractTypeName={typeName} /> : null}
          </div>
        </TabsContent>

        {/* 3) قوالب الدفع */}
        <TabsContent value="payments" className="mt-4">
          <div className="space-y-4">
            {typeSelector}
            {types?.length ? <PaymentTemplatesPanel contractTypeName={typeName} /> : null}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ============================================================
// تاب قوالب الدفع — جدول القالب + حوار إضافة/تعديل
// ============================================================
const kindBadge: Record<PaymentTemplateDTO['kind'], { label: string; cls: string }> = {
  pct: { label: 'نسبة', cls: 'bg-emerald-100 text-emerald-800 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900' },
  fixed: { label: 'مبلغ ثابت', cls: 'bg-teal-100 text-teal-800 border border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-900' },
  flex: { label: 'مرن (0)', cls: 'bg-stone-100 text-stone-600 border border-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700' },
}

function valueLabel(p: PaymentTemplateDTO): string {
  if (p.kind === 'pct') return `${p.pct}%`
  if (p.kind === 'fixed') return formatKWD(p.amountFixed)
  return 'مرن — 0'
}

function PaymentTemplatesPanel({ contractTypeName }: { contractTypeName: string }) {
  const qc = useQueryClient()
  const [editorTpl, setEditorTpl] = useState<PaymentTemplateDTO | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<PaymentTemplateDTO | null>(null)

  const templatesQ = useQuery({
    queryKey: ['payment-templates', contractTypeName],
    queryFn: () => adminApi.paymentTemplates(contractTypeName),
    enabled: !!contractTypeName,
  })

  const stagesQ = useQuery({
    queryKey: ['workflow-stages', contractTypeName],
    queryFn: () => adminApi.workflowStages(contractTypeName),
    enabled: !!contractTypeName,
  })

  const leafStages = useMemo(
    () => (stagesQ.data?.stages ?? []).filter((s) => s.childrenCount === 0),
    [stagesQ.data?.stages],
  )

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminApi.deletePaymentTemplate(id),
    onSuccess: () => {
      toast.success('تم حذف الدفعة من القالب')
      setDeleting(null)
      qc.invalidateQueries({ queryKey: ['payment-templates', contractTypeName] })
      qc.invalidateQueries({ queryKey: ['contract-types'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['payment-templates', contractTypeName] })
    qc.invalidateQueries({ queryKey: ['contract-types'] })
  }

  const templates = templatesQ.data?.templates ?? []
  const nextPayNo = templates.length > 0 ? Math.max(...templates.map((t) => t.payNo)) + 1 : 1

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm text-muted-foreground">
            قالب دفعات «{contractTypeName}» — الدفعة تُحفَّز بمرحلة أو تُستحق بالأيام
          </p>
          <p className="text-[11px] text-muted-foreground">
            القواعد: المرحلة الواحدة تتبع دفعة واحدة فقط · مرحلة واحدة في الدفعة = هي المحفِّزة تلقائيًا ·
            دفعة بأكثر من مرحلة تستلزم تحديد المحفِّزة · الربط بخطوات التنفيذ (الفرعيات) فقط
          </p>
        </div>
        <Button className="h-11 gap-2 font-semibold" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden />
          دفعة جديدة
        </Button>
      </div>

      {templatesQ.error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3 text-sm">
          تعذر تحميل القالب: {(templatesQ.error as Error).message}
        </div>
      )}

      {templatesQ.isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <p className="text-sm text-muted-foreground">لا دفعات في قالب هذا النوع بعد</p>
            <p className="text-xs text-muted-foreground">
              {leafStages.length === 0
                ? 'أضف مراحل فرعية من تاب «شجرة المراحل» أولًا حتى تتمكن من ربط الدفعات بها'
                : 'أضف أول دفعة — يمكن ربطها بمرحلة محفزة أو جعلها مستحقة بالأيام'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start w-14">#</TableHead>
                    <TableHead className="text-start">الاسم</TableHead>
                    <TableHead className="text-start">القيمة</TableHead>
                    <TableHead className="text-start">المراحل المجمعة</TableHead>
                    <TableHead className="text-start">المرحلة المحفِّزة</TableHead>
                    <TableHead className="text-start">الاستحقاق</TableHead>
                    <TableHead className="text-start">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="numeric font-bold">{p.payNo}</TableCell>
                      <TableCell className="font-semibold max-w-40">
                        <span className="truncate block">{p.title}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="font-bold text-xs numeric">{valueLabel(p)}</span>
                          <Badge className={`text-[10px] w-fit ${kindBadge[p.kind].cls}`}>{kindBadge[p.kind].label}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-44">
                        <span className="truncate block">
                          {p.stages.length > 0 ? p.stages.map((s) => s.stageName).join('، ') : 'بالأيام (بلا مراحل)'}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {p.triggerStageName ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs numeric text-muted-foreground">
                        {p.daysOffset > 0 ? `+${p.daysOffset} يومًا` : 'فوري'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-0.5">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-9 w-9"
                            onClick={() => setEditorTpl(p)}
                            aria-label={`تعديل ${p.title}`}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-9 w-9 text-destructive hover:text-destructive"
                            onClick={() => setDeleting(p)}
                            aria-label={`حذف ${p.title}`}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <PaymentTplDialog
        open={creating || editorTpl != null}
        editing={editorTpl}
        defaultPayNo={nextPayNo}
        contractTypeName={contractTypeName}
        leafStages={leafStages}
        onClose={() => { setCreating(false); setEditorTpl(null) }}
        onSaved={invalidate}
      />

      <AlertDialog open={deleting != null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-600" aria-hidden />
              حذف الدفعة «{deleting?.title}»؟
            </AlertDialogTitle>
            <AlertDialogDescription>
              ستُحذف الدفعة رقم <span className="numeric">{deleting?.payNo}</span> من قالب النوع مع
              روابط مراحلها — العقود القائمة تحتفظ بلقطتها ولا تتأثر.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">تراجع</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
              onClick={(e) => {
                e.preventDefault()
                if (deleting) deleteMutation.mutate(deleting.id)
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
// حوار إضافة/تعديل دفعة
// ------------------------------------------------------------
function PaymentTplDialog({
  open,
  editing,
  defaultPayNo,
  contractTypeName,
  leafStages,
  onClose,
  onSaved,
}: {
  open: boolean
  editing: PaymentTemplateDTO | null
  defaultPayNo: number
  contractTypeName: string
  leafStages: { id: number; stageName: string; expectedDays: number }[]
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = editing != null

  const [payNo, setPayNo] = useState('')
  const [title, setTitle] = useState('')
  const [valueMode, setValueMode] = useState<PaymentTemplateInput['valueMode']>('pct')
  const [pct, setPct] = useState('0')
  const [amountFixed, setAmountFixed] = useState('0')
  const [stageIds, setStageIds] = useState<number[]>([])
  const [triggerStageId, setTriggerStageId] = useState<string>('auto')
  const [daysOffset, setDaysOffset] = useState('')
  const [initializedFor, setInitializedFor] = useState('')

  const key = editing ? `e${editing.id}` : 'new'
  if (open && initializedFor !== key) {
    setInitializedFor(key)
    if (editing) {
      setPayNo(String(editing.payNo))
      setTitle(editing.title)
      setValueMode(editing.kind)
      setPct(String(editing.pct))
      setAmountFixed(String(editing.amountFixed))
      setStageIds(editing.stages.map((s) => s.stageId))
      setTriggerStageId(editing.triggerStageId ? String(editing.triggerStageId) : 'auto')
      setDaysOffset(String(editing.daysOffset || ''))
    } else {
      setPayNo('')
      setTitle('')
      setValueMode('pct')
      setPct('0')
      setAmountFixed('0')
      setStageIds([])
      setTriggerStageId('auto')
      setDaysOffset('')
    }
  }
  if (!open && initializedFor) setInitializedFor('')

  const triggerResolved = triggerStageId === 'auto'
    ? (stageIds.length === 1 ? stageIds[0] : null)
    : Number(triggerStageId)

  const saveMutation = useMutation({
    mutationFn: () => {
      const input: PaymentTemplateInput = {
        contractType: contractTypeName,
        title: title.trim(),
        valueMode,
        pct: Number(pct) || 0,
        amountFixed: Number(amountFixed) || 0,
        stageIds,
        triggerStageId: triggerResolved,
        ...(payNo !== '' ? { payNo: Number(payNo) } : {}),
        ...(daysOffset !== '' ? { daysOffset: Number(daysOffset) } : {}),
      }
      if (isEdit && editing) {
        return adminApi.updatePaymentTemplate(editing.id, {
          payNo: input.payNo,
          title: input.title,
          valueMode: input.valueMode,
          pct: input.pct,
          amountFixed: input.amountFixed,
          stageIds: input.stageIds,
          triggerStageId: input.triggerStageId,
          daysOffset: input.daysOffset,
        })
      }
      return adminApi.addPaymentTemplate(input)
    },
    onSuccess: () => {
      toast.success(isEdit ? 'تم تعديل الدفعة' : 'تمت إضافة الدفعة إلى القالب')
      onSaved()
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function toggleStage(id: number, checked: boolean) {
    setStageIds((prev) => {
      const next = checked ? [...prev, id] : prev.filter((s) => s !== id)
      // إذا خرجت المرحلة المحفزة من المجموعة نعود للوضع التلقائي
      if (triggerResolved != null && !next.includes(triggerResolved)) setTriggerStageId('auto')
      return next
    })
  }

  function submit() {
    if (!title.trim()) {
      toast.error('اسم الدفعة إلزامي')
      return
    }
    if (valueMode === 'pct' && !(Number(pct) > 0)) {
      toast.error('أدخل نسبة أكبر من صفر أو اختر نمطًا آخر')
      return
    }
    if (valueMode === 'fixed' && !(Number(amountFixed) > 0)) {
      toast.error('أدخل مبلغًا أكبر من صفر أو اختر نمطًا آخر')
      return
    }
    if (stageIds.length > 1 && triggerResolved == null) {
      toast.error('الدفعة تجمع أكثر من مرحلة — حدد المرحلة المحفِّزة')
      return
    }
    saveMutation.mutate()
  }

  const showTriggerSelect = stageIds.length > 1

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BadgeDollarSign className="size-4 text-emerald-600" aria-hidden />
            {isEdit ? `تعديل الدفعة #${editing?.payNo}` : 'دفعة جديدة'}
          </DialogTitle>
          <DialogDescription>
            قالب نوع «{contractTypeName}» — إذا لم تحدد رقمًا سيكون التالي ({defaultPayNo})
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pt-title">اسم الدفعة *</Label>
            <Input id="pt-title" className="h-11" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: الدفعة الثانية" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pt-payno">رقم الدفعة</Label>
            <Input id="pt-payno" type="number" min={1} max={99} className="h-11 numeric" value={payNo} onChange={(e) => setPayNo(e.target.value)} placeholder={String(defaultPayNo)} />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>نمط القيمة *</Label>
            <div className="grid grid-cols-3 gap-2">
              {(['pct', 'fixed', 'flex'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setValueMode(m)}
                  className={`h-11 rounded-lg border text-sm font-semibold transition-colors ${valueMode === m ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted/50'}`}
                >
                  {m === 'pct' ? 'نسبة %' : m === 'fixed' ? 'مبلغ ثابت' : 'مرن (0)'}
                </button>
              ))}
            </div>
          </div>

          {valueMode === 'pct' && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="pt-pct">النسبة من قيمة العقد *</Label>
              <Input id="pt-pct" type="number" min={0} max={100} step="0.1" className="h-11 numeric" value={pct} onChange={(e) => setPct(e.target.value)} />
            </div>
          )}
          {valueMode === 'fixed' && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="pt-fixed">المبلغ الثابت *</Label>
              <Input id="pt-fixed" type="number" min={0} step="0.001" className="h-11 numeric" value={amountFixed} onChange={(e) => setAmountFixed(e.target.value)} />
            </div>
          )}
          {valueMode === 'flex' && (
            <p className="text-xs text-muted-foreground sm:col-span-2 rounded-lg bg-muted/40 px-3 py-2">
              الدفعة المرنة تُدرج بقيمة 0 ويُعبأ مبلغها لاحقًا عند إنشاء دفعات العقود
            </p>
          )}

          <div className="space-y-1.5 sm:col-span-2">
            <Label>مراحل الدفعة (خطوات التنفيذ — الفرعيات فقط)</Label>
            {leafStages.length === 0 ? (
              <p className="text-xs rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300 px-3 py-2">
                لا توجد مراحل فرعية لهذا النوع — أضفها من تاب «شجرة المراحل» أو اجعل الدفعة بالأيام
              </p>
            ) : (
              <div className="max-h-40 overflow-y-auto rounded-lg border divide-y">
                {leafStages.map((s) => (
                  <label key={s.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/40 cursor-pointer">
                    <Checkbox
                      checked={stageIds.includes(s.id)}
                      onCheckedChange={(c) => toggleStage(s.id, c === true)}
                      aria-label={`ربط ${s.stageName}`}
                    />
                    <span className="text-sm font-medium flex-1">{s.stageName}</span>
                    {s.expectedDays > 0 && <span className="text-[11px] text-muted-foreground numeric">{s.expectedDays} يومًا</span>}
                  </label>
                ))}
              </div>
            )}
          </div>

          {showTriggerSelect && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="pt-trigger">المرحلة المحفِّزة * (من مراحل الدفعة)</Label>
              <Select value={triggerStageId} onValueChange={setTriggerStageId}>
                <SelectTrigger id="pt-trigger" className="h-11 w-full" aria-label="المرحلة المحفزة">
                  <SelectValue placeholder="اختر المرحلة المحفزة" />
                </SelectTrigger>
                <SelectContent>
                  {stageIds.map((id) => {
                    const st = leafStages.find((s) => s.id === id)
                    return st ? <SelectItem key={id} value={String(id)}>{st.stageName}</SelectItem> : null
                  })}
                </SelectContent>
              </Select>
            </div>
          )}
          {stageIds.length === 1 && (
            <p className="text-[11px] text-muted-foreground sm:col-span-2">
              مرحلة واحدة فقط ⇒ «{leafStages.find((s) => s.id === stageIds[0])?.stageName}» هي المحفِّزة تلقائيًا
            </p>
          )}
          {stageIds.length === 0 && (
            <p className="text-[11px] text-muted-foreground sm:col-span-2">
              بلا مراحل = دفعة مستحقة بالأيام بلا محفِّز
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="pt-days">أيام بعد المرحلة (اختياري)</Label>
            <Input id="pt-days" type="number" min={0} className="h-11 numeric" value={daysOffset} onChange={(e) => setDaysOffset(e.target.value)} placeholder="افتراضي: أيام المرحلة المحفزة" />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={saveMutation.isPending}>إلغاء</Button>
          <Button className="h-11 gap-2" onClick={submit} disabled={saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {isEdit ? 'حفظ التعديلات' : 'إضافة الدفعة'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
