// ============================================================
// ConTrack Online — منطق التقارير المشترك (خادم فقط)
// نقل حرفي لقواعد الأصل (spec-8-b):
//  · القاعدة 35: current = amount + Σملحقات معتمدة (صافي) + تمديد إشراف
//  · الإشراف: كل شهر «بدأ» بعد النهاية يُحسب شهرًا كاملًا
//  · FIFO V6.2: بركة القبض غير المخصص تُصرف على الخطة ثم الروابط الصريحة
//  · العتبة المالية 0.001 · التواريخ نصية yyyy-MM-dd
// ============================================================
import { db } from '@/lib/db'
import { round3 } from '@/lib/format'

export const EPS = 0.001

/** yyyy-MM-dd من Date (بأجزاء UTC) */
export function dayStr(d: Date | null | undefined): string | null {
  if (!d) return null
  return d.toISOString().slice(0, 10)
}

/** «اليوم» على منتصف النهار UTC لطابق مقارنة التواريخ المخزنة 12:00 */
export function todayNoon(): Date {
  const n = new Date()
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 12))
}

/** فرق أيام تقويمي (أجزاء التاريخ فقط) */
export function calendarDays(later: Date, earlier: Date): number {
  const a = Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate())
  const b = Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), earlier.getUTCDate())
  return Math.round((a - b) / 86_400_000)
}

/** إضافة أشهر تقويمية — اليوم يُثبَّت ويُقصَّر لآخر الشهر عند اللزوم (كالأصل) */
export function addMonths(d: Date, months: number): Date {
  const y0 = d.getUTCFullYear()
  const m0 = d.getUTCMonth()
  const day = d.getUTCDate()
  const total = m0 + months
  const y = y0 + Math.floor(total / 12)
  const m = ((total % 12) + 12) % 12
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(day, last), 12))
}

/**
 * عدد الشهور التي «بدأت» من `from` حتى `to` — حلقة الأصل حرفيًا:
 * while add_months(from, k) <= to: k += 1  (بدايةً من k=0)
 * أي أن الشهر الذي يبدأ على `from` نفسه يُعدّ كاملًا متى to >= from.
 */
export function monthsStarted(from: Date, to: Date): number {
  if (to < from) return 0
  let k = 0
  while (k < 1440 && addMonths(from, k) <= to) k++
  return k
}

/** صياغة عربية «شهران و15 يومًا» (كالأصل) */
export function monthsDaysText(m: number, d: number): string {
  const parts: string[] = []
  if (m > 0) parts.push(m === 1 ? 'شهر واحد' : m === 2 ? 'شهران' : `${m} أشهر`)
  if (d > 0) parts.push(d === 1 ? 'يوم واحد' : d === 2 ? 'يومان' : `${d} يومًا`)
  if (parts.length === 0) return 'أقل من يوم'
  return parts.join(' و')
}

// ------------------------------------------------------------
// الملاحق المعتمدة (صافي) — قاعدة 35
// ------------------------------------------------------------

export interface NetAddendum {
  net: number
  debit: number // الصافي الموجب
  credit: number // الصافي السالب (موجب)
}

/** صافي الملحقات المعتمدة لكل عقد (يُهمل ما < 0.001 لكل ملحق كالأصل) */
export async function netAddendumsMap(contractIds: number[]): Promise<Map<number, NetAddendum>> {
  const map = new Map<number, NetAddendum>()
  if (contractIds.length === 0) return map
  const rows = await db.addendum.findMany({
    where: { contractId: { in: contractIds }, status: 'معتمد' },
    select: { contractId: true, amountAdd: true, amountDeduct: true },
  })
  for (const r of rows) {
    const net = round3(r.amountAdd - r.amountDeduct)
    if (Math.abs(net) < EPS) continue
    const cur = map.get(r.contractId) ?? { net: 0, debit: 0, credit: 0 }
    cur.net = round3(cur.net + net)
    if (net > 0) cur.debit = round3(cur.debit + net)
    else cur.credit = round3(cur.credit + (-net))
    map.set(r.contractId, cur)
  }
  return map
}

// ------------------------------------------------------------
// حالة الإشراف (عقد) — نقل حرفي لـ supervision_service.supervision_status
// ------------------------------------------------------------

export interface SupStatus {
  start: string
  baseEnd: string
  months: number
  monthly: number
  baseValue: number
  extensionMonths: number // المحسوبة (قبل التنازل)
  waivedMonths: number
  waiveReason: string
  billableExtension: number
  extensionValue: number
  totalDue: number
  collected: number
  remaining: number
  inExtension: boolean
  paidExtensionValue: number
  paidExtensionMonths: number
  settledExtensionMonths: number
  fullEnd: string
  delayMonths: number
  delayDays: number
  delayText: string
  delayValue: number
}

/** تطبيع أ→ا/إ/آ لمطابقة اسم مرحلة «إنهاء الإشراف» كالأصل */
function normAr(s: string): string {
  return (s || '').replaceAll('أ', 'ا').replaceAll('إ', 'ا').replaceAll('آ', 'ا')
}

/**
 * نهاية الإشراف الفعلية: مرحلة اسمها يحوي «انهاء» و«اشراف» أُغلقت —
 * بعدها لا تُحسب أيام جديدة (كالأصل _actual_supervision_end).
 */
async function actualSupervisionEnd(contractId: number): Promise<Date | null> {
  const stages = await db.contractStage.findMany({
    where: { contractId, endDate: { not: null }, isSkipped: false },
    select: { name: true, endDate: true },
    orderBy: { endDate: 'desc' },
  })
  for (const s of stages) {
    const n = normAr(s.name)
    if (n.includes('انهاء') && n.includes('اشراف')) return s.endDate
  }
  return null
}

export function isSupervisionContract(c: {
  supStartDate: Date | null
  supMonths: number
  supMonthly: number
}): boolean {
  return Boolean(c.supStartDate) && c.supMonths > 0 && c.supMonthly > 0
}

/** الحالة الكاملة لعقد إشراف (collected = قبض العقد الساري) */
export function supervisionStatus(
  c: {
    supStartDate: Date | null
    supMonths: number
    supMonthly: number
    supDiscount: number
    supWaivedMonths: number
    supWaiveReason: string
  },
  collected: number,
  today: Date,
  actualEnd: Date | null = null,
): SupStatus | null {
  if (!isSupervisionContract(c)) return null
  const start = c.supStartDate as Date
  const effToday = actualEnd && today >= actualEnd ? actualEnd : today
  const months = c.supMonths
  const monthly = c.supMonthly
  const discount = c.supDiscount || 0
  const waived = c.supWaivedMonths || 0
  const gross = months * monthly
  const baseValue = Math.max(0, gross - discount)
  const baseEnd = addMonths(start, months)
  const extensionMonths = monthsStarted(baseEnd, effToday)
  const billable = Math.max(0, extensionMonths - waived)
  const extensionValue = round3(billable * monthly)
  const totalDue = round3(baseValue + extensionValue)
  const paidExtValue = Math.max(0, Math.min(extensionValue, collected - baseValue))
  const paidExtMonths = monthly ? round3(paidExtValue / monthly) : 0
  const settledExt = Math.max(0, paidExtMonths + waived)
  const fullEnd = addMonths(start, months + Math.trunc(settledExt))
  const delayMonths = monthsStarted(fullEnd, effToday)
  const delayDays = Math.max(0, calendarDays(effToday, fullEnd))
  const delayValue = round3(delayMonths * monthly)
  let delayText = 'لا تأخير'
  if (effToday > fullEnd) {
    const em = monthsStarted(fullEnd, effToday)
    const ed = calendarDays(effToday, addMonths(fullEnd, em))
    delayText = monthsDaysText(em, ed)
  }
  return {
    start: dayStr(start) as string,
    baseEnd: dayStr(baseEnd) as string,
    months,
    monthly,
    baseValue: round3(baseValue),
    extensionMonths,
    waivedMonths: waived,
    waiveReason: c.supWaiveReason || '',
    billableExtension: billable,
    extensionValue,
    totalDue,
    collected: round3(collected),
    remaining: round3(totalDue - collected),
    inExtension: effToday >= baseEnd,
    paidExtensionValue: round3(paidExtValue),
    paidExtensionMonths: paidExtMonths,
    settledExtensionMonths: settledExt,
    fullEnd: dayStr(fullEnd) as string,
    delayMonths,
    delayDays,
    delayText,
    delayValue,
  }
}

/** خريطة القيم الحالية لكل عقد (قاعدة 35) — دفعة واحدة */
export async function contractValuesMap(
  contractIds: number[],
): Promise<Map<number, { amount: number; netAdd: number; supExt: number; current: number }>> {
  const map = new Map<number, { amount: number; netAdd: number; supExt: number; current: number }>()
  if (contractIds.length === 0) return map
  const [contracts, addendums, receipts] = await Promise.all([
    db.contract.findMany({
      where: { id: { in: contractIds } },
      select: {
        id: true, amount: true, supStartDate: true, supMonths: true,
        supMonthly: true, supDiscount: true, supWaivedMonths: true,
        supWaiveReason: true,
      },
    }),
    netAddendumsMap(contractIds),
    receiptsByContract(contractIds),
  ])
  for (const c of contracts) {
    const amount = c.amount
    const netAdd = addendums.get(c.id)?.net ?? 0
    const collected = receipts.get(c.id) ?? 0
    let supExt = 0
    if (isSupervisionContract(c)) {
      const st = supervisionStatus(c, collected, todayNoon())
      supExt = st ? st.extensionValue : 0
    }
    map.set(c.id, { amount: round3(amount), netAdd, supExt, current: round3(amount + netAdd + supExt) })
  }
  return map
}

// ------------------------------------------------------------
// السندات: قبض / روابط / برك
// ------------------------------------------------------------

/** مجموع القبض الساري لكل عقد (كل السندات — كما في dues_report) */
export async function receiptsByContract(contractIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>()
  if (contractIds.length === 0) return map
  const rows = await db.voucher.groupBy({
    by: ['contractId'],
    where: { vtype: 'receipt', cancelled: false, contractId: { in: contractIds } },
    _sum: { amount: true },
  })
  for (const r of rows) {
    if (r.contractId != null) map.set(r.contractId, round3(r._sum.amount ?? 0))
  }
  return map
}

/** القبض غير المخصص (allocation فارغ) لكل عقد — بركة stage_dues */
export async function unallocatedReceiptsByContract(contractIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>()
  if (contractIds.length === 0) return map
  const rows = await db.voucher.groupBy({
    by: ['contractId'],
    where: {
      vtype: 'receipt', cancelled: false,
      allocation: '', contractId: { in: contractIds },
    },
    _sum: { amount: true },
  })
  for (const r of rows) {
    if (r.contractId != null) map.set(r.contractId, round3(r._sum.amount ?? 0))
  }
  return map
}

/** الروابط الصريحة: لكل عقد مجموع روابط القبض السارية غير المخصصة + لكل خط مبلغه */
export async function receiptLinksMaps(contractIds: number[]): Promise<{
  byContract: Map<number, number>
  byLine: Map<number, number>
}> {
  const byContract = new Map<number, number>()
  const byLine = new Map<number, number>()
  if (contractIds.length === 0) return { byContract, byLine }
  const rows = await db.voucherPaymentLink.findMany({
    where: { kind: 'receipt', voucher: { cancelled: false, allocation: '' } },
    select: { lineId: true, amount: true, voucher: { select: { contractId: true } } },
  })
  const lineToContract = new Map<number, number>()
  const plans = await db.paymentPlan.findMany({
    where: { contractId: { in: contractIds } },
    select: { id: true, contractId: true },
  })
  for (const p of plans) lineToContract.set(p.id, p.contractId)
  for (const l of rows) {
    const cid = lineToContract.get(l.lineId)
    if (cid == null) continue
    byLine.set(l.lineId, round3((byLine.get(l.lineId) ?? 0) + l.amount))
    byContract.set(cid, round3((byContract.get(cid) ?? 0) + l.amount))
  }
  return { byContract, byLine }
}

/** روابط الصرف لخطط الباطن: لكل خط مبلغه (سندات غير ملغاة) */
export async function paymentLinksByLine(subContractIds: number[]): Promise<Map<number, number>> {
  const byLine = new Map<number, number>()
  if (subContractIds.length === 0) return byLine
  const plans = await db.subPaymentPlan.findMany({
    where: { subContractId: { in: subContractIds } },
    select: { id: true },
  })
  const ids = new Set(plans.map((p) => p.id))
  if (ids.size === 0) return byLine
  const rows = await db.voucherPaymentLink.findMany({
    where: { kind: 'payment', voucher: { cancelled: false }, lineId: { in: [...ids] } },
    select: { lineId: true, amount: true },
  })
  for (const l of rows) byLine.set(l.lineId, round3((byLine.get(l.lineId) ?? 0) + l.amount))
  return byLine
}

// ------------------------------------------------------------
// خطة دفعات العميل: تغطية FIFO V6.2 (بركة + روابط)
// ------------------------------------------------------------

export interface PlanLineRaw {
  id: number
  contractId: number
  title: string
  dueDate: Date
  amount: number
  sortOrder: number
  stageId: number | null
  triggeredAt: Date | null
  stageSkipped: boolean
  stageName: string | null
  stageEnd: Date | null
}

/** تغطية FIFO: بركة القبض غير المخصص (ناقص الموجّه بالروابط) ثم الروابط لكل خط */
export function fifoCover(
  items: PlanLineRaw[],
  pool: number,
  linksByLine: Map<number, number>,
): { covered: number; remaining: number }[] {
  const totalLinks = round3([...linksByLine.values()].reduce((s, v) => s + v, 0))
  let remainingPool = Math.max(0, pool - totalLinks)
  return items.map((item) => {
    let covered = Math.min(remainingPool, item.amount)
    remainingPool = round3(remainingPool - covered)
    const lk = Math.min(linksByLine.get(item.id) ?? 0, Math.max(0, item.amount - covered))
    covered = round3(covered + lk)
    return { covered, remaining: round3(item.amount - covered) }
  })
}

/** تحميل خطة عقود العميل بترتيب (dueDate, sortOrder) مع بيانات المرحلة */
export async function loadCustomerPlan(contractIds: number[]): Promise<Map<number, PlanLineRaw[]>> {
  const byContract = new Map<number, PlanLineRaw[]>()
  if (contractIds.length === 0) return byContract
  const rows = await db.paymentPlan.findMany({
    where: { contractId: { in: contractIds } },
    orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }],
    select: {
      id: true, contractId: true, title: true, dueDate: true, amount: true,
      sortOrder: true, stageId: true, triggeredAt: true,
      stage: { select: { name: true, isSkipped: true, endDate: true } },
    },
  })
  for (const r of rows) {
    const list = byContract.get(r.contractId) ?? []
    list.push({
      id: r.id,
      contractId: r.contractId,
      title: r.title,
      dueDate: r.dueDate,
      amount: r.amount,
      sortOrder: r.sortOrder,
      stageId: r.stageId,
      triggeredAt: r.triggeredAt,
      stageSkipped: r.stage?.isSkipped ?? false,
      stageName: r.stage?.name ?? null,
      stageEnd: r.stage?.endDate ?? null,
    })
    byContract.set(r.contractId, list)
  }
  return byContract
}

// ------------------------------------------------------------
// المستحق الآن (صارم V4.3) لكل عقد — overdue_plan_items(strict=true)
// ------------------------------------------------------------

/**
 * لكل عقد: مجموع بواقي الدفعات المتأخرة الصارمة (بعد استبعاد المتخطاة
 * والمعلقة على مرحلة) — والعقد بلا خطة يعود بقاله من remaining الممرر.
 */
export function strictDueByContract(
  plans: Map<number, PlanLineRaw[]>,
  poolByContract: Map<number, number>,
  linksByContract: Map<number, number>,
  linksByLine: Map<number, number>,
  duesRemaining: Map<number, number>,
  today: Date,
): Map<number, number> {
  const out = new Map<number, number>()
  const cids = new Set<number>([...plans.keys(), ...duesRemaining.keys()])
  for (const cid of cids) {
    const items = plans.get(cid)
    if (!items || items.length === 0) {
      const rem = duesRemaining.get(cid) ?? 0
      if (rem > EPS) out.set(cid, round3(rem))
      continue
    }
    const pool = poolByContract.get(cid) ?? 0
    const covers = fifoCover(items, pool, linksByLine)
    let sum = 0
    items.forEach((it, i) => {
      const { remaining } = covers[i]
      const stageLinked = Boolean(it.stageId)
      const triggered = Boolean(it.triggeredAt)
      if (stageLinked && it.stageSkipped) return
      if (stageLinked && !triggered && remaining > EPS) return
      if (remaining <= EPS) return
      if (calendarDays(it.dueDate, today) > 0) return // strict: اليوم أو قبله
      sum = round3(sum + remaining)
    })
    if (sum > EPS) out.set(cid, sum)
  }
  return out
}

// ------------------------------------------------------------
// المحافظ (بنك/صندوق) بتصنيف طريقة الدفع — كالأصل
// ------------------------------------------------------------

const CASH_METHODS = ['نقد', 'نقدًا', 'نقدا', 'صندوق', 'الصندوق']
const BANK_METHODS = ['تحويل', 'شيك', 'KNET', 'بنك', 'البنك']

export function walletOf(method: string): 'bank' | 'cash' {
  const m = (method || '').trim()
  if (BANK_METHODS.some((k) => m.includes(k))) return 'bank'
  if (CASH_METHODS.some((k) => m.includes(k))) return 'cash'
  return 'cash'
}

export const BANK_FEE_MARK = '[رسوم بنك]'
export const GATEWAY_FEE_MARK = '[رسوم بوابة]'

/** هل السند تصفية عهدة (موزعة داخلية بلا خروج نقدي جديد)؟ */
export function isSettlementVoucher(v: { notes: string; description: string }): boolean {
  const t = `${v.notes || ''} ${v.description || ''}`
  return t.includes('تصفية عهدة من حساب:') || t.includes('إغلاق عهدة من حساب:')
}
