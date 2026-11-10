'use client'

// ============================================================
// تبويب عقود الباطن داخل مركز العقد — بطاقات قابلة للتوسيع تُظهر
// البنود وخطة الدفعات + سند صرف لكل دفعة + إضافة دفعة/عقد باطن
// ============================================================
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown, ChevronUp, Layers, Loader2, Plus, ReceiptText, Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { ApiError } from './api'
import { SubContractDialog } from './SubContractDialog'
import { SubPaymentVoucherDialog } from './SubPaymentVoucherDialog'
import { subApi } from '@/lib/subcontract-api'
import { formatDate, formatKWD, round3, statusBadgeClass, todayStr } from '@/lib/format'
import type { ContractDetailDTO, ContractStageDTO, SessionUser } from '@/lib/contrack-types'
import type {
  SubContractDetailDTO,
  SubContractListItem,
  SubContractPaymentDTO,
} from '@/lib/subcontract-types'

const EPS = 0.0005
const canDelete = (role: string) => role === 'admin' || role === 'developer'

type PayStatus = 'مسدد' | 'متأخر' | 'مستحق'

function paymentStatus(p: SubContractPaymentDTO): PayStatus {
  if (p.amount - p.paidAmount <= EPS) return 'مسدد'
  const today = formatDate(new Date())
  if (formatDate(p.dueDate) < today) return 'متأخر'
  return 'مستحق'
}

function PayStatusBadge({ status }: { status: PayStatus }) {
  const cls: Record<PayStatus, string> = {
    'مسدد': 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
    'متأخر': 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900',
    'مستحق': 'bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700',
  }
  return <Badge className={`${cls[status]} border`}>{status}</Badge>
}

interface SubContractsTabProps {
  contract: ContractDetailDTO
  user: SessionUser
}

export function SubContractsTab({ contract, user }: SubContractsTabProps) {
  const qc = useQueryClient()
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [payDialog, setPayDialog] = useState<{ sc: SubContractDetailDTO; payment: SubContractPaymentDTO } | null>(null)

  const { data: subs, isLoading, error } = useQuery({
    queryKey: ['subcontracts', 'contract', contract.id],
    queryFn: () => subApi.subcontracts({ contractId: contract.id }),
  })

  const totalAmount = round3((subs ?? []).filter((s) => s.status !== 'ملغى').reduce((sum, s) => sum + s.amount, 0))
  const totalPaid = round3((subs ?? []).reduce((sum, s) => sum + s.paidAmount, 0))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary" className="numeric">{subs?.length ?? 0} عقد باطن</Badge>
          <span className="text-muted-foreground">
            إجمالي القيم: <span className="font-semibold numeric text-foreground">{formatKWD(totalAmount)}</span>
          </span>
          <span className="text-muted-foreground">
            المسدد: <span className="font-semibold numeric text-emerald-700 dark:text-emerald-400">{formatKWD(totalPaid)}</span>
          </span>
        </div>
        <Button className="h-11 gap-2 font-semibold" onClick={() => setAddDialogOpen(true)}>
          <Plus className="size-4" aria-hidden />
          إسناد عقد باطن
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3 text-sm">
          تعذر تحميل العقود الباطنة: {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : (subs?.length ?? 0) === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          <Layers className="size-8 mx-auto mb-2 opacity-40" aria-hidden />
          لا توجد عقود باطن مسندة لهذا العقد — استخدم زر «إسناد عقد باطن» للبدء
        </div>
      ) : (
        <div className="space-y-3">
          {(subs ?? []).map((s) => (
            <SubContractCard
              key={s.id}
              item={s}
              contract={contract}
              user={user}
              expanded={expandedId === s.id}
              onToggle={() => setExpandedId((cur) => (cur === s.id ? null : s.id))}
              onVoucher={(sc, p) => setPayDialog({ sc, payment: p })}
            />
          ))}
        </div>
      )}

      <SubContractDialog
        contract={contract}
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onCreated={(m) => toast.success(m)}
      />

      {payDialog && (
        <SubPaymentVoucherDialog
          subContract={payDialog.sc}
          payment={payDialog.payment}
          open
          onOpenChange={(o) => !o && setPayDialog(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['subcontract', payDialog.sc.id] })
            qc.invalidateQueries({ queryKey: ['subcontracts'] })
          }}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------
// بطاقة عقد باطن واحدة مع تفاصيل قابلة للتوسيع
// ------------------------------------------------------------
interface SubContractCardProps {
  item: SubContractListItem
  contract: ContractDetailDTO
  user: SessionUser
  expanded: boolean
  onToggle: () => void
  onVoucher: (sc: SubContractDetailDTO, payment: SubContractPaymentDTO) => void
}

function SubContractCard({ item, contract, user, expanded, onToggle, onVoucher }: SubContractCardProps) {
  const pct = item.amount > 0 ? Math.min(100, (item.paidAmount / item.amount) * 100) : 0

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['subcontract', item.id],
    queryFn: () => subApi.subContract(item.id),
    enabled: expanded,
  })

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {/* رأس البطاقة */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold">{item.subcontractorName}</span>
              <Badge className={`${statusBadgeClass(item.status)} border`}>{item.status}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {item.description || 'بدون وصف'} — {item.paymentsCount} دفعة، {item.itemsCount} بند
            </p>
          </div>
          <Button size="sm" variant="outline" className="h-9 gap-1.5 shrink-0" onClick={onToggle} aria-expanded={expanded}>
            {expanded ? <ChevronUp className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
            {expanded ? 'إخفاء التفاصيل' : 'التفاصيل'}
          </Button>
        </div>

        {/* المبالغ والتقدم */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">قيمة العقد الباطن</p>
            <p className="font-semibold numeric">{formatKWD(item.amount)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">المسدد</p>
            <p className="font-semibold numeric text-emerald-700 dark:text-emerald-400">{formatKWD(item.paidAmount)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">المتبقي</p>
            <p className="font-semibold numeric text-amber-700 dark:text-amber-400">{formatKWD(round3(Math.max(0, item.amount - item.paidAmount)))}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">المدة</p>
            <p className="numeric text-xs mt-0.5" dir="ltr">
              {item.startDate ? formatDate(item.startDate) : '—'} ← {item.endDate ? formatDate(item.endDate) : '—'}
            </p>
          </div>
        </div>
        <Progress value={pct} className="h-2" aria-label={`نسبة المسدد ${(pct).toFixed(0)}%`} />

        {/* التفاصيل الموسعة */}
        {expanded && (
          <div className="border-t pt-3 space-y-5">
            {detailLoading || !detail ? (
              <div className="space-y-2">
                <Skeleton className="h-8 rounded-lg" />
                <Skeleton className="h-24 rounded-lg" />
              </div>
            ) : (
              <>
                {/* البنود */}
                <section aria-label="بنود العقد الباطن">
                  <h4 className="text-sm font-semibold mb-2">البنود ({detail.items.length})</h4>
                  {detail.items.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">لا توجد بنود مرتبطة بهذا العقد الباطن</p>
                  ) : (
                    <div className="max-h-60 overflow-y-auto rounded-xl border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-start">الوصف</TableHead>
                            <TableHead className="text-start">الكمية</TableHead>
                            <TableHead className="text-start">سعر الوحدة</TableHead>
                            <TableHead className="text-start">المبلغ</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detail.items.map((it) => (
                            <TableRow key={it.id}>
                              <TableCell className="max-w-60"><span className="truncate block">{it.description}</span></TableCell>
                              <TableCell className="numeric">{it.qty}</TableCell>
                              <TableCell className="numeric">{formatKWD(it.unitPrice)}</TableCell>
                              <TableCell className="font-semibold numeric">{formatKWD(it.amount)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </section>

                {/* خطة الدفعات */}
                <SubPaymentsSection detail={detail} stages={contract.stages} user={user} onVoucher={onVoucher} />
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ------------------------------------------------------------
// قسم خطة دفعات العقد الباطن (جدول سطح مكتب + بطاقات جوال)
// ------------------------------------------------------------
function SubPaymentsSection({
  detail, stages, user, onVoucher,
}: {
  detail: SubContractDetailDTO
  stages: ContractStageDTO[]
  user: SessionUser
  onVoucher: (sc: SubContractDetailDTO, payment: SubContractPaymentDTO) => void
}) {
  const qc = useQueryClient()
  const [addPayOpen, setAddPayOpen] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: (id: number) => subApi.deleteSubPayment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subcontract', detail.id] })
      qc.invalidateQueries({ queryKey: ['subcontracts'] })
      toast.success('تم حذف الدفعة')
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  return (
    <section aria-label="خطة دفعات العقد الباطن">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold">الدفعات ({detail.payments.length})</h4>
        <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => setAddPayOpen(true)}>
          <Plus className="size-3.5" aria-hidden />
          إضافة دفعة
        </Button>
      </div>

      {detail.payments.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">لا توجد دفعات مسجلة — أضف دفعة لبدء الصرف</p>
      ) : (
        <>
          {/* سطح المكتب */}
          <div className="hidden md:block rounded-xl border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الدفعة</TableHead>
                  <TableHead className="text-start">الاستحقاق</TableHead>
                  <TableHead className="text-start">المبلغ</TableHead>
                  <TableHead className="text-start">المسدد</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  <TableHead className="text-start">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.payments.map((p) => {
                  const remaining = round3(p.amount - p.paidAmount)
                  const st = paymentStatus(p)
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-semibold">{p.title}</TableCell>
                      <TableCell className="numeric">{formatDate(p.dueDate)}</TableCell>
                      <TableCell className="font-semibold numeric">{formatKWD(p.amount)}</TableCell>
                      <TableCell className="numeric text-emerald-700 dark:text-emerald-400">{formatKWD(p.paidAmount)}</TableCell>
                      <TableCell><PayStatusBadge status={st} /></TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {remaining > EPS && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9 gap-1.5"
                              onClick={() => onVoucher(detail, p)}
                            >
                              <ReceiptText className="size-3.5" aria-hidden />
                              سند صرف
                            </Button>
                          )}
                          {canDelete(user.role) && p.paidAmount <= EPS && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-9 w-9 text-destructive hover:text-destructive"
                              disabled={deleteMutation.isPending}
                              onClick={() => deleteMutation.mutate(p.id)}
                              aria-label={`حذف الدفعة ${p.title}`}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {/* الجوال */}
          <div className="md:hidden space-y-2.5">
            {detail.payments.map((p) => {
              const remaining = round3(p.amount - p.paidAmount)
              const st = paymentStatus(p)
              return (
                <div key={p.id} className="rounded-xl border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm">{p.title}</span>
                    <PayStatusBadge status={st} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <span className="text-muted-foreground">الاستحقاق: <span className="numeric" dir="ltr">{formatDate(p.dueDate)}</span></span>
                    <span>المبلغ: <span className="font-semibold numeric">{formatKWD(p.amount)}</span></span>
                    <span>المسدد: <span className="font-semibold numeric text-emerald-700 dark:text-emerald-400">{formatKWD(p.paidAmount)}</span></span>
                    <span>المتبقي: <span className="font-semibold numeric text-amber-700 dark:text-amber-400">{formatKWD(remaining)}</span></span>
                  </div>
                  <div className="flex gap-2 pt-1">
                    {remaining > EPS && (
                      <Button size="sm" variant="outline" className="h-10 gap-1.5 flex-1" onClick={() => onVoucher(detail, p)}>
                        <ReceiptText className="size-3.5" aria-hidden />
                        سند صرف
                      </Button>
                    )}
                    {canDelete(user.role) && p.paidAmount <= EPS && (
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-10 w-10 text-destructive"
                        disabled={deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate(p.id)}
                        aria-label={`حذف الدفعة ${p.title}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <AddSubPaymentDialog
        subContract={detail}
        stages={stages}
        open={addPayOpen}
        onOpenChange={setAddPayOpen}
      />
    </section>
  )
}

// ------------------------------------------------------------
// حوار إضافة دفعة إلى العقد الباطن
// ------------------------------------------------------------
function AddSubPaymentDialog({
  subContract, stages, open, onOpenChange,
}: {
  subContract: SubContractDetailDTO
  stages: ContractStageDTO[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const [title, setTitle] = useState(`الدفعة ${subContract.payments.length + 1}`)
  const [dueDate, setDueDate] = useState(todayStr())
  const [amount, setAmount] = useState('')
  const [stageId, setStageId] = useState('0')

  const mutation = useMutation({
    mutationFn: () => {
      if (!title.trim()) throw new Error('عنوان الدفعة مطلوب')
      const num = Number(amount)
      if (!isFinite(num) || num <= 0) throw new Error('مبلغ الدفعة يجب أن يكون أكبر من صفر')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error('تاريخ الاستحقاق غير صالح')
      return subApi.addSubPayment(subContract.id, {
        title: title.trim(),
        dueDate,
        amount: round3(num),
        stageId: stageId !== '0' ? Number(stageId) : null,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subcontract', subContract.id] })
      qc.invalidateQueries({ queryKey: ['subcontracts'] })
      qc.invalidateQueries({ queryKey: ['subcontractors'] })
      toast.success('تمت إضافة الدفعة إلى خطة العقد الباطن')
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[92vh] overflow-y-auto">
        {open && (
          <>
            <DialogHeader>
              <DialogTitle>إضافة دفعة باطن</DialogTitle>
              <DialogDescription>
                على العقد الباطن مع {subContract.subcontractorName} — {subContract.contractNumber}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-1">
              <div className="space-y-1.5">
                <Label htmlFor="asp-title">عنوان الدفعة *</Label>
                <Input id="asp-title" className="h-11" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: الدفعة الثانية" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="asp-due">تاريخ الاستحقاق *</Label>
                  <Input id="asp-due" type="date" dir="ltr" className="h-11 numeric text-start" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="asp-amount">المبلغ (د.ك) *</Label>
                  <Input id="asp-amount" type="number" step="0.001" min="0" inputMode="decimal" dir="ltr" className="h-11 numeric text-start" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.000" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="asp-stage">المرحلة المحفزة (اختياري)</Label>
                <Select value={stageId} onValueChange={setStageId}>
                  <SelectTrigger id="asp-stage" className="h-11 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    <SelectItem value="0">بدون ربط بمرحلة</SelectItem>
                    {stages.filter((s) => !s.isSkipped).map((s) => (
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
                إضافة الدفعة
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
