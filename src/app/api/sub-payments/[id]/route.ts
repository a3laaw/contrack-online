// DELETE /api/sub-payments/[id] — حذف دفعة من خطة عقد باطن (مدير فقط)
// يُرفض الحذف إن كانت للدفعة روابط سندات صرف غير ملغاة
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { adminGuard, jsonError } from '@/lib/api-utils'

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await adminGuard(req)
  if (g.error) return g.error

  const { id } = await ctx.params
  const pid = Number(id)
  if (!Number.isInteger(pid)) return jsonError('معرّف غير صالح', 400)

  const payment = await db.subPaymentPlan.findUnique({ where: { id: pid } })
  if (!payment) return jsonError('الدفعة غير موجودة', 404)

  const linksCount = await db.voucherPaymentLink.count({
    where: { kind: 'payment', lineId: pid, voucher: { cancelled: false } },
  })
  if (linksCount > 0) {
    return jsonError('لا يمكن حذف دفعة عليها سند صرف', 409)
  }

  await db.subPaymentPlan.delete({ where: { id: pid } })
  return NextResponse.json({ ok: true })
}
