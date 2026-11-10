// GET  /api/groups — قائمة مجموعات العقود + الملخص المالي لكل مجموعة (spec-8-f §6.2)
//      collected/paid من سندات القبض/الصرف غير الملغاة · subTotal من عقود الباطن
//      cost = paid + max(0, subTotal − paid) · profit = collected − cost · margin من المحصّل
// POST /api/groups — إنشاء مجموعة (عقدين على الأقل — لا عقد ملغى) برقم GRP-%04d
// ربط تنظيمي فقط — لا دمج مالي ولا تغيير على العقود
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authGuard, jsonError, nextNumber, pad4 } from '@/lib/api-utils'
import { round3 } from '@/lib/format'
import type { GroupSummaryDTO, GroupsResponseDTO } from '@/lib/productivity-types'

/** القيمة الحالية بقاعدة 35 لصف عقد مع ملحقاته */
function currentValueOf(c: {
  amount: number
  supMonthly: number
  supMonths: number
  supDiscount: number
  supWaivedMonths: number
  addendums?: { amountAdd: number; amountDeduct: number }[]
}): number {
  const netApproved = (c.addendums ?? []).reduce((s, a) => s + (a.amountAdd - a.amountDeduct), 0)
  const supExt =
    c.supMonths > 0
      ? Math.max(0, c.supMonthly - c.supDiscount) * (c.supMonths - c.supWaivedMonths)
      : 0
  return round3(c.amount + netApproved + supExt)
}

export async function GET(req: NextRequest) {
  const g = await authGuard(req)
  if (g.error) return g.error

  const groups = await db.contractGroup.findMany({
    orderBy: [{ id: 'desc' }],
    take: 200,
    include: {
      items: {
        orderBy: { id: 'asc' },
        include: {
          contract: {
            include: {
              customer: { select: { id: true, name: true } },
              addendums: { where: { status: 'معتمد' }, select: { amountAdd: true, amountDeduct: true } },
              subContracts: { where: { status: { not: 'ملغى' } }, select: { amount: true } },
            },
          },
        },
      },
    },
  })

  const groupIds = groups.map((gr) => gr.id)
  const itemContractIds = groups.flatMap((gr) => gr.items.map((it) => it.contractId))
  const uniqueContractIds = Array.from(new Set(itemContractIds))

  // سندات القبض/الصرف غير الملغاة على عقود المجموعات — لكل مجموعة على حدة
  const collectedByGroup = new Map<number, number>()
  const paidByGroup = new Map<number, number>()
  if (groupIds.length > 0) {
    const [items, receipts, payments] = await Promise.all([
      db.contractGroupItem.findMany({ select: { groupId: true, contractId: true } }),
      db.voucher.findMany({
        where: { vtype: 'receipt', cancelled: false, contractId: { in: uniqueContractIds } },
        select: { contractId: true, amount: true },
      }),
      db.voucher.findMany({
        where: { vtype: 'payment', cancelled: false, contractId: { in: uniqueContractIds } },
        select: { contractId: true, amount: true },
      }),
    ])
    const contractToGroup = new Map<number, number[]>()
    for (const it of items) {
      const arr = contractToGroup.get(it.contractId) ?? []
      arr.push(it.groupId)
      contractToGroup.set(it.contractId, arr)
    }
    for (const v of receipts) {
      if (v.contractId == null) continue
      for (const gid of contractToGroup.get(v.contractId) ?? []) {
        collectedByGroup.set(gid, (collectedByGroup.get(gid) ?? 0) + v.amount)
      }
    }
    for (const v of payments) {
      if (v.contractId == null) continue
      for (const gid of contractToGroup.get(v.contractId) ?? []) {
        paidByGroup.set(gid, (paidByGroup.get(gid) ?? 0) + v.amount)
      }
    }
  }

  const groupRows: GroupSummaryDTO[] = groups.map((gr) => {
    const activeItems = gr.items.filter((it) => it.contract.status !== 'ملغى')
    const contracts = gr.items.map((it) => ({
      id: it.contract.id,
      contractNumber: it.contract.contractNumber,
      contractName: it.contract.contractName,
      customerName: it.contract.customer.name,
      customerId: it.contract.customerId,
      status: it.contract.status,
      currentValue: currentValueOf(it.contract),
    }))
    const currentTotal = round3(activeItems.reduce((s, it) => s + currentValueOf(it.contract), 0))
    const collected = round3(collectedByGroup.get(gr.id) ?? 0)
    const paid = round3(paidByGroup.get(gr.id) ?? 0)
    const subTotal = round3(activeItems.reduce((s, it) => s + it.contract.subContracts.reduce((ss, sc) => ss + sc.amount, 0), 0))
    const cost = round3(paid + Math.max(0, subTotal - paid))
    const profit = round3(collected - cost)
    const marginPct = collected > 0 ? Math.round((profit / collected) * 100) : 0

    return {
      id: gr.id,
      groupNumber: gr.groupNumber,
      name: gr.name,
      notes: gr.notes,
      createdBy: gr.createdBy,
      createdAt: gr.createdAt.toISOString(),
      contractsCount: gr.items.length,
      currentTotal,
      collected,
      paid,
      subTotal,
      cost,
      profit,
      marginPct,
      contracts,
    }
  })

  const totals = {
    groups: groupRows.length,
    contracts: groupRows.reduce((s, x) => s + x.contractsCount, 0),
    collected: round3(groupRows.reduce((s, x) => s + x.collected, 0)),
    paid: round3(groupRows.reduce((s, x) => s + x.paid, 0)),
    cost: round3(groupRows.reduce((s, x) => s + x.cost, 0)),
    profit: round3(groupRows.reduce((s, x) => s + x.profit, 0)),
  }

  const body: GroupsResponseDTO = { groups: groupRows, totals }
  return NextResponse.json(body)
}

export async function POST(req: NextRequest) {
  const g = await authGuard(req)
  if (g.error) return g.error

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return jsonError('طلب غير صالح', 400)
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return jsonError('اسم المجموعة إلزامي', 400)
  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''

  // عقود المجموعة: عقدين على الأقل (بعد إزالة التكرار) — لا عقد ملغى (الشرط المخفف)
  const rawIds = Array.isArray(body.contractIds) ? body.contractIds : []
  const ids = Array.from(new Set(rawIds.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0)))
  if (ids.length < 2) return jsonError('اختر عقدين على الأقل لإنشاء المجموعة', 400)

  const contracts = await db.contract.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true },
  })
  if (contracts.length !== ids.length) return jsonError('أحد العقود المحددة غير موجود', 404)
  const cancelled = contracts.filter((c) => c.status === 'ملغى')
  if (cancelled.length > 0) return jsonError('لا يمكن ضم عقد ملغى داخل مجموعة', 400)

  const created = await db.$transaction(async (tx) => {
    const groupNumber = await nextNumber('contract_groups', (n) => `GRP-${pad4(n)}`, tx)
    return tx.contractGroup.create({
      data: {
        groupNumber,
        name,
        notes,
        createdBy: g.user.username,
        items: { create: ids.map((contractId) => ({ contractId })) },
      },
    })
  })

  return NextResponse.json({ id: created.id, groupNumber: created.groupNumber }, { status: 201 })
}
