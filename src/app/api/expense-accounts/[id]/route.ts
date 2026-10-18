import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";
import {
  EXPENSE_ACCOUNT_KINDS,
  refreshExpenseAccountPaths,
  serializeExpenseAccount,
} from "@/lib/expense-accounts-server";

/**
 * تعديل/إيقاف حساب مصروف — مقابلة expense_account_service.py
 * (update_account / toggle_active). المكتبي بلا حذف فعلي أصلًا؛
 * لذلك الحذف هنا ناعم (إيقاف) ويُرفض عند الاستخدام في السندات أو وجود أبناء.
 */

type P = { params: Promise<{ id: string }> };

/** PUT /api/expense-accounts/[id] — تعديل الاسم/الأب/النشط/السند/الربحية/النوع */
export async function PUT(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const acc = await db.expenseAccount.findUnique({ where: { id } });
  if (!acc) return jsonError("الحساب غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const name = String(body.name ?? acc.name).trim();
  if (!name) return jsonError("اسم الحساب مطلوب.");

  let parentId = acc.parentId;
  if (body.parentId !== undefined) {
    parentId =
      body.parentId === null || body.parentId === "" || Number(body.parentId) === 0 ? null : Number(body.parentId);
    if (parentId !== null && !Number.isFinite(parentId)) return jsonError("الحساب الأب غير موجود.", 404);
  }

  if (parentId === id) return jsonError("لا يمكن جعل الحساب أبًا لنفسه.");

  const accountKind = body.accountKind !== undefined ? String(body.accountKind) : acc.accountKind;
  if (!(EXPENSE_ACCOUNT_KINDS as readonly string[]).includes(accountKind)) {
    return jsonError("نوع الحساب غير صحيح — اختر من القائمة.");
  }

  if (parentId !== null) {
    const parent = await db.expenseAccount.findUnique({ where: { id: parentId } });
    if (!parent) return jsonError("الحساب الأب غير موجود.", 404);
    if (parent.parentId) {
      return jsonError("الشجرة مستويان فقط: أب ثم ابن. لا يمكن نقل حساب تحت ابن.");
    }
    const hasChildren = await db.expenseAccount.count({ where: { parentId: id } });
    if (hasChildren > 0) return jsonError("الحساب الأب لا يمكن جعله ابنًا وفيه أبناء.");
  }

  const isActive = body.isActive !== undefined ? Boolean(body.isActive) : acc.isActive;
  const allowPosting = body.allowPosting !== undefined ? Boolean(body.allowPosting) : acc.allowPosting;
  const includeInProfitability =
    body.includeInProfitability !== undefined ? Boolean(body.includeInProfitability) : acc.includeInProfitability;

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.expenseAccount.update({
      where: { id },
      data: { name, parentId, isActive, allowPosting, includeInProfitability, accountKind },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "تعديل حساب مصروف",
      entityType: "expense_account",
      entityId: id,
      entityName: row.fullPath || row.name,
    });
    return row;
  });

  await refreshExpenseAccountPaths();
  const fresh = await db.expenseAccount.findUnique({ where: { id } });

  return ok({ account: fresh ? serializeExpenseAccount(fresh) : serializeExpenseAccount(updated) });
}

/** DELETE /api/expense-accounts/[id] — حذف ناعم (إيقاف) مع رفض الحذف عند الاستخدام */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const acc = await db.expenseAccount.findUnique({ where: { id } });
  if (!acc) return jsonError("الحساب غير موجود", 404);

  const children = await db.expenseAccount.count({ where: { parentId: id } });
  if (children > 0) {
    return jsonError("لا يمكن حذف حساب فيه أبناء — أوقفه من التعديل بدلًا من حذفه.");
  }

  const usedAsExpense = await db.voucher.count({ where: { expenseAccountId: id } });
  const usedAsCustody = await db.voucher.count({ where: { custodyAccountId: id } });
  if (usedAsExpense > 0 || usedAsCustody > 0) {
    return jsonError("لا يمكن حذف الحساب لاستخدامه في السندات — أوقفه من التعديل بدلًا من حذفه.");
  }

  await db.$transaction(async (tx) => {
    // حذف ناعم: إيقاف فقط — كالمكتبي (toggle_active) الذي لا يحذف صفوف أصلًا
    await tx.expenseAccount.update({ where: { id }, data: { isActive: false } });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف حساب مصروف (إيقاف)",
      entityType: "expense_account",
      entityId: id,
      entityName: acc.fullPath || acc.name,
    });
  });

  return ok({ deleted: true, deactivated: true, id });
}
