import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";

type P = { params: Promise<{ id: string }> };

/** آخر 100 حدث على العقد */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const events = await db.contractEvent.findMany({
    where: { contractId },
    orderBy: { id: "desc" },
    take: 100,
  });
  return ok({
    events: events.map((e) => ({
      id: e.id,
      eventTime: e.eventTime.toISOString(),
      eventType: e.eventType,
      description: e.description,
      username: e.username,
    })),
  });
}

/** حدث يدوي: {eventType, description} */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const eventType = String(body.eventType || "يدوي").trim() || "يدوي";
  const description = String(body.description || "").trim();
  if (!description) return jsonError("وصف الحدث مطلوب");

  const event = await db.contractEvent.create({
    data: { contractId, eventType, description, username: guard.user.username },
  });
  return ok(
    { event: { id: event.id, eventTime: event.eventTime.toISOString(), eventType, description, username: event.username } },
    201
  );
}
