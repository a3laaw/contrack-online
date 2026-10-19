import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";

type P = { params: Promise<{ id: string }> };

/**
 * ملاحظات المرحلة (V5.9) — سبب التأخير / «واقفة فين» بلا تغيير المرحلة.
 * GET: آخر 50 ملاحظة للعقد (txType=contract) — الأحدث أولًا.
 * POST: {note, stageName?} — الكاتب من الجلسة + حدث «ملاحظة مرحلة» يظهر في سجل المراحل.
 */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const notes = await db.stageNote.findMany({
    where: { txType: "contract", txId: contractId },
    orderBy: { id: "desc" },
    take: 50,
  });
  return ok({
    notes: notes.map((n) => ({
      id: n.id,
      txType: n.txType,
      txId: n.txId,
      stageName: n.stageName,
      note: n.note,
      author: n.author,
      createdAt: n.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const note = String(body.note ?? "").trim();
  if (!note) return jsonError("اكتب الملاحظة أولًا.");
  const stageName = String(body.stageName ?? "").trim();

  const created = await db.$transaction(async (tx) => {
    const row = await tx.stageNote.create({
      data: {
        txType: "contract",
        txId: contractId,
        contractId,
        stageName,
        note,
        author: guard.user.username,
      },
    });
    await tx.contractEvent.create({
      data: {
        contractId,
        eventType: "ملاحظة مرحلة",
        description: `ملاحظة على «${stageName || "المعاملة"}»: ${note}`,
        username: guard.user.username,
      },
    });
    return row;
  });

  return ok(
    {
      note: {
        id: created.id,
        txType: created.txType,
        txId: created.txId,
        stageName: created.stageName,
        note: created.note,
        author: created.author,
        createdAt: created.createdAt.toISOString(),
      },
    },
    201
  );
}
