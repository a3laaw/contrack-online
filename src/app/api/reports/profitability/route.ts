// GET /api/reports/profitability?groupBy=contract|customer&customerId=
// الربحية (profitability_report): لكل عقد غير ملغى/مسودة:
//   value = amount + صافي ملحقات معتمدة  (بلا تمديد الإشراف — كالأصل)
//   collected = قبض سارٍ · paid = صرف سارٍ على حسابات includeInProfitability=1
//   other_paid = paid بغير جهة subcontractor · subs_total = عقود باطن غير ملغاة
//   expected_cost = subs + other_paid · expected_profit = value − expected_cost
//   actual_profit = collected − paid · margin = actual/collected×100
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authGuard } from '@/lib/api-utils'
import { round3 } from '@/lib/format'
import { netAddendumsMap, receiptsByContract } from '../_server'
import type { ProfitabilityDTO, ProfitabilityRow } from '@/lib/report-types'

export async function GET(req: NextRequest) {
  const g = await authGuard(req)
  if ('response' in g) return g.response

  const sp = req.nextUrl.searchParams
  const groupBy = (sp.get('groupBy') ?? 'contract').trim() === 'customer' ? 'customer' : 'contract'
  const customerId = Number(sp.get('customerId') ?? '') || undefined

  const where: Record<string, unknown> = { status: { notIn: ['ملغى', 'مسودة'] } }
  if (customerId) where.customerId = customerId
  const contracts = await db.contract.findMany({
    where,
    orderBy: [{ contractDate: 'asc' }, { id: 'asc' }],
    select: {
      id: true, contractNumber: true, contractName: true, description: true,
      contractType: true, amount: true, customerId: true,
      customer: { select: { id: true, name: true } },
    },
  })
  const ids = contracts.map((c) => c.id)

  const [addendums, receipts, payments, subTotals] = await Promise.all([
    netAddendumsMap(ids),
    receiptsByContract(ids),
    // المنصرف الفعلي: صرف سارٍ على حسابات تُحتسب في الربحية (الافتراضي 1)
    db.voucher.findMany({
      where: { vtype: 'payment', cancelled: false, contractId: { in: ids } },
      select: { contractId: true, amount: true, partyType: true, expenseAccountId: true, expenseAccount: { select: { includeInProfitability: true } } },
    }),
    db.subContract.groupBy({
      by: ['contractId'],
      where: { contractId: { in: ids }, status: { notIn: ['ملغى', 'ملغي'] } },
      _sum: { amount: true },
    }),
  ])
  const subsByContract = new Map<number, number>()
  for (const s of subTotals) {
    if (s.contractId != null) subsByContract.set(s.contractId, round3(Number(s._sum.amount ?? 0)))
  }

  const paidByContract = new Map<number, number>()
  const otherPaidByContract = new Map<number, number>()
  for (const v of payments) {
    if (v.contractId == null) continue
    const include = v.expenseAccount ? v.expenseAccount.includeInProfitability : true
    if (!include) continue
    paidByContract.set(v.contractId, round3((paidByContract.get(v.contractId) ?? 0) + Number(v.amount)))
    if ((v.partyType || '') !== 'subcontractor') {
      otherPaidByContract.set(v.contractId, round3((otherPaidByContract.get(v.contractId) ?? 0) + Number(v.amount)))
    }
  }

  type Calc = {
    value: number; collected: number; cost: number
    expectedCost: number; expectedProfit: number; actualProfit: number; margin: number
    subcontracts: number; otherExpenses: number
  }
  const calc = new Map<number, Calc>()
  const contractRows: (ProfitabilityRow & { customerId: number; customerName: string })[] = []
  for (const c of contracts) {
    const netAdd = addendums.get(c.id)?.net ?? 0
    const value = round3(Number(c.amount) + netAdd)
    const collected = receipts.get(c.id) ?? 0
    const paid = paidByContract.get(c.id) ?? 0
    const otherPaid = otherPaidByContract.get(c.id) ?? 0
    const subs = subsByContract.get(c.id) ?? 0
    const expectedCost = round3(subs + otherPaid)
    const expectedProfit = round3(value - expectedCost)
    const actualProfit = round3(collected - paid)
    const margin = collected > 0.001 ? round3((actualProfit / collected) * 100) : 0
    calc.set(c.id, { value, collected, cost: paid, expectedCost, expectedProfit, actualProfit, margin, subcontracts: subs, otherExpenses: otherPaid })
    const name = (c.description || '').trim() || (c.contractName || '').trim() || c.contractNumber
    contractRows.push({
      id: c.id, customerId: c.customer.id, customerName: c.customer.name,
      contractNumber: c.contractNumber, contractName: name,
      contractType: c.contractType || 'غير محدد',
      value, collected, subcontracts: subs, otherExpenses: otherPaid,
      cost: paid, profit: actualProfit,
      expectedCost, expectedProfit, margin,
    })
  }

  let rows: ProfitabilityRow[]
  if (groupBy === 'customer') {
    rows = []
    const byCustomer = new Map<number, typeof contractRows>()
    for (const r of contractRows) {
      const list = byCustomer.get(r.customerId) ?? []
      list.push(r)
      byCustomer.set(r.customerId, list)
    }
    for (const [cid, list] of byCustomer) {
      const agg = list.reduce(
        (a, r) => ({
          value: round3(a.value + r.value),
          collected: round3(a.collected + r.collected),
          cost: round3(a.cost + r.cost),
          expectedCost: round3(a.expectedCost + r.expectedCost),
          expectedProfit: round3(a.expectedProfit + r.expectedProfit),
          profit: round3(a.profit + r.profit),
        }),
        { value: 0, collected: 0, cost: 0, expectedCost: 0, expectedProfit: 0, profit: 0 },
      )
      const margin = agg.collected > 0.001 ? round3((agg.profit / agg.collected) * 100) : 0
      rows.push({
        id: -cid,
        customerId: cid,
        customerName: list[0].customerName,
        contractNumber: `— (${list.length} عقد)`,
        contractName: list.map((r) => r.contractNumber).join('، '),
        contractType: '—',
        value: agg.value, collected: agg.collected,
        subcontracts: round3(list.reduce((s, r) => s + r.subcontracts, 0)),
        otherExpenses: round3(list.reduce((s, r) => s + r.otherExpenses, 0)),
        cost: agg.cost, profit: agg.profit,
        expectedCost: agg.expectedCost, expectedProfit: agg.expectedProfit,
        margin,
      })
    }
  } else {
    rows = contractRows.map(({ customerId: _c, customerName: _n, ...rest }) => {
      void _c
      void _n
      return rest
    })
  }

  const t = rows.reduce(
    (a, r) => ({
      value: round3(a.value + r.value),
      collected: round3(a.collected + r.collected),
      cost: round3(a.cost + r.cost),
      profit: round3(a.profit + r.profit),
      expectedCost: round3(a.expectedCost + r.expectedCost),
      expectedProfit: round3(a.expectedProfit + r.expectedProfit),
    }),
    { value: 0, collected: 0, cost: 0, profit: 0, expectedCost: 0, expectedProfit: 0 },
  )
  const body: ProfitabilityDTO = {
    groupBy,
    rows,
    totals: {
      ...t,
      margin: t.collected > 0.001 ? round3((t.profit / t.collected) * 100) : 0,
      expectedMargin: t.expectedProfit !== 0 && t.value !== 0
        ? round3((t.expectedProfit / t.value) * 100)
        : 0,
    },
  }
  return NextResponse.json(body)
}
