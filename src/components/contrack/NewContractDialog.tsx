'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, CheckCircle2, FilePlus2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { api } from './api'
import { formatKWD, round3, todayStr } from '@/lib/format'
import type { ContractInput, ContractTypeDTO } from '@/lib/contrack-types'

interface NewContractDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialCustomerId?: number
  onCreated: (contractId: number, message: string) => void
}

const MANUAL_TYPE: ContractTypeDTO = {
  id: -1, name: 'عقد يدوي بلا قالب', defaultAmount: 0, notes: '', manualTrack: true,
  unitLabel: '', unitPrice: 0, pricingMode: 'lump', isSupervision: false, stages: [], payments: [],
}

const initialForm = {
  contractName: '', contractDate: todayStr(), startDate: '', endDate: '',
  amount: '', description: '', notes: '',
  supMonths: '', supMonthly: '', supDiscount: '', qty: '1', unitPrice: '',
}

export function NewContractDialog({ open, onOpenChange, initialCustomerId, onCreated }: NewContractDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        {open && (
          <NewContractForm
            initialCustomerId={initialCustomerId}
            onOpenChange={onOpenChange}
            onCreated={onCreated}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function NewContractForm({ initialCustomerId, onOpenChange, onCreated }: {
  initialCustomerId?: number
  onOpenChange: (open: boolean) => void
  onCreated: (contractId: number, message: string) => void
}) {
  const qc = useQueryClient()
  const [step, setStep] = useState(1)
  const [typeName, setTypeName] = useState<string | null>(null)
  const [form, setForm] = useState(initialForm)
  const [customerId, setCustomerId] = useState(initialCustomerId ? String(initialCustomerId) : '')

  const { data: types = [] } = useQuery({ queryKey: ['contract-types'], queryFn: api.contractTypes })
  const { data: customers = [] } = useQuery({ queryKey: ['customers', ''], queryFn: () => api.customers('') })

  const selectedType = useMemo(
    () => types.find((t) => t.name === typeName) ?? (typeName === MANUAL_TYPE.name ? MANUAL_TYPE : null),
    [types, typeName],
  )

  // قيمة العقد المحسوبة للإشراف الهندسي أو بالوحدة
  const computedAmount = useMemo(() => {
    if (!selectedType) return 0
    if (selectedType.isSupervision) {
      const months = Number(form.supMonths) || 0
      const monthly = Number(form.supMonthly) || selectedType.unitPrice || 0
      const discount = Number(form.supDiscount) || 0
      return round3(months * monthly - discount)
    }
    if (selectedType.pricingMode === 'unit') {
      const qty = Number(form.qty) || 1
      const unit = Number(form.unitPrice) || selectedType.unitPrice || 0
      return round3(qty * unit)
    }
    return Number(form.amount) || selectedType.defaultAmount || 0
  }, [selectedType, form.supMonths, form.supMonthly, form.supDiscount, form.qty, form.unitPrice, form.amount])

  const mutation = useMutation({
    mutationFn: (): Promise<{ id: number; contractNumber: string }> => {
      if (!selectedType) throw new Error('اختر نوع العقد أولًا')
      const input: ContractInput = {
        customerId: Number(customerId),
        contractType: selectedType.manualTrack ? '' : selectedType.name,
        contractName: form.contractName.trim(),
        contractDate: form.contractDate,
        amount: computedAmount,
        description: form.description.trim(),
        notes: form.notes.trim(),
        manualTrack: selectedType.manualTrack,
      }
      if (form.startDate) input.startDate = form.startDate
      if (form.endDate) input.endDate = form.endDate
      if (selectedType.isSupervision) {
        input.supMonths = Number(form.supMonths) || 0
        input.supMonthly = Number(form.supMonthly) || selectedType.unitPrice || 0
        input.supDiscount = Number(form.supDiscount) || 0
        input.qty = input.supMonths
        input.unitPrice = input.supMonthly
      } else if (selectedType.pricingMode === 'unit') {
        input.qty = Number(form.qty) || 1
        input.unitPrice = Number(form.unitPrice) || selectedType.unitPrice || 0
      }
      return api.createContract(input)
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['contracts'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onCreated(res.id, `تم إنشاء العقد ${res.contractNumber} بنجاح`)
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const canNext = (s: number): boolean => {
    if (s === 1) return selectedType != null
    if (s === 2) return Boolean(customerId && form.contractName.trim() && form.contractDate && computedAmount > 0)
    return true
  }

  const numInput = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <FilePlus2 className="size-4 text-primary" aria-hidden />
          عقد جديد — الخطوة {step} من 3
        </DialogTitle>
        <DialogDescription>
          {step === 1 ? 'اختر نوع العقد (يحدد قالب المراحل والدفعات)' : step === 2 ? 'أدخل بيانات العقد الأساسية' : 'راجع الملخص ثم اضغط إنشاء'}
        </DialogDescription>
      </DialogHeader>

      {/* الخطوة 1: نوع العقد */}
      {step === 1 && (
        <div className="grid gap-2.5 py-1" role="radiogroup" aria-label="نوع العقد">
          {[...types, MANUAL_TYPE].map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={typeName === t.name}
              onClick={() => setTypeName(t.name)}
              className={`text-start rounded-xl border p-3.5 transition-all min-h-11 ${
                typeName === t.name
                  ? 'border-primary bg-emerald-50/70 dark:bg-emerald-950/30 ring-2 ring-primary/30'
                  : 'hover:border-emerald-300 hover:bg-muted/50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-sm">{t.name}</span>
                {t.isSupervision && <span className="text-[10px] rounded bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300 px-1.5 py-0.5">إشراف</span>}
                {t.manualTrack && <span className="text-[10px] rounded bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300 px-1.5 py-0.5">بلا قالب</span>}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t.manualTrack
                  ? 'بدون مراحل أو دفعات قالبية — تُدار يدويًا لاحقًا'
                  : `${t.stages.length} مرحلة قالبية · ${t.payments.length} دفعة${t.defaultAmount > 0 ? ` · قيمة افتراضية ${formatKWD(t.defaultAmount)}` : ''}`}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* الخطوة 2: البيانات */}
      {step === 2 && selectedType && (
        <div className="grid gap-4 py-1 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>العميل *</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger className="h-11 w-full"><SelectValue placeholder="اختر العميل" /></SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name} ({c.customerCode})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="nc-name">اسم العقد *</Label>
            <Input id="nc-name" className="h-11" value={form.contractName} onChange={(e) => numInput('contractName')(e.target.value)} placeholder="مثال: صيانة سنوية — مبنى الإدارة" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nc-date">تاريخ العقد *</Label>
            <Input id="nc-date" type="date" className="h-11 numeric text-start" dir="ltr" value={form.contractDate} onChange={(e) => numInput('contractDate')(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nc-amount">قيمة العقد (د.ك) *</Label>
            {selectedType.isSupervision || selectedType.pricingMode === 'unit' ? (
              <div className="h-11 flex items-center px-3 rounded-md border bg-muted/50 font-bold numeric">{formatKWD(computedAmount)}</div>
            ) : (
              <Input id="nc-amount" type="number" step="0.001" min="0" inputMode="decimal" className="h-11 numeric text-start" dir="ltr" value={form.amount} onChange={(e) => numInput('amount')(e.target.value)} placeholder="0.000" />
            )}
          </div>

          {selectedType.isSupervision && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="nc-months">عدد الأشهر *</Label>
                <Input id="nc-months" type="number" min="1" className="h-11 numeric text-start" dir="ltr" value={form.supMonths} onChange={(e) => numInput('supMonths')(e.target.value)} placeholder="12" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nc-monthly">الاشتراك الشهري (د.ك)</Label>
                <Input id="nc-monthly" type="number" step="0.001" min="0" className="h-11 numeric text-start" dir="ltr" value={form.supMonthly} onChange={(e) => numInput('supMonthly')(e.target.value)} placeholder={String(selectedType.unitPrice || 0)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nc-disc">خصم (د.ك)</Label>
                <Input id="nc-disc" type="number" step="0.001" min="0" className="h-11 numeric text-start" dir="ltr" value={form.supDiscount} onChange={(e) => numInput('supDiscount')(e.target.value)} placeholder="0" />
              </div>
            </>
          )}

          {selectedType.pricingMode === 'unit' && !selectedType.isSupervision && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="nc-qty">الكمية ({selectedType.unitLabel || 'وحدة'})</Label>
                <Input id="nc-qty" type="number" min="0" step="1" className="h-11 numeric text-start" dir="ltr" value={form.qty} onChange={(e) => numInput('qty')(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nc-unit">سعر الوحدة (د.ك)</Label>
                <Input id="nc-unit" type="number" step="0.001" min="0" className="h-11 numeric text-start" dir="ltr" value={form.unitPrice} onChange={(e) => numInput('unitPrice')(e.target.value)} placeholder={String(selectedType.unitPrice || 0)} />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="nc-start">تاريخ البدء (اختياري)</Label>
            <Input id="nc-start" type="date" className="h-11 numeric text-start" dir="ltr" value={form.startDate} onChange={(e) => numInput('startDate')(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nc-end">تاريخ الانتهاء (اختياري)</Label>
            <Input id="nc-end" type="date" className="h-11 numeric text-start" dir="ltr" value={form.endDate} onChange={(e) => numInput('endDate')(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="nc-desc">الوصف</Label>
            <Textarea id="nc-desc" rows={2} value={form.description} onChange={(e) => numInput('description')(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="nc-notes">ملاحظات</Label>
            <Textarea id="nc-notes" rows={2} value={form.notes} onChange={(e) => numInput('notes')(e.target.value)} />
          </div>
        </div>
      )}

      {/* الخطوة 3: الملخص */}
      {step === 3 && selectedType && (
        <div className="py-1 space-y-3">
          <div className="rounded-xl border bg-muted/40 p-4 space-y-2 text-sm">
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">العميل</span><span className="font-semibold">{customers.find((c) => String(c.id) === customerId)?.name ?? '—'}</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">اسم العقد</span><span className="font-semibold">{form.contractName}</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">النوع</span><span className="font-semibold">{selectedType.name}</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">تاريخ العقد</span><span className="font-semibold numeric" dir="ltr">{form.contractDate}</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">القيمة</span><span className="font-bold numeric">{formatKWD(computedAmount)}</span></div>
            {selectedType.isSupervision && (
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">الإشراف</span>
                <span className="numeric">{form.supMonths || 0} شهرًا × {formatKWD(Number(form.supMonthly) || selectedType.unitPrice)} − {formatKWD(Number(form.supDiscount) || 0)}</span>
              </div>
            )}
          </div>
          {!selectedType.manualTrack && (
            <div className="text-xs text-muted-foreground flex items-start gap-1.5">
              <CheckCircle2 className="size-3.5 mt-0.5 text-emerald-600 shrink-0" aria-hidden />
              سيتم نسخ {selectedType.stages.length} مرحلة وإنشاء {selectedType.payments.length} دفعة من قالب النوع تلقائيًا.
            </div>
          )}
        </div>
      )}

      <DialogFooter className="gap-2 pt-1">
        {step > 1 && (
          <Button type="button" variant="outline" className="h-11 gap-1.5" onClick={() => setStep((s) => s - 1)}>
            <ArrowRight className="size-4" aria-hidden />
            السابق
          </Button>
        )}
        {step < 3 && (
          <Button type="button" className="h-11 gap-1.5" disabled={!canNext(step)} onClick={() => setStep((s) => s + 1)}>
            التالي
            <ArrowLeft className="size-4" aria-hidden />
          </Button>
        )}
        {step === 3 && (
          <Button type="button" className="h-11 gap-2" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            إنشاء العقد
          </Button>
        )}
      </DialogFooter>
    </>
  )
}
