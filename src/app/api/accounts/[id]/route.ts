import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";

/**
 * تعديل/حذف حساب من دليل الحسابات — Task 102.
 * PATCH: الاسم/البيانات/الرصيد الافتتاحي/خريطة XBRL/التفعيل — الكود والنوع مقفولان للنظامي.
 * DELETE: غير النظامي الذي لا أبناء له ولا ربط بشجرة المصروفات حصرًا.
 */

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await authGuard(req, "screen_chart_of_accounts");
  if ("response" in guard) return guard.response;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isFinite(id)) return jsonError("معرّف غير صحيح.", 404);

  const acc = await db.account.findUnique({ where: { id } });
  if (!acc) return jsonError("الحساب غير موجود في دليل الشركة.", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return jsonError("اسم الحساب مطلوب.");
    if (name.length > 120) return jsonError("اسم الحساب طويل جدًا.");
    data.name = name;
  }
  if (body.notes !== undefined) data.notes = String(body.notes ?? "");
  if (body.allowPosting !== undefined) data.allowPosting = Boolean(body.allowPosting);
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
  if (body.xbrlElement !== undefined) data.xbrlElement = String(body.xbrlElement ?? "").trim();
  if (body.openingBalance !== undefined) {
    const v = Number(body.openingBalance);
    if (!Number.isFinite(v)) return jsonError("الرصيد الافتتاحي يجب أن يكون رقمًا.");
    data.openingBalance = v;
  }

  // قفل حقول الهوية للحسابات النظامية المُبذَّرة (تعديل الكود/النوع/الطبيعة مرفوض)
  if (acc.isSystem) {
    for (const locked of ["code", "type", "nature", "parentId", "isSystem"] as const) {
      if (body[locked] !== undefined) {
        return jsonError(`لا يمكن تغيير ${locked === "parentId" ? "الأب" : locked === "isSystem" ? "علم النظام" : "الكود/النوع/الطبيعة"} لحساب نظامي مُبذَّر.`);
      }
    }
  }

  const oldStatus = `${acc.type}/${acc.nature}${acc.isActive ? "" : "/موقوف"}`;
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.account.update({ where: { id }, data });
    await audit(tx, {
      username: guard.user.username,
      action: "تعديل حساب محاسبي",
      entityType: "account",
      entityId: row.id,
      entityName: `${row.code} — ${row.name}`,
      oldStatus,
      newStatus: `${row.type}/${row.nature}${row.isActive ? "" : "/موقوف"}${row.xbrlElement ? "/XBRL" : ""}`,
    });
    return row;
  });

  return ok({ account: { ...updated, openingBalance: Number(updated.openingBalance) } });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await authGuard(req, "screen_chart_of_accounts");
  if ("response" in guard) return guard.response;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isFinite(id)) return jsonError("معرّف غير صحيح.", 404);

  const acc = await db.account.findUnique({ where: { id } });
  if (!acc) return jsonError("الحساب غير موجود في دليل الشركة.", 404);
  if (acc.isSystem) return jsonError("لا يمكن حذف حساب نظامي مُبذَّر — استخدم الإيقاف بدلًا منه.");

  const childCount = await db.account.count({ where: { parentId: id } });
  if (childCount > 0) return jsonError("لا يمكن حذف حساب له حسابات فرعية — احذف الفروع أولًا.");

  const bridged = await db.expenseAccount.findFirst({ where: { accountId: id }, select: { id: true } });
  if (bridged) return jsonError("الحساب مربوط بحساب مصروف في «جسر المصروفات» — افصل الربط قبل الحذف.");

  await db.$transaction(async (tx) => {
    await tx.account.delete({ where: { id } });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف حساب محاسبي",
      entityType: "account",
      entityId: acc.id,
      entityName: `${acc.code} — ${acc.name}`,
      oldStatus: `${acc.type}/${acc.nature}`,
    });
  });

  return ok({ ok: true });
}
