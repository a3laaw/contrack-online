// POST /api/gateway/import — استيراد عمليات كشف البوابة (صفوف CSV ملصوقة) + أسطر بنك اختيارية
// - كشف مرن لأعمدة الهاتف والمبلغ (أسماء مرشحة عربية/إنجليزية) — رفض 400 إن غابا
// - upsert idempotent على الفهرس الفريد (profile, opDate, phone, amount, ref)
//   الموزَّع/المسدد/المصنف يدويًا لا يُمس (القفل يبدأ من التوزيع)
// - تصنيف آلي: هاتف يطابق عميلًا (آخر 8 أرقام) أو MatchAlias ⇒ state='mine' وإلا 'unmarked'
// - gwPaid من عمود الحالة (مرن): محوّل ⇒ true، فاشل/ملغى ⇒ يُستبعد
// - bank[]: أسطر إيداع تُخزن في BankLine (فهرس فريد ⇒ idempotent دائم)
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { adminGuard, jsonError, parseDay } from '@/lib/api-utils'
import { round3 } from '@/lib/format'

const EPS = 0.0005
/** عطلة نهاية الأسبوع في الكويت: الجمعة والسبت */
const WEEKEND = new Set([5, 6])

// ---------- مساعدات (خادمية خالصة) ----------
function toLatinDigits(s: string): string {
  return s
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
}

/** مفتاح الهاتف: أرقام فقط — آخر 8 أرقام (تطبيع الكويت) */
function phoneKey(s: unknown): string {
  const digits = toLatinDigits(String(s ?? '')).replace(/\D/g, '')
  return digits.slice(-8)
}

function parseAmountFlex(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const cleaned = toLatinDigits(v).replace(/[,٬\s\u00A0]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return isFinite(n) ? n : null
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  'يناير': 0, 'فبراير': 1, 'مارس': 2, 'أبريل': 3, 'مايو': 4, 'يونيو': 5, 'يوليو': 6, 'أغسطس': 7,
  'سبتمبر': 8, 'أكتوبر': 9, 'نوفمبر': 10, 'ديسمبر': 11,
}

/** تحليل تاريخ مرن: ISO / d-m-y / y-m-d / 26-Sep-2026 / 20260926 / قابل للتحويل */
function parseDateFlex(v: unknown): Date | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v
  if (typeof v !== 'string') return null
  const s = toLatinDigits(v).trim()
  if (!s) return null

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12))

  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/)
  if (m) {
    // يوم أول (الكويت) — إن كان الجزء الأول > 12 فهو يوم حتمًا
    let d = +m[1]
    let mo = +m[2]
    if (d <= 12 && mo > 12) [d, mo] = [mo, d]
    return new Date(Date.UTC(+m[3], mo - 1, d, 12))
  }

  m = s.match(/^(\d{1,2})[\/\-. ]([A-Za-z\u0600-\u06FF]+)[\/\-. ](\d{4})/)
  if (m) {
    const mo = MONTHS[m[2].toLowerCase().slice(0, 3)] ?? MONTHS[m[2]]
    if (mo !== undefined) return new Date(Date.UTC(+m[3], mo, +m[1], 12))
  }

  m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12))

  const d2 = new Date(s)
  return isNaN(d2.getTime()) ? null : d2
}

export const dayKey = (d: Date): string => d.toISOString().slice(0, 10)

/** إضافة n يوم عمل (تخطي الجمعة/السبت) — T+lag للبوابة */
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

// ---------- كشف الأعمدة المرن ----------
const normHeader = (h: string): string => toLatinDigits(h).toLowerCase().replace(/[\s_\-.\/()]/g, '').trim()

const CANDIDATES: Record<string, string[]> = {
  phone: ['phone', 'mobile', 'tel', 'telephone', 'msisdn', 'هاتف', 'جوال', 'موبايل', 'تلفون', 'هاتفالعميل'],
  amount: ['amount', 'amt', 'value', 'total', 'المبلغ', 'القيمة', 'قيمة', 'مبلغ', 'الاجمالي', 'الإجمالي', 'القيمةالكلية'],
  date: ['date', 'opdate', 'opdate', 'transactiondate', 'paymentdate', 'updated', 'created', 'التاريخ', 'تاريخالعملية', 'تاريخالدفع', 'وقتالعملية', 'الوقت', 'تاريخ'],
  ref: ['ref', 'reference', 'invoiceno', 'invoicenumber', 'invoice', 'رقمالفاتورة', 'مرجع', 'المرجع', 'رقمالمرجع', 'رقمالعملية'],
  status: ['status', 'state', 'الحالة', 'حالةالعملية', 'حالة', 'الوضع'],
  name: ['name', 'customer', 'customername', 'العميل', 'اسمالعميل', 'الاسم', 'عميل', 'اسم'],
  descr: ['descr', 'description', 'notes', 'note', 'البيان', 'الوصف', 'وصف', 'بيان', 'ملاحظة', 'ملاحظات', 'بيانالعملية'],
}

function detectColumns(rows: Record<string, unknown>[]): Record<string, string | null> {
  const headers = new Set<string>()
  for (const r of rows.slice(0, 5)) {
    for (const k of Object.keys(r ?? {})) if (k && String(k).trim()) headers.add(String(k).trim())
  }
  const headerList = [...headers]
  const normList = headerList.map((h) => ({ raw: h, norm: normHeader(h) }))

  const out: Record<string, string | null> = {}
  for (const [field, cands] of Object.entries(CANDIDATES)) {
    const normCands = cands.map((c) => ({ raw: c, norm: normHeader(c) }))
    // تطابق تام أولًا ثم احتواء
    let hit = normList.find((h) => normCands.some((c) => h.norm && h.norm === c.norm))
    if (!hit) hit = normList.find((h) => normCands.some((c) => h.norm && c.norm && h.norm.includes(c.norm)))
    out[field] = hit?.raw ?? null
  }
  return out
}

// ---------- عمود الحالة → محصلة ----------
const PAID_WORDS = ['paid', 'done', 'completed', 'success', 'settled', 'converted', 'transferred', 'transfered', 'مكتمل', 'ناجح', 'تم', 'محول', 'محوّل', 'مدفوع', 'محصلة', 'سددت']
const SKIP_WORDS = ['cancel', 'cancelled', 'canceled', 'failed', 'fail', 'ملغي', 'ملغى', 'ملغاة', 'فاشل', 'فشل', 'مرفوض']

function paidStateOf(status: unknown): 'paid' | 'pending' | 'skip' {
  const s = toLatinDigits(String(status ?? '')).toLowerCase().trim()
  if (!s) return 'pending'
  if (SKIP_WORDS.some((w) => s.includes(w))) return 'skip'
  if (PAID_WORDS.some((w) => s.includes(w))) return 'paid'
  return 'pending'
}

// ============================================================
export async function POST(req: NextRequest) {
  const g = await adminGuard(req)
  if (g.error) return g.error

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonError('طلب غير صالح', 400)
  }

  const profileId = Number(body.profileId)
  if (!Number.isInteger(profileId)) return jsonError('اختيار البوابة مطلوب قبل الاستيراد', 400)
  const profile = await db.gatewayProfile.findUnique({ where: { id: profileId } })
  if (!profile) return jsonError('البوابة غير موجودة', 404)

  const rawRows = Array.isArray(body.rows) ? body.rows : []
  if (rawRows.length === 0) {
    return jsonError('لا توجد صفوف للاستيراد — الصق نص كشف البوابة أولًا', 400)
  }
  const rows = rawRows.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)

  const cols = detectColumns(rows)
  if (!cols.phone || !cols.amount) {
    return jsonError('تعذر إيجاد عمودي الهاتف والمبلغ في الصفوف الملصوقة — تأكد أن الكشف يحتويهما', 400)
  }

  // دليل عملائنا: آخر 8 أرقام من كل هاتف عميل + الروابط المحفوظة (match_aliases)
  const [customers, aliases] = await Promise.all([
    db.customer.findMany({ select: { id: true, name: true, phone: true } }),
    db.matchAlias.findMany({ select: { filePhone: true, customerId: true } }),
  ])
  const customerByPhone = new Map<string, number>()
  for (const c of customers) {
    for (const chunk of c.phone.split(/[^\d]+/)) {
      const key = phoneKey(chunk)
      if (key.length >= 7 && !customerByPhone.has(key)) customerByPhone.set(key, c.id)
    }
  }
  for (const a of aliases) {
    const key = phoneKey(a.filePhone)
    if (key.length >= 7 && !customerByPhone.has(key)) customerByPhone.set(key, a.customerId)
  }

  const batch = typeof body.batch === 'string' && body.batch.trim() ? body.batch.trim() : 'لصق يدوي'
  const existing = await db.gatewayOp.findMany({
    where: { profileId },
    select: {
      id: true, opDate: true, phone: true, amount: true, ref: true,
      state: true, classifiedManual: true, distributed: true, paidTransferId: true, gwPaid: true, gwPaidDate: true,
    },
  })
  const existingMap = new Map<string, (typeof existing)[number]>()
  for (const op of existing) {
    existingMap.set(`${dayKey(op.opDate)}|${op.phone}|${round3(op.amount)}|${op.ref}`, op)
  }

  const result = { total: rows.length, inserted: 0, updated: 0, locked: 0, skipped: 0, mineMarked: 0, bankInserted: 0 }

  for (const row of rows) {
    const phone = String(row[cols.phone!] ?? '').trim()
    const amountRaw = parseAmountFlex(row[cols.amount!])
    if (!phone || amountRaw == null || amountRaw <= 0) {
      result.skipped++
      continue
    }
    const amount = round3(amountRaw)

    const stateVal = paidStateOf(row[cols.status ?? ''])
    if (stateVal === 'skip') {
      result.skipped++ // الفاشل/الملغى يُستبعد من الاستيراد (لا يُعلَّم ولا يدخل التصفية)
      continue
    }
    const gwPaid = stateVal === 'paid'

    const opDate = parseDateFlex(row[cols.date ?? '']) ?? parseDay(new Date().toISOString().slice(0, 10)) ?? new Date()
    const ref = String(row[cols.ref ?? ''] ?? '').trim()
    const customerName = String(row[cols.name ?? ''] ?? '').trim()

    const key = `${dayKey(opDate)}|${phone}|${amount}|${ref}`
    const found = existingMap.get(key)

    if (found) {
      if (found.distributed || found.paidTransferId != null) {
        result.locked++ // الموزَّع/المسدد لا يُمس إطلاقًا
        continue
      }
      const data: Record<string, unknown> = {}
      if (gwPaid && !found.gwPaid) {
        data.gwPaid = true
        data.gwPaidDate = found.gwPaidDate ?? opDate
      }
      // استعادة التصنيف الآلي فقط لغير المصنف يدويًا
      if (!found.classifiedManual && found.state === 'unmarked') {
        const autoMine = customerByPhone.has(phoneKey(phone))
        if (autoMine) data.state = 'mine'
      }
      if (Object.keys(data).length > 0) {
        await db.gatewayOp.update({ where: { id: found.id }, data })
      }
      result.updated++
      continue
    }

    // صف جديد — تصنيف آلي
    const autoMine = customerByPhone.has(phoneKey(phone))
    await db.gatewayOp.create({
      data: {
        profileId,
        opDate,
        phone,
        customerName,
        amount,
        ref,
        state: autoMine ? 'mine' : 'unmarked',
        gwPaid,
        gwPaidDate: gwPaid ? opDate : null,
        effectiveDate: addBusinessDays(opDate, profile.lagDays),
        batch,
      },
    })
    result.inserted++
    if (autoMine) result.mineMarked++
  }

  // ---------- أسطر البنك (جدول دائم idempotent) ----------
  const rawBank = Array.isArray(body.bank) ? (body.bank.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null) as Record<string, unknown>[]) : []
  if (rawBank.length > 0) {
    const bankCols = detectColumns(rawBank)
    if (!bankCols.amount || !bankCols.date) {
      return jsonError('تعذر إيجاد عمودي التاريخ والمبلغ في أسطر البنك', 400)
    }
    const accCandidates = ['bankaccount', 'account', 'bank', 'الحساب', 'الحسابالبنكي', 'حساب', 'البنك', 'رقمالحساب']
    const normAcc = accCandidates.map((c) => normHeader(c))
    const headers = [...new Set(rawBank.slice(0, 5).flatMap((r) => Object.keys(r ?? {}).filter(Boolean).map(String)))]
    const accHeader = headers.find((h) => normAcc.includes(normHeader(h)))
        ?? headers.find((h) => normAcc.some((c) => normHeader(h).includes(c)))
        ?? null

    const bankValues: {
      bankAccount: string; cdate: Date; amount: number; descr: string; batch: string
    }[] = []
    for (const row of rawBank) {
      const amount = parseAmountFlex(row[bankCols.amount!])
      const cdate = parseDateFlex(row[bankCols.date ?? ''])
      if (amount == null || amount <= 0 || !cdate) continue
      const bankAccount = String((accHeader ? row[accHeader] : '') ?? '').trim() || profile.bankAccount
      const descr = String(row[bankCols.descr ?? ''] ?? '').trim()
      bankValues.push({ bankAccount, cdate, amount: round3(amount), descr, batch })
    }
    if (bankValues.length > 0) {
      // upsert بالفهرس الفريد ⇒ الاستيراد idempotent (يدعم بين الجلسات)
      for (const b of bankValues) {
        await db.bankLine.upsert({
          where: {
            bankAccount_cdate_amount_descr: {
              bankAccount: b.bankAccount,
              cdate: b.cdate,
              amount: b.amount,
              descr: b.descr,
            },
          },
          create: b,
          update: {},
        })
      }
      result.bankInserted = bankValues.length
    }
  }

  return NextResponse.json(result)
}
