// PATCH /api/payments/[id] — تعديل دفعة (المبلغ/الاستحقاق/الملاحظات)
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authGuard, jsonError, parseAmount, parseDay } from '@/lib/api-utils'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await authGuard(req)
  if (g.error) return g.error

  const { id } = await ctx.params
  const pid = Number(id)
  if (!Number.isInteger(pid)) return jsonError('معرّف غير صالح', 400)
  const payment = await db.paymentPlan.findUnique({ where: { id: pid } })
  if (!payment) return jsonError('الدفعة غير موجودة', 404)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonError('طلب غير صالح', 400)
  }

  const data: Record<string, unknown> = {}
  if ('amount' in body) {
    const amount = parseAmount(body.amount)
    if (amount == null || amount <= 0) return jsonError('مبلغ الدفعة يجب أن يكون رقمًا أكبر من صفر', 400)
    data.amount = amount
  }
  if ('dueDate' in body) {
    const d = parseDay(body.dueDate)
    if (!d) return jsonError('تاريخ الاستحقاق غير صالح', 400)
    data.dueDate = d
  }
  if ('notes' in body) {
    if (typeof body.notes !== 'string') return jsonError('الملاحظات غير صالحة', 400)
    data.notes = body.notes.trim()
  }

  if (Object.keys(data).length === 0) return jsonError('لا توجد حقول للتحديث', 400)

  const updated = await db.paymentPlan.update({ where: { id: pid }, data })
  return NextResponse.json({
    id: updated.id,
    amount: updated.amount,
    dueDate: updated.dueDate,
    notes: updated.notes,
  })
}
