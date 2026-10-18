import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok, todayStr } from "@/lib/api-utils";
import {
  CLAIM_NEXT,
  CLAIM_STATUS_LABEL,
  claimTransitionAllowed,
} from "@/lib/claim-server";

type P = { params: Promise<{ id: string }> };

/**
 * ترحيل حالة المطالبة (آلة الانتقالات حرفيًا):
 * out: registered→sent→approved→collected · in: registered→in_review→approved→paid
 * refused (من أي غير نهائية، يتطلب سببًا) · postponed (يتطلب postponedUntil) · cancelled.
 * كل انتقال يكتب سطرًا في notes «[تاريخ] انتقال من X إلى Y بواسطة Z — سبب» + تدقيق.
 * لا أثر مالي: collected للـout لا ينشئ سندًا، وapproved للـin لا يحرك شيئًا.
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_claim_manage");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const next = String(body.next || "").trim();
  const reason = String(body.reason || body.note || "").trim();
  if (!next) return jsonError("الحالة التالية مطلوبة");

  const c = await db.claim.findUnique({ where: { id } });
  if (!c) return jsonError("المطالبة غير موجودة", 404);

  const fromLabel = CLAIM_STATUS_LABEL[c.status] || c.status;
  const toLabel = CLAIM_STATUS_LABEL[next] || next;
  if (!claimTransitionAllowed(c.direction, c.status, next)) {
    return jsonError(`لا يمكن الانتقال من ${fromLabel} إلى ${toLabel}`);
  }

  if (next === "refused" && !reason) return jsonError("سبب الرفض مطلوب");
  let postponeDate = "";
  if (next === "postponed") {
    postponeDate = String(body.postponedUntil || "").trim();
    if (!postponeDate) return jsonError("التأجيل يتطلب تاريخًا");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(postponeDate)) return jsonError("تاريخ التأجيل غير صحيح");
  }

  const today = todayStr();
  const who = guard.user.fullName || guard.user.username;
  const entry =
    `[${today}] انتقال من ${fromLabel} إلى ${toLabel} بواسطة ${who}` +
    (reason ? ` — ${reason}` : "") +
    (postponeDate ? ` — مؤجلة حتى ${postponeDate}` : "");
  const notes = ((c.notes || "").trim() + "\n" + entry).trim();

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.claim.update({
      where: { id },
      data: {
        status: next,
        notes,
        postponedUntil: next === "postponed" ? postponeDate : "",
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "ترحيل حالة",
      entityType: "claim",
      entityId: id,
      entityName: c.claimNumber,
      oldStatus: c.status,
      newStatus: next,
      reason,
    });
    return row;
  });

  return ok({
    claim: {
      id: updated.id,
      claimNumber: updated.claimNumber,
      status: updated.status,
      statusLabel: CLAIM_STATUS_LABEL[updated.status] || updated.status,
      postponedUntil: updated.postponedUntil,
      nextStatuses: (CLAIM_NEXT[updated.direction]?.[updated.status] || []).map((s) => ({
        value: s,
        label: CLAIM_STATUS_LABEL[s] || s,
      })),
    },
  });
}
