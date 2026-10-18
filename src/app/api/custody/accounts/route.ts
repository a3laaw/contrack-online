import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { adminGuard, authGuard, jsonError, ok } from "@/lib/api-utils";
import { intOr } from "@/lib/contrack-server";
import { VoucherError } from "@/lib/voucher-server";
import { custodyBreakdown } from "@/lib/custody-server";

/**
 * شجرة حسابات العُهد (ExpenseAccount.accountKind='advance'):
 * أب = فئة عهدة (مثل «العُهد»)، ابن = عهدة. لكل حساب: الرصيد = مُسلَّم − مُنفَق − مرتجع.
 */

function err(e: unknown) {
  if (e instanceof VoucherError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return jsonError("حدث خطأ غير متوقع", 500);
}

/** GET: كل حسابات العُهد مع الأرصدة المحسوبة لحظيًا + الإجمالي */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_custody");
  if ("response" in guard) return guard.response;

  const accounts = await db.expenseAccount.findMany({
    where: { accountKind: "advance" },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  const parentIds = [...new Set(accounts.map((a) => a.parentId).filter((x): x is number => x != null))];
  const parents = parentIds.length
    ? await db.expenseAccount.findMany({ where: { id: { in: parentIds } }, select: { id: true, name: true } })
    : [];
  const parentNames = new Map(parents.map((p) => [p.id, p.name]));

  const items: {
    id: number;
    name: string;
    fullPath: string;
    parentId: number | null;
    parentName: string;
    isActive: boolean;
    allowPosting: boolean;
    includeInProfitability: boolean;
    sortOrder: number;
    handed: number;
    spent: number;
    returned: number;
    balance: number;
  }[] = [];
  for (const acc of accounts) {
    const bd = await custodyBreakdown(db, acc.id);
    items.push({
      id: acc.id,
      name: acc.name,
      fullPath: acc.fullPath,
      parentId: acc.parentId,
      parentName: acc.parentId ? parentNames.get(acc.parentId) || "" : "",
      isActive: acc.isActive,
      allowPosting: acc.allowPosting,
      includeInProfitability: acc.includeInProfitability,
      sortOrder: acc.sortOrder,
      handed: bd.handed,
      spent: bd.spent,
      returned: bd.returned,
      balance: bd.balance,
    });
  }
  const totals = {
    handed: Math.round(items.reduce((s, a) => s + a.handed, 0) * 1000) / 1000,
    spent: Math.round(items.reduce((s, a) => s + a.spent, 0) * 1000) / 1000,
    returned: Math.round(items.reduce((s, a) => s + a.returned, 0) * 1000) / 1000,
    balance: Math.round(items.reduce((s, a) => s + a.balance, 0) * 1000) / 1000,
  };
  return ok({ accounts: items, totals });
}

/** POST (مدير): إنشاء فئة/عهدة — يمنع إنشاء ابن لأب ليس advance */
export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = String(body.name || "").trim();
    if (!name) return jsonError("اسم الحساب مطلوب");
    const parentId = body.parentId ? intOr(body.parentId, 0) : 0;
    const isActive = body.isActive === undefined ? true : Boolean(body.isActive);
    const sortOrder = body.sortOrder !== undefined ? intOr(body.sortOrder, 0) : 0;

    let parent: { id: number; name: string; fullPath: string } | null = null;
    if (parentId) {
      const p = await db.expenseAccount.findUnique({ where: { id: parentId } });
      if (!p) return jsonError("حساب الأب غير موجود", 404);
      if (p.accountKind !== "advance") return jsonError("حساب الأب يجب أن يكون حساب عهدة (accountKind=advance)");
      parent = p;
    }
    const dup = await db.expenseAccount.findFirst({
      where: { name, accountKind: "advance", parentId: parent ? parent.id : null },
    });
    if (dup) return jsonError("يوجد حساب بنفس الاسم في نفس المستوى");

    const created = await db.expenseAccount.create({
      data: {
        name,
        fullPath: parent && parent.fullPath ? `${parent.fullPath} / ${name}` : name,
        parentId: parent ? parent.id : null,
        accountKind: "advance",
        isActive,
        sortOrder,
        includeInProfitability: false, // العهدة ليست مصروفًا — ذمة نقدية
      },
    });
    return ok(
      {
        account: {
          id: created.id,
          name: created.name,
          fullPath: created.fullPath,
          parentId: created.parentId,
          accountKind: created.accountKind,
          isActive: created.isActive,
        },
      },
      201
    );
  } catch (e) {
    return err(e);
  }
}

/** PATCH (مدير): تعديل اسم/الأب/التفعيل/الترتيب — مع منع الحلقات وتحديث المسار الكامل للفرع */
export async function PATCH(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = intOr(body.id, 0);
    if (!id) return jsonError("معرف الحساب مطلوب");
    const acc = await db.expenseAccount.findUnique({ where: { id } });
    if (!acc) return jsonError("حساب العهدة غير موجود", 404);
    if (acc.accountKind !== "advance") return jsonError("هذا الحساب ليس حساب عهدة");

    const data: Prisma.ExpenseAccountUpdateInput = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return jsonError("اسم الحساب مطلوب");
      const dup = await db.expenseAccount.findFirst({
        where: { name, accountKind: "advance", parentId: acc.parentId, id: { not: id } },
      });
      if (dup) return jsonError("يوجد حساب بنفس الاسم في نفس المستوى");
      data.name = name;
    }

    let parentPath = "";
    if (acc.parentId) {
      const currentParent = await db.expenseAccount.findUnique({ where: { id: acc.parentId } });
      parentPath = currentParent?.fullPath || "";
    }
    if (body.parentId !== undefined) {
      const parentId = body.parentId ? intOr(body.parentId, 0) : 0;
      if (parentId === id) return jsonError("لا يمكن ربط الحساب بنفسه");
      if (parentId) {
        const p = await db.expenseAccount.findUnique({ where: { id: parentId } });
        if (!p) return jsonError("حساب الأب غير موجود", 404);
        if (p.accountKind !== "advance") return jsonError("حساب الأب يجب أن يكون حساب عهدة (accountKind=advance)");
        // منع الحلقة: الصعود من الأب الجديد يجب ألا يصل إلى الحساب نفسه
        let cursor = p.parentId;
        const seen = new Set<number>();
        while (cursor && !seen.has(cursor)) {
          if (cursor === id) return jsonError("لا يمكن ربط الحساب بأحد أبنائه");
          seen.add(cursor);
          const up = await db.expenseAccount.findUnique({ where: { id: cursor }, select: { parentId: true } });
          cursor = up?.parentId ?? null;
        }
        data.parent = { connect: { id: p.id } };
        parentPath = p.fullPath;
      } else {
        data.parent = { disconnect: true };
        parentPath = "";
      }
    }

    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (body.sortOrder !== undefined) data.sortOrder = intOr(body.sortOrder, 0);

    const updated = await db.$transaction(async (tx) => {
      const newName = (data.name as string) || acc.name;
      const fullPath = parentPath ? `${parentPath} / ${newName}` : newName;
      const row = await tx.expenseAccount.update({
        where: { id },
        data: { ...data, fullPath },
      });
      // تحديث مسار الأبناء (فرع advance فقط)
      const updateChildren = async (pid: number, parentFullPath: string) => {
        const children = await tx.expenseAccount.findMany({ where: { parentId: pid, accountKind: "advance" } });
        for (const ch of children) {
          const childPath = `${parentFullPath} / ${ch.name}`;
          await tx.expenseAccount.update({ where: { id: ch.id }, data: { fullPath: childPath } });
          await updateChildren(ch.id, childPath);
        }
      };
      await updateChildren(id, fullPath);
      return row;
    });

    return ok({
      account: {
        id: updated.id,
        name: updated.name,
        fullPath: updated.fullPath,
        parentId: updated.parentId,
        isActive: updated.isActive,
      },
    });
  } catch (e) {
    return err(e);
  }
}
