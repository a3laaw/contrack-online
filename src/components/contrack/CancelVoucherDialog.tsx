'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Ban, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from './api'
import { formatKWD } from '@/lib/format'

interface CancelVoucherDialogProps {
  voucherId: number | null
  voucherNumber: string
  voucherAmount: number
  onOpenChange: (open: boolean) => void
}

export function CancelVoucherDialog({ voucherId, voucherNumber, voucherAmount, onOpenChange }: CancelVoucherDialogProps) {
  return (
    <Dialog open={voucherId != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {voucherId != null && (
          <CancelVoucherForm voucherId={voucherId} voucherNumber={voucherNumber} voucherAmount={voucherAmount} onOpenChange={onOpenChange} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CancelVoucherForm({ voucherId, voucherNumber, voucherAmount, onOpenChange }: {
  voucherId: number
  voucherNumber: string
  voucherAmount: number
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.cancelVoucher(voucherId, reason.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vouchers'] })
      qc.invalidateQueries({ queryKey: ['contract'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(`تم إلغاء السند ${voucherNumber}`)
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Ban className="size-4 text-destructive" aria-hidden />
          إلغاء السند {voucherNumber}
        </DialogTitle>
        <DialogDescription>
          سيُعلَّم السند بمبلغ <span className="font-bold numeric">{formatKWD(voucherAmount)}</span> كملغى ولن يُحتسب في التقارير. هذا الإجراء متاح للمدير فقط.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5 py-1">
        <Label htmlFor="cv-reason">سبب الإلغاء *</Label>
        <Input
          id="cv-reason"
          className="h-11"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="مثال: خطأ في المبلغ — يعاد إصداره"
          autoFocus
        />
      </div>
      <DialogFooter className="gap-2">
        <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>تراجع</Button>
        <Button
          variant="destructive"
          className="h-11 gap-2"
          disabled={mutation.isPending || !reason.trim()}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
          تأكيد الإلغاء
        </Button>
      </DialogFooter>
    </>
  )
}
