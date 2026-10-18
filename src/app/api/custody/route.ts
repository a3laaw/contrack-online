// ============================================================
// ConTrack Online — العُهد والتصفيات (spec-8-e §1 — مرجع حرفي)
//
// GET  /api/custody?employee=&accountId=
//      → { accounts:[{id,name,fullPath,handed,spent,returned,balance}],
//          movements:[سندات العهدة], totals:{...} }
//      الرصيد محسوب دائمًا (لا تخزين):
//        handed   = Σ payment بـ custodyAccountId و expenseAccountId=null
//        spent    = Σ payment بـ custodyAccountId و expenseAccountId≠null (بنود التصفية)
//        returned = Σ custody_return
//
// POST /api/custody body {op:'handover'|'settle'|'return'|'addAccount', ...}
//   handover  → سند PV: vtype='payment', custodyAccountId=حساب عهدة,
//               expenseAccountId=null, method='نقدًا'
//   settle    → دفعة مجمعة: سند PV لكل بند تحت مرجع واحد
//               method='تصفية عهدة' + notes «تصفية عهدة من حساب: X» — لا نقدية جديدة
//   return    → سند vtype='custody_return' على نفس الحساب، بحارس: المبلغ ≤ المتبقي + 0.001
//   addAccount→ إنشاء حساب عهدة (accountKind='advance') تحت جذر «عهد الموظفين» (مدير فقط)
//
// ملاحظة التكيف: عمود expenseGroupRef غير متاح في مخطط Prisma الحالي
// (ممنوع تعديل المخطط في هذه المهمة)، لذا يُخزَّن مرجع المجموعة داخل notes
// بنمط الوسم النصي الذي يعتمده الأصل نفسه في حارس الإلغاء
// (spec-8-e §1.4: notes تحتوي «تصفية عهدة من حساب:») —
// «المرجع: PAY-GRP-YYYYMMDD-### | بند i/n» — والتمييز بين التسليم والتصفية
// يبقى حرفيًا كما في الأصل: وجود/عدم وجود expenseAccountId.
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  authGuard,
  adminGuard,
  jsonError,
  nextNumber,
  parseAmount,
  parseDay,
  type TxClient,
} from '@/lib/api-utils'
import { round3 } from '@/lib/format'

const EPS = 0.001 // تسامح الحرس المالي (المتبقي)
const SETTLE_METHOD = 'تصفية عهدة'
const CUSTODY_ROOT = 'عهد الموظفين'
const GROUP_RE = /المرجع: (PAY-GRP-\d{8}-\d{3})/

type VoucherRow = { vtype: string; custodyAccountId: number | null; expenseAccountId: number | null; amount: number }

function isHandover(v: VoucherRow): boolean {
  return v.vtype === 'payment' && v.expenseAccountId == null
}
function isSettlementItem(v: VoucherRow): boolean {
  return v.vtype === 'payment' && v.expenseAccountId != null
}

/** أرصدة حسابات العهدة من سندات سارية — محسوبة دائمًا (لا تخزين) */
function computeBalances(accounts: { id: number }[], rows: VoucherRow[]) {
  const acc = new Map<number, { handed: number; spent: number; returned: number }>()
  for (const a of accounts) acc.set(a.id, { handed: 0, spent: 0, returned: 0 })
  for (const v of rows) {
    if (v.custodyAccountId == null) continue
    const b = acc.get(v.custodyAccountId)
    if (!b) continue
    if (isHandover(v)) b.handed += v.amount
    else if (isSettlementItem(v)) b.spent += v.amount
    else if (v.vtype === 'custody_return') b.returned += v.amount
  }
  const out = new Map<number, { handed: number; spent: number; returned: number; balance: number }>()
  for (const [id, b] of acc) {
    out.set(id, {
      handed: round3(b.handed),
      spent: round3(b.spent),
      returned: round3(b.returned),
      balance: round3(b.handed - b.spent - b.returned),
    })
  }
  return out
}

async function findCustodyAccount(id: unknown) {
  const accId = Number(id)
  if (!Number.isInteger(accId)) return null
  const acc = await db.expenseAccount.findUnique({ where: { id: accId } })
  if (!acc || !acc.isActive || acc.accountKind !== 'advance') return null
  return acc
}

/** جذر شجرة العهد — يُنشأ عند أول حاجة (لا يقبل قيدًا كالأصل) */
async function ensureCustodyRoot(tx?: TxClient) {
  const client = tx ?? db
  const root = await client.expenseAccount.findFirst({
    where: { name: CUSTODY_ROOT, accountKind: 'advance' },
    orderBy: { id: 'asc' },
  })
  if (root) return root
  return client.expenseAccount.create({
    data: {
      name: CUSTODY_ROOT,
      fullPath: CUSTODY_ROOT,
      accountKind: 'advance',
      allowPosting: false,
      includeInProfitability: false,
      sortOrder: 8000,
    },
  })
}

const pad3 = (n: number) => String(n).padStart(3, '0')

const ymdOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// ------------------------------------------------------------
// GET
// ------------------------------------------------------------
export async function GET(req: NextRequest) {
  const g = await authGuard(req)
  if (g.error) return g.error

  const sp = req.nextUrl.searchParams
  const employee = sp.get('employee')?.trim() ?? ''
  const accountId = Number(sp.get('accountId') ?? '') || undefined

  const accounts = await db.expenseAccount.findMany({
    where: { accountKind: 'advance', isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, fullPath: true },
  })

  // كل سندات العهدة السارية (لحساب الأرصدة)
  const rows = await db.voucher.findMany({
    where: { custodyAccountId: { not: null }, cancelled: false },
    select: { vtype: true, custodyAccountId: true, expenseAccountId: true, amount: true },
  })
  const balances = computeBalances(accounts, rows)

  const accDTOs = accounts.map((a) => {
    const b = balances.get(a.id) ?? { handed: 0, spent: 0, returned: 0, balance: 0 }
    return { id: a.id, name: a.name, fullPath: a.fullPath, ...b }
  })

  // الحركات (آخر 300) مع فلاتر اختيارية
  const where: Record<string, unknown> = { custodyAccountId: { not: null } }
  if (accountId) where.custodyAccountId = accountId
  if (employee) where.party = { contains: employee }

  const vouchers = await db.voucher.findMany({
    where,
    orderBy: [{ vdate: 'desc' }, { id: 'desc' }],
    take: 300,
    include: {
      custodyAccount: { select: { name: true, fullPath: true } },
      expenseAccount: { select: { name: true } },
    },
  })

  const movements = vouchers.map((v) => {
    const kind = v.vtype === 'custody_return' ? 'return' : v.expenseAccountId != null ? 'settlement' : 'handover'
    return {
      id: v.id,
      voucherNumber: v.voucherNumber,
      vtype: v.vtype,
      kind,
      vdate: ymdOf(v.vdate),
      custodyAccountId: v.custodyAccountId ?? 0,
      custodyAccountName: v.custodyAccount?.name ?? '',
      expenseAccountId: v.expenseAccountId,
      expenseAccountName: v.expenseAccount?.name ?? null,
      groupRef: kind === 'settlement' ? GROUP_RE.exec(v.notes)?.[1] ?? '' : '',
      amount: v.amount,
      party: v.party,
      method: v.method,
      description: v.description,
      cancelled: v.cancelled,
      cancelReason: v.cancelReason,
    }
  })

  const totals = accDTOs.reduce(
    (t, a) => ({
      handed: round3(t.handed + a.handed),
      spent: round3(t.spent + a.spent),
      returned: round3(t.returned + a.returned),
      balance: round3(t.balance + a.balance),
    }),
    { handed: 0, spent: 0, returned: 0, balance: 0 },
  )

  return NextResponse.json({ accounts: accDTOs, movements, totals })
}

// ------------------------------------------------------------
// POST
// ------------------------------------------------------------
export async function POST(req: NextRequest) {
  const g = await authGuard(req)
  if (g.error) return g.error

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonError('طلب غير صالح', 400)
  }

  const op = typeof body.op === 'string' ? body.op : ''

  // ---------- إنشاء حساب عهدة (مدير فقط) ----------
  if (op === 'addAccount') {
    const a = await adminGuard(req)
    if (a.error) return a.error
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return jsonError('اسم حساب العهدة مطلوب', 400)
    const dup = await db.expenseAccount.findFirst({ where: { name } })
    if (dup) return jsonError(`يوجد حساب مصروفات بنفس الاسم «${name}»`, 409)
    const root = await ensureCustodyRoot()
    const created = await db.expenseAccount.create({
      data: {
        parentId: root.id,
        name,
        fullPath: `${CUSTODY_ROOT} / ${name}`,
        accountKind: 'advance',
        allowPosting: true,
        includeInProfitability: false,
        sortOrder: 8001,
      },
    })
    return NextResponse.json({ id: created.id, name: created.name }, { status: 201 })
  }

  // ---------- ① تسليم عهدة ----------
  if (op === 'handover') {
    const acc = await findCustodyAccount(body.custodyAccountId)
    if (!acc) return jsonError('حساب العهدة غير صالح — الحركات تتم على حسابات مصنّفة كعهدة فقط', 400)
    const vdate = parseDay(body.vdate)
    if (!vdate) return jsonError('تاريخ السند غير صالح', 400)
    const amount = parseAmount(body.amount)
    if (amount == null || amount <= 0) return jsonError('مبلغ تسليم العهدة يجب أن يكون أكبر من صفر', 400)
    const party = typeof body.party === 'string' ? body.party.trim() : ''
    const description =
      (typeof body.description === 'string' && body.description.trim()) || `تسليم عهدة${party ? ` — ${party}` : ''}`

    const created = await db.$transaction(async (tx) => {
      const number = await nextNumber('vouchers', (n) => `PV-${String(n).padStart(4, '0')}`, tx)
      return tx.voucher.create({
        data: {
          voucherNumber: number,
          vtype: 'payment',
          vdate,
          party,
          partyType: 'other',
          method: 'نقدًا',
          account: acc.fullPath,
          amount,
          description,
          custodyAccountId: acc.id,
          // الحارس الحرفي: التسليم بلا حساب مصروف — ولا يجمع عهدة وسلفة معًا (advanceEmployeeId يبقى null)
          createdBy: g.user.username,
        },
      })
    })

    return NextResponse.json(
      { id: created.id, voucherNumber: created.voucherNumber, amount: created.amount },
      { status: 201 },
    )
  }

  // ---------- ② تصفية عهدة (دفعة مجمعة) ----------
  if (op === 'settle') {
    const acc = await findCustodyAccount(body.custodyAccountId)
    if (!acc) return jsonError('حساب العهدة غير صالح — الحركات تتم على حسابات مصنّفة كعهدة فقط', 400)
    const vdate = parseDay(body.vdate)
    if (!vdate) return jsonError('تاريخ التصفية غير صالح', 400)

    const itemsInput = Array.isArray(body.items) ? body.items : []
    if (itemsInput.length === 0) return jsonError('بنود التصفية مطلوبة — أضف بندًا واحدًا على الأقل', 400)

    type Item = { expenseAccountId: number; description: string; amount: number; accountPath: string }
    const items: Item[] = []
    let total = 0
    for (const raw of itemsInput) {
      if (typeof raw !== 'object' || raw === null) return jsonError('بنود التصفية غير صالحة', 400)
      const it = raw as Record<string, unknown>
      const expenseAccountId = Number(it.expenseAccountId)
      if (!Number.isInteger(expenseAccountId)) return jsonError('حساب المصروف مطلوب لكل بند', 400)
      const expAcc = await db.expenseAccount.findUnique({ where: { id: expenseAccountId } })
      if (!expAcc || !expAcc.isActive) return jsonError('أحد حسابات المصروف غير موجود أو غير نشط', 404)
      // الحارس المزدوج: حساب عهدة لا يُستخدم كحساب مصروف (account_snapshot — spec §1.1)
      if (expAcc.accountKind !== 'expense') {
        return jsonError(`«${expAcc.name}» ليس حساب مصروف — لا يمكن استخدام حساب عهدة في بند تصفية`, 400)
      }
      const amount = parseAmount(it.amount)
      if (amount == null || amount <= 0) return jsonError('مبلغ كل بند يجب أن يكون أكبر من صفر', 400)
      total = round3(total + amount)
      items.push({
        expenseAccountId,
        description: (typeof it.description === 'string' ? it.description.trim() : '') || 'مصروف من العهدة',
        amount,
        accountPath: expAcc.fullPath,
      })
    }

    // حارس الرصيد: إجمالي البنود ≤ متبقي العهدة + 0.001
    const rows = await db.voucher.findMany({
      where: { custodyAccountId: acc.id, cancelled: false },
      select: { vtype: true, custodyAccountId: true, expenseAccountId: true, amount: true },
    })
    const b = computeBalances([acc], rows).get(acc.id)!
    if (total > b.balance + EPS) {
      return jsonError(
        `إجمالي بنود التصفية (${total.toFixed(3)} د.ك) يتجاوز متبقي العهدة (${b.balance.toFixed(3)} د.ك)`,
        400,
      )
    }

    const ymd = `${vdate.getFullYear()}${String(vdate.getMonth() + 1).padStart(2, '0')}${String(vdate.getDate()).padStart(2, '0')}`

    const result = await db.$transaction(
      async (tx) => {
        // مرجع الدفعة المجمعة PAY-GRP-YYYYMMDD-### (نفس المرجع للدفعة كاملة)
        const sameDay = await tx.voucher.count({
          where: { notes: { contains: `المرجع: PAY-GRP-${ymd}-` } },
        })
        const groupRef = `PAY-GRP-${ymd}-${pad3(sameDay + 1)}`
        const created: { id: number; voucherNumber: string; amount: number }[] = []
        for (let i = 0; i < items.length; i++) {
          const it = items[i]
          const number = await nextNumber('vouchers', (n) => `PV-${String(n).padStart(4, '0')}`, tx)
          const v = await tx.voucher.create({
            data: {
              voucherNumber: number,
              vtype: 'payment',
              vdate,
              party: '',
              partyType: 'other',
              method: SETTLE_METHOD,
              account: it.accountPath,
              amount: it.amount,
              description: it.description,
              expenseAccountId: it.expenseAccountId,
              custodyAccountId: acc.id,
              notes: `تصفية عهدة من حساب: ${acc.fullPath} | المرجع: ${groupRef} | بند ${i + 1}/${items.length}`,
              createdBy: g.user.username,
            },
          })
          created.push({ id: v.id, voucherNumber: v.voucherNumber, amount: v.amount })
        }
        return { groupRef, created }
      },
      { timeout: 15000 },
    )

    return NextResponse.json(
      { groupRef: result.groupRef, total, created: result.created },
      { status: 201 },
    )
  }

  // ---------- ③ إرجاع متبقٍ للخزينة ----------
  if (op === 'return') {
    const acc = await findCustodyAccount(body.custodyAccountId)
    if (!acc) return jsonError('حساب العهدة غير صالح — الحركات تتم على حسابات مصنّفة كعهدة فقط', 400)
    const vdate = parseDay(body.vdate)
    if (!vdate) return jsonError('تاريخ السند غير صالح', 400)
    const amount = parseAmount(body.amount)
    if (amount == null || amount <= 0) return jsonError('مبلغ الإرجاع يجب أن يكون أكبر من صفر', 400)
    const method = (typeof body.method === 'string' && body.method.trim()) || 'نقدًا'
    const description =
      (typeof body.description === 'string' && body.description.trim()) || 'إرجاع متبقٍ من العهدة إلى الخزينة'

    // الحارس الحرفي: المبلغ ≤ المتبقي + 0.001
    const rows = await db.voucher.findMany({
      where: { custodyAccountId: acc.id, cancelled: false },
      select: { vtype: true, custodyAccountId: true, expenseAccountId: true, amount: true },
    })
    const b = computeBalances([acc], rows).get(acc.id)!
    if (amount > b.balance + EPS) {
      return jsonError(
        `مبلغ الإرجاع (${amount.toFixed(3)} د.ك) يتجاوز متبقي العهدة (${b.balance.toFixed(3)} د.ك)`,
        400,
      )
    }

    const created = await db.$transaction(async (tx) => {
      const number = await nextNumber('vouchers', (n) => `CV-${String(n).padStart(4, '0')}`, tx)
      return tx.voucher.create({
        data: {
          voucherNumber: number,
          vtype: 'custody_return',
          vdate,
          party: '',
          partyType: 'other',
          method,
          account: acc.fullPath,
          amount,
          description,
          custodyAccountId: acc.id,
          expenseAccountId: null,
          createdBy: g.user.username,
        },
      })
    })

    return NextResponse.json(
      { id: created.id, voucherNumber: created.voucherNumber, amount: created.amount },
      { status: 201 },
    )
  }

  return jsonError('نوع العملية غير مدعوم (handover | settle | return | addAccount)', 400)
}
