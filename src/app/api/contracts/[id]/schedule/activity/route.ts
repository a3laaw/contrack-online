import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok } from "@/lib/api-utils";

type P = { params: Promise<{ id: string }> };

/**
 * PATCH /api/contracts/[id]/schedule/activity — الربط المباشر نشطة→بند (ب3 §13.2).
 *  • حرس action_edit_contract (نمط PATCH boq حرفيًا) — كتابة واحدة محصورة بعمود
 *    boqItemId القائم منذ بطاقة §13 — لا جداول جديدة ولا مسارات أخرى.
 *  • null = فك الربط — تحقق ملكية مزدوج: النشطة للعقد · البند للعقد وغير محذوف.
 *  • الربط يدوي معلن لا افتراضي — المطابقة القسمية ب1 تبقى أساس غير المربوط.
 */
export async function PATCH(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  let body: { activityId?: unknown; boqItemId?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError("جسم الطلب غير صالح");
  }
  const activityId = Number(body.activityId);
  if (!Number.isFinite(activityId)) return jsonError("معرف النشطة مطلوب");
  // boqItemId: رقم صحيح موجب أو null صريح (فك الربط) — الغائب لا يُقبل لبسًا
  const rawItem = body.boqItemId;
  const boqItemId = rawItem === null ? null : Number(rawItem);
  if (boqItemId !== null && (!Number.isInteger(boqItemId) || boqItemId <= 0)) {
    return jsonError("معرف البند غير صالح — رقم أو null");
  }

  const activity = await db.scheduleActivity.findUnique({
    where: { id: activityId },
    select: { id: true, contractId: true, name: true, activityCode: true },
  });
  if (!activity || activity.contractId !== contractId) return jsonError("النشطة غير موجودة على هذا العقد", 404);

  if (boqItemId !== null) {
    const item = await db.boqItem.findUnique({
      where: { id: boqItemId },
      select: { id: true, contractId: true, deleted: true, itemNo: true },
    });
    if (!item || item.contractId !== contractId) return jsonError("البند غير موجود على هذا العقد", 404);
    if (item.deleted) return jsonError("البند محذوف — لا يُربط بنشطة", 400);
  }

  const updated = await db.scheduleActivity.update({
    where: { id: activityId },
    data: { boqItemId },
    select: { id: true, boqItemId: true },
  });

  return ok({
    id: updated.id,
    boqItemId: updated.boqItemId,
    message: boqItemId === null ? `فُك ربط النشطة ${activity.activityCode}` : `رُبطت النشطة ${activity.activityCode} بالبند`,
  });
}
