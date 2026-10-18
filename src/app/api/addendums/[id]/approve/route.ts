import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminGuard, audit, jsonError, ok } from "@/lib/api-utils";
import { AddendumError, approveAddendumTx } from "@/lib/addendum-server";

type P = { params: Promise<{ id: string }> };

/**
 * اعتماد الملحق (مدير فقط) — من مسودة أو تحت المراجعة ⇒ معاملة واحدة apply_parts:
 * إنشاء/حذف البنود والدفعات وفك روابط المراحل + الحارسان الماليان + سقف الخطة
 * ثم status=معتمد + approvedDate + appliedAt + itemsCount + تدقيق وحدث عقد.
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  try {
    const result = await db.$transaction(async (tx) => {
      const res = await approveAddendumTx(tx, id, guard.user.username);
      await audit(tx, {
        username: guard.user.username,
        action: "اعتماد",
        entityType: "addendum",
        entityId: id,
        entityName: res.addendumNumber,
        oldStatus: "مسودة",
        newStatus: "معتمد",
      });
      return res;
    });
    return ok({
      approved: true,
      addendum: {
        id: result.id,
        addendumNumber: result.addendumNumber,
        status: result.status,
        itemsCount: result.appliedCount,
        clientAdd: result.clientAdd,
        clientDeduct: result.clientDeduct,
        net: result.clientNet,
      },
    });
  } catch (e) {
    if (e instanceof AddendumError) return jsonError(e.message, e.status);
    console.error(e);
    return jsonError("تعذر اعتماد الملحق", 500);
  }
}
