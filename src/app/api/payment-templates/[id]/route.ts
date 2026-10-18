// ============================================================
// PATCH  /api/payment-templates/[id] — تعديل دفعة من قالب النوع
// DELETE /api/payment-templates/[id] — حذف دفعة (تُحذف روابط مراحلها Cascade)
// الحقول غير المرسلة تبقى كما هي (تعديل جزئي) مع إعادة تطبيق كل قواعد الربط
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { adminGuard, jsonError } from '@/lib/api-utils'
import { templateError, validateTemplateInput } from '@/lib/payment-template-server'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await adminGuard(req)
  if ('response' in g) return g.response

  const { id: idRaw } = await ctx.params
  const id = Math.trunc(Number(idRaw))
  if (!Number.isInteger(id) || id <= 0) return jsonError('معرّف غير صالح', 400)

  const tpl = await db.typePaymentTemplate.findUnique({
    where: { id },
    include: {
      contractType: { select: { name: true } },
      stageLinks: { select: { stageId: true } },
    },
  })
  if (!tpl) return jsonError('الدفعة غير موجودة', 404)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonError('طلب غير صالح', 400)
  }

  try {
    // القيم الفعلية: المرسلة أو الحالية (تعديل جزئي)
    const effPct = 'pct' in body && body.pct != null && body.pct !== '' ? Number(body.pct) : Number(tpl.pct)
    const effFixed =
      'amountFixed' in body && body.amountFixed != null && body.amountFixed !== ''
        ? Number(body.amountFixed)
        : Number(tpl.amountFixed)
    const effValueMode =
      typeof body.valueMode === 'string' && body.valueMode
        ? body.valueMode
        : effFixed > 0
          ? 'fixed'
          : effPct > 0
            ? 'pct'
            : 'flex'
    const effStageIds = Array.isArray(body.stageIds)
      ? body.stageIds
      : tpl.stageLinks.map((l) => l.stageId)
    const effTrigger =
      'triggerStageId' in body ? body.triggerStageId : (tpl.triggerStageId ?? null)
    const effDays =
      'daysOffset' in body && body.daysOffset != null && body.daysOffset !== ''
        ? Number(body.daysOffset)
        : tpl.daysOffset

    const v = await validateTemplateInput({
      contractType: tpl.contractType.name,
      contractTypeId: tpl.contractTypeId,
      title: 'title' in body && typeof body.title === 'string' ? body.title : tpl.title,
      valueMode: effValueMode,
      pct: effPct,
      amountFixed: effFixed,
      stageIds: effStageIds,
      triggerStageId: effTrigger,
      daysOffset: effDays,
      payNo: 'payNo' in body && body.payNo != null && body.payNo !== '' ? Number(body.payNo) : tpl.payNo,
      excludeTemplateId: id,
    })

    await db.$transaction([
      db.typePaymentStage.deleteMany({ where: { paymentId: id } }),
      db.typePaymentTemplate.update({
        where: { id },
        data: {
          title: v.title,
          pct: v.pct,
          amountFixed: v.amountFixed,
          triggerStageId: v.triggerStageId,
          daysOffset: v.daysOffset,
          payNo: v.payNo,
          stageLinks: {
            create: v.stageIds.map((stageId) => ({ stageId })),
          },
        },
      }),
    ])

    return NextResponse.json({ id })
  } catch (e) {
    return templateError(e)
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await adminGuard(req)
  if ('response' in g) return g.response

  const { id: idRaw } = await ctx.params
  const id = Math.trunc(Number(idRaw))
  if (!Number.isInteger(id) || id <= 0) return jsonError('معرّف غير صالح', 400)

  const tpl = await db.typePaymentTemplate.findUnique({ where: { id } })
  if (!tpl) return jsonError('الدفعة غير موجودة', 404)

  await db.typePaymentTemplate.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
