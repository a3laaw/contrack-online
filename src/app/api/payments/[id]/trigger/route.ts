// POST /api/payments/[id]/trigger — تحفيز دفعة (تسجيل تاريخ التحفيز + حدث + مطالبة تلقائية)
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { addContractEvent, authGuard, jsonError, parseDay } from '@/lib/api-utils'
import { nextClaimNumber } from '@/lib/claim-number'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await authGuard(req)
  if (g.error) return g.error

  const { id } = await ctx.params
  const pid = Number(id)
  if (!Number.isInteger(pid)) return jsonError('معرّف غير صالح', 400)
  const payment = await db.paymentPlan.findUnique({ where: { id: pid }, include: { contract: true } })
  if (!payment) return jsonError('الدفعة غير موجودة', 404)

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const date = body.date ? parseDay(body.date) : new Date()
  if (!date) return jsonError('تاريخ التحفيز غير صالح', 400)
  if (payment.triggeredAt) return jsonError('الدفعة مُحفزة مسبقًا', 409)

  const updated = await db.paymentPlan.update({
    where: { id: pid },
    data: { triggeredAt: date },
  })

  await addContractEvent(
    payment.contractId,
    'تحفيز دفعة',
    `تم تحفيز الدفعة «${payment.title}» بمبلغ ${payment.amount.toFixed(3)} د.ك — استحقاق ${payment.dueDate.toISOString().slice(0, 10)}`,
    g.user.username,
  )

  // مطالبة تلقائية (auto_claim_for_customer_line — spec §3.5):
  // تُنشأ فقط إن لم توجد مطالبة سارية (ليست cancelled) على نفس الدفعة — تجنب التكرار
  const existingClaim = await db.claim.findFirst({
    where: { custLineId: pid, status: { not: 'cancelled' } },
    select: { id: true },
  })
  let autoClaimNumber: string | null = null
  if (!existingClaim) {
    const dueDateStr = date.toISOString().slice(0, 10)
    autoClaimNumber = await db.$transaction(async (tx) => {
      const claimNumber = await nextClaimNumber(tx)
      await tx.claim.create({
        data: {
          claimNumber,
          direction: 'out',
          contractId: payment.contractId,
          custLineId: pid,
          title: `مطالبة تلقائية: ${payment.title}`,
          amount: payment.amount,
          dueDate: dueDateStr,
          status: 'registered',
          createdBy: 'system',
          notes: `تلقائية من استحقاق دفعة بتاريخ ${dueDateStr}`,
        },
      })
      return claimNumber
    })
  }

  return NextResponse.json({ id: updated.id, triggeredAt: updated.triggeredAt, autoClaimNumber })
}
