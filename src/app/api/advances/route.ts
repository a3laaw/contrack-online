// ============================================================
// ConTrack Online — سلف الموظفين (spec-8-e §2 — مرجع حرفي)
//
// GET  /api/advances
//      → { employees:[{id,name,phone,active,handed,recovered,deducted,balance}],
//          movements:[{voucherNumber,vdate,vtype,kind,amount,employeeId,description,...}],
//          totals:{handed,recovered,deducted,balance} }
//      رصيد الموظف محسوب دائمًا = Σسلفة − Σ(رد نقدي + خصم راتب) — لا تخزين
//
// POST /api/advances body {op:'advance'|'return'|'deduct'|'addEmployee', ...}
//   advance     → سند PV بـ advanceEmployeeId على حساب «سلف موظفين / قرض راتب»
//                 حصرًا (يُنشأ إن لم يوجد عند أول سلفة) — حارس: الموظف موجود وactive
//   return      → رد نقدي CV يخفض المصروف — حارس: المبلغ ≤ متبقي السلفة + 0.001
//   deduct      → خصم راتب SD بلا حركة نقدية على حساب «رواتب» (يُنشأ إن لزم)
//                 — حارس: المبلغ ≤ متبقي السلفة + 0.001
//   addEmployee → إضافة موظف (مدير فقط) — الحذف ممنوع كليًا، والتعطيل بديله
//
// ملاحظة: إلغاء أي سند من هذه الوحدة يتم من شاشة السندات الموجودة
// (/api/vouchers/[id]/cancel) — لا يُنشأ إلغاء هنا.
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  adminGuard,
  authGuard,
  jsonError,
  nextNumber,
  parseAmount,
  parseDay,
} from '@/lib/api-utils'
import { round3 } from '@/lib/format'

const EPS = 0.001 // تسامح الحرس المالي
const ADVANCES_ACCOUNT = 'سلف موظفين / قرض راتب'
const SALARY_ACCOUNT = 'رواتب'

type VoucherRow = { vtype: string; advanceEmployeeId: number | null; amount: number }

/** أرصدة الموظفين من سندات سارية — محسوبة دائمًا (لا تخزين) */
function computeEmployeeBalances(employees: { id: number }[], rows: VoucherRow[]) {
  const map = new Map<number, { handed: number; recovered: number; deducted: number }>()
  for (const e of employees) map.set(e.id, { handed: 0, recovered: 0, deducted: 0 })
  for (const v of rows) {
    if (v.advanceEmployeeId == null) continue
    const b = map.get(v.advanceEmployeeId)
    if (!b) continue
    if (v.vtype === 'payment') b.handed += v.amount
    else if (v.vtype === 'custody_return') b.recovered += v.amount
    else if (v.vtype === 'salary_deduction') b.deducted += v.amount
  }
  const out = new Map<number, { handed: number; recovered: number; deducted: number; balance: number }>()
  for (const [id, b] of map) {
    out.set(id, {
      handed: round3(b.handed),
      recovered: round3(b.recovered),
      deducted: round3(b.deducted),
      balance: round3(b.handed - b.recovered - b.deducted),
    })
  }
  return out
}

const ymdOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

async function employeeBalanceOf(employeeId: number) {
  const rows = await db.voucher.findMany({
    where: { advanceEmployeeId: employeeId, cancelled: false },
    select: { vtype: true, amount: true },
  })
  let handed = 0, recovered = 0, deducted = 0
  for (const v of rows) {
    if (v.vtype === 'payment') handed += v.amount
    else if (v.vtype === 'custody_return') recovered += v.amount
    else if (v.vtype === 'salary_deduction') deducted += v.amount
  }
  return { handed: round3(handed), recovered: round3(recovered), deducted: round3(deducted), balance: round3(handed - recovered - deducted) }
}

/** حساب «سلف موظفين / قرض راتب» — يُنشأ إن لم يوجد عند أول سلفة (ensure_employee_advance_account) */
async function ensureAdvancesAccount() {
  const found = await db.expenseAccount.findFirst({ where: { name: ADVANCES_ACCOUNT }, orderBy: { id: 'asc' } })
  if (found) return found
  return db.expenseAccount.create({
    data: {
      name: ADVANCES_ACCOUNT,
      fullPath: ADVANCES_ACCOUNT,
      accountKind: 'expense',
      allowPosting: true,
      includeInProfitability: true,
      sortOrder: 8100,
    },
  })
}

/** حساب «رواتب» — يُنشأ إن لم يوجد عند أول خصم (ensure_salary_account) */
async function ensureSalaryAccount() {
  const exact = await db.expenseAccount.findFirst({ where: { name: SALARY_ACCOUNT }, orderBy: { id: 'asc' } })
  if (exact) return exact
  const partial = await db.expenseAccount.findFirst({
    where: { name: { contains: SALARY_ACCOUNT }, accountKind: 'expense' },
    orderBy: { id: 'asc' },
  })
  if (partial) return partial
  return db.expenseAccount.create({
    data: {
      name: SALARY_ACCOUNT,
      fullPath: SALARY_ACCOUNT,
      accountKind: 'expense',
      allowPosting: true,
      includeInProfitability: true,
      sortOrder: 8200,
    },
  })
}

// ------------------------------------------------------------
// GET
// ------------------------------------------------------------
export async function GET(req: NextRequest) {
  const g = await authGuard(req)
  if (g.error) return g.error

  const employees = await db.employee.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] })

  const rows = await db.voucher.findMany({
    where: { advanceEmployeeId: { not: null }, cancelled: false },
    select: { vtype: true, advanceEmployeeId: true, amount: true },
  })
  const balances = computeEmployeeBalances(employees, rows)

  const empDTOs = employees.map((e) => {
    const b = balances.get(e.id) ?? { handed: 0, recovered: 0, deducted: 0, balance: 0 }
    return {
      id: e.id,
      name: e.name,
      phone: e.phone,
      notes: e.notes,
      active: e.active,
      ...b,
    }
  })

  const vouchers = await db.voucher.findMany({
    where: { advanceEmployeeId: { not: null } },
    orderBy: [{ vdate: 'desc' }, { id: 'desc' }],
    take: 300,
    include: { advanceEmployee: { select: { name: true } } },
  })

  const movements = vouchers.map((v) => {
    const kind = v.vtype === 'payment' ? 'advance' : v.vtype === 'custody_return' ? 'cash_return' : 'deduction'
    return {
      id: v.id,
      voucherNumber: v.voucherNumber,
      vtype: v.vtype,
      kind,
      vdate: ymdOf(v.vdate),
      employeeId: v.advanceEmployeeId ?? 0,
      employeeName: v.advanceEmployee?.name ?? '',
      amount: v.amount,
      description: v.description,
      method: v.method,
      cancelled: v.cancelled,
      cancelReason: v.cancelReason,
    }
  })

  const totals = empDTOs.reduce(
    (t, e) => ({
      handed: round3(t.handed + e.handed),
      recovered: round3(t.recovered + e.recovered),
      deducted: round3(t.deducted + e.deducted),
      balance: round3(t.balance + e.balance),
    }),
    { handed: 0, recovered: 0, deducted: 0, balance: 0 },
  )

  return NextResponse.json({ employees: empDTOs, movements, totals })
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

  // ---------- إضافة موظف (مدير فقط) ----------
  if (op === 'addEmployee') {
    const a = await adminGuard(req)
    if (a.error) return a.error
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return jsonError('اسم الموظف مطلوب', 400)
    const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
    const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
    const dup = await db.employee.findUnique({ where: { name } })
    if (dup) return jsonError(`يوجد موظف بنفس الاسم «${name}» — اسم الموظف فريد`, 409)
    const created = await db.employee.create({ data: { name, phone, notes, active: true } })
    return NextResponse.json({ id: created.id, name: created.name }, { status: 201 })
  }

  // ---------- الحركات الثلاث على vouchers.advanceEmployeeId ----------
  const employeeId = Number(body.employeeId)
  if (!Number.isInteger(employeeId)) return jsonError('اختيار الموظف مطلوب', 400)
  const employee = await db.employee.findUnique({ where: { id: employeeId } })
  if (!employee) return jsonError('الموظف غير موجود', 404)

  const vdate = parseDay(body.vdate)
  if (!vdate) return jsonError('تاريخ الحركة غير صالح', 400)
  const amount = parseAmount(body.amount)
  if (amount == null || amount <= 0) return jsonError('المبلغ يجب أن يكون رقمًا أكبر من صفر', 400)
  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''

  // ---------- ① صرف سلفة ----------
  if (op === 'advance') {
    if (!employee.active) return jsonError('الموظف معطّل — لا يمكن صرف سلفة له', 400)
    const acc = await ensureAdvancesAccount()
    const created = await db.$transaction(async (tx) => {
      const number = await nextNumber('vouchers', (n) => `PV-${String(n).padStart(4, '0')}`, tx)
      return tx.voucher.create({
        data: {
          voucherNumber: number,
          vtype: 'payment',
          vdate,
          party: employee.name,
          partyType: 'other',
          method: (typeof body.method === 'string' && body.method.trim()) || 'نقدًا',
          account: acc.fullPath,
          amount,
          description: notes || `صرف سلفة — ${employee.name}`,
          expenseAccountId: acc.id,
          advanceEmployeeId: employee.id,
          createdBy: g.user.username,
        },
      })
    })
    return NextResponse.json(
      { id: created.id, voucherNumber: created.voucherNumber, amount: created.amount },
      { status: 201 },
    )
  }

  // ---------- ② رد نقدي (CV يخفض المصروف) ----------
  if (op === 'return') {
    const b = await employeeBalanceOf(employee.id)
    if (amount > b.balance + EPS) {
      return jsonError(
        `مبلغ الرد (${amount.toFixed(3)} د.ك) يتجاوز متبقي سلفة الموظف (${b.balance.toFixed(3)} د.ك)`,
        400,
      )
    }
    const method = (typeof body.method === 'string' && body.method.trim()) || 'نقدًا'
    const created = await db.$transaction(async (tx) => {
      const number = await nextNumber('vouchers', (n) => `CV-${String(n).padStart(4, '0')}`, tx)
      return tx.voucher.create({
        data: {
          voucherNumber: number,
          vtype: 'custody_return',
          vdate,
          party: employee.name,
          partyType: 'other',
          method,
          account: method === 'تحويل بنكي' ? 'البنك' : 'الصندوق',
          amount,
          description: notes || `رد نقدي على حساب السلفة — ${employee.name}`,
          advanceEmployeeId: employee.id,
          createdBy: g.user.username,
        },
      })
    })
    return NextResponse.json(
      { id: created.id, voucherNumber: created.voucherNumber, amount: created.amount },
      { status: 201 },
    )
  }

  // ---------- ③ خصم من راتب (SD بلا نقدية) ----------
  if (op === 'deduct') {
    const b = await employeeBalanceOf(employee.id)
    if (amount > b.balance + EPS) {
      return jsonError(
        `مبلغ الخصم (${amount.toFixed(3)} د.ك) يتجاوز متبقي سلفة الموظف (${b.balance.toFixed(3)} د.ك)`,
        400,
      )
    }
    const acc = await ensureSalaryAccount()
    const created = await db.$transaction(async (tx) => {
      const number = await nextNumber('vouchers', (n) => `SD-${String(n).padStart(4, '0')}`, tx)
      return tx.voucher.create({
        data: {
          voucherNumber: number,
          vtype: 'salary_deduction',
          vdate,
          party: employee.name,
          partyType: 'other',
          method: '', // بلا حركة نقدية كالأصل
          account: acc.fullPath,
          amount,
          description: notes || `خصم من الراتب لسداد السلفة — ${employee.name}`,
          expenseAccountId: acc.id,
          advanceEmployeeId: employee.id,
          createdBy: g.user.username,
        },
      })
    })
    return NextResponse.json(
      { id: created.id, voucherNumber: created.voucherNumber, amount: created.amount },
      { status: 201 },
    )
  }

  return jsonError('نوع العملية غير مدعوم (advance | return | deduct | addEmployee)', 400)
}
