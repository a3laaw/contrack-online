// GET  /api/archive — الأرشيف بأقسامه: العملاء المؤرشفون · العقود المؤرشفة · السندات الملغاة
// POST /api/archive — أرشفة/استرجاع (مدير فقط) {op:'archive'|'unarchive', type:'customer'|'contract', id}
// قاعدة: أرشفة العقد لا تغير حساباته ماليًا — إخفاء من القوائم النشطة فقط (spec-8-f §4)
// ملاحظة مخطط: عمود archived موجود على Customer وContract فقط — السندات الملغاة (cancelled=true)
// هي مخرجها الطبيعي من القوائم النشطة فتُعرض في قسم السندات هنا للقراءة.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { adminGuard, authGuard, jsonError } from '@/lib/api-utils'
import { round3 } from '@/lib/format'
import type { ArchiveDTO } from '@/lib/productivity-types'

export async function GET(req: NextRequest) {
  const g = await authGuard(req)
  if (g.error) return g.error

  const [customers, contracts, vouchers] = await Promise.all([
    db.customer.findMany({
      where: { archived: true },
      orderBy: { name: 'asc' },
      take: 500,
      include: { contracts: { select: { amount: true, status: true } } },
    }),
    db.contract.findMany({
      where: { archived: true },
      orderBy: { contractNumber: 'asc' },
      take: 500,
      include: {
        customer: { select: { name: true } },
        addendums: { where: { status: 'معتمد' }, select: { amountAdd: true, amountDeduct: true } },
      },
    }),
    // السندات الملغاة = مخرجة من القوائم النشطة (بديل الأرشفة — لا عمود archived على Voucher)
    db.voucher.findMany({
      where: { cancelled: true },
      orderBy: [{ cancelledAt: 'desc' }, { id: 'desc' }],
      take: 300,
      include: { contract: { select: { contractNumber: true } } },
    }),
  ])

  const body: ArchiveDTO = {
    customers: customers.map((c) => ({
      id: c.id,
      customerCode: c.customerCode,
      name: c.name,
      phone: c.phone,
      contractsCount: c.contracts.filter((k) => k.status !== 'ملغى').length,
      totalRaw: round3(
        c.contracts.filter((k) => k.status !== 'ملغى').reduce((s, k) => s + k.amount, 0),
      ),
    })),
    contracts: contracts.map((k) => {
      const netApproved = k.addendums.reduce((s, a) => s + (a.amountAdd - a.amountDeduct), 0)
      const supExt =
        k.supMonths > 0
          ? Math.max(0, k.supMonthly - k.supDiscount) * (k.supMonths - k.supWaivedMonths)
          : 0
      return {
        id: k.id,
        contractNumber: k.contractNumber,
        contractName: k.contractName,
        customerName: k.customer.name,
        amount: round3(k.amount),
        currentValue: round3(k.amount + netApproved + supExt),
        status: k.status,
      }
    }),
    vouchers: vouchers.map((v) => ({
      id: v.id,
      voucherNumber: v.voucherNumber,
      vtype: v.vtype,
      vdate: v.vdate.toISOString(),
      amount: round3(v.amount),
      party: v.party,
      contractNumber: v.contract?.contractNumber ?? null,
      cancelReason: v.cancelReason,
    })),
  }

  return NextResponse.json(body)
}

export async function POST(req: NextRequest) {
  const g = await adminGuard(req)
  if (g.error) return g.error

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return jsonError('طلب غير صالح', 400)
  }

  const op = body.op === 'archive' ? 'archive' : body.op === 'unarchive' ? 'unarchive' : null
  if (!op) return jsonError('العملية يجب أن تكون archive أو unarchive', 400)

  const type = typeof body.type === 'string' ? body.type : ''
  if (type === 'voucher') {
    return jsonError(
      'أرشفة السندات غير متاحة — السند الملغى (ملغى) يخرج من القوائم النشطة ويظهر في قسم السندات بالأرشيف',
      400,
    )
  }
  if (type !== 'customer' && type !== 'contract') {
    return jsonError('النوع يجب أن يكون customer أو contract', 400)
  }

  const id = Number(body.id)
  if (!Number.isInteger(id) || id <= 0) return jsonError('معرّف غير صالح', 400)

  const archived = op === 'archive'

  if (type === 'customer') {
    const customer = await db.customer.findUnique({ where: { id } })
    if (!customer) return jsonError('العميل غير موجود', 404)
    if (customer.archived === archived) {
      return jsonError(archived ? 'العميل مؤرشف بالفعل' : 'العميل غير مؤرشف', 400)
    }
    await db.customer.update({ where: { id }, data: { archived, updatedBy: g.user.username, updatedAt: new Date() } })
  } else {
    const contract = await db.contract.findUnique({ where: { id } })
    if (!contract) return jsonError('العقد غير موجود', 404)
    if (contract.archived === archived) {
      return jsonError(archived ? 'العقد مؤرشف بالفعل' : 'العقد غير مؤرشف', 400)
    }
    // أرشفة العقد لا تمس أي حقل مالي — إخفاء من القوائم النشطة فقط
    await db.contract.update({ where: { id }, data: { archived, updatedBy: g.user.username, updatedAt: new Date() } })
  }

  return NextResponse.json({ ok: true })
}
