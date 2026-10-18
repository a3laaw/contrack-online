import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok, audit } from "@/lib/api-utils";
import { intOr } from "@/lib/contrack-server";

type P = { params: Promise<{ id: string }> };

/** DELETE /api/gateway/ops/[id]
 *  حذف عملية بوابة — لتصحيح الاستيراد الخاطئ فقط.
 *  يُمنع حذف عملية: موزعة (إلغاء التوزيع أولًا) أو مرتبطة بسند عمولة أو تخصيصات تحويل. */
export async function DELETE(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_gateway");
  if ("response" in guard) return guard.response;
  try {
    const { id: idRaw } = await params;
    const id = intOr(idRaw, 0);
    const op = await db.gatewayOp.findUnique({
      where: { id },
      include: { _count: { select: { allocs: true, feeLinks: true } } },
    });
    if (!op) return jsonError("العملية غير موجودة", 404);
    if (op.distributed)
      return jsonError("لا يمكن حذف عملية موزّعة — استخدم «إلغاء التوزيع» أولًا.");
    if (op._count.feeLinks > 0)
      return jsonError("لا يمكن حذف عملية مرتبطة بسند عمولة — ألغِ سند العمولة أولًا.");
    if (op._count.allocs > 0)
      return jsonError("لا يمكن حذف عملية مرتبطة بتخصيصات تحويل — ألغِ التخصيصات أولًا.");
    await db.$transaction([
      db.transferOpAlloc.deleteMany({ where: { opId: id } }),
      db.gatewayFeeVoucher.deleteMany({ where: { opId: id } }),
      db.gatewayOp.delete({ where: { id } }),
    ]);
    await audit(db, {
      username: guard.user.username,
      action: "gateway_op_delete",
      entityType: "gateway_ops",
      entityId: id,
      entityName: `${op.gateway} ${op.opDate} ${op.phone} ${op.amount}`,
    });
    return ok({ deleted: true });
  } catch (e) {
    console.error(e);
    return jsonError("حدث خطأ غير متوقع", 500);
  }
}

export const dynamic = "force-dynamic";
