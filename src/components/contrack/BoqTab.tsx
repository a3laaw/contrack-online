'use client'

// ============================================================
// تبويب بنود العقد (BOQ) داخل مركز العقد — جدول بنود + صف إجمالي +
// بطاقة مقارنة بقيمة العقد + بحث فوري + حوار إضافة/تعديل +
// حذف ناعم (للمدير فقط) مع إبطال كاش boq/contract/dashboard +
// استيراد BOQ من ملف xlsx (معاينة ثم تنفيذ — docs/boq-import-design.md)
// ============================================================
import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, Calculator, ChevronDown, ClipboardList, FileSpreadsheet,
  Loader2, Pencil, Plus, Search, Trash2, Upload,
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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { ApiError } from './api'
import { boqApi } from '@/lib/boq-api'
import { formatKWD, round3 } from '@/lib/format'
import type { ContractDetailDTO, SessionUser } from '@/lib/contrack-types'
import type { BoqImportPreviewDTO, BoqItemDTO } from '@/lib/boq-types'

const EPS = 0.001
const UNITS = ['م²', 'م.ط', 'عدد', 'قطعة', 'يوم', 'شهر'] as const
const isAdminRole = (role: string) => role === 'admin' || role === 'developer'

interface BoqTabProps {
  contract: ContractDetailDTO
  user: SessionUser
}

export function BoqTab({ contract, user }: BoqTabProps) {
  const qc = useQueryClient()
  const isAdmin = isAdminRole(user.role)
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<{ mode: 'add' } | { mode: 'edit'; item: BoqItemDTO } | null>(null)
  const [deleting, setDeleting] = useState<BoqItemDTO | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['boq', contract.id],
    queryFn: () => boqApi.boqItems(contract.id),
  })

  const items = useMemo(() => data?.items ?? [], [data])
  const q = search.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      q
        ? items.filter(
            (i) =>
              i.description.toLowerCase().includes(q) ||
              (i.itemNo ?? '').toLowerCase().includes(q) ||
              (i.divisionName ?? '').toLowerCase().includes(q) ||
              i.unit.toLowerCase().includes(q) ||
              (i.stageName ?? '').toLowerCase().includes(q),
          )
        : items,
    [items, q],
  )
  const filteredTotal = round3(filtered.reduce((sum, i) => sum + i.total, 0))

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['boq', contract.id] })
    qc.invalidateQueries({ queryKey: ['contract', contract.id] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const deleteMutation = useMutation({
    mutationFn: (id: number) => boqApi.deleteBoqItem(id),
    onSuccess: () => {
      invalidate()
      setDeleting(null)
      toast.success('تم حذف البند من بنود العقد')
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  const diff = data?.diff ?? 0
  const isMatch = Math.abs(diff) <= EPS

  return (
    <div className="space-y-4">
      {/* شريط الأدوات */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary" className="numeric">{items.length} بند</Badge>
          <span className="text-muted-foreground">
            مجموع البنود: <span className="font-semibold numeric text-foreground">{formatKWD(data?.itemsTotal ?? 0)}</span>
          </span>
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2 sm:flex-none">
          <div className="relative w-full sm:w-64">
            <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث في البنود…"
              className="h-11 ps-9"
              aria-label="بحث في بنود العقد"
            />
          </div>
          <Button className="h-11 gap-2 font-semibold" onClick={() => setDialog({ mode: 'add' })}>
            <Plus className="size-4" aria-hidden />
            إضافة بند
          </Button>
          <Button variant="outline" className="h-11 gap-2" onClick={() => setImportOpen(true)}>
            <Upload className="size-4" aria-hidden />
            استيراد ملف BOQ
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3 text-sm">
          تعذر تحميل بنود العقد: {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center">
          <ClipboardList className="size-8 mx-auto mb-2 opacity-40" aria-hidden />
          <p className="text-sm text-muted-foreground mb-4">لا توجد بنود — أضف أول بند لجدول الكميات</p>
          <Button variant="outline" className="h-11 gap-2" onClick={() => setDialog({ mode: 'add' })}>
            <Plus className="size-4" aria-hidden />
            إضافة أول بند
          </Button>
        </div>
      ) : (
        <>
          {/* بطاقة المقارنة: مجموع البنود مقابل قيمة العقد */}
          {data && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Calculator className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
                  <h3 className="text-sm font-semibold">مقارنة البنود بقيمة العقد</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">مجموع البنود</p>
                    <p className="text-lg font-bold numeric mt-0.5">{formatKWD(data.itemsTotal)}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">قيمة العقد</p>
                    <p className="text-lg font-bold numeric mt-0.5">{formatKWD(data.contractAmount)}</p>
                  </div>
                  <div
                    className={`rounded-lg border p-3 ${
                      isMatch
                        ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40'
                        : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40'
                    }`}
                  >
                    <p className="text-xs text-muted-foreground">الفرق</p>
                    <p
                      className={`text-lg font-bold numeric mt-0.5 ${
                        isMatch ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {isMatch ? formatKWD(0) : formatKWD(Math.abs(diff))}
                    </p>
                    <p
                      className={`text-xs mt-0.5 ${
                        isMatch ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {isMatch
                        ? 'مطابق لقيمة العقد ✓'
                        : diff > 0
                          ? 'مجموع البنود أعلى من قيمة العقد'
                          : 'مجموع البنود أقل من قيمة العقد'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* جدول البنود — سطح المكتب */}
          <div className="hidden md:block rounded-xl border overflow-hidden">
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="text-start">رقم البند</TableHead>
                    <TableHead className="text-start">الوصف</TableHead>
                    <TableHead className="text-start">القسم</TableHead>
                    <TableHead className="text-start">الكمية</TableHead>
                    <TableHead className="text-start">الوحدة</TableHead>
                    <TableHead className="text-start">سعر الوحدة</TableHead>
                    <TableHead className="text-start">الإجمالي</TableHead>
                    <TableHead className="text-start">المرحلة</TableHead>
                    {isAdmin && <TableHead className="text-start">إجراءات</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell className="numeric whitespace-nowrap text-muted-foreground" dir="ltr">
                        {it.itemNo || '—'}
                      </TableCell>
                      <TableCell className="font-semibold max-w-72">
                        <span className="block truncate" title={it.description}>{it.description}</span>
                      </TableCell>
                      <TableCell>
                        {it.divisionName ? (
                          <Badge variant="outline" className="whitespace-nowrap">
                            <span className="numeric me-1 opacity-70" dir="ltr">{it.divisionCode}</span>
                            {it.divisionName}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="numeric">{it.qty}</TableCell>
                      <TableCell>{it.unit || '—'}</TableCell>
                      <TableCell className="numeric">{formatKWD(it.unitPrice)}</TableCell>
                      <TableCell className="font-semibold numeric">{formatKWD(it.total)}</TableCell>
                      <TableCell>
                        {it.stageName ? <Badge variant="outline">{it.stageName}</Badge> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-9 w-9"
                              onClick={() => setDialog({ mode: 'edit', item: it })}
                              aria-label={`تعديل البند ${it.description}`}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-9 w-9 text-destructive hover:text-destructive"
                              onClick={() => setDeleting(it)}
                              aria-label={`حذف البند ${it.description}`}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={isAdmin ? 9 : 8} className="text-center text-muted-foreground py-8">
                        لا توجد نتائج مطابقة للبحث
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableCell colSpan={6} className="font-bold">
                        الإجمالي ({filtered.length} {filtered.length === 1 ? 'بند' : 'بنود'})
                      </TableCell>
                      <TableCell className="font-bold numeric text-emerald-700 dark:text-emerald-400">
                        {formatKWD(filteredTotal)}
                      </TableCell>
                      <TableCell colSpan={isAdmin ? 2 : 1} />
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* بطاقات البنود — الجوال */}
          <div className="md:hidden space-y-2.5">
            {filtered.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">لا توجد نتائج مطابقة للبحث</p>
            ) : (
              filtered.map((it) => (
                <div key={it.id} className="rounded-xl border p-3.5 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {it.itemNo && (
                        <span className="numeric text-xs text-muted-foreground" dir="ltr">{it.itemNo}</span>
                      )}
                      <span className="font-bold text-sm leading-snug block">{it.description}</span>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {it.divisionName && (
                        <Badge variant="outline" className="text-xs">
                          <span className="numeric me-1 opacity-70" dir="ltr">{it.divisionCode}</span>
                          {it.divisionName}
                        </Badge>
                      )}
                      {it.stageName && <Badge variant="outline" className="text-xs">{it.stageName}</Badge>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <span className="text-muted-foreground">
                      الكمية: <span className="font-semibold numeric text-foreground">{it.qty}</span> {it.unit}
                    </span>
                    <span className="text-muted-foreground">
                      سعر الوحدة: <span className="font-semibold numeric text-foreground">{formatKWD(it.unitPrice)}</span>
                    </span>
                    <span className="text-muted-foreground col-span-2">
                      الإجمالي: <span className="font-bold numeric text-emerald-700 dark:text-emerald-400">{formatKWD(it.total)}</span>
                    </span>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="outline" className="h-10 gap-1.5 flex-1" onClick={() => setDialog({ mode: 'edit', item: it })}>
                        <Pencil className="size-3.5" aria-hidden />
                        تعديل
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-10 gap-1.5 flex-1 text-destructive hover:text-destructive"
                        onClick={() => setDeleting(it)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                        حذف
                      </Button>
                    </div>
                  )}
                </div>
              ))
            )}
            {filtered.length > 0 && (
              <div className="rounded-xl border bg-muted/50 p-3.5 flex items-center justify-between">
                <span className="font-bold text-sm">الإجمالي ({filtered.length} {filtered.length === 1 ? 'بند' : 'بنود'})</span>
                <span className="font-bold numeric text-emerald-700 dark:text-emerald-400">{formatKWD(filteredTotal)}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* حوار إضافة/تعديل بند — يُركَّب عند الفتح فقط لتفادي بقايا الحالة */}
      {/* حوار استيراد BOQ من ملف */}
      {importOpen && (
        <BoqImportDialog
          contract={contract}
          open
          onOpenChange={(o) => !o && setImportOpen(false)}
          onImported={invalidate}
        />
      )}

      {dialog && (
        <BoqItemDialog
          key={dialog.mode === 'edit' ? `edit-${dialog.item.id}` : 'add'}
          contract={contract}
          mode={dialog.mode}
          item={dialog.mode === 'edit' ? dialog.item : null}
          open
          onOpenChange={(o) => !o && setDialog(null)}
          onSaved={invalidate}
        />
      )}

      {/* تأكيد الحذف */}
      <AlertDialog open={deleting != null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد حذف البند</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف البند «{deleting?.description}» بإجمالي {formatKWD(deleting?.total ?? 0)} من بنود العقد
              (حذف ناعم مسجَّل في سجل أحداث العقد).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">تراجع</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (deleting) deleteMutation.mutate(deleting.id)
              }}
            >
              {deleteMutation.isPending && <Loader2 className="size-4 animate-spin me-1" />}
              حذف البند
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ------------------------------------------------------------
// حوار إضافة/تعديل بند BOQ
// ------------------------------------------------------------
function BoqItemDialog({
  contract, mode, item, open, onOpenChange, onSaved,
}: {
  contract: ContractDetailDTO
  mode: 'add' | 'edit'
  item: BoqItemDTO | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const isEdit = mode === 'edit' && item != null
  const [description, setDescription] = useState(item?.description ?? '')
  const [qty, setQty] = useState(item ? String(item.qty) : '1')
  const [unit, setUnit] = useState(item?.unit ?? '')
  const [unitPrice, setUnitPrice] = useState(item ? String(item.unitPrice) : '')
  const [stageId, setStageId] = useState(item?.stageId ? String(item.stageId) : '0')

  const mutation = useMutation({
    mutationFn: () => {
      const desc = description.trim()
      if (!desc) throw new Error('وصف البند مطلوب')
      const q = Number(qty)
      if (!isFinite(q) || q <= 0) throw new Error('الكمية يجب أن تكون رقمًا أكبر من صفر')
      const up = Number(unitPrice)
      if (!isFinite(up) || up < 0) throw new Error('سعر الوحدة يجب أن يكون رقمًا غير سالب')
      const payload = {
        description: desc,
        qty: round3(q),
        unit,
        unitPrice: round3(up),
        stageId: stageId !== '0' ? Number(stageId) : null,
      }
      return isEdit && item ? boqApi.updateBoqItem(item.id, payload) : boqApi.addBoqItem(contract.id, payload)
    },
    onSuccess: () => {
      onSaved()
      toast.success(isEdit ? 'تم حفظ تعديلات البند' : 'تمت إضافة البند إلى جدول الكميات')
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto">
        {open && (
          <>
            <DialogHeader>
              <DialogTitle>{isEdit ? 'تعديل بند' : 'إضافة بند جديد'}</DialogTitle>
              <DialogDescription>
                بنود العقد {contract.contractNumber} — الإجمالي = الكمية × سعر الوحدة
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-1">
              <div className="space-y-1.5">
                <Label htmlFor="boq-desc">وصف البند *</Label>
                <Input
                  id="boq-desc"
                  className="h-11"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="مثال: أعمال سبيكة للأسقف"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="boq-qty">الكمية *</Label>
                  <Input
                    id="boq-qty"
                    type="number"
                    step="0.001"
                    min="0"
                    inputMode="decimal"
                    dir="ltr"
                    className="h-11 numeric text-start"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="boq-unit">الوحدة</Label>
                  <Select value={unit || '0'} onValueChange={(v) => setUnit(v === '0' ? '' : v)}>
                    <SelectTrigger id="boq-unit" className="h-11 w-full"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      <SelectItem value="0">بدون وحدة</SelectItem>
                      {UNITS.map((u) => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="boq-price">سعر الوحدة (د.ك) *</Label>
                <Input
                  id="boq-price"
                  type="number"
                  step="0.001"
                  min="0"
                  inputMode="decimal"
                  dir="ltr"
                  className="h-11 numeric text-start"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  placeholder="0.000"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="boq-stage">المرحلة (اختياري)</Label>
                <Select value={stageId} onValueChange={setStageId}>
                  <SelectTrigger id="boq-stage" className="h-11 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    <SelectItem value="0">بدون ربط بمرحلة</SelectItem>
                    {contract.stages.filter((s) => !s.isSkipped).map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
              <Button className="h-11 gap-2" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
                {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
                {isEdit ? 'حفظ التعديلات' : 'إضافة البند'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------
// حوار استيراد BOQ من ملف xlsx — اختيار → معاينة → تأكيد
// (docs/boq-import-design.md §2.4)
// ------------------------------------------------------------
function BoqImportDialog({
  contract, open, onOpenChange, onImported,
}: {
  contract: ContractDetailDTO
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<BoqImportPreviewDTO | null>(null)
  const [openDiv, setOpenDiv] = useState<string | null>(null)

  const previewMutation = useMutation({
    mutationFn: (f: File) => boqApi.importPreview(contract.id, f),
    onSuccess: (data) => {
      setPreview(data)
      setOpenDiv(data.divisions[0]?.code ?? null)
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  const runMutation = useMutation({
    mutationFn: (f: File) => boqApi.importRun(contract.id, f),
    onSuccess: (data) => {
      toast.success(`تم استيراد ${data.created} بنداً من ملف BOQ (الإجمالي ${formatKWD(data.grandTotal)})`)
      onImported()
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  const pickFile = (f: File | null) => {
    if (!f) return
    if (!/\.xlsx$/i.test(f.name)) {
      toast.error('الصيغة المدعومة xlsx حصراً')
      return
    }
    setFile(f)
    setPreview(null)
    previewMutation.mutate(f)
  }

  const reset = () => {
    setFile(null)
    setPreview(null)
    setOpenDiv(null)
    previewMutation.reset()
    runMutation.reset()
  }

  const busy = previewMutation.isPending || runMutation.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && runMutation.isPending) return // لا إغلاق أثناء التنفيذ
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        {open && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileSpreadsheet className="size-5 text-emerald-700 dark:text-emerald-400" aria-hidden />
                استيراد جدول كميات (BOQ) من ملف
              </DialogTitle>
              <DialogDescription>
                ارفع ملف Excel بصيغة xlsx — يسحب النظام البنود المسعّرة بأرقامها وأقسامها ويتحقق
                مقابل الملخص العام في الملف إن وُجد. العقد {contract.contractNumber}.
              </DialogDescription>
            </DialogHeader>

            {/* الخطوة 1: اختيار الملف */}
            {!preview && (
              <div className="space-y-3 py-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="w-full rounded-xl border-2 border-dashed border-muted-foreground/30 hover:border-emerald-500/60 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition-colors p-8 text-center disabled:opacity-60"
                  aria-label="اختيار ملف BOQ"
                >
                  {busy ? (
                    <>
                      <Loader2 className="size-8 mx-auto mb-2 animate-spin text-muted-foreground" aria-hidden />
                      <span className="text-sm text-muted-foreground">جارٍ سحب البنود من الملف…</span>
                    </>
                  ) : (
                    <>
                      <Upload className="size-8 mx-auto mb-2 text-muted-foreground" aria-hidden />
                      <span className="text-sm font-semibold block mb-1">
                        {file ? file.name : 'اختر ملف BOQ (xlsx)'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        يدعم الملفات الكويتية بنمط POMI — أقسام مدنية وميكانيكية وكهربائية، صفحات التجميع،
                        وبنود المشمولات
                      </span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* الخطوة 2: المعاينة */}
            {preview && (
              <div className="space-y-4 py-1">
                {/* بطاقة الإجماليات */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">الأقسام</p>
                    <p className="text-lg font-bold numeric">{preview.divisions.length}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">البنود المسحوبة</p>
                    <p className="text-lg font-bold numeric">{preview.itemCount}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">إجمالي الملف</p>
                    <p className="text-lg font-bold numeric">{formatKWD(preview.grandTotal)}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">قيمة العقد</p>
                    <p className="text-lg font-bold numeric">{formatKWD(contract.amount)}</p>
                  </div>
                </div>

                {preview.existingCount > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                    <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden />
                    <span>
                      العقد يحتوي {preview.existingCount} بنداً قائماً — الاستيراد <b>يضيف إليها</b> ولا يستبدلها.
                    </span>
                  </div>
                )}

                {preview.warnings.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 px-3 py-2 space-y-1">
                    {preview.warnings.slice(0, 6).map((w, i) => (
                      <p key={i} className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
                        <AlertTriangle className="size-3.5 shrink-0 mt-0.5" aria-hidden />
                        <span>{w.message}</span>
                      </p>
                    ))}
                    {preview.warnings.length > 6 && (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        و{preview.warnings.length - 6} تنبيهاً آخر…
                      </p>
                    )}
                  </div>
                )}

                {/* الأقسام — قابلة للفتح لعينة بنود */}
                <div className="rounded-xl border divide-y max-h-80 overflow-y-auto">
                  {preview.divisions.map((d) => (
                    <div key={d.code}>
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted/50 transition-colors text-start"
                        onClick={() => setOpenDiv(openDiv === d.code ? null : d.code)}
                        aria-expanded={openDiv === d.code}
                      >
                        <ChevronDown
                          className={`size-4 shrink-0 text-muted-foreground transition-transform ${openDiv === d.code ? '' : '-rotate-90'}`}
                          aria-hidden
                        />
                        <Badge variant="secondary" className="numeric shrink-0" dir="ltr">{d.code}</Badge>
                        <span className="font-semibold text-sm truncate flex-1">{d.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0 numeric">{d.itemCount} بند</span>
                        <span className="text-sm font-bold numeric shrink-0">{formatKWD(d.total)}</span>
                      </button>
                      {openDiv === d.code && (
                        <div className="px-3 pb-3 space-y-1.5">
                          {d.items.map((it, i) => (
                            <div key={i} className="flex items-baseline gap-2 text-xs rounded-lg bg-muted/50 px-2.5 py-2">
                              <span className="numeric text-muted-foreground shrink-0 min-w-14 text-center" dir="ltr">
                                {it.itemNo || '—'}
                              </span>
                              <span className="flex-1 line-clamp-2 leading-relaxed">{it.description}</span>
                              <span className="numeric shrink-0 text-muted-foreground">{it.qty} {it.unit}</span>
                              <span className="numeric shrink-0 font-semibold">{formatKWD(it.amount)}</span>
                            </div>
                          ))}
                          {d.itemCount > d.items.length && (
                            <p className="text-xs text-muted-foreground text-center">
                              أول {d.items.length} من {d.itemCount} بنداً — سيُستورد الجميع عند التأكيد
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <p className="text-xs text-muted-foreground">
                  سطور شروح متخطاة: {preview.meta.narrativeLines} · مدمجة في الأوصاف: {preview.meta.mergedLines} ·
                  صفحات إجماليات معاد عرضها (سقطت): {preview.meta.recapPages}
                </p>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" className="h-11" disabled={runMutation.isPending} onClick={() => { reset(); onOpenChange(false) }}>
                {preview ? 'إلغاء' : 'إغلاق'}
              </Button>
              {preview && (
                <>
                  <Button variant="outline" className="h-11 gap-2" disabled={busy} onClick={() => fileRef.current?.click()}>
                    <Upload className="size-4" aria-hidden />
                    ملف آخر
                  </Button>
                  <Button
                    className="h-11 gap-2 font-semibold"
                    disabled={busy || preview.itemCount === 0}
                    onClick={() => file && runMutation.mutate(file)}
                  >
                    {runMutation.isPending && <Loader2 className="size-4 animate-spin" />}
                    استيراد {preview.itemCount} بنداً
                  </Button>
                </>
              )}
            </DialogFooter>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              className="sr-only"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
