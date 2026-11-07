// ============================================================
// POST /api/dev/requests/[id]/reject — رفض طلب انضمام بسبب موثق (Task 115)
// ============================================================
import { NextRequest } from "next/server";
import { db, sysDb } from "@/lib/db";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";

type P = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  if (guard.user.role !== "developer") {
    return jsonError("رفض طلبات الانضمام للمطور فقط", 403);
  }
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  const reason = String(body.reason || "").trim();
  if (reason.length < 3) return jsonError("سبب الرفض مطلوب (3 أحرف على الأقل) — يُوثق في السجل");

  const request = await sysDb.registrationRequest.findUnique({ where: { id } });
  if (!request) return jsonError("الطلب غير موجود", 404);
  if (request.status !== "pending") return jsonError("تمت معالجة هذا الطلب مسبقًا");

  await sysDb.registrationRequest.update({
    where: { id: request.id },
    data: {
      status: "rejected",
      rejectionReason: reason,
      processedBy: guard.user.username,
      processedAt: new Date(),
    },
  });
  await audit(db, {
    username: guard.user.username,
    action: "رفض",
    entityType: "registration_request",
    entityId: request.id,
    entityName: request.companyName,
    oldStatus: "pending",
    newStatus: "rejected",
    reason,
  });

  return ok({ message: "تم رفض الطلب وتوثيق السبب" });
}
