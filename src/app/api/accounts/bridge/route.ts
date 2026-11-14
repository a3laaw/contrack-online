import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { suggestBridgeLinks } from "@/lib/accounting-core";

/**
 * جسر الهجرة: شجرة حسابات المصروفات القديمة ↔ دليل الحسابات الجديد — Task 102.
 * GET: كل حسابات المصروفات مع الحساب الموصول حاليًا والمقترح آليًا (مطابقة الاسم/المسار).
 * POST: تطبيق الروابط بعد مراجعة المستخدم — تحديث expenseAccount.accountId.
 */

export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const [expenseAccounts, accounts] = await Promise.all([
    db.expenseAccount.findMany({
      orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
    }),
    db.account.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, type: true, isLeaf: true, isActive: true },
    }),
  ]);

  const suggestions = suggestBridgeLinks(
    expenseAccounts.map((ea) => ({ id: ea.id, name: ea.name, fullPath: ea.fullPath, accountKind: ea.accountKind })),
    accounts
  );
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const rows = expenseAccounts.map((ea) => {
    const linked = ea.accountId != null ? byId.get(ea.accountId) : undefined;
    const sug = suggestions.find((s) => s.expenseAccountId === ea.id);
    return {
      id: ea.id,
      name: ea.name,
      fullPath: ea.fullPath,
      accountKind: ea.accountKind,
      isActive: ea.isActive,
      accountId: ea.accountId,
      linkedLabel: linked ? `${linked.code} — ${linked.name}` : null,
      suggestedId: sug?.suggestedId ?? null,
      suggestedLabel: sug?.suggestedName ?? null,
    };
  });

  return ok({ rows });
}

export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_chart_of_accounts");
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as { links?: { expenseAccountId: number; accountId: number | null }[] };
  const links = Array.isArray(body.links) ? body.links : [];
  if (!links.length) return jsonError("لا روابط لحفظها.");

  const leaves = await db.account.findMany({
    where: { isLeaf: true, isActive: true },
    select: { id: true, code: true, name: true },
  });
  const leafIds = new Set(leaves.map((a) => a.id));

  const expenseIds = links.map((l) => Number(l.expenseAccountId)).filter((n) => Number.isFinite(n));
  const expenses = await db.expenseAccount.findMany({ where: { id: { in: expenseIds } }, select: { id: true } });
  const expenseSet = new Set(expenses.map((e) => e.id));

  // التحقق كاملًا قبل المعاملة — رفض واحد يوقف الكل
  for (const link of links) {
    const accId = link.accountId == null ? null : Number(link.accountId);
    if (accId !== null && !leafIds.has(accId)) {
      return jsonError(`الحساب المحدد لربط واحد ليس ورقة نشطة في الدليل.`);
    }
    if (!expenseSet.has(Number(link.expenseAccountId))) {
      return jsonError("أحد حسابات المصروفات المرسلة غير موجود.");
    }
  }

  let applied = 0;
  // مهلة مرفوعة: كل استعلام عبر الـpooler يكلف مئات المللي ثانية، والتحديثات تسلسلية
  await db.$transaction(
    async (tx) => {
      for (const link of links) {
        const accId = link.accountId == null ? null : Number(link.accountId);
        await tx.expenseAccount.update({
          where: { id: Number(link.expenseAccountId) },
          data: { accountId: accId },
        });
        applied += 1;
      }
      await audit(tx, {
        username: guard.user.username,
        action: "ربط حسابات المصروفات بدليل الحسابات",
        entityType: "account_bridge",
        entityId: applied,
        entityName: `تطبيق ${applied} رابطًا`,
        newStatus: `linked:${applied}`,
      });
    },
    { timeout: 60_000, maxWait: 10_000 }
  );

  return ok({ applied });
}
