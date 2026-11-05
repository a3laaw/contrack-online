import { NextRequest } from "next/server";
import { adminGuard, jsonError, ok } from "@/lib/api-utils";
import { db, currentCompanyId } from "@/lib/db";
import { audit } from "@/lib/api-utils";

export const runtime = "nodejs";

/**
 * علم «شركة أجنبية الملكية» — Task 111 — POST /api/tax/company-flag {foreignOwned}
 * للمدير حصرًا — يفعّل/يعطّل وحدة ضريبة دخل الأجانب 15% + تدقيق.
 */
export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const companyId = await currentCompanyId();
  if (companyId == null) return jsonError("سياق الشركة مفقود.", 400);
  const body = (await req.json().catch(() => null)) as { foreignOwned?: boolean } | null;
  const flag = Boolean(body?.foreignOwned);
  const company = await db.company.findUnique({ where: { id: companyId }, select: { foreignOwned: true, name: true } });
  if (!company) return jsonError("الشركة غير موجودة.", 404);
  await db.$transaction(async (tx) => {
    await tx.company.update({ where: { id: companyId }, data: { foreignOwned: flag } });
    await audit(tx, {
      username: guard.user.username,
      action: flag ? "تفعيل وحدة ضريبة دخل الأجانب" : "تعطيل وحدة ضريبة دخل الأجانب",
      entityType: "company",
      entityId: companyId,
      entityName: company.name,
      oldStatus: company.foreignOwned ? "foreign_owned" : "local",
      newStatus: flag ? "foreign_owned" : "local",
    });
  });
  return ok({ foreignOwned: flag });
}
