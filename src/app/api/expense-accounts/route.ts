import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import {
  EXPENSE_ACCOUNT_KINDS,
  ensureExpenseAccountDefaults,
  orderExpenseAccounts,
  refreshExpenseAccountPaths,
  serializeExpenseAccount,
} from "@/lib/expense-accounts-server";

/**
 * شجرة حسابات المصروفات — GET للقائمة (سند الصرف/العُهد) وPOST للإضافة (مدير).
 * مقابلة expense_account_service.py (list_accounts / add_account).
 */

/** GET /api/expense-accounts?all=1|activeOnly=0&postingOnly=1 — مصفوفة مباشرة مرتبة كما في المكتبي */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const all = sp.get("all") === "1";
  const activeOnly = all ? false : sp.get("activeOnly") !== "0";
  const postingOnly = sp.get("postingOnly") === "1";

  await ensureExpenseAccountDefaults();

  const rows = await db.expenseAccount.findMany({
    where: {
      ...(activeOnly ? { isActive: true } : {}),
      ...(postingOnly ? { allowPosting: true } : {}),
    },
  });

  return ok(orderExpenseAccounts(rows).map(serializeExpenseAccount));
}

/** POST /api/expense-accounts — إضافة حساب أب أو ابن (الشجرة مستويان فقط) */
export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const name = String(body.name ?? "").trim();
  if (!name) return jsonError("اسم الحساب مطلوب.");

  const parentId =
    body.parentId === undefined || body.parentId === null || body.parentId === "" || Number(body.parentId) === 0
      ? null
      : Number(body.parentId);
  if (parentId !== null && !Number.isFinite(parentId)) return jsonError("الحساب الأب غير موجود.", 404);

  const accountKind = body.accountKind !== undefined ? String(body.accountKind) : "expense";
  if (!(EXPENSE_ACCOUNT_KINDS as readonly string[]).includes(accountKind)) {
    return jsonError("نوع الحساب غير صحيح — اختر من القائمة.");
  }

  const allowPosting = body.allowPosting !== undefined ? Boolean(body.allowPosting) : true;
  const includeInProfitability =
    body.includeInProfitability !== undefined ? Boolean(body.includeInProfitability) : true;

  let parentFullPath = "";
  if (parentId !== null) {
    const parent = await db.expenseAccount.findUnique({ where: { id: parentId } });
    if (!parent) return jsonError("الحساب الأب غير موجود.", 404);
    if (parent.parentId) {
      return jsonError("الشجرة مستويان فقط: أب ثم ابن. لا يمكن إضافة ابن تحت ابن.");
    }
    parentFullPath = parent.fullPath || parent.name;
  }

  // يوجد حساب بنفس الاسم تحت نفس الأب (كـ COALESCE(parent_id,0)=COALESCE(?,0) في المصدر)
  const duplicate = await db.expenseAccount.findFirst({ where: { parentId, name } });
  if (duplicate) return jsonError("يوجد حساب بنفس الاسم تحت نفس الأب.");

  const created = await db.$transaction(async (tx) => {
    const row = await tx.expenseAccount.create({
      data: {
        name,
        parentId,
        isActive: true,
        allowPosting,
        includeInProfitability,
        accountKind,
        sortOrder: 0,
        fullPath: parentId !== null ? `${parentFullPath} / ${name}` : name,
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "إضافة حساب مصروف",
      entityType: "expense_account",
      entityId: row.id,
      entityName: row.fullPath || row.name,
    });
    return row;
  });

  await refreshExpenseAccountPaths();
  const fresh = await db.expenseAccount.findUnique({ where: { id: created.id } });

  return ok({ account: fresh ? serializeExpenseAccount(fresh) : serializeExpenseAccount(created) }, 201);
}
