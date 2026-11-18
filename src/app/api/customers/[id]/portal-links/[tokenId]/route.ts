import { NextRequest } from "next/server";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { db } from "@/lib/db";

type P = { params: Promise<{ id: string; tokenId: string }> };

/**
 * ر5 — إبطال رابط كشف مؤقت فورًا (docs/customer-portal-design.md د3):
 * DELETE /api/customers/[id]/portal-links/[tokenId] — يضبط revokedAt ولا يحذف الصف
 * (الإبطال يحقق الغرض ويُبقي سجل الإصدار). الإبطال المكرر نجاح متسامح (idempotent).
 */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_customers");
  if ("response" in guard) return guard.response;
  const { id: idStr, tokenId: tidStr } = await params;
  const customerId = Number(idStr);
  const tokenId = Number(tidStr);
  if (!Number.isFinite(customerId) || customerId <= 0) return jsonError("معرف العميل غير صالح");
  if (!Number.isFinite(tokenId) || tokenId <= 0) return jsonError("معرف الرابط غير صالح");

  const row = await db.customerPortalToken.findFirst({
    where: { id: tokenId, customerId },
    select: { id: true, revokedAt: true, customer: { select: { name: true, customerCode: true } } },
  });
  if (!row) return jsonError("رابط الكشف غير موجود لهذا العميل", 404);
  if (row.revokedAt) {
    // إبطال مكرر — نجاح بلا تغيير (المعرّف نفسه يبقى مبطولًا)
    return ok({ id: row.id, alreadyRevoked: true });
  }

  const revokedAt = new Date();
  await db.$transaction(async (tx) => {
    await tx.customerPortalToken.update({
      where: { id: row.id },
      data: { revokedAt },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "إبطال رابط كشف مؤقت لعميل",
      entityType: "customerPortalToken",
      entityId: row.id,
      entityName: `${row.customer.customerCode || customerId} — ${row.customer.name}`,
      newStatus: "مبطول",
    });
  });

  return ok({ id: row.id, revokedAt: revokedAt.toISOString() });
}
