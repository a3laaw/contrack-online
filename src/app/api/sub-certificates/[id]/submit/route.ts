import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok, todayStr } from "@/lib/api-utils";
import { canSubCertSubmit, SUBCERT_SUBMITTED } from "@/lib/phase-a-core";

type P = { params: Promise<{ id: string }> };

/** تقديم المستخلص: مسودة → مقدم (آلة حالات مغلقة — G7) */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const cert = await db.subCertificate.findUnique({ where: { id } });
  if (!cert) return jsonError("المستخلص غير موجود", 404);
  if (!canSubCertSubmit(cert.status)) {
    return jsonError(`المستخلص بحالة «${cert.status}» — التقديم من المسودة حصرًا`);
  }
  if (!(Number(cert.netAmount) > 0) && !(Number(cert.grossAmount) > 0)) {
    return jsonError("لا يمكن تقديم مستخلص بلا مبالغ");
  }

  await db.$transaction(async (tx) => {
    await tx.subCertificate.update({
      where: { id },
      data: { status: SUBCERT_SUBMITTED, submitBy: guard.user.username, submitAt: todayStr() },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "تقديم",
      entityType: "subCertificate",
      entityId: id,
      entityName: cert.certNumber,
      oldStatus: cert.status,
      newStatus: SUBCERT_SUBMITTED,
    });
  });
  return ok({ status: SUBCERT_SUBMITTED });
}
