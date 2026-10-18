'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import { api } from './api'
import { formatKWD, PAYMENT_METHODS, round3, todayStr } from '@/lib/format'
import type { ExpenseAccountDTO } from '@/lib/contrack-types'

interface PaymentVoucherDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (message: string) => void
}

/** بناء خيارات الشجرة بمسافة بادئة حسب fullPath */
function accountOption(acc: ExpenseAccountDTO): { value: string; label: string; disabled: boolean } {
  const depth = acc.fullPath.split('/').length - 1
  const indent = '\u00A0\u00A0'.repeat(Math.max(0, depth - 1))
  return { value: String(acc.id), label: `${indent}${acc.name}`, disabled: !acc.allowPosting }
}

export function PaymentVoucherDialog({ open, onOpenChange, onCreated }: PaymentVoucherDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        {open && <PaymentVoucherForm onOpenChange={onOpenChange} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  )
}

function PaymentVoucherForm({ onOpenChange, onCreated }: {
  onOpenChange: (open: boolean) => void
  onCreated: (message: string) => void
}) {
  const qc = useQueryClient()
  const [vdate, setVdate] = useState(todayStr())
  const [party, setParty] = useState('')
  const [method, setMethod] = useState('نقدًا')
  const [account, setAccount] = useState('الصندوق')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [expenseAccountId, setExpenseAccountId] = useState('')
  const [contractId, setContractId] = useState('0')

  const { data: accounts = [] } = useQuery({ queryKey: ['expense-accounts'], queryFn: api.expenseAccounts })
  const { data: contracts = [] } = useQuery({ queryKey: ['contracts', '', '', ''], queryFn: () => api.contracts({}) })

  const options = useMemo(
    () => accounts.filter((a) => a.accountKind === 'expense' || a.accountKind === 'advance').map(accountOption),
    [accounts],
  )

  const mutation = useMutation({
    mutationFn: () => {
      const num = Number(amount)
      if (!party.trim()) throw new Error('اسم الجهة (المستفيد) مطلوب')
      if (!isFinite(num) || num <= 0) throw new Error('مبلغ السند غير صالح')
      return api.createVoucher({
        vtype: 'payment',
        vdate,
        party: party.trim(),
        method,
        account,
        amount: round3(num),
        description,
        expenseAccountId: expenseAccountId ? Number(expenseAccountId) : undefined,
        contractId: contractId !== '0' ? Number(contractId) : undefined,
      })
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['vouchers'] })
      qc.invalidateQueries({ queryKey: ['contract'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onCreated(`تم إنشاء سند الصرف ${res.voucherNumber} بمبلغ ${formatKWD(res.amount)}`)
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Banknote className="size-4 text-amber-600" aria-hidden />
          سند صرف جديد
        </DialogTitle>
        <DialogDescription>تسجيل صرف نقدي أو بنكي مع ربطه بحساب مصروف</DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 py-1 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pv-date">تاريخ السند *</Label>
          <Input id="pv-date" type="date" className="h-11 numeric text-start" dir="ltr" value={vdate} onChange={(e) => setVdate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pv-party">الجهة / المستفيد *</Label>
          <Input id="pv-party" className="h-11" value={party} onChange={(e) => setParty(e.target.value)} placeholder="مثال: شركة الوقود الوطنية" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pv-amount">المبلغ (د.ك) *</Label>
          <Input id="pv-amount" type="number" step="0.001" min="0" inputMode="decimal" className="h-11 numeric text-start font-bold" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.000" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pv-method">طريقة الدفع</Label>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger id="pv-method" className="h-11 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAYMENT_METHODS.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pv-account">الحساب / الصندوق</Label>
          <Input id="pv-account" className="h-11" value={account} onChange={(e) => setAccount(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pv-exp">حساب المصروف</Label>
          <Select value={expenseAccountId || undefined} onValueChange={setExpenseAccountId}>
            <SelectTrigger id="pv-exp" className="h-11 w-full"><SelectValue placeholder="اختر حساب المصروف" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="pv-contract">ربط بعقد (اختياري)</Label>
          <Select value={contractId} onValueChange={setContractId}>
            <SelectTrigger id="pv-contract" className="h-11 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">بدون ربط</SelectItem>
              {contracts.filter((c) => c.status !== 'ملغى').map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.contractNumber} — {c.contractName || c.customer.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="pv-desc">الوصف</Label>
          <Input id="pv-desc" className="h-11" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="وصف العملية…" />
        </div>
      </div>

      <DialogFooter className="gap-2">
        <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
        <Button className="h-11 gap-2" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
          حفظ السند
        </Button>
      </DialogFooter>
    </>
  )
}
