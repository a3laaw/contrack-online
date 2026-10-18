// ============================================================
// ConTrack Online — تحقق قواعد ربط الدفعات بالمراحل (خادمي)
// القواعد الحرفية (workflow_service.py _validate_payment_stages — spec-8-f §7.2):
// 1) الربط بخطوات تنفيذ فعلية فقط — ممنوع الرئيسية التجميعية (لها أبناء)
// 2) المرحلة الواحدة تتبع دفعة واحدة فقط
// 3) المرحلة المحفِّزة يجب أن تكون من مراحل الدفعة نفسها
// 4) دفعة تجمع >1 مرحلة تتطلب تحديد المحفِّزة صراحةً
// 5) بلا مراحل = دفعة بالأيام بلا مُحفِّز
// 6) مُحفِّز بلا مراحل ممنوع
// + مرحلة واحدة = هي المحفِّزة تلقائيًا (add_type_payment س2949-2950)
// + amountFixed>0 يصفّر pct (س2963-2964)
// ============================================================
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError } from '@/lib/api-utils'

export type ValueMode = 'pct' | 'fixed' | 'flex'

export interface TemplateValidated {
  title: string
  pct: number
  amountFixed: number
  daysOffset: number
  stageIds: number[]
  triggerStageId: number | null
  payNo: number
}

export class TemplateInputError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

/** تحويل خطأ التحقق إلى استجابة JSON */
export function templateError(e: unknown): NextResponse {
  if (e instanceof TemplateInputError) return jsonError(e.message, e.status)
  return jsonError('تعذر حفظ قالب الدفعة', 500)
}

/** فحص أن المراحل كلها أوراق تنفيذية لنفس النوع وغير مربوطة بقالب آخر */
async function validateStageLinks(
  contractType: string,
  stageIds: number[],
  excludeTemplateId: number | null,
): Promise<void> {
  for (const stageId of stageIds) {
    const stage = await db.workflowStage.findUnique({
      where: { id: stageId },
      select: { id: true, stageName: true, contractType: true, transactionType: true },
    })
    if (!stage) throw new TemplateInputError(`المرحلة رقم ${stageId} غير موجودة`)
    if (stage.contractType !== contractType || stage.transactionType !== 'contract') {
      throw new TemplateInputError(
        `المرحلة «${stage.stageName}» لا تنتمي إلى نوع العقد «${contractType}»`,
      )
    }
    const children = await db.workflowStage.count({ where: { parentId: stage.id } })
    if (children > 0) {
      throw new TemplateInputError(
        `المرحلة «${stage.stageName}» رئيسية تجميعية — الربط بخطوات التنفيذ الفعلية فقط`,
      )
    }
    const linked = await db.typePaymentStage.findFirst({
      where: {
        stageId,
        paymentId: excludeTemplateId ? { not: excludeTemplateId } : undefined,
      },
      include: { payment: { select: { payNo: true, title: true } } },
    })
    if (linked) {
      throw new TemplateInputError(
        `مرحلة «${stage.stageName}» مربوطة بالفعل بالدفعة رقم ${linked.payment.payNo}${linked.payment.title ? ` (${linked.payment.title})` : ''}`,
      )
    }
  }
}

/**
 * تحقق شامل من مدخل قالب الدفعة ويعيد البيانات الجاهزة للحفظ.
 * يرمي TemplateInputError عند أي مخالفة (تُحوَّل عبر templateError).
 */
export async function validateTemplateInput(opts: {
  contractType: string
  contractTypeId: number
  title: unknown
  valueMode: unknown
  pct?: unknown
  amountFixed?: unknown
  stageIds?: unknown
  triggerStageId?: unknown
  daysOffset?: unknown
  payNo?: unknown
  excludeTemplateId?: number | null
}): Promise<TemplateValidated> {
  const { contractType, contractTypeId, excludeTemplateId = null } = opts

  const title = typeof opts.title === 'string' ? opts.title.trim() : ''
  if (!title) throw new TemplateInputError('اسم الدفعة إلزامي')
  if (title.length > 120) throw new TemplateInputError('اسم الدفعة طويل جدًا (الحد 120 حرفًا)')

  const valueMode = typeof opts.valueMode === 'string' ? opts.valueMode : ''
  if (!['pct', 'fixed', 'flex'].includes(valueMode)) {
    throw new TemplateInputError(
      'نمط القيمة يجب أن يكون: نسبة (pct) أو مبلغ ثابت (fixed) أو مرن (flex)',
    )
  }

  let pct = opts.pct == null || opts.pct === '' ? 0 : Number(opts.pct)
  let amountFixed =
    opts.amountFixed == null || opts.amountFixed === '' ? 0 : Number(opts.amountFixed)
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new TemplateInputError('النسبة يجب أن تكون بين 0 و 100')
  }
  if (!Number.isFinite(amountFixed) || amountFixed < 0) {
    throw new TemplateInputError('المبلغ الثابت يجب أن يكون رقمًا ≥ 0')
  }
  if (valueMode === 'pct') amountFixed = 0
  else if (valueMode === 'fixed') pct = 0
  else {
    pct = 0
    amountFixed = 0
  }

  // المراحل (إزالة التكرار)
  const rawStages = Array.isArray(opts.stageIds) ? opts.stageIds : []
  const stageIds: number[] = []
  for (const s of rawStages) {
    const n = Math.trunc(Number(s))
    if (!Number.isInteger(n) || n <= 0) throw new TemplateInputError('معرّف مرحلة غير صالح')
    if (!stageIds.includes(n)) stageIds.push(n)
  }

  // المرحلة المحفزة
  let triggerStageId =
    opts.triggerStageId == null || opts.triggerStageId === '' || opts.triggerStageId === 0
      ? null
      : Math.trunc(Number(opts.triggerStageId))

  if (stageIds.length === 0) {
    // قاعدتا 5+6: بلا مراحل = دفعة بالأيام بلا مُحفِّز
    if (triggerStageId != null) {
      throw new TemplateInputError(
        'مُحفِّز بلا مراحل ممنوع — إما اربط مراحل أو اجعل الدفعة بالأيام',
      )
    }
  } else {
    await validateStageLinks(contractType, stageIds, excludeTemplateId)
    if (triggerStageId != null && !stageIds.includes(triggerStageId)) {
      // قاعدة 3: المحفِّز من مراحل الدفعة نفسها
      throw new TemplateInputError('المرحلة المحفِّزة يجب أن تكون من مراحل الدفعة نفسها')
    }
    if (stageIds.length === 1) {
      // مرحلة واحدة = هي المحفِّزة تلقائيًا
      triggerStageId = stageIds[0]
    } else if (triggerStageId == null) {
      // قاعدة 4
      throw new TemplateInputError('الدفعة تجمع أكثر من مرحلة — حدد المرحلة المحفِّزة صراحةً')
    }
  }

  // الأيام بعد المرحلة — الافتراضي: الأيام المتوقعة للمرحلة المحفزة
  let daysOffset =
    opts.daysOffset == null || opts.daysOffset === '' ? null : Math.trunc(Number(opts.daysOffset))
  if (daysOffset != null && (!Number.isFinite(daysOffset) || daysOffset < 0)) {
    throw new TemplateInputError('الأيام بعد المرحلة يجب أن تكون رقمًا ≥ 0')
  }
  if (daysOffset == null) {
    daysOffset = 0
    if (triggerStageId != null) {
      const trig = await db.workflowStage.findUnique({
        where: { id: triggerStageId },
        select: { expectedDays: true },
      })
      daysOffset = trig?.expectedDays ?? 0
    }
  }

  // رقم الدفعة
  let payNo = opts.payNo == null || opts.payNo === '' ? null : Math.trunc(Number(opts.payNo))
  if (payNo != null && (!Number.isInteger(payNo) || payNo < 1 || payNo > 99)) {
    throw new TemplateInputError('رقم الدفعة يجب أن يكون بين 1 و 99')
  }
  if (payNo == null) {
    const max = await db.typePaymentTemplate.aggregate({
      where: { contractTypeId },
      _max: { payNo: true },
    })
    payNo = (max._max.payNo ?? 0) + 1
  } else {
    const dup = await db.typePaymentTemplate.findFirst({
      where: {
        contractTypeId,
        payNo,
        id: excludeTemplateId ? { not: excludeTemplateId } : undefined,
      },
    })
    if (dup) throw new TemplateInputError(`رقم الدفعة ${payNo} مستخدم في هذا النوع`)
  }

  return { title, pct, amountFixed, daysOffset, stageIds, triggerStageId, payNo }
}
