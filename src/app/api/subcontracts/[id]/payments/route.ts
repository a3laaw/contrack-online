// POST /api/subcontracts/[id]/payments — إضافة دفعة إلى خطة العقد الباطن
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authGuard, jsonError, parseAmount, parseDay } from '@/lib/api-utils'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await authGuard(req)
  if (g.error) return g.error

  const { id } = await ctx.params
  const sid = Number(id)
  if (!Number.isInteger(sid)) return jsonError('معرّف غير صالح', 400)
  const sc = await db.subContract.findUnique({ where: { id: sid } })
  if (!sc) return jsonError('العقد الباطن غير موجود', 404)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonError('طلب غير صالح', 400)
  }

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return jsonError('عنوان الدفعة مطلوب', 400)

  const dueDate = parseDay(body.dueDate)
  if (!dueDate) return jsonError('تاريخ الاستحقاق غير صالح', 400)

  const amount = parseAmount(body.amount)
  if (amount == null || amount <= 0) return jsonError('مبلغ الدفعة يجب أن يكون أكبر من صفر', 400)

  let stageId: number | null = null
  if (body.stageId != null && body.stageId !== '') {
    const st = Number(body.stageId)
    if (!Number.isInteger(st)) return jsonError('المرحلة المحددة غير صالحة', 400)
    const stage = await db.contractStage.findFirst({ where: { id: st, contractId: sc.contractId } })
    if (!stage) return jsonError('المرحلة المحددة لا تتبع العقد الأب لهذا العقد الباطن', 400)
    stageId = st
  }

  const last = await db.subPaymentPlan.findFirst({
    where: { subContractId: sid },
    orderBy: [{ sortOrder: 'desc' }, { id: 'desc' }],
    select: { sortOrder: true },
  })

  const created = await db.subPaymentPlan.create({
    data: {
      subContractId: sid,
      title,
      dueDate,
      amount,
      sortOrder: (last?.sortOrder ?? 0) + 1,
      stageId,
    },
  })

  return NextResponse.json({ id: created.id }, { status: 201 })
}
