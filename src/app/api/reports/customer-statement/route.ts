// GET /api/reports/customer-statement?customerId=&from=&to=&contractId=
// كشف حساب عميل v2 — نقل حرفي لقواعد statement_service:
//  مدين: قيمة العقد (صف افتتاحي دائمًا أول الجدول) + صافي الملحقات المعتمدة
//        (إضافة مدين/حسمي دائن بمرجع ADD-xxx) + تمديد الإشراف قيدًا مدينًا عند base_end
//  دائن: سندات القبض السارية كاملة المبلغ
//  محايد: الفواتير «للعلم» بمدين=دائن=0 (V3.14 — لا تخفض المديونية)
//  الترتيب: (التاريخ نصيًا ISO، المرجع نصًا) · الرصيد += مدين − دائن
//  الشامل: استبعاد ملغى/ملغي/مسودة (V3.6) + افتتاحي الفترة لكل عقد +
//          إجمالي لكل عقد (subtotal) + الإجمالي العام (total)
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authGuard, jsonError, parseDay } from '@/lib/api-utils'
import { round3 } from '@/lib/format'
import {
  EPS, addMonths, isSupervisionContract, supervisionStatus, todayNoon,
} from '../_server'
import type { CustomerStatementDTO, CustomerStatementRow } from '@/lib/report-types'

/** yyyy-MM-dd من Date أو من النص المخزن */
const isoDay = (d: Date | string): string => (typeof d === 'string' ? d : d.toISOString().slice(0, 10))

/** قيود حركة داخل عقد واحد قبل الترتيب */
interface Movement {
  date: string
  ref: string
  description: string
  debit: number
  credit: number
}

/** بناء كشف عقد واحد (build_statement) */
async function buildStatement(contractId: number): Promise<{
  rows: CustomerStatementRow[]
  currentValue: number
  netAddendums: number
  supExtension: number
  receiptsTotal: number
  totalDebit: number
  totalCredit: number
} | null> {
  const contract = await db.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true, contractNumber: true, amount: true, contractDate: true,
      supStartDate: true, supMonths: true, supMonthly: true, supDiscount: true,
      supWaivedMonths: true, supWaiveReason: true,
    },
  })
  if (!contract) return null

  const [invoices, receipts, addendums] = await Promise.all([
    db.invoice.findMany({
      where: { contractId },
      orderBy: [{ invoiceDate: 'asc' }, { id: 'asc' }],
      select: { invoiceNumber: true, invoiceDate: true, description: true, amount: true },
    }),
    db.voucher.findMany({
      where: { contractId, vtype: 'receipt', cancelled: false },
      orderBy: [{ vdate: 'asc' }, { id: 'asc' }],
      select: { voucherNumber: true, vdate: true, description: true, amount: true },
    }),
    db.addendum.findMany({
      where: { contractId, status: 'معتمد' },
      orderBy: [{ adate: 'asc' }, { id: 'asc' }],
      select: { addendumNumber: true, addendumType: true, adate: true, reason: true, amountAdd: true, amountDeduct: true },
    }),
  ])

  const movements: Movement[] = []
  let netAddendums = 0
  for (const a of addendums) {
    const net = round3(Number(a.amountAdd) - Number(a.amountDeduct))
    if (Math.abs(net) < EPS) continue
    const atype = a.addendumType || 'أمر تغييري'
    const desc = `${atype}: ${a.reason || ''}`.trim().replace(/:$/, '')
    if (net > 0) movements.push({ date: isoDay(a.adate), ref: a.addendumNumber, description: desc, debit: net, credit: 0 })
    else movements.push({ date: isoDay(a.adate), ref: a.addendumNumber, description: desc, debit: 0, credit: round3(-net) })
    netAddendums = round3(netAddendums + net)
  }
  for (const inv of invoices) {
    // V3.14: الفاتورة للعلم فقط — لا تخفض المديونية
    movements.push({
      date: isoDay(inv.invoiceDate),
      ref: inv.invoiceNumber,
      description: `فاتورة (للعلم): ${inv.description || 'فاتورة'} · ${Number(inv.amount).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`,
      debit: 0, credit: 0,
    })
  }
  const receiptsTotal = round3(receipts.reduce((s, r) => s + Number(r.amount), 0))
  for (const r of receipts) {
    movements.push({
      date: isoDay(r.vdate), ref: r.voucherNumber,
      description: r.description || 'سند قبض',
      debit: 0, credit: round3(Number(r.amount)),
    })
  }
  // مديونية تمديد الإشراف — قيد مدين واحد عند نهاية المدة الأساسية
  let supExtension = 0
  if (isSupervisionContract(contract)) {
    const st = supervisionStatus(contract, receiptsTotal, todayNoon())
    if (st && st.extensionValue > EPS) {
      supExtension = st.extensionValue
      const m = st.billableExtension
      const mTxt = m === 1 ? 'شهر واحد' : m === 2 ? 'شهران' : `${m} شهر`
      movements.push({
        date: st.baseEnd,
        ref: 'تمديد',
        description: `تمديد إشراف · ${mTxt} (${st.monthly.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} للشهر)`
          + (st.waivedMonths ? ` · بعد إلغاء ${st.waivedMonths} شهر` : ''),
        debit: supExtension, credit: 0,
      })
    }
  }
  void addMonths

  movements.sort((a, b) => (a.date.localeCompare(b.date)) || a.ref.localeCompare(b.ref))
  let balance = round3(Number(contract.amount))
  const rows: CustomerStatementRow[] = [{
    date: isoDay(contract.contractDate),
    contractNumber: contract.contractNumber,
    kind: 'move', ref: contract.contractNumber,
    description: 'قيمة العقد',
    debit: round3(Number(contract.amount)), credit: 0, balance,
  }]
  for (const m of movements) {
    balance = round3(balance + m.debit - m.credit)
    rows.push({
      date: m.date, contractNumber: contract.contractNumber, kind: 'move',
      ref: m.ref, description: m.description,
      debit: m.debit, credit: m.credit, balance,
    })
  }
  const totalDeducts = round3(rows.filter((r) => r.ref.startsWith('ADD-')).reduce((s, r) => s + r.credit, 0))
  const totalDebit = round3(Number(contract.amount) + supExtension + rows.filter((r) => r.ref.startsWith('ADD-')).reduce((s, r) => s + r.debit, 0))
  const totalCredit = round3(receiptsTotal + totalDeducts)
  const currentValue = round3(Number(contract.amount) + netAddendums + supExtension)
  return { rows, currentValue, netAddendums, supExtension, receiptsTotal, totalDebit, totalCredit }
}

export async function GET(req: NextRequest) {
  const g = await authGuard(req)
  if ('response' in g) return g.response

  const sp = req.nextUrl.searchParams
  const customerId = Number(sp.get('customerId') ?? '')
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return jsonError('اختيار العميل مطلوب لعرض كشف الحساب', 400)
  }
  const customer = await db.customer.findUnique({ where: { id: customerId } })
  if (!customer) return jsonError('العميل غير موجود', 404)

  const contractIdParam = Number(sp.get('contractId') ?? '') || null
  const from = sp.get('from')?.trim() ?? ''
  const to = sp.get('to')?.trim() ?? ''
  const validFrom = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : ''
  const validTo = /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : ''

  // اختيار العقود: عقد مفلتر (من العميل نفسه) أو كل العقود غير الملغاة/المسودة (V3.6)
  let contractIds: number[]
  if (contractIdParam) {
    const c = await db.contract.findFirst({ where: { id: contractIdParam, customerId } })
    if (!c) return jsonError('العقد غير موجود لهذا العميل', 400)
    contractIds = [c.id]
  } else {
    const list = await db.contract.findMany({
      where: { customerId, status: { notIn: ['ملغى', 'ملغي', 'مسودة'] } },
      orderBy: [{ contractDate: 'asc' }, { id: 'asc' }],
      select: { id: true, contractNumber: true },
    })
    contractIds = list.map((c) => c.id)
  }
  const contractsMeta = await db.contract.findMany({
    where: { id: { in: contractIds } },
    select: { id: true, contractNumber: true, contractDate: true },
    orderBy: [{ contractDate: 'asc' }, { id: 'asc' }],
  })

  const per: {
    number: string
    opening: number
    shown: CustomerStatementRow[]
    debit: number
    credit: number
  }[] = []
  for (const meta of contractsMeta) {
    const st = await buildStatement(meta.id)
    if (!st) continue
    let before = st.rows
    let shown = st.rows
    let opening = 0
    if (validFrom) {
      before = st.rows.filter((r) => r.date < validFrom)
      shown = st.rows.filter((r) => r.date >= validFrom && (!validTo || r.date <= validTo))
      opening = before.length > 0 ? before[before.length - 1].balance : 0
    } else {
      shown = st.rows.filter((r) => !validTo || r.date <= validTo)
      opening = 0
    }
    per.push({
      number: meta.contractNumber,
      opening,
      shown,
      debit: round3(shown.reduce((s, r) => s + r.debit, 0)),
      credit: round3(shown.reduce((s, r) => s + r.credit, 0)),
    })
  }

  const totalOpening = round3(per.reduce((s, p) => s + p.opening, 0))
  const merged = per.flatMap((p) => p.shown)
  merged.sort((a, b) =>
    a.date.localeCompare(b.date)
    || a.contractNumber.localeCompare(b.contractNumber)
    || a.ref.localeCompare(b.ref))

  const rows: CustomerStatementRow[] = []
  let balance = totalOpening
  if (validFrom || Math.abs(totalOpening) > 0.0005) {
    rows.push({
      date: validFrom || (merged[0]?.date ?? ''),
      contractNumber: '', kind: 'opening', ref: '',
      description: 'رصيد أول الفترة',
      debit: totalOpening > 0 ? totalOpening : 0,
      credit: totalOpening < 0 ? round3(-totalOpening) : 0,
      balance: totalOpening,
    })
  }
  for (const r of merged) {
    balance = round3(balance + r.debit - r.credit)
    rows.push({ ...r, balance })
  }
  for (const p of per) {
    const closing = round3(p.opening + p.debit - p.credit)
    rows.push({
      date: '', contractNumber: p.number, kind: 'subtotal', ref: '',
      description: `إجمالي عقد ${p.number}`,
      debit: p.debit, credit: p.credit, balance: closing,
    })
  }
  const totalDebit = round3(per.reduce((s, p) => s + p.debit, 0))
  const totalCredit = round3(per.reduce((s, p) => s + p.credit, 0))
  const remaining = balance
  rows.push({
    date: '', contractNumber: '', kind: 'total', ref: '',
    description: 'الإجمالي العام',
    debit: totalDebit, credit: totalCredit, balance: remaining,
  })

  const body: CustomerStatementDTO = {
    customer: { id: customer.id, name: customer.name, phone: customer.phone, code: customer.customerCode },
    contracts: contractsMeta.map((c) => c.contractNumber),
    rows,
    totals: {
      opening: totalOpening,
      debit: totalDebit,
      credit: totalCredit,
      balance: remaining,
    },
  }
  return NextResponse.json(body)
}
