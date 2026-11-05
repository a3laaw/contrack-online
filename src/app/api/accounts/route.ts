import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { ensureChartOfAccounts } from "@/lib/accounting-server";
import { ACCOUNT_TYPES, checkAccountMutation } from "@/lib/accounting-core";

/**
 * دليل الحسابات — Task 102.
 * GET: الشجرة كاملة للشركة الحالية (يُبذر القياسي تلقائيًا عند أول قراءة).
 * POST: إضافة حساب (مدير) — قواعد الشجرة عبر checkAccountMutation.
 */

export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const seed = await ensureChartOfAccounts();
  const rows = await db.account.findMany({
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      nature: true,
      parentId: true,
      isLeaf: true,
      allowPosting: true,
      isActive: true,
      isSystem: true,
      accountRole: true,
      includeInProfitability: true,
      openingBalance: true,
      notes: true,
      sortOrder: true,
      xbrlElement: true,
    },
  });

  return ok({
    accounts: rows.map((r) => ({ ...r, openingBalance: Number(r.openingBalance) })),
    seeded: seed.seeded,
  });
}

export async function POST(req: NextRequest) {
  // باب الصلاحية الموحد — صاحب العمل (سكرتير هنا) يدير الدليل، والمدير/المطور دائمًا
  const guard = await authGuard(req, "screen_chart_of_accounts");
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const parentId =
    body.parentId === undefined || body.parentId === null || body.parentId === "" || Number(body.parentId) === 0
      ? null
      : Number(body.parentId);
  if (parentId !== null && !Number.isFinite(parentId)) return jsonError("الحساب الأب غير موجود.", 404);

  let parentType: (typeof ACCOUNT_TYPES)[number] | null = null;
  if (parentId !== null) {
    const parent = await db.account.findUnique({ where: { id: parentId } });
    if (!parent) return jsonError("الحساب الأب غير موجود.", 404);
    parentType = parent.type as (typeof ACCOUNT_TYPES)[number];
  }

  const check = checkAccountMutation(
    {
      code: body.code,
      name: body.name,
      type: body.type,
      nature: body.nature,
      parentType,
      isSystem: false,
    },
    undefined
  );
  if (!check.ok || !check.code || !check.name || !check.type || !check.nature) {
    return jsonError(check.error ?? "بيانات غير صحيحة.");
  }

  const duplicate = await db.account.findFirst({ where: { code: check.code } });
  if (duplicate) return jsonError("يوجد حساب بنفس الكود في دليل الشركة.");

  const created = await db.$transaction(async (tx) => {
    const row = await tx.account.create({
      data: {
        code: check.code!,
        name: check.name!,
        type: check.type!,
        nature: check.nature!,
        parentId,
        isLeaf: true,
        allowPosting: true,
        isActive: true,
        isSystem: false,
        notes: String(body.notes ?? ""),
        xbrlElement: String(body.xbrlElement ?? "").trim(),
      },
    });
    if (parentId !== null) {
      // الأب الذي استقبل ابنًا لم يعد ورقة — يُغلق نشره
      await tx.account.update({
        where: { id: parentId },
        data: { isLeaf: false, allowPosting: false },
      });
    }
    await audit(tx, {
      username: guard.user.username,
      action: "إضافة حساب محاسبي",
      entityType: "account",
      entityId: row.id,
      entityName: `${row.code} — ${row.name}`,
      newStatus: `${row.type}/${row.nature}`,
    });
    return row;
  }, { timeout: 30_000, maxWait: 10_000 });

  return ok(
    {
      account: {
        ...created,
        openingBalance: Number(created.openingBalance),
      },
    },
    201
  );
}
