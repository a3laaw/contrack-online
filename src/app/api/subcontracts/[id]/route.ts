// GET   /api/subcontracts/[id] — تفاصيل عقد باطن كاملة (بنود + دفعات مع المسدد)
// PATCH /api/subcontracts/[id] — تعديل حقول اختيارية (المبلغ/التواريخ/الوصف/الحالة)
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { addContractEvent, authGuard, jsonError, parseAmount, parseDay } from '@/lib/api-utils'
import { round3 } from '@/lib/format'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await authGuard(req)
  if (g.error) return g.error

  const { id } = await ctx.params
  const sid = Number(id)
  if (!Number.isInteger(sid)) return jsonError('معرّف غير صالح', 400)

  const sc = await db.subContract.findUnique({
    where: { id: sid },
    include: {
      contract: { select: { contractNumber: true, contractName: true } },
      subcontractor: { select: { name: true, phone: true } },
      items: { orderBy: { id: 'asc' }, include: { boqItem: { select: { description: true } } } },
      payments: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
    },
  })
  if (!sc) return jsonError('العقد الباطن غير موجود', 404)

  // المسدد لكل دفعة: روابط kind='payment' (باستثناء السندات الملغاة)
  const lineIds = sc.payments.map((p) => p.id)
  const links = lineIds.length
    ? await db.voucherPaymentLink.findMany({
        where: { kind: 'payment', lineId: { in: lineIds }, voucher: { cancelled: false } },
        select: { lineId: true, amount: true },
      })
    : []
  const paidByLine = new Map<number, number>()
  for (const l of links) paidByLine.set(l.lineId, (paidByLine.get(l.lineId) ?? 0) + l.amount)

  return NextResponse.json({
    id: sc.id,
    contractId: sc.contractId,
    contractNumber: sc.contract.contractNumber,
    contractName: sc.contract.contractName,
    subcontractorId: sc.subcontractorId,
    subcontractorName: sc.subcontractor.name,
    subcontractorPhone: sc.subcontractor.phone,
    amount: sc.amount,
    paidAmount: round3([...paidByLine.values()].reduce((s, v) => s + v, 0)),
    startDate: sc.startDate,
    endDate: sc.endDate,
    status: sc.status,
    description: sc.description,
    items: sc.items.map((i) => ({
      id: i.id,
      boqItemId: i.boqItemId,
      description: i.boqItem?.description ?? 'بند يدوي',
      qty: i.qty,
      unitPrice: i.unitPrice,
      amount: i.amount,
    })),
    payments: sc.payments.map((p) => ({
      id: p.id,
      title: p.title,
      dueDate: p.dueDate,
      amount: p.amount,
      paidAmount: round3(paidByLine.get(p.id) ?? 0),
      stageId: p.stageId,
      triggeredAt: p.triggeredAt,
    })),
    createdAt: sc.createdAt,
  })
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  const data: {
    amount?: number
    startDate?: Date | null
    endDate?: Date | null
    description?: string
    status?: string
  } = {}

  if ('amount' in body) {
    const amount = parseAmount(body.amount)
    if (amount == null || amount <= 0) return jsonError('مبلغ العقد الباطن يجب أن يكون أكبر من صفر', 400)
    data.amount = amount
  }
  if ('startDate' in body) {
    if (body.startDate == null || body.startDate === '') data.startDate = null
    else {
      const d = parseDay(body.startDate)
      if (!d) return jsonError('تاريخ البدء غير صالح', 400)
      data.startDate = d
    }
  }
  if ('endDate' in body) {
    if (body.endDate == null || body.endDate === '') data.endDate = null
    else {
      const d = parseDay(body.endDate)
      if (!d) return jsonError('تاريخ التسليم غير صالح', 400)
      data.endDate = d
    }
  }
  if (typeof body.description === 'string') data.description = body.description.trim()
  if (typeof body.status === 'string' && body.status.trim()) data.status = body.status.trim()

  const updated = await db.subContract.update({ where: { id: sid }, data })

  if (data.status && data.status !== sc.status) {
    await addContractEvent(
      sc.contractId,
      'عقد باطن',
      `تغيير حالة العقد الباطن رقم ${sc.id} من «${sc.status}» إلى «${data.status}»`,
      g.user.username,
    )
  }

  return NextResponse.json({ id: updated.id })
}
