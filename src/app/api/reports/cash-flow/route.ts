// GET /api/reports/cash-flow?mode=detail|periods&group=auto|daily|monthly|yearly&from=&to=
// التدفق النقدي (cash_flow_detail + cash_flow_report) — نسخة مفهومة مسطّحة:
//  · الأرضية = settings.openingBalanceDate (كل ما قبلها خارج الكشف كليًا)
//  · تصنيف المحفظة بطريقة الدفع (تحويل/شيك/KNET/بنك → بنك؛ نقد/صندوق → صندوق)
//  · الأقسام: الوارد / المنصرف / المسترد / سلف مستردة / تحويلات / حركات الشريك
//  · الرصيد الدفتري = openingBalanceBank + openingBalanceCash + الحركات
//  · الفترات: ≤62 يومًا يومي · ≤730 شهري · غير ذلك سنوي
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authGuard, parseDay } from '@/lib/api-utils'
import { round3 } from '@/lib/format'
import {
  BANK_FEE_MARK, GATEWAY_FEE_MARK, calendarDays, dayStr, isSettlementVoucher, todayNoon, walletOf,
} from '../_server'
import type { CashFlowDTO, CashFlowMovementRow, CashFlowPeriodRow } from '@/lib/report-types'

function periodKeyOf(d: Date, group: 'daily' | 'monthly' | 'yearly'): { key: string; label: string } {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  if (group === 'daily') {
    const s = dayStr(d) as string
    return { key: s, label: s }
  }
  if (group === 'monthly') {
    const key = `${y}-${String(m).padStart(2, '0')}`
    const names = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
    return { key, label: `${names[m - 1]} ${y}` }
  }
  return { key: String(y), label: String(y) }
}

export async function GET(req: NextRequest) {
  const g = await authGuard(req)
  if (g.error) return g.error

  const sp = req.nextUrl.searchParams
  const mode = (sp.get('mode') ?? 'detail').trim() === 'periods' ? 'periods' : 'detail'
  const groupParam = sp.get('group')?.trim() ?? 'auto'
  const fromD = parseDay(sp.get('from'))
  const toD = parseDay(sp.get('to'))
  const today = todayNoon()

  const settings = await db.settings.findUnique({ where: { id: 1 } })
  const openingBank = round3(settings?.openingBalanceBank ?? 0)
  const openingCash = round3(settings?.openingBalanceCash ?? 0)
  // الأرضية: openingBalanceDate — كل ما قبلها خارج الكشف كليًا (V5.9/V8.4)
  const floor = settings?.openingBalanceDate ?? null

  const vWhere: Record<string, unknown> = { cancelled: false }
  if (floor) vWhere.vdate = { gte: floor }
  if (fromD || toD) {
    const range: Record<string, Date> = {}
    if (fromD) range.gte = fromD
    if (toD) range.lte = toD
    vWhere.vdate = { ...(vWhere.vdate as Record<string, Date> ?? {}), ...range }
  }

  const vouchers = await db.voucher.findMany({
    where: vWhere,
    orderBy: [{ vdate: 'asc' }, { id: 'asc' }],
    select: {
      id: true, voucherNumber: true, vtype: true, vdate: true, amount: true,
      method: true, account: true, party: true, partyType: true, description: true,
      notes: true, custodyAccountId: true, advanceEmployeeId: true,
      contract: { select: { contractNumber: true } },
    },
  })

  const receipts: CashFlowMovementRow[] = []
  const payments: CashFlowMovementRow[] = []
  const recoveries: CashFlowMovementRow[] = []
  const advances: CashFlowMovementRow[] = []
  const transfers: CashFlowMovementRow[] = []
  const partner: CashFlowMovementRow[] = []

  let walletBank = 0
  let walletCash = 0
  const feeMonths = new Map<string, { total: number; count: number }>()
  const custodyMonths = new Map<string, { total: number; count: number }>()

  const pushRow = (
    arr: CashFlowMovementRow[],
    v: (typeof vouchers)[number],
    extra?: Partial<CashFlowMovementRow>,
  ) => {
    arr.push({
      id: v.id, voucherNumber: v.voucherNumber, date: dayStr(v.vdate) ?? '',
      party: v.party || '—',
      contractNumber: v.contract?.contractNumber ?? null,
      amount: round3(v.amount), method: v.method, wallet: walletOf(v.method),
      description: v.description, ...extra,
    })
  }

  for (const v of vouchers) {
    const isPartner = (v.partyType || '') === 'partner'
    const isAdvance = v.advanceEmployeeId != null
    if (v.vtype === 'receipt') {
      if (isPartner) {
        pushRow(partner, v, { kind: 'قبض شريك' })
        const w = walletOf(v.method)
        if (w === 'bank') walletBank += v.amount
        else walletCash += v.amount
      } else if (isAdvance) {
        // رد سلفة نقدًا — يرفع المحفظة ولا يُحسب إيرادًا (V8.5)
        pushRow(advances, v, { kind: 'رد سلفة (نقدًا)' })
        const w = walletOf(v.method)
        if (w === 'bank') walletBank += v.amount
        else walletCash += v.amount
      } else {
        pushRow(receipts, v)
        const w = walletOf(v.method)
        if (w === 'bank') walletBank += v.amount
        else walletCash += v.amount
      }
    } else if (v.vtype === 'custody_return') {
      if (isAdvance) {
        pushRow(advances, v, { kind: 'رد سلفة' })
        const w = walletOf(v.method)
        if (w === 'bank') walletBank += v.amount
        else walletCash += v.amount
      } else {
        pushRow(recoveries, v, { kind: 'مرتجع نقدي' })
        const w = walletOf(v.method)
        if (w === 'bank') walletBank += v.amount
        else walletCash += v.amount
      }
    } else if (v.vtype === 'salary_deduction') {
      if (isAdvance) {
        // سلفة مسترجعة بخصم الراتب — بلا حركة نقدية (غير محسوبة مصروفًا)
        pushRow(advances, v, { kind: 'سلفة مسترجعة بخصم الراتب — غير محسوبة مصروفًا', wallet: null, method: v.method })
      }
      // غير ذلك: قيد استحقاق بلا نقدية — خارج الكشف
    } else if (v.vtype === 'transfer') {
      const from = walletOf(v.method)
      const to = walletOf(v.account)
      pushRow(transfers, v, { kind: 'تحويل داخلي', wallet: null })
      if (from === 'bank' && to === 'cash') { walletBank -= v.amount; walletCash += v.amount }
      else if (from === 'cash' && to === 'bank') { walletCash -= v.amount; walletBank += v.amount }
      // داخل نفس المحفظة: بلا أثر صافي
    } else if (v.vtype === 'payment') {
      if (isSettlementVoucher({ notes: v.notes, description: v.description })) continue
      if (v.custodyAccountId != null) {
        // صرف عهد: سطر مجمّع شهريًا (V9.15)
        const mk = (dayStr(v.vdate) ?? '').slice(0, 7)
        const cur = custodyMonths.get(mk) ?? { total: 0, count: 0 }
        cur.total = round3(cur.total + v.amount)
        cur.count += 1
        custodyMonths.set(mk, cur)
        const w = walletOf(v.method)
        if (w === 'bank') walletBank -= v.amount
        else walletCash -= v.amount
        continue
      }
      const t = `${v.notes || ''} ${v.description || ''}`
      if (t.includes(BANK_FEE_MARK) || t.includes(GATEWAY_FEE_MARK)) {
        const mk = (dayStr(v.vdate) ?? '').slice(0, 7)
        const cur = feeMonths.get(mk) ?? { total: 0, count: 0 }
        cur.total = round3(cur.total + v.amount)
        cur.count += 1
        feeMonths.set(mk, cur)
        const w = walletOf(v.method)
        if (w === 'bank') walletBank -= v.amount
        else walletCash -= v.amount
        continue
      }
      pushRow(payments, v, isAdvance ? { kind: 'سلفة موظف' } : undefined)
      const w = walletOf(v.method)
      if (w === 'bank') walletBank -= v.amount
      else walletCash -= v.amount
    }
  }

  // أسطر مجمّعة: العمولات البنكية وصرف العهد
  const monthLabel = (mk: string) => periodKeyOf(new Date(mk + '-01T12:00:00.000Z'), 'monthly').label
  for (const mk of [...feeMonths.keys()].sort()) {
    const fm = feeMonths.get(mk)
    if (!fm) continue
    payments.push({
      id: -1, voucherNumber: '—', date: mk + '-01', party: 'عمولات بنكية',
      contractNumber: null, amount: fm.total, method: '', wallet: null,
      description: `إجمالي ${fm.count} عملية خلال ${monthLabel(mk)}`,
      kind: 'مجمع',
    })
  }
  for (const mk of [...custodyMonths.keys()].sort()) {
    const cm = custodyMonths.get(mk)
    if (!cm) continue
    payments.push({
      id: -2, voucherNumber: '—', date: mk + '-01', party: 'صرف عهد',
      contractNumber: null, amount: cm.total, method: '', wallet: null,
      description: `إجمالي ${cm.count} تسليم عهدة خلال ${monthLabel(mk)}`,
      kind: 'مجمع',
    })
  }

  const bank = round3(openingBank + walletBank)
  const cash = round3(openingCash + walletCash)
  const closing = round3(bank + cash)
  const opening = round3(openingBank + openingCash)

  const inSum = round3(receipts.reduce((s, r) => s + r.amount, 0))
  const outSum = round3(payments.reduce((s, r) => s + r.amount, 0))
  const recSum = round3(recoveries.reduce((s, r) => s + r.amount, 0))
  const advCash = round3(advances.filter((r) => r.kind !== 'سلفة مسترجعة بخصم الراتب — غير محسوبة مصروفًا').reduce((s, r) => s + r.amount, 0))
  const partnerNet = round3(partner.reduce((s, r) => s + (r.kind === 'قبض شريك' ? r.amount : -r.amount), 0))

  if (mode === 'detail') {
    const body: CashFlowDTO = {
      mode,
      floorDate: dayStr(floor),
      receipts, payments, recoveries, advances, transfers, partner,
      totals: {
        in: inSum, out: outSum, recoveries: recSum,
        advancesReturned: advCash, partnerNet,
        net: round3(closing - opening),
        openingBank, openingCash, opening, bank, cash, closing,
      },
      rows: [], periods: [],
    }
    return NextResponse.json(body)
  }

  // ===== الملخص بالفترات =====
  let group: 'daily' | 'monthly' | 'yearly'
  if (groupParam === 'daily' || groupParam === 'monthly' || groupParam === 'yearly') {
    group = groupParam
  } else {
    const first = vouchers[0]?.vdate ?? floor ?? today
    const last = vouchers.length > 0 ? vouchers[vouchers.length - 1].vdate : today
    const endRef = toD ?? last
    const startRef = fromD ?? first
    const days = Math.abs(calendarDays(endRef, startRef))
    group = days <= 62 ? 'daily' : days <= 730 ? 'monthly' : 'yearly'
  }

  type Bucket = { key: string; label: string; in: number; out: number; rec: number; adv: number; partner: number }
  const buckets = new Map<string, Bucket>()
  const order: string[] = []
  const bucketOf = (d: Date): Bucket => {
    const { key, label } = periodKeyOf(d, group)
    let b = buckets.get(key)
    if (!b) {
      b = { key, label, in: 0, out: 0, rec: 0, adv: 0, partner: 0 }
      buckets.set(key, b)
      order.push(key)
    }
    return b
  }

  const addAll = (arr: CashFlowMovementRow[], sign: number, field: 'in' | 'out' | 'rec' | 'adv' | 'partner') => {
    for (const r of arr) {
      const b = bucketOf(new Date(r.date + 'T12:00:00.000Z'))
      b[field] = round3(b[field] + sign * r.amount)
    }
  }
  addAll(receipts, 1, 'in')
  addAll(payments, 1, 'out')
  addAll(recoveries, 1, 'rec')
  addAll(advances.filter((r) => r.kind !== 'سلفة مسترجعة بخصم الراتب — غير محسوبة مصروفًا'), 1, 'adv')
  addAll(partner.filter((r) => r.kind === 'قبض شريك'), 1, 'partner')
  addAll(partner.filter((r) => r.kind !== 'قبض شريك'), -1, 'partner')

  let balance = opening
  const periods: CashFlowPeriodRow[] = order.sort().map((key) => {
    const b = buckets.get(key) as Bucket
    const net = round3(b.in - b.out + b.rec + b.adv + b.partner)
    balance = round3(balance + net)
    return { key: b.key, label: b.label, in: b.in, out: b.out, recoveries: b.rec, advances: b.adv, partnerNet: b.partner, net, balance }
  })

  const body: CashFlowDTO = {
    mode,
    floorDate: dayStr(floor),
    group,
    receipts: [], payments: [], recoveries: [], advances: [], transfers: [], partner: [],
    periods,
    totals: {
      in: round3(periods.reduce((s, r) => s + r.in, 0)),
      out: round3(periods.reduce((s, r) => s + r.out, 0)),
      recoveries: round3(periods.reduce((s, r) => s + r.recoveries, 0)),
      advancesReturned: round3(periods.reduce((s, r) => s + r.advances, 0)),
      partnerNet: round3(periods.reduce((s, r) => s + r.partnerNet, 0)),
      net: round3(periods.reduce((s, r) => s + r.net, 0)),
      openingBank, openingCash, opening, bank, cash, closing,
    },
    rows: [],
  }
  return NextResponse.json(body)
}
