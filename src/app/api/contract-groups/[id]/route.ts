import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { buildGroupsResponse, loadGroupContracts } from "@/lib/contract-groups-server";

type P = { params: Promise<{ id: string }> };

/** تفاصيل مجموعة: الترويسة + عقودها بترتيب id + الملخص المالي (مرآة group_contracts) */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف غير صالح");

  const summaries = await buildGroupsResponse({ ids: [id] });
  const group = summaries[0];
  if (!group) return jsonError("المجموعة غير موجودة", 404);

  const contracts = await loadGroupContracts(id);
  return ok({ group, contracts, totals: group.totals });
}

/** حذف مجموعة — إضافة ويب أمانًا (غير موجودة في المكتبي): لا تلمس العقود نفسها إطلاقًا */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف غير صالح");

  const group = await db.contractGroup.findUnique({ where: { id } });
  if (!group) return jsonError("المجموعة غير موجودة", 404);

  await db.$transaction(async (tx) => {
    await tx.contractGroup.delete({ where: { id } });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف مجموعة عقود",
      entityType: "contract_group",
      entityId: group.id,
      entityName: `${group.groupNumber} — ${group.groupName}`,
    });
  });

  return ok({ ok: true, id });
}
