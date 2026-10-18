import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok, parseDay } from "@/lib/api-utils";

type P = { params: Promise<{ id: string }> };

/** إضافة مرحلة إلى نسخة العقد */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name || "").trim();
  if (!name) return jsonError("اسم المرحلة مطلوب");

  const max = await db.contractStage.aggregate({
    where: { contractId },
    _max: { sortOrder: true },
  });
  const sortOrder = body.sortOrder !== undefined ? Number(body.sortOrder) : (max._max.sortOrder ?? -1) + 1;

  const stage = await db.$transaction(async (tx) => {
    const created = await tx.contractStage.create({
      data: {
        contractId,
        name,
        level: Number.isFinite(Number(body.level)) ? Math.trunc(Number(body.level)) : 1,
        parentName: String(body.parentName || ""),
        expectedDays: Number.isFinite(Number(body.expectedDays)) ? Math.trunc(Number(body.expectedDays)) : 0,
        payPct: Number(body.payPct) || 0,
        payKind: String(body.payKind || ""),
        sortOrder,
      },
    });
    await tx.contractEvent.create({
      data: {
        contractId,
        eventType: "إضافة مرحلة",
        description: `أُضيفت مرحلة «${name}»`,
        username: guard.user.username,
      },
    });
    return created;
  });
  return ok({ stage }, 201);
}

/** مراحل العقد (قائمة) */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const stages = await db.contractStage.findMany({
    where: { contractId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  return ok({ stages });
}
