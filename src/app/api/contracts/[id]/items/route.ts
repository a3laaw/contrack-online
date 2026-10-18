// GET  /api/contracts/[id]/items — بنود العقد غير المحذوفة + الإجماليات والفرق
// POST /api/contracts/[id]/items — إضافة بند جديد (مع حدث «إضافة بند»)
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { addContractEvent, authGuard, jsonError, parseAmount } from '@/lib/api-utils'
import { formatKWD, round3 } from '@/lib/format'

async function loadContract(cid: number) {
  return db.contract.findUnique({ where: { id: cid }, select: { id: true, amount: true } })
}

/** يطبع stageId القادم من الطلب: null/''/0 تعني «بدون مرحلة» */
function normalizeStageId(v: unknown): number | null | 'invalid' {
  if (v == null || v === '' || v === 0 || v === '0') return null
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) return 'invalid'
  return n
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await authGuard(req)
  if (g.error) return g.error

  const { id } = await ctx.params
  const cid = Number(id)
  if (!Number.isInteger(cid)) return jsonError('معرّف غير صالح', 400)

  const contract = await loadContract(cid)
  if (!contract) return jsonError('العقد غير موجود', 404)

  const items = await db.boqItem.findMany({
    where: { contractId: cid, deletedAt: null },
    orderBy: { id: 'asc' },
    include: { stage: { select: { name: true } } },
  })

  let itemsTotal = 0
  const rows = items.map((it) => {
    const total = round3(it.qty * it.unitPrice)
    itemsTotal += total
    return {
      id: it.id,
      description: it.description,
      qty: it.qty,
      unit: it.unit,
      unitPrice: it.unitPrice,
      total,
      stageId: it.stageId,
      stageName: it.stage?.name ?? null,
    }
  })
  itemsTotal = round3(itemsTotal)
  const contractAmount = round3(contract.amount)

  return NextResponse.json({
    items: rows,
    itemsTotal,
    contractAmount,
    diff: round3(itemsTotal - contractAmount),
  })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await authGuard(req)
  if (g.error) return g.error

  const { id } = await ctx.params
  const cid = Number(id)
  if (!Number.isInteger(cid)) return jsonError('معرّف غير صالح', 400)

  const contract = await loadContract(cid)
  if (!contract) return jsonError('العقد غير موجود', 404)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return jsonError('طلب غير صالح', 400)
  }

  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!description) return jsonError('وصف البند إلزامي', 400)

  const qty = parseAmount(body.qty)
  if (qty == null || qty <= 0) return jsonError('الكمية يجب أن تكون رقمًا أكبر من صفر', 400)

  const unitPrice = parseAmount(body.unitPrice)
  if (unitPrice == null) return jsonError('سعر الوحدة يجب أن يكون رقمًا غير سالب', 400)

  const unit = typeof body.unit === 'string' ? body.unit.trim() : ''

  const norm = normalizeStageId(body.stageId)
  if (norm === 'invalid') return jsonError('معرّف المرحلة غير صالح', 400)
  let stageId: number | null = null
  if (norm != null) {
    const stage = await db.contractStage.findUnique({ where: { id: norm } })
    if (!stage || stage.contractId !== cid) {
      return jsonError('المرحلة المحددة لا تنتمي إلى هذا العقد', 400)
    }
    stageId = norm
  }

  const item = await db.boqItem.create({
    data: { contractId: cid, description, qty, unit, unitPrice, stageId },
  })

  const total = round3(qty * unitPrice)
  await addContractEvent(
    cid,
    'إضافة بند',
    `إضافة بند «${description}» — ${qty} ${unit || 'بدون وحدة'} × ${formatKWD(unitPrice)} = ${formatKWD(total)}`,
    g.user.username,
  )

  return NextResponse.json({ id: item.id }, { status: 201 })
}
