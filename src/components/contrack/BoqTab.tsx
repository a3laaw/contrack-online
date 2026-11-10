'use client'

// ============================================================
// تبويب بنود العقد (BOQ) داخل مركز العقد — جدول بنود + صف إجمالي +
// بطاقة مقارنة بقيمة العقد + بحث فوري + حوار إضافة/تعديل +
// حذف ناعم (للمدير فقط) مع إبطال كاش boq/contract/dashboard
// ============================================================
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Calculator, ClipboardList, Loader2, Pencil, Plus, Search, Trash2,
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
import type { BoqItemDTO } from '@/lib/boq-types'

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
                    <TableHead className="text-start">الوصف</TableHead>
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
                      <TableCell className="font-semibold max-w-72">
                        <span className="block truncate">{it.description}</span>
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
                      <TableCell colSpan={isAdmin ? 7 : 6} className="text-center text-muted-foreground py-8">
                        لا توجد نتائج مطابقة للبحث
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableCell colSpan={4} className="font-bold">
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
                    <span className="font-bold text-sm leading-snug">{it.description}</span>
                    {it.stageName && <Badge variant="outline" className="shrink-0 text-xs">{it.stageName}</Badge>}
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
