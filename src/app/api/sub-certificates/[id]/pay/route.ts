import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok, parseDay, todayStr } from "@/lib/api-utils";
import { r3 } from "@/lib/contrack-core";
import { canSubCertPay, SUBCERT_APPROVED, SUBCERT_PAID } from "@/lib/phase-a-core";
import { createVoucherTx, prepareVoucher, VoucherError } from "@/lib/voucher-server";

type P = { params: Promise<{ id: string }> };

/**
 * صرف مستخلص الباطن (§3.5): معتمد → مدفوع عبر createVoucher القائم —
 * بوابة تحصيل العميل (subPayClientGate) وسقف الصرف (subPaymentCap) والحساب
 * البنكي تعمل تلقائيًا لأن السند سند صرف باطن عادي. إلغاء السند لاحقًا ⇒
 * رجوع المستخلص إلى «معتمد» آليًا (خطاف داخل cancelVoucherTx).
 */
export async function POST(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return jsonError("معرف غير صالح");

  const cert = await db.subCertificate.findUnique({
    where: { id },
    include: { subContract: { select: { id: true, description: true } } },
  });
  if (!cert) return jsonError("المستخلص غير موجود", 404);
  if (!canSubCertPay(cert.status)) {
    return jsonError(`المستخلص بحالة «${cert.status}» — الصرف من «معتمد» حصرًا`);
  }
  if (cert.paidVoucherId) return jsonError("المستخلص مرتبط بسند صرف من قبل");
  const netAmount = r3(Number(cert.netAmount));
  if (!(netAmount > 0)) return jsonError("لا صرف على مستخلص صافيه صفر");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const vdate = parseDay(body.vdate) || todayStr();
  const method = String(body.method || "نقدًا").trim() || "نقدًا";
  const account = String(body.account || "الصندوق").trim() || "الصندوق";
  const description =
    String(body.description || "").trim() ||
    `صرف مستخلص باطن ${cert.certNumber}${cert.subContract.description ? ` — ${cert.subContract.description}` : ""}`;

  let prep;
  try {
    prep = await prepareVoucher(
      {
        vtype: "payment",
        vdate,
        amount: netAmount,
        method,
        account,
        description,
        subContractId: cert.subContractId,
      },
      guard.user
    );
  } catch (e) {
    if (e instanceof VoucherError) return jsonError(e.message, e.status ?? 400);
    throw e;
  }

  try {
    const result = await db.$transaction(
      async (tx) => {
        // إعادة الفحص داخل المعاملة (سباق تقديم/إلغاء متزامن)
        const fresh = await tx.subCertificate.findUnique({ where: { id } });
        if (!fresh || !canSubCertPay(fresh.status)) {
          throw new VoucherError(`المستخلص لم يبقَ «${SUBCERT_APPROVED}» — حدث تغيير متزامن`, 400);
        }
        const voucher = await createVoucherTx(tx, prep, guard.user, {});
        await tx.subCertificate.update({
          where: { id },
          data: { status: SUBCERT_PAID, paidVoucherId: voucher.id },
        });
        await audit(tx, {
          username: guard.user.username,
          action: "صرف",
          entityType: "subCertificate",
          entityId: id,
          entityName: cert.certNumber,
          oldStatus: fresh.status,
          newStatus: SUBCERT_PAID,
        });
        return voucher;
      },
      { timeout: 30_000, maxWait: 10_000 }
    );
    return ok({
      status: SUBCERT_PAID,
      voucherId: result.id,
      voucherNumber: result.voucherNumber,
      amount: netAmount,
    });
  } catch (e) {
    if (e instanceof VoucherError) return jsonError(e.message, e.status ?? 400);
    console.error("فشل صرف المستخلص:", e);
    return jsonError("تعذر صرف المستخلص، حاول مجددًا", 500);
  }
}
