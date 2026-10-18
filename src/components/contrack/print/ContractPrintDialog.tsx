'use client'

// ============================================================
// حوار طباعة العقد — ورقة رسمية: بيانات + بنود + مراحل + دفعات
// مع التفقيط العربي لإجمالي قيمة العقد
// ============================================================
import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { boqApi } from '@/lib/boq-api'
import { printElement } from '@/lib/print-html'
import { api } from '../api'
import { formatDate, formatKWD } from '@/lib/format'
import { tafqeetKWD } from '@/lib/tafqeet'
import type { ContractDetailDTO } from '@/lib/contrack-types'

interface ContractPrintDialogProps {
  contract: ContractDetailDTO
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ContractPrintDialog({ contract, open, onOpenChange }: ContractPrintDialogProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings,
    enabled: open,
    staleTime: 60_000,
  })
  const { data: boq } = useQuery({
    queryKey: ['boq', contract.id],
    queryFn: () => boqApi.boqItems(contract.id),
    enabled: open,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl p-0 overflow-hidden">
        <DialogHeader className="print-hide px-5 pt-5 pb-0">
          <DialogTitle>معاينة الطباعة — {contract.contractNumber}</DialogTitle>
          <DialogDescription>ملخص العقد بالبنود والدفعات مع التفقيط — جاهز للطباعة أو الحفظ PDF.</DialogDescription>
        </DialogHeader>

        <div className="px-5 max-h-[55vh] overflow-y-auto">
          <div ref={sheetRef} className="print-area print-sheet rounded-lg border print-border p-5 space-y-4" dir="rtl">
            {/* الترويسة */}
            <header className="text-center space-y-1 border-b-2 border-gray-800 pb-3 print-border">
              <h1 className="text-lg font-extrabold">{settings?.companyName || 'شركة المقاولات'}</h1>
              {settings?.companyAddress && <p className="text-xs text-gray-600">{settings.companyAddress}</p>}
              <p className="text-xs text-gray-600">
                {settings?.companyPhone && <span className="numeric">هاتف: {settings.companyPhone}</span>}
              </p>
            </header>

            <h2 className="text-center text-base font-extrabold border-2 border-gray-800 rounded-md px-4 py-1 print-border w-fit mx-auto">
              ملخص عقد رقم {contract.contractNumber}
            </h2>

            {/* بيانات العقد */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <p><span className="font-semibold text-gray-600">اسم العقد: </span><span className="font-bold">{contract.contractName || '—'}</span></p>
              <p><span className="font-semibold text-gray-600">النوع: </span><span className="font-bold">{contract.contractType || '—'}</span></p>
              <p><span className="font-semibold text-gray-600">العميل: </span><span className="font-bold">{contract.customer.name}</span></p>
              <p><span className="font-semibold text-gray-600">هاتف العميل: </span><span className="font-bold numeric">{contract.customer.phone || '—'}</span></p>
              <p><span className="font-semibold text-gray-600">تاريخ العقد: </span><span className="font-bold numeric">{formatDate(contract.contractDate)}</span></p>
              <p><span className="font-semibold text-gray-600">الحالة: </span><span className="font-bold">{contract.status}</span></p>
              {contract.startDate && <p><span className="font-semibold text-gray-600">البدء: </span><span className="font-bold numeric">{formatDate(contract.startDate)}</span></p>}
              {contract.endDate && <p><span className="font-semibold text-gray-600">الانتهاء: </span><span className="font-bold numeric">{formatDate(contract.endDate)}</span></p>}
            </div>
            {contract.description && (
              <p className="text-sm border rounded-md print-border p-2.5 bg-gray-50"><span className="font-semibold">وصف الأعمال: </span>{contract.description}</p>
            )}

            {/* قيمة العقد + التفقيط */}
            <div className="border-2 border-gray-800 rounded-md print-border p-3 text-center space-y-1">
              <p className="text-sm"><span className="font-semibold">إجمالي قيمة العقد: </span><span className="font-extrabold text-base numeric">{formatKWD(contract.amount)}</span></p>
              <p className="text-sm font-bold">{tafqeetKWD(contract.amount)}</p>
            </div>

            {/* البنود */}
            {boq && boq.items.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-sm font-extrabold">جدول البنود ({boq.items.length})</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8 text-start">م</TableHead>
                      <TableHead className="h-8 text-start">الوصف</TableHead>
                      <TableHead className="h-8 text-start">الكمية</TableHead>
                      <TableHead className="h-8 text-start">الوحدة</TableHead>
                      <TableHead className="h-8 text-start">سعر الوحدة</TableHead>
                      <TableHead className="h-8 text-start">الإجمالي</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {boq.items.map((it, i) => (
                      <TableRow key={it.id}>
                        <TableCell className="h-8 numeric">{i + 1}</TableCell>
                        <TableCell className="h-8">{it.description}</TableCell>
                        <TableCell className="h-8 numeric">{it.qty}</TableCell>
                        <TableCell className="h-8">{it.unit || '—'}</TableCell>
                        <TableCell className="h-8 numeric">{formatKWD(it.unitPrice)}</TableCell>
                        <TableCell className="h-8 numeric font-bold">{formatKWD(it.total)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={5} className="h-8 text-start font-extrabold">إجمالي البنود</TableCell>
                      <TableCell className="h-8 numeric font-extrabold">{formatKWD(boq.itemsTotal)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}

            {/* المراحل */}
            {contract.stages.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-sm font-extrabold">مراحل التنفيذ ({contract.stages.length})</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8 text-start">م</TableHead>
                      <TableHead className="h-8 text-start">المرحلة</TableHead>
                      <TableHead className="h-8 text-start">المدة المتوقعة (يوم)</TableHead>
                      <TableHead className="h-8 text-start">البدء</TableHead>
                      <TableHead className="h-8 text-start">الانتهاء</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contract.stages.map((st, i) => (
                      <TableRow key={st.id}>
                        <TableCell className="h-8 numeric">{i + 1}</TableCell>
                        <TableCell className="h-8 font-semibold">{st.name}{st.isSkipped ? ' (متجاوزة)' : ''}</TableCell>
                        <TableCell className="h-8 numeric">{st.expectedDays || '—'}</TableCell>
                        <TableCell className="h-8 numeric">{st.startDate ? formatDate(st.startDate) : '—'}</TableCell>
                        <TableCell className="h-8 numeric">{st.endDate ? formatDate(st.endDate) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* الدفعات */}
            {contract.payments.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-sm font-extrabold">خطة الدفعات ({contract.payments.length})</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8 text-start">م</TableHead>
                      <TableHead className="h-8 text-start">الدفعة</TableHead>
                      <TableHead className="h-8 text-start">الاستحقاق</TableHead>
                      <TableHead className="h-8 text-start">المبلغ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contract.payments.map((p, i) => (
                      <TableRow key={p.id}>
                        <TableCell className="h-8 numeric">{i + 1}</TableCell>
                        <TableCell className="h-8 font-semibold">{p.title}</TableCell>
                        <TableCell className="h-8 numeric">{formatDate(p.dueDate)}</TableCell>
                        <TableCell className="h-8 numeric font-bold">{formatKWD(p.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* التوقيعات */}
            <div className="grid grid-cols-2 gap-8 pt-8 text-center text-xs">
              <div>
                <div className="border-t border-gray-500 pt-1 print-border">توقيع العميل</div>
              </div>
              <div>
                <div className="border-t border-gray-500 pt-1 print-border">توقيع المقاول</div>
              </div>
            </div>

            <Separator className="print-border" />
            <footer className="text-center text-[10px] text-gray-500">
              {settings?.headerTitle || 'نظام إدارة العقود والمحاسبة'} — عقد {contract.contractNumber} — طُبع بتاريخ {formatDate(new Date())}
            </footer>
          </div>
        </div>

        <DialogFooter className="print-hide px-5 py-4 gap-2 border-t">
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>إغلاق</Button>
          <Button className="h-11 gap-2 font-semibold" onClick={() => sheetRef.current && printElement(sheetRef.current)}>
            <Printer className="size-4" aria-hidden />
            طباعة / حفظ PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
