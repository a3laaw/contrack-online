// GET /api/reports/summary?from=&to= — الملخص المالي (عدادات + شهري + توزيع الحالات)
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authGuard, parseDay } from '@/lib/api-utils'
import { round3 } from '@/lib/format'
import type { ReportSummaryDTO } from '@/lib/report-types'

/** نطاق نصي [from..to] لتواريخ yyyy-MM-dd المخزنة نصيًا */
function dayRange(from: string, to: string): { gte?: string; lte?: string } | undefined {
  if (!from && !to) return undefined
  const range: { gte?: string; lte?: string } = {}
  if (from) range.gte = from
  if (to) range.lte = to
  return range
}

export async function GET(req: NextRequest) {
  const g = await authGuard(req)
  if ('response' in g) return g.response

  const sp = req.nextUrl.searchParams
  const fromD = parseDay(sp.get('from'))
  const toD = parseDay(sp.get('to'))
  const range = dayRange(fromD, toD)

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1)
  const twelveMonthsAgoStr = `${twelveMonthsAgo.getFullYear()}-${String(twelveMonthsAgo.getMonth() + 1).padStart(2, '0')}-01`

  const contractWhere: Record<string, unknown> = range ? { contractDate: range } : {}
  const receiptWhere = {
    vtype: 'receipt',
    cancelled: false,
    ...(range ? { vdate: range } : {}),
  }
  const paymentWhere = {
    vtype: 'payment',
    cancelled: false,
    ...(range ? { vdate: range } : {}),
  }

  const [contracts, receipts, payments, paymentLines, monthlyReceipts, monthlyPayments] = await Promise.all([
    db.contract.findMany({
      where: contractWhere,
      select: { amount: true, status: true },
    }),
    db.voucher.findMany({ where: receiptWhere, select: { amount: true } }),
    db.voucher.findMany({ where: paymentWhere, select: { amount: true } }),
    db.paymentPlanItem.findMany({ select: { id: true, amount: true, dueDate: true } }),
    db.voucher.findMany({
      where: { vtype: 'receipt', cancelled: false, vdate: { gte: twelveMonthsAgoStr } },
      select: { vdate: true, amount: true },
    }),
    db.voucher.findMany({
      where: { vtype: 'payment', cancelled: false, vdate: { gte: twelveMonthsAgoStr } },
      select: { vdate: true, amount: true },
    }),
  ])

  // المسدد لكل دفعة = مجموع روابط سندات القبض غير الملغاة
  const links = await db.voucherPaymentLink.findMany({
    where: { kind: 'receipt', voucher: { cancelled: false } },
    select: { lineId: true, amount: true },
  })
  const paidByLine = new Map<number, number>()
  for (const l of links) paidByLine.set(l.lineId, (paidByLine.get(l.lineId) ?? 0) + Number(l.amount))

  // المتأخرات: دفعات استحقاقها قبل بداية اليوم ولم تُسدد كليًا
  let overdueCount = 0
  let overdueAmount = 0
  for (const line of paymentLines) {
    if (new Date(line.dueDate) >= todayStart) continue
    const remaining = round3(Number(line.amount) - (paidByLine.get(line.id) ?? 0))
    if (remaining > 0.0005) {
      overdueCount++
      overdueAmount += remaining
    }
  }
  overdueAmount = round3(overdueAmount)

  const receiptsAmount = round3(receipts.reduce((s, v) => s + Number(v.amount), 0))
  const paymentsAmount = round3(payments.reduce((s, v) => s + Number(v.amount), 0))
  const contractsAmount = round3(contracts.reduce((s, c) => s + Number(c.amount), 0))

  // آخر 12 شهرًا (صيغة YYYY-MM) — حتى الشهور الصفرية
  const monthlyMap = new Map<string, { receipts: number; payments: number }>()
  for (const v of monthlyReceipts) {
    const d = new Date(v.vdate)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const m = monthlyMap.get(key) ?? { receipts: 0, payments: 0 }
    m.receipts += Number(v.amount)
    monthlyMap.set(key, m)
  }
  for (const v of monthlyPayments) {
    const d = new Date(v.vdate)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const m = monthlyMap.get(key) ?? { receipts: 0, payments: 0 }
    m.payments += Number(v.amount)
    monthlyMap.set(key, m)
  }
  const monthly: ReportSummaryDTO['monthly'] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const m = monthlyMap.get(key)
    monthly.push({
      month: key,
      receipts: round3(m?.receipts ?? 0),
      payments: round3(m?.payments ?? 0),
    })
  }

  // توزيع العقود حسب الحالة
  const statusMap = new Map<string, { count: number; amount: number }>()
  for (const c of contracts) {
    const s = statusMap.get(c.status) ?? { count: 0, amount: 0 }
    s.count++
    s.amount += Number(c.amount)
    statusMap.set(c.status, s)
  }
  const byStatus = Array.from(statusMap.entries())
    .map(([status, v]) => ({ status, count: v.count, amount: round3(v.amount) }))
    .sort((a, b) => b.count - a.count)

  const fromRaw = sp.get('from')
  const toRaw = sp.get('to')
  const body: ReportSummaryDTO = {
    range: {
      from: fromD && fromRaw ? fromRaw : null,
      to: toD && toRaw ? toRaw : null,
    },
    totals: {
      contractsCount: contracts.length,
      contractsAmount,
      receiptsCount: receipts.length,
      receiptsAmount,
      paymentsCount: payments.length,
      paymentsAmount,
      netCash: round3(receiptsAmount - paymentsAmount),
      overdueCount,
      overdueAmount,
    },
    monthly,
    byStatus,
  }

  return NextResponse.json(body)
}
