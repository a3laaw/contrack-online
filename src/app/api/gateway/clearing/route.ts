// GET /api/gateway/clearing?profileId= — التصفية اليومية (القفل الثلاثي S⇄G⇄bank_lines)
// S = Σ سندات قبض سارية method يطابق كلمات profile.methods (GROUP BY اليوم)
// G = gateway_ops distributed && gwPaid GROUP BY اليوم (mine/other — غير المصنفة خارج التصفية)
// expect = gTotal − Σ fees   ·  settle = اليوم + lagDays أيام عمل (الجمعة/السبت عطلة)
// ربط البنك greedy: أول سطر ضمن settle±1 يوم عمل مع |amount−expect| ≤ tolerance — كل سطر يُستعمل مرة
// status: |gap|>tol ⇒ diff | bank ⇒ done | settle>today ⇒ pending | ≤ settle+late ⇒ pending | late
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authGuard, jsonError } from '@/lib/api-utils'
import { round3 } from '@/lib/format'
import type { ClearingRowDTO, ClearingStatus } from '@/lib/gateway-types'

const WEEKEND = new Set([5, 6]) // الجمعة/السبت
const dayKey = (d: Date): string => d.toISOString().slice(0, 10)

function addBusinessDays(d: Date, n: number): Date {
  const result = new Date(d.getTime())
  let added = 0
  while (added < n) {
    result.setUTCDate(result.getUTCDate() + 1)
    if (WEEKEND.has(result.getUTCDay())) continue
    added++
  }
  return result
}

function addCalendarDays(d: Date, n: number): Date {
  const result = new Date(d.getTime())
  result.setUTCDate(result.getUTCDate() + n)
  return result
}

export async function GET(req: NextRequest) {
  const g = await authGuard(req)
  if (g.error) return g.error

  const profileId = Number(req.nextUrl.searchParams.get('profileId') ?? '')
  if (!Number.isInteger(profileId)) return jsonError('اختيار البوابة مطلوب للتصفية اليومية', 400)
  const profile = await db.gatewayProfile.findUnique({ where: { id: profileId } })
  if (!profile) return jsonError('البوابة غير موجودة', 404)

  const tolerance = profile.tolerance > 0 ? profile.tolerance : 0.0005

  // ---------- S: وارد السيستم (سندات قبض سارية بطريقة البوابة) ----------
  const keywords = profile.methods
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  const sysByDay = new Map<string, number>()
  if (keywords.length > 0) {
    const receipts = await db.voucher.findMany({
      where: {
        vtype: 'receipt',
        cancelled: false,
        OR: keywords.map((kw) => ({ method: { contains: kw } })),
      },
      select: { vdate: true, amount: true },
    })
    for (const v of receipts) {
      const day = dayKey(v.vdate)
      sysByDay.set(day, round3((sysByDay.get(day) ?? 0) + v.amount))
    }
  }

  // ---------- G: وارد البوابة (موزَّعة ومحصلة) ----------
  const ops = await db.gatewayOp.findMany({
    where: { profileId, distributed: true, gwPaid: true, state: { in: ['mine', 'other'] } },
    select: { opDate: true, state: true, amount: true, feeAmount: true },
  })
  type DayAgg = { mine: number; other: number; fees: number; n: number }
  const gByDay = new Map<string, DayAgg>()
  for (const op of ops) {
    const day = dayKey(op.opDate)
    const agg = gByDay.get(day) ?? { mine: 0, other: 0, fees: 0, n: 0 }
    if (op.state === 'mine') agg.mine = round3(agg.mine + op.amount)
    else agg.other = round3(agg.other + op.amount)
    agg.fees = round3(agg.fees + op.feeAmount)
    agg.n++
    gByDay.set(day, agg)
  }

  // ---------- أسطر البنك (ربط greedy — كل سطر يُستعمل مرة) ----------
  const bankLines = await db.bankLine.findMany({
    where: profile.bankAccount ? { bankAccount: profile.bankAccount } : {},
    orderBy: { cdate: 'asc' },
  })
  const usedBank = new Set<number>()

  const today = new Date()
  const todayKey = dayKey(today)

  const rows: ClearingRowDTO[] = []
  for (const [day, agg] of [...gByDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))) {
    const gTotal = round3(agg.mine + agg.other)
    const expect = round3(gTotal - agg.fees)
    const sys = sysByDay.get(day) ?? 0
    const gap = round3(agg.mine - sys)

    const opDate = new Date(`${day}T12:00:00.000Z`)
    const settle = addBusinessDays(opDate, profile.lagDays)
    const settleKey = dayKey(settle)

    // نافذة ±1 يوم عمل حول التسوية
    const winFrom = dayKey(addBusinessDays(settle, -1))
    const winTo = dayKey(addBusinessDays(settle, 1))

    let best: { id: number; amount: number; cdate: Date; descr: string } | null = null
    for (const line of bankLines) {
      if (usedBank.has(line.id)) continue
      const lk = dayKey(line.cdate)
      if (lk < winFrom || lk > winTo) continue
      if (Math.abs(line.amount - expect) > tolerance) continue
      if (!best || Math.abs(line.amount - expect) < Math.abs(best.amount - expect)) {
        best = { id: line.id, amount: line.amount, cdate: line.cdate, descr: line.descr }
      }
    }
    if (best) usedBank.add(best.id)

    let status: ClearingStatus
    if (Math.abs(gap) > tolerance) status = 'diff'
    else if (best) status = 'done'
    else if (settleKey > todayKey) status = 'pending'
    else if (todayKey <= dayKey(addCalendarDays(settle, profile.lateDays))) status = 'pending'
    else status = 'late'

    rows.push({
      day,
      sys,
      gMine: agg.mine,
      gOther: agg.other,
      gTotal,
      opsCount: agg.n,
      fees: agg.fees,
      gap,
      expect,
      settleDate: settleKey,
      bankAmount: best ? best.amount : null,
      bankDate: best ? dayKey(best.cdate) : null,
      bankDescr: best ? best.descr : null,
      myShare: round3(agg.mine - (agg.mine + agg.other > 0 ? (agg.fees * agg.mine) / gTotal : 0)),
      otherShare: round3(agg.other - (agg.mine + agg.other > 0 ? (agg.fees * agg.other) / gTotal : 0)),
      status,
    })
  }

  const totals = {
    sys: round3(rows.reduce((s, r) => s + r.sys, 0)),
    gMine: round3(rows.reduce((s, r) => s + r.gMine, 0)),
    gOther: round3(rows.reduce((s, r) => s + r.gOther, 0)),
    expect: round3(rows.reduce((s, r) => s + r.expect, 0)),
    bank: round3(rows.reduce((s, r) => s + (r.bankAmount ?? 0), 0)),
    myShare: round3(rows.reduce((s, r) => s + r.myShare, 0)),
    otherShare: round3(rows.reduce((s, r) => s + r.otherShare, 0)),
  }

  const unmatchedBank = bankLines
    .filter((l) => !usedBank.has(l.id))
    .sort((a, b) => (a.cdate < b.cdate ? 1 : -1))
    .slice(0, 100)
    .map((l) => ({
      id: l.id,
      cdate: dayKey(l.cdate),
      amount: l.amount,
      descr: l.descr,
      bankAccount: l.bankAccount,
    }))

  return NextResponse.json({
    profile: {
      id: profile.id,
      name: profile.name,
      bankAccount: profile.bankAccount,
      methods: profile.methods,
      lagDays: profile.lagDays,
      feeFixed: profile.feeFixed,
      feePercent: profile.feePercent,
      tolerance: profile.tolerance,
      lateDays: profile.lateDays,
      isActive: profile.isActive,
      opsCount: ops.length,
    },
    rows,
    totals,
    unmatchedBank,
  })
}
