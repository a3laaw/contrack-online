import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";

type P = { params: Promise<{ id: string }> };

/** أنواع أحداث حركة المراحل — نفس أنواع حدث المراحل في المسارات القائمة */
const STAGE_EVENT_TYPES = ["إنهاء مرحلة", "تخطي مرحلة", "إرجاع مرحلة", "إعادة فتح مرحلة"];

/** سجل المراحل: آخر 10 حركات (إنهاء/تخطي/إرجاع/إعادة فتح) — الأحدث أولًا */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const events = await db.contractEvent.findMany({
    where: { contractId, eventType: { in: STAGE_EVENT_TYPES } },
    orderBy: { id: "desc" },
    take: 10,
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
