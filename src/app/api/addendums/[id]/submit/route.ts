import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { todayStr } from "@/lib/contrack-core";

type P = { params: Promise<{ id: string }> };

/** إرسال الملحق للمراجعة: مسودة ⇒ تحت المراجعة */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const a = await db.addendum.findUnique({ where: { id } });
  if (!a) return jsonError("الملحق غير موجود", 404);
  if (a.status !== "مسودة") return jsonError("يمكن الإرسال من المسودة فقط");
  if (a.appliedAt) return jsonError("تم تنفيذ هذا الملحق مسبقًا");

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.addendum.update({ where: { id }, data: { status: "تحت المراجعة" } });
    await tx.contractEvent.create({
      data: {
        contractId: a.contractId,
        eventType: "إرسال ملحق للمراجعة",
        description: `${a.addendumNumber} · المسودة ⇒ تحت المراجعة`,
        username: guard.user.username,
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "إرسال للمراجعة",
      entityType: "addendum",
      entityId: id,
      entityName: a.addendumNumber,
      oldStatus: "مسودة",
      newStatus: "تحت المراجعة",
    });
    return row;
  });

  return ok({
    addendum: { id: updated.id, addendumNumber: updated.addendumNumber, status: updated.status },
    submittedAt: todayStr(),
  });
}
