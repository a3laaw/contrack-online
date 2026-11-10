'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Receipt } from 'lucide-react'
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
import { SearchableSelect } from './SearchableSelect'
import { api } from './api'
import { formatDate, formatKWD, PAYMENT_METHODS, round3, todayStr } from '@/lib/format'
import type { VoucherLinkInput } from '@/lib/contrack-types'

export interface LockedContract {
  id: number
  contractNumber: string
  contractName: string
  customerId: number
  customerName: string
}

interface ReceiptVoucherDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  lockedContract?: LockedContract | null
  onCreated: (message: string) => void
}

interface LineState {
  lineId: number
  title: string
  remaining: number
  amount: string
  checked: boolean
}

const EPS = 0.0005

export function ReceiptVoucherDialog({ open, onOpenChange, lockedContract, onCreated }: ReceiptVoucherDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        {open && <ReceiptVoucherForm lockedContract={lockedContract} onOpenChange={onOpenChange} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  )
}

function ReceiptVoucherForm({ lockedContract, onOpenChange, onCreated }: {
  lockedContract?: LockedContract | null
  onOpenChange: (open: boolean) => void
  onCreated: (message: string) => void
}) {
  const qc = useQueryClient()
  const [customerId, setCustomerId] = useState(lockedContract ? String(lockedContract.customerId) : '')
  const [contractId, setContractId] = useState('')
  const [vdate, setVdate] = useState(todayStr())
  const [method, setMethod] = useState('نقدًا')
  const [account, setAccount] = useState('الصندوق')
  const [description, setDescription] = useState(lockedContract ? `تحصيل على العقد ${lockedContract.contractNumber}` : '')
  const [lines, setLines] = useState<LineState[]>([])
  const [linesFor, setLinesFor] = useState<number | null>(null)
  const [amountOverride, setAmountOverride] = useState<string | null>(null)

  const { data: customers = [] } = useQuery({ queryKey: ['customers', ''], queryFn: () => api.customers('') })

  const { data: customerContracts = [] } = useQuery({
    queryKey: ['contracts', '', '', customerId],
    queryFn: () => api.contracts({ customerId: Number(customerId) }),
    enabled: !!customerId && !lockedContract,
  })

  const activeContractId = lockedContract ? lockedContract.id : Number(contractId) || 0
  const { data: detail } = useQuery({
    queryKey: ['contract', activeContractId],
    queryFn: () => api.contract(activeContractId),
    enabled: activeContractId > 0,
  })

  // ضبط قائمة الدفعات عند توفر تفاصيل عقد جديد (نمط الضبط أثناء التصيير)
  if (detail && linesFor !== detail.id) {
    setLinesFor(detail.id)
    setAmountOverride(null)
    setLines(
      detail.payments
        .filter((p) => p.remaining > EPS)
        .map((p) => ({ lineId: p.id, title: p.title, remaining: p.remaining, amount: '', checked: false })),
    )
  }

  const allocated = useMemo(
    () => round3(lines.filter((l) => l.checked).reduce((s, l) => s + (Number(l.amount) || 0), 0)),
    [lines],
  )
  const amount = amountOverride !== null ? amountOverride : allocated > 0 ? String(allocated) : ''

  function toggleLine(idx: number, checked: boolean) {
    setLines((ls) =>
      ls.map((l, i) =>
        i === idx ? { ...l, checked, amount: checked ? (l.amount || String(round3(l.remaining))) : l.amount } : l,
      ),
    )
  }

  const clientError = useMemo(() => {
    const num = Number(amount)
    if (allocated > num + EPS) return 'مجموع الدفعات المرتبطة يتجاوز مبلغ السند'
    for (const l of lines) {
      if (l.checked && Number(l.amount) > l.remaining + EPS) {
        return `المبلغ المُدخل للدفعة «${l.title}» يتجاوز المتبقي (${formatKWD(l.remaining)})`
      }
    }
    if (!lockedContract && !customerId) return 'اختيار العميل مطلوب'
    return ''
  }, [amount, allocated, lines, customerId, lockedContract])

  const mutation = useMutation({
    mutationFn: () => {
      const num = Number(amount)
      if (!isFinite(num) || num <= 0) throw new Error('مبلغ السند غير صالح')
      const linkInputs: VoucherLinkInput[] = lines
        .filter((l) => l.checked && Number(l.amount) > 0)
        .map((l) => ({ lineId: l.lineId, amount: round3(Number(l.amount)) }))
      return api.createVoucher({
        vtype: 'receipt',
        vdate,
        customerId: lockedContract ? lockedContract.customerId : Number(customerId),
        contractId: activeContractId || undefined,
        method,
        account,
        amount: round3(num),
        description,
        links: linkInputs,
      })
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['vouchers'] })
      qc.invalidateQueries({ queryKey: ['contract'] })
      qc.invalidateQueries({ queryKey: ['contracts'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onCreated(`تم إنشاء سند القبض ${res.voucherNumber} بمبلغ ${formatKWD(res.amount)}`)
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Receipt className="size-4 text-emerald-600" aria-hidden />
          سند قبض جديد
        </DialogTitle>
        <DialogDescription>اختر العميل والعقد ثم خصّص المبلغ على الدفعات المستحقة</DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 py-1 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>العميل *</Label>
          {lockedContract ? (
            <div className="h-11 flex items-center px-3 rounded-md border bg-muted/50 text-sm font-semibold">{lockedContract.customerName}</div>
          ) : (
            <SearchableSelect
              value={customerId}
              onValueChange={(v) => { setCustomerId(v); setContractId(''); setLines([]); setLinesFor(null); setAmountOverride(null) }}
              options={customers.map((c) => ({ value: String(c.id), label: `${c.name} (${c.customerCode})` }))}
              placeholder="اختر العميل"
              searchPlaceholder="ابحث بالاسم أو الكود…"
              emptyText="لا نتائج مطابقة"
              triggerClassName="h-11"
            />
          )}
        </div>

        <div className="space-y-1.5">
          <Label>العقد {allocated > 0 ? '*' : '(اختياري)'}</Label>
          {lockedContract ? (
            <div className="h-11 flex items-center px-3 rounded-md border bg-muted/50 text-sm font-semibold numeric" dir="ltr">{lockedContract.contractNumber}</div>
          ) : (
            <Select value={contractId} onValueChange={(v) => { setContractId(v); setAmountOverride(null) }}>
              <SelectTrigger className="h-11 w-full"><SelectValue placeholder={customerId ? 'اختر العقد' : 'اختر العميل أولًا'} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">بدون ربط بعقد</SelectItem>
                {customerContracts
                  .filter((c) => c.status !== 'ملغى')
                  .map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.contractNumber} — {c.contractName || c.contractType}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rv-date">تاريخ السند *</Label>
          <Input id="rv-date" type="date" className="h-11 numeric text-start" dir="ltr" value={vdate} onChange={(e) => setVdate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rv-method">طريقة الدفع</Label>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger id="rv-method" className="h-11 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAYMENT_METHODS.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rv-account">الحساب / الصندوق</Label>
          <Input id="rv-account" className="h-11" value={account} onChange={(e) => setAccount(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rv-amount">مبلغ السند (د.ك) *</Label>
          <Input
            id="rv-amount"
            type="number"
            step="0.001"
            min="0"
            inputMode="decimal"
            className="h-11 numeric text-start font-bold"
            dir="ltr"
            value={amount}
            onChange={(e) => setAmountOverride(e.target.value)}
            placeholder="0.000"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="rv-desc">الوصف</Label>
          <Input id="rv-desc" className="h-11" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="وصف العملية…" />
        </div>

        {/* الدفعات غير المسددة */}
        {activeContractId > 0 && (
          <div className="sm:col-span-2 space-y-2">
            <p className="text-xs font-bold text-muted-foreground">الدفعات غير المسددة للعقد</p>
            {lines.length === 0 ? (
              <p className="text-xs text-muted-foreground border rounded-lg p-3 bg-muted/30">جميع دفعات هذا العقد مسددة بالكامل 🎉</p>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-lg border divide-y">
                {lines.map((l, idx) => (
                  <div key={l.lineId} className="flex flex-wrap items-center gap-2 p-2.5">
                    <input
                      type="checkbox"
                      className="size-4 accent-emerald-600"
                      checked={l.checked}
                      onChange={(e) => toggleLine(idx, e.target.checked)}
                      aria-label={`ربط الدفعة ${l.title}`}
                    />
                    <span className="text-sm font-semibold min-w-36 flex-1">{l.title}</span>
                    <span className="text-[11px] text-muted-foreground">المتبقي <span className="numeric">{formatKWD(l.remaining)}</span></span>
                    <Input
                      type="number"
                      step="0.001"
                      min="0"
                      className="h-9 w-32 numeric text-start"
                      dir="ltr"
                      value={l.amount}
                      onChange={(e) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))}
                      disabled={!l.checked}
                      aria-label={`مبلغ التحصيل للدفعة ${l.title}`}
                    />
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs">
              مجموع المرتبط: <span className="font-bold numeric">{formatKWD(allocated)}</span>
              {' · '}
              التاريخ: <span className="numeric" dir="ltr">{formatDate(vdate)}</span>
            </p>
          </div>
        )}

        {clientError && (
          <div role="alert" className="sm:col-span-2 rounded-md border border-status-warn/40 bg-status-warn-bg text-status-warn text-sm px-3 py-2.5">
            {clientError}
          </div>
        )}
      </div>

      <DialogFooter className="gap-2">
        <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
        <Button
          className="h-11 gap-2"
          disabled={mutation.isPending || !!clientError || Number(amount) <= 0}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
          حفظ السند
        </Button>
      </DialogFooter>
    </>
  )
}
