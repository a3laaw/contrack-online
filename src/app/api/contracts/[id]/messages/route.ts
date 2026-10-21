import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { NOTIF_MESSAGE, notifyTransaction } from "@/lib/notification-server";

type P = { params: Promise<{ id: string }> };

/**
 * محادثة المعاملة — شات FollowupPanel المكتبي.
 * GET: الرسائل كلها تصاعديًا (حتى 200).
 * POST: {body} — الكاتب من الجلسة.
 */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const messages = await db.txMessage.findMany({
    where: { contractId },
    orderBy: { id: "asc" },
    take: 200,
  });
  return ok({
    messages: messages.map((m) => ({
      id: m.id,
      username: m.username,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
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
  const text = String(body.body ?? "").trim();
  if (!text) return jsonError("اكتب الرسالة أولًا.");

  const created = await db.txMessage.create({
    data: { contractId, username: guard.user.username, body: text },
  });
  // G3 — إشعار رسالة جديدة لكل مستهدف (مديرون/مشاركون لاحقًا) بلا الكاتب نفسه
  try {
    await notifyTransaction({
      transactionType: "contract",
      transactionId: contractId,
      type: NOTIF_MESSAGE,
      text: `${guard.user.fullName || guard.user.username}: ${text.slice(0, 120)}`,
      excludeUserId: guard.user.id,
    });
  } catch {
    /* الإشعار لا يعطل الرسالة */
  }
  return ok(
    {
      message: {
        id: created.id,
        username: created.username,
        body: created.body,
        createdAt: created.createdAt.toISOString(),
      },
    },
    201
  );
}
