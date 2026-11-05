// POST /api/vouchers/[id]/cancel — إلغاء سند (المدير فقط)
// Task 107 — أُعيد توجيه المسار إلى محرك الإلغاء الموحد (cancelVoucherTx):
// كان مسارًا قديمًا يلغي ناعمًا فقط بلا عكس القيود وبلا مسح روابط السداد —
// تجاوز خطير للمحرك (درس: كل مسارات الإلغاء تمر عبر cancelVoucherTx حصرًا).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { adminGuard } from '@/lib/api-utils'
import { cancelVoucherTx, voucherCancelBarrier, VoucherError } from '@/lib/voucher-server'
import { r3 } from '@/lib/contrack-core'

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

  // حاجز المطالبات (lifecycle_service.py:4741-4751) — مطالبة سارية على العقد تمنع الإلغاء
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

  // الحواجز الموحدة للمحرك (عهدة مصفّاة/سلفة عليها خصومات) ثم الإلغاء الكامل:
  // إلغاء الأبناء + عكس القيود + مسح تخصيص الفواتير + إعادة فتح الدفعات + الأحداث والتدقيق
  try {
    const barrier = await voucherCancelBarrier(vid)
    if (barrier) return jsonError(barrier, 400)
    const result = await db.$transaction(async (tx) => {
      return cancelVoucherTx(tx, vid, reason, g.user.username)
    })
    return NextResponse.json({ ok: true, id: vid, voucherNumber: result.voucherNumber, reopened: r3(result.reopened) })
  } catch (e) {
    if (e instanceof VoucherError) return jsonError(e.message, e.status)
    console.error(e)
    return jsonError('تعذر إلغاء السند', 500)
  }
}

function jsonError(error: string, status = 400) {
  return NextResponse.json({ error }, { status })
}
