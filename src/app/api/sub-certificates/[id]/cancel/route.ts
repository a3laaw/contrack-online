import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { canSubCertCancel, SUBCERT_CANCELLED } from "@/lib/phase-a-core";

type P = { params: Promise<{ id: string }> };

/** إلغاء المستخلص بسبب — من الثلاثة الأولى حصرًا (المدفوع يُعالج عبر إلغاء سند صرفه) */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = String(body.reason || "").trim();
  if (!reason) return jsonError("سبب الإلغاء مطلوب");

  const cert = await db.subCertificate.findUnique({ where: { id } });
  if (!cert) return jsonError("المستخلص غير موجود", 404);
  if (!canSubCertCancel(cert.status)) {
    return jsonError(
      cert.status === "مدفوع"
        ? "المستخلص مدفوع — ألغِ سند الصرف ويعود تلقائيًا إلى «معتمد»"
        : `المستخلص بحالة «${cert.status}» — لا إلغاء`
    );
  }

  await db.$transaction(async (tx) => {
    await tx.subCertificate.update({
      where: { id },
      data: { status: SUBCERT_CANCELLED, cancelReason: reason },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "إلغاء",
      entityType: "subCertificate",
      entityId: id,
      entityName: cert.certNumber,
      oldStatus: cert.status,
      newStatus: SUBCERT_CANCELLED,
      reason,
    });
  });
  return ok({ status: SUBCERT_CANCELLED });
}
