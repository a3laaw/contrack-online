// GET /api/reports/dues-board?option=all|due_only|overdue_only — لوحة مستحقات الباطن (dues_board V4.3)
// سطور الصرف فقط: خطط الباطن بتغطية FIFO (بركة الصرف غير المخصص ثم الروابط)
// وعقد بلا خطة = سطر مشتق «مستحق عقد الباطن (مشتق)» بـ max(0, amount − paid)
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authGuard } from '@/lib/api-utils'
import { round3 } from '@/lib/format'
import {
  EPS, calendarDays, dayStr, fifoCover, paymentLinksByLine, todayNoon,
} from '../_server'
import type { DuesBoardDTO, DuesBoardRow } from '@/lib/report-types'

const WAIT_EXCLUDED = ['لم يحل', 'بانتظار إنجاز المرحلة', 'مرحلة متخطاة', 'مدفوع']

export async function GET(req: NextRequest) {
  const g = await authGuard(req)
  if ('response' in g) return g.response

  const sp = req.nextUrl.searchParams
  const option = (sp.get('option') ?? 'all').trim() || 'all'
  const today = todayNoon()

  const [contracts, subs] = await Promise.all([
    db.contract.findMany({
      where: { status: { notIn: ['مغلق', 'ملغى', 'ملغي'] } },
      orderBy: [{ id: 'asc' }],
      select: { id: true, contractNumber: true },
    }),
    db.subContract.findMany({
      where: { status: { notIn: ['ملغى', 'ملغي'] } },
      orderBy: [{ id: 'asc' }],
      select: {
        id: true, contractId: true, amount: true, endDate: true,
        subcontractor: { select: { name: true } },
      },
    }),
  ])
  const cmap = new Map(contracts.map((c) => [c.id, c]))
  const subIds = subs.map((s) => s.id)

  const [subPlans, poolRows, linksByLine, sources, sameCounts] = await Promise.all([
    db.subPaymentPlanItem.findMany({
      where: { subContractId: { in: subIds } },
      orderBy: [{ sortOrder: 'asc' }, { dueDate: 'asc' }],
      select: {
        id: true, subContractId: true, title: true, dueDate: true, amount: true,
        stageId: true, triggeredAt: true, notes: true,
        stage: { select: { name: true, isSkipped: true } },
        sources: { select: { custLine: { select: { title: true } } } },
      },
    }),
    // بركة الصرف غير المخصص لكل عقد باطن
    db.voucher.groupBy({
      by: ['subContractId'],
      where: {
        vtype: 'payment', cancelled: false, allocation: '',
        subContractId: { in: subIds },
      },
      _sum: { amount: true },
    }),
    paymentLinksByLine(subIds),
    // مصادر التحصيل: sub_payment_sources ⋈ payment_plan.title
    db.subPaymentSource.findMany({
      where: { subLine: { subContractId: { in: subIds } } },
      select: { subLineId: true, custLine: { select: { title: true } } },
    }),
    db.subContract.groupBy({
      by: ['subcontractorId', 'contractId'],
      where: { status: { notIn: ['ملغى', 'ملغي'] } },
      _count: { id: true },
    }),
  ])

  const poolBySub = new Map<number, number>()
  for (const r of poolRows) {
    if (r.subContractId != null) poolBySub.set(r.subContractId, round3(Number(r._sum.amount ?? 0)))
  }
  const sourcesByLine = new Map<number, string[]>()
  for (const s of sources) {
    const list = sourcesByLine.get(s.subLineId) ?? []
    list.push(s.custLine.title || 'دفعة')
    sourcesByLine.set(s.subLineId, list)
  }
  // سندات صرف قديمة بلا ربط بعقد الباطن — تُحتسب إن كان لهذا المقاول
  // عقد باطن واحد على نفس عقد العميل (كالأصل V5.4)
  const legacyBySub = new Map<number, number>()
  const subsWithSc = await db.subContract.findMany({
    where: { id: { in: subIds } },
    select: { id: true, subcontractorId: true, contractId: true },
  })
  for (const sc of subsWithSc) {
    const nSame = sameCounts.find(
      (r) => r.subcontractorId === sc.subcontractorId && r.contractId === sc.contractId,
    )?._count.id ?? 0
    if (nSame !== 1) continue
    const agg = await db.voucher.aggregate({
      where: {
        vtype: 'payment', cancelled: false, allocation: '',
        partyType: 'subcontractor', partyId: sc.subcontractorId,
        contractId: sc.contractId,
        OR: [{ subContractId: null }, { subContractId: 0 }],
      },
      _sum: { amount: true },
    })
    const legacy = round3(Number(agg._sum.amount ?? 0))
    if (legacy > 0) legacyBySub.set(sc.id, legacy)
  }

  const plansBySub = new Map<number, typeof subPlans>()
  for (const p of subPlans) {
    const list = plansBySub.get(p.subContractId) ?? []
    list.push(p)
    plansBySub.set(p.subContractId, list)
  }

  const rows: DuesBoardRow[] = []
  for (const s of subs) {
    const c = cmap.get(s.contractId)
    if (!c) continue
    const items = plansBySub.get(s.id) ?? []
    if (items.length === 0) {
      const paid = round3((poolBySub.get(s.id) ?? 0) + (legacyBySub.get(s.id) ?? 0))
      const amt = round3(Number(s.amount))
      const rem = Math.max(0, round3(amt - paid))
      const due = dayStr(s.endDate) ?? ''
      const dueD = due ? new Date(due + 'T12:00:00.000Z') : today
      let st: string
      if (rem <= EPS) st = 'مدفوع'
      else if (dueD < today) st = 'متأخر'
      else if (calendarDays(dueD, today) <= 7) st = 'مستحق قريبًا'
      else st = 'لم يحل'
      rows.push({
        subContractId: s.id, contractId: c.id, contract: c.contractNumber,
        party: s.subcontractor.name, stage: '—',
        title: 'مستحق عقد الباطن (مشتق)',
        due: due || '—',
        amount: amt, paid, remaining: rem,
        status: st, source: 'مشتق', sources: '',
        dueNow: rem > EPS && !WAIT_EXCLUDED.includes(st),
      })
      continue
    }
    const pool = round3((poolBySub.get(s.id) ?? 0) + (legacyBySub.get(s.id) ?? 0))
    const covers = fifoCover(
      items.map((p) => ({
        id: p.id, contractId: s.id, title: p.title, dueDate: p.dueDate,
        amount: Number(p.amount), sortOrder: 0, stageId: p.stageId,
        triggeredAt: p.triggeredAt, stageSkipped: p.stage?.isSkipped ?? false,
        stageName: p.stage?.name ?? null, stageEnd: null,
      })),
      pool,
      linksByLine,
    )
    items.forEach((p, i) => {
      const { covered, remaining } = covers[i]
      const stageLinked = Boolean(p.stageId)
      const triggered = Boolean(p.triggeredAt)
      const todayIso = dayStr(today) as string
      let status: string
      let daysDiff = Math.round((new Date(`${p.dueDate}T12:00:00.000Z`).getTime() - today.getTime()) / 86_400_000)
      if (stageLinked && (p.stage?.isSkipped ?? false)) {
        status = 'مرحلة متخطاة'
        daysDiff = 999999
      } else if (stageLinked && !triggered && remaining > EPS) {
        status = 'بانتظار إنجاز المرحلة'
        daysDiff = 999999
      } else if (remaining <= EPS) {
        status = 'مدفوع'
      } else if (covered > EPS) {
        status = p.dueDate >= todayIso ? 'جزئي' : 'متأخر'
      } else if (p.dueDate < todayIso) {
        status = 'متأخر'
      } else if (triggered) {
        status = 'مستحقة'
      } else if (daysDiff <= 7) {
        status = 'مستحق قريبًا'
      } else {
        status = 'لم يحل'
      }
      const trig = dayStr(p.triggeredAt)
      rows.push({
        subContractId: s.id, contractId: c.id, contract: c.contractNumber,
        party: s.subcontractor.name,
        stage: stageLinked ? (p.stage?.name || '—') : '—',
        title: p.title,
        due: trig ? `${trig} ✓` : (dayStr(p.dueDate) ?? '—'),
        amount: round3(Number(p.amount)),
        paid: round3(covered),
        remaining: round3(remaining),
        status,
        source: stageLinked ? 'مرحلة' : 'أيام',
        sources: (sourcesByLine.get(p.id) ?? []).join('، '),
        dueNow: remaining > EPS && !WAIT_EXCLUDED.includes(status),
      })
    })
  }

  let shown = rows
  if (option === 'due_only') shown = rows.filter((r) => r.dueNow)
  else if (option === 'overdue_only') shown = rows.filter((r) => r.status === 'متأخر')
  shown = [...shown].sort((a, b) => {
    const ga = a.status === 'متأخر' ? 0 : 1
    const gb = b.status === 'متأخر' ? 0 : 1
    if (ga !== gb) return ga - gb
    return b.remaining - a.remaining
  })

  const body: DuesBoardDTO = {
    rows: shown,
    totals: {
      n: shown.length,
      amount: round3(shown.reduce((s, r) => s + r.amount, 0)),
      paid: round3(shown.reduce((s, r) => s + r.paid, 0)),
      subRemaining: round3(shown.reduce((s, r) => s + r.remaining, 0)),
      overdueN: shown.filter((r) => r.status === 'متأخر').length,
    },
  }
  return NextResponse.json(body)
}
