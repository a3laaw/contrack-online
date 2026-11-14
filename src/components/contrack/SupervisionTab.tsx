'use client'

// ============================================================
// تبويب الإشراف الهندسي داخل مركز العقد — بطاقات الإعدادات + جدول
// الجدول الشهري (مع badge «ملغى») + تفعيل/تعديل الإعدادات
// (التعديل للمدير فقط — السكرتير يرى القراءة فقط مع تنبيه لطيف)
// ============================================================
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Info, Loader2, Pencil, Plus, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { ApiError } from './api'
import { boqApi } from '@/lib/boq-api'
import { formatDate, formatKWD, monthStartStr, round3 } from '@/lib/format'
import type { ContractDetailDTO, SessionUser } from '@/lib/contrack-types'
import type { SupervisionDTO } from '@/lib/boq-types'

const isAdminRole = (role: string) => role === 'admin' || role === 'developer'

interface SupervisionTabProps {
  contract: ContractDetailDTO
  user: SessionUser
}

export function SupervisionTab({ contract, user }: SupervisionTabProps) {
  const qc = useQueryClient()
  const isAdmin = isAdminRole(user.role)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['supervision', contract.id],
    queryFn: () => boqApi.supervision(contract.id),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['supervision', contract.id] })
    qc.invalidateQueries({ queryKey: ['contract', contract.id] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  let body: React.ReactNode
  if (isLoading) {
    body = (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  } else if (error) {
    body = (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3 text-sm">
        تعذر تحميل بيانات الإشراف الهندسي: {(error as Error).message}
      </div>
    )
  } else if (!data || data.supMonths === 0) {
    body = (
      <div className="py-12 text-center">
        <ShieldCheck className="size-8 mx-auto mb-2 opacity-40" aria-hidden />
        <p className="text-sm text-muted-foreground mb-4">لم يُفعَّل الإشراف الهندسي لهذا العقد بعد</p>
        {isAdmin ? (
          <Button className="h-11 gap-2 font-semibold" onClick={() => setSettingsOpen(true)}>
            <Plus className="size-4" aria-hidden />
            تفعيل الإشراف
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">تفعيل الإشراف متاح للمدير فقط</p>
        )}
      </div>
    )
  } else {
    body = (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900 border">
            الإشراف مُفعَّل — {data.supMonths} شهرًا
          </Badge>
          {isAdmin ? (
            <Button variant="outline" className="h-11 gap-2" onClick={() => setSettingsOpen(true)}>
              <Pencil className="size-4" aria-hidden />
              تعديل الإعدادات
            </Button>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="size-3.5 shrink-0" aria-hidden />
              عرض للقراءة فقط — تعديل إعدادات الإشراف متاح للمدير
            </p>
          )}
        </div>

        {/* بطاقات الإعدادات */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <StatCard label="تاريخ البدء" value={formatDate(data.supStartDate)} />
          <StatCard label="عدد الشهور" value={String(data.supMonths)} />
          <StatCard label="الرسم الشهري" value={formatKWD(data.supMonthly)} />
          <StatCard label="الخصم الشهري" value={formatKWD(data.supDiscount)} />
          <StatCard label="الفعلي بعد الخصم" value={formatKWD(data.effectiveMonthly)} tone="emerald" />
          <StatCard
            label="الشهور الملغاة"
            value={String(data.supWaivedMonths)}
            tone={data.supWaivedMonths > 0 ? 'amber' : 'default'}
          />
          <StatCard label="إجمالي قيمة الإشراف" value={formatKWD(data.totalContractValue)} tone="emerald" strong />
        </div>

        {data.supWaivedMonths > 0 && data.supWaiveReason && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 px-4 py-3 text-sm">
            <span className="font-semibold">سبب إلغاء الشهور: </span>
            {data.supWaiveReason}
          </div>
        )}

        {/* الجدول الشهري */}
        <section aria-label="الجدول الشهري للإشراف الهندسي">
          <h3 className="text-sm font-semibold mb-2">
            الجدول الشهري ({data.schedule.length} {data.schedule.length === 1 ? 'شهر' : 'شهرًا'})
          </h3>

          {/* سطح المكتب */}
          <div className="hidden md:block rounded-xl border overflow-hidden">
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="text-start">#</TableHead>
                    <TableHead className="text-start">الشهر المتوقع</TableHead>
                    <TableHead className="text-start">التاريخ</TableHead>
                    <TableHead className="text-start">الأساس</TableHead>
                    <TableHead className="text-start">المستحق</TableHead>
                    <TableHead className="text-start">الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.schedule.map((r) => (
                    <TableRow key={r.seq} className={r.waived ? 'text-muted-foreground' : undefined}>
                      <TableCell className="numeric">{r.seq}</TableCell>
                      <TableCell className="font-semibold">{r.monthLabel}</TableCell>
                      <TableCell className="numeric" dir="ltr">
                        {r.expectedDate ? formatDate(r.expectedDate) : '—'}
                      </TableCell>
                      <TableCell className="numeric">{formatKWD(r.baseAmount)}</TableCell>
                      <TableCell className={`font-semibold numeric ${r.waived ? 'line-through' : ''}`}>
                        {formatKWD(r.amount)}
                      </TableCell>
                      <TableCell>
                        {r.waived ? (
                          <Badge className="bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900 border">
                            ملغى
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableCell colSpan={4} className="font-bold">إجمالي المستحق</TableCell>
                    <TableCell className="font-bold numeric text-emerald-700 dark:text-emerald-400">
                      {formatKWD(data.totalContractValue)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>

          {/* الجوال */}
          <div className="md:hidden rounded-xl border overflow-hidden">
            <div className="max-h-96 overflow-y-auto divide-y">
              {data.schedule.map((r) => (
                <div key={r.seq} className="flex items-center justify-between gap-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold flex items-center gap-2">
                      <span className="numeric text-muted-foreground text-xs">{r.seq}.</span>
                      {r.monthLabel}
                      {r.waived && (
                        <Badge className="bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900 border text-[10px] px-1.5">
                          ملغى
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground numeric" dir="ltr">
                      {r.expectedDate ? formatDate(r.expectedDate) : '—'}
                    </p>
                  </div>
                  <span className={`text-sm font-bold numeric shrink-0 ${r.waived ? 'line-through text-muted-foreground' : 'text-emerald-700 dark:text-emerald-400'}`}>
                    {formatKWD(r.amount)}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between px-3 py-2.5 bg-muted/50">
                <span className="font-bold text-sm">إجمالي المستحق</span>
                <span className="font-bold numeric text-emerald-700 dark:text-emerald-400">
                  {formatKWD(data.totalContractValue)}
                </span>
              </div>
            </div>
          </div>
        </section>
      </>
    )
  }

  return (
    <div className="space-y-4">
      {body}

      {settingsOpen && (
        <SupervisionSettingsDialog
          contract={contract}
          initial={data && data.supMonths > 0 ? data : null}
          open
          onOpenChange={setSettingsOpen}
          onSaved={invalidate}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------
// بطاقة إحصائية صغيرة
// ------------------------------------------------------------
function StatCard({
  label, value, tone = 'default', strong = false,
}: {
  label: string
  value: string
  tone?: 'default' | 'emerald' | 'amber'
  strong?: boolean
}) {
  const valCls =
    tone === 'emerald'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'amber'
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-foreground'
  return (
    <div className="rounded-xl border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`numeric mt-0.5 ${strong ? 'text-lg' : 'text-base'} font-bold ${valCls}`}>{value}</p>
    </div>
  )
}

// ------------------------------------------------------------
// حوار تفعيل/تعديل إعدادات الإشراف (مدير فقط)
// ------------------------------------------------------------
function SupervisionSettingsDialog({
  contract, initial, open, onOpenChange, onSaved,
}: {
  contract: ContractDetailDTO
  initial: SupervisionDTO | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const qc = useQueryClient()
  const isEnable = initial == null
  const [supStartDate, setSupStartDate] = useState(initial?.supStartDate ? initial.supStartDate.slice(0, 10) : monthStartStr())
  const [months, setMonths] = useState(initial ? String(initial.supMonths) : '12')
  const [monthly, setMonthly] = useState(initial ? String(initial.supMonthly) : '')
  const [discount, setDiscount] = useState(initial ? String(initial.supDiscount) : '0')
  const [waived, setWaived] = useState(initial ? String(initial.supWaivedMonths) : '0')
  const [reason, setReason] = useState(initial?.supWaiveReason ?? '')

  const mutation = useMutation({
    mutationFn: () => {
      const m = Number(months)
      if (!Number.isInteger(m) || m < 0 || m > 120) {
        throw new Error('عدد الشهور يجب أن يكون رقمًا صحيحًا بين 0 و120')
      }
      const mo = Number(monthly)
      if (!isFinite(mo) || mo < 0) throw new Error('الرسم الشهري يجب أن يكون رقمًا غير سالب')
      const di = Number(discount)
      if (!isFinite(di) || di < 0) throw new Error('الخصم الشهري يجب أن يكون رقمًا غير سالب')
      const w = Number(waived)
      if (!isFinite(w) || w < 0) throw new Error('الشهور الملغاة يجب أن تكون رقمًا غير سالب')
      if (w > m) throw new Error('الشهور الملغاة لا يمكن أن تتجاوز عدد الشهور')
      const r = reason.trim()
      if (w > 0 && !r) throw new Error('سبب إلغاء الشهور إلزامي عند وجود شهور ملغاة')
      return boqApi.updateSupervision(contract.id, {
        supStartDate: supStartDate || null,
        supMonths: m,
        supMonthly: round3(mo),
        supDiscount: round3(di),
        supWaivedMonths: w,
        supWaiveReason: r,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supervision', contract.id] })
      qc.invalidateQueries({ queryKey: ['contract', contract.id] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(isEnable ? 'تم تفعيل الإشراف الهندسي للعقد' : 'تم حفظ تعديلات الإشراف الهندسي')
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  const waivedNum = Number(waived)
  const needReason = isFinite(waivedNum) && waivedNum > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto">
        {open && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
                {isEnable ? 'تفعيل الإشراف الهندسي' : 'تعديل إعدادات الإشراف'}
              </DialogTitle>
              <DialogDescription>
                على العقد {contract.contractNumber} — إجمالي الإشراف = (الرسم الشهري − الخصم) × (الشهور − الملغاة)
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-1 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sup-start">تاريخ البدء</Label>
                <Input
                  id="sup-start"
                  type="date"
                  dir="ltr"
                  className="h-11 numeric text-start"
                  value={supStartDate}
                  onChange={(e) => setSupStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-months">عدد الشهور (0-120) *</Label>
                <Input
                  id="sup-months"
                  type="number"
                  min="0"
                  max="120"
                  step="1"
                  inputMode="numeric"
                  dir="ltr"
                  className="h-11 numeric text-start"
                  value={months}
                  onChange={(e) => setMonths(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-monthly">الرسم الشهري (د.ك) *</Label>
                <Input
                  id="sup-monthly"
                  type="number"
                  step="0.001"
                  min="0"
                  inputMode="decimal"
                  dir="ltr"
                  className="h-11 numeric text-start"
                  value={monthly}
                  onChange={(e) => setMonthly(e.target.value)}
                  placeholder="0.000"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-discount">الخصم الشهري (د.ك)</Label>
                <Input
                  id="sup-discount"
                  type="number"
                  step="0.001"
                  min="0"
                  inputMode="decimal"
                  dir="ltr"
                  className="h-11 numeric text-start"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-waived">شهور ملغاة</Label>
                <Input
                  id="sup-waived"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  dir="ltr"
                  className="h-11 numeric text-start"
                  value={waived}
                  onChange={(e) => setWaived(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-reason">سبب الإلغاء {needReason ? '*' : '(إن وُجد إلغاء)'}</Label>
                <Input
                  id="sup-reason"
                  className="h-11"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="مثال: توقف المشروع بقرار الجهة المالكة"
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
              <Button className="h-11 gap-2" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
                {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
                {isEnable ? 'تفعيل الإشراف' : 'حفظ التعديلات'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
