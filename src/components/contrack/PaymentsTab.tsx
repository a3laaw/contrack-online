'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { BellRing, Loader2, Pencil } from 'lucide-react'
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
import { api, ApiError } from './api'
import { formatDate, formatKWD, round3 } from '@/lib/format'
import type { PaymentDTO } from '@/lib/contrack-types'

interface PaymentsTabProps {
  contractId: number
  payments: PaymentDTO[]
  isLoading?: boolean
}

function StatusBadge({ status }: { status: PaymentDTO['status'] }) {
  const cls: Record<PaymentDTO['status'], string> = {
    'مسدد': 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
    'متأخر': 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900',
    'مُحفز': 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
    'مستحق': 'bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700',
  }
  return <Badge className={`${cls[status]} border`}>{status}</Badge>
}

export function PaymentsTab({ contractId, payments, isLoading }: PaymentsTabProps) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<PaymentDTO | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editDue, setEditDue] = useState('')
  const [editNotes, setEditNotes] = useState('')

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['contract', contractId] })
    qc.invalidateQueries({ queryKey: ['contracts'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const editMutation = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error('لا توجد دفعة محددة')
      const amount = Number(editAmount)
      return api.updatePayment(editing.id, {
        amount: isFinite(amount) && amount > 0 ? round3(amount) : undefined,
        dueDate: editDue || undefined,
        notes: editNotes,
      })
    },
    onSuccess: () => {
      invalidate()
      toast.success('تم حفظ تعديلات الدفعة')
      setEditing(null)
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  const triggerMutation = useMutation({
    mutationFn: (id: number) => api.triggerPayment(id, new Date().toISOString().slice(0, 10)),
    onSuccess: () => {
      invalidate()
      toast.success('تم تحفيز الدفعة — أصبحت مستحقة للتحصيل')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function openEdit(p: PaymentDTO) {
    setEditing(p)
    setEditAmount(String(p.amount))
    setEditDue(p.dueDate ? p.dueDate.slice(0, 10) : '')
    setEditNotes(p.notes ?? '')
  }

  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
  }
  if (payments.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        لا توجد دفعات مسجلة لهذا العقد
      </div>
    )
  }

  return (
    <>
      {/* سطح المكتب */}
      <div className="hidden md:block rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-start">الدفعة</TableHead>
              <TableHead className="text-start">المرحلة المحفزة</TableHead>
              <TableHead className="text-start">الاستحقاق</TableHead>
              <TableHead className="text-start">المبلغ</TableHead>
              <TableHead className="text-start">المسدد</TableHead>
              <TableHead className="text-start">المتبقي</TableHead>
              <TableHead className="text-start">الحالة</TableHead>
              <TableHead className="text-start">إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-semibold">{p.title}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{p.stageName ?? '—'}</TableCell>
                <TableCell className="numeric">{formatDate(p.dueDate)}</TableCell>
                <TableCell className="font-semibold numeric">{formatKWD(p.amount)}</TableCell>
                <TableCell className="numeric text-emerald-700 dark:text-emerald-400">{formatKWD(p.paidAmount)}</TableCell>
                <TableCell className={`numeric ${p.remaining > 0.0005 ? 'text-amber-700 dark:text-amber-400' : ''}`}>{formatKWD(p.remaining)}</TableCell>
                <TableCell><StatusBadge status={p.status} /></TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    {p.triggeredAt == null && p.status !== 'مسدد' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 gap-1.5"
                        disabled={triggerMutation.isPending}
                        onClick={() => triggerMutation.mutate(p.id)}
                      >
                        <BellRing className="size-3.5" aria-hidden />
                        تحفيز
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => openEdit(p)} aria-label={`تعديل الدفعة ${p.title}`}>
                      <Pencil className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* الجوال */}
      <div className="md:hidden space-y-3">
        {payments.map((p) => (
          <div key={p.id} className="rounded-xl border p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-sm">{p.title}</span>
              <StatusBadge status={p.status} />
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground">الاستحقاق: <span className="numeric" dir="ltr">{formatDate(p.dueDate)}</span></span>
              <span className="text-muted-foreground">المرحلة: {p.stageName ?? '—'}</span>
              <span>المبلغ: <span className="font-semibold numeric">{formatKWD(p.amount)}</span></span>
              <span>المسدد: <span className="font-semibold numeric text-emerald-700 dark:text-emerald-400">{formatKWD(p.paidAmount)}</span></span>
            </div>
            <div className="flex gap-2 pt-1">
              {p.triggeredAt == null && p.status !== 'مسدد' && (
                <Button size="sm" variant="outline" className="h-10 gap-1.5 flex-1" disabled={triggerMutation.isPending} onClick={() => triggerMutation.mutate(p.id)}>
                  <BellRing className="size-3.5" aria-hidden />
                  تحفيز
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-10 gap-1.5 flex-1" onClick={() => openEdit(p)}>
                <Pencil className="size-3.5" aria-hidden />
                تعديل
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* حوار تعديل الدفعة */}
      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>تعديل الدفعة — {editing?.title}</DialogTitle>
            <DialogDescription>يمكن تعديل المبلغ وتاريخ الاستحقاق والملاحظات</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="p-amount">المبلغ (د.ك)</Label>
              <Input id="p-amount" type="number" step="0.001" min="0" className="h-11 numeric text-start" dir="ltr" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-due">تاريخ الاستحقاق</Label>
              <Input id="p-due" type="date" className="h-11 numeric text-start" dir="ltr" value={editDue} onChange={(e) => setEditDue(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-notes">ملاحظات</Label>
              <Input id="p-notes" className="h-11" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-11" onClick={() => setEditing(null)}>إلغاء</Button>
            <Button className="h-11 gap-2" disabled={editMutation.isPending} onClick={() => editMutation.mutate()}>
              {editMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
