'use client'

// ============================================================
// حوار طباعة الفاتورة — ورقة رسمية بنمط ContractPrintDialog:
// ترويسة الشركة (Settings) + شريط 4 حقول (رقم/تاريخ/عميل/عقد)
// + البند والإجمالي + تفقيط + ملخص العقد + توقيعان
// (الفاتورة «للعلم» — لا تؤثر على الحساب كالأصل V3.14)
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
import { printElement } from '@/lib/print-html'
import { api } from '../api'
import { formatDate, formatKWD } from '@/lib/format'
import { tafqeetKWD } from '@/lib/tafqeet'
import type { InvoiceDTO } from '@/lib/invoice-types'

interface InvoicePrintDialogProps {
  invoice: InvoiceDTO
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function InvoicePrintDialog({ invoice, open, onOpenChange }: InvoicePrintDialogProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings,
    enabled: open,
    staleTime: 60_000,
  })

  const itemDescription = invoice.description?.trim() || 'دفعة من قيمة العقد'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 overflow-hidden">
        <DialogHeader className="print-hide px-5 pt-5 pb-0">
          <DialogTitle>معاينة الطباعة — {invoice.invoiceNumber}</DialogTitle>
          <DialogDescription>فاتورة للعلم بنمط الورقة الرسمية — جاهزة للطباعة أو الحفظ PDF.</DialogDescription>
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
              <h2 className="text-base font-extrabold border-2 border-gray-800 rounded-md px-6 py-1 print-border w-fit mx-auto mt-2">
                فاتورة
              </h2>
            </header>

            {/* شريط المعلومات: رقم | تاريخ | عميل | عقد */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
              <div className="border rounded-md print-border px-2.5 py-1.5">
                <p className="text-[10px] text-gray-500">رقم الفاتورة</p>
                <p className="font-extrabold numeric">{invoice.invoiceNumber}</p>
              </div>
              <div className="border rounded-md print-border px-2.5 py-1.5">
                <p className="text-[10px] text-gray-500">التاريخ</p>
                <p className="font-bold numeric">{formatDate(invoice.invoiceDate)}</p>
              </div>
              <div className="border rounded-md print-border px-2.5 py-1.5">
                <p className="text-[10px] text-gray-500">العميل</p>
                <p className="font-bold truncate">{invoice.customerName || '—'}</p>
              </div>
              <div className="border rounded-md print-border px-2.5 py-1.5">
                <p className="text-[10px] text-gray-500">رقم العقد</p>
                <p className="font-bold numeric">{invoice.contractNumber || '—'}</p>
              </div>
            </div>

            {/* جدول البيان */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8 text-start">البيان</TableHead>
                  <TableHead className="h-8 text-start w-40">المبلغ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="h-9">{itemDescription}</TableCell>
                  <TableCell className="h-9 numeric font-bold">{formatKWD(invoice.amount)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="h-9 font-extrabold">إجمالي الفاتورة</TableCell>
                  <TableCell className="h-9 numeric font-extrabold">{formatKWD(invoice.amount)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>

            {/* التفقيط */}
            <div className="border-2 border-gray-800 rounded-md print-border p-3 text-center">
              <p className="text-sm font-bold">{tafqeetKWD(invoice.amount)}</p>
            </div>

            {/* ملخص العقد */}
            <div className="border rounded-md print-border p-3 space-y-1 text-sm">
              <h3 className="text-xs font-extrabold text-gray-500 mb-1.5">ملخص العقد {invoice.contractNumber}</h3>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">قيمة العقد</span>
                <span className="font-bold numeric">{formatKWD(invoice.contractAmount)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">إجمالي الفواتير</span>
                <span className="font-bold numeric">{formatKWD(invoice.contractInvoicesTotal)}</span>
              </div>
              <div className="flex items-center justify-between border-t print-border pt-1">
                <span className="text-gray-600">المبلغ المتبقي</span>
                <span className={`font-extrabold numeric ${invoice.contractRemaining >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {formatKWD(invoice.contractRemaining)}
                </span>
              </div>
            </div>

            {/* ملاحظات */}
            {invoice.notes?.trim() && (
              <p className="text-xs border rounded-md print-border p-2.5 bg-gray-50 whitespace-pre-line">{invoice.notes}</p>
            )}

            {/* التوقيعان */}
            <div className="grid grid-cols-2 gap-8 pt-8 text-center text-xs">
              <div>
                <div className="border-t border-gray-500 pt-1 print-border">توقيع المستلم</div>
              </div>
              <div>
                <div className="border-t border-gray-500 pt-1 print-border">التوقيع</div>
              </div>
            </div>

            <Separator className="print-border" />
            <footer className="text-center text-[10px] text-gray-500">
              {settings?.headerTitle || 'نظام إدارة العقود والمحاسبة'} — فاتورة {invoice.invoiceNumber} (للعلم) — طُبع بتاريخ {formatDate(new Date())}
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
