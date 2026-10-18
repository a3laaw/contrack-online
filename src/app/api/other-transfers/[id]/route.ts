// DELETE /api/other-transfers/[id] — حذف تسديد (مدير فقط):
// - يُرفض إن كان مرتبطًا بسند (voucherId) — لا سند صرف يُنشأ من هنا أصلًا (V4.5.13)
// - يحذف تخصيصاته ويعيد فتح العمليات (إعادة حساب paidTransferId لكل عملية لمسّها)
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { adminGuard, jsonError } from '@/lib/api-utils'
import { round3 } from '@/lib/format'

const EPS = 0.0005

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await adminGuard(req)
  if (g.error) return g.error

  const { id } = await ctx.params
  const tid = Number(id)
  if (!Number.isInteger(tid)) return jsonError('معرّف غير صالح', 400)

  const transfer = await db.otherCompanyTransfer.findUnique({
    where: { id: tid },
    include: { allocs: { select: { opId: true } } },
  })
  if (!transfer) return jsonError('التسديد غير موجود', 404)

  if (transfer.voucherId != null) {
    return jsonError('لا يمكن حذف التسديد: مرتبط بسند — احذف السند أولًا', 409)
  }

  const touchedOpIds = [...new Set(transfer.allocs.map((a) => a.opId))]

  const reopened = await db.$transaction(async (tx) => {
    await tx.transferOpAlloc.deleteMany({ where: { transferId: tid } })
    await tx.otherCompanyTransfer.delete({ where: { id: tid } })

    // إعادة فتح العمليات: إعادة حساب paidTransferId لكل عملية كانت مربوطة بهذا التسديد
    let count = 0
    for (const opId of touchedOpIds) {
      const op = await tx.gatewayOp.findUnique({
        where: { id: opId },
        include: { allocs: { select: { amount: true, transferId: true } } },
      })
      if (!op) continue
      const net = round3(op.amount - op.feeAmount)
      const paid = round3(op.allocs.reduce((s, a) => s + a.amount, 0))
      const complete = Math.abs(paid - net) <= EPS && op.allocs.length > 0
      const nextPaidTransferId = complete
        ? op.allocs.reduce((max, a) => Math.max(max, a.transferId), 0) || null
        : null
      if (op.paidTransferId !== nextPaidTransferId) count++
      await tx.gatewayOp.update({ where: { id: opId }, data: { paidTransferId: nextPaidTransferId } })
    }
    return count
  })

  return NextResponse.json({ ok: true, reopened })
}
