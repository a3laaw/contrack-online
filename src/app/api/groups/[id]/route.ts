// PATCH  /api/groups/[id] — op:'add' (ضم عقد غير ملغى غير مكرر) · op:'remove' (إزالة عقد)
//                          · op:'update' (الاسم/الملاحظات — مدير فقط)
// DELETE /api/groups/[id] — حذف المجموعة (مدير فقط) — ربط تنظيمي فلا أثر مالي
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authGuard, adminGuard, jsonError } from '@/lib/api-utils'
import { isAdminRole } from '@/lib/auth'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await authGuard(req)
  if (g.error) return g.error

  const { id } = await ctx.params
  const gid = Number(id)
  if (!Number.isInteger(gid) || gid <= 0) return jsonError('معرّف غير صالح', 400)

  const group = await db.contractGroup.findUnique({
    where: { id: gid },
    include: { items: { select: { contractId: true } } },
  })
  if (!group) return jsonError('المجموعة غير موجودة', 404)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return jsonError('طلب غير صالح', 400)
  }

  const op = typeof body.op === 'string' ? body.op : ''

  // ---------- ضم عقد ----------
  if (op === 'add') {
    const cid = Number(body.contractId)
    if (!Number.isInteger(cid) || cid <= 0) return jsonError('معرّف العقد غير صالح', 400)
    if (group.items.some((it) => it.contractId === cid)) {
      return jsonError('العقد موجود في المجموعة بالفعل', 400)
    }
    const contract = await db.contract.findUnique({ where: { id: cid } })
    if (!contract) return jsonError('العقد غير موجود', 404)
    if (contract.status === 'ملغى') return jsonError('لا يمكن ضم عقد ملغى داخل مجموعة', 400)
    await db.contractGroupItem.create({ data: { groupId: gid, contractId: cid } })
    return NextResponse.json({ ok: true })
  }

  // ---------- إزالة عقد ----------
  if (op === 'remove') {
    const cid = Number(body.contractId)
    if (!Number.isInteger(cid) || cid <= 0) return jsonError('معرّف العقد غير صالح', 400)
    const item = await db.contractGroupItem.findUnique({
      where: { groupId_contractId: { groupId: gid, contractId: cid } },
    })
    if (!item) return jsonError('العقد ليس ضمن هذه المجموعة', 400)
    await db.contractGroupItem.delete({ where: { id: item.id } })
    return NextResponse.json({ ok: true })
  }

  // ---------- تعديل الاسم/الملاحظات (مدير فقط) ----------
  if (op === 'update') {
    if (!isAdminRole(g.user.role)) return jsonError('تعديل بيانات المجموعة متاح للمدير فقط', 403)
    const data: { name?: string; notes?: string } = {}
    if ('name' in body) {
      const n = typeof body.name === 'string' ? body.name.trim() : ''
      if (!n) return jsonError('اسم المجموعة إلزامي', 400)
      data.name = n
    }
    if ('notes' in body) data.notes = typeof body.notes === 'string' ? body.notes.trim() : ''
    if (Object.keys(data).length === 0) return jsonError('لا توجد حقول للتعديل', 400)
    await db.contractGroup.update({ where: { id: gid }, data })
    return NextResponse.json({ id: gid })
  }

  return jsonError('عملية غير معروفة — العمليات المتاحة: add، remove، update', 400)
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await adminGuard(req)
  if (g.error) return g.error

  const { id } = await ctx.params
  const gid = Number(id)
  if (!Number.isInteger(gid) || gid <= 0) return jsonError('معرّف غير صالح', 400)

  const group = await db.contractGroup.findUnique({ where: { id: gid } })
  if (!group) return jsonError('المجموعة غير موجودة', 404)

  // حذف المجموعة فقط — العقود لا تمس إطلاقًا (ربط تنظيمي)
  await db.contractGroup.delete({ where: { id: gid } })
  return NextResponse.json({ ok: true })
}
