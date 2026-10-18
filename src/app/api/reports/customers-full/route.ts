// GET /api/reports/customers-full?from=&to= — تقرير «العملاء والأرصدة» (customers_full)
// لكل عميل: عدد العقود، قيمة العقود (الخام)، القيمة الحالية (قاعدة 35)،
// المحصّل، المستحق الآن (صارم V4.3)، المتبقي = current − collected،
// كشف مدين/دائن، الحالة: مستحق الآن ← عليه رصيد ← مسدّد بالكامل.
// عند تحديد فترة: الملحقات لا تدخل (تتبع الاعتماد لا الفترة) — كالأصل.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authGuard, parseDay } from '@/lib/api-utils'
import { round3 } from '@/lib/format'
import {
  EPS, contractValuesMap, loadCustomerPlan, netAddendumsMap,
  receiptLinksMaps, receiptsByContract, strictDueByContract,
  unallocatedReceiptsByContract, todayNoon,
} from '../_server'
import type { CustomerBalanceDTO, CustomerBalanceRow } from '@/lib/report-types'

export async function GET(req: NextRequest) {
  const g = await authGuard(req)
  if (g.error) return g.error

  const sp = req.nextUrl.searchParams
  const fromD = parseDay(sp.get('from'))
  const toD = parseDay(sp.get('to'))
  const hasPeriod = Boolean(fromD || toD)
  const today = todayNoon()

  const cWhere: Record<string, unknown> = { status: { not: 'ملغى' } }
  if (hasPeriod) {
    const dRange: Record<string, Date> = {}
    if (fromD) dRange.gte = fromD
    if (toD) dRange.lte = toD
    cWhere.contractDate = dRange
  }

  const [customers, contracts] = await Promise.all([
    db.customer.findMany({ orderBy: [{ id: 'asc' }], select: { id: true, name: true, customerCode: true, phone: true } }),
    db.contract.findMany({
      where: cWhere,
      orderBy: [{ contractDate: 'asc' }, { id: 'asc' }],
      select: { id: true, customerId: true, amount: true },
    }),
  ])
  const ids = contracts.map((c) => c.id)

  const [values, receipts, unallocated, links, plans, addendums] = await Promise.all([
    contractValuesMap(ids),
    receiptsByContract(ids),
    unallocatedReceiptsByContract(ids),
    receiptLinksMaps(ids),
    loadCustomerPlan(ids),
    hasPeriod ? Promise.resolve(new Map()) : netAddendumsMap(ids),
  ])

  // قبض غير مرتبط بعقد لكن على العميل (partyType='customer')
  const partyReceipts = await db.voucher.groupBy({
    by: ['partyId'],
    where: { vtype: 'receipt', cancelled: false, partyType: 'customer', contractId: null },
    _sum: { amount: true },
  })
  const partyByCustomer = new Map<number, number>()
  for (const r of partyReceipts) {
    if (r.partyId != null) partyByCustomer.set(r.partyId, round3(r._sum.amount ?? 0))
  }

  // المتبقي بقاعدة 35 لكل عقد (لحساب المستحق الآن للعقود بلا خطة)
  const duesRemaining = new Map<number, number>()
  for (const c of contracts) {
    const v = values.get(c.id)
    if (!v) continue
    const collected = round3((receipts.get(c.id) ?? 0) + (unallocated.get(c.id) ?? 0) + (links.byContract.get(c.id) ?? 0))
    const rem = round3(v.current - collected)
    if (rem > EPS) duesRemaining.set(c.id, rem)
  }
  const dueNowMap = strictDueByContract(plans, unallocated, links.byContract, links.byLine, duesRemaining, today)

  const rows: CustomerBalanceRow[] = []
  for (const cu of customers) {
    const mine = contracts.filter((c) => c.customerId === cu.id)
    if (mine.length === 0 && !partyByCustomer.has(cu.id)) {
      // عميل بلا عقود وبلا تحصيل — يُدرج بصفوف صفرية (كالأصل LEFT JOIN)
    }
    let rawValue = 0, current = 0, collected = 0, dueNow = 0
    let debit = 0, credit = partyByCustomer.get(cu.id) ?? 0
    for (const c of mine) {
      const v = values.get(c.id) ?? { amount: c.amount, netAdd: 0, supExt: 0, current: round3(c.amount) }
      const add = addendums.get(c.id)
      rawValue = round3(rawValue + v.amount)
      current = round3(current + v.current)
      const rec = receipts.get(c.id) ?? 0
      collected = round3(collected + rec)
      debit = round3(debit + v.amount + v.supExt + (add?.debit ?? 0))
      credit = round3(credit + rec + (add?.credit ?? 0))
      dueNow = round3(dueNow + (dueNowMap.get(c.id) ?? 0))
    }
    const remaining = round3(current - collected)
    let status = ''
    if (dueNow > EPS) status = 'مستحق الآن'
    else if (remaining > EPS) status = 'عليه رصيد'
    else if (current > EPS) status = 'مسدّد بالكامل'
    rows.push({
      customerId: cu.id, code: cu.customerCode, name: cu.name, phone: cu.phone,
      contractsCount: mine.length,
      rawValue, currentValue: current,
      collected, dueNow, remaining, debit, credit, status,
    })
  }

  const body: CustomerBalanceDTO = {
    rows,
    totals: {
      customers: rows.length,
      contracts: rows.reduce((s, r) => s + r.contractsCount, 0),
      rawValue: round3(rows.reduce((s, r) => s + r.rawValue, 0)),
      currentValue: round3(rows.reduce((s, r) => s + r.currentValue, 0)),
      collected: round3(rows.reduce((s, r) => s + r.collected, 0)),
      dueNow: round3(rows.reduce((s, r) => s + r.dueNow, 0)),
      remaining: round3(rows.reduce((s, r) => s + r.remaining, 0)),
      debit: round3(rows.reduce((s, r) => s + r.debit, 0)),
      credit: round3(rows.reduce((s, r) => s + r.credit, 0)),
    },
  }
  return NextResponse.json(body)
}
