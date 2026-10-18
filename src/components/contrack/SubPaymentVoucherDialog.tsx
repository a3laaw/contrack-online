'use client'

// ============================================================
// حوار سند صرف لدفعة عقد باطن — يرسل POST /api/vouchers مع
// subContractId + subLinks [{lineId, amount}] (kind='payment')
// ============================================================
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Banknote, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { subApi } from '@/lib/subcontract-api'
import { formatKWD, round3, todayStr } from '@/lib/format'
import type { SubContractDetailDTO, SubContractPaymentDTO } from '@/lib/subcontract-types'

const SUB_PAY_METHODS = ['نقدًا', 'تحويل بنكي', 'شيك'] as const

interface SubPaymentVoucherDialogProps {
  subContract: SubContractDetailDTO
  payment: SubContractPaymentDTO
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}

export function SubPaymentVoucherDialog({
  subContract, payment, open, onOpenChange, onDone,
}: SubPaymentVoucherDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto">
        {open && (
          <SubPaymentVoucherForm
            subContract={subContract}
            payment={payment}
            onOpenChange={onOpenChange}
            onDone={onDone}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function SubPaymentVoucherForm({
  subContract, payment, onOpenChange, onDone,
}: {
  subContract: SubContractDetailDTO
  payment: SubContractPaymentDTO
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const qc = useQueryClient()
  const remaining = round3(Math.max(0, payment.amount - payment.paidAmount))
  const [vdate, setVdate] = useState(todayStr())
  const [amount, setAmount] = useState(remaining > 0 ? String(remaining) : '')
  const [method, setMethod] = useState<string>('نقدًا')
  const [account, setAccount] = useState('الصندوق')
  const [description, setDescription] = useState('')

  const mutation = useMutation({
    mutationFn: () => {
      const num = Number(amount)
      if (!isFinite(num) || num <= 0) throw new Error('مبلغ السند يجب أن يكون أكبر من صفر')
      if (num > remaining + 0.0005) {
        throw new Error(`المبلغ يتجاوز المتبقي على الدفعة (${formatKWD(remaining)})`)
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(vdate)) throw new Error('تاريخ السند غير صالح')
      return subApi.createSubPaymentVoucher({
        vtype: 'payment',
        vdate,
        amount: round3(num),
        method,
        account: account.trim() || 'الصندوق',
        description: description.trim(),
        subContractId: subContract.id,
        subLinks: [{ lineId: payment.id, amount: round3(num) }],
      })
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['subcontract', subContract.id] })
      qc.invalidateQueries({ queryKey: ['subcontracts'] })
      qc.invalidateQueries({ queryKey: ['subcontractors'] })
      qc.invalidateQueries({ queryKey: ['vouchers'] })
      qc.invalidateQueries({ queryKey: ['contract', subContract.contractId] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(`تم إنشاء سند الصرف ${res.voucherNumber} بمبلغ ${formatKWD(res.amount)}`)
      onDone()
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Banknote className="size-4 text-amber-600" aria-hidden />
          سند صرف — دفعة باطن
        </DialogTitle>
        <DialogDescription>
          دفعة «{payment.title}» للعقد الباطن مع {subContract.subcontractorName} على العقد {subContract.contractNumber}
        </DialogDescription>
      </DialogHeader>

      <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">قيمة الدفعة</span>
          <span className="font-semibold numeric">{formatKWD(payment.amount)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">المصروف سابقًا</span>
          <span className="font-semibold numeric">{formatKWD(payment.paidAmount)}</span>
        </div>
        <div className="flex items-center justify-between border-t pt-1">
          <span className="text-muted-foreground">المتبقي</span>
          <span className="font-bold numeric text-amber-700 dark:text-amber-400">{formatKWD(remaining)}</span>
        </div>
      </div>

      <div className="grid gap-4 py-1 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="spv-date">تاريخ السند *</Label>
          <Input id="spv-date" type="date" dir="ltr" className="h-11 numeric text-start" value={vdate} onChange={(e) => setVdate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="spv-amount">المبلغ (د.ك) *</Label>
          <Input
            id="spv-amount"
            type="number"
            step="0.001"
            min="0"
            max={remaining}
            inputMode="decimal"
            dir="ltr"
            className="h-11 numeric text-start font-bold"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.000"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="spv-method">طريقة الدفع</Label>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger id="spv-method" className="h-11 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SUB_PAY_METHODS.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="spv-account">الحساب / الصندوق</Label>
          <Input id="spv-account" className="h-11" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="الصندوق / البنك الأهلي…" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="spv-desc">الوصف</Label>
          <Input id="spv-desc" className="h-11" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={`صرف ${payment.title} — ${subContract.subcontractorName}`} />
        </div>
      </div>

      <DialogFooter className="gap-2">
        <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
        <Button className="h-11 gap-2" disabled={mutation.isPending || remaining <= 0} onClick={() => mutation.mutate()}>
          {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
          حفظ السند
        </Button>
      </DialogFooter>
    </>
  )
}
