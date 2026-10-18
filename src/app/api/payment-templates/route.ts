// ============================================================
// GET  /api/payment-templates?contractType= — قالب دفعات النوع (مرتب بـ payNo)
// POST /api/payment-templates — إضافة دفعة لقالب النوع
// القواعد الحرفية: «المرحلة↔دفعة واحدة»، «مرحلة واحدة = هي المحفزة تلقائيًا»،
// «المحفزة من مراحل الدفعة نفسها»، «ممنوع ربط مرحلة رئيسية تجميعية»
// (type_payment_tpl/type_payment_stages — spec-8-f §7)
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { adminGuard, authGuard, jsonError } from '@/lib/api-utils'
import { templateError, validateTemplateInput } from '@/lib/payment-template-server'
import type { PaymentTemplateDTO } from '@/lib/admin-types'

function kindOf(pct: number, amountFixed: number): PaymentTemplateDTO['kind'] {
  if (amountFixed > 0) return 'fixed'
  if (pct > 0) return 'pct'
  return 'flex'
}

async function listTemplates(contractTypeId: number): Promise<PaymentTemplateDTO[]> {
  const rows = await db.typePaymentTemplate.findMany({
    where: { contractTypeId },
    orderBy: { payNo: 'asc' },
    include: {
      triggerStage: { select: { stageName: true } },
      stageLinks: { include: { stage: { select: { id: true, stageName: true } } } },
    },
  })
  return rows.map((t) => ({
    id: t.id,
    payNo: t.payNo,
    title: t.title,
    pct: Number(t.pct),
    amountFixed: Number(t.amountFixed),
    daysOffset: t.daysOffset,
    linkKeyword: t.linkKeyword,
    kind: kindOf(Number(t.pct), Number(t.amountFixed)),
    triggerStageId: t.triggerStageId,
    triggerStageName: t.triggerStage?.stageName ?? null,
    stages: t.stageLinks.map((l) => ({ stageId: l.stage.id, stageName: l.stage.stageName })),
  }))
}

export async function GET(req: NextRequest) {
  const g = await authGuard(req)
  if ('response' in g) return g.response

  const contractType = req.nextUrl.searchParams.get('contractType')?.trim() ?? ''
  if (!contractType) return jsonError('نوع العقد مطلوب', 400)
  const type = await db.contractType.findUnique({ where: { name: contractType } })
  if (!type) return jsonError('نوع العقد غير موجود', 404)
  return NextResponse.json({ contractType, templates: await listTemplates(type.id) })
}

export async function POST(req: NextRequest) {
  const g = await adminGuard(req)
  if ('response' in g) return g.response

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonError('طلب غير صالح', 400)
  }

  const contractType = typeof body.contractType === 'string' ? body.contractType.trim() : ''
  if (!contractType) return jsonError('نوع العقد مطلوب', 400)

  const type = await db.contractType.findUnique({ where: { name: contractType } })
  if (!type) return jsonError('نوع العقد غير موجود', 404)

  try {
    const v = await validateTemplateInput({
      contractType,
      contractTypeId: type.id,
      title: body.title,
      valueMode: body.valueMode,
      pct: body.pct,
      amountFixed: body.amountFixed,
      stageIds: body.stageIds,
      triggerStageId: body.triggerStageId,
      daysOffset: body.daysOffset,
      payNo: body.payNo,
    })

    const created = await db.typePaymentTemplate.create({
      data: {
        contractTypeId: type.id,
        payNo: v.payNo,
        title: v.title,
        pct: v.pct,
        amountFixed: v.amountFixed,
        triggerStageId: v.triggerStageId,
        daysOffset: v.daysOffset,
        stageLinks: {
          create: v.stageIds.map((stageId) => ({ stageId })),
        },
      },
    })
    return NextResponse.json({ id: created.id }, { status: 201 })
  } catch (e) {
    return templateError(e)
  }
}
