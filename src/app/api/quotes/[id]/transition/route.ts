import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import {
  isQuotationStatus,
  QUOTATION_INVALID_STATUS,
} from "@/lib/quotes-core";

type P = { params: Promise<{ id: string }> };

/**
 * انتقال حالة عرض السعر — مرآة set_quotation_status (lifecycle_service.py:4845-4849)
 * حرفيًا: بلا مصفوفة انتقالات — أي حالة من مجموعة العروض تصلح لأي أخرى،
 * وغير الموجود في المجموعة ⇒ «حالة عرض السعر غير صحيحة.»
 * و«مقبول» بلا أي أثر جانبي: لا سند ولا عقد (لا شيء في تدفق العروض المكتبية
 * ينشئ سندات إطلاقًا — تحويل العرض لعقد دالة صريحة منفصلة خارج نطاق الويب).
 * التدقيق إضافة ويب موثقة (المكتبي لا يدقق هذه الدالة).
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_customers");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف غير صالح");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const status = String(body.status ?? "").trim();
  if (!isQuotationStatus(status)) return jsonError(QUOTATION_INVALID_STATUS, 400);

  const existing = await db.quotation.findUnique({
    where: { id },
    select: { id: true, quotationNumber: true, status: true },
  });
  if (!existing) return jsonError("عرض السعر غير موجود", 404);

  const quotation = await db.$transaction(async (tx) => {
    const row = await tx.quotation.update({
      where: { id },
      data: { status },
      select: { id: true, quotationNumber: true, status: true },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "تغيير حالة عرض السعر",
      entityType: "quotation",
      entityId: row.id,
      entityName: row.quotationNumber,
      oldStatus: existing.status,
      newStatus: row.status,
    });
    return row;
  });

  return ok({ quotation });
}
