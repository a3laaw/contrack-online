'use client'

// ============================================================
// حوار طباعة السند (قبض/صرف) — ورقة رسمية بالعربية مع التفقيط
// الطباعة عبر زر "طباعة" يستخدم window.print مع قواعد print-area
// ============================================================
import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { api } from '../api'
import { printElement } from '@/lib/print-html'
import { formatDate, formatKWD, voucherTypeLabel } from '@/lib/format'
import { tafqeetKWD } from '@/lib/tafqeet'
import type { VoucherDTO } from '@/lib/contrack-types'

interface VoucherPrintDialogProps {
  voucher: VoucherDTO | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function PrintRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="w-28 shrink-0 text-sm font-semibold text-gray-600">{label}</span>
      <span className="text-sm font-bold flex-1 border-b border-dashed print-border pb-0.5">{value || '—'}</span>
    </div>
  )
}

export function VoucherPrintDialog({ voucher, open, onOpenChange }: VoucherPrintDialogProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings,
    enabled: open,
    staleTime: 60_000,
  })

  if (!voucher) return null
  const isReceipt = voucher.vtype === 'receipt'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 overflow-hidden">
        <DialogHeader className="print-hide px-5 pt-5 pb-0">
          <DialogTitle>معاينة الطباعة — {voucher.voucherNumber}</DialogTitle>
          <DialogDescription>
            استخدم زر الطباعة لفتح نافذة الطباعة وحفظها PDF. للحصول على أفضل نتيجة افتح التطبيق في تبويب مستقل.
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 max-h-[55vh] overflow-y-auto">
          {/* ورقة السند */}
          <div ref={sheetRef} className="print-area print-sheet rounded-lg border print-border p-5 space-y-4" dir="rtl">
            {/* الترويسة */}
            <header className="text-center space-y-1 border-b-2 border-gray-800 pb-3 print-border">
              <h1 className="text-lg font-extrabold">{settings?.companyName || 'شركة المقاولات'}</h1>
              {settings?.companyAddress && <p className="text-xs text-gray-600">{settings.companyAddress}</p>}
              <p className="text-xs text-gray-600">
                {settings?.companyPhone && <span className="numeric">هاتف: {settings.companyPhone}</span>}
                {settings?.companyEmail && <span> · {settings.companyEmail}</span>}
              </p>
            </header>

            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold border-2 border-gray-800 rounded-md px-4 py-1 print-border">
                {isReceipt ? 'سند قبض' : 'سند صرف'}
              </h2>
              <div className="text-sm space-y-0.5 text-start">
                <p><span className="font-semibold">رقم السند: </span><span className="font-bold numeric">{voucher.voucherNumber}</span></p>
                <p><span className="font-semibold">التاريخ: </span><span className="font-bold numeric">{formatDate(voucher.vdate)}</span></p>
              </div>
            </div>

            <Separator className="print-border" />

            <div className="space-y-0.5">
              <PrintRow label={isReceipt ? 'استلمنا من' : 'صرفنا إلى'} value={voucher.party} />
              <PrintRow label="مبلغًا قدره" value={formatKWD(voucher.amount)} />
              <div className="flex items-start gap-2 py-1.5">
                <span className="w-28 shrink-0 text-sm font-semibold text-gray-600">وذلك عن</span>
                <span className="text-sm font-bold flex-1">{tafqeetKWD(voucher.amount)}</span>
              </div>
              <PrintRow label="طريقة الدفع" value={voucher.method || 'نقدًا'} />
              <PrintRow label="الحساب / الصندوق" value={voucher.account} />
              {voucher.contractNumber && <PrintRow label="عقد رقم" value={voucher.contractNumber} />}
              {voucher.description && <PrintRow label="البيان" value={voucher.description} />}
            </div>

            {/* التوقيعات */}
            <div className="grid grid-cols-3 gap-4 pt-8 text-center text-xs">
              <div>
                <div className="border-t border-gray-500 pt-1 print-border">المستلم</div>
              </div>
              <div>
                <div className="border-t border-gray-500 pt-1 print-border">أمين الصندوق</div>
              </div>
              <div>
                <div className="border-t border-gray-500 pt-1 print-border">المدير المالي</div>
              </div>
            </div>

            <footer className="text-center text-[10px] text-gray-500 border-t print-border pt-2">
              {settings?.headerTitle || 'نظام إدارة العقود والمحاسبة'} — {voucherTypeLabel(voucher.vtype)} {voucher.voucherNumber}
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
