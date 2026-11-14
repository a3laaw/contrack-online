// GET  /api/subcontracts?contractId=&subcontractorId=&status= — قائمة العقود الباطنة مع المسدد
// POST /api/subcontracts — إنشاء عقد باطن مع دفعاته اختياريًا + حدث على العقد الأب
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { addContractEvent, authGuard, jsonError, parseAmount, parseDay } from '@/lib/api-utils'
import { round3 } from '@/lib/format'

export async function GET(req: NextRequest) {
  const g = await authGuard(req)
  if (g.error) return g.error

  const sp = req.nextUrl.searchParams
  const contractId = Number(sp.get('contractId') ?? '') || undefined
  const subcontractorId = Number(sp.get('subcontractorId') ?? '') || undefined
  const status = sp.get('status')?.trim() ?? ''

  const where: Record<string, unknown> = {}
  if (contractId) where.contractId = contractId
  if (subcontractorId) where.subcontractorId = subcontractorId
  if (status) where.status = status

  const rows = await db.subContract.findMany({
    where,
    orderBy: { id: 'desc' },
    include: {
      contract: { select: { contractNumber: true, contractName: true } },
      subcontractor: { select: { name: true } },
      payments: { select: { id: true, subContractId: true } },
      _count: { select: { payments: true, items: true } },
    },
  })

  // المسدد لكل عقد باطن: روابط kind='payment' على دفعاته (باستثناء السندات الملغاة)
  const lineIds = rows.flatMap((r) => r.payments.map((p) => p.id))
  const links = lineIds.length
    ? await db.voucherPaymentLink.findMany({
        where: { kind: 'payment', lineId: { in: lineIds }, voucher: { cancelled: false } },
        select: { lineId: true, amount: true },
      })
    : []
  const lineSub = new Map<number, number>()
  for (const r of rows) for (const p of r.payments) lineSub.set(p.id, r.id)
  const paidBySub = new Map<number, number>()
  for (const l of links) {
    const scId = lineSub.get(l.lineId)
    if (scId != null) paidBySub.set(scId, (paidBySub.get(scId) ?? 0) + l.amount)
  }

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      contractId: r.contractId,
      contractNumber: r.contract.contractNumber,
      contractName: r.contract.contractName,
      subcontractorId: r.subcontractorId,
      subcontractorName: r.subcontractor.name,
      amount: r.amount,
      paidAmount: round3(paidBySub.get(r.id) ?? 0),
      startDate: r.startDate,
      endDate: r.endDate,
      status: r.status,
      description: r.description,
      paymentsCount: r._count.payments,
      itemsCount: r._count.items,
      createdAt: r.createdAt,
    })),
  )
}

export async function POST(req: NextRequest) {
  const g = await authGuard(req)
  if (g.error) return g.error

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonError('طلب غير صالح', 400)
  }

  const contractId = Number(body.contractId)
  if (!Number.isInteger(contractId)) return jsonError('العقد الأب مطلوب', 400)
  const contract = await db.contract.findUnique({ where: { id: contractId } })
  if (!contract) return jsonError('العقد غير موجود', 404)

  const subcontractorId = Number(body.subcontractorId)
  if (!Number.isInteger(subcontractorId)) return jsonError('اختيار المقاول مطلوب', 400)
  const subcontractor = await db.subcontractor.findUnique({ where: { id: subcontractorId } })
  if (!subcontractor) return jsonError('المقاول غير موجود', 404)

  const amount = parseAmount(body.amount)
  if (amount == null || amount <= 0) {
    return jsonError('مبلغ العقد الباطن يجب أن يكون رقمًا أكبر من صفر', 400)
  }

  const startDate = body.startDate == null || body.startDate === '' ? null : parseDay(body.startDate)
  if (body.startDate != null && body.startDate !== '' && !startDate) {
    return jsonError('تاريخ البدء غير صالح', 400)
  }
  const endDate = body.endDate == null || body.endDate === '' ? null : parseDay(body.endDate)
  if (body.endDate != null && body.endDate !== '' && !endDate) {
    return jsonError('تاريخ التسليم غير صالح', 400)
  }

  const description = typeof body.description === 'string' ? body.description.trim() : ''

  // الدفعات الاختيارية
  type PayItem = { title: string; dueDate: Date; amount: number; stageId: number | null }
  const payments: PayItem[] = []
  const paymentsInput = Array.isArray(body.payments) ? body.payments : []
  for (const raw of paymentsInput) {
    if (typeof raw !== 'object' || raw === null) return jsonError('بيانات الدفعات غير صالحة', 400)
    const item = raw as Record<string, unknown>
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    if (!title) return jsonError('عنوان كل دفعة مطلوب', 400)
    const dueDate = parseDay(item.dueDate)
    if (!dueDate) return jsonError(`تاريخ استحقاق الدفعة «${title}» غير صالح`, 400)
    const payAmount = parseAmount(item.amount)
    if (payAmount == null || payAmount <= 0) {
      return jsonError(`مبلغ الدفعة «${title}» يجب أن يكون أكبر من صفر`, 400)
    }
    let stageId: number | null = null
    if (item.stageId != null && item.stageId !== '') {
      const st = Number(item.stageId)
      if (!Number.isInteger(st)) return jsonError('المرحلة المحددة للدفعة غير صالحة', 400)
      const stage = await db.contractStage.findFirst({ where: { id: st, contractId } })
      if (!stage) return jsonError('المرحلة المحددة لا تتبع العقد الأب', 400)
      stageId = st
    }
    payments.push({ title, dueDate, amount: payAmount, stageId })
  }

  const created = await db.$transaction(
    async (tx) => {
      const sc = await tx.subContract.create({
        data: {
          contractId,
          subcontractorId,
          amount,
          startDate,
          endDate,
          description,
        },
      })
      let sortOrder = 1
      for (const p of payments) {
        await tx.subPaymentPlan.create({
          data: {
            subContractId: sc.id,
            title: p.title,
            dueDate: p.dueDate,
            amount: p.amount,
            stageId: p.stageId,
            sortOrder: sortOrder++,
          },
        })
      }
      return sc
    },
    { timeout: 15000 },
  )

  await addContractEvent(
    contractId,
    'عقد باطن',
    `إسناد باطن إلى ${subcontractor.name} بمبلغ ${amount.toFixed(3)} د.ك${payments.length ? ` — ${payments.length} دفعة` : ''}`,
    g.user.username,
  )

  return NextResponse.json({ id: created.id }, { status: 201 })
}
