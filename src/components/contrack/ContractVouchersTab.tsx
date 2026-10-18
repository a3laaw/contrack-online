'use client'

import { useState } from 'react'
import { Ban, Plus, ReceiptText } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from './api'
import { CancelVoucherDialog } from './CancelVoucherDialog'
import { ReceiptVoucherDialog } from './ReceiptVoucherDialog'
import { formatDate, formatKWD, voucherTypeBadgeClass, voucherTypeLabel } from '@/lib/format'
import type { ContractDetailDTO, SessionUser, VoucherDTO } from '@/lib/contrack-types'

interface ContractVouchersTabProps {
  contract: ContractDetailDTO
  user: SessionUser
}

const isAdmin = (role: string) => role === 'admin' || role === 'developer'

export function ContractVouchersTab({ contract, user }: ContractVouchersTabProps) {
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [cancelling, setCancelling] = useState<VoucherDTO | null>(null)

  const locked = {
    id: contract.id,
    contractNumber: contract.contractNumber,
    contractName: contract.contractName,
    customerId: contract.customer.id,
    customerName: contract.customer.name,
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button className="h-11 gap-2 font-semibold" onClick={() => setReceiptOpen(true)}>
          <Plus className="size-4" aria-hidden />
          سند قبض على هذا العقد
        </Button>
      </div>

      {contract.vouchers.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground border rounded-xl">
          <ReceiptText className="size-8 mx-auto mb-2 opacity-40" aria-hidden />
          لا توجد سندات مرتبطة بهذا العقد بعد
        </div>
      ) : (
        <ul className="divide-y rounded-xl border">
          {contract.vouchers.map((v) => (
            <li key={v.id} className={`flex flex-wrap items-center gap-2 sm:gap-3 p-3 ${v.cancelled ? 'opacity-55' : ''}`}>
              <Badge className={`${voucherTypeBadgeClass(v.vtype)} border`}>{voucherTypeLabel(v.vtype)}</Badge>
              <span className="font-bold text-sm numeric">{v.voucherNumber}</span>
              <span className="text-xs text-muted-foreground numeric" dir="ltr">{formatDate(v.vdate)}</span>
              <span className="text-sm">{v.party || '—'}</span>
              <span className="text-xs text-muted-foreground">{v.method}</span>
              {v.cancelled && (
                <Badge variant="secondary" className="border text-destructive">ملغى: {v.cancelReason}</Badge>
              )}
              <span className="ms-auto font-bold text-sm numeric">{formatKWD(v.amount)}</span>
              {!v.cancelled && isAdmin(user.role) && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 text-destructive hover:text-destructive"
                  onClick={() => setCancelling(v)}
                  aria-label={`إلغاء السند ${v.voucherNumber}`}
                >
                  <Ban className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ReceiptVoucherDialog open={receiptOpen} onOpenChange={setReceiptOpen} lockedContract={locked} onCreated={(m) => toast.success(m)} />
      <CancelVoucherDialog
        voucherId={cancelling?.id ?? null}
        voucherNumber={cancelling?.voucherNumber ?? ''}
        voucherAmount={cancelling?.amount ?? 0}
        onOpenChange={(o) => !o && setCancelling(null)}
      />
    </div>
  )
}

export function VouchersSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
    </div>
  )
}
