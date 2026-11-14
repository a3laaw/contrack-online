'use client'

import { useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { api, ApiError } from './api'
import { KUWAIT_GOVERNORATES } from '@/lib/format'
import type { CustomerDTO, CustomerInput } from '@/lib/contrack-types'

interface CustomerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  customer: CustomerDTO | null
}

const emptyForm: CustomerInput = {
  name: '', phone: '', address: '', addressGovernorate: '', addressArea: '',
  addressBlock: '', addressPlot: '', email: '', notes: '',
}

function toForm(c: CustomerDTO | null): CustomerInput {
  if (!c) return emptyForm
  return {
    name: c.name, phone: c.phone, address: c.address,
    addressGovernorate: c.addressGovernorate, addressArea: c.addressArea,
    addressBlock: c.addressBlock, addressPlot: c.addressPlot,
    email: c.email, notes: c.notes,
  }
}

export function CustomerDialog({ open, onOpenChange, customer }: CustomerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        {open && <CustomerForm customer={customer} onOpenChange={onOpenChange} />}
      </DialogContent>
    </Dialog>
  )
}

function CustomerForm({ customer, onOpenChange }: { customer: CustomerDTO | null; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState<CustomerInput>(() => toForm(customer))

  const set = (k: keyof CustomerInput) => (v: string) => setForm((f) => ({ ...f, [k]: v }))

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new ApiError('اسم العميل مطلوب', 400)
      return customer ? api.updateCustomer(customer.id, form) : api.createCustomer(form)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(customer ? 'تم حفظ تعديلات العميل بنجاح' : 'تمت إضافة العميل بنجاح')
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle>{customer ? `تعديل العميل — ${customer.customerCode}` : 'إضافة عميل جديد'}</DialogTitle>
        <DialogDescription>
          {customer ? 'حدّث بيانات العميل ثم اضغط حفظ' : 'سيُمنح العميل كودًا تلقائيًا CUS-####'}
        </DialogDescription>
      </DialogHeader>

      <form
        className="grid gap-4 py-1 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          mutation.mutate()
        }}
      >
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="c-name">اسم العميل *</Label>
          <Input id="c-name" className="h-11" value={form.name} onChange={(e) => set('name')(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-phone">الهاتف</Label>
          <Input id="c-phone" className="h-11 numeric text-start" dir="ltr" value={form.phone} onChange={(e) => set('phone')(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-email">البريد الإلكتروني</Label>
          <Input id="c-email" className="h-11" dir="ltr" type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="c-address">العنوان (وصف عام)</Label>
          <Input id="c-address" className="h-11" value={form.address} onChange={(e) => set('address')(e.target.value)} placeholder="مثال: برج الخليج، الدور 8" />
        </div>

        {/* العنوان الكويتي */}
        <div className="sm:col-span-2 rounded-lg border bg-muted/40 p-3 grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-4">
            <p className="text-xs font-bold text-muted-foreground">العنوان الكويتي التفصيلي</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-gov" className="text-xs">المحافظة</Label>
            <Select value={form.addressGovernorate} onValueChange={set('addressGovernorate')}>
              <SelectTrigger id="c-gov" className="h-11 w-full"><SelectValue placeholder="اختر المحافظة" /></SelectTrigger>
              <SelectContent>
                {KUWAIT_GOVERNORATES.map((g) => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-area" className="text-xs">المنطقة</Label>
            <Input id="c-area" className="h-11" value={form.addressArea} onChange={(e) => set('addressArea')(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-block" className="text-xs">البلوك</Label>
            <Input id="c-block" className="h-11" value={form.addressBlock} onChange={(e) => set('addressBlock')(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-plot" className="text-xs">القطعة</Label>
            <Input id="c-plot" className="h-11" value={form.addressPlot} onChange={(e) => set('addressPlot')(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="c-notes">ملاحظات</Label>
          <Textarea id="c-notes" rows={2} value={form.notes} onChange={(e) => set('notes')(e.target.value)} />
        </div>

        <DialogFooter className="sm:col-span-2 gap-2 pt-1">
          <Button type="button" variant="outline" className="h-11" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button type="submit" className="h-11 gap-2" disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            حفظ
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
