import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { adminGuard, authGuard, jsonError, ok } from "@/lib/api-utils";
import { intOr } from "@/lib/contrack-server";
import { VoucherError } from "@/lib/voucher-server";
import { custodyBreakdown } from "@/lib/custody-server";

/**
 * حسابات العُهد على الدليل الموحد (Task 105 — Account.accountRole='custody'):
 * عقدة ثابتة «عُهد وسلف الموظفين» (كود 1140) وأبناؤها أوراق تقبل القيد.
 * لا نقل بين الآباء — بنية الدليل ثابتة. لكل حساب: الرصيد = مُسلَّم − مُنفَق − مرتجع.
 */

const CUSTODY_PARENT_CODE = "1140";

function err(e: unknown) {
  if (e instanceof VoucherError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return jsonError("حدث خطأ غير متوقع", 500);
}

/** جذر العهد 1140 — تحويله لفرع (لا يقبل قيدًا) عند أول حاجة؛ null إن غاب عن الدليل */
async function ensureCustodyParent(tx?: Prisma.TransactionClient) {
  const client = tx ?? db;
  const parent = await client.account.findFirst({ where: { code: CUSTODY_PARENT_CODE } });
  if (!parent) return null;
  if (parent.isLeaf || parent.allowPosting) {
    return client.account.update({
      where: { id: parent.id },
      data: { isLeaf: false, allowPosting: false },
    });
  }
  return parent;
}

/** أول كود متاح تحت 1140: 114001 صعودًا (فحص أكواد أبناء 1140 الموجودة) */
async function nextCustodyCode(parentId: number): Promise<string> {
  const children = await db.account.findMany({ where: { parentId }, select: { code: true } });
  const taken = new Set(children.map((c) => c.code));
  let seq = 1;
  while (taken.has(`${CUSTODY_PARENT_CODE}${String(seq).padStart(3, "0")}`)) seq += 1;
  return `${CUSTODY_PARENT_CODE}${String(seq).padStart(3, "0")}`;
}

/** GET: كل حسابات العُهد مع الأرصدة المحسوبة لحظيًا + الإجمالي */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_custody");
  if ("response" in guard) return guard.response;

  const accounts = await db.account.findMany({
    where: { accountRole: "custody" },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  const parentIds = [...new Set(accounts.map((a) => a.parentId).filter((x): x is number => x != null))];
  const parents = parentIds.length
    ? await db.account.findMany({ where: { id: { in: parentIds } }, select: { id: true, name: true } })
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
    const parentName = acc.parentId ? parentNames.get(acc.parentId) || "" : "";
    items.push({
      id: acc.id,
      name: acc.name,
      // الحسابات custody أوراق مباشرة تحت 1140 — fullPath للعرض فقط (بلا عمود في القاعدة)
      fullPath: parentName ? `${parentName} / ${acc.name}` : acc.name,
      parentId: acc.parentId,
      parentName,
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

/** POST (مدير): إنشاء عهدة جديدة — دائمًا ابنًا لعقدة 1140 (الدليل ثابت البنية) */
export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = String(body.name || "").trim();
    if (!name) return jsonError("اسم الحساب مطلوب");
    const isActive = body.isActive === undefined ? true : Boolean(body.isActive);

    const parent = await ensureCustodyParent();
    if (!parent) return jsonError("حساب العهد 1140 غير موجود في دليل الشركة", 404);

    const dup = await db.account.findFirst({
      where: { name, accountRole: "custody", parentId: parent.id },
    });
    if (dup) return jsonError("يوجد حساب بنفس الاسم في نفس المستوى");

    const created = await db.account.create({
      data: {
        code: await nextCustodyCode(parent.id),
        name,
        type: "asset",
        nature: "debit",
        parentId: parent.id,
        isLeaf: true,
        allowPosting: true,
        isActive,
        isSystem: false,
        accountRole: "custody",
        includeInProfitability: false, // العهدة ليست مصروفًا — ذمة نقدية
        xbrlElement: "kw:EmployeeAdvancesReceivable",
        notes: "حساب عهدة موظفين — أنشئ من شاشة العُهد",
      },
    });
    return ok(
      {
        account: {
          id: created.id,
          name: created.name,
          code: created.code,
          fullPath: name,
          parentId: created.parentId,
          accountRole: created.accountRole,
          isActive: created.isActive,
        },
      },
      201
    );
  } catch (e) {
    return err(e);
  }
}

/** PATCH (مدير): تعديل الاسم/التفعيل فقط — النقل بين الآباء انتهى (الدليل ثابت البنية) */
export async function PATCH(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = intOr(body.id, 0);
    if (!id) return jsonError("معرف الحساب مطلوب");
    const acc = await db.account.findUnique({ where: { id } });
    if (!acc) return jsonError("حساب العهدة غير موجود", 404);
    if (acc.accountRole !== "custody") return jsonError("هذا الحساب ليس حساب عهدة");

    const data: Prisma.AccountUpdateInput = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return jsonError("اسم الحساب مطلوب");
      const dup = await db.account.findFirst({
        where: { name, accountRole: "custody", id: { not: id } },
      });
      if (dup) return jsonError("يوجد حساب بنفس الاسم في نفس المستوى");
      data.name = name;
    }
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

    const updated = await db.account.update({ where: { id }, data });

    // إعادة بناء fullPath للعرض (بلا عمود في القاعدة)
    const parent = updated.parentId
      ? await db.account.findUnique({ where: { id: updated.parentId }, select: { name: true } })
      : null;
    const parentName = parent?.name || "";

    return ok({
      account: {
        id: updated.id,
        name: updated.name,
        fullPath: parentName ? `${parentName} / ${updated.name}` : updated.name,
        parentId: updated.parentId,
        isActive: updated.isActive,
      },
    });
  } catch (e) {
    return err(e);
  }
}
