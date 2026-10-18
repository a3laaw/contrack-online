// POST /api/vouchers/[id]/cancel — إلغاء سند (المدير فقط)
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { adminGuard, jsonError, todayStr } from '@/lib/api-utils'

/** حدث على العقد (بديل محلي) */
async function addContractEvent(contractId: number, eventType: string, description: string, username: string) {
  await db.contractEvent.create({ data: { contractId, eventType, description, username } })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await adminGuard(req)
  if ('response' in g) return g.response

  const { id } = await ctx.params
  const vid = Number(id)
  if (!Number.isInteger(vid)) return jsonError('معرّف غير صالح', 400)
  const voucher = await db.voucher.findUnique({ where: { id: vid } })
  if (!voucher) return jsonError('السند غير موجود', 404)
  if (voucher.cancelled) return jsonError('السند ملغى مسبقًا', 409)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonError('طلب غير صالح', 400)
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason) return jsonError('ذكر سبب الإلغاء مطلوب', 400)

  // حارس المطالبات (lifecycle_service.py:4741-4751): مطالبة سارية على العقد تمنع إلغاء السند
  if (voucher.contractId) {
    const activeClaims = await db.claim.findMany({
      where: { contractId: voucher.contractId, status: { notIn: ['registered', 'cancelled'] } },
      select: { claimNumber: true },
      orderBy: { id: 'asc' },
      take: 5,
    })
    if (activeClaims.length > 0) {
      return jsonError(
        `لا يمكن إلغاء السند — توجد مطالبات مالية سارية على العقد (${activeClaims.map((c) => c.claimNumber).join('، ')}). أنهِ/ألغِ المطالبة أولًا`,
        400,
      )
    }
  }

  const updated = await db.voucher.update({
    where: { id: vid },
    data: { cancelled: true, cancelReason: reason, cancelledAt: todayStr() },
  })

  if (updated.contractId) {
    await addContractEvent(
      updated.contractId,
      'إلغاء سند',
      `إلغاء السند ${updated.voucherNumber} بمبلغ ${updated.amount.toFixed(3)} د.ك — السبب: ${reason}`,
      g.user.username,
    )
  }

  return NextResponse.json({ ok: true, id: updated.id })
}
