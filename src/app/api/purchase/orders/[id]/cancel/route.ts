import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok } from "@/lib/api-utils";
import { assertCancelAllowed } from "@/lib/purchase-core";

type P = { params: Promise<{ id: string }> };

/**
 * ر4 — إلغاء أمر الشراء (docs/purchase-design.md §5 د3/جدول المسارات):
 * • المسموح قبل الاستلام حصرًا — المستلم منه جزئيًا مرفوض برسالة (لا مسار عكسي لإذن إدخال منشور)
 * • الانتقال بحرس المصفوفة المغلقة (مسودة/مرسل للمورد → ملغى) داخل معاملة واحدة مع التدقيق
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_purchase");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "purchase", "الشراء");
  if (mg) return mg;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف غير صالح");

  const existing = await db.purchaseOrder.findUnique({
    where: { id },
    select: { id: true, poNumber: true, status: true, receivedAmount: true, supplier: { select: { name: true } } },
  });
  if (!existing) return jsonError("أمر الشراء غير موجود", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";

  const cancelGuard = assertCancelAllowed(existing.status, Number(existing.receivedAmount));
  if (!cancelGuard.ok) return jsonError(cancelGuard.error, 400);

  const row = await db.$transaction(async (tx) => {
    const updated = await tx.purchaseOrder.update({
      where: { id },
      data: { status: "ملغى" },
      select: { id: true, poNumber: true, status: true },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "إلغاء أمر شراء",
      entityType: "purchase_order",
      entityId: updated.id,
      entityName: `${updated.poNumber} — ${existing.supplier.name}`,
      oldStatus: existing.status,
      newStatus: updated.status,
      reason,
    });
    return updated;
  });
  return ok({ order: row });
}
