import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import {
  dedupeContractIds,
  nextGroupNumber,
  validateGroupContracts,
} from "@/lib/contract-groups-core";
import { buildGroupsResponse } from "@/lib/contract-groups-server";

/** قائمة المجموعات بملخصها المالي — فلاتر customerId / contractId (مرآة list_groups) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;

  const customerId = Number(req.nextUrl.searchParams.get("customerId") || 0);
  const contractId = Number(req.nextUrl.searchParams.get("contractId") || 0);

  // فلترة بعقد معين: المجموعات الحاوية لهذا العقد ضمن عناصرها
  let ids: number[] | undefined;
  if (Number.isFinite(contractId) && contractId > 0) {
    const items = await db.contractGroupItem.findMany({
      where: { contractId },
      select: { groupId: true },
    });
    ids = [...new Set(items.map((i) => i.groupId))];
    if (ids.length === 0) return ok({ groups: [] });
  }

  const groups = await buildGroupsResponse({
    ids,
    customerId: Number.isFinite(customerId) && customerId > 0 ? customerId : undefined,
  });
  return ok({ groups });
}

/** إنشاء مجموعة — مرآة create_group: تحقق ثم GRP-%04d مع إعادة محاولة 8× عند تضارب UNIQUE */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "action_add_contract");
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const groupName = String(body.groupName || "").trim();
  if (!groupName) return jsonError("اسم المجموعة مطلوب.", 400);
  const customerId = Number(body.customerId || 0);
  if (!Number.isFinite(customerId) || customerId <= 0) return jsonError("اختر العميل أولًا.", 400);

  const ids = dedupeContractIds(
    Array.isArray(body.contractIds) ? (body.contractIds as Array<number | null | undefined>) : []
  );

  // تحقق المكتبي حرفيًا: عقدين على الأقل · موجودون · نفس العميل · لا ملغى
  const rows = ids.length
    ? await db.contract.findMany({
        where: { id: { in: ids } },
        select: { id: true, customerId: true, status: true },
      })
    : [];
  try {
    validateGroupContracts({
      ids,
      customerIds: rows.map((r) => r.customerId),
      statuses: rows.map((r) => r.status),
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "تعذر التحقق من العقود.", 400);
  }

  const notes = String(body.notes || "");
  let created: { id: number; groupNumber: string } | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      created = await db.$transaction(async (tx) => {
        const last = await tx.contractGroup.findFirst({ orderBy: { groupNumber: "desc" } });
        const groupNumber = nextGroupNumber(last?.groupNumber);
        const group = await tx.contractGroup.create({
          data: {
            groupNumber,
            customerId,
            groupName,
            notes,
            createdBy: guard.user.username,
          },
        });
        if (ids.length > 0) {
          await tx.contractGroupItem.createMany({
            data: ids.map((contractId) => ({ groupId: group.id, contractId })),
            skipDuplicates: true,
          });
        }
        await audit(tx, {
          username: guard.user.username,
          action: "إنشاء مجموعة عقود",
          entityType: "contract_group",
          entityId: group.id,
          entityName: `${groupNumber} — ${groupName}`,
        });
        return group;
      });
      break;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 7) {
        lastError = e; // تضارب رقم المجموعة — أعِد التوليد (كالمكتبي حتى 8 محاولات)
        continue;
      }
      lastError = e;
      break;
    }
  }
  if (!created) {
    console.error("فشل إنشاء مجموعة عقود:", lastError);
    return jsonError("تعذر إنشاء رقم مجموعة غير مكرر.", 500);
  }
  return ok({ group: { id: created.id, groupNumber: created.groupNumber, groupName } }, 201);
}
