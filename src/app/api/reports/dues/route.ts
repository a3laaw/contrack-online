// GET /api/reports/dues?from=&to=&customerId= — تقرير مستحقات العقود (dues_report)
// القاعدة 35: value = amount + صافي ملحقات معتمدة + مديونية تمديد الإشراف
// remaining = value − collected؛ يُخفى ما ≤ 0.001 — «مغلق» يبقى داخل التقرير.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authGuard, parseDay } from '@/lib/api-utils'
import { round3 } from '@/lib/format'
import { EPS, contractValuesMap, dayStr, receiptsByContract } from '../_server'
import type { DuesDTO, DuesRow } from '@/lib/report-types'

export async function GET(req: NextRequest) {
  const g = await authGuard(req)
  if ('response' in g) return g.response

  const sp = req.nextUrl.searchParams
  const customerId = Number(sp.get('customerId') ?? '') || undefined
  const fromD = parseDay(sp.get('from'))
  const toD = parseDay(sp.get('to'))

  const where: Record<string, unknown> = { status: { notIn: ['ملغى', 'مسودة'] } }
  if (customerId) where.customerId = customerId
  const dRange: Record<string, string> = {}
  if (fromD) dRange.gte = fromD
  if (toD) dRange.lte = toD
  if (fromD || toD) where.contractDate = dRange

  const contracts = await db.contract.findMany({
    where,
    orderBy: [{ contractDate: 'asc' }, { id: 'asc' }],
    select: {
      id: true, contractNumber: true, contractName: true, description: true,
      contractType: true, status: true, contractDate: true, customerId: true,
      amount: true,
      customer: { select: { name: true } },
    },
  })
  const ids = contracts.map((c) => c.id)
  const [values, collectedMap] = await Promise.all([
    contractValuesMap(ids),
    receiptsByContract(ids),
  ])

  const rows: DuesRow[] = []
  for (const c of contracts) {
    const v = values.get(c.id) ?? { amount: Number(c.amount), netAdd: 0, supExt: 0, current: round3(Number(c.amount)) }
    const collected = collectedMap.get(c.id) ?? 0
    const remaining = round3(v.current - collected)
    if (remaining <= EPS) continue
    rows.push({
      contractId: c.id,
      contractNumber: c.contractNumber,
      contractName: (c.description || '').trim() || (c.contractName || '').trim() || c.contractNumber,
      customerName: c.customer.name,
      contractType: c.contractType,
      status: c.status,
      contractDate: dayStr(c.contractDate) ?? '',
      value: v.current,
      rawAmount: v.amount,
      netAddendum: v.netAdd,
      supExtension: v.supExt,
      collected,
      remaining,
    })
  }

  const body: DuesDTO = {
    rows,
    totals: {
      count: rows.length,
      value: round3(rows.reduce((s, r) => s + r.value, 0)),
      collected: round3(rows.reduce((s, r) => s + r.collected, 0)),
      remaining: round3(rows.reduce((s, r) => s + r.remaining, 0)),
    },
  }
  return NextResponse.json(body)
}
