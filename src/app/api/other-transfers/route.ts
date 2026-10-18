// GET  /api/other-transfers — مستحقات الشركة الأخرى + التحويلات + الرصيد + كشف تراكمي
//      مستحق = operation حالة other موزَّعة غير محصلة (البوابة لم تسدد بعد) وغير مسددة بالكامل
//      الرصيد = افتتاحي (0) + مستحق تراكمي (Σ الصافي للمؤهلة حتى المسددة) − Σ التحويلات
// POST /api/other-transfers — إنشاء تحويل {tdate, amount, ref?, notes?, method?, opIds?}:
//      توزيع المبلغ على الصافي (إجمالي − عمولة كل عملية) بTransferOpAlloc
//      اكتمال عملية (الوصول لصافيها ±0.0005) ⇒ op.paidTransferId
//      **لا سند صرف أبدًا (V4.5.13)** — التسديد بين الشركتين تسوية حسابية لا إيراد ولا مصروف
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { adminGuard, authGuard, jsonError, parseAmount, parseDay } from '@/lib/api-utils'
import { round3 } from '@/lib/format'
import type {
  OtherDueItemDTO,
  OtherStatementRowDTO,
  TransferDTO,
  TransferStatus,
} from '@/lib/gateway-types'

const EPS = 0.0005
const dayKey = (d: Date): string => d.toISOString().slice(0, 10)

/** تعريف المستحق الموحد — حالة other موزَّعة غير محصلة (غير مسددة تظهر كبنود) */
const duesWhere = {
  state: 'other',
  distributed: true,
  gwPaid: false,
} as const

export async function GET(req: NextRequest) {
  const g = await authGuard(req)
  if (g.error) return g.error

  // ---------- العمليات المؤهلة (مع تخصيصاتها) ----------
  const ops = await db.gatewayOp.findMany({
    where: duesWhere,
    include: {
      profile: { select: { name: true } },
      allocs: { select: { amount: true } },
    },
    orderBy: [{ opDate: 'asc' }, { id: 'asc' }],
  })

  const dues: OtherDueItemDTO[] = []
  let cumDues = 0 // مستحق تراكمي (يشمل المسددة بالكامل — يلغيها المربوط في التحويلات)
  const duesTotals = { gross: 0, fees: 0, net: 0, paid: 0, remaining: 0 }

  for (const op of ops) {
    const fee = op.feeAmount
    const net = round3(op.amount - fee)
    const paid = round3(op.allocs.reduce((s, a) => s + a.amount, 0))
    const remaining = round3(net - paid)
    cumDues = round3(cumDues + net)
    duesTotals.gross = round3(duesTotals.gross + op.amount)
    duesTotals.fees = round3(duesTotals.fees + fee)
    duesTotals.net = round3(duesTotals.net + net)
    duesTotals.paid = round3(duesTotals.paid + paid)
    if (remaining > EPS) {
      dues.push({
        opId: op.id,
        profileId: op.profileId,
        profileName: op.profile.name,
        opDate: dayKey(op.opDate),
        phone: op.phone,
        customerName: op.customerName,
        ref: op.ref,
        gross: op.amount,
        fee,
        net,
        paid,
        remaining,
        paidTransferId: op.paidTransferId,
      })
    }
  }
  duesTotals.remaining = round3(duesTotals.net - duesTotals.paid)

  // ---------- التحويلات ----------
  const transfers = await db.otherCompanyTransfer.findMany({
    include: {
      allocs: { include: { op: { select: { opDate: true } } } },
    },
    orderBy: [{ tdate: 'desc' }, { id: 'desc' }],
  })

  const transferDTOs: TransferDTO[] = transfers.map((t) => {
    const allocated = round3(t.allocs.reduce((s, a) => s + a.amount, 0))
    const remaining = round3(t.amount - allocated)
    const opDates = [...new Set(t.allocs.map((a) => dayKey(a.op.opDate)))].sort()
    let status: TransferStatus = 'open'
    if (t.allocs.length > 0) status = remaining <= EPS ? 'full' : 'partial'
    return {
      id: t.id,
      tdate: dayKey(t.tdate),
      amount: t.amount,
      ref: t.ref,
      notes: t.notes,
      method: t.method,
      voucherId: t.voucherId,
      voucherNumber: t.voucherNumber,
      linkedOps: t.allocs.length,
      allocated,
      remaining,
      opDates,
      status,
      createdBy: t.createdBy,
      createdAt: t.createdAt.toISOString(),
    }
  })

  // ---------- الرصيد ----------
  const paidTotal = round3(transfers.reduce((s, t) => s + t.amount, 0))
  const opening = 0 // لا رصيد افتتاحي في المخطط الحالي
  const balance = {
    opening,
    dues: round3(opening + cumDues),
    paid: paidTotal,
    remaining: round3(opening + cumDues - paidTotal),
    feeDiff: round3(Math.max(0, paidTotal - (opening + cumDues))),
  }

  // ---------- كشف تراكمي (مستحق اليومي + التحويلات) ----------
  type Ev = { day: string; due: number; paid: number }
  const events: Ev[] = []
  for (const op of ops) {
    events.push({ day: dayKey(op.opDate), due: round3(op.amount - op.feeAmount), paid: 0 })
  }
  for (const t of transfers) {
    events.push({ day: dayKey(t.tdate), due: 0, paid: t.amount })
  }
  events.sort((a, b) => (a.day === b.day ? a.paid - b.paid : a.day < b.day ? -1 : 1))
  let running = opening
  const byDay = new Map<string, OtherStatementRowDTO>()
  for (const ev of events) {
    const row = byDay.get(ev.day) ?? { day: ev.day, due: 0, paid: 0, cumulative: 0 }
    row.due = round3(row.due + ev.due)
    row.paid = round3(row.paid + ev.paid)
    byDay.set(ev.day, row)
  }
  const statement: OtherStatementRowDTO[] = [...byDay.values()]
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .map((row) => {
      running = round3(running + row.due - row.paid)
      return { ...row, cumulative: running }
    })
    .reverse()

  return NextResponse.json({ balance, dues, duesTotals, transfers: transferDTOs, statement })
}

export async function POST(req: NextRequest) {
  const g = await adminGuard(req)
  if (g.error) return g.error

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonError('طلب غير صالح', 400)
  }

  const tdate = parseDay(body.tdate)
  if (!tdate) return jsonError('تاريخ التحويل غير صالح', 400)
  const amount = parseAmount(body.amount)
  if (amount == null || amount <= 0) return jsonError('مبلغ التحويل يجب أن يكون رقمًا أكبر من صفر', 400)

  const ref = typeof body.ref === 'string' ? body.ref.trim() : ''
  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
  const method = typeof body.method === 'string' ? body.method.trim() : 'تحويل بنكي'
  const opIds = Array.isArray(body.opIds) ? body.opIds.map((v) => Number(v)).filter((n) => Number.isInteger(n)) : []

  // ---------- التحقق لكل عملية: موجودة/أخرى/موزَّعة/غير مسددة بالكامل ----------
  const picked = opIds.length > 0
    ? await db.gatewayOp.findMany({
        where: { id: { in: opIds } },
        include: { allocs: { select: { amount: true, transferId: true } } },
        orderBy: [{ opDate: 'asc' }, { id: 'asc' }],
      })
    : []
  if (opIds.length > 0 && picked.length !== opIds.length) {
    return jsonError('إحدى العمليات المحددة غير موجودة', 404)
  }
  const byId = new Map(picked.map((op) => [op.id, op]))
  for (const id of opIds) {
    const op = byId.get(id)!
    if (op.state !== 'other') return jsonError(`العملية #${id}: يمكن تسديد عمليات الشركة الأخرى فقط (other)`, 400)
    if (!op.distributed) return jsonError(`العملية #${id}: غير موزَّعة — وزّعها أولًا من تاب البوابة`, 400)
    const net = round3(op.amount - op.feeAmount)
    const paid = round3(op.allocs.reduce((s, a) => s + a.amount, 0))
    if (paid >= net - EPS) {
      return jsonError(`العملية #${id}: مسددة بالكامل مسبقًا`, 400)
    }
  }

  // ---------- إنشاء التحويل وتوزيعه على الصافي (بمعاملة) ----------
  const created = await db.$transaction(async (tx) => {
    const transfer = await tx.otherCompanyTransfer.create({
      data: { tdate, amount, ref, notes, method, createdBy: g.user.username },
    })

    let remainingTransfer = amount
    let allocatedTotal = 0
    const completedOps: number[] = []

    for (const op of picked) {
      const net = round3(op.amount - op.feeAmount)
      const paid = round3(op.allocs.reduce((s, a) => s + a.amount, 0))
      const opRemaining = round3(net - paid)
      if (opRemaining <= EPS || remainingTransfer <= EPS) continue

      const alloc = round3(Math.min(remainingTransfer, opRemaining))
      await tx.transferOpAlloc.create({
        data: { transferId: transfer.id, opId: op.id, amount: alloc },
      })
      remainingTransfer = round3(remainingTransfer - alloc)
      allocatedTotal = round3(allocatedTotal + alloc)

      const newPaid = round3(paid + alloc)
      if (Math.abs(newPaid - net) <= EPS) {
        await tx.gatewayOp.update({
          where: { id: op.id },
          data: { paidTransferId: transfer.id },
        })
        completedOps.push(op.id)
      }
    }

    return { id: transfer.id, allocated: allocatedTotal, remaining: round3(amount - allocatedTotal), completedOps }
  })

  return NextResponse.json(created, { status: 201 })
}
