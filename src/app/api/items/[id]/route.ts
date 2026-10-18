// PATCH  /api/items/[id] — تعديل بند BOQ (حقول اختيارية + حدث «تعديل بند»)
// DELETE /api/items/[id] — حذف ناعم (deletedAt) — للمدير فقط + حدث «حذف بند»
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { adminGuard, authGuard, jsonError } from '@/lib/api-utils'
import { formatKWD, round3 } from '@/lib/format'

/** تحويل قيمة مدخل إلى رقم — null إن كانت غير رقمية (بديل محلي) */
function parseAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** حدث على العقد (بديل محلي) */
async function addContractEvent(contractId: number, eventType: string, description: string, username: string) {
  await db.contractEvent.create({ data: { contractId, eventType, description, username } })
}

function stageLabel(name: string | null | undefined): string {
  return name || 'بدون مرحلة'
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await authGuard(req)
  if ('response' in g) return g.response

  const { id } = await ctx.params
  const iid = Number(id)
  if (!Number.isInteger(iid)) return jsonError('معرّف غير صالح', 400)

  const item = await db.boqItem.findUnique({
    where: { id: iid },
    include: { stage: { select: { name: true } } },
  })
  if (!item) return jsonError('البند غير موجود', 404)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return jsonError('طلب غير صالح', 400)
  }

  const data: {
    description?: string
    qty?: number
    unit?: string
    unitPrice?: number
    stageId?: number | null
  } = {}
  const changes: string[] = []

  if ('description' in body) {
    const d = typeof body.description === 'string' ? body.description.trim() : ''
    if (!d) return jsonError('وصف البند لا يمكن أن يكون فارغًا', 400)
    if (d !== item.description) {
      data.description = d
      changes.push(`الوصف «${item.description}» → «${d}»`)
    }
  }

  if ('qty' in body) {
    const q = parseAmount(body.qty)
    if (q == null || q <= 0) return jsonError('الكمية يجب أن تكون رقمًا أكبر من صفر', 400)
    if (q !== Number(item.qty)) {
      data.qty = q
      changes.push(`الكمية ${item.qty} → ${q}`)
    }
  }

  if ('unit' in body) {
    const u = typeof body.unit === 'string' ? body.unit.trim() : ''
    if (u !== item.unit) {
      data.unit = u
      changes.push(`الوحدة «${item.unit || 'بدون'}» → «${u || 'بدون'}»`)
    }
  }

  if ('unitPrice' in body) {
    const up = parseAmount(body.unitPrice)
    if (up == null) return jsonError('سعر الوحدة يجب أن يكون رقمًا غير سالب', 400)
    if (up !== Number(item.unitPrice)) {
      data.unitPrice = up
      changes.push(`سعر الوحدة ${formatKWD(Number(item.unitPrice))} → ${formatKWD(up)}`)
    }
  }

  if ('stageId' in body) {
    let sid: number | null = null
    if (body.stageId != null && body.stageId !== '' && body.stageId !== 0 && body.stageId !== '0') {
      const n = Number(body.stageId)
      if (!Number.isInteger(n) || n <= 0) return jsonError('معرّف المرحلة غير صالح', 400)
      const stage = await db.contractStage.findUnique({ where: { id: n } })
      if (!stage || stage.contractId !== item.contractId) {
        return jsonError('المرحلة المحددة لا تنتمي إلى هذا العقد', 400)
      }
      sid = n
    }
    if (sid !== item.stageId) {
      data.stageId = sid
      const newName = sid != null
        ? (await db.contractStage.findUnique({ where: { id: sid }, select: { name: true } }))?.name ?? null
        : null
      changes.push(`المرحلة «${stageLabel(item.stage?.name)}» → «${stageLabel(newName)}»`)
    }
  }

  const updated = await db.boqItem.update({ where: { id: iid }, data })

  if (changes.length > 0) {
    await addContractEvent(
      item.contractId,
      'تعديل بند',
      `تعديل بند «${item.description}»: ${changes.join('، ')}`,
      g.user.username,
    )
  }

  return NextResponse.json({ id: updated.id })
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await adminGuard(req)
  if ('response' in g) return g.response

  const { id } = await ctx.params
  const iid = Number(id)
  if (!Number.isInteger(iid)) return jsonError('معرّف غير صالح', 400)

  const item = await db.boqItem.findUnique({ where: { id: iid } })
  if (!item) return jsonError('البند غير موجود', 404)

  // حذف ناعم — لا نكرّر الحدث إن كان محذوفًا مسبقًا
  if (!item.deleted) {
    await db.boqItem.update({ where: { id: iid }, data: { deleted: true } })
    await addContractEvent(
      item.contractId,
      'حذف بند',
      `حذف بند «${item.description}» — ${item.qty} ${item.unit || 'بدون وحدة'} × ${formatKWD(Number(item.unitPrice))} = ${formatKWD(round3(Number(item.qty) * Number(item.unitPrice)))}`,
      g.user.username,
    )
  }

  return NextResponse.json({ ok: true })
}
